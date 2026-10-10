import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * Fix 1 (2026-10-10) — "someone from our team will reply" REACHES the buyer
 * who asked for a person. Through the production composition, every
 * capability on auto: a signed webhook, the real turn, the outbound job, the
 * real worker and gate, the simulator's provider.
 *
 * Before the fix the turn handed the conversation to a person and queued the
 * sentence in the same breath, and the worker cancelled it as `handed_off`:
 * every buyer who asked for a person heard nothing. The same path carries the
 * line that answers a stop (0135), here end to end in auto too.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd8e0000-0000-4000-8000-${RUN}0001`;

type Tx = import('../../src/db/client.js').Tx;

const bidOf = async (raw: string) => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
};
const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 90_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};
const n = (i: number) => `9716${runDigits(RUN, 5)}${String(i).padStart(2, '0')}`;
let next = 0;
const buyer = () => n(++next);

d('fix 1 · the hand-off sentence reaches the buyer, through production (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();

  const q = async <T>(fn: (tx: Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, await bidOf(BIZ), fn);
  };
  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });
  const convOf = (wa: string) => until(() => q((tx) => sql<{ id: string }>`
    select c.id::text as id from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
     where cc.channel_user_id = ${wa} and c.is_active limit 1`.execute(tx).then((r) => r.rows[0]?.id)), `conversation of ${wa}`);
  const rows = (conv: string) => q((tx) => sql<{ body: string; status: string; notice: string | null; cancel_reason: string | null }>`
    select body, status, notice, cancel_reason from outbound_messages where conversation_id = ${conv}::uuid order by seq`
    .execute(tx).then((r) => r.rows));
  const settled = (conv: string, what: string) => until(async () => {
    const r = await rows(conv);
    return r.length > 0 && r.every((x) => x.status !== 'queued' && x.status !== 'sending') ? r : undefined;
  }, what);

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    sim = whatsappSimulator([], { tag: `hnd${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, await bidOf(BIZ), async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Handoff Notice', 'service')
                on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 1000 where id = ${BIZ}`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                values (${BIZ}, 'whatsapp', 'connected', '+86 579****0001', now(), now(), 'test', false)`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      for (const cap of ['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up']) {
        await sql`insert into autonomy_policy (business_id, capability, mode) values (${BIZ}, ${cap}, 'auto')
                  on conflict (business_id, capability) do update set mode = 'auto'`.execute(t);
      }
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
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
      WEBHOOK_VERIFY_TOKEN: 'hnd-verify-token-xx',
      CREDENTIAL_KEY: 'd'.repeat(64),
      PORT: 0,
    }, {
      adapter: sim.adapter, logger: false, models: { analyzer, replyWriter },
      // A workspace that sends alone (as deletion-handoff.test.ts says, a rehearsal of the open gate).
      autonomyReleased: () => true,
    });
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  it('"Let me talk to a person": the sentence leaves, carrying the disclosure, and the buyer waits for a person', async () => {
    const { HANDOFF_REPLIES } = await import('../../src/core/conversation/templates.js');
    const wa = buyer();
    const before = sim.sendCount();
    expect((await post(sim.inboundText({ from: wa, text: 'Let me talk to a person' }))).statusCode).toBe(200);
    const conv = await convOf(wa);
    const r = await settled(conv, 'the hand-off sentence');
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe('sent');
    expect(r[0]!.notice).toBe('handoff');
    expect(r[0]!.body.endsWith(HANDOFF_REPLIES.en)).toBe(true);     // the first message sent alone carries the disclosure
    expect(sim.sendCount()).toBe(before + 1);
    const c = await q((tx) => sql<{ assigned: string | null; told: Date | null }>`
      select assigned_to as assigned, ai_disclosure_delivered_at as told from conversations where id = ${conv}::uuid`
      .execute(tx).then((x) => x.rows[0]!));
    expect(c.assigned).toBe('unclaimed');
    expect(c.told).not.toBeNull();                                  // it reached them, so they have been told (0079)
  });

  it('"STOP" in auto: the line leaves, and nothing after it', async () => {
    const { OPT_OUT_REPLIES } = await import('../../src/core/safety/optOut.js');
    const wa = buyer();
    expect((await post(sim.inboundText({ from: wa, text: 'STOP' }))).statusCode).toBe(200);
    const conv = await convOf(wa);
    const r = await settled(conv, 'the line');
    expect(r).toEqual([expect.objectContaining({ status: 'sent', notice: 'opt_out' })]);
    expect(r[0]!.body.endsWith(OPT_OUT_REPLIES.en)).toBe(true);
  });

  it('once a person has taken it, a queued hand-off sentence is refused, not sent', async () => {
    const { HANDOFF_REPLIES } = await import('../../src/core/conversation/templates.js');
    const { enqueueOutboundRow, channelStore } = await import('../../src/db/channels.js');
    const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
    const { lockConversation } = await import('../../src/db/client.js');
    const wa = buyer();
    // A buyer the assistant answers as usual first, so the conversation exists.
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification', wantsPerson: false,
    };
    replyWriter.replies = ['Which colour would you like?'];
    expect((await post(sim.inboundText({ from: wa, text: 'Hi, do you have totes?' }))).statusCode).toBe(200);
    const conv = await convOf(wa);
    await settled(conv, 'the first answer');
    await q((tx) => sql`update conversations set assigned_to = 'owner' where id = ${conv}::uuid`.execute(tx));
    const id = await q(async (tx) => { await lockConversation(tx, conv); return enqueueOutboundRow(tx, BIZ as never, conv, HANDOFF_REPLIES.en, 'employee', null, null, 'handoff'); });
    await q((tx) => driveConversationOutbound({ store: channelStore(tx, BIZ as never), adapter: sim.adapter, now: () => new Date() }, conv));
    const row = (await rows(conv)).find((x) => x.notice === 'handoff');
    expect(row).toEqual(expect.objectContaining({ status: 'canceled', cancel_reason: 'canceled: handed_off' }));
    expect(id).not.toBeNull();
  });
});
