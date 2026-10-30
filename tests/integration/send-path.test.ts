import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import type { ChannelAdapter, SendResult } from '../../src/channels/contract.js';

/**
 * AUDIT BATCH 1 — THE SEND PATH (2026-10-30), over production's own composition: the webhook, pg-boss, the outbound
 * worker, the approval route. Each test failed before its fix:
 *
 *   A1 — the provider was called inside the drive's transaction: the 'sending' mark was not committed while the
 *        message was on the wire, and a send cut off mid-call was rolled back and sent again.
 *   A2 — the webhook's dedupe row was committed before the turn's job was queued: a queue that failed then lost the
 *        message for good, because the provider's retry was "a duplicate".
 *   B6 — Send pressed after "Hand to me" said sent, and the reply was cancelled as handed off.
 *   B7 — a queue that failed after an approval left the draft approved, nothing sent, and no way to send it again.
 *   B8 — two identical replies approved minutes apart: the second was silently dropped as a duplicate.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd5e0000-0000-4000-8000-${RUN}0001`;
const CODE = `send-path-${RUN}`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 60_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

d('Audit batch 1 · the send path, in production\'s composition (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let observer: import('../../src/db/client.js').Db;
  let cookie = '';
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();

  /** What each send saw and did: the body, and the row's status as ANOTHER connection read it during the call. */
  const sends: { to: string; body: string; seenFromOutside: string | null }[] = [];
  /** How the next send to a body behaves: answer as the provider, or throw as a call cut off would. */
  const behaviour = new Map<string, 'throw'>();
  let n = 0;

  const q = async <R>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };
  /** A customer who wrote a minute ago: the window is open and the conversation the assistant's. */
  const customer = async (tag: string): Promise<string> => {
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return q(async (tx) => {
      const c = await ensureConversation(tx, b.value, `9715${runDigits(RUN, 5)}${tag}`, `Customer ${tag}`, 'whatsapp');
      await sql`update client_channels set last_inbound_at = now() - interval '1 minute'
                 where client_id = ${c.clientId} and channel = 'whatsapp'`.execute(tx);
      return c.conversationId;
    });
  };
  const rowsOf = (cid: string) => q(async (tx) => (await sql<{ id: string; body: string; status: string; cancel_reason: string | null }>`
    select id::text as id, body, status, cancel_reason from outbound_messages
     where conversation_id = ${cid}::uuid order by seq`.execute(tx)).rows);
  const draft = (cid: string, text: string) => q(async (tx) => (await sql<{ id: string }>`
    insert into drafts (business_id, conversation_id, capability, draft_text, status)
    values (${BIZ}, ${cid}::uuid, 'qualify', ${text}, 'pending') returning id::text as id`.execute(tx)).rows[0]!.id);
  const draftStatus = (id: string) => q(async (tx) => (await sql<{ status: string }>`
    select status from drafts where id = ${id}::uuid`.execute(tx)).rows[0]!.status);
  const post = (url: string, fields: Record<string, string>) => prod.app.inject({
    method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString(),
  });
  const approve = (cid: string, draftId: string) => post(`/app/inbox/${cid}/act`, { draftId, command: '发送' });
  const sentTo = (body: string) => sends.filter((s) => s.body === body);
  /** A delivery receipt, as Meta's status webhook gives it; then a tick, so the next ordered row needs no 90 s wait. */
  const delivered = async (cid: string) => {
    const { channelStore } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { QUEUES } = await import('../../src/queue/boss.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    const ids = await q(async (tx) => (await sql<{ pid: string }>`
      select provider_message_id as pid from outbound_messages
       where conversation_id = ${cid}::uuid and status = 'sent' and provider_message_id is not null`.execute(tx)).rows);
    for (const { pid } of ids) await q((tx) => channelStore(tx, b.value).reconcileStatus(pid, 'delivered', null));
    await prod.boss.send(QUEUES.outbound, { businessId: BIZ, conversationId: cid });
  };
  /** Make the queue refuse the next job of one name, as a queue that is down would. */
  const queueFailsOnce = (name: string) => {
    const boss = prod.boss as unknown as { send: (...a: unknown[]) => Promise<unknown> };
    const real = boss.send.bind(boss);
    let armed = true;
    boss.send = async (...a: unknown[]) => {
      if (armed && a[0] === name) { armed = false; throw new Error('the queue is down (test)'); }
      return real(...a);
    };
    return () => { boss.send = real; };
  };

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    sim = whatsappSimulator([], { tag: `sp${RUN}` });
    observer = createDb(DATABASE_URL!);
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    await withTenantTx(observer, b.value, async (t) => {
      await sql`insert into businesses (id, name, engine, kind, owner_locale) values (${BIZ}, 'Send Path Co', 'service', 'brand', 'en') on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 10000 where id = ${BIZ}`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                values (${BIZ}, 'whatsapp', 'connected', '+971 50****0055', now(), now(), 'test', false)`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
    });

    /*
     * The provider: the simulator's own adapter (webhooks, signatures), with a send that records what it saw. During
     * the call it reads the row from ANOTHER connection — what a process starting after a crash would read.
     */
    const adapter: ChannelAdapter = {
      ...sim.adapter,
      sendText: async (to: string, body: string): Promise<SendResult> => {
        const seen = (await withTenantTx(observer, b.value, (t) => sql<{ status: string }>`
          select status from outbound_messages where business_id = ${BIZ}::uuid and body = ${body}
           order by created_at desc limit 1`.execute(t))).rows[0]?.status ?? null;
        sends.push({ to, body, seenFromOutside: seen });
        if (behaviour.get(body) === 'throw') {
          behaviour.delete(body);
          throw new Error('the process went away mid-call (test)');
        }
        n += 1;
        return { ok: true, providerMessageId: `wamid.SP_${RUN}_${n}` };
      },
    };
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    process.env['OWNER_ACCESS_CODE'] = CODE;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      // The installation's number is the simulator's: a number it does not route sends nothing (channel_unavailable).
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: sim.phoneNumberId,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'sp-verify-token-xxxx', CREDENTIAL_KEY: 'f'.repeat(64), PORT: 0,
      PUBLIC_BASE_URL: 'https://app.example.test',
    }, {
      adapter, logger: false, media: {}, models: { analyzer, replyWriter },
    } as Parameters<typeof buildProduction>[1]);
    const login = await prod.app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 90_000);
  afterAll(async () => { await prod?.close(); await observer?.destroy(); });

  it('A1 · while the message is on the wire, its row is already COMMITTED as sending', async () => {
    const { QUEUES } = await import('../../src/queue/boss.js');
    const cid = await customer('1');
    const body = `A1 on the wire ${RUN}`;
    await prod.boss.send(QUEUES.outbound, { businessId: BIZ, conversationId: cid, reply: body });
    await until(async () => ((await rowsOf(cid)).find((r) => r.body === body)?.status === 'sent' ? true : undefined), 'the reply to be sent');
    // Before: the call ran inside the transaction that queued the row — from outside, there was no row at all.
    expect(sentTo(body).map((s) => s.seenFromOutside)).toEqual(['sending']);
  }, 90_000);

  it('A1 · a send cut off mid-call is NOT sent again: the row stops as uncertain and the owner decides', async () => {
    const { QUEUES } = await import('../../src/queue/boss.js');
    const cid = await customer('2');
    const body = `A1 cut off ${RUN}`;
    behaviour.set(body, 'throw');
    await prod.boss.send(QUEUES.outbound, { businessId: BIZ, conversationId: cid, reply: body });
    // Before: the throw rolled the row back (it was never written), pg-boss ran the job again ten seconds later,
    // and the customer got it a second time; the row never reached 'uncertain'.
    await until(async () => ((await rowsOf(cid)).find((r) => r.body === body)?.status === 'uncertain' ? true : undefined), 'the row to be uncertain', 30_000);
    await pause(15_000);   // past pg-boss's first retry (10 s)
    expect(sentTo(body)).toHaveLength(1);
    expect((await rowsOf(cid)).filter((r) => r.body === body).map((r) => r.status)).toEqual(['uncertain']);
  }, 90_000);

  it('A2 · a queue that fails after the webhook loses nothing: Meta\'s retry is processed, not called a duplicate', async () => {
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification', wantsPerson: false,
    } satisfies Analysis;
    replyWriter.replies = ['We do, in three colours.'];
    const text = `A2 do you have it in red ${RUN}`;
    const w = sim.inboundText({ from: `9715${runDigits(RUN, 5)}3`, text });
    const deliver = () => prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });
    const restore = queueFailsOnce('message.inbound');
    try {
      const first = await deliver();
      expect(first.statusCode).toBeGreaterThanOrEqual(500);   // Meta is told to try again…
    } finally { restore(); }
    const again = await deliver();                             // …and does: the same payload.
    expect(again.statusCode).toBe(200);
    // Before: the first delivery had committed the event's row, so this one was "a duplicate" (received 0) and
    // the message was never read by anyone.
    expect(JSON.parse(again.body)).toMatchObject({ received: 1 });
    await until(async () => (analyzer.texts.includes(text) ? true : undefined), 'the turn to read the message');
    // One event row: the first, failed delivery left nothing behind.
    const events = await q(async (tx) => (await sql<{ n: number }>`
      select count(*)::int as n from channel_events where business_id = ${BIZ}::uuid and payload::text like ${`%${text}%`}`.execute(tx)).rows[0]!.n);
    expect(events).toBe(1);
  }, 90_000);

  it('B6 · Send pressed after "Hand to me" sends the reply — it said "sent" and cancelled it as handed off', async () => {
    const cid = await customer('4');
    const body = `B6 approved after taking over ${RUN}`;
    const id = await draft(cid, body);
    expect((await post(`/app/inbox/${cid}/takeover`, {})).statusCode).toBe(302);
    expect((await approve(cid, id)).statusCode).toBe(302);
    expect(await draftStatus(id)).toBe('approved');
    await until(async () => {
      const r = (await rowsOf(cid)).find((x) => x.body === body);
      return r && r.status !== 'queued' && r.status !== 'sending' ? r : undefined;
    }, 'the approved reply to leave the queue').then((r) => {
      // Before: { status: 'canceled', cancel_reason: 'canceled: handed_off' }.
      expect({ status: r.status, cancel_reason: r.cancel_reason }).toEqual({ status: 'sent', cancel_reason: null });
    });
    expect(sentTo(body)).toHaveLength(1);
  }, 90_000);

  it('B7 · a queue that fails during an approval undoes it: the draft waits, and a second press sends it once', async () => {
    const cid = await customer('5');
    const body = `B7 approve again ${RUN}`;
    const id = await draft(cid, body);
    const restore = queueFailsOnce('message.outbound');
    try {
      const r = await approve(cid, id);
      expect(r.statusCode).toBe(500);
    } finally { restore(); }
    // Before: 'approved' — and nothing queued, so nothing was ever sent, and a second press was "already decided".
    expect(await draftStatus(id)).toBe('pending');
    expect(await rowsOf(cid)).toEqual([]);
    expect((await approve(cid, id)).statusCode).toBe(302);
    expect(await draftStatus(id)).toBe('approved');
    await until(async () => (sentTo(body).length === 1 ? true : undefined), 'the reply to be sent');
    await pause(2_000);
    expect(sentTo(body)).toHaveLength(1);
  }, 90_000);

  it('B8 · two identical replies approved minutes apart are two replies: both go', async () => {
    const cid = await customer('6');
    const body = `B8 Thank you! ${RUN}`;
    const first = await draft(cid, body);
    expect((await approve(cid, first)).statusCode).toBe(302);
    await until(async () => (sentTo(body).length === 1 ? true : undefined), 'the first reply');
    await delivered(cid);
    const second = await draft(cid, body);
    expect((await approve(cid, second)).statusCode).toBe(302);
    // Before: one row — the second approval's reply was dropped as a duplicate of the first, though the page said sent.
    await until(async () => ((await rowsOf(cid)).filter((r) => r.body === body).length === 2 ? true : undefined), 'a second row');
    await until(async () => (sentTo(body).length === 2 ? true : undefined), 'the second reply to be sent');
  }, 90_000);
});
