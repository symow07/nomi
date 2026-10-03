import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID, createECDH, createHmac, createDecipheriv, generateKeyPairSync } from 'node:crypto';
import { runDigits, flashSaid } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { Analysis } from '../../src/core/conversation/decide.js';

/**
 * G5b — ALERTS ON THE OWNER'S PHONE, AND A REPLY THAT WAITED TOO LONG, in
 * production's own composition, with a push service that only records what
 * it is sent and a phone (the test) that opens it with its own key.
 *
 *   · The phone's worker, the manifest and the icons are served to anyone.
 *   · Alerts are turned on from the page. Phase 8 of the warmth run: the
 *     owner chooses Browser on Notifications; a waiting reply then stays in
 *     the app, and a customer handed over reaches the phone, encrypted to it,
 *     with the conversation it opens.
 *   · A phone the push service says is gone is archived; one the owner stops
 *     is archived too; a test alert reaches the phones that are on.
 *   · A reply waiting past the day its channel allows is marked expired, and
 *     the page shows it for what it was.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd9b0000-0000-4000-8000-${RUN}0001`;
const KEY = 'a'.repeat(64);
const BASE = 'https://app.example.test';

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 60_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

/** A phone: its push address, its keys, and how it opens what it is sent. */
function phone(name: string) {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const auth = Buffer.alloc(16, name.length);
  const endpoint = `https://push.example.test/${name}-${RUN}`;
  return {
    endpoint,
    subscription: JSON.stringify({ endpoint, expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } }),
    open(message: Buffer): Record<string, unknown> {
      const salt = message.subarray(0, 16);
      const idLength = message.readUInt8(20);
      const sender = message.subarray(21, 21 + idLength);
      const shared = ecdh.computeSecret(sender);
      const hk = (s: Buffer, k: Buffer, info: Buffer, n: number) =>
        createHmac('sha256', createHmac('sha256', s).update(k).digest()).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, n);
      const ikm = hk(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), sender]), 32);
      const dec = createDecipheriv('aes-128-gcm', hk(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hk(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12));
      const record = message.subarray(21 + idLength);
      dec.setAuthTag(record.subarray(record.length - 16));
      const padded = Buffer.concat([dec.update(record.subarray(0, record.length - 16)), dec.final()]);
      return JSON.parse(padded.subarray(0, padded.length - 1).toString('utf8'));
    },
  };
}

d('G5b · alerts on the phone, and a reply that waited too long (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let cookie = '';
  let webSecret = '';
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();
  /** What the push service was asked, and what it answers per address. */
  const pushed: { url: string; headers: Record<string, string>; body: Buffer }[] = [];
  const answer = new Map<string, number>();
  const mine = phone('mona');
  const old = phone('old');

  const q = async <R>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };
  const post = (url: string, form: Record<string, string>) => prod.app.inject({
    method: 'POST', url, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(form).toString() });
  const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });
  const phones = () => q((tx) => sql<{ endpoint: string; archived_reason: string | null }>`
    select endpoint, archived_reason from push_subscriptions where business_id = ${BIZ}::uuid order by created_at`.execute(tx).then((r) => r.rows));

  beforeAll(async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    process.env['VAPID_PUBLIC_KEY'] = publicKey.export({ format: 'der', type: 'spki' }).subarray(-65).toString('base64url');
    process.env['VAPID_PRIVATE_KEY'] = (privateKey.export({ format: 'jwk' }) as { d: string }).d;
    process.env['VAPID_SUBJECT'] = 'mailto:alerts@example.test';
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    webSecret = createHmac('sha256', KEY).update('yf-web-session').digest('hex');
    sim = whatsappSimulator([], { tag: `ph${RUN}` });
    const setup = createDb(DATABASE_URL!);
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    await withTenantTx(setup, b.value, async (t) => {
      await sql`insert into businesses (id, name, engine, kind, owner_locale) values (${BIZ}, 'Phone Studio', 'service', 'brand', 'en') on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 10000 where id = ${BIZ}`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                values (${BIZ}, 'whatsapp', 'connected', '+971 50****0198', now(), now(), 'test', false)`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
      // Every workspace has its owner's row (0035, sign-up): Notifications keeps the owner's way on it.
      await sql`insert into people (business_id, name, is_owner) values (${BIZ}, 'Mona', true)`.execute(t);
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'ph-verify-token-xxxx', CREDENTIAL_KEY: KEY, PORT: 0,
      PUBLIC_BASE_URL: BASE,
    }, {
      adapter: sim.adapter, logger: false, media: {}, models: { analyzer, replyWriter },
      pushFetch: async (url, init) => { pushed.push({ url, headers: init.headers, body: init.body }); return { status: answer.get(url) ?? 201 }; },
    });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  }, 60_000);
  afterAll(async () => {
    for (const k of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) delete process.env[k];
    await prod?.close();
  });

  it('WHAT A PHONE NEEDS is served to anyone: the worker, the manifest, the icons', async () => {
    const sw = await prod.app.inject({ method: 'GET', url: '/sw.js' });
    expect(sw.statusCode).toBe(200);
    expect(sw.headers['content-type']).toMatch(/javascript/);
    expect(sw.headers['cache-control']).toBe('no-cache');
    expect(sw.body).toContain('showNotification(');
    const manifest = await prod.app.inject({ method: 'GET', url: '/manifest.webmanifest' });
    expect(JSON.parse(manifest.body)).toMatchObject({ name: 'Nomi', start_url: '/app' });
    const icon = await prod.app.inject({ method: 'GET', url: '/assets/icon-512.png' });
    expect(icon.headers['content-type']).toBe('image/png');
    expect(icon.rawPayload.subarray(1, 4).toString()).toBe('PNG');
    expect((await get('/app')).body).toContain('<link rel="manifest" href="/manifest.webmanifest">');
  });

  it('TURNED ON FROM THE PAGE and chosen on Notifications, a hand-over reaches the phone — encrypted to it, with the conversation it opens; a waiting reply does not', async () => {
    const page = await get('/app/settings/alerts');
    expect(page.body).toContain(`data-push-key="${process.env['VAPID_PUBLIC_KEY']}"`);
    const on = await post('/app/settings/alerts/phone', { subscription: mine.subscription, device: 'Mona’s iPhone' });
    // The warmth run, phase 9 (w4-settings-a-06) — one name: notifications.
    expect(flashSaid(on, webSecret)).toContain('Notifications are on for this phone.');
    // The same phone again is still one phone.
    await post('/app/settings/alerts/phone', { subscription: mine.subscription, device: 'Mona’s iPhone' });
    expect(await phones()).toEqual([{ endpoint: mine.endpoint, archived_reason: null }]);
    // Not a push address: refused, nothing kept.
    const bad = await post('/app/settings/alerts/phone', { subscription: JSON.stringify({ endpoint: 'http://push.example.test/x', keys: { p256dh: 'a', auth: 'b' } }) });
    expect(flashSaid(bad, webSecret)).toContain('could not be added');
    expect(await phones()).toHaveLength(1);

    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification', wantsPerson: false,
    } satisfies Analysis;
    // Phase 8 — Browser is chosen on the same page; the choice is the owner's own row.
    const chose = await post('/app/settings/alerts/channel', { channel: 'browser' });
    expect(chose.statusCode).toBe(302);
    expect(await q((tx) => sql<{ way: string | null }>`select alert_channel as way from people
      where business_id = ${BIZ}::uuid and is_owner`.execute(tx).then((r) => r.rows[0]!.way))).toBe('browser');

    replyWriter.replies = ['Yes, we ship to Dubai.'];
    const quiet = `9715${runDigits(RUN, 6)}3`;
    const wq = sim.inboundText({ from: quiet, text: 'Do you ship to Dubai?' });
    expect((await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: wq.rawBody,
      headers: { 'content-type': 'application/json', ...wq.headers } })).statusCode).toBe(200);
    await until(() => q((tx) => sql<{ n: number }>`select count(*)::int as n from drafts d join conversations c on c.id = d.conversation_id
      join clients cl on cl.id = c.client_id where c.business_id = ${BIZ}::uuid and cl.phone like ${`%${quiet}`}`
      .execute(tx).then((r) => (r.rows[0]!.n > 0 ? true : undefined))), 'the waiting reply');
    await new Promise((r) => setTimeout(r, 2000));
    // A waiting reply waits in the app (the owner's rule, 2026-10-03): nothing reached the phone.
    expect(pushed.filter((p) => p.url === mine.endpoint)).toHaveLength(0);

    const from = `9715${runDigits(RUN, 6)}1`;
    const w = sim.inboundText({ from, text: 'Can I talk to a real person please?' });
    expect((await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } })).statusCode).toBe(200);
    const sent = await until(async () => pushed.find((p) => p.url === mine.endpoint), 'the alert on the phone');
    expect(sent.headers['Content-Encoding']).toBe('aes128gcm');
    expect(sent.headers['Authorization']).toMatch(/^vapid t=.+, k=/);
    const said = mine.open(sent.body);
    const conv = await q((tx) => sql<{ id: string }>`select c.id::text as id from conversations c join clients cl on cl.id = c.client_id
      where c.business_id = ${BIZ}::uuid and cl.phone like ${`%${from}`}`.execute(tx).then((r) => r.rows[0]!.id));
    expect(said).toEqual({ title: 'A customer is waiting for you', body: expect.stringContaining('a customer wants to talk to a person'), url: `${BASE}/app/inbox/${conv}#latest` });
  }, 120_000);

  it('A PHONE THE PUSH SERVICE SAYS IS GONE is archived; a test reaches the phones that are on; the owner stops one', async () => {
    await post('/app/settings/alerts/phone', { subscription: old.subscription, device: 'Old Android' });
    answer.set(old.endpoint, 410);
    const before = pushed.length;
    const test = await post('/app/settings/alerts/test', {});
    expect(flashSaid(test, webSecret)).toContain('Test notification sent.');
    expect(pushed.slice(before).map((p) => p.url).sort()).toEqual([mine.endpoint, old.endpoint].sort());
    expect(mine.open(pushed.slice(before).find((p) => p.url === mine.endpoint)!.body)).toMatchObject({ title: 'Nomi', body: 'Alerts on this phone are on.' });
    expect(await phones()).toEqual([
      { endpoint: mine.endpoint, archived_reason: null },
      { endpoint: old.endpoint, archived_reason: 'gone' },
    ]);
    const id = await q((tx) => sql<{ id: string }>`select id::text as id from push_subscriptions where endpoint = ${mine.endpoint}`.execute(tx).then((r) => r.rows[0]!.id));
    const stop = await post(`/app/settings/alerts/phone/${id}/remove`, {});
    expect(flashSaid(stop, webSecret)).toContain('Notifications stopped for that phone.');
    expect((await phones())[0]).toEqual({ endpoint: mine.endpoint, archived_reason: 'removed' });
    expect(flashSaid(await post('/app/settings/alerts/test', {}), webSecret)).toContain('No phone received it.');
  });

  it('A REPLY THAT WAITED PAST THE CHANNEL\'S DAY is marked expired, and the page shows it for what it was', async () => {
    const { expireWaitingDrafts } = await import('../../src/db/practice.js');
    replyWriter.replies = ['The blue one is back on Friday.'];
    const from = `9715${runDigits(RUN, 6)}2`;
    const w = sim.inboundText({ from, text: 'When is the blue one back?' });
    expect((await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } })).statusCode).toBe(200);
    const conv = await until(() => q((tx) => sql<{ id: string }>`
      select c.id::text as id from conversations c join clients cl on cl.id = c.client_id
       where c.business_id = ${BIZ}::uuid and cl.phone like ${`%${from}`}
         and exists (select 1 from drafts d where d.conversation_id = c.id and d.status = 'pending')`.execute(tx).then((r) => r.rows[0]?.id)), 'the waiting reply');
    // Still inside the day: nothing expires.
    await expireWaitingDrafts(prod.db);
    const status = () => q((tx) => sql<{ status: string }>`select status from drafts where conversation_id = ${conv}::uuid`.execute(tx).then((r) => r.rows.map((x) => x.status)));
    expect(await status()).toEqual(['pending']);
    // The customer last wrote 25 hours ago.
    await q((tx) => sql`update client_channels set last_inbound_at = now() - interval '25 hours'
      where channel = 'whatsapp' and channel_user_id like ${`%${from}`}`.execute(tx));
    expect(await expireWaitingDrafts(prod.db)).toBeGreaterThanOrEqual(1);
    expect(await status()).toEqual(['expired']);
    const page = await get(`/app/inbox/${conv}`);
    expect(page.body).toContain('This reply was not sent');
    expect(page.body).toContain('The blue one is back on Friday.');
    expect(page.body).toContain('write to them in the WhatsApp app');
  }, 120_000);
});
