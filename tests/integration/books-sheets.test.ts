import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';
import { googleFake } from '../books-connectors/google-fake.js';

/**
 * B3 (Phase 5, §5 option B) — the done-criterion (PHASE-5.md §4): the same workbook through the API with `drive.file`;
 * a revoked grant reads as "connect again", never as empty books. Through the real routes, against the recorded fake
 * of Google (tests/books-connectors/google-fake.ts); live on deploy day.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `b3b30000-0000-4000-8000-${RUN}0001`;
const CODE = `sheets-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const BASE = 'https://app.example';

d('B3 · the books in Google Sheets, through the routes (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let accountant = '';
  const google = googleFake();
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const cookiesOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!);
  const session = (r: { headers: Record<string, unknown> }) => cookiesOf(r).find((c) => c.startsWith('yf_session=')) ?? '';
  const notice = async (r: { headers: Record<string, unknown> }) => {
    const set = cookiesOf(r).join('; ');
    const to = String(r.headers['location']).split('#')[0]!;
    return (await app.inject({ method: 'GET', url: to, headers: { cookie: `${owner}; ${set}` } })).body;
  };
  const connection = () => as(async (q) => (await q(`select state, reason, settings, credential_id from books_connections where system = 'sheets'`)).rows[0]);
  const connect = async () => {
    const start = await app.inject({ method: 'GET', url: '/app/books/sheets/start', headers: { cookie: owner } });
    expect(start.statusCode).toBe(302);
    const to = new URL(String(start.headers['location']));
    const state = cookiesOf(start).find((c) => c.startsWith('yf_sheets_oauth='))!;
    return { to, state, back: (code: string, nonce = to.searchParams.get('state')!) => app.inject({ method: 'GET',
      url: `/app/books/sheets/callback?code=${code}&state=${encodeURIComponent(nonce)}`, headers: { cookie: `${owner}; ${state}` } }) };
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL });
    await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Sheets ${RUN}`]);
    await as(async (q) => {
      await q(`insert into accounts (business_id, code, name, kind) values (current_business_id(), '3421', 'Clients', 'asset'), (current_business_id(), '7111', 'Ventes', 'income')`);
      await q(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VE', 'Ventes', 'sales')`);
      await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31')`);
    });
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
      publicBaseUrl: BASE, credentialKey: randomBytes(32), oauthFetch: google.fetch,
      sheetsClient: { clientId: 'nomi-test.apps.googleusercontent.com', clientSecret: 'test-secret' },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = (code: string) => app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    owner = session(await login(CODE));
    const acct = await addPerson(db, BIZ, SECRET, `Accountant ${RUN}`, 'accountant');
    if (acct.code !== 'added') throw new Error('fixture');
    accountant = session(await login(acct.accessCode));
  });
  afterAll(async () => {
    await app?.close(); await db?.destroy(); await tenant?.end();
    await purgeBusinesses(admin, [BIZ], 'books-sheets-test');
    await admin?.end();
  });

  it('the owner is offered the door; the accountant is not, and cannot start it', async () => {
    expect((await app.inject({ method: 'GET', url: '/app/books', headers: { cookie: owner } })).body).toContain('href="/app/books/sheets/start"');
    expect((await app.inject({ method: 'GET', url: '/app/books', headers: { cookie: accountant } })).body).not.toContain('/app/books/sheets/');
    const theirs = await app.inject({ method: 'GET', url: '/app/books/sheets/start', headers: { cookie: accountant } });
    expect([theirs.statusCode, theirs.headers['location']]).toEqual([302, '/app/books']);
  });

  it('it asks Google for drive.file and nothing else, with PKCE, offline, to the books\' own callback', async () => {
    const { to } = await connect();
    expect(`${to.origin}${to.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(to.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(to.searchParams.get('access_type')).toBe('offline');
    expect(to.searchParams.get('redirect_uri')).toBe(`${BASE}/app/books/sheets/callback`);
  });

  it('a callback that is not the one this browser started connects nothing', async () => {
    const { back } = await connect();
    expect(await notice(await back('good-code', 'a-state-nobody-minted'))).toContain('Google Sheets was not connected.');
    expect(await connection()).toBeUndefined();
  });

  it('CONNECTED: a new spreadsheet holds the books; the grant is kept sealed, never as it came', async () => {
    const { back } = await connect();
    expect(await notice(await back('good-code'))).toContain('Google Sheets is connected, and the new spreadsheet holds your books.');
    const c = await connection();
    expect(c.state).toBe('connected');
    expect(c.settings.url).toBe(`https://docs.google.com/spreadsheets/d/${c.settings.spreadsheetId}/edit`);
    const sealed = (await admin.query(`select secret_ciphertext from connector_credentials where id = $1`, [c.credential_id])).rows[0].secret_ciphertext as string;
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('refresh-token');
    const home = (await app.inject({ method: 'GET', url: '/app/books', headers: { cookie: owner } })).body;
    expect(home).toContain(`href="${c.settings.url}"`);
    expect(home).toContain('action="/app/books/sheets/read"');
  });

  it('READ IN: what the owner added in Sheets arrives; read again, nothing new', async () => {
    const c = await connection();
    google.type(c.settings.spreadsheetId, 'Parties', 2, 1, 'C001');
    google.type(c.settings.spreadsheetId, 'Parties', 2, 2, 'Atlas Textiles SARL');
    google.type(c.settings.spreadsheetId, 'Parties', 2, 3, 'customer');
    const r = await app.inject({ method: 'POST', url: '/app/books/sheets/read', headers: { cookie: owner } });
    expect(await notice(r)).toContain('Read in: 1 new, 0 replaced, 3 already here.');
    expect((await as((q) => q(`select code, name from parties`))).rows).toEqual([{ code: 'C001', name: 'Atlas Textiles SARL' }]);
    const again = await app.inject({ method: 'POST', url: '/app/books/sheets/read', headers: { cookie: owner } });
    expect(await notice(again)).toContain('Read in: 0 new, 0 replaced, 4 already here.');
  });

  it('A REVOKED GRANT reads as "connect again" — never as empty books — and the page says so', async () => {
    const before = (await as((q) => q(`select count(*)::int as n from parties`))).rows[0].n;
    google.revoke();
    const r = await app.inject({ method: 'POST', url: '/app/books/sheets/read', headers: { cookie: owner } });
    expect(await notice(r)).toContain('Google Sheets needs connecting again. Nothing was read; your books here are unchanged.');
    expect(await connection()).toMatchObject({ state: 'connect_again', reason: 'revoked' });
    expect((await as((q) => q(`select count(*)::int as n from parties`))).rows[0].n).toBe(before);
    const home = (await app.inject({ method: 'GET', url: '/app/books', headers: { cookie: owner } })).body;
    expect(home).toContain('Needs connecting again');
    expect(home).toContain('The access to Google Sheets was withdrawn or has expired.');
    expect(home).not.toContain('action="/app/books/sheets/read"');
  });

  it('connecting again goes on; disconnecting archives the grant and asks first', async () => {
    const { back } = await connect();
    await back('good-code');
    expect((await connection()).state).toBe('connected');
    const home = (await app.inject({ method: 'GET', url: '/app/books', headers: { cookie: owner } })).body;
    expect(home).toMatch(/onclick="return confirm\(this\.dataset\.confirm\)" data-confirm="Disconnect Google Sheets\?/);
    const r = await app.inject({ method: 'POST', url: '/app/books/sheets/disconnect', headers: { cookie: owner } });
    expect(await notice(r)).toContain('Disconnected. The spreadsheet stays in your Drive.');
    expect(await connection()).toMatchObject({ state: 'disconnected', credential_id: null });
    const live = (await admin.query(`select count(*)::int as n from connector_credentials where business_id = $1 and connector = 'sheets' and archived_at is null`, [BIZ])).rows[0].n;
    expect(live).toBe(0);
  });
});
