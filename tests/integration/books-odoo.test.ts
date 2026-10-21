import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { sql } from 'kysely';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';
import { odooFake } from '../books-connectors/odoo-fake.js';
import { SAMPLE_BOOKS } from '../books-connectors/sample.js';

/**
 * B4 (Phase 5) — the done-criterion (PHASE-5.md §4), through the real routes against a recorded Odoo 19 fake.
 * Item 15: a Free or Standard plan, a wrong key and a wrong database each give their own sentence before anything is
 * saved. Item 14: a key 80 days old raises the reminder, and an expired key stops the sync with that reason.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `b4b40000-0000-4000-8000-${RUN}0001`;
const CODE = `odoo-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const FORM = (o: Record<string, string> = {}) =>
  new URLSearchParams({ url: 'https://shop.odoo.com', database: 'shop-db', key: 'good-key', expires: inDays(60), ...o }).toString();

d('B4 · the shop\'s own Odoo, through the routes (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  const odoo = odooFake();
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const notice = async (r: { headers: Record<string, unknown> }) => {
    const set = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).join('; ');
    return (await app.inject({ method: 'GET', url: String(r.headers['location']).split('#')[0]!, headers: { cookie: `${owner}; ${set}` } })).body;
  };
  const post = (url: string, body = '') => app.inject({ method: 'POST', url, payload: body,
    headers: { cookie: owner, 'content-type': 'application/x-www-form-urlencoded' } });
  const saved = async () => ({
    connections: (await admin.query(`select count(*)::int as n from books_connections where business_id = $1`, [BIZ])).rows[0].n,
    keys: (await admin.query(`select count(*)::int as n from connector_credentials where business_id = $1`, [BIZ])).rows[0].n,
  });
  const home = async () => (await app.inject({ method: 'GET', url: '/app/books', headers: { cookie: owner } })).body;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL });
    await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Odoo ${RUN}`]);
    await as((q) => q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31')`));
    odoo.publish(SAMPLE_BOOKS);
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
      credentialKey: randomBytes(32), odooPost: odoo.post,
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const r = await app.inject({ method: 'POST', url: '/login', payload: `code=${CODE}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    owner = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session='))!;
  });
  afterAll(async () => {
    await app?.close(); await db?.destroy(); await tenant?.end();
    await purgeBusinesses(admin, [BIZ], 'books-odoo-test');
    await admin?.end();
  });

  it('the form asks for the address, the name, the key and the day it ends — and names the Custom plan', async () => {
    const page = await home();
    expect(page).toContain('action="/app/books/odoo/connect"');
    expect(page).toMatch(/<input type="password" name="key" required autocomplete="off"/);
    expect(page).toContain('It needs Odoo\'s Custom plan');
  });

  it('ITEM 15: a wrong key, a wrong name, a Standard plan, a private address — each its own sentence, nothing saved', async () => {
    expect(await notice(await post('/app/books/odoo/connect', FORM({ key: 'bad-key' })))).toContain('Odoo was not connected. Odoo did not accept the sign-in.');
    expect(await notice(await post('/app/books/odoo/connect', FORM({ database: 'other' })))).toContain('Odoo was not connected. No Odoo of that name answers at this address.');
    odoo.plan('standard');
    expect(await notice(await post('/app/books/odoo/connect', FORM()))).toMatch(/Odoo was not connected\. Odoo(&#39;|&#x27;|')s Free and Standard plans have no external access; it needs the Custom plan\./);
    odoo.plan('custom');
    expect(await notice(await post('/app/books/odoo/connect', FORM({ url: 'https://192.168.1.20' })))).toContain('That is not the https address of an Odoo on the internet.');
    expect(await notice(await post('/app/books/odoo/connect', FORM({ expires: inDays(-1) })))).toContain('The Odoo key has expired');
    expect(await saved()).toEqual({ connections: 0, keys: 0 });
  });

  it('CONNECTED, then READ IN: the key sealed; the books arrive, entries as drafts; read again, nothing new', async () => {
    expect(await notice(await post('/app/books/odoo/connect', FORM()))).toContain('Odoo is connected.');
    const sealed = (await admin.query(`select secret_ciphertext from connector_credentials where business_id = $1 and connector = 'odoo' and archived_at is null`, [BIZ])).rows[0].secret_ciphertext as string;
    expect(sealed).not.toContain('good-key');
    // C0 — Odoo gives its VAT no start date: April's sale cannot use it until the owner says when it took effect.
    const first = await post('/app/books/odoo/read');
    expect(first.statusCode).toBe(422);
    expect(first.body).toContain('has no start date in Odoo, and Nomi counts it only from the day it was first read');
    expect(first.body).toMatch(/<input type="hidden" name="code" value="ODOO-1" \/>/);
    expect((await as((q) => q(`select count(*)::int as n from tax_codes`))).rows[0].n).toBe(0);   // nothing read, no guessed date
    expect(await notice(await post('/app/books/taxes/start', 'system=odoo&code=ODOO-1&from=2099-01-01'))).toContain('That is not a day on or before today.');
    expect(await notice(await post('/app/books/taxes/start', 'system=odoo&code=ODOO-1&from=2026-01-01'))).toContain('The day is kept.');
    const r = await post('/app/books/odoo/read');
    expect(await notice(r)).toMatch(/Read in: 1[0-9] new, 0 replaced, 0 already here\./);
    expect((await as((q) => q(`select code, valid_from::text as d from tax_codes`))).rows).toEqual([{ code: 'ODOO-1', d: '2026-01-01' }]);
    const entries = await as((q) => q(`select state, count(*)::int as n from journal_entries group by state`));
    expect(entries.rows).toEqual([{ state: 'draft', n: 3 }]);
    expect((await as((q) => q(`select cursor from books_connections where system = 'odoo'`))).rows[0].cursor).toMatch(/^2026-10-22 /);
    expect(await notice(await post('/app/books/odoo/read'))).toMatch(/Read in: 0 new, 0 replaced, \d+ already here\./);
  });

  it('ITEM 14: 80 days into a key\'s life, the page asks for a new one', async () => {
    expect(await home()).not.toContain('Key ends soon');
    await admin.query(`update books_connections set connected_at = now() - interval '80 days' where business_id = $1 and system = 'odoo'`, [BIZ]);
    // the day it was connected is read in UTC, as the app counts today — whatever zone the database session is in
    // (a session at +08:00 made it a day short between midnight and 08:00 there, 2026-10-22)
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { loadConnection } = await import('../../src/db/booksConnections.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    for (const zone of ['Asia/Shanghai', 'America/Los_Angeles']) {
      const c = await withTenantTx(db, b.value, async (tx) => {
        await sql`select set_config('timezone', ${zone}, true)`.execute(tx);
        return loadConnection(tx, Buffer.alloc(32), b.value, 'odoo');
      });
      const utc = (await admin.query(`select to_char((now() - interval '80 days') at time zone 'UTC', 'YYYY-MM-DD') as d`)).rows[0].d as string;
      expect([zone, c!.connectedAt.slice(0, 10), c!.connectedAt.endsWith('Z')]).toEqual([zone, utc, true]);
    }
    const page = await home();
    expect(page).toContain('Key ends soon');
    expect(page).toContain('Make a new one in Odoo and connect again before then.');
  });

  it('ITEM 14: on its end the sync stops with that reason, and Odoo is not called with it again', async () => {
    await admin.query(`update books_connections set key_expires_on = (now() at time zone 'UTC')::date where business_id = $1 and system = 'odoo'`, [BIZ]);
    const calls = odoo.calls.length;
    expect(await notice(await post('/app/books/odoo/read'))).toContain('Nothing was read from Odoo. The Odoo key has expired, so reading stopped.');
    expect(odoo.calls.length).toBe(calls);
    expect((await as((q) => q(`select state, reason from books_connections where system = 'odoo'`))).rows[0]).toEqual({ state: 'stopped', reason: 'key_expired' });
    const page = await home();
    expect(page).toContain('Needs connecting again');
    expect(page).toContain('action="/app/books/odoo/connect"');
  });

  it('a new key connects again; disconnecting asks first and forgets the key', async () => {
    expect(await notice(await post('/app/books/odoo/connect', FORM()))).toContain('Odoo is connected.');
    expect(await home()).toMatch(/onclick="return confirm\(this\.dataset\.confirm\)" data-confirm="Disconnect Odoo\?/);
    expect(await notice(await post('/app/books/odoo/disconnect'))).toContain('Disconnected. Nothing changed in Odoo.');
    expect((await admin.query(`select count(*)::int as n from connector_credentials where business_id = $1 and connector = 'odoo' and archived_at is null`, [BIZ])).rows[0].n).toBe(0);
  });
});
