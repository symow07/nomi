import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';
import { qboFake, QBO_CLIENT } from '../books-connectors/quickbooks-fake.js';
import { SAMPLE_BOOKS } from '../books-connectors/sample.js';

/**
 * D9 (Phase 5; items 12 and 13) — the shop's own QuickBooks Online through the real routes, against the recorded fake
 * of Intuit's documented answers: connecting on Intuit's own page (the company by its realmId), reading in, C4's
 * write-back never over anything, the refresh token that changes each day kept, and a company whose subscription
 * ended said for what it is. Live on deploy day, on the Builder tier.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `d9d90000-0000-4000-8000-${RUN}0001`;
const CODE = `qbo-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const KEY = randomBytes(32);
// QuickBooks' own company: its taxes are not read, so no line there names a tax code
const BOOKS = { ...SAMPLE_BOOKS, taxCodes: [], entries: SAMPLE_BOOKS.entries.map((e) => ({ ...e, lines: e.lines.map((l) => ({ ...l, taxCode: null })) })) };

d('D9 · the shop\'s own QuickBooks (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let accountant = '';
  const qbo = qboFake();
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const cookiesOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!);
  const session = (r: { headers: Record<string, unknown> }) => cookiesOf(r).find((c) => c.startsWith('yf_session=')) ?? '';
  const notice = async (r: { headers: Record<string, unknown> }) => {
    const to = String(r.headers['location']).split('#')[0]!;
    return (await app.inject({ method: 'GET', url: to, headers: { cookie: `${owner}; ${cookiesOf(r).join('; ')}` } })).body;
  };
  const press = (url: string) => app.inject({ method: 'POST', url, headers: { cookie: owner } });
  const home = async (who = owner) => (await app.inject({ method: 'GET', url: '/app/books', headers: { cookie: who } })).body;
  const held = async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { loadConnection } = await import('../../src/db/booksConnections.js');
    return withTenantTx(db, BIZ as never, (tx) => loadConnection(tx, KEY, BIZ, 'quickbooks'));
  };
  const postEntry = (label: string, party: string | null = 'C001') => as(async (q) => {
    const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0];
    const j = (await one(`select id::text as id from journals where code = 'QBO'`)).id;
    const fy = (await one(`select id::text as id from fiscal_years limit 1`)).id;
    const e = (await one(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by)
      values (current_business_id(), $1, $2, '2026-04-20', $3, 'owner') returning id::text as id`, [j, fy, label])).id;
    let n = 0;
    for (const [acc, p, dr, cr] of [['3421', party, '75', '0'], ['7111', null, '0', '75']] as const) {
      await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, party_id, currency, debit, credit)
        values (current_business_id(), $1, $2, (select id from accounts where code = $3), (select id from parties where code = $4), 'MAD', $5, $6)`, [e, ++n, acc, p, dr, cr]);
    }
    await q(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = $2, document_date = entry_date where id = $1`, [e, label]);
  });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `QuickBooks ${RUN}`]);
    await as((q) => q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31')`));
    qbo.publish(BOOKS);
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
      publicBaseUrl: 'https://app.example', credentialKey: KEY, oauthFetch: qbo.fetch, qboClient: QBO_CLIENT,
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = (code: string) => app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    owner = session(await login(CODE));
    const acct = await addPerson(db, BIZ, SECRET, `Accountant ${RUN}`, 'accountant');
    if (acct.code !== 'added') throw new Error('fixture');
    accountant = session(await login(acct.accessCode));
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-quickbooks-test'); await admin?.end(); });

  it('CONNECT: Intuit\'s page; back here, the state checked, the company by its realmId, the grant sealed', async () => {
    expect(await home()).toContain('href="/app/books/quickbooks/start"');
    expect(await home(accountant)).not.toContain('/app/books/quickbooks/');
    const start = await app.inject({ method: 'GET', url: '/app/books/quickbooks/start', headers: { cookie: owner } });
    const to = new URL(String(start.headers['location']));
    expect(to.origin).toBe('https://appcenter.intuit.com');
    expect(to.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting');
    const state = cookiesOf(start).find((c) => c.startsWith('yf_qbo_oauth='))!;
    const back = (code: string, realmId: string, nonce = to.searchParams.get('state')!) => app.inject({ method: 'GET',
      url: `/app/books/quickbooks/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(nonce)}&realmId=${realmId}`, headers: { cookie: `${owner}; ${state}` } });
    const { code, realmId } = qbo.code();
    expect(await notice(await back(code, realmId, 'not-this-browser'))).toContain('QuickBooks was not connected.');
    expect(await held()).toBeNull();
    const again = await app.inject({ method: 'GET', url: '/app/books/quickbooks/start', headers: { cookie: owner } });
    const s2 = cookiesOf(again).find((c) => c.startsWith('yf_qbo_oauth='))!;
    const n2 = new URL(String(again.headers['location'])).searchParams.get('state')!;
    const ok = await app.inject({ method: 'GET', url: `/app/books/quickbooks/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(n2)}&realmId=${realmId}`,
      headers: { cookie: `${owner}; ${s2}` } });
    expect(await notice(ok)).toContain('QuickBooks is connected to Westlake Canvas Co.');
    expect(await held()).toMatchObject({ state: 'connected', settings: { companyName: 'Westlake Canvas Co.' } });
    // R4 (item 1) — the realmId is sealed with the grant: not in the settings, nowhere in the clear in the database
    expect((await held())!.settings).not.toHaveProperty('realmId');
    expect(JSON.parse((await held())!.grant!.secret)).toMatchObject({ realm: realmId });
    const raw = (await admin.query(`select c.settings::text as settings, k.secret_ciphertext as sealed from books_connections c
      join connector_credentials k on k.id = c.credential_id where c.business_id = $1 and c.system = 'quickbooks'`, [BIZ])).rows[0];
    expect(raw.settings).not.toContain(realmId);
    expect(raw.sealed.startsWith('v1.')).toBe(true);
    expect(raw.sealed).not.toContain(realmId);
    expect(await home()).toContain('<bdi>Westlake Canvas Co.</bdi>');
  });

  it('READ IN: the books arrive as drafts in QuickBooks\' one journal; a day later, the new refresh token is the one kept', async () => {
    expect(await notice(await press('/app/books/quickbooks/read'))).toMatch(/Read in: \d+ new/);
    const entries = await as(async (q) => (await q(`select e.label, e.state, j.code from journal_entries e join journals j on j.id = e.journal_id order by e.label`)).rows);
    expect(entries).toEqual([{ label: 'Bon de livraison 311', state: 'draft', code: 'QBO' }, { label: 'Facture F-2026-0042', state: 'draft', code: 'QBO' }]);
    const parent = await as(async (q) => (await q(`select p.code from accounts a join accounts p on p.id = a.parent_id where a.code = '71111'`)).rows[0]?.code);
    expect(parent).toBe('7111');
    const before = (await held())!.grant!.secret;
    expect(await notice(await press('/app/books/quickbooks/read'))).toContain('0 new');
    expect((await held())!.grant!.secret).toBe(before);   // the same day: the same token, nothing rotated
    qbo.nextDay();
    expect(await notice(await press('/app/books/quickbooks/read'))).toContain('0 new');
    const after = (await held())!.grant!.secret;
    expect(after).not.toBe(before);
    // a day later the access token had ended: the 401 was refreshed once, and the refresh token Intuit returned kept
    expect(qbo.liveRefresh()).toEqual([(JSON.parse(after) as { r: string }).r]);
  });

  it('WRITE BACK: a posted entry of Nomi\'s becomes a journal entry numbered by Nomi; never read back in, never sent twice; a conflict waits', async () => {
    await postEntry(`Vente comptoir ${RUN}`);
    expect(await notice(await press('/app/books/quickbooks/write'))).toContain('Written: 1.');
    expect(qbo.created).toHaveLength(1);
    expect(qbo.created[0]!.body).toMatchObject({ TxnDate: '2026-04-20', GlobalTaxCalculation: 'TaxExcluded' });
    expect(await notice(await press('/app/books/quickbooks/read'))).toContain('0 new');
    expect(await notice(await press('/app/books/quickbooks/write'))).toContain('Written: 0.');
    await as((q) => q(`insert into parties (business_id, code, name, kind) values (current_business_id(), 'C077', 'Souk Sacs', 'customer')`));
    await postEntry(`Vente Souk ${RUN}`, 'C077');
    const r = await press('/app/books/quickbooks/write');
    expect(r.statusCode).toBe(409);
    expect(r.body).toContain('no customer or vendor in QuickBooks has the code C077.');
    expect(qbo.created).toHaveLength(1);
  });

  it('R4 (items 10, 12) — CONNECT, DISCONNECT, CONNECT AGAIN: each works, against the fake (Intuit\'s sandbox waits on an account)', async () => {
    const connect = async () => {
      const start = await app.inject({ method: 'GET', url: '/app/books/quickbooks/start', headers: { cookie: owner } });
      const st = cookiesOf(start).find((c) => c.startsWith('yf_qbo_oauth='))!;
      const nonce = new URL(String(start.headers['location'])).searchParams.get('state')!;
      const { code, realmId } = qbo.code();
      return app.inject({ method: 'GET', url: `/app/books/quickbooks/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(nonce)}&realmId=${realmId}`,
        headers: { cookie: `${owner}; ${st}` } });
    };
    // connected since the first test: disconnect, connect, disconnect, connect again — each grant given back at Intuit
    expect(await notice(await press('/app/books/quickbooks/disconnect'))).toContain('Disconnected.');
    expect(qbo.liveRefresh()).toEqual([]);
    expect(await notice(await connect())).toContain('QuickBooks is connected to Westlake Canvas Co.');
    expect(await held()).toMatchObject({ state: 'connected' });
    expect(await notice(await press('/app/books/quickbooks/disconnect'))).toContain('Disconnected.');
    expect(await held()).toMatchObject({ state: 'disconnected', grant: null });
    expect(qbo.liveRefresh()).toEqual([]);
    expect(await notice(await connect())).toContain('QuickBooks is connected to Westlake Canvas Co.');
    expect(qbo.liveRefresh()).toHaveLength(1);
    expect(await held()).toMatchObject({ state: 'connected' });
    // Intuit's Disconnect URL: where QuickBooks sends an owner who disconnected Nomi there. It says so, and changes
    // nothing here (a link anyone could open must not disconnect anybody).
    const there = await app.inject({ method: 'GET', url: '/app/books/quickbooks/disconnected', headers: { cookie: owner } });
    expect(there.statusCode).toBe(302);
    expect(await notice(there)).toContain('If you disconnected Nomi in QuickBooks');
    expect(await held()).toMatchObject({ state: 'connected' });
    const stranger = await app.inject({ method: 'GET', url: '/app/books/quickbooks/disconnected' });
    expect([stranger.statusCode, stranger.headers['location']]).toEqual([302, '/login']);
  });

  it('A SUBSCRIPTION THAT ENDED: said for what it is; disconnecting gives the access back', async () => {
    qbo.lapse();
    expect(await notice(await press('/app/books/quickbooks/read'))).toContain('QuickBooks no longer lets Nomi into the company');
    expect(await held()).toMatchObject({ state: 'connect_again', reason: 'source_missing' });
    expect(await notice(await press('/app/books/quickbooks/disconnect'))).toContain('Disconnected. Nothing changed in QuickBooks.');
    expect(qbo.liveRefresh()).toEqual([]);
    expect(await held()).toMatchObject({ state: 'disconnected', grant: null });
  });
});
