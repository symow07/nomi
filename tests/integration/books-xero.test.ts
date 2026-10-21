import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';
import { xeroFake, XERO_CLIENT } from '../books-connectors/xero-fake.js';
import { SAMPLE_BOOKS } from '../books-connectors/sample.js';

/**
 * D8 (Phase 5; items 12 and 13) — the shop's own Xero through the real routes, against the recorded fake of Xero's
 * documented answers: connecting on Xero's own page (the one organisation chosen), reading in (its taxes' start day
 * confirmed by the owner, as Odoo's), C4's write-back never over anything, the grant that ROTATES kept at every call,
 * and a Xero that no longer lets Nomi in said for what it is. Live on deploy day, within the free tier.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `d8d80000-0000-4000-8000-${RUN}0001`;
const CODE = `xero-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const KEY = randomBytes(32);

d('D8 · the shop\'s own Xero (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let accountant = '';
  const xero = xeroFake();
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const cookiesOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!);
  const session = (r: { headers: Record<string, unknown> }) => cookiesOf(r).find((c) => c.startsWith('yf_session=')) ?? '';
  const notice = async (r: { headers: Record<string, unknown> }) => {
    const to = String(r.headers['location']).split('#')[0]!;
    return (await app.inject({ method: 'GET', url: to, headers: { cookie: `${owner}; ${cookiesOf(r).join('; ')}` } })).body;
  };
  const press = (url: string, who = owner, payload?: string) => app.inject({ method: 'POST', url, headers: { cookie: who,
    ...(payload ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, ...(payload ? { payload } : {}) });
  const home = async (who = owner) => (await app.inject({ method: 'GET', url: '/app/books', headers: { cookie: who } })).body;
  const connectXero = async () => {
    const start = await app.inject({ method: 'GET', url: '/app/books/xero/start', headers: { cookie: owner } });
    expect(start.statusCode).toBe(302);
    const to = new URL(String(start.headers['location']));
    const nonce = to.searchParams.get('state')!;
    const state = cookiesOf(start).find((c) => c.startsWith('yf_xero_oauth='))!;
    return { to, nonce, state, back: (code: string, n = nonce) => app.inject({ method: 'GET',
      url: `/app/books/xero/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(n)}`, headers: { cookie: `${owner}; ${state}` } }) };
  };
  /** The grant Nomi holds, opened. */
  const held = async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { loadConnection } = await import('../../src/db/booksConnections.js');
    return withTenantTx(db, BIZ as never, (tx) => loadConnection(tx, KEY, BIZ, 'xero'));
  };
  const postEntry = (label: string, account = '7111') => as(async (q) => {
    const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0];
    const j = (await one(`select id::text as id from journals where code = 'XERO'`)).id;
    const fy = (await one(`select id::text as id from fiscal_years limit 1`)).id;
    const e = (await one(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by, custom)
      values (current_business_id(), $1, $2, '2026-04-20', $3, 'owner', '{}') returning id::text as id`, [j, fy, label])).id;
    let n = 0;
    for (const [acc, party, dr, cr] of [['3421', 'C001', '120.50', '0'], [account, null, '0', '120.50']] as const) {
      await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, party_id, currency, debit, credit)
        values (current_business_id(), $1, $2, (select id from accounts where code = $3), (select id from parties where code = $4), 'MAD', $5, $6)`, [e, ++n, acc, party, dr, cr]);
    }
    await q(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = $2, document_date = entry_date where id = $1`, [e, label]);
  });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Xero ${RUN}`]);
    await as((q) => q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31')`));
    xero.publish(SAMPLE_BOOKS);
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
      publicBaseUrl: 'https://app.example', credentialKey: KEY, oauthFetch: xero.fetch, xeroClient: XERO_CLIENT,
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = (code: string) => app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    owner = session(await login(CODE));
    const acct = await addPerson(db, BIZ, SECRET, `Accountant ${RUN}`, 'accountant');
    if (acct.code !== 'added') throw new Error('fixture');
    accountant = session(await login(acct.accessCode));
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-xero-test'); await admin?.end(); });

  it('CONNECT: Xero\'s own page, the granular scopes; back here, the state checked, the ONE organisation found, the grant sealed', async () => {
    expect(await home()).toContain('href="/app/books/xero/start"');
    expect(await home(accountant)).not.toContain('/app/books/xero/');
    const c = await connectXero();
    expect(c.to.origin).toBe('https://login.xero.com');
    expect(c.to.searchParams.get('redirect_uri')).toBe('https://app.example/app/books/xero/callback');
    // a state that is not this browser's: refused, nothing saved
    expect(await notice(await c.back(xero.code(), 'someone-elses-state'))).toContain('Xero was not connected.');
    expect(await held()).toBeNull();
    // two organisations chosen at once: refused with its reason
    xero.organisations(['Westlake Canvas Co.', 'Westlake Holdings']);
    const two = await connectXero();
    expect(await notice(await two.back(xero.code()))).toContain('more than one organisation at once');
    xero.organisations(['Westlake Canvas Co.']);
    const one = await connectXero();
    expect(await notice(await one.back(xero.code()))).toContain('Xero is connected to Westlake Canvas Co.');
    const conn = await held();
    expect(conn).toMatchObject({ state: 'connected', settings: { tenantName: 'Westlake Canvas Co.' } });
    expect(xero.liveRefresh()).toEqual([conn!.grant!.secret]);
    expect(await home()).toContain('<bdi>Westlake Canvas Co.</bdi>');
  });

  it('READ IN: a tax with no start day waits for the owner\'s; then the books arrive as drafts — and the rotated grant is the one kept', async () => {
    const before = (await held())!.grant!.secret;
    const refused = await press('/app/books/xero/read');
    expect(refused.statusCode).toBe(422);
    expect(refused.body).toContain('Xero keeps no start date for a tax');
    expect(refused.body).toContain('name="system" value="xero"');
    // every call rotated the grant, and what Nomi holds is the one Xero still honours
    const after = (await held())!.grant!.secret;
    expect(after).not.toBe(before);
    expect(xero.liveRefresh()).toEqual([after]);
    expect(await notice(await press('/app/books/taxes/start', owner, 'system=xero&code=TVA20&from=2026-01-01'))).toContain('Read Xero in again.');
    const second = await press('/app/books/xero/read');
    expect(await notice(second)).toMatch(/Read in: \d+ new/);
    const entries = await as(async (q) => (await q(`select e.label, e.state, j.code from journal_entries e join journals j on j.id = e.journal_id order by e.label`)).rows);
    expect(entries).toEqual([{ label: 'Bon de livraison 311', state: 'draft', code: 'XERO' }, { label: 'Facture F-2026-0042', state: 'draft', code: 'XERO' }]);
    expect(await notice(await press('/app/books/xero/read'))).toContain('0 new');
    expect(xero.liveRefresh()).toEqual([(await held())!.grant!.secret]);
  });

  it('WRITE BACK: a posted entry of Nomi\'s becomes a posted manual journal; never read back in as new, never sent twice; a conflict waits', async () => {
    await postEntry(`Vente comptoir ${RUN}`);
    expect(await notice(await press('/app/books/xero/write'))).toContain('Written: 1.');
    expect(xero.created).toHaveLength(1);
    expect(xero.created[0]!.body).toMatchObject({ Status: 'POSTED', Date: '2026-04-20' });
    expect(await notice(await press('/app/books/xero/read'))).toContain('0 new');
    expect(await notice(await press('/app/books/xero/write'))).toContain('Written: 0.');
    // an account Xero does not have: shown, and nothing sent for it
    await as((q) => q(`insert into accounts (business_id, code, name, kind) values (current_business_id(), '7999', 'Ventes diverses', 'income')`));
    await postEntry(`Vente diverse ${RUN}`, '7999');
    const r = await press('/app/books/xero/write');
    expect(r.statusCode).toBe(409);
    expect(r.body).toContain('account 7999 is not in Xero, or is archived there.');
    expect(xero.created).toHaveLength(1);
  });

  it('A XERO THAT NO LONGER LETS NOMI IN: said for what it is; disconnecting gives the access back', async () => {
    xero.disconnect();
    expect(await notice(await press('/app/books/xero/read'))).toContain('Xero no longer lets Nomi into the organisation');
    expect(await held()).toMatchObject({ state: 'connect_again', reason: 'source_missing' });
    expect(await home()).toContain('Needs connecting again');
    xero.organisations(['Westlake Canvas Co.']);
    expect(await notice(await press('/app/books/xero/disconnect'))).toContain('Disconnected. Nothing changed in Xero.');
    expect(xero.liveRefresh()).toEqual([]);
    expect(await held()).toMatchObject({ state: 'disconnected', grant: null });
    // the grants were never deleted: every rotated one is archived
    const kept = await admin.query(`select count(*)::int as n, count(*) filter (where archived_at is null)::int as live from connector_credentials where business_id = $1 and connector = 'xero'`, [BIZ]);
    expect(kept.rows[0].live).toBe(0);
    expect(kept.rows[0].n).toBeGreaterThan(3);
  });
});
