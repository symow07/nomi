import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID, createHmac } from 'node:crypto';
import { flashSaid, runDigits } from './tenant.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * 0071 — the emergency silence hides nobody (2026-09-27).
 *
 * The ops kill switch (`ops_flags.global_silence`) stopped the assistant
 * speaking and did only that: a buyer who wrote during it got no draft and no
 * handoff, so the conversation never reached "Needs you". The owner's
 * decision: the same behaviour as the owner's Stop (0070) — buyers still
 * arrive, are still visible, are still on "Needs you".
 *
 *   WAITING — while silenced: recorded, visible, handed to a person under its
 *             own reason, on Needs you and Today; no turn, no draft, nothing
 *             queued. Cleared: the next buyer is answered; the one who waited
 *             stays with the owner.
 *   DOOR    — while silenced, hand-back and approve/edit are refused and the
 *             buyer stays on Needs you; My business says what is true.
 *
 * The switch is written as ops writes it — through the admin connection, since
 * the application role may only read `ops_flags` — and only ever for this
 * file's own businesses: a platform-wide row would silence every other test.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

const bidOf = async (raw: string) => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
};
const inTenant = async <R>(db: Db, biz: string, fn: (tx: Tx) => Promise<R>): Promise<R> => {
  const { withTenantTx } = await import('../../src/db/client.js');
  return withTenantTx(db, await bidOf(biz), fn);
};
const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 30_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

/** The ops switch, set and cleared the way ops does it — as the table owner. */
const opsSwitch = async (biz: string, on: boolean): Promise<void> => {
  const pg = (await import('pg')).default;
  const ops = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] });
  await ops.connect();
  try {
    if (on) {
      await ops.query(`insert into ops_flags (business_id, flag, reason, set_by) values ($1, 'global_silence', '0071 test', 'test')`, [biz]);
    } else {
      await ops.query(`update ops_flags set cleared_at = now() where business_id = $1 and flag = 'global_silence' and cleared_at is null`, [biz]);
    }
  } finally {
    await ops.end();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
d('Silence · WAITING — the emergency switch hides nobody (requires DATABASE_URL)', { timeout: 40_000 }, () => {
  const BIZ = `dd7b0000-0000-4000-8000-${RUN}0001`;
  const A = `9717${runDigits(RUN, 6)}1`;
  const B = `9717${runDigits(RUN, 6)}2`;
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let cookie = '';
  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = ['Thanks — which size are you looking for?'];

  const q = <T>(fn: (tx: Tx) => Promise<T>) => inTenant(prod.db, BIZ, fn);
  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });
  const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });
  const convOf = (wa: string) => until(() => q((tx) => sql<{ id: string }>`
    select c.id::text as id from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
     where cc.channel_user_id = ${wa} and c.is_active limit 1`.execute(tx).then((r) => r.rows[0]?.id)), `conversation of ${wa}`);
  const assigned = (conv: string) => q((tx) => sql<{ a: string | null }>`
    select assigned_to as a from conversations where id = ${conv}::uuid`.execute(tx).then((r) => r.rows[0]?.a ?? null));
  const usage = () => q((tx) => sql<{ turns: number; calls: number }>`
    select coalesce(sum(turns), 0)::int as turns, coalesce(sum(llm_calls), 0)::int as calls
      from usage_ledger where business_id = ${BIZ}::uuid`.execute(tx).then((r) => r.rows[0]!));

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    sim = whatsappSimulator([], { tag: `sil${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, await bidOf(BIZ), async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Silence Waiting', 'service')
                on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 1000 where id = ${BIZ}`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at)
                values (${BIZ}, 'whatsapp', 'connected', '+86 579****0071', now())`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta',
      DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'sil-verify-token-xx',
      CREDENTIAL_KEY: 'b'.repeat(64),
      PORT: 0,
    }, { adapter: sim.adapter, logger: false, models: { analyzer, replyWriter } });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: FORM,
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
    await opsSwitch(BIZ, true);
  }, 60_000);
  afterAll(async () => { await opsSwitch(BIZ, false).catch(() => {}); await prod?.close(); });

  let convA = '';

  it('WAITING · a buyer who writes during the silence ARRIVES and is VISIBLE', async () => {
    expect((await post(sim.inboundText({ from: A, text: 'Is anyone there?' }))).statusCode).toBe(200);
    convA = await convOf(A);
    await until(() => q((tx) => sql<{ n: number }>`
      select count(*)::int as n from messages where conversation_id = ${convA}::uuid and direction = 'inbound'`
      .execute(tx).then((r) => (r.rows[0]!.n > 0 ? true : undefined))), 'his message on the timeline');
    expect((await get(`/app/inbox/${convA}`)).body).toContain('Is anyone there?');
  });

  it('WAITING · …on NEEDS YOU, under its own reason, and TODAY says sending is paused', async () => {
    await until(async () => ((await assigned(convA)) !== null ? true : undefined), 'the handoff');
    expect((await get('/app/inbox?filter=pending')).body).toContain(`/app/inbox/${convA}`);
    const kinds = await q((tx) => sql<{ kind: string }>`
      select kind from conversation_signals where conversation_id = ${convA}::uuid and resolved_at is null`
      .execute(tx).then((r) => r.rows.map((x) => x.kind)));
    expect(kinds).toContain('ops_silenced');
    expect(kinds).not.toContain('assistant_stopped');   // the owner pressed nothing
    const today = (await get('/app')).body;
    expect(today).toContain('is paused');
    // The design pass: the one handed over is named on Today, a door to the newest message.
    // The warmth run — the band's heading, in the owner's words, with the waiting ○ (was nav.needsYou).
    expect(today).toContain(`<h2 id="today-now" class="tw-head"><span class="tw-need"><span class="dot warn" aria-hidden="true">○</span> 1 waiting for you</span></h2>`);
    expect(today).toContain(`href="/app/inbox/${convA}#latest"`);
  });

  it('WAITING · silent: no turn, no model call, no draft, nothing queued — a photo is named, not opened', async () => {
    expect((await post(sim.inboundImage({ from: A, caption: 'this one?' }))).statusCode).toBe(200);
    await until(() => q((tx) => sql<{ received: string | null }>`
      select ai_analysis->>'received' as received from messages
       where conversation_id = ${convA}::uuid and input_type = 'unknown' limit 1`
      .execute(tx).then((r) => r.rows[0]?.received ?? undefined)), 'the photo, named');
    expect(await usage()).toEqual({ turns: 0, calls: 0 });
    const counts = await q((tx) => sql<{ drafts: number; outbound: number }>`
      select (select count(*)::int from drafts where conversation_id = ${convA}::uuid) as drafts,
             (select count(*)::int from outbound_messages where conversation_id = ${convA}::uuid) as outbound`
      .execute(tx).then((r) => r.rows[0]!));
    expect(counts).toEqual({ drafts: 0, outbound: 0 });
  });

  it('WAITING · cleared: the next buyer is answered; the one who waited stays with the owner', async () => {
    await opsSwitch(BIZ, false);
    expect((await post(sim.inboundText({ from: B, text: 'Do you make canvas bags?' }))).statusCode).toBe(200);
    const convB = await convOf(B);
    await until(() => q((tx) => sql<{ n: number }>`
      select count(*)::int as n from drafts where conversation_id = ${convB}::uuid`
      .execute(tx).then((x) => (x.rows[0]!.n > 0 ? true : undefined))), 'a draft for the new buyer');
    // The turn's cost is written in a transaction of its own, just AFTER the
    // turn commits (T7: so a turn that fails after paying is still on the
    // ledger) — the draft can be seen a moment before it. Asserted straight
    // after the draft, this failed on CI's second pass (2026-09-30): wait for it.
    await until(async () => ((await usage()).turns > 0 ? true : undefined), 'the turn on the ledger');
    expect(await assigned(convA)).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
d('Silence · DOOR — nothing takes a waiting buyer off Needs you during the silence (requires DATABASE_URL)', () => {
  const BIZ = `dd7b0000-0000-4000-8000-${RUN}0002`;
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let cookie = '';
  let held = '';
  let drafted = '';
  const kicked: string[] = [];
  const post = (url: string, fields: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await inTenant(db, BIZ, (tx) => sql`insert into businesses (id, name, owner_locale, channels_used)
                                        values (${BIZ}, 'Silence Door', 'en', '{instagram}'::text[])
                                        on conflict (id) do nothing`.execute(tx));
    await inTenant(db, BIZ, async (tx) => {
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
                values (${BIZ}, 'instagram', ${`ig-sil-${RUN}`}, 'sil-secret', 'service', true)`.execute(tx);
      const bid = await bidOf(BIZ);
      const h = await ensureConversation(tx, bid, `ig-sil-held-${RUN}`, 'Held Buyer', 'instagram');
      const g = await ensureConversation(tx, bid, `ig-sil-draft-${RUN}`, 'Draft Buyer', 'instagram');
      held = h.conversationId; drafted = g.conversationId;
      await sql`update client_channels set last_inbound_at = now() - interval '1 minute'
                 where client_id in (${h.clientId}, ${g.clientId})`.execute(tx);
      await sql`update conversations set assigned_to = 'unclaimed' where id = ${held}::uuid`.execute(tx);
      await sql`update conversations set assigned_to = null where id = ${drafted}::uuid`.execute(tx);
      await sql`insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
                values (${BIZ}, ${drafted}, 'quote', 'Written before the silence', null, 'pending')`.execute(tx);
    });
    app = Fastify({ logger: false });
    const code = `sil-door-${RUN}`;
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: true, instagramAccountId: `ig-sil-${RUN}`,
      kickOutbound: async (_b: string, c: string) => { kicked.push(c); }, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${code}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
    await opsSwitch(BIZ, true);
  }, 60_000);
  afterAll(async () => { await opsSwitch(BIZ, false).catch(() => {}); await app?.close(); await db?.destroy(); });

  it('DOOR · handing a conversation back is refused, and the buyer stays on Needs you', async () => {
    const r = await post(`/app/inbox/${held}/resume`);
    expect(flashSaid(r, SECRET)).toContain('is paused while we check something, so this conversation stays with you');
    expect((await get('/app/inbox?filter=pending')).body).toContain(`/app/inbox/${held}`);
  });

  it('DOOR · approving or editing a draft is refused; the draft stays pending, on Needs you', async () => {
    const draftId = await inTenant(db, BIZ, (tx) => sql<{ id: string }>`
      select id::text as id from drafts where conversation_id = ${drafted}::uuid`.execute(tx).then((x) => x.rows[0]!.id));
    for (const fields of [{ draftId, command: '发送' }, { draftId, command: '改', edit: 'My own words' }]) {
      const r = await post(`/app/inbox/${drafted}/act`, fields);
      expect(flashSaid(r, SECRET)).toContain('so this draft was not sent');
    }
    const status = await inTenant(db, BIZ, (tx) => sql<{ s: string }>`
      select status as s from drafts where id = ${draftId}::uuid`.execute(tx).then((x) => x.rows[0]!.s));
    expect(status).toBe('pending');
    expect(kicked).toEqual([]);
    expect((await get('/app/inbox?filter=pending')).body).toContain(`/app/inbox/${drafted}`);
  });

  it('DOOR · My business says sending is paused, and nothing says the assistant is answering', async () => {
    // Phase 7 — on its going-live screen; the menu's row says it in a word.
    expect((await get('/app/business')).body).toContain(`<bdi>${t('en', 'business.live.paused')}</bdi>`);
    const html = (await get('/app/business/ready')).body;
    expect(html).toContain('data-golive="silenced"');
    expect(html).toContain('this was not you');
    expect(html).not.toContain('replies go out as soon as they are sent');
    // The owner's own switch still works during the silence.
    expect(html).toContain('action="/app/business/stop-assistant"');
  });

  it('DOOR · when both are set, the reason given is the one the owner did not choose', async () => {
    await post('/app/business/stop-assistant');
    const r = await post(`/app/inbox/${held}/resume`);
    expect(flashSaid(r, SECRET)).toContain('is paused while we check something');
    await post('/app/business/start-assistant');
  });
});
