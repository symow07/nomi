import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { Analysis } from '../../src/core/conversation/decide.js';

/**
 * 0135 — "stop messaging me", through the PRODUCTION composition: a signed
 * WhatsApp webhook, the real worker, Postgres, the real send gate.
 *
 *   · The stop is written down (`opt_outs`, per buyer and channel), the
 *     conversation goes to a person, and the one line waits as a draft
 *     carrying its mark (no capability is on auto here).
 *   · What was on its way is cleared: a reply waiting for approval is
 *     superseded, a queued message refused as `opted_out`.
 *   · The gate: until they write again only the line leaves — the owner's own
 *     reply is refused; after they write, a reply goes, and a first message
 *     still does not. The owner lifts it, on the audit trail.
 *   · "Let me talk to a person" and a stop that asks for one: the ordinary
 *     hand-off, and nothing written down.
 *   · A person holding the conversation, and the assistant stopped: the stop
 *     is written down all the same.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd8c0000-0000-4000-8000-${RUN}0001`;
const ANSWER = 'Thanks — which colour would you like?';

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
const n = (i: number) => `9715${runDigits(RUN, 5)}${String(i).padStart(2, '0')}`;
let next = 0;
const buyer = () => n(++next);

const reads: Analysis = {
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'clarification',
  wantsPerson: false,
};

d('0135 · a buyer who says stop, through production (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  const analyzer = new FakeAnalyzer();
  analyzer.next = reads;
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = [ANSWER];

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
  const state = (conv: string) => q((tx) => sql<{
    assigned: string | null; signals: string[]; pending: { text: string; notice: string | null }[]; superseded: number;
  }>`
    select c.assigned_to as assigned,
           coalesce((select array_agg(s.kind order by s.kind) from conversation_signals s
                      where s.conversation_id = c.id and s.resolved_at is null), '{}') as signals,
           coalesce((select json_agg(json_build_object('text', dd.draft_text, 'notice', dd.notice) order by dd.created_at)
                      from drafts dd where dd.conversation_id = c.id and dd.status = 'pending'), '[]') as pending,
           (select count(*)::int from drafts dd where dd.conversation_id = c.id and dd.status = 'superseded') as superseded
      from conversations c where c.id = ${conv}::uuid`.execute(tx).then((r) => r.rows[0]!));
  const optOutOf = (wa: string) => q((tx) => sql<{ channel: string; asks: number; recorded_by: string; lifted_at: Date | null }>`
    select channel, asks, recorded_by, lifted_at from opt_outs
     where business_id = ${BIZ}::uuid and identity = ${wa} order by created_at`.execute(tx).then((r) => r.rows));
  const send = async (from: string, text: string) => {
    expect((await post(sim.inboundText({ from, text }))).statusCode).toBe(200);
    return convOf(from);
  };
  /** Drive this conversation's queue once, through the production store and gate. */
  const drive = async (conv: string) => {
    const { channelStore } = await import('../../src/db/channels.js');
    const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
    return q((tx) => driveConversationOutbound(
      { store: channelStore(tx, BIZ as never), adapter: sim.adapter, now: () => new Date() }, conv));
  };
  const enqueue = async (conv: string, body: string, origin: 'employee' | 'owner' | 'outreach', notice: 'opt_out' | null = null) => {
    const { enqueueOutboundRow } = await import('../../src/db/channels.js');
    const { lockConversation } = await import('../../src/db/client.js');
    return q(async (tx) => { await lockConversation(tx, conv); return enqueueOutboundRow(tx, BIZ as never, conv, body, origin, null, null, notice); });
  };
  const rowOf = (id: string) => q((tx) => sql<{ status: string; cancel_reason: string | null }>`
    select status, cancel_reason from outbound_messages where id = ${id}::uuid`.execute(tx).then((r) => r.rows[0]!));

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    sim = whatsappSimulator([], { tag: `opt${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, await bidOf(BIZ), async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Opt Out', 'service')
                on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 1000 where id = ${BIZ}`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                values (${BIZ}, 'whatsapp', 'connected', '+86 579****0135', now(), now(), 'test', false)`.execute(t);
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
      WEBHOOK_VERIFY_TOKEN: 'opt-verify-token-xx',
      CREDENTIAL_KEY: 'c'.repeat(64),
      PORT: 0,
    }, { adapter: sim.adapter, logger: false, models: { analyzer, replyWriter } });
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  it('a stop is written down, handed to a person, and its line waits with its mark; what was on its way is cleared', async () => {
    const { OPT_OUT_REPLIES } = await import('../../src/core/safety/optOut.js');
    const wa = buyer();
    // A buyer answered as usual: a reply waits for the owner, and one is queued.
    const conv = await send(wa, 'Do you have the tote in green?');
    await until(async () => ((await state(conv)).pending.length > 0 ? true : undefined), 'the first answer');
    const queued = await enqueue(conv, 'One more thing about the tote.', 'employee');
    expect(queued).not.toBeNull();

    await send(wa, 'stop messaging me');
    await until(async () => ((await optOutOf(wa)).length > 0 ? true : undefined), 'the stop written down');
    await until(async () => ((await state(conv)).assigned !== null ? true : undefined), 'the hand-off');
    const s = await state(conv);
    expect(s.assigned).toBe('unclaimed');
    expect(s.signals).toContain('opted_out');
    expect(s.pending).toEqual([{ text: OPT_OUT_REPLIES.en, notice: 'opt_out' }]);
    expect(s.superseded).toBe(1);                                   // the answer to the green tote, never to be approved
    expect(await rowOf(queued!)).toEqual({ status: 'canceled', cancel_reason: 'canceled: opted_out' });
    expect(await optOutOf(wa)).toEqual([expect.objectContaining({ channel: 'whatsapp', asks: 1, recorded_by: 'buyer', lifted_at: null })]);
    expect(analyzer.texts).not.toContain('stop messaging me');      // no model read it
  });

  it('the gate: only the line until they write again; then a reply, never a first message; the owner lifts it', async () => {
    const wa = buyer();
    const conv = await send(wa, 'STOP');
    await until(async () => ((await optOutOf(wa)).length > 0 ? true : undefined), 'the stop written down');

    // The owner's own reply: refused, and so recorded.
    const mine = await enqueue(conv, 'Sorry to bother you — one last question.', 'owner');
    await drive(conv);
    expect(await rowOf(mine!)).toEqual({ status: 'canceled', cancel_reason: 'canceled: opted_out' });

    // The line that answers the stop: it leaves, though a person now holds the conversation.
    const { OPT_OUT_REPLIES } = await import('../../src/core/safety/optOut.js');
    const line = await enqueue(conv, OPT_OUT_REPLIES.en, 'employee', 'opt_out');
    const fx = await drive(conv);
    expect(fx).toContainEqual(expect.objectContaining({ kind: 'sent', id: line }));
    const delivered = (id: string | null) => q((tx) => sql`update outbound_messages set status = 'delivered', delivered_at = now()
                                                           where id = ${id}::uuid`.execute(tx));
    await delivered(line);                                          // its receipt, so the queue moves on

    // They write again: a reply may go — and a first message still may not.
    await q((tx) => sql`update client_channels set last_inbound_at = now() + interval '1 second'
                         where channel = 'whatsapp' and channel_user_id = ${wa}`.execute(tx));
    const after = await enqueue(conv, 'Thanks for writing — how can we help?', 'owner');
    expect(await drive(conv)).toContainEqual(expect.objectContaining({ kind: 'sent', id: after }));
    await delivered(after);
    const first = await enqueue(conv, 'New collection is out!', 'outreach');
    await drive(conv);
    expect(await rowOf(first!)).toEqual({ status: 'canceled', cancel_reason: 'canceled: opted_out' });

    // Only the owner ends it, and the trail says so.
    const { liftOptOut, standingOptOut } = await import('../../src/db/optOuts.js');
    expect(await q((tx) => liftOptOut(tx, BIZ as never, { conversationId: conv, actor: 'owner-test', now: new Date() }))).toBe('lifted');
    expect(await q((tx) => standingOptOut(tx, BIZ as never, conv))).toBeNull();
    const trail = await q((tx) => sql<{ n: number }>`
      select count(*)::int as n from channel_audit where business_id = ${BIZ}::uuid and action = 'opt_out_lifted'`.execute(tx).then((r) => r.rows[0]!.n));
    expect(trail).toBe(1);
    expect((await optOutOf(wa))[0]!.lifted_at).not.toBeNull();     // the row stays, as the record that they asked
  });

  it('"let me talk to a person", and a stop that asks for one: the ordinary hand-off, nothing written down', async () => {
    const { HANDOFF_REPLIES } = await import('../../src/core/conversation/templates.js');
    for (const text of ['Let me talk to a person', 'stop the bot, get me a person']) {
      const wa = buyer();
      const conv = await send(wa, text);
      await until(async () => ((await state(conv)).assigned !== null ? true : undefined), `the hand-off of ${text}`);
      const s = await state(conv);
      expect(s.signals, text).toContain('human_requested');
      // Fix 1 — marked, so it reaches the buyer now waiting for a person.
      expect(s.pending, text).toEqual([{ text: HANDOFF_REPLIES.en, notice: 'handoff' }]);
      expect(await optOutOf(wa), text).toEqual([]);
    }
  });

  it('a person holding the conversation: the stop is written down, and the person keeps it', async () => {
    const wa = buyer();
    const conv = await send(wa, 'Hi there');
    await until(async () => ((await state(conv)).pending.length > 0 ? true : undefined), 'the first answer');
    await q((tx) => sql`update conversations set assigned_to = 'owner' where id = ${conv}::uuid`.execute(tx));
    await send(wa, 'لا تراسلني');
    await until(async () => ((await optOutOf(wa)).length > 0 ? true : undefined), 'the stop written down');
    const { OPT_OUT_REPLIES } = await import('../../src/core/safety/optOut.js');
    await until(async () => ((await state(conv)).pending.some((p) => p.notice === 'opt_out') ? true : undefined), 'the line');
    const s = await state(conv);
    expect(s.assigned).toBe('owner');
    expect(s.pending).toEqual([{ text: OPT_OUT_REPLIES.ar, notice: 'opt_out' }]);
  });

  it('the assistant stopped: no turn runs, and the stop is written down all the same', async () => {
    const wa = buyer();
    await q((tx) => sql`update businesses set assistant_stopped_at = now() where id = ${BIZ}::uuid`.execute(tx));
    try {
      const conv = await send(wa, '别再发了');
      await until(async () => ((await optOutOf(wa)).length > 0 ? true : undefined), 'the stop written down');
      const s = await state(conv);
      expect(s.signals).toEqual(expect.arrayContaining(['assistant_stopped', 'opted_out']));
      expect(s.pending).toEqual([]);                                 // nothing written while stopped
    } finally {
      await q((tx) => sql`update businesses set assistant_stopped_at = null where id = ${BIZ}::uuid`.execute(tx));
    }
  });
});
