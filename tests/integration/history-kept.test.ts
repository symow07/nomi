import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * E3 (Phase 5; 0207) — the done-criterion: "an out-of-window import keeps its file, the file is downloadable, it's
 * visibly marked, erasure reaches it, and the trial balance and FEC can't see it." Through the real workbook route,
 * the real papers pages, the real FEC and trial balance, the real closure and tools/books-retention.mjs.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUN = randomUUID().slice(0, 8);
const BIZ = `e3e30000-0000-4000-8000-${RUN}0001`;
const CODE = `history-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const NAME = `History ${RUN}`;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The papers archive's index, read from the archive itself (its central directory, then the entry inflated). */
function indexOf(b: Buffer): string {
  let eocd = -1;
  for (let i = b.length - 22; i >= 0; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  let p = b.readUInt32LE(eocd + 16);
  for (let n = 0; n < b.readUInt16LE(eocd + 10); n++) {
    const compressed = b.readUInt32LE(p + 20), nameLen = b.readUInt16LE(p + 28), offset = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === 'index.csv') {
      const start = offset + 30 + b.readUInt16LE(offset + 26) + b.readUInt16LE(offset + 28);
      return inflateRawSync(b.subarray(start, start + compressed)).toString('utf8');
    }
    p += 46 + nameLen + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  throw new Error('no index.csv');
}

d('E3 · imported history, kept as a document and never in the books (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 180_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let year = '';
  let excel: ReturnType<typeof import('../../src/books/connectors/excel.js').excelConnector>;
  let docId = '';
  let sent: Buffer = Buffer.alloc(0);
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const one = async (text: string, values: unknown[] = []) => (await admin.query(text, values)).rows[0];
  const cookieOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const upload = (bytes: Buffer) => {
    const boundary = `----nomi${RUN}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="workbook"; filename="grand-livre-2025.xlsx"\r\nContent-Type: ${XLSX}\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return app.inject({ method: 'POST', url: '/app/books/workbook', payload: body, headers: { cookie: owner, 'content-type': `multipart/form-data; boundary=${boundary}` } });
  };
  const flashOf = async (r: { headers: Record<string, unknown> }) => {
    const set = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).join('; ');
    return (await app.inject({ method: 'GET', url: String(r.headers['location']).split('#')[0]!, headers: { cookie: `${owner}; ${set}` } })).body;
  };
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie: owner } });
  const entry = (key: string, date: string, label: string, amount: string) => ({
    key, journal: 'VE', date, label, documentRef: null, documentDate: null, state: 'posted' as const, lines: [
      { account: '3421', party: null, taxCode: null, currency: 'MAD', debit: amount as never, credit: null, label: null },
      { account: '7111', party: null, taxCode: null, currency: 'MAD', debit: null, credit: amount as never, label: null }] });
  const workbook = async (extra: ReturnType<typeof entry>[]) => {
    const r = await get('/app/books/workbook.xlsx');
    const books = excel.toBooks(r.rawPayload).data;
    return excel.fromBooks({ ...books, entries: [...books.entries, ...extra] });
  };
  const entriesHeld = async () => (await one(`select count(*)::int as n from journal_entries where business_id = $1`, [BIZ])).n as number;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, NAME]);
    await admin.query(`insert into people (business_id, name, is_owner) values ($1, 'Owner', true)`, [BIZ]);
    await admin.query(`insert into books_settings (business_id, residency) values ($1, 'default')`, [BIZ]);
    year = await as(async (q) => {
      await q(`insert into accounts (business_id, code, name, kind) values (current_business_id(), '3421', 'Clients', 'asset'), (current_business_id(), '7111', 'Ventes', 'income')`);
      const ve = (await q(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VE', 'Ventes', 'sales') returning id::text as id`)).rows[0].id as string;
      const fy = (await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31') returning id::text as id`)).rows[0].id as string;
      // Nomi's own posted entry, in March: in the books, whatever the window does later
      const e = (await q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by)
        values (current_business_id(), $1, $2, '2026-03-10', 'Facture 2026-002', 'owner') returning id::text as id`, [ve, fy])).rows[0].id as string;
      await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit)
        select current_business_id(), $1, 1, id, 'MAD', 125, 0 from accounts where code = '3421'`, [e]);
      await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit)
        select current_business_id(), $1, 2, id, 'MAD', 0, 125 from accounts where code = '7111'`, [e]);
      await q(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = 'F-2026-002', document_date = entry_date where id = $1`, [e]);
      return fy;
    });
    // The books open on 2026-04-01: the year is 2026, locked to the end of March.
    await admin.query(`update fiscal_years set lock_date = '2026-03-31' where business_id = $1 and '2026-03-31' between starts_on and ends_on`, [BIZ]);
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { documentStoresFrom } = await import('../../src/db/documents.js');
    const { deriveKey } = await import('../../src/security/credentials.js');
    const { excelConnector } = await import('../../src/books/connectors/excel.js');
    excel = excelConnector('MAD');
    db = createDb(DATABASE_URL!);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      documents: documentStoresFrom({ DOCUMENT_STORES: JSON.stringify({ default: 'database' }) }, deriveKey('e'.repeat(64))),
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    owner = cookieOf(await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
  }, 60_000);
  afterAll(async () => {
    await app?.close(); await db?.destroy(); await tenant?.end();
    await purgeBusinesses(admin, [BIZ], 'history-kept-test');
    await admin?.end();
  });

  it('A READ REFUSED KEEPS NOTHING: an entry after the window (no year holds it) stops the read, and no file is kept', async () => {
    const r = await upload(await workbook([entry('h-1', '2025-06-10', 'Facture 2025-118', '900'), entry('late-1', '2027-02-01', 'Trop tard', '10')]));
    expect(r.statusCode).toBe(422);
    expect(await entriesHeld()).toBe(1);
    expect((await one(`select count(*)::int as n from documents where business_id = $1`, [BIZ])).n).toBe(0);
  });

  it('AN OUT-OF-WINDOW IMPORT KEEPS ITS FILE: the entries inside go in as drafts; those before the window go nowhere in the books', async () => {
    sent = await workbook([
      entry('h-1', '2025-06-10', 'Facture 2025-118', '900'),     // before any year: history
      entry('h-2', '2026-02-15', 'Facture 2026-007', '450'),     // in the year, but locked: history
      entry('in-1', '2026-05-05', 'Facture 2026-031', '300'),    // inside the window
    ]);
    const r = await upload(sent);
    expect(r.statusCode).toBe(302);
    const at = /^\/app\/books\/papers\/([0-9a-f-]{36})$/.exec(String(r.headers['location']));
    expect(at, String(r.headers['location'])).not.toBeNull();
    docId = at![1]!;
    expect(await flashOf(r)).toContain('Entries dated before these books are not in them (2): the workbook is kept here, with the papers, as history.');
    // Nomi's own March entry, in the workbook too, is in the books and stays so: never history, though before the window
    const rows = (await admin.query(`select entry_date::text as d, label, state from journal_entries where business_id = $1 order by entry_date`, [BIZ])).rows;
    expect(rows).toEqual([{ d: '2026-03-10', label: 'Facture 2026-002', state: 'posted' }, { d: '2026-05-05', label: 'Facture 2026-031', state: 'draft' }]);
    const doc = await one(`select name, media_type, entry_id, history_entries, history_through::text as through, keep_until::text as keep, sha256
      from documents where id = $1`, [docId]);
    expect(doc).toEqual({ name: 'grand-livre-2025.xlsx', media_type: XLSX, entry_id: null, history_entries: 2, through: '2026-02-15',
      keep: '2036-12-31', sha256: createHash('sha256').update(sent).digest('hex') });   // 2026's end + Morocco's ten years (CGI art. 211)
    // and the history entries are not remembered as read: nothing of them is held anywhere in the books
    expect((await one(`select count(*)::int as n from connector_records where business_id = $1 and kind = 'entry' and key in ('h-1', 'h-2')`, [BIZ])).n).toBe(0);
  });

  it('THE FILE IS DOWNLOADABLE, as it was sent', async () => {
    const r = await get(`/app/books/papers/${docId}/file`);
    expect(r.statusCode).toBe(200);
    expect(String(r.headers['content-type'])).toContain(XLSX);
    expect(createHash('sha256').update(r.rawPayload).digest('hex')).toBe(createHash('sha256').update(sent).digest('hex'));
  });

  it('IT IS VISIBLY MARKED, and never read into an entry — by the page, the route and the database', async () => {
    const list = (await get('/app/books/papers')).body;
    expect(list).toContain('grand-livre-2025.xlsx');
    expect(list).toContain('History, not in the books');
    const page = (await get(`/app/books/papers/${docId}`)).body;
    expect(page).toContain('History, not in the books');
    expect(page).toContain('2 of its entries are dated before these books open');
    expect(page).toContain('they are not in the books, the trial balance or the FEC');
    expect(page).toContain('Kept until');
    expect(page).not.toContain(`/app/books/papers/${docId}/read`);
    await app.inject({ method: 'POST', url: `/app/books/papers/${docId}/read`, headers: { cookie: owner } });
    expect((await one(`select count(*)::int as n from document_readings where document_id = $1`, [docId])).n).toBe(0);
    await expect(as((q) => q(`insert into document_readings (business_id, document_id, read_by, model_id, prompt_version, outcome, problems)
      values (current_business_id(), $1, 'owner', 'x', 'x', 'unreadable', '[]')`, [docId]))).rejects.toThrow(/history, not in the books/);
    await expect(admin.query(`insert into documents (business_id, entry_id, name, media_type, bytes, sha256, residency, store, key_version, created_by, history_entries, history_through)
      values ($1, (select id from journal_entries where business_id = $1 limit 1), 'x.xlsx', 'application/x', 1, $2, 'default', 'database', 1, 'owner', 1, '2025-01-01')`,
      [BIZ, 'f'.repeat(64)])).rejects.toThrow(/documents_history_shape/);
  });

  it('THE SAME FILE AGAIN is one document; the entry inside is already here', async () => {
    const before = await entriesHeld();
    const r = await upload(sent);
    expect(await flashOf(r)).toContain('Entries dated before these books are not in them (2)');
    expect(String(r.headers['location'])).toBe(`/app/books/papers/${docId}`);
    expect((await one(`select count(*)::int as n from documents where business_id = $1`, [BIZ])).n).toBe(1);
    expect(await entriesHeld()).toBe(before);
  });

  it('THE TRIAL BALANCE AND THE FEC CANNOT SEE IT: only what is in the books, posted, is there', async () => {
    // the draft inside the window, posted by the owner, is what the reports show; the history's 900 and 450 nowhere
    await as((q) => q(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = 'F-2026-031', document_date = entry_date
      where label = 'Facture 2026-031'`));
    expect((await get('/app/books/trial-balance?from=2025-01-01&to=2026-12-31')).statusCode).toBe(200);
    const { trialBalanceOf } = await import('../../src/db/booksReports.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const tb = await withTenantTx(db, BIZ as never, (tx) => trialBalanceOf(tx, BIZ, { from: '2025-01-01', to: '2026-12-31' }));
    // 125 + 300, the two entries in the books: neither the history's 900 nor its 450
    expect(tb.totals.closing).toEqual({ debit: '425', credit: '425' });
    expect(tb.rows.map((r) => [r.code, r.closing])).toEqual([['3421', { debit: '425', credit: '0' }], ['7111', { debit: '0', credit: '425' }]]);
    const fec = (await get(`/app/books/fec/${year}.txt`)).body;
    const lines = fec.split('\r\n').filter(Boolean).slice(1);
    expect(lines).toHaveLength(4);
    expect(fec).toContain('Facture 2026-031');
    expect(fec).not.toMatch(/Facture 2025-118|Facture 2026-007/);
  });

  it('THE DATA PAGE SAYS IT IS KEPT LONGER, in plain words: a file kept whole, until its newest entry\'s date (the owner, 2026-10-23)', async () => {
    const data = (await get('/app/settings/data')).body;
    expect(data).toContain('id="papers"');
    expect(data).toContain('Files imported as history are kept whole, until the date their newest entry requires. A file cannot be split, so its older entries are kept longer than their own date would need');
    // its own date: the file's newest entry is 2026-02-15, so all of it waits for 2036, h-1's 2025 included
    expect((await one(`select keep_until::text as k from documents where id = $1`, [docId])).k).toBe('2036-12-31');
  });

  it('ERASURE REACHES IT: the papers copy carries it, marked; closure holds it to its date; the retention tool takes it after', async () => {
    const { closeWorkspace } = await import('../../src/api/web/erasure.js');
    const ownerId = (await one(`select id::text as id from people where business_id = $1 and is_owner`, [BIZ])).id;
    expect(await closeWorkspace(db, BIZ, NAME, ownerId)).toEqual({ outcome: 'papers_first' });
    // the owner's copies: the books, then the papers — whose index says which file is history
    expect((await get('/app/settings/data/books.csv')).statusCode).toBe(200);
    const zip = await get('/app/settings/data/papers.zip');
    expect(zip.statusCode).toBe(200);
    const index = indexOf(zip.rawPayload).replace(/^\uFEFF/, '').trim().split(/\r?\n/).map((l) => l.split(','));
    expect(index[0]!.at(-1)).toBe('history_through');
    expect(index.slice(1).map((r) => [r[2], r.at(-1)])).toEqual([['grand-livre-2025.xlsx', '2026-02-15']]);
    expect((await closeWorkspace(db, BIZ, NAME, ownerId)).outcome).toBe('closed');
    const biz = await one(`select is_active, books_held_until::text as until from businesses where id = $1`, [BIZ]);
    expect(biz.is_active).toBe(false);
    expect(biz.until >= '2036-12-31').toBe(true);
    expect((await one(`select count(*)::int as n from documents where id = $1`, [docId])).n).toBe(1);
    // the date passes: the operator's tool erases the held books, and the history with them
    await admin.query(`update businesses set books_held_until = current_date - 1 where id = $1`, [BIZ]);
    const done = spawnSync(process.execPath, ['tools/books-retention.mjs', '--yes', '--by', 'history-kept-test'], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, MIGRATE_DATABASE_URL: ADMIN_URL ?? '' } });
    expect(done.status, done.stderr).toBe(0);
    expect((await one(`select count(*)::int as n from documents where id = $1`, [docId])).n).toBe(0);
    expect((await one(`select count(*)::int as n from document_blobs where document_id = $1`, [docId])).n).toBe(0);
  });
});
