import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { purgeBusinesses } from './books-db.js';

/**
 * A4 (Phase 5, 0174; decision 14) — the done-criterion (PHASE-5.md §4): encrypted and readable only by its own
 * workspace (another workspace gets nothing); each document carries its retention date; the residency parameter
 * routes storage, and a test with TWO settings proves nothing is hard-coded. Through the real store, as the app.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const HOME = `a4a40000-0000-4000-8000-${RUN}0001`;   // residency "default": this database
const AWAY = `a4a40000-0000-4000-8000-${RUN}0002`;   // residency "ma": a directory
const NOWHERE = `a4a40000-0000-4000-8000-${RUN}0003`;   // residency "eu": no store configured
const PAPER = Buffer.from('%PDF-1.7 Facture F-2026-0042 Atlas Textiles SARL total 1200.50 MAD', 'utf8');

d('A4 · documents: sealed, kept to their date, where the residency says (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let db: import('../../src/db/client.js').Db;
  let tenant: <T>(b: string, fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>) => Promise<T>;
  let store: import('../../src/db/documents.js').DocumentStores;
  let dir: string;
  let entry = '';

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { documentStoresFrom } = await import('../../src/db/documents.js');
    const { deriveKey } = await import('../../src/security/credentials.js');
    db = createDb(DATABASE_URL!);
    tenant = (b, fn) => { const p = parseBusinessId(b); if (!p.ok) throw new Error('fixture'); return withTenantTx(db, p.value, fn); };
    dir = mkdtempSync(join(tmpdir(), 'nomi-docs-'));
    store = documentStoresFrom({ DOCUMENT_STORES: JSON.stringify({ default: 'database', ma: `directory:${dir}` }) }, deriveKey('c'.repeat(64)));
    for (const [id, residency] of [[HOME, 'default'], [AWAY, 'ma'], [NOWHERE, 'eu']] as const) {
      await admin.query(`insert into businesses (id, name, engine, country, currency) values ($1, $2, 'service', 'MA', 'MAD')`, [id, `Docs ${residency} ${RUN}`]);
      await admin.query(`insert into books_settings (business_id, residency) values ($1, $2)`, [id, residency]);
    }
    // an entry of fiscal year 2026, for an attached document's date
    entry = await tenant(HOME, async (tx) => {
      const { sql } = await import('kysely');
      const j = (await sql<{ id: string }>`insert into journals (business_id, code, name, kind) values (${HOME}::uuid, 'AC', 'Achats', 'purchases') returning id::text as id`.execute(tx)).rows[0]!.id;
      const f = (await sql<{ id: string }>`insert into fiscal_years (business_id, starts_on, ends_on) values (${HOME}::uuid, '2026-01-01', '2026-12-31') returning id::text as id`.execute(tx)).rows[0]!.id;
      return (await sql<{ id: string }>`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by)
        values (${HOME}::uuid, ${j}::uuid, ${f}::uuid, '2026-04-01', 'Bill from Atlas', 'owner') returning id::text as id`.execute(tx)).rows[0]!.id;
    });
  });
  afterAll(async () => {
    await purgeBusinesses(admin, [HOME, AWAY, NOWHERE], 'documents-test');
    await db?.destroy();
    await admin.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it('TWO residencies, two stores: one in this database, one in its directory — routed by the parameter alone', async () => {
    const home = await tenant(HOME, (tx) => store.put(tx, { businessId: HOME, entryId: entry, name: 'F-2026-0042.pdf', mediaType: 'application/pdf', bytes: PAPER, by: 'owner' }));
    const away = await tenant(AWAY, (tx) => store.put(tx, { businessId: AWAY, name: 'bon.pdf', mediaType: 'application/pdf', bytes: PAPER, by: 'owner' }));
    expect([home.residency, home.store, away.residency, away.store]).toEqual(['default', 'database', 'ma', 'directory']);
    // the database holds the one, and not the other
    expect((await admin.query(`select count(*)::int as n from document_blobs where document_id = $1`, [home.id])).rows[0].n).toBe(1);
    expect((await admin.query(`select count(*)::int as n from document_blobs where document_id = $1`, [away.id])).rows[0].n).toBe(0);
    // the directory holds the other, and not the one
    expect(readdirSync(join(dir, AWAY))).toEqual([`${away.id}.sealed`]);
    expect(() => readdirSync(join(dir, HOME))).toThrow();
    // and each opens, whole, from where it is
    expect((await tenant(HOME, (tx) => store.open(tx, home.id)))!.bytes.equals(PAPER)).toBe(true);
    expect((await tenant(AWAY, (tx) => store.open(tx, away.id)))!.bytes.equals(PAPER)).toBe(true);
  });

  it('ENCRYPTED: neither the database nor the directory holds a word of it', async () => {
    const blobs = (await admin.query(`select b.sealed from document_blobs b join documents d on d.id = b.document_id where d.business_id = $1`, [HOME])).rows;
    for (const b of blobs) {
      expect((b.sealed as Buffer).includes(Buffer.from('Atlas Textiles'))).toBe(false);
      expect((b.sealed as Buffer).includes(Buffer.from('%PDF'))).toBe(false);
    }
    for (const f of readdirSync(join(dir, AWAY))) expect(readFileSync(join(dir, AWAY, f)).includes(Buffer.from('Atlas Textiles'))).toBe(false);
  });

  it('readable ONLY by its own workspace: another gets nothing, by id or by listing', async () => {
    const home = await tenant(HOME, (tx) => store.put(tx, { businessId: HOME, name: 'mine.pdf', mediaType: 'application/pdf', bytes: PAPER, by: 'owner' }));
    expect(await tenant(AWAY, (tx) => store.open(tx, home.id))).toBeNull();
    const { sql } = await import('kysely');
    expect(await tenant(AWAY, async (tx) => (await sql<{ n: number }>`select count(*)::int as n from documents where business_id = ${HOME}::uuid`.execute(tx)).rows[0]!.n)).toBe(0);
    expect(await tenant(AWAY, async (tx) => (await sql<{ n: number }>`select count(*)::int as n from document_blobs`.execute(tx)).rows[0]!.n)).toBe(0);
    // and a sealed blob moved under another workspace's row does not open: the seal is bound to its workspace and id
    const { openDocument, documentKeyFrom } = await import('../../src/security/documentSeal.js');
    const { deriveKey } = await import('../../src/security/credentials.js');
    const sealed = (await admin.query(`select sealed from document_blobs where document_id = $1`, [home.id])).rows[0].sealed as Buffer;
    expect(() => openDocument(sealed, [documentKeyFrom(deriveKey('c'.repeat(64)), 1)], AWAY, home.id)).toThrow();
  });

  it('each document carries its RETENTION DATE: its entry\'s fiscal year, or the year it came in, plus the law\'s years', async () => {
    const attached = await tenant(HOME, (tx) => store.put(tx, { businessId: HOME, entryId: entry, name: 'a.pdf', mediaType: 'application/pdf', bytes: PAPER, by: 'owner' }));
    expect(attached.keepUntil).toBe('2036-12-31');   // fiscal year 2026, Morocco: ten years (CGI art. 211)
    const loose = await tenant(HOME, (tx) => store.put(tx, { businessId: HOME, name: 'b.pdf', mediaType: 'application/pdf', bytes: PAPER, by: 'owner' }));
    expect(loose.keepUntil).toBe(`${new Date().getUTCFullYear() + 10}-12-31`);
    // the date is the database's, not the caller's
    const { sql } = await import('kysely');
    const forced = await tenant(HOME, async (tx) => (await sql<{ k: string }>`insert into documents (business_id, name, media_type, bytes, sha256, residency, store, key_version, keep_until, created_by)
      values (${HOME}::uuid, 'c.pdf', 'application/pdf', 1, ${'0'.repeat(64)}, 'default', 'database', 1, '2027-01-01', 'x') returning keep_until::text as k`.execute(tx)).rows[0]!.k);
    expect(forced).toBe(`${new Date().getUTCFullYear() + 10}-12-31`);
  });

  it('a residency with NO store refuses the upload, and nothing is put anywhere else', async () => {
    const before = (await admin.query(`select count(*)::int as n from documents`)).rows[0].n;
    await expect(tenant(NOWHERE, (tx) => store.put(tx, { businessId: NOWHERE, name: 'x.pdf', mediaType: 'application/pdf', bytes: PAPER, by: 'owner' })))
      .rejects.toThrow(/live in "eu", and this installation has no store there — nothing was stored/);
    expect((await admin.query(`select count(*)::int as n from documents`)).rows[0].n).toBe(before);
  });

  it('kept as given: no change and no delete by the app; a changed byte is caught when it is opened', async () => {
    const { sql } = await import('kysely');
    const doc = await tenant(HOME, (tx) => store.put(tx, { businessId: HOME, name: 'kept.pdf', mediaType: 'application/pdf', bytes: PAPER, by: 'owner' }));
    await expect(tenant(HOME, (tx) => sql`update documents set name = 'other.pdf' where id = ${doc.id}::uuid`.execute(tx))).rejects.toThrow(/permission denied/);
    await expect(tenant(HOME, (tx) => sql`delete from documents where id = ${doc.id}::uuid`.execute(tx))).rejects.toThrow(/permission denied/);
    await expect(tenant(HOME, (tx) => sql`update document_blobs set sealed = '\\x00' where document_id = ${doc.id}::uuid`.execute(tx))).rejects.toThrow(/permission denied/);
    await admin.query(`update document_blobs set sealed = overlay(sealed placing '\\x00'::bytea from 40 for 1) where document_id = $1`, [doc.id]);
    await expect(tenant(HOME, (tx) => store.open(tx, doc.id))).rejects.toThrow();
  });

  it('a workspace holding papers does not close until the owner has downloaded them — and nothing is erased (E1: its own reason)', async () => {
    const erasure = await import('../../src/api/web/erasure.js');
    const OWNER = `a4a40000-0000-4000-8000-${RUN}00aa`;
    await admin.query(`insert into people (id, business_id, name, is_owner) values ($1, $2, 'Mei', true)`, [OWNER, AWAY]);
    expect(await erasure.closeWorkspace(db, AWAY, `Docs ma ${RUN}`, OWNER)).toEqual({ outcome: 'papers_first' });
    expect((await admin.query(`select count(*)::int as n from documents where business_id = $1`, [AWAY])).rows[0].n).toBeGreaterThan(0);
    expect((await admin.query(`select is_active from businesses where id = $1`, [AWAY])).rows[0].is_active).toBe(true);
  });
});
