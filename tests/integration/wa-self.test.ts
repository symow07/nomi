import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits, flashSaid } from './tenant.js';
import { offlineModels } from '../pipeline/fakes.js';

/**
 * WA (0120) — a business connects its OWN WhatsApp number through Embedded
 * Signup, over the REAL composition; only Meta is faked, the way its
 * documented API answers:
 *
 *   · the connect: the dialog with the Embedded Signup configuration, the code
 *     exchanged, the shared account read from debug_token, its number listed,
 *     our app subscribed, the number registered with a PIN — and then, only
 *     then, the encrypted token and the credential that routes the number;
 *   · a customer's message to that number reaches this business;
 *   · a reply leaves FROM that number, with that business's token — never the
 *     installation's; a token Meta no longer accepts is marked and sends nothing;
 *   · pilot mode ends, and comes back, only on a live WhatsApp.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `ea000000-0000-4000-8000-${RUN}0001`;
const CREDENTIAL_KEY = 'd'.repeat(64);
const WABA = `1090${runDigits(RUN, 10)}`;
const PNID = `1091${runDigits(RUN, 10)}`;
const APP_ID = '1092000000001';
const CONFIG_ID = '1093000000001';
const CUSTOMER = `3460${runDigits(RUN, 7)}`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

const metaCalls: { method: string; url: string; body?: string }[] = [];
const asked: string[] = [];
const metaFetch: import('../../src/channels/meta/messaging.js').MetaFetch = async (url, init) => {
  metaCalls.push({ method: init.method, url, ...(init.body ? { body: init.body } : {}) });
  const u = new URL(url);
  const json = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) });
  if (u.pathname.endsWith('/oauth/access_token')) return u.searchParams.get('code') === 'good-code' ? json(200, { access_token: 'business-token-not-real' }) : json(400, { error: {} });
  if (u.pathname.endsWith('/debug_token')) return json(200, { data: { granular_scopes: [
    { scope: 'whatsapp_business_messaging', target_ids: [WABA] }, { scope: 'whatsapp_business_management', target_ids: [WABA] }] } });
  if (u.pathname.endsWith(`/${WABA}/phone_numbers`)) return json(200, { data: [{ id: PNID, display_phone_number: '+34 600 00 00 00', verified_name: 'Tienda Sol', name_status: 'PENDING_REVIEW' }] });
  if (u.pathname.endsWith(`/${WABA}/subscribed_apps`)) return json(200, { success: true });
  if (u.pathname.endsWith(`/${PNID}/register`)) return json(200, { success: true });
  // WA-S — the reopening template: asked (PENDING), then read back APPROVED.
  if (u.pathname.endsWith(`/${WABA}/message_templates`) && init.method === 'POST') {
    const lang = JSON.parse(init.body ?? '{}').language as string;
    asked.push(lang);
    return json(200, { id: `555${asked.length}`, status: 'PENDING', category: 'UTILITY' });
  }
  if (u.pathname.endsWith(`/${WABA}/message_templates`) && init.method === 'GET') {
    return json(200, { data: asked.map((language, i) => ({ name: 'nomi_reply_waiting', language, status: 'APPROVED', id: `555${i + 1}` })) });
  }
  return json(404, { error: {} });
};

/** Meta's WhatsApp send, as the business's own number sees it. */
const sends: { url: string; auth: string; body: string; id: string }[] = [];
let sendStatus = 200;
const whatsappFetch: import('../../src/channels/whatsapp/client.js').FetchLike = async (url, init) => {
  const id = `wamid.${randomUUID()}`;
  sends.push({ url, auth: init.headers['Authorization'] ?? '', body: init.body, id });
  return sendStatus === 200
    ? { status: 200, text: async () => JSON.stringify({ messages: [{ id }] }) }
    : { status: sendStatus, text: async () => JSON.stringify({ error: { code: 190 } }) };
};

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 30_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

d('WA · a business connects its own WhatsApp number (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let cookie = '';
  let SECRET = '';
  const tx = async <R>(fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };
  /** A webhook from Meta to the business's own number: the simulator's, re-addressed and re-signed. */
  const toOwnNumber = async (w: { rawBody: string }) => {
    const { signBody } = await import('../../src/channels/whatsapp/signature.js');
    const { SIMULATOR_SECRET } = await import('../../src/channels/whatsapp/simulator.js');
    const raw = w.rawBody.split(sim.phoneNumberId).join(PNID);
    return prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: raw,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signBody(raw, SIMULATOR_SECRET) } });
  };
  const post = (url: string, fields: Record<string, string> = {}, extra = '') => prod.app.inject({
    method: 'POST', url, headers: { cookie: `${cookie}${extra}`, ...FORM }, payload: new URLSearchParams(fields).toString(),
  });

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    process.env['OWNER_ACCESS_CODE'] = `wa-${RUN}`;
    process.env['META_WHATSAPP_APP_ID'] = APP_ID;
    process.env['META_WHATSAPP_ES_CONFIG_ID'] = CONFIG_ID;
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createHmac } = await import('node:crypto');
    SECRET = createHmac('sha256', CREDENTIAL_KEY).update('yf-web-session').digest('hex');
    sim = whatsappSimulator([], { tag: `wa${RUN}` });
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'installation-token-not-real',
      META_WHATSAPP_PHONE_NUMBER_ID: sim.phoneNumberId,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'wa-verify-token',
      CREDENTIAL_KEY, PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { models: offlineModels(), adapter: sim.adapter, logger: false, metaFetch, whatsappFetch });
    await tx((x) => sql`insert into businesses (id, name, kind, country, languages_served) values (${BIZ}, 'Tienda Sol', 'online_shop', 'ES', '{es,en}') on conflict (id) do nothing`.execute(x));
    const login = await prod.app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(prod.ownerAccessCode)}`, headers: FORM,
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 90_000);

  afterAll(async () => {
    delete process.env['META_WHATSAPP_APP_ID'];
    delete process.env['META_WHATSAPP_ES_CONFIG_ID'];
    await prod?.close();
  });

  it('THE CONNECT: Meta\'s window with the Embedded Signup configuration; then the account, the number, the subscription, the registration — and only then the rows', async () => {
    const page = await prod.app.inject({ method: 'GET', url: '/app/channels/whatsapp', headers: { cookie } });
    expect(page.body).toContain('/app/connect/whatsapp/start');
    expect(page.body).not.toContain('action="/app/channels/whatsapp/connect"');   // the installation's number is not offered

    const start = await prod.app.inject({ method: 'GET', url: '/app/connect/whatsapp/start', headers: { cookie } });
    expect(start.statusCode).toBe(302);
    const to = new URL(String(start.headers['location']));
    expect(to.hostname).toBe('www.facebook.com');
    expect(to.searchParams.get('config_id')).toBe(CONFIG_ID);
    expect(to.searchParams.get('client_id')).toBe(APP_ID);
    expect(JSON.parse(to.searchParams.get('extras') ?? '{}')).toMatchObject({ sessionInfoVersion: '3' });
    const waCookie = String(start.headers['set-cookie'] ?? '').split(';')[0]!;
    expect(waCookie.startsWith('yf_wa=')).toBe(true);

    // A refused code stores nothing.
    const bad = await prod.app.inject({ method: 'GET', url: `/app/connect/whatsapp/callback?code=bad&state=${to.searchParams.get('state')}`, headers: { cookie: `${cookie}; ${waCookie}` } });
    expect(bad.statusCode).toBe(302);
    expect((await tx((x) => sql`select 1 from whatsapp_accounts where business_id = ${BIZ}`.execute(x))).rows).toHaveLength(0);

    const again = await prod.app.inject({ method: 'GET', url: '/app/connect/whatsapp/start', headers: { cookie } });
    const state = new URL(String(again.headers['location'])).searchParams.get('state')!;
    const c2 = String(again.headers['set-cookie'] ?? '').split(';')[0]!;
    const done = await prod.app.inject({ method: 'GET', url: `/app/connect/whatsapp/callback?code=good-code&state=${state}`, headers: { cookie: `${cookie}; ${c2}` } });
    expect(done.statusCode).toBe(302);
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    expect(flashSaid(done, SECRET)).toBe(t('en', 'connect.wa.flash.connectedNamePending', { number: '+34 600 00 00 00', verified: 'Tienda Sol' }));

    const debug = metaCalls.find((c) => c.url.includes('/debug_token'))!;
    expect(new URL(debug.url).searchParams.get('access_token')).toBe(`${APP_ID}|meta-app-secret-not-real`);
    expect(metaCalls.some((c) => c.method === 'POST' && c.url.endsWith(`/${WABA}/subscribed_apps`))).toBe(true);
    const reg = metaCalls.find((c) => c.method === 'POST' && c.url.endsWith(`/${PNID}/register`))!;
    expect(JSON.parse(reg.body!)).toMatchObject({ messaging_product: 'whatsapp' });
    expect(JSON.parse(reg.body!).pin).toMatch(/^[0-9]{6}$/);

    const row = (await tx((x) => sql<{ waba_id: string; phone_number_id: string; token_ciphertext: string; pin_ciphertext: string | null; name_status: string }>`
      select waba_id, phone_number_id, token_ciphertext, pin_ciphertext, name_status from whatsapp_accounts where business_id = ${BIZ} and archived_at is null`.execute(x))).rows[0]!;
    expect(row).toMatchObject({ waba_id: WABA, phone_number_id: PNID, name_status: 'PENDING_REVIEW' });
    expect(row.token_ciphertext.startsWith('v1.')).toBe(true);
    expect(row.token_ciphertext).not.toContain('business-token-not-real');
    expect(row.pin_ciphertext?.startsWith('v1.')).toBe(true);
    const cred = (await tx((x) => sql<{ external_ref: string; secret_ref: string; is_active: boolean }>`
      select external_ref, secret_ref, is_active from channel_credentials where business_id = ${BIZ} and channel = 'whatsapp'`.execute(x))).rows[0]!;
    expect(cred).toMatchObject({ external_ref: PNID, is_active: true });
    expect(cred.secret_ref.startsWith('whatsapp_accounts:')).toBe(true);
    const routed = (await prod.db.executeQuery(sql<{ business_id: string }>`select business_id::text as business_id from resolve_tenant('whatsapp', ${PNID})`.compile(prod.db))).rows[0];
    expect(routed?.business_id).toBe(BIZ);
    const after = await prod.app.inject({ method: 'GET', url: '/app/channels/whatsapp', headers: { cookie } });
    expect(after.body).toContain('Tienda Sol');
    expect(after.body).toContain(t('en', 'channel.wa.nameStatus.PENDING_REVIEW'));
  }, 60_000);

  it('A CUSTOMER\'S MESSAGE to that number reaches this business; the reply leaves FROM it, with its own token', async () => {
    const r = await toOwnNumber(sim.inboundText({ from: CUSTOMER, text: 'hola, ¿tienen envío a Valencia?' }));
    expect(r.statusCode).toBe(200);
    const conv = await until(() => tx((x) => sql<{ id: string }>`
      select c.id::text as id from conversations c join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
       where c.business_id = ${BIZ} and cc.channel_user_id = ${CUSTOMER}`.execute(x)).then((q) => q.rows[0]), 'the conversation');

    // Live, and open to every customer (pilot mode ended — below it is shown on its own).
    await tx((x) => sql`update channels set activated_at = now(), activated_by = 'test', pilot_mode = false where business_id = ${BIZ} and kind = 'whatsapp'`.execute(x));
    // The owner answers themselves: the conversation is taken first, as any reply of theirs needs.
    expect((await post(`/app/inbox/${conv.id}/takeover`)).statusCode).toBe(302);
    const before = sends.length;
    const reply = await post(`/app/inbox/${conv.id}/reply`, { text: 'Sí, enviamos a Valencia en 48 horas.' });
    expect(reply.statusCode).toBe(302);
    const sent = await until(async () => sends.slice(before).find((s) => s.body.includes('Valencia')), 'the send');
    expect(sent.url).toBe(`https://graph.facebook.com/v23.0/${PNID}/messages`);
    expect(sent.auth).toBe('Bearer business-token-not-real');
    expect(sim.sendCount()).toBe(0);   // never the installation's number
    // Meta's receipt, to the same number: the next reply is not held for one.
    expect((await toOwnNumber(sim.status(sent.id, 'delivered'))).statusCode).toBe(200);
  }, 60_000);

  it('WA-S · AFTER THE 24 HOURS: the reopening template is asked of Meta and read back approved; a reply then goes as it, in the customer\'s language, and the words wait in the box', async () => {
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { esc } = await import('../../src/api/web/layout.js');
    expect((await prod.app.inject({ method: 'GET', url: '/app/channels/whatsapp', headers: { cookie } })).body).toContain('action="/app/channels/whatsapp/templates/submit"');
    const sub = await post('/app/channels/whatsapp/templates/submit');
    expect(flashSaid(sub, SECRET)).toBe(t('en', 'channel.wa.template.flash.submitted', { n: '2' }));
    expect(asked.sort()).toEqual(['en', 'es']);
    const pending = await tx((x) => sql<{ language: string; status: string }>`select language, status from whatsapp_templates where business_id = ${BIZ} and archived_at is null order by language`.execute(x));
    expect(pending.rows).toEqual([{ language: 'en', status: 'PENDING' }, { language: 'es', status: 'PENDING' }]);
    // Nothing is approved yet: a reply after the 24 hours is still refused before it is queued.
    const conv = (await tx((x) => sql<{ id: string; client: string }>`select id::text as id, client_id::text as client from conversations where business_id = ${BIZ} limit 1`.execute(x))).rows[0]!;
    await tx(async (x) => {
      await sql`update client_channels set last_inbound_at = now() - interval '3 days' where client_id = ${conv.client}::uuid and channel = 'whatsapp'`.execute(x);
      await sql`update clients set preferred_language = 'es' where id = ${conv.client}::uuid`.execute(x);
    });
    expect(flashSaid(await post(`/app/inbox/${conv.id}/reply`, { text: 'Tenemos la talla M.' }), SECRET)).toBe(t('en', 'inbox.blocked.window_closed'));

    expect(flashSaid(await post('/app/channels/whatsapp/templates/check'), SECRET)).toBe(t('en', 'channel.wa.template.flash.checked'));
    expect((await prod.app.inject({ method: 'GET', url: '/app/channels/whatsapp', headers: { cookie } })).body).toContain(esc(t('en', 'channel.wa.template.status.APPROVED')));

    const before = sends.length;
    const r = await post(`/app/inbox/${conv.id}/reply`, { text: 'Tenemos la talla M.' });
    expect(flashSaid(r, SECRET)).toBe(t('en', 'inbox.flash.reopening'));
    const sent = await until(async () => sends.slice(before).find((x) => x.body.includes('"template"')), 'the template');
    expect(sent.auth).toBe('Bearer business-token-not-real');
    expect(JSON.parse(sent.body).template).toEqual({ name: 'nomi_reply_waiting', language: { code: 'es' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Tienda Sol' }] }] });
    expect(sends.slice(before).some((x) => x.body.includes('talla M'))).toBe(false);   // never the free text
    const row = await until(() => tx((x) => sql<{ body: string; kept: string | null }>`
      select o.body, c.owner_unsent_reply as kept from outbound_messages o join conversations c on c.id = o.conversation_id
       where o.business_id = ${BIZ} and o.provider_message_id = ${sent.id}`.execute(x)).then((q) => q.rows[0]), 'the row');
    expect(row.body).toContain('Tienda Sol');
    expect(row.kept).toBe('Tenemos la talla M.');
    // Meta's receipt; and the customer is back within the 24 hours for what follows.
    expect((await toOwnNumber(sim.status(sent.id, 'delivered'))).statusCode).toBe(200);
    await tx((x) => sql`update client_channels set last_inbound_at = now() where client_id = ${conv.client}::uuid and channel = 'whatsapp'`.execute(x));
  }, 60_000);

  it('A TOKEN META NO LONGER ACCEPTS is marked once; the next reply sends nothing, and the page asks to connect again', async () => {
    const conv = (await tx((x) => sql<{ id: string }>`select id::text as id from conversations where business_id = ${BIZ} limit 1`.execute(x))).rows[0]!;
    sendStatus = 401;
    await post(`/app/inbox/${conv.id}/reply`, { text: 'Un dato más.' });
    await until(async () => sends.find((x) => x.body.includes('Un dato más')), 'the refused send');
    await until(() => tx((x) => sql<{ e: string | null }>`select last_error as e from whatsapp_accounts where business_id = ${BIZ} and archived_at is null`.execute(x))
      .then((q) => (q.rows[0]?.e === 'revoked' ? true : undefined)), 'the mark');
    sendStatus = 200;
    const before = sends.length;
    await post(`/app/inbox/${conv.id}/reply`, { text: 'Y otro.' });
    const refused = await until(() => tx((x) => sql<{ reason: string }>`
      select detail->>'reason' as reason from channel_audit where business_id = ${BIZ} and action = 'send_refused' order by id desc limit 1`.execute(x))
      .then((q) => q.rows[0]), 'the refusal');
    expect(refused.reason).toBe('channel_unavailable');
    expect(sends.length).toBe(before);
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { esc } = await import('../../src/api/web/layout.js');
    expect((await prod.app.inject({ method: 'GET', url: '/app/channels/whatsapp', headers: { cookie } })).body).toContain(esc(t('en', 'channel.wa.needsAttention')));
  }, 60_000);

  it('PILOT MODE ends and comes back only on a live WhatsApp, on the audit trail', async () => {
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    await tx((x) => sql`update channels set activated_at = null, pilot_mode = true where business_id = ${BIZ} and kind = 'whatsapp'`.execute(x));
    expect(flashSaid(await post('/app/business/pilot/end'), SECRET)).toBe(t('en', 'pilot.flash.not_active'));
    await tx((x) => sql`update channels set activated_at = now(), activated_by = 'test' where business_id = ${BIZ} and kind = 'whatsapp'`.execute(x));
    expect(flashSaid(await post('/app/business/pilot/end'), SECRET)).toBe(t('en', 'pilot.flash.ended'));
    const mode = async () => (await tx((x) => sql<{ p: boolean }>`select pilot_mode as p from channels where business_id = ${BIZ} and kind = 'whatsapp'`.execute(x))).rows[0]!.p;
    expect(await mode()).toBe(false);
    expect(flashSaid(await post('/app/business/pilot/resume'), SECRET)).toBe(t('en', 'pilot.flash.resumed'));
    expect(await mode()).toBe(true);
    const verbs = (await tx((x) => sql<{ action: string }>`select action from channel_audit where business_id = ${BIZ} and action in ('pilot_ended', 'pilot_resumed') order by id`.execute(x))).rows.map((r) => r.action);
    expect(verbs).toEqual(['pilot_ended', 'pilot_resumed']);
  }, 60_000);

  it('DISCONNECT: the credential is switched off and the row archived; customers\' messages to the number no longer route', async () => {
    const r = await post('/app/connect/whatsapp/disconnect');
    expect(r.statusCode).toBe(302);
    expect(metaCalls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/${WABA}/subscribed_apps`))).toBe(true);
    const routed = (await prod.db.executeQuery(sql<{ business_id: string }>`select business_id::text as business_id from resolve_tenant('whatsapp', ${PNID})`.compile(prod.db))).rows;
    expect(routed).toHaveLength(0);
    expect((await tx((x) => sql`select 1 from whatsapp_accounts where business_id = ${BIZ} and archived_at is null`.execute(x))).rows).toHaveLength(0);
  }, 60_000);
});
