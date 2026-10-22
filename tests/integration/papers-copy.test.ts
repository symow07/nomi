import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { purgeBusinesses } from './books-db.js';

/**
 * E1 (Phase 5; 0205) — the done-criterion: "a workspace holding documents can close; one that hasn't downloaded
 * can't; the archive opens and its index matches what's inside; the accountant's download doesn't satisfy it."
 * Through the real route (`/app/settings/data/papers.zip`) and the real closure (`close_workspace`): the archive is read
 * here with a reader of this test's own, so what is checked is the file an owner gets, not the writer's view of it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `e1e10000-0000-4000-8000-${RUN}0001`;
const BROKEN = `e1e10000-0000-4000-8000-${RUN}0002`;
const OWNER = `e1e10000-0000-4000-8000-${RUN}00aa`;
const ACCOUNTANT = `e1e10000-0000-4000-8000-${RUN}00bb`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const NAME = `Papers ${RUN}`;

/** The archive, read independently: each entry's name and inflated bytes, from the central directory. */
function unzip(b: Buffer): { name: string; data: Buffer }[] {
  let eocd = -1;
  for (let i = b.length - 22; i >= 0; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out: { name: string; data: Buffer }[] = [];
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const size = b.readUInt32LE(p + 24), compressed = b.readUInt32LE(p + 20), nameLen = b.readUInt16LE(p + 28);
    const extra = b.readUInt16LE(p + 30), comment = b.readUInt16LE(p + 32), offset = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nameLen);
    const start = offset + 30 + b.readUInt16LE(offset + 26) + b.readUInt16LE(offset + 28);
    const data = inflateRawSync(b.subarray(start, start + compressed));
    if (data.length !== size) throw new Error(`size of ${name}`);
    out.push({ name, data });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const csvRows = (text: string) => text.replace(/^﻿/, '').trim().split(/\r?\n/).map((l) => l.split(','));

d('E1 · the owner\'s copy of their papers (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let db: import('../../src/db/client.js').Db;
  let app: import('fastify').FastifyInstance;
  let store: import('../../src/db/documents.js').DocumentStores;
  let cookie = '';
  const tenant = async <T>(b: string, fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, b as never, fn);
  };
  const put = (b: string, name: string, bytes: Buffer) => tenant(b, (tx) => store.put(tx, { businessId: b, name, mediaType: 'application/pdf', bytes, by: OWNER }));
  const close = async (b: string, name: string) => (await import('../../src/api/web/erasure.js')).closeWorkspace(db, b, name, OWNER);
  const download = () => app.inject({ method: 'GET', url: '/app/settings/data/papers.zip', headers: { cookie } });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    const { documentStoresFrom } = await import('../../src/db/documents.js');
    const { deriveKey } = await import('../../src/security/credentials.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    store = documentStoresFrom({ DOCUMENT_STORES: JSON.stringify({ default: 'database' }) }, deriveKey('c'.repeat(64)));
    for (const [id, name] of [[BIZ, NAME], [BROKEN, `Broken ${RUN}`]] as const) {
      await admin.query(`insert into businesses (id, name, engine, country, currency, owner_locale) values ($1, $2, 'service', 'MA', 'MAD', 'en')`, [id, name]);
      await admin.query(`insert into books_settings (business_id, residency) values ($1, 'default')`, [id]);
    }
    await admin.query(`insert into people (id, business_id, name, is_owner) values ($1, $2, 'Mei', true)`, [OWNER, BIZ]);
    await admin.query(`insert into people (id, business_id, name, is_owner, kind) values ($1, $2, 'Books', false, 'accountant')`, [ACCOUNTANT, BIZ]);
    await admin.query(`insert into people (business_id, name, is_owner) values ($1, 'Owner', true)`, [BROKEN]);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: `papers-${RUN}`, sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0, documents: store,
      provider: 'disabled', messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', headers: FORM, payload: `code=papers-${RUN}` })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
    await put(BIZ, 'F-2026-0042.pdf', Buffer.from(`%PDF-1.7 Facture F-2026-0042 ${RUN}`));
    await put(BIZ, 'F-2026-0042.pdf', Buffer.from(`%PDF-1.7 the same name, another paper ${RUN}`));
    await put(BIZ, 'فاتورة/مارس.pdf', Buffer.from(`%PDF-1.7 une facture en arabe ${RUN}`));
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await purgeBusinesses(admin, [BIZ, BROKEN], 'papers-copy-test');
    await db?.destroy(); await admin?.end();
  });

  it('NOT DOWNLOADED, NOT CLOSED: a workspace holding papers refuses with its own reason, and nothing is erased', async () => {
    expect(await close(BIZ, NAME)).toEqual({ outcome: 'papers_first' });
    expect((await admin.query(`select is_active from businesses where id = $1`, [BIZ])).rows[0].is_active).toBe(true);
    const page = (await app.inject({ method: 'GET', url: '/app/settings/data', headers: { cookie } })).body;
    expect(page).toContain('id="papers"');
    expect(page).toContain('href="/app/settings/data/papers.zip"');
    // no file kept as history here, so nothing is said about keeping one longer (history-kept.test.ts says it)
    expect(page).not.toContain('Files imported as history');
    expect(page).toContain('3 papers are kept here');
  });

  it('THE ACCOUNTANT\'S DOWNLOAD DOES NOT SATISFY IT: a receipt of theirs, holding every paper, still leaves closure waiting', async () => {
    await admin.query(`insert into books_exports (business_id, made_by, kind, covers_through, entries, lines, papers, sha256)
      values ($1, $2, 'papers_zip', now(), 0, 0, 3, $3)`, [BIZ, ACCOUNTANT, 'a'.repeat(64)]);
    expect(await close(BIZ, NAME)).toEqual({ outcome: 'papers_first' });
  });

  it('THE ARCHIVE OPENS, AND ITS INDEX MATCHES WHAT IS INSIDE: every paper, as given, numbered, named safely', async () => {
    const r = await download();
    expect(r.statusCode).toBe(200);
    expect(String(r.headers['content-type'])).toContain('application/zip');
    expect(String(r.headers['content-disposition'])).toMatch(/^attachment; filename="papers-\d{4}-\d{2}-\d{2}\.zip"$/);
    const files = unzip(r.rawPayload);
    expect(files[0]!.name).toBe('index.csv');
    const [head, ...rows] = csvRows(files[0]!.data.toString('utf8'));
    expect(head).toEqual(['#', 'file', 'name', 'type', 'bytes', 'sha256', 'added', 'added_by', 'entry', 'keep_until', 'history_through']);
    expect(rows).toHaveLength(3);
    const papers = files.slice(1);
    expect(papers.map((f) => f.name)).toEqual(rows.map((x) => x[1]));
    expect(new Set(papers.map((f) => f.name)).size).toBe(3);                 // two papers of one name: two files
    expect(papers.every((f) => /^papers\/\d{4}-[^/]+$/.test(f.name))).toBe(true);   // no folder from a name with a slash
    const stored = (await admin.query(`select sha256, bytes from documents where business_id = $1 order by created_at, id`, [BIZ])).rows;
    for (const [i, f] of papers.entries()) {
      expect(sha(f.data), f.name).toBe(rows[i]![5]);
      expect(rows[i]![5]).toBe(stored[i].sha256);
      expect(String(f.data.length)).toBe(rows[i]![4]);
    }
    // the receipt is the owner's
    const receipt = (await admin.query(`select made_by, papers from books_exports where business_id = $1 and kind = 'papers_zip' order by made_at desc limit 1`, [BIZ])).rows[0];
    expect(receipt.papers).toBe(3);
    expect(['owner', OWNER]).toContain(receipt.made_by);
    expect((await app.inject({ method: 'GET', url: '/app/settings/data', headers: { cookie } })).body).toContain('Your copy holds every paper.');
  });

  it('A PAPER ADDED AFTER THE COPY makes it old; downloaded again, the workspace closes', async () => {
    await put(BIZ, 'late.pdf', Buffer.from(`%PDF-1.7 a late bill ${RUN}`));
    expect(await close(BIZ, NAME)).toEqual({ outcome: 'papers_first' });
    expect((await download()).statusCode).toBe(200);
    expect((await close(BIZ, NAME)).outcome).toBe('closed');
    // the papers are the record: kept until their date, with the workspace held for them
    expect((await admin.query(`select count(*)::int as n from documents where business_id = $1`, [BIZ])).rows[0].n).toBe(4);
  });

  it('A COPY THAT FAILS LEAVES NO RECEIPT: a paper that cannot be opened stops the archive, and closure still waits', async () => {
    const good = await put(BROKEN, 'ok.pdf', Buffer.from(`%PDF-1.7 fine ${RUN}`));
    const bad = await put(BROKEN, 'bad.pdf', Buffer.from(`%PDF-1.7 will be damaged ${RUN}`));
    await admin.query(`update document_blobs set sealed = overlay(sealed placing '\\x00'::bytea from 40 for 1) where document_id = $1`, [bad.id]);
    const { makePapersArchive } = await import('../../src/db/papersCopy.js');
    await expect(makePapersArchive(db, BROKEN, 'owner', store, { sep: ',', decimal: '.' })).rejects.toThrow();
    expect((await admin.query(`select count(*)::int as n from books_exports where business_id = $1 and kind = 'papers_zip'`, [BROKEN])).rows[0].n).toBe(0);
    const ownerId = (await admin.query(`select id::text as id from people where business_id = $1 and is_owner`, [BROKEN])).rows[0].id;
    expect(await (await import('../../src/api/web/erasure.js')).closeWorkspace(db, BROKEN, `Broken ${RUN}`, ownerId)).toEqual({ outcome: 'papers_first' });
    expect(good.id).not.toBe(bad.id);
  });
});
