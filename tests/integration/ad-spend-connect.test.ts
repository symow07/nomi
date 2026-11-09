import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { flashSaid } from './tenant.js';
import type { AdsFetch } from '../../src/channels/meta/adSpend.js';

/**
 * 0238 — turning ad spend on, through the real routes, against a Meta that exists only in this file.
 *
 * What only this can prove: the ads login is its own (its configuration, v27.0, never the Page's) and is offered
 * only where the installation has it — without it every route refuses and Meta is never asked; the token is kept
 * sealed; staff are refused every step and shown no figure; the operator's stop refuses the connect; a practice
 * copy is refused a connection by the database itself; another workspace sees nothing; disconnect archives.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `dd560000-0000-4000-8000-${RUN}0001`;
const OTHER = `dd560000-0000-4000-8000-${RUN}0002`;
const COPY = `dd560000-0000-4000-8000-${RUN}0003`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const KEY = Buffer.alloc(32, 7);
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const ADS_CONFIG = '9876543210';

const calls: string[] = [];
const fakeMeta: AdsFetch = async (url) => {
  calls.push(url);
  const u = new URL(url);
  const json = (status: number, body: unknown) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
  if (u.pathname === '/v27.0/oauth/access_token') {
    const p = u.searchParams;
    if (p.get('grant_type') === 'fb_exchange_token') return json(200, { access_token: `ads-long-${RUN}` });
    return p.get('code') === 'CODE_OK' ? json(200, { access_token: `ads-short-${RUN}` }) : json(400, { error: { code: 100 } });
  }
  if (u.pathname === '/v27.0/me/adaccounts') {
    return json(200, { data: [
      { account_id: '111222333', name: 'Shop ads', currency: 'EUR', timezone_name: 'Europe/Paris' },
      { account_id: '444555666', name: 'Old ads', currency: 'USD', timezone_name: 'America/New_York' },
    ] });
  }
  return json(404, { error: { code: 100 } });
};

const bidOf = async (raw: string) => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
};

d('0238 · turning ad spend on (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let bare: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let owner = ''; let staff = ''; let bareOwner = '';
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  const login = async (a: import('fastify').FastifyInstance, code: string) => {
    const res = await a.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM });
    return String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  };
  const get = (a: import('fastify').FastifyInstance, cookie: string, url: string) => a.inject({ method: 'GET', url, headers: { cookie } });
  const post = (a: import('fastify').FastifyInstance, cookie: string, url: string, body: Record<string, string> = {}) =>
    a.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(), headers: { cookie, ...FORM } });
  const stateCookie = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? []).find((c) => c.startsWith('yf_ads='))?.split(';')[0] ?? '';
  const q = async <T>(raw: string, fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, await bidOf(raw), fn);
  };
  const live = (raw = BIZ) => q(raw, (x) => sql<{ ad_account_id: string; account_currency: string; timezone_name: string; token_ciphertext: string; connected_by: string }>`
    select ad_account_id, account_currency, timezone_name, token_ciphertext, connected_by from ad_spend_connections where archived_at is null`.execute(x).then((r) => r.rows));
  const register = (a: import('fastify').FastifyInstance, code: string, withAds: boolean) => import('../../src/api/web/app.js').then(({ registerWebApp }) => registerWebApp(a, {
    db, businessId: BIZ, accessCode: code, sessionSecret: SECRET, factsTtlMs: 0, credentialKey: KEY,
    employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
    publicBaseUrl: 'https://nomi.test', kickOutbound: async () => {}, kickDrive: async () => {},
    ...(withAds ? { adsLogin: { appId: '4070500000000001', appSecret: 'app-secret', configId: ADS_CONFIG } } : {}),
    adsFetch: fakeMeta,
  } as unknown as Parameters<typeof registerWebApp>[1]));
  /** Turn on → Meta's dialog → back with a code → the chooser → one account chosen. */
  const connect = async (cookie: string, account = '111222333') => {
    const start = await get(app, cookie, '/app/connect/meta-ads/start');
    const dialog = new URL(String(start.headers['location']));
    const back = await app.inject({ method: 'GET', url: `/app/connect/meta-ads/callback?code=CODE_OK&state=${encodeURIComponent(dialog.searchParams.get('state')!)}`,
      headers: { cookie: `${cookie}; ${stateCookie(start)}` } });
    const state = /name="state" value="([^"]+)"/.exec(back.body)?.[1] ?? '';
    return { start, dialog, back, chosen: await post(app, cookie, '/app/connect/meta-ads/choose', { state, account_id: account }) };
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL }); await admin.connect();
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    const { createDb } = await import('../../src/db/client.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    for (const [id, name] of [[BIZ, 'Ads Test Co'], [OTHER, 'Other Co']] as const) {
      await q(id, (x) => sql`insert into businesses (id, name, owner_locale, kind, country, currency, timezone) values (${id}, ${name}, 'en', 'brand', 'FR', 'USD', 'Europe/Paris') on conflict (id) do nothing`.execute(x));
    }
    await admin.query(`insert into businesses (id, name, practice_of) values ($1, 'Ads Test Co (practice)', $2) on conflict (id) do nothing`, [COPY, BIZ]);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: { level: 'error' } }); await register(app, `ads-${RUN}`, true); await app.ready();
    bare = Fastify({ logger: { level: 'error' } }); await register(bare, `bare-${RUN}`, false); await bare.ready();
    owner = await login(app, `ads-${RUN}`);
    bareOwner = await login(bare, `bare-${RUN}`);
    const team = await addPerson(db, BIZ, SECRET, `Staff ${RUN}`, 'team'); if (team.code !== 'added') throw new Error('fixture');
    staff = await login(app, team.accessCode);
  }, 60_000);
  afterAll(async () => {
    await admin?.query(`update ops_flags set cleared_at = now() where business_id = $1 and cleared_at is null`, [BIZ]);
    await app?.close(); await bare?.close(); await db?.destroy(); await admin?.end();
  });

  it('WITHOUT the ads login: no switch on Results, every route refuses, Meta is never asked', async () => {
    const before = calls.length;
    const results = await get(bare, bareOwner, '/app/results');
    expect(results.statusCode).toBe(200);
    expect(results.body).not.toContain('id="ad-spend"');
    expect(results.body).not.toContain('/app/connect/meta-ads/');
    for (const [method, url] of [['GET', '/app/connect/meta-ads/start'], ['GET', '/app/connect/meta-ads/callback?code=CODE_OK&state=x'],
      ['POST', '/app/connect/meta-ads/choose'], ['POST', '/app/connect/meta-ads/disconnect']] as const) {
      const r = method === 'GET' ? await get(bare, bareOwner, url) : await post(bare, bareOwner, url, { state: 'x', account_id: '111222333' });
      expect([url, r.statusCode]).toEqual([url, 302]);
      expect(flashSaid(r, SECRET)).toBe(t('en', 'adSpend.flash.notConfigured'));
    }
    expect(calls.length - before).toBe(0);
    expect(await live()).toEqual([]);
  });

  it('STAFF: refused at every step, nothing asked of Meta, and Results shows the owner\'s line and no account', async () => {
    const before = calls.length;
    for (const [method, url] of [['GET', '/app/connect/meta-ads/start'], ['GET', '/app/connect/meta-ads/callback?code=CODE_OK&state=x'],
      ['POST', '/app/connect/meta-ads/choose'], ['POST', '/app/connect/meta-ads/disconnect']] as const) {
      const r = method === 'GET' ? await get(app, staff, url) : await post(app, staff, url, { state: 'x', account_id: '111222333' });
      expect(flashSaid(r, SECRET)).toBe(t('en', 'staff.notAllowed'));
    }
    expect(calls.length - before).toBe(0);
    const results = await get(app, staff, '/app/results');
    expect(results.body).toContain(t('en', 'adSpend.staff'));
    expect(results.body).not.toContain('/app/connect/meta-ads/start');
  });

  it('THE OPERATOR\'S STOP: connections_off refuses start, callback and choose before Meta is asked', async () => {
    const { setOperatorFlag, clearOperatorFlag } = await import('../../tools/lib/operator.mjs');
    const start = await get(app, owner, '/app/connect/meta-ads/start');
    const nonce = new URL(String(start.headers['location'])).searchParams.get('state')!;
    await setOperatorFlag(admin, { flag: 'connections_off', businessId: BIZ, reason: 'pause', by: 'operator' });
    try {
      const before = calls.length;
      const again = await get(app, owner, '/app/connect/meta-ads/start');
      expect(flashSaid(again, SECRET)).toBe(t('en', 'connect.flash.paused'));
      const cb = await app.inject({ method: 'GET', url: `/app/connect/meta-ads/callback?code=CODE_OK&state=${encodeURIComponent(nonce)}`, headers: { cookie: `${owner}; ${stateCookie(start)}` } });
      expect(flashSaid(cb, SECRET)).toBe(t('en', 'connect.flash.paused'));
      const ch = await post(app, owner, '/app/connect/meta-ads/choose', { state: 'x', account_id: '111222333' });
      expect(flashSaid(ch, SECRET)).toBe(t('en', 'connect.flash.paused'));
      expect(calls.length - before).toBe(0);
    } finally {
      await clearOperatorFlag(admin, { flag: 'connections_off', businessId: BIZ });
    }
  });

  it('THE OWNER turns it on: the ads configuration on v27.0, a chooser, ONE account kept with its token sealed', async () => {
    const results = await get(app, owner, '/app/results');
    expect(results.body).toContain('action="/app/connect/meta-ads/start"');
    const { dialog, back, chosen } = await connect(owner);
    expect(dialog.origin + dialog.pathname).toBe('https://www.facebook.com/v27.0/dialog/oauth');
    expect(dialog.searchParams.get('config_id')).toBe(ADS_CONFIG);
    expect(dialog.searchParams.get('redirect_uri')).toBe('https://nomi.test/app/connect/meta-ads/callback');
    expect(back.statusCode).toBe(200);
    expect(back.headers['referrer-policy']).toBe('no-referrer');
    expect(back.body).toContain('Shop ads'); expect(back.body).toContain('Old ads');
    expect(back.body).not.toContain(`ads-long-${RUN}`);
    expect(flashSaid(chosen, SECRET)).toBe(t('en', 'adSpend.flash.connected'));
    const rows = await live();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ad_account_id: '111222333', account_currency: 'EUR', timezone_name: 'Europe/Paris' });
    expect(rows[0]!.token_ciphertext.startsWith('v1.')).toBe(true);
    expect(rows[0]!.token_ciphertext).not.toContain(`ads-long-${RUN}`);
    // Every call was the Marketing API version; none was the Page's.
    expect(calls.every((c) => c.includes('/v27.0/'))).toBe(true);
    const page = await get(app, owner, '/app/results');
    expect(page.body).toContain('Shop ads');
    expect(page.body).toContain('action="/app/connect/meta-ads/disconnect"');
    // The account's zone is the workspace's: nothing to state.
    expect(page.body).not.toContain('Meta reports this account');
  });

  it('a Page connect\'s state cannot finish an ads connection; an account the token does not see is refused', async () => {
    const { mintMetaState } = await import('../../src/channels/meta/connect.js');
    const forged = mintMetaState(SECRET, { nonce: 'n', personId: 'owner', tokenCiphertext: 'v1.x' }, Date.now());
    const r = await post(app, owner, '/app/connect/meta-ads/choose', { state: forged, account_id: '111222333' });
    expect(flashSaid(r, SECRET)).toBe(t('en', 'adSpend.flash.expired'));
    const { chosen } = await connect(owner, '999999999');
    expect(flashSaid(chosen, SECRET)).toBe(t('en', 'adSpend.flash.noAccounts'));
    expect((await live())[0]?.ad_account_id).toBe('111222333');
  });

  it('choosing another account archives the first: one live row', async () => {
    await connect(owner, '444555666');
    const rows = await live();
    expect(rows.map((r) => r.ad_account_id)).toEqual(['444555666']);
    const all = await q(BIZ, (x) => sql<{ n: number }>`select count(*)::int as n from ad_spend_connections`.execute(x).then((r) => r.rows[0]!.n));
    expect(all).toBe(2);
  });

  it('TENANTS: another workspace sees none of it; staff read none of it from the database either', async () => {
    expect(await live(OTHER)).toEqual([]);
    const policies = (await admin.query(`select tablename, string_agg(policyname, ',' order by policyname) as p from pg_policies
      where tablename like 'ad_spend_%' group by tablename order by tablename`)).rows;
    expect(policies).toEqual(['ad_spend_connections', 'ad_spend_day_history', 'ad_spend_days', 'ad_spend_reads', 'ad_spend_recorded']
      .map((tablename) => ({ tablename, p: 'not_for_accountants,not_for_staff,tenant' })));
    const del = (await admin.query(`select count(*)::int as n from information_schema.role_table_grants
      where grantee = 'nomi_app' and table_name like 'ad_spend_%' and privilege_type in ('DELETE', 'TRUNCATE')`)).rows[0];
    expect(del).toEqual({ n: 0 });
  });

  it('A PRACTICE COPY is refused a connection by the database itself', async () => {
    await expect(q(COPY, (x) => sql`insert into ad_spend_connections (business_id, ad_account_id, account_currency, timezone_name, token_ciphertext, token_fingerprint, connected_by)
      values (${COPY}, '1', 'EUR', 'Europe/Paris', 'v1.x', 'f', 'o')`.execute(x))).rejects.toThrow(/practice workspace/);
  });

  it('DISCONNECT archives; Results offers the switch again; nothing is asked of Meta', async () => {
    const before = calls.length;
    const r = await post(app, owner, '/app/connect/meta-ads/disconnect');
    expect(flashSaid(r, SECRET)).toBe(t('en', 'adSpend.flash.disconnected'));
    expect(await live()).toEqual([]);
    expect(calls.length - before).toBe(0);
    expect((await get(app, owner, '/app/results')).body).toContain('action="/app/connect/meta-ads/start"');
  });
});
