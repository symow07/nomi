import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID, createHmac } from 'node:crypto';
import { runDigits } from './tenant.js';

/**
 * C10 — a business connects its OWN Page and Instagram, over the REAL
 * composition, against a Meta that exists only in this file.
 *
 * What only this can prove: that pressing Connect ends with a row this
 * business's replies leave through; that a buyer writing to THAT Page lands
 * in THIS inbox with a name looked up with THIS token; that the reply goes out
 * with the same token; that a dead token is recorded and shown, not retried
 * in silence; that two businesses' Pages route to their own inboxes; and
 * that Disconnect closes the door on the next delivery.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd550000-0000-4000-8000-${RUN}0001`;
const OTHER = `dd550000-0000-4000-8000-${RUN}0002`;
const CREDENTIAL_KEY = 'c'.repeat(64);
const APP_SECRET = `meta-app-secret-${RUN}`;
const V = 'v23.0';
const PAGE_A = `1030${runDigits(RUN, 10)}`;
const IG_A = `1786${runDigits(RUN, 10)}`;
const PAGE_B1 = `1031${runDigits(RUN, 10)}`;
const PAGE_B2 = `1032${runDigits(RUN, 10)}`;
const IG_B2 = `1787${runDigits(RUN, 10)}`;
const buyer = (who: string) => `PSID_${who}_${RUN}`;

/** Meta, as this test lets it be reached. Every call is recorded. */
type Call = { readonly url: string; readonly method: string; readonly bearer: string | null };
const calls: Call[] = [];
const dead = new Set<string>();
const PAGES: Record<string, unknown[]> = {
  'user-long-A': [{ id: PAGE_A, name: 'Atlas Bags', access_token: 'page-token-A', instagram_business_account: { id: IG_A, username: 'atlasbags' } }],
  'user-long-B': [
    { id: PAGE_B1, name: 'Bolt Tools', access_token: 'page-token-B1' },
    { id: PAGE_B2, name: 'Bolt Tools Europe', access_token: 'page-token-B2', instagram_business_account: { id: IG_B2, username: 'bolt.eu' } },
  ],
  'user-long-C': [],
};
const NAMES: Record<string, Record<string, string>> = {
  [buyer('fatima')]: { first_name: 'Fatima', last_name: 'Zahra' },
  [buyer('karim')]: { name: 'Karim', username: 'karim.k' },
};
const metaFetch: import('../../src/channels/meta/messaging.js').MetaFetch = async (url, init) => {
  const u = new URL(url);
  const bearer = init.headers['Authorization']?.replace(/^Bearer /, '') ?? null;
  calls.push({ url, method: init.method, bearer });
  const json = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) });
  if (u.pathname.endsWith('/oauth/access_token')) {
    const p = u.searchParams;
    if (p.get('grant_type') === 'fb_exchange_token') return json(200, { access_token: p.get('fb_exchange_token')!.replace('short', 'long') });
    const code = p.get('code') ?? '';
    return /^CODE_[ABC]$/.test(code) ? json(200, { access_token: `user-short-${code.slice(-1)}` }) : json(400, { error: { message: 'bad code' } });
  }
  if (u.pathname.endsWith('/me/accounts')) {
    const pages = PAGES[u.searchParams.get('access_token') ?? ''];
    return pages ? json(200, { data: pages }) : json(401, { error: {} });
  }
  if (u.pathname.endsWith('/subscribed_apps')) return json(200, { success: true });
  if (u.pathname.endsWith('/messages') && init.method === 'POST') {
    if (bearer && dead.has(bearer)) return json(401, { error: { message: 'token expired' } });
    return json(200, { message_id: `mid.out.${randomUUID()}` });
  }
  if (init.method === 'GET') {
    const id = decodeURIComponent(u.pathname.split('/').pop() ?? '');
    return NAMES[id] ? json(200, NAMES[id]) : json(400, { error: {} });
  }
  return json(400, { error: {} });
};

d('C10 · connect your own Page and Instagram (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let esc: typeof import('../../src/api/web/layout.js')['esc'];
  let cookie = '';

  const bid = async (raw = BIZ) => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture');
    return b.value;
  };
  const tx = async <R>(fn: (x: import('../../src/db/client.js').Tx) => Promise<R>, raw = BIZ): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, await bid(raw), fn);
  };
  const get = (url: string, extra = '') => prod.app.inject({ method: 'GET', url, headers: { cookie: extra ? `${cookie}; ${extra}` : cookie } });
  const post = (url: string, fields: Record<string, string> = {}) => prod.app.inject({
    method: 'POST', url, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  });
  const location = (r: { headers: Record<string, unknown> }) => String(r.headers['location'] ?? '');
  const flashOf = (r: { headers: Record<string, unknown> }) => new URL(location(r), 'https://x.test').searchParams.get('flash') ?? '';
  const stateCookie = (r: { headers: Record<string, unknown> }) => {
    const raw = ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? []).find((c) => c.startsWith('yf_meta='));
    return raw?.split(';')[0] ?? '';
  };
  const inbound = (path: string, object: string, o: { sender: string; recipient: string; text: string }) => {
    const body = JSON.stringify({ object, entry: [{ id: o.recipient, time: Date.now(), messaging: [{
      sender: { id: o.sender }, recipient: { id: o.recipient }, timestamp: Date.now(),
      message: { mid: `mid.${randomUUID()}`, text: o.text },
    }] }] });
    return prod.app.inject({ method: 'POST', url: path, payload: body, headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex')}`,
    } });
  };
  /** Start → callback, as the browser would: the state cookie travels back with the code. */
  const connect = async (code: string) => {
    const start = await get('/app/connect/meta/start');
    expect(start.statusCode).toBe(302);
    const dialog = new URL(location(start));
    const nonce = dialog.searchParams.get('state')!;
    return get(`/app/connect/meta/callback?code=${code}&state=${encodeURIComponent(nonce)}`, stateCookie(start));
  };
  const account = () => tx((x) => sql<{ page_id: string; ig_account_id: string | null; page_name: string; token_ciphertext: string; last_error: string | null }>`
    select page_id, ig_account_id, page_name, token_ciphertext, last_error from meta_accounts
     where business_id = ${BIZ} and archived_at is null`.execute(x).then((r) => r.rows[0] ?? null));
  const credentials = () => tx((x) => sql<{ channel: string; external_ref: string; secret_ref: string; is_active: boolean }>`
    select channel, external_ref, secret_ref, is_active from channel_credentials
     where business_id = ${BIZ} and channel in ('instagram','messenger') order by channel`.execute(x).then((r) => r.rows));

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    process.env['OWNER_ACCESS_CODE'] = `meta-connect-${RUN}`;
    process.env['META_SOCIAL_APP_SECRET'] = APP_SECRET;
    process.env['META_SOCIAL_APP_ID'] = '4070500000000001';
    process.env['META_LOGIN_CONFIG_ID'] = '1234567890';
    // No account in the environment: everything below is hers.
    delete process.env['META_PAGE_ACCESS_TOKEN']; delete process.env['META_PAGE_ID']; delete process.env['META_IG_ACCOUNT_ID'];
    const { buildProduction } = await import('../../src/main.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    ({ esc } = await import('../../src/api/web/layout.js'));
    prod = await buildProduction({
      provider: 'disabled', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_GRAPH_API_VERSION: V, WEBHOOK_VERIFY_TOKEN: 'mc-verify-token',
      CREDENTIAL_KEY, PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { logger: false, metaFetch });
    for (const [id, name] of [[BIZ, 'Atlas Factory'], [OTHER, 'Other Factory']] as const) {
      await tx((x) => sql`insert into businesses (id, name) values (${id}, ${name}) on conflict (id) do nothing`.execute(x), id);
    }
    const login = await prod.app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(prod.ownerAccessCode)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  }, 90_000);

  afterAll(async () => { await prod?.close(); });

  it('THE WEBHOOKS ARE UP WITH NO ACCOUNT IN THE ENVIRONMENT — a Page connected here must be able to deliver', async () => {
    expect([...prod.channels].sort()).toEqual(['instagram', 'messenger']);
    const hs = await prod.app.inject({ method: 'GET', url: '/webhook/messenger?hub.mode=subscribe&hub.verify_token=mc-verify-token&hub.challenge=c1' });
    expect([hs.statusCode, hs.body]).toEqual([200, 'c1']);
    // And her page offers the login, not the host's account.
    const page = await get('/app/channels');
    expect(page.body).toContain('href="/app/connect/meta/start"');
    expect(page.body).not.toContain('action="/app/channels/messenger/connect"');
  }, 60_000);

  it('SHE PRESSES CONNECT, CHOOSES IN META\'S DIALOG, AND IS BACK WITH HER PAGE — token stored encrypted, credentials routing', async () => {
    const start = await get('/app/connect/meta/start');
    const dialog = new URL(location(start));
    expect(dialog.origin + dialog.pathname).toBe(`https://www.facebook.com/${V}/dialog/oauth`);
    expect(dialog.searchParams.get('config_id')).toBe('1234567890');
    expect(dialog.searchParams.get('redirect_uri')).toBe('https://nomi.test/app/connect/meta/callback');
    expect(stateCookie(start)).toMatch(/^yf_meta=.+/);

    const back = await get(`/app/connect/meta/callback?code=CODE_A&state=${encodeURIComponent(dialog.searchParams.get('state')!)}`, stateCookie(start));
    expect(back.statusCode).toBe(302);
    expect(flashOf(back)).toBe(t('en', 'connect.meta.flash.connected', { page: 'Atlas Bags' }));

    const a = await account();
    expect(a).toMatchObject({ page_id: PAGE_A, ig_account_id: IG_A, page_name: 'Atlas Bags', last_error: null });
    expect(a!.token_ciphertext.startsWith('v1.'), 'the token is stored encrypted').toBe(true);
    expect(a!.token_ciphertext).not.toContain('page-token-A');
    const creds = await credentials();
    expect(creds).toEqual([
      { channel: 'instagram', external_ref: IG_A, secret_ref: expect.stringMatching(/^meta_accounts:/), is_active: true },
      { channel: 'messenger', external_ref: PAGE_A, secret_ref: expect.stringMatching(/^meta_accounts:/), is_active: true },
    ]);
    // The Page was subscribed with ITS token, and the user token was made long-lived.
    expect(calls.some((c) => c.method === 'POST' && c.url.includes(`/${PAGE_A}/subscribed_apps?`) && c.url.includes('access_token=page-token-A'))).toBe(true);
    expect(calls.some((c) => c.url.includes('grant_type=fb_exchange_token'))).toBe(true);

    const page = await get('/app/channels');
    expect(page.body).toContain(esc(t('en', 'reach.inbound.connectedAs', { page: 'Atlas Bags' })));
    expect(page.body).toContain(esc(t('en', 'reach.inbound.connectedAs', { page: 'Atlas Bags · @atlasbags' })));
    expect(page.body).toContain('action="/app/connect/meta/disconnect"');
  }, 60_000);

  it('A CALLBACK WITHOUT HER STATE IS REFUSED — another window, another person, or too late', async () => {
    const stray = await get('/app/connect/meta/callback?code=CODE_A&state=whatever');
    expect(flashOf(stray)).toBe(t('en', 'connect.flash.expired'));
    // A refused code says so, and nothing changes.
    const bad = await connect('CODE_X');
    expect(flashOf(bad)).toBe(t('en', 'connect.flash.rejected'));
    expect((await account())?.page_id).toBe(PAGE_A);
  }, 60_000);

  it('A BUYER WRITING TO HER PAGE LANDS IN HER INBOX, NAMED WITH HER TOKEN — and her reply leaves with it', async () => {
    const r = await inbound('/webhook/messenger', 'page', { sender: buyer('fatima'), recipient: PAGE_A, text: 'do you ship to Rabat?' });
    expect(JSON.parse(r.body)).toMatchObject({ received: 1 });
    const conv = await tx((x) => sql<{ id: string; name: string | null }>`
      select c.id::text as id, cl.display_name as name from conversations c join clients cl on cl.id = c.client_id
       where c.business_id = ${BIZ} and c.channel = 'messenger' order by c.created_at desc limit 1`.execute(x).then((q) => q.rows[0]!));
    expect(conv.name).toBe('Fatima Zahra');
    expect(calls.find((c) => c.method === 'GET' && c.url.includes(buyer('fatima')))?.bearer, 'the name was asked with HER token').toBe('page-token-A');

    // Her reply, through the real worker: the row is queued and the process sends it.
    const { enqueueOutboundRow } = await import('../../src/db/channels.js');
    const { QUEUES } = await import('../../src/queue/boss.js');
    const b = await bid();
    await tx((x) => enqueueOutboundRow(x, b, conv.id, 'Yes — to Rabat in 12 days.', 'owner'));
    await prod.boss.send(QUEUES.outbound, { businessId: BIZ, conversationId: conv.id }, { singletonKey: conv.id });
    const sent = await until(() => calls.find((c) => c.method === 'POST' && c.url.includes(`/${PAGE_A}/messages`)));
    expect(sent.bearer, 'the reply left with HER Page token').toBe('page-token-A');
  }, 90_000);

  it('A DEAD TOKEN IS RECORDED ONCE AND SHOWN — the next reply is refused with a reason, not retried in silence', async () => {
    dead.add('page-token-A');
    // A fresh conversation: a second reply in the first one would wait for the
    // first's delivery receipt, which is the ordering rule, not this test.
    await inbound('/webhook/messenger', 'page', { sender: buyer('dead'), recipient: PAGE_A, text: 'still there?' });
    const conv = await tx((x) => sql<{ id: string }>`
      select c.id::text as id from conversations c join client_channels cc on cc.client_id = c.client_id
       where c.business_id = ${BIZ} and cc.channel_user_id = ${buyer('dead')} limit 1`.execute(x).then((q) => q.rows[0]!));
    const { enqueueOutboundRow } = await import('../../src/db/channels.js');
    const { QUEUES } = await import('../../src/queue/boss.js');
    const b = await bid();
    await tx((x) => enqueueOutboundRow(x, b, conv.id, 'And to Casablanca.', 'owner'));
    await prod.boss.send(QUEUES.outbound, { businessId: BIZ, conversationId: conv.id }, { singletonKey: conv.id });
    await until(async () => ((await account())?.last_error === 'revoked') || undefined);
    const page = await get('/app/channels');
    expect(page.body).toContain(esc(t('en', 'reach.inbound.attention')));
    expect(page.body).toContain('href="/app/connect/meta/start"');
    dead.delete('page-token-A');
  }, 90_000);

  it('CONNECTING AGAIN HEALS IT; several Pages mean she chooses, and the choice re-points her credentials', async () => {
    expect(flashOf(await connect('CODE_A'))).toBe(t('en', 'connect.meta.flash.connected', { page: 'Atlas Bags' }));
    expect((await account())?.last_error).toBeNull();

    const start = await get('/app/connect/meta/start');
    const nonce = new URL(location(start)).searchParams.get('state')!;
    const choose = await get(`/app/connect/meta/callback?code=CODE_B&state=${encodeURIComponent(nonce)}`, stateCookie(start));
    expect(choose.statusCode).toBe(200);
    expect(choose.body).toContain('Bolt Tools Europe');
    expect(choose.body).toContain(esc(t('en', 'connect.meta.choose.instagram', { handle: '@bolt.eu' })));
    expect(choose.body).not.toContain('user-long-B');
    const state = /name="state" value="([^"]+)"/.exec(choose.body)![1]!;
    const chosen = await post('/app/connect/meta/choose', { page_id: PAGE_B2, state });
    expect(flashOf(chosen)).toBe(t('en', 'connect.meta.flash.connected', { page: 'Bolt Tools Europe' }));
    expect(await account()).toMatchObject({ page_id: PAGE_B2, ig_account_id: IG_B2 });
    expect((await credentials()).map((c) => [c.channel, c.external_ref, c.is_active])).toEqual([
      ['instagram', IG_B2, true], ['messenger', PAGE_B2, true],
    ]);
    // A stale state (its token spent) is refused, not replayed.
    expect(flashOf(await post('/app/connect/meta/choose', { page_id: PAGE_B1, state: 'not.a.state' }))).toBe(t('en', 'connect.flash.expired'));
  }, 90_000);

  it('TWO BUSINESSES, TWO PAGES, TWO INBOXES — and a Page one holds, the other cannot take', async () => {
    // The other factory connects Atlas Bags (free since she moved to Bolt Tools Europe).
    const { connectMetaAccount, linkMetaCredentials } = await import('../../src/db/metaAccounts.js');
    const { encryptSecret, credentialFingerprint, deriveKey } = await import('../../src/security/credentials.js');
    const key = deriveKey(CREDENTIAL_KEY);
    await tx(async (x) => {
      const stored = await connectMetaAccount(x, await bid(OTHER), {
        pageId: PAGE_A, pageName: 'Atlas Bags', igAccountId: IG_A, igUsername: 'atlasbags',
        ciphertext: encryptSecret('page-token-A', key), fingerprint: credentialFingerprint('page-token-A'), scopes: 'x', by: 'Other',
      });
      if (!stored.ok) throw new Error('fixture');
      expect(await linkMetaCredentials(x, await bid(OTHER), { accountId: stored.id, pageId: PAGE_A, igAccountId: IG_A, actor: 'Other' })).toBe('linked');
    }, OTHER);

    const count = (raw: string) => tx((x) => sql<{ n: number }>`
      select count(*)::int as n from conversations where business_id = ${raw} and channel = 'messenger'`.execute(x).then((q) => q.rows[0]!.n), raw);
    const mineBefore = await count(BIZ);
    const a = await inbound('/webhook/messenger', 'page', { sender: buyer('karim'), recipient: PAGE_A, text: 'hi Atlas' });
    const b = await inbound('/webhook/messenger', 'page', { sender: buyer('nadia'), recipient: PAGE_B2, text: 'hi Bolt' });
    expect(JSON.parse(a.body)).toMatchObject({ received: 1 });
    expect(JSON.parse(b.body)).toMatchObject({ received: 1 });
    expect([await count(BIZ), await count(OTHER)], 'each Page to its own inbox').toEqual([mineBefore + 1, 1]);

    // She tries to take Atlas Bags back: refused, and what she had stays.
    expect(flashOf(await connect('CODE_A'))).toBe(t('en', 'connect.meta.flash.page_taken'));
    expect((await account())?.page_id).toBe(PAGE_B2);
    // An account that manages no Page says so.
    expect(flashOf(await connect('CODE_C'))).toBe(t('en', 'connect.meta.flash.no_pages'));
  }, 90_000);

  it('DISCONNECT CLOSES THE DOOR on the next delivery, and the page offers Connect again', async () => {
    const before = calls.length;
    expect(flashOf(await post('/app/connect/meta/disconnect'))).toBe(t('en', 'connect.meta.flash.disconnected'));
    expect(calls.slice(before).some((c) => c.method === 'DELETE' && c.url.includes(`/${PAGE_B2}/subscribed_apps`))).toBe(true);
    expect(await account()).toBeNull();
    expect((await credentials()).every((c) => !c.is_active)).toBe(true);
    const r = await inbound('/webhook/messenger', 'page', { sender: buyer('karim'), recipient: PAGE_B2, text: 'anyone?' });
    expect(JSON.parse(r.body)).toMatchObject({ received: 0 });
    const page = await get('/app/channels');
    expect(page.body).toContain('href="/app/connect/meta/start"');
    expect(page.body).not.toContain('action="/app/connect/meta/disconnect"');
  }, 60_000);
});

async function until<T>(probe: () => T | undefined | Promise<T | undefined>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 250));
  }
}
