import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { offlineModels } from '../pipeline/fakes.js';

/**
 * CH1 + CH2 (the one-month build order, 2026-09-30) — "Your accounts", read
 * live, through the production composition with Meta faked at the edge: a Page
 * connected through the real login flow, then what Meta says about it now.
 *
 *   · every step is marked from what is there: the Page, its Instagram, Meta's
 *     word on the token, the permissions actually granted, the subscription,
 *     and the newest message on each channel;
 *   · a permission Meta did not grant is named; a Page not subscribed says so;
 *   · a token Meta no longer accepts is recorded, as a send would find it;
 *   · Meta not answering is "could not check", never a failure;
 *   · the page watches its own mark, and the help page says what to check.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd7a0000-0000-4000-8000-${RUN}0001`;
const APP_ID = '4070500000000001';
const PAGE = `1033${runDigits(RUN, 10)}`;
const IG = `1788${runDigits(RUN, 10)}`;
const ALL = ['pages_show_list', 'pages_messaging', 'pages_read_engagement', 'pages_manage_metadata',
  'instagram_basic', 'instagram_manage_messages', 'business_management'];

/** What Meta says, as each test sets it. */
const meta = { answers: true, valid: true, scopes: [...ALL], subscribed: true };
const asked: string[] = [];
const metaFetch: import('../../src/channels/meta/messaging.js').MetaFetch = async (url, init) => {
  const u = new URL(url);
  asked.push(`${init.method} ${u.pathname}`);
  const json = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) });
  if (u.pathname.endsWith('/oauth/access_token')) {
    const p = u.searchParams;
    return json(200, { access_token: p.get('grant_type') === 'fb_exchange_token' ? 'user-long-Y' : 'user-short-Y' });
  }
  if (u.pathname.endsWith('/me/accounts')) {
    return json(200, { data: [{ id: PAGE, name: 'Yara Candles', access_token: 'page-token-Y', instagram_business_account: { id: IG, username: 'yara.candles' } }] });
  }
  if (!meta.answers && init.method === 'GET') throw new Error('Meta is not answering');
  if (u.pathname.endsWith('/debug_token')) {
    expect(u.searchParams.get('access_token')).toMatch(new RegExp(`^${APP_ID}\\|`));
    return json(200, { data: { is_valid: meta.valid, scopes: meta.valid ? meta.scopes : [] } });
  }
  if (u.pathname.endsWith('/subscribed_apps')) {
    if (init.method === 'POST') return json(200, { success: true });
    return json(200, { data: meta.subscribed ? [{ id: APP_ID, name: 'Nomi', subscribed_fields: ['messages', 'messaging_postbacks'] }] : [] });
  }
  return json(400, { error: {} });
};

d('CH1 · "Your accounts", read live (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let cookie = '';

  const tx = async <R>(fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };
  const get = (url: string, extra = '') => prod.app.inject({ method: 'GET', url, headers: { cookie: extra ? `${cookie}; ${extra}` : cookie } });
  /** The panel alone, so a mark elsewhere on the page cannot pass for one of its steps. */
  const panel = async (): Promise<string> => {
    const r = await get('/app/channels/meta');
    expect(r.statusCode).toBe(200);
    return /<section class="block" id="your-accounts"[\s\S]*?<\/section>/.exec(r.body)?.[0] ?? '';
  };
  const stepOf = (html: string, label: string): string => {
    const at = html.indexOf(`<b>${t('en', label as never)}</b>`);
    expect(at, label).toBeGreaterThan(-1);
    const start = html.lastIndexOf('<div class="pr ', at);
    return html.slice(start, html.indexOf('</div>', at) + 6);
  };
  const markOf = (html: string, label: string) => /<div class="pr (\w+)">/.exec(stepOf(html, label))?.[1];

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    process.env['OWNER_ACCESS_CODE'] = `accounts-${RUN}`;
    process.env['META_SOCIAL_APP_SECRET'] = `meta-app-secret-${RUN}`;
    process.env['META_SOCIAL_APP_ID'] = APP_ID;
    process.env['META_LOGIN_CONFIG_ID'] = '1234567890';
    delete process.env['META_PAGE_ACCESS_TOKEN']; delete process.env['META_PAGE_ID']; delete process.env['META_IG_ACCOUNT_ID'];
    const { buildProduction } = await import('../../src/main.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    prod = await buildProduction({
      provider: 'disabled', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'ya-verify-token', CREDENTIAL_KEY: 'd'.repeat(64),
      PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { models: offlineModels(), logger: false, metaFetch });
    await tx((x) => sql`insert into businesses (id, name) values (${BIZ}, 'Yara Candles') on conflict (id) do nothing`.execute(x));
    const login = await prod.app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(prod.ownerAccessCode)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  }, 90_000);
  afterAll(async () => { await prod?.close(); });

  it('before a Page is connected: the steps, none done, each with what to check', async () => {
    const html = await panel();
    expect(html).toContain(t('en', 'accounts.title'));
    expect(markOf(html, 'accounts.page')).toBe('todo');
    expect(markOf(html, 'accounts.test')).toBe('todo');
    expect(html).toContain('href="/app/help/meta#page"');
    expect(asked.filter((a) => a.includes('debug_token'))).toEqual([]);   // nothing to ask Meta about
  });

  it('connected, with everything granted and subscribed: done, step by step — the permissions and the token read from Meta', async () => {
    const start = await get('/app/connect/meta/start');
    const nonce = new URL(String(start.headers['location'])).searchParams.get('state')!;
    const state = ([] as string[]).concat(start.headers['set-cookie'] as string | string[] ?? []).find((c) => c.startsWith('yf_meta='))!.split(';')[0]!;
    const cb = await get(`/app/connect/meta/callback?code=CODE_Y&state=${encodeURIComponent(nonce)}`, state);
    expect(cb.statusCode).toBe(302);
    const html = await panel();
    expect(stepOf(html, 'accounts.page')).toContain('Yara Candles');
    expect(stepOf(html, 'accounts.instagram')).toContain('@yara.candles');
    for (const s of ['accounts.page', 'accounts.instagram', 'accounts.token', 'accounts.permissions', 'accounts.subscribed']) {
      expect(markOf(html, s), s).toBe('done');
    }
    expect(asked).toContain('GET /v23.0/debug_token');
    expect(asked).toContain(`GET /v23.0/${PAGE}/subscribed_apps`);
  });

  it('a permission Meta did not grant is named; a Page not subscribed says so', async () => {
    meta.scopes = ALL.filter((s) => s !== 'instagram_manage_messages');
    meta.subscribed = false;
    const html = await panel();
    expect(markOf(html, 'accounts.permissions')).toBe('bad');
    expect(stepOf(html, 'accounts.permissions')).toContain(t('en', 'accounts.permissions.bad', { missing: 'instagram_manage_messages' }));
    expect(markOf(html, 'accounts.subscribed')).toBe('bad');
    meta.scopes = [...ALL]; meta.subscribed = true;
  });

  it('Meta not answering is "could not check" — never a failure, never a write', async () => {
    meta.answers = false;
    const html = await panel();
    for (const s of ['accounts.token', 'accounts.permissions', 'accounts.subscribed']) expect(markOf(html, s), s).toBe('unknown');
    expect(stepOf(html, 'accounts.token')).toContain(t('en', 'accounts.unknown'));
    meta.answers = true;
    const state = await tx((x) => sql<{ e: string | null }>`select last_error as e from meta_accounts where business_id = ${BIZ} and archived_at is null`
      .execute(x).then((r) => r.rows[0]!.e));
    expect(state).toBeNull();
  });

  it('a first message from another account shows when it arrives — and the page\'s live mark moves', async () => {
    const drawn = await get('/app/channels/meta');
    const mark = /data-live="\/app\/live\/channels\?since=([0-9a-f.]+)"/.exec(drawn.body)?.[1];
    expect(mark).toBeTruthy();
    expect((await get(`/app/live/channels?since=${mark}`)).json()).toEqual({ news: false });   // phase 8: no order count on a live answer (the rail's question carries who waits)
    await tx(async (x) => {
      const client = (await sql<{ id: string }>`insert into clients (business_id, display_name) values (${BIZ}, 'Lina') returning id::text as id`.execute(x)).rows[0]!.id;
      await sql`insert into client_channels (client_id, channel, channel_user_id, last_inbound_at)
                values (${client}::uuid, 'instagram', ${`IGSID_${RUN}`}, now())`.execute(x);
    });
    expect((await get(`/app/live/channels?since=${mark}`)).json()).toEqual({ news: true, what: 'channels' });
    const html = await panel();
    expect(markOf(html, 'accounts.test')).toBe('done');
    expect(stepOf(html, 'accounts.test')).toContain('Instagram');
  });

  it('a token Meta no longer accepts: said on the page, and recorded as a send would have found it', async () => {
    meta.valid = false;
    const html = await panel();
    expect(markOf(html, 'accounts.token')).toBe('bad');
    expect(stepOf(html, 'accounts.token')).toContain(t('en', 'accounts.token.bad'));
    expect(markOf(html, 'accounts.permissions')).toBe('todo');   // after connecting again
    const state = await tx((x) => sql<{ e: string | null; at: Date | null }>`
      select last_error as e, needs_attention_at as at from meta_accounts where business_id = ${BIZ} and archived_at is null`
      .execute(x).then((r) => r.rows[0]!));
    expect(state.e).toBe('revoked');
    expect(state.at).not.toBeNull();
    meta.valid = true;
  });

  it('CH2 — the help page says what to check and why, for each step, in the panel\'s order', async () => {
    const r = await get('/app/help/meta');
    expect(r.statusCode).toBe(200);
    for (const id of ['page', 'instagram', 'connect', 'permissions', 'subscription', 'test-message']) expect(r.body, id).toContain(`id="${id}"`);
    expect(r.body).toContain(t('en', 'help.meta.permissions.check'));
    expect(r.body).toContain('href="https://www.facebook.com/business/help/898752960195806" rel="noopener noreferrer" target="_blank"');
    const ar = await get('/app/help/meta', 'yf_locale=ar');
    expect(ar.body).toContain('<html lang="ar" dir="rtl"');
    expect(ar.body).toContain(t('ar', 'help.meta.title'));
  });
});
