import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { purgeBusinesses } from './books-db.js';

/**
 * B0 (Phase 5) — A CREDENTIAL_KEY ROTATION LOSES NO DOCUMENT. The document key is derived from CREDENTIAL_KEY
 * (src/security/documentSeal.ts), so before B0 a rotation left every stored paper unreadable: nothing opened them
 * with the previous key and nothing sealed them again. Now, while CREDENTIAL_KEY_PREVIOUS is set the app opens them
 * with either key, and tools/rekey.mjs seals them again with the current one — in this database, and in a directory
 * store's files. Through the real store and the real tool.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RUN = randomUUID().slice(0, 8);
const HOME = `b0b00000-0000-4000-8000-${RUN}0001`;   // residency "default": this database
const AWAY = `b0b00000-0000-4000-8000-${RUN}0002`;   // residency "vault": a directory
const OLD = randomBytes(32).toString('hex');
const NEW = randomBytes(32).toString('hex');
const PAPER = Buffer.from('%PDF-1.7 Facture F-2026-0107 Atlas Textiles SARL total 480.00 MAD', 'utf8');

d('B0 · a CREDENTIAL_KEY rotation loses no document (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let db: import('../../src/db/client.js').Db;
  let tenant: <T>(b: string, fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>) => Promise<T>;
  let storesWith: (env: Record<string, string>, key: string) => import('../../src/db/documents.js').DocumentStores;
  let dir: string;
  let stores: string;
  const ids = { home: '', away: '' };
  const tool = (args: string[], extra: Record<string, string>) => {
    const r = spawnSync(process.execPath, ['tools/rekey.mjs', ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000,
      env: { PATH: process.env['PATH'] ?? '', ADMIN_DATABASE_URL: ADMIN_URL!, DOCUMENT_STORES: stores, ...extra },
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const opens = async (b: string, id: string, s: import('../../src/db/documents.js').DocumentStores) =>
    tenant(b, (tx) => s.open(tx, id)).then((x) => x?.bytes.equals(PAPER) ?? false, () => false);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { documentStoresFrom } = await import('../../src/db/documents.js');
    const { deriveKey } = await import('../../src/security/credentials.js');
    db = createDb(DATABASE_URL!);
    tenant = (b, fn) => { const p = parseBusinessId(b); if (!p.ok) throw new Error('fixture'); return withTenantTx(db, p.value, fn); };
    dir = mkdtempSync(join(tmpdir(), 'nomi-rekey-docs-'));
    stores = JSON.stringify({ default: 'database', vault: `directory:${dir}` });
    storesWith = (env, key) => documentStoresFrom({ DOCUMENT_STORES: stores, ...env }, deriveKey(key));
    for (const [id, residency] of [[HOME, 'default'], [AWAY, 'vault']] as const) {
      await admin.query(`insert into businesses (id, name, engine, country, currency) values ($1, $2, 'service', 'MA', 'MAD')`, [id, `Rekey docs ${residency} ${RUN}`]);
      await admin.query(`insert into books_settings (business_id, residency) values ($1, $2)`, [id, residency]);
    }
    // sealed under the OLD key, as an installation before the rotation stored them
    const before = storesWith({}, OLD);
    ids.home = (await tenant(HOME, (tx) => before.put(tx, { businessId: HOME, name: 'F-2026-0107.pdf', mediaType: 'application/pdf', bytes: PAPER, by: 'owner' }))).id;
    ids.away = (await tenant(AWAY, (tx) => before.put(tx, { businessId: AWAY, name: 'bon.pdf', mediaType: 'application/pdf', bytes: PAPER, by: 'owner' }))).id;
  });
  afterAll(async () => {
    await purgeBusinesses(admin, [HOME, AWAY], 'rekey-documents-test');
    await db?.destroy();
    await admin.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it('mid-rotation the app opens them with the previous key; with the new key alone it could not', async () => {
    const midway = storesWith({ CREDENTIAL_KEY_PREVIOUS: OLD }, NEW);
    expect(await opens(HOME, ids.home, midway)).toBe(true);
    expect(await opens(AWAY, ids.away, midway)).toBe(true);
    const newOnly = storesWith({}, NEW);
    expect(await opens(HOME, ids.home, newOnly)).toBe(false);
    expect(await opens(AWAY, ids.away, newOnly)).toBe(false);
  });

  it('a dry run counts them and writes nothing', async () => {
    const blob = (await admin.query('select sealed from document_blobs where document_id = $1', [ids.home])).rows[0].sealed as Buffer;
    const file = readFileSync(join(dir, AWAY, `${ids.away}.sealed`));
    const dry = tool([], { CREDENTIAL_KEY: NEW, CREDENTIAL_KEY_PREVIOUS: OLD });
    expect(dry.code, dry.err).toBe(0);
    expect(dry.out).toMatch(/Documents: \d+ already under the current key · [1-9]\d* under the previous key/);
    expect(dry.out).toContain('Dry run: nothing was written.');
    expect(((await admin.query('select sealed from document_blobs where document_id = $1', [ids.home])).rows[0].sealed as Buffer).equals(blob)).toBe(true);
    expect(readFileSync(join(dir, AWAY, `${ids.away}.sealed`)).equals(file)).toBe(true);
  });

  it('--yes seals both again with the current key — the blob and the file; the old key no longer opens them; again, nothing', async () => {
    const yes = tool(['--yes'], { CREDENTIAL_KEY: NEW, CREDENTIAL_KEY_PREVIOUS: OLD });
    expect(yes.code, yes.err).toBe(0);
    expect(yes.out).toMatch(/✓ {2}[1-9]\d* documents? re-sealed with the current key \([1-9]\d* in the database, [1-9]\d* in a directory store\)/);
    const newOnly = storesWith({}, NEW);
    expect(await opens(HOME, ids.home, newOnly)).toBe(true);
    expect(await opens(AWAY, ids.away, newOnly)).toBe(true);
    const oldOnly = storesWith({}, OLD);
    expect(await opens(HOME, ids.home, oldOnly)).toBe(false);
    expect(await opens(AWAY, ids.away, oldOnly)).toBe(false);
    // no half-written file left beside it
    expect(() => readFileSync(join(dir, AWAY, `${ids.away}.sealed.rekey`))).toThrow();
    const again = tool([], { CREDENTIAL_KEY: NEW, CREDENTIAL_KEY_PREVIOUS: OLD });
    expect(again.out).toMatch(/Documents: [1-9]\d* already under the current key · 0 under the previous key/);
  });

  it('where the directory is not mounted, its files are named as unreadable here, and none is written', () => {
    const r = spawnSync(process.execPath, ['tools/rekey.mjs'], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000,
      env: { PATH: process.env['PATH'] ?? '', ADMIN_DATABASE_URL: ADMIN_URL!, CREDENTIAL_KEY: NEW, CREDENTIAL_KEY_PREVIOUS: OLD,
        DOCUMENT_STORES: JSON.stringify({ default: 'database', vault: `directory:${join(dir, 'not-mounted')}` }) },
    });
    expect(r.stdout).toContain(`✗ documents ${ids.away} (its file cannot be read here: run this where "vault"'s directory is mounted)`);
  });
});
