import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { Outbox } from './signUpWithCode.js';
// @ts-expect-error — the operator tools, plain JS on purpose (tools/ is not type-checked).
import { attachNumber, Refused } from '../../tools/attach-number.mjs';

/**
 * Decision 1 (A), 2026-10-14 — A WHATSAPP NUMBER BELONGS TO EXACTLY ONE WORKSPACE. The owner's test, over the REAL
 * composition (only Meta faked): attach a spare number to the boss's workspace with the operator tool, write into
 * it, and prove the message cannot land in Westlake's — and the reverse. Two workspaces, two numbers, no crossing:
 *
 *   · in: one customer writes to BOTH numbers; each message lands in its own number's workspace, and only there;
 *   · out: each workspace's reply leaves from its own number — the boss's from the spare one, Westlake's from the
 *     installation's — and never the other's;
 *   · the ways it could cross quietly, each closed and held here: a workspace whose own account is gone is refused,
 *     never answered from the installation's number; a self-serve connect of a number another workspace holds keeps
 *     nothing; disconnecting an attached number never unsubscribes Nomi's own account; the tool refuses every number
 *     that is not free, naming its workspace, and changes nothing.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const WESTLAKE = `ab000000-0000-4000-8000-${RUN}0001`;    // the installation's number, signed in by access code
const OTHER = `ab000000-0000-4000-8000-${RUN}0003`;       // a third workspace, with no number
const CREDENTIAL_KEY = 'e'.repeat(64);
const WABA = `1094${runDigits(RUN, 10)}`;                 // Nomi's own WhatsApp account
const SPARE = `1095${runDigits(RUN, 10)}`;                // the spare number, in Nomi's account
const STRANGER = `1096${runDigits(RUN, 10)}`;             // a number that is not in Nomi's account
const INSTALLATION = `1098${runDigits(RUN, 10)}`;         // the installation's own number (META_WHATSAPP_PHONE_NUMBER_ID)
const CUSTOMER = `3462${runDigits(RUN, 7)}`;              // writes to BOTH numbers
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const INSTALLATION_TOKEN = 'installation-token-not-real-0123456789';

/** Meta's management API, as the tool and the connect see it. */
const metaCalls: { method: string; url: string; body?: string }[] = [];
let spareOnCloudApi = false;
const metaFetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
  metaCalls.push({ method: init.method, url, ...(init.body ? { body: init.body } : {}) });
  const u = new URL(url);
  const json = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) });
  if (u.pathname.endsWith(`/${WABA}/phone_numbers`)) return json(200, { data: [{ id: SPARE, display_phone_number: '+1 555 010 0199', verified_name: 'Boss Bags', name_status: 'APPROVED' }] });
  if (u.pathname.endsWith(`/${SPARE}`)) {
    return json(200, { id: SPARE, display_phone_number: '+1 555 010 0199', verified_name: 'Boss Bags', name_status: 'APPROVED',
      platform_type: spareOnCloudApi ? 'CLOUD_API' : 'NOT_APPLICABLE', status: spareOnCloudApi ? 'CONNECTED' : 'PENDING' });
  }
  if (u.pathname.endsWith(`/${SPARE}/register`)) { spareOnCloudApi = true; return json(200, { success: true }); }
  if (u.pathname.endsWith(`/${WABA}/subscribed_apps`)) return json(200, { success: true });
  return json(404, { error: { code: 100 } });
};

/** Meta's WhatsApp send, for a number with its own account row. */
const sends: { url: string; auth: string; body: string; id: string }[] = [];
const whatsappFetch: import('../../src/channels/whatsapp/client.js').FetchLike = async (url, init) => {
  const id = `wamid.${randomUUID()}`;
  sends.push({ url, auth: init.headers['Authorization'] ?? '', body: init.body, id });
  return { status: 200, text: async () => JSON.stringify({ messages: [{ id }] }) };
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

d('decision 1 · a WhatsApp number belongs to exactly one workspace (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let admin: pg.Client;
  let BOSS = '';
  let westlakeCookie = '';
  let bossCookie = '';
  const outbox: Outbox = [];

  const form = (url: string, fields: Record<string, string>, cookie = '') => prod.app.inject({
    method: 'POST', url, headers: { ...FORM, ...(cookie ? { cookie } : {}) }, payload: new URLSearchParams(fields).toString(),
  });
  const cookieOf = (r: { headers: Record<string, unknown> }, name: string) => ([] as string[])
    .concat(r.headers['set-cookie'] as string | string[] ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith(`${name}=`) && c !== `${name}=`) ?? '';
  /** A webhook from Meta to `number`: the simulator's, re-addressed and re-signed. */
  const toNumber = async (number: string, w: { rawBody: string }) => {
    const { signBody } = await import('../../src/channels/whatsapp/signature.js');
    const { SIMULATOR_SECRET } = await import('../../src/channels/whatsapp/simulator.js');
    const raw = w.rawBody.split(sim.phoneNumberId).join(number);
    return prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: raw,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signBody(raw, SIMULATOR_SECRET) } });
  };
  /** What the customer said, as each workspace has it. */
  const heard = async (business: string) => (await admin.query(
    `select m.text_content as text from messages m join conversations c on c.id = m.conversation_id
       join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
      where c.business_id = $1 and cc.channel_user_id = $2 and m.direction = 'inbound' order by m.sent_at, m.id`,
    [business, CUSTOMER])).rows.map((r) => r.text as string);
  const conversationOf = async (business: string) => (await admin.query(
    `select c.id::text as id from conversations c join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
      where c.business_id = $1 and cc.channel_user_id = $2`, [business, CUSTOMER])).rows[0]?.id as string | undefined;
  const routedTo = async (number: string) => (await admin.query(
    `select business_id::text as id from resolve_tenant('whatsapp', $1)`, [number])).rows.map((r) => r.id as string);
  const rows = async () => (await admin.query(
    `select (select count(*)::int from whatsapp_accounts) as accounts, (select count(*)::int from channel_credentials) as creds,
            (select count(*)::int from channels) as channels, (select count(*)::int from channel_audit) as audit`)).rows[0];
  const attach = async (businessId: string, phoneNumberId: string, o: { register?: boolean; write?: boolean } = {}) => {
    const { deriveKey, encryptSecret, credentialFingerprint } = await import('../../src/security/credentials.js');
    const { newPin } = await import('../../src/channels/whatsapp/embeddedSignup.js');
    const key = deriveKey(CREDENTIAL_KEY);
    return attachNumber({
      client: admin, fetchImpl: metaFetch, businessId, phoneNumberId, register: o.register ?? false, write: o.write ?? true, by: 'test',
      env: { META_WHATSAPP_ACCESS_TOKEN: INSTALLATION_TOKEN, META_WHATSAPP_BUSINESS_ACCOUNT_ID: WABA,
        META_WHATSAPP_PHONE_NUMBER_ID: INSTALLATION, META_GRAPH_API_VERSION: 'v23.0' },
      seal: (plain: string) => encryptSecret(plain, key), fingerprint: credentialFingerprint, newPin,
    });
  };
  const refusal = async (p: Promise<unknown>) => {
    try { await p; } catch (e) { if (e instanceof Refused) return (e as Error).message; throw e; }
    throw new Error('expected a refusal');
  };
  const reply = async (business: string, cookie: string, text: string) => {
    const conv = await conversationOf(business);
    expect(conv, `${business} has the customer`).toBeTruthy();
    expect((await form(`/app/inbox/${conv}/takeover`, {}, cookie)).statusCode).toBe(302);
    return form(`/app/inbox/${conv}/reply`, { text }, cookie);
  };

  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = WESTLAKE;
    process.env['OWNER_ACCESS_CODE'] = `attach-${RUN}`;
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name) values ($1, $2), ($3, $4) on conflict (id) do nothing`,
      [WESTLAKE, `Westlake ${RUN}`, OTHER, `Other ${RUN}`]);
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    sim = whatsappSimulator([], { tag: `an${RUN}` });
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: INSTALLATION_TOKEN,
      META_WHATSAPP_PHONE_NUMBER_ID: INSTALLATION,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: WABA,
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'attach-verify-token',
      CREDENTIAL_KEY, PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, {
      // A turn runs on every message and writes a draft (nothing is granted to go alone): scripted, never a real model.
      models: { analyzer, replyWriter: new FakeReplyWriter() }, adapter: sim.adapter, logger: false, metaFetch, whatsappFetch,
      systemMail: { from: 'no-reply@nomi.test', send: async (m) => { outbox.push(m); return { ok: true }; } },
    });
    // Westlake: the installation's number, connected the way the pilot's was (G3).
    const { connectConfiguredNumber } = await import('../../src/api/web/channels.js');
    expect((await connectConfiguredNumber(prod.db, WESTLAKE, 'test', INSTALLATION)).code).toBe('connected');
    westlakeCookie = cookieOf(await form('/login', { code: prod.ownerAccessCode }), 'yf_session');
    expect(westlakeCookie).not.toBe('');
    // The boss: a workspace made by signing up, with a login of its own.
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const { hashPassword } = await import('../../src/security/password.js');
    const email = `boss-${RUN}@bags.example`;
    const made = await provisionAccount(prod.db, {
      factory: `Boss Bags ${RUN}`, language: 'en', ownerName: 'Boss', email, passwordHash: await hashPassword(`boss-pw-${RUN}`),
      invite: null, inviteRequired: false, termsVersion: 'abcdef012345',
      profile: { kind: 'retail', sells: 'bags', country: 'US', website: null, teamSize: '1', channels: [] },
    });
    if (made.code !== 'created') throw new Error(made.code);
    BOSS = made.businessId;
    let r = await form('/login', { email, password: `boss-pw-${RUN}` });
    if (r.headers['location'] === '/verify') {
      const code = [...outbox].reverse().find((m) => m.to === email)?.subject.match(/\d{6}/)?.[0] ?? '';
      r = await form('/verify', { code }, cookieOf(r, 'yf_otp'));
    }
    bossCookie = cookieOf(r, 'yf_session');
    expect(bossCookie).not.toBe('');
  }, 90_000);

  afterAll(async () => {
    await prod?.close();
    await admin?.end();
  });

  it('THE TOOL REFUSES every number that is not free, says why, and changes nothing', async () => {
    const before = await rows();
    expect(await refusal(attach(BOSS, INSTALLATION))).toMatch(/installation's own number/);
    expect(await refusal(attach(WESTLAKE, SPARE))).toMatch(/already has a WhatsApp number/);
    expect(await refusal(attach(BOSS, STRANGER))).toMatch(/does not list/);
    expect(await refusal(attach(BOSS, SPARE))).toMatch(/--register/);              // not on the Cloud API yet
    expect(metaCalls.some((c) => c.url.endsWith('/register'))).toBe(false);          // and Meta was not touched
    const shown = await attach(BOSS, SPARE, { register: true, write: false });       // the dry run
    expect(shown).toMatchObject({ done: false, registers: true, business: { id: BOSS } });
    expect(await rows()).toEqual(before);
  });

  it('ATTACHED: the spare number routes to the boss\'s workspace only, its token sealed, never in a row as written', async () => {
    const done = await attach(BOSS, SPARE, { register: true });
    expect(done).toMatchObject({ done: true, number: { id: SPARE, display: '+1 555 010 0199', verifiedName: 'Boss Bags' } });
    const reg = metaCalls.find((c) => c.method === 'POST' && c.url.endsWith(`/${SPARE}/register`))!;
    expect(JSON.parse(reg.body!).pin).toMatch(/^[0-9]{6}$/);
    const account = (await admin.query(
      `select waba_id, token_ciphertext, pin_ciphertext from whatsapp_accounts where business_id = $1 and archived_at is null`, [BOSS])).rows[0];
    expect(account.waba_id).toBe(WABA);
    expect(account.token_ciphertext.startsWith('v1.')).toBe(true);
    expect(account.token_ciphertext).not.toContain(INSTALLATION_TOKEN);
    expect(account.pin_ciphertext.startsWith('v1.')).toBe(true);
    expect(await routedTo(SPARE)).toEqual([BOSS]);
    expect(await routedTo(INSTALLATION)).toEqual([WESTLAKE]);
    // Exactly one workspace: the number cannot be attached anywhere else now.
    expect(await refusal(attach(OTHER, SPARE))).toMatch(new RegExp(`belongs to another workspace — Boss Bags ${RUN}`));
    for (const b of [BOSS, WESTLAKE]) {
      await admin.query(`update channels set activated_at = now(), activated_by = 'test', pilot_mode = false where business_id = $1 and kind = 'whatsapp'`, [b]);
    }
  });

  it('IN: one customer writes to both numbers — each message lands in its own number\'s workspace, and only there', async () => {
    expect((await toNumber(SPARE, sim.inboundText({ from: CUSTOMER, text: 'to the boss: 300 tote bags?' }))).statusCode).toBe(200);
    expect((await toNumber(INSTALLATION, sim.inboundText({ from: CUSTOMER, text: 'to Westlake: canvas prints?' }))).statusCode).toBe(200);
    await until(async () => ((await heard(BOSS)).length && (await heard(WESTLAKE)).length ? true : undefined), 'both messages');
    expect(await heard(BOSS)).toEqual(['to the boss: 300 tote bags?']);
    expect(await heard(WESTLAKE)).toEqual(['to Westlake: canvas prints?']);
    expect(await heard(OTHER)).toEqual([]);
  });

  it('OUT: each reply leaves from its own number — the boss\'s from the spare, Westlake\'s from the installation\'s', async () => {
    const simBefore = sim.sendCount();
    const before = sends.length;
    expect((await reply(BOSS, bossCookie, 'Boss here: yes, 300 is fine.')).statusCode).toBe(302);
    const bossSent = await until(async () => sends.slice(before).find((s) => s.body.includes('Boss here')), 'the boss\'s send');
    expect(bossSent.url).toBe(`https://graph.facebook.com/v23.0/${SPARE}/messages`);
    expect(bossSent.auth).toBe(`Bearer ${INSTALLATION_TOKEN}`);
    expect(sim.sendCount()).toBe(simBefore);                                          // never Westlake's number
    // Meta's receipt, to the spare number, once the send is RECORDED — or the next reply waits out the sequencer.
    await until(async () => (await admin.query(`select 1 from outbound_messages where business_id = $1 and provider_message_id = $2`,
      [BOSS, bossSent.id])).rows[0], 'the boss\'s send recorded');
    expect((await toNumber(SPARE, sim.status(bossSent.id, 'delivered'))).statusCode).toBe(200);

    expect((await reply(WESTLAKE, westlakeCookie, 'Westlake here: prints from 50.')).statusCode).toBe(302);
    await until(async () => (sim.requests.some((q) => q.body.includes('Westlake here')) ? true : undefined), 'Westlake\'s send');
    expect(sim.sendCount()).toBe(simBefore + 1);
    expect(sends.some((s) => s.body.includes('Westlake here'))).toBe(false);          // never the spare number
  });

  it('NO FALLBACK: a workspace whose own account is gone is refused — never answered from the installation\'s number', async () => {
    // The state the old self-serve connect could leave, in reverse: the routing row on, the account row gone.
    const account = (await admin.query(`update whatsapp_accounts set archived_at = now(), archived_by = 'test'
      where business_id = $1 and archived_at is null returning id`, [BOSS])).rows[0].id as string;
    try {
      const simBefore = sim.sendCount();
      const before = sends.length;
      await reply(BOSS, bossCookie, 'Boss again: shipping is free.');
      const refused = await until(async () => (await admin.query(
        `select detail->>'reason' as reason from channel_audit where business_id = $1 and action = 'send_refused' order by id desc limit 1`,
        [BOSS])).rows[0], 'the refusal');
      expect(refused.reason).toBe('channel_unavailable');
      expect(sim.sendCount()).toBe(simBefore);
      expect(sends.length).toBe(before);
      expect(sim.requests.some((q) => q.body.includes('Boss again'))).toBe(false);
    } finally {
      await admin.query(`update whatsapp_accounts set archived_at = null, archived_by = null where id = $1`, [account]);
    }
  });

  it('SELF-SERVE CONNECT of a number another workspace holds keeps nothing — no live account sending from it', async () => {
    const { completeWhatsAppConnection } = await import('../../src/channels/whatsapp/connect.js');
    const { deriveKey, encryptSecret } = await import('../../src/security/credentials.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const key = deriveKey(CREDENTIAL_KEY);
    const other = parseBusinessId(OTHER); if (!other.ok) throw new Error('fixture');
    // Westlake's number, in a Meta account of "Other"'s: the credential is Westlake's, no account row holds it.
    const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      const json = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) });
      if (url.includes('/phone_numbers')) return json(200, { data: [{ id: INSTALLATION, display_phone_number: '+1 555 000 0000' }] });
      return init.method === 'POST' ? json(200, { success: true }) : json(404, {});
    };
    const r = await completeWhatsAppConnection(
      { db: prod.db, credentialKey: key, login: { appId: '1', appSecret: 's', configId: '1' }, fetchImpl, graphVersion: 'v23.0' },
      { businessId: other.value, by: 'test', redirectUri: 'https://nomi.test/cb', tokenCiphertext: encryptSecret('other-token-not-real-123456', key), wabaId: '1097000000001', phoneNumberId: INSTALLATION },
    );
    expect(r.outcome).toBe('number_taken');
    expect((await admin.query(`select 1 from whatsapp_accounts where business_id = $1 and archived_at is null`, [OTHER])).rows).toHaveLength(0);
    expect(await routedTo(INSTALLATION)).toEqual([WESTLAKE]);
  });

  it('DISCONNECT of the attached number stops its routing — and never unsubscribes Nomi\'s own account', async () => {
    const { disconnectWhatsAppAccount } = await import('../../src/channels/whatsapp/connect.js');
    const { deriveKey } = await import('../../src/security/credentials.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const boss = parseBusinessId(BOSS); if (!boss.ok) throw new Error('fixture');
    const done = await disconnectWhatsAppAccount(
      { db: prod.db, credentialKey: deriveKey(CREDENTIAL_KEY), login: null, fetchImpl: metaFetch, graphVersion: 'v23.0', installationWabaId: WABA },
      { businessId: boss.value, by: 'test' },
    );
    expect(done).toBe(true);
    expect(metaCalls.some((c) => c.method === 'DELETE' && c.url.includes(`/${WABA}/subscribed_apps`))).toBe(false);
    expect(await routedTo(SPARE)).toEqual([]);
    expect(await routedTo(INSTALLATION)).toEqual([WESTLAKE]);
    // A message to the spare number now lands nowhere; Westlake still hears its own.
    expect((await toNumber(SPARE, sim.inboundText({ from: CUSTOMER, text: 'boss, still there?' }))).statusCode).toBe(200);
    expect((await toNumber(INSTALLATION, sim.inboundText({ from: CUSTOMER, text: 'Westlake, still there?' }))).statusCode).toBe(200);
    await until(async () => ((await heard(WESTLAKE)).includes('Westlake, still there?') ? true : undefined), 'Westlake\'s message');
    expect(await heard(BOSS)).toEqual(['to the boss: 300 tote bags?']);
    expect([...await heard(WESTLAKE)]).not.toContain('boss, still there?');
  });
});
