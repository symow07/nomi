import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { ChannelAdapter } from '../../src/channels/contract.js';

/**
 * S6 (Phase 5, item 20) — the done-criterion (PHASE-5.md §4): "Sent only where free. Answers are stored and erasable"
 * (the erasure: tests/integration/erase-buyer.test.ts runs the tool for real and finds the buyer's survey gone, the
 * next buyer's kept). Over Postgres, the minute's sweep (`sendDueSurveys`) and the real outbound worker with a test
 * Instagram adapter: a question due is asked only on a chat channel inside the buyer's 24 hours, in a language with a
 * signed sentence, with surveys still on and nobody holding the conversation; otherwise it is set aside, with why, and
 * nothing is queued. What is queued is automated, so the send gate holds it as it holds a follow-up — the assistant
 * stopped, it never goes. With no sentence signed (production today), nobody is asked anything. An answer that is
 * only a score is kept; anything more is not an answer.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `57570000-0000-4000-8000-${RUN}0001`;
type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('S6 · how did we do? asked only where free (requires DATABASE_URL)', () => {
  let db: Db;
  let signed: import('../../src/core/conversation/survey.js').SurveySigned;
  const sent: { to: string; body: string }[] = [];
  const instagram: ChannelAdapter = {
    kind: 'instagram', provider: 'test', verifyWebhook: () => false, parseWebhook: () => [],
    sendText: async (to, body) => { sent.push({ to, body }); return { ok: true, providerMessageId: `ig-${RUN}-${sent.length}` }; },
  };
  let n = 0;

  const tx = async <R>(fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, BIZ as never, fn);
  };
  /** A buyer on a channel, who last wrote `minutesAgo`, in a language; their order confirmed eleven minutes ago. */
  const buyer = async (o: { channel?: 'instagram' | 'email'; minutesAgo?: number; language?: string; disclosed?: boolean } = {}) => {
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { noteSurveyDue } = await import('../../src/db/surveys.js');
    const channel = o.channel ?? 'instagram';
    const who = channel === 'email' ? `buyer${++n}-${RUN}@example.com` : `ig-buyer-${++n}-${RUN}`;
    return tx(async (x) => {
      const c = await ensureConversation(x, BIZ as never, who, `Buyer ${n}`, channel);
      await sql`update client_channels set last_inbound_at = now() - make_interval(mins => ${o.minutesAgo ?? 1})
                 where client_id = ${c.clientId}::uuid`.execute(x);
      await sql`update clients set preferred_language = ${o.language ?? 'en'} where id = ${c.clientId}::uuid`.execute(x);
      await sql`update conversations set assigned_to = null,
                  ai_disclosure_delivered_at = ${o.disclosed === false ? null : new Date()} where id = ${c.conversationId}::uuid`.execute(x);
      expect(await noteSurveyDue(x, BIZ as never, c.conversationId, new Date(Date.now() - 11 * 60_000))).toBe(true);
      return { conv: c.conversationId, client: c.clientId, who };
    });
  };
  const sweep = async (s = signed) => {
    const { sendDueSurveys } = await import('../../src/db/surveys.js');
    return tx((x) => sendDueSurveys(x, BIZ as never, new Date(), s));
  };
  const ask = (conv: string) => tx((x) => sql<{ state: string; why: string | null; outbound_id: string | null }>`
    select state, skipped_why as why, outbound_id::text as outbound_id from survey_asks where conversation_id = ${conv}::uuid`.execute(x).then((r) => r.rows[0]!));
  const queued = (conv: string) => tx((x) => sql<{ n: number }>`select count(*)::int as n from outbound_messages where conversation_id = ${conv}::uuid`
    .execute(x).then((r) => r.rows[0]!.n));
  const drive = async (conv: string) => {
    const { channelStore } = await import('../../src/db/channels.js');
    const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
    return tx((x) => driveConversationOutbound({ store: channelStore(x, BIZ as never), adapters: (ch) => (ch === 'instagram' ? instagram : undefined), now: () => new Date() }, conv));
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { surveyText } = await import('../../src/core/conversation/survey.js');
    // As if a reader had signed the English sentence — the test's own; production has none signed.
    signed = { en: surveyText('en') };
    db = createDb(DATABASE_URL!);
    await tx(async (x) => {
      await sql`insert into businesses (id, name, owner_locale, surveys_on) values (${BIZ}, 'Atlas Bags', 'en', true) on conflict (id) do nothing`.execute(x);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
                values (${BIZ}, 'instagram', ${`ig-acct-${RUN}`}, 'survey-secret', 'service', true)`.execute(x);
    });
  }, 60_000);
  afterAll(async () => { await db?.destroy(); });

  it('ASKED WHERE FREE: Instagram, the buyer wrote a minute ago, English signed — queued as the assistant\'s automated message, and sent', async () => {
    const b = await buyer();
    expect(await sweep()).toEqual([b.conv]);
    const a = await ask(b.conv);
    expect(a.state).toBe('sent');
    const { channelStore } = await import('../../src/db/channels.js');
    const { rows } = await tx((x) => channelStore(x, BIZ as never).load(b.conv));
    expect(rows.find((r) => r.id === a.outbound_id)).toMatchObject({ origin: 'employee', automated: true });
    const fx = await drive(b.conv);
    expect(fx).toContainEqual(expect.objectContaining({ kind: 'sent' }));
    expect(sent.at(-1)).toEqual({ to: b.who, body: 'Thank you for your order with Atlas Bags. How did we do? Reply with a number from 1 (poor) to 5 (excellent).' });
  });

  it('NOT FREE, NOT ASKED: the window nearly shut, an e-mail, a language nobody signed — set aside with why, nothing queued', async () => {
    const late = await buyer({ minutesAgo: 23 * 60 + 30 });
    const mail = await buyer({ channel: 'email' });
    const zh = await buyer({ language: 'zh' });
    expect(await sweep()).toEqual([]);
    expect(await ask(late.conv)).toMatchObject({ state: 'skipped', why: 'not_free' });
    expect(await ask(mail.conv)).toMatchObject({ state: 'skipped', why: 'channel' });
    expect(await ask(zh.conv)).toMatchObject({ state: 'skipped', why: 'unsigned' });
    for (const b of [late, mail, zh]) expect(await queued(b.conv)).toBe(0);
  });

  it('NOBODY SIGNED, NOBODY ASKED: with the sentences as they are (none signed), the question is set aside', async () => {
    const { SURVEY_SIGNED } = await import('../../src/core/conversation/survey.js');
    expect(SURVEY_SIGNED).toEqual({});
    const b = await buyer();
    expect(await sweep(SURVEY_SIGNED)).toEqual([]);
    expect(await ask(b.conv)).toMatchObject({ state: 'skipped', why: 'unsigned' });
    expect(await queued(b.conv)).toBe(0);
  });

  it('THE OWNER\'S WORD: switched off since, held by a person, no name for the disclosure it needs — set aside; off, none is due at all', async () => {
    const held = await buyer();
    await tx((x) => sql`update conversations set assigned_to = 'unclaimed' where id = ${held.conv}::uuid`.execute(x));
    const unnamed = await buyer({ disclosed: false });
    expect(await sweep()).toEqual([]);
    expect(await ask(held.conv)).toMatchObject({ state: 'skipped', why: 'held' });
    expect(await ask(unnamed.conv)).toMatchObject({ state: 'skipped', why: 'no_name' });
    const later = await buyer();
    await tx((x) => sql`update businesses set surveys_on = false where id = ${BIZ}::uuid`.execute(x));
    expect(await sweep()).toEqual([]);
    expect(await ask(later.conv)).toMatchObject({ state: 'skipped', why: 'off' });
    // switched off, an order confirmed now makes none due: a conversation with no survey yet stays without one
    const { noteSurveyDue } = await import('../../src/db/surveys.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const fresh = await tx((x) => ensureConversation(x, BIZ as never, `ig-off-${RUN}`, 'Off buyer', 'instagram'));
    expect(await tx((x) => noteSurveyDue(x, BIZ as never, fresh.conversationId, new Date()))).toBe(false);
    expect(await tx((x) => sql<{ n: number }>`select count(*)::int as n from survey_asks where conversation_id = ${fresh.conversationId}::uuid`
      .execute(x).then((r) => r.rows[0]!.n))).toBe(0);
    await tx((x) => sql`update businesses set surveys_on = true where id = ${BIZ}::uuid`.execute(x));
  });

  it('STOPPED: nothing is asked while the assistant is stopped, and a question queued before is refused at send time', async () => {
    const waiting = await buyer();
    const before = await buyer();
    await sweep();                                             // both asked, both queued
    await tx((x) => sql`update businesses set assistant_stopped_at = now() where id = ${BIZ}::uuid`.execute(x));
    const during = await buyer();
    expect(await sweep()).toEqual([]);
    expect(await ask(during.conv)).toMatchObject({ state: 'due' });
    const count = sent.length;
    const fx = await drive(before.conv);
    expect(fx.some((e) => e.kind === 'sent')).toBe(false);
    expect(sent.length).toBe(count);
    await tx((x) => sql`update businesses set assistant_stopped_at = null where id = ${BIZ}::uuid`.execute(x));
    expect(waiting.conv).not.toBe(before.conv);
  });

  it('ANSWERED: only a score is an answer, within the buyer\'s 24 hours; it is kept once', async () => {
    const { recordSurveyAnswer } = await import('../../src/db/surveys.js');
    const b = await buyer();
    await sweep();
    const answer = (text: string, at = new Date()) => tx((x) => recordSurveyAnswer(x, BIZ as never, b.conv, { text, messageId: `wamid.${RUN}.${text.length}`, now: at }));
    expect(await answer('5 more pieces please')).toBeNull();
    expect(await answer('5', new Date(Date.now() + 25 * 3_600_000))).toBeNull();
    expect(await answer(' ⭐⭐⭐⭐ ')).toEqual({ language: 'en', business: 'Atlas Bags' });
    expect(await answer('5')).toBeNull();                     // answered already: a second score is an ordinary message
    const kept = await tx((x) => sql<{ state: string; score: number; answer_text: string }>`
      select state, score, answer_text from survey_asks where conversation_id = ${b.conv}::uuid`.execute(x).then((r) => r.rows[0]!));
    expect(kept).toEqual({ state: 'answered', score: 4, answer_text: '⭐⭐⭐⭐' });
    // the database holds it: an answer is given once, and what was asked never changes
    await expect(tx((x) => sql`update survey_asks set score = 1 where conversation_id = ${b.conv}::uuid`.execute(x))).rejects.toThrow(/an answer is given once/);
    await expect(tx((x) => sql`delete from survey_asks where conversation_id = ${b.conv}::uuid`.execute(x))).rejects.toThrow(/permission denied/);
  });
});

d('S6 · the answer, through the real worker (requires DATABASE_URL)', { timeout: 180_000 }, () => {
  const BIZ2 = `57570000-0000-4000-8000-${RUN}0002`;
  let prod: Awaited<ReturnType<typeof import('../../src/main.js')['buildProduction']>>;
  let sim: ReturnType<typeof import('../../src/channels/whatsapp/simulator.js')['whatsappSimulator']>;
  const from = `9719${RUN.replace(/[^0-9]/g, '').padEnd(8, '7').slice(0, 8)}`;
  const q = async <T>(fn: (x: Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, BIZ2 as never, fn);
  };
  const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 60_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await probe();
      if (v !== undefined) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const say = async (text: string) => {
    const w = sim.inboundText({ from, text });
    const r = await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody, headers: { 'content-type': 'application/json', ...w.headers } });
    expect(r.statusCode).toBe(200);
  };
  const recorded = (text: string) => until(async () => (await q((x) => sql<{ c: string }>`select m.conversation_id::text as c from messages m
    join conversations c on c.id = m.conversation_id where c.business_id = ${BIZ2}::uuid and m.direction = 'inbound' and m.text_content = ${text}`
    .execute(x).then((r) => r.rows[0]?.c))) ?? undefined, `the message "${text}"`);
  const turns = () => q((x) => sql<{ n: number }>`select count(*)::int as n from turns where business_id = ${BIZ2}::uuid`.execute(x).then((r) => r.rows[0]!.n));

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { FakeAnalyzer, FakeReplyWriter } = await import('../pipeline/fakes.js');
    sim = whatsappSimulator([], { tag: `srv${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, BIZ2 as never, async (t) => {
      await sql`insert into businesses (id, name, engine, surveys_on, batch_debounce_ms, batch_max_window_ms)
                values (${BIZ2}, 'Survey Answers', 'service', true, 300, 1000) on conflict (id) do nothing`.execute(t);
      // live: the channel switched on, so what the assistant sends may leave
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, pilot_mode)
                values (${BIZ2}, 'whatsapp', 'connected', '+86 579****0079', now(), now(), false)`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ2}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      // a chosen name, so the disclosure a thank-you may need can be said
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ2}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ2}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BIZ2;
    const replyWriter = new FakeReplyWriter(); replyWriter.replies = ['Thanks.'];
    const analyzer = new FakeAnalyzer();
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification',
    };
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: sim.phoneNumberId,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real', META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'srv-verify-token-xx', CREDENTIAL_KEY: 'c'.repeat(64), PORT: 0,
    }, { adapter: sim.adapter, logger: false, models: { analyzer, replyWriter },
      // as if the thank-you's reader had signed the English (production: none signed — silence, the known gap)
      surveyThanksSigned: { en: (await import('../../src/core/conversation/survey.js')).surveyThanksText('en') } });
  }, 60_000);
  afterAll(async () => {
    if (prod) {
      // Its own jobs finished before it closes, so no later file waits on them.
      const { QUEUES } = await import('../../src/queue/boss.js');
      await until(async () => ((await sql<{ n: number }>`select count(*)::int as n from pgboss.job where name in (${QUEUES.inbound}, ${QUEUES.notify})
        and data->>'businessId' = ${BIZ2} and state in ('created', 'retry', 'active')`.execute(prod.db)).rows[0]!.n === 0 ? true : undefined), 'this test\'s jobs');
    }
    await prod?.close();
  }, 90_000);

  it('a buyer asked after an order answers "5": kept, and nothing answers it; "5 more bags please" is a message like any other', async () => {
    await say('Hello, do you make tote bags?');
    const conv = await recorded('Hello, do you make tote bags?');
    await until(async () => ((await turns()) > 0 ? true : undefined), 'the first turn');
    // the order was confirmed and the question sent (the sweep's work, here written as it leaves it)
    await q((x) => sql`insert into survey_asks (business_id, client_id, conversation_id, due_at, state, outbound_id, asked_at, language)
      select c.business_id, c.client_id, c.id, now(), 'sent', gen_random_uuid(), now(), 'en' from conversations c where c.id = ${conv}::uuid`.execute(x));
    const before = await turns();
    await say('5');
    const answered = await until(async () => (await q((x) => sql<{ score: number | null }>`select score from survey_asks where conversation_id = ${conv}::uuid`
      .execute(x).then((r) => r.rows[0]?.score ?? undefined))) ?? undefined, 'the answer');
    expect(answered).toBe(5);
    await recorded('5');
    // thanked, in one line, in the language it was asked in — and by the send path, not by a turn
    const thanked = await until(async () => (await q((x) => sql<{ body: string }>`select body from outbound_messages
      where conversation_id = ${conv}::uuid and status = 'sent' and body like '%Thank you — that helps%'`.execute(x).then((r) => r.rows[0]?.body))) ?? undefined, 'the thank-you');
    // the first message nobody approved in this conversation, so the disclosure comes first (rule 3)
    expect(thanked).toMatch(/AI assistant[\s\S]*\n\nThank you — that helps Survey Answers\.$/);
    await say('5 more bags please');
    await recorded('5 more bags please');
    await until(async () => ((await turns()) > before ? true : undefined), 'the turn for the order');
    // exactly one more turn: for "5 more bags please" — none for the "5"
    expect(await turns()).toBe(before + 1);
  });
});
