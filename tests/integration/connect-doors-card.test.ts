import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { flashSaid } from './tenant.js';
// @ts-expect-error — the operator tool, plain JS on purpose (tools/ is not type-checked).
import * as op from '../../tools/lib/operator.mjs';

/**
 * 4.1 fix D3 — NO CHANNEL CONNECTS WITHOUT THE CARD, through any door. Over Postgres and the real routes.
 *
 * The tester (2026-11-11): with `billing_required` on, a self-serve workspace with no card connected its mailbox
 * (Gmail/Outlook asked nothing), and with no trial granted 0240 froze it the same minute and told it its trial had
 * ended. The mailbox's start and callback, the chat page, Telegram and WhatsApp's reconnect now ask
 * `connectionRefusal` like every other connect: switch on, no card — each refused with the card's words, nothing
 * written, nothing asked of the provider; switch off — each goes through. The other doors are held by the walk
 * (`tests/parity/connect-doors.test.ts`) and their own tests (ks6-approval, bill-billing).
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `d3d00000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const GOOGLE = { clientId: `google-${RUN}.apps.googleusercontent.com`, clientSecret: 'g-secret' };
const MS = { clientId: '11111111-2222-3333-4444-555555555555', clientSecret: 'm-secret' };

d('4.1 fix D3 · every door asks the card (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let shop = '';
  let cookie = '';
  const wire: string[] = [];
  const fetchImpl: import('../../src/connectors/oauth.js').OAuthFetch = async (url) => {
    wire.push(url);
    return { status: 500, text: async () => '' };
  };
  const get = (url: string, extra = '') => app.inject({ method: 'GET', url, headers: { cookie: [cookie, extra].filter(Boolean).join('; ') } });
  const post = (url: string, fields: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { ...FORM, cookie }, payload: new URLSearchParams(fields).toString() });
  const flashOf = (r: { headers: Record<string, unknown> }) => flashSaid(r, SECRET);
  const rows = async () => (await admin.query(`
    select (select count(*)::int from mail_accounts where business_id = $1) as mail,
           (select coalesce(json_object_agg(kind, status), '{}'::json) from channels where business_id = $1) as channels,
           (select connected_at from channels where business_id = $1 and kind = 'whatsapp') as wa_at`, [shop])).rows[0];
  const flagOn = () => op.setOperatorFlag(admin, { flag: 'billing_required', businessId: null, reason: `d3 ${RUN}`, by: 'test' });
  const flagOff = () => op.clearOperatorFlag(admin, { flag: 'billing_required', businessId: null });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const { hashPassword } = await import('../../src/security/password.js');
    const { deriveKey } = await import('../../src/security/credentials.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    db = createDb(DATABASE_URL!);
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [PILOT, `D3 installation ${RUN}`]);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: PILOT, accessCode: `d3-${RUN}`, sessionSecret: SECRET, publicBaseUrl: 'https://nomi.test',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'meta', secureCookie: false, messagingEnabled: true,
      kickOutbound: async () => {}, kickDrive: async () => {}, credentialKey: deriveKey('d'.repeat(64)),
      oauthClients: { google: GOOGLE, microsoft: MS }, oauthFetch: fetchImpl,
      chatIngest: async () => 'refused' as const, telegramBot: { username: 'nomi_test_bot' },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const email = `d3-${RUN}@shop.example`;
    const made = await provisionAccount(db, {
      factory: `D3 shop ${RUN}`, language: 'en', ownerName: 'Maya', email, passwordHash: await hashPassword(`d3-password-${RUN}`),
      invite: null, inviteRequired: false, termsVersion: 'abcdef012345',
      profile: { kind: 'retail', sells: 'candles', country: 'AE', website: null, teamSize: '1', channels: [] },
    });
    if (made.code !== 'created') throw new Error(made.code);
    shop = made.businessId;
    const login = await app.inject({ method: 'POST', url: '/login', headers: FORM,
      payload: new URLSearchParams({ email, password: `d3-password-${RUN}` }).toString() });
    cookie = ([] as string[]).concat(login.headers['set-cookie'] as string | string[] ?? [])
      .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=') && c !== 'yf_session=') ?? '';
    expect(cookie).not.toBe('');
    // A trial long enough that 0240's freeze never answers first (the frozen pre-handler would refuse every write):
    // what is asked here is the connection question alone.
    expect(await op.grantTrial(admin, { businessId: shop, days: 60, by: 'operator' })).toBe('granted');
    // A WhatsApp number connected long ago and since disconnected: Reconnect would write its `connected_at` again.
    const cred = (await admin.query(`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
      values ($1, 'whatsapp', $2, 'env:META_WHATSAPP_ACCESS_TOKEN', 'service') returning id`, [shop, `d3${RUN}`])).rows[0].id;
    await admin.query(`insert into channels (business_id, kind, status, credential_id, connected_at, disconnected_at)
      values ($1, 'whatsapp', 'disconnected', $2, now() - interval '40 days', now() - interval '39 days')`, [shop, cred]);
  }, 90_000);

  afterAll(async () => {
    await flagOff().catch(() => undefined);
    await app?.close(); await db?.destroy(); await admin?.end();
  });

  it('SWITCH ON, NO CARD: the mailbox, the chat page, Telegram and Reconnect are refused with the card\'s words; nothing written or asked', async () => {
    expect(await flagOn()).toBe(1);
    const before = await rows();
    const card = t('en', 'connect.flash.card');
    const start = await get('/app/connect/google/start');
    expect(String(start.headers['location'] ?? '')).not.toContain('accounts.google.com');
    expect(flashOf(start)).toBe(card);
    expect(String(start.headers['set-cookie'] ?? ''), 'no OAuth state is minted').not.toContain('yf_oauth=ey');
    expect(flashOf(await get('/app/connect/microsoft/start'))).toBe(card);
    expect(flashOf(await get(`/app/connect/google/callback?code=c-${RUN}&state=s`))).toBe(card);
    expect(flashOf(await post('/app/channels/chat', { on: '1' }))).toBe(card);
    expect(flashOf(await post('/app/channels/telegram', { on: '1' }))).toBe(card);
    expect(flashOf(await post('/app/channels/whatsapp/reconnect'))).toBe(card);
    expect(wire, 'nothing asked of Google or Microsoft').toEqual([]);
    expect(await rows()).toEqual(before);
    // Switching off is never refused.
    expect(flashOf(await post('/app/channels/chat', { on: '0' }))).toBe(t('en', 'channels.chat.flash.off'));
  });

  it('A FULL CALLBACK, STARTED BEFORE THE SWITCH WENT ON: refused at the callback, the code never spent', async () => {
    await flagOff();
    const start = await get('/app/connect/google/start');
    const location = new URL(String(start.headers['location']));
    const state = location.searchParams.get('state') ?? '';
    const oauth = String(start.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(oauth.startsWith('yf_oauth=')).toBe(true);
    expect(await flagOn()).toBe(1);
    expect(flashOf(await get(`/app/connect/google/callback?code=c-${RUN}&state=${state}`, oauth))).toBe(t('en', 'connect.flash.card'));
    expect(wire).toEqual([]);
    expect((await rows()).mail).toBe(0);
  });

  it('SWITCH OFF: every one of them goes through', async () => {
    expect(await flagOff()).toBe(1);
    const start = await get('/app/connect/google/start');
    expect(String(start.headers['location'])).toContain('accounts.google.com');
    expect(flashOf(await post('/app/channels/chat', { on: '1' }))).toBe(t('en', 'channels.chat.flash.on'));
    expect(flashOf(await post('/app/channels/telegram', { on: '1' }))).toBe(t('en', 'channels.telegram.flash.on'));
    await post('/app/channels/whatsapp/reconnect');
    const after = await rows();
    expect(after.channels).toMatchObject({ web_chat: 'connected', telegram: 'connected', whatsapp: 'connected' });
  });
});
