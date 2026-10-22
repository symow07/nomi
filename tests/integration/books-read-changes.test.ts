import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';
import { odooFake } from '../books-connectors/odoo-fake.js';
import { SAMPLE_BOOKS } from '../books-connectors/sample.js';

/**
 * B5 (Phase 5; item 13, part 1) — the done-criterion (PHASE-5.md §4): the same change read twice is recorded once;
 * the cursor survives a restart; a silent system is said on the page. And the morning's read reads every connected
 * system whose books are shown — and no other.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `b5b50000-0000-4000-8000-${RUN}0001`;
const HIDDEN = `b5b50000-0000-4000-8000-${RUN}0002`;    // its books not shown: the morning passes it by
const HOST = `morning-${RUN}.odoo.com`;
const CODE = `read-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const KEY = randomBytes(32);

d('B5 · reading changes (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let tenant: pg.Client;
  let db: import('../../src/db/client.js').Db;
  let read: typeof import('../../src/books/readIn.js');
  const odoo = odooFake(HOST);
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const deps = () => ({ db, credentialKey: KEY, odoo: { post: odoo.post, today: () => new Date().toISOString().slice(0, 10) } });
  const counts = () => as(async (q) => ({
    entries: (await q(`select count(*)::int as n from journal_entries where state <> 'discarded'`)).rows[0].n,
    records: (await q(`select count(*)::int as n from connector_records where system = 'odoo'`)).rows[0].n,
  }));

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL });
    await tenant.connect();
    for (const [id, shown] of [[BIZ, true], [HIDDEN, false]] as const) {
      await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', $3)`, [id, `Read ${RUN}`, shown]);
      await asTenant(tenant, id, (q) => q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31')`));
    }
    odoo.publish(SAMPLE_BOOKS);
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { saveConnection } = await import('../../src/db/booksConnections.js');
    read = await import('../../src/books/readIn.js');
    db = createDb(DATABASE_URL!);
    for (const id of [BIZ, HIDDEN]) {
      // C0 — the owner has confirmed when Odoo's VAT took effect (Odoo gives no date): the sample's April entries may use it.
      await admin.query(`insert into tax_start_dates (business_id, system, code, valid_from, confirmed_by) values ($1, 'odoo', 'ODOO-1', '2026-01-01', 'owner')`, [id]);
      const bid = parseBusinessId(id); if (!bid.ok) throw new Error('fixture');
      await withTenantTx(db, bid.value, (tx) => saveConnection(tx, KEY, { businessId: id, system: 'odoo', secret: 'good-key', by: 'owner',
        settings: { url: `https://${HOST}`, database: 'shop-db' }, keyExpiresOn: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10) }));
    }
  });
  afterAll(async () => {
    await db?.destroy(); await tenant?.end();
    await purgeBusinesses(admin, [BIZ, HIDDEN], 'books-read-changes-test');
    await admin?.end();
  });

  it('THE SAME CHANGE READ TWICE IS RECORDED ONCE', async () => {
    const first = await read.readConnectedSystem(deps(), BIZ, 'odoo', 'owner');
    expect(first).toMatchObject({ kind: 'read', replaced: 0, unchanged: 0 });
    const after = await counts();
    expect(after.entries).toBe(3);
    const again = await read.readConnectedSystem(deps(), BIZ, 'odoo', 'owner');
    expect(again).toMatchObject({ kind: 'read', added: 0, replaced: 0 });
    expect(await counts()).toEqual(after);
    // one entry changed in Odoo: that one, once — its draft replaced, nothing else
    odoo.publish({ ...SAMPLE_BOOKS, entries: SAMPLE_BOOKS.entries.map((e) => (e.key === 'row-17' ? { ...e, label: 'BL 311, corrigé' } : e)) });
    expect(await read.readConnectedSystem(deps(), BIZ, 'odoo', 'owner')).toMatchObject({ kind: 'read', added: 0, replaced: 1 });
    expect(await read.readConnectedSystem(deps(), BIZ, 'odoo', 'owner')).toMatchObject({ kind: 'read', added: 0, replaced: 0 });
    expect((await as((q) => q(`select label, state from journal_entries where label like 'B%311%' order by state`))).rows)
      .toEqual([{ label: 'Bon de livraison 311', state: 'discarded' }, { label: 'BL 311, corrigé', state: 'draft' }]);
  });

  it('THE CURSOR SURVIVES A RESTART: a new process reads on from the stored cursor, not from the start', async () => {
    const stored = (await as((q) => q(`select cursor from books_connections where system = 'odoo'`))).rows[0].cursor as string;
    expect(stored).toMatch(/^2026-10-22 /);
    const { createDb } = await import('../../src/db/client.js');
    const fresh = createDb(DATABASE_URL!);   // nothing held in memory: only what the database kept
    try {
      const before = odoo.moveDomains.length;
      await read.readConnectedSystem({ ...deps(), db: fresh }, BIZ, 'odoo', 'owner');
      expect(odoo.moveDomains.slice(before)).toEqual([JSON.stringify([['state', 'in', ['draft', 'posted']], ['write_date', '>', stored]])]);
    } finally { await fresh.destroy(); }
  });

  it('A READ REFUSED FOR ITS PROBLEMS moves no cursor: the same entries are read again once fixed', async () => {
    const stored = (await as((q) => q(`select cursor from books_connections where system = 'odoo'`))).rows[0].cursor as string;
    // An entry after every fiscal year: a problem to fix. (One BEFORE the books is history since E3, 0207: left in Odoo.)
    odoo.publish({ ...SAMPLE_BOOKS, entries: [...SAMPLE_BOOKS.entries, { ...SAMPLE_BOOKS.entries[1]!, key: 'AC-2027-9', date: '2027-06-01' }] });
    expect(await read.readConnectedSystem(deps(), BIZ, 'odoo', 'owner')).toMatchObject({ kind: 'problems' });
    expect((await as((q) => q(`select cursor from books_connections where system = 'odoo'`))).rows[0].cursor).toBe(stored);
  });

  it('A SILENT SYSTEM IS SAID ON THE PAGE, with the day it last answered', async () => {
    const { registerWebApp } = await import('../../src/api/web/app.js');
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    const app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {}, credentialKey: KEY, odooPost: odoo.post,
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    try {
      const login = await app.inject({ method: 'POST', url: '/login', payload: `code=${CODE}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      const cookie = ([] as string[]).concat((login.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session='))!;
      const page = async () => (await app.inject({ method: 'GET', url: '/app/books', headers: { cookie } })).body;
      expect(await page()).not.toContain('Not answering');
      await admin.query(`update books_connections set last_ok_at = now() - interval '3 days' where business_id = $1 and system = 'odoo'`, [BIZ]);
      const silent = await page();
      expect(silent).toContain('Not answering');
      expect(silent).toMatch(/Odoo has not been read since [^.]+\. Nomi reads it every morning/);
    } finally { await app.close(); }
  });

  it('THE MORNING READ reads every connected system whose books are shown — and no other', async () => {
    const due = (await admin.query(`select business_id::text as b, system from books_connections_due() where business_id = any($1)`, [[BIZ, HIDDEN]])).rows;
    expect(due).toEqual([{ b: BIZ, system: 'odoo' }]);
    const before = (await admin.query(`select last_read_at from books_connections where business_id = $1`, [HIDDEN])).rows[0].last_read_at;
    await read.readEveryConnectedSystem(deps());
    expect((await admin.query(`select last_read_at from books_connections where business_id = $1`, [HIDDEN])).rows[0].last_read_at).toEqual(before);
    expect((await admin.query(`select last_read_at > now() - interval '1 minute' as fresh from books_connections where business_id = $1`, [BIZ])).rows[0].fresh).toBe(true);
    // what the morning made is Nomi's draft, like the owner's read: nothing posted
    expect((await as((q) => q(`select count(*)::int as n from journal_entries where state = 'posted'`))).rows[0].n).toBe(0);
  });
});
