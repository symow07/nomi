import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { Analysis } from '../../src/core/conversation/decide.js';

/**
 * G3 — THE DAY'S ALLOWANCE, HELD TO BEFORE THE MODEL (0101), in production's
 * own composition: a signed webhook → the worker → the hold.
 *
 *   · Below the cap a customer is answered as ever; yesterday's use is not today's.
 *   · The soft-warn line and 100% are claimed once each a day — and, since
 *     phase 8 of the warmth run, wait in the app: the owner hears of the
 *     customers it holds, each one handed over (an interruption), instead.
 *   · At the cap: the message is recorded, the customer handed to a person in
 *     silence (`allowance_used`), no model asked, nothing sent.
 *   · Handing back and approving are refused while it lasts; the draft waits.
 *   · Photos of a list: none read past the cap, and never more than 20 a day.
 *   · A practice copy spends its owner's allowance.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd930000-0000-4000-8000-${RUN}0001`;
const COPY = `dd930000-0000-4000-8000-${RUN}0002`;
const OWNER = `owner-${RUN}@example.test`;
const CAP = 1000;

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 90_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

d('G3 · the day\'s allowance (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let admin: pg.Client;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  const outbox: { to: string; subject: string; text: string }[] = [];
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();
  let firstConv = '';

  const bid = async () => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return b.value;
  };
  const q = async <R>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<R>, id = BIZ): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(id); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };
  /** Today's use, as the ledger holds it (the admin role: the ledger is not the app's to set). */
  const used = (calls: number, photos = 0) => admin.query(
    `insert into usage_ledger (business_id, day, llm_calls, input_tokens, output_tokens, turns, photo_reads)
     values ($1, (now() at time zone 'UTC')::date, $2, 0, 0, 0, $3)
     on conflict (business_id, day) do update set llm_calls = excluded.llm_calls, photo_reads = excluded.photo_reads`,
    [BIZ, calls, photos]);
  const writes = (from: string, text: string) => {
    const w = sim.inboundText({ from, text });
    return prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });
  };
  const convOf = (from: string) => q(async (tx) => (await sql<{ id: string }>`
    select c.id::text as id from conversations c join clients cl on cl.id = c.client_id
     where c.business_id = ${BIZ}::uuid and cl.phone like ${`%${from}`}`.execute(tx)).rows[0]?.id);
  const mails = (subject: string) => outbox.filter((m) => m.to === OWNER && m.subject === subject);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    sim = whatsappSimulator([], { tag: `g3${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, await bid(), async (tx) => {
      await sql`insert into businesses (id, name, engine, kind, owner_locale, timezone) values (${BIZ}, 'Cedar Lamps', 'service', 'retail', 'en', 'Asia/Dubai') on conflict (id) do nothing`.execute(tx);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 10000 where id = ${BIZ}`.execute(tx);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                values (${BIZ}, 'whatsapp', 'connected', '+971 50****0093', now(), now(), 'test', false)`.execute(tx);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(tx);
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(tx);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(tx);
      const person = (await sql<{ id: string }>`insert into people (business_id, name, is_owner) values (${BIZ}, 'Rami', true) returning id::text as id`.execute(tx)).rows[0]!.id;
      await sql`insert into logins (business_id, person_id, email, password_hash) values (${BIZ}, ${person}::uuid, ${OWNER}, 'scrypt$never-used')`.execute(tx);
    });
    await setup.destroy();
    // The cap a workspace made since 0100 is born with, smaller; and yesterday spent to the full.
    await admin.query(`insert into tenant_budgets (business_id, daily_llm_calls, daily_tokens, soft_warn_pct, on_exceeded)
                       values ($1, $2, 1000000, 80, 'pause')`, [BIZ, CAP]);
    await admin.query(`insert into usage_ledger (business_id, day, llm_calls, input_tokens, output_tokens, turns)
                       values ($1, (now() at time zone 'UTC')::date - 1, $2, 0, 0, 0)`, [BIZ, CAP * 2]);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'g3-verify-token-xxxx', CREDENTIAL_KEY: 'f'.repeat(64), PORT: 0,
      PUBLIC_BASE_URL: 'https://app.example.test',
    }, {
      adapter: sim.adapter, logger: false, media: {}, models: { analyzer, replyWriter },
      systemMail: { from: 'nomi@nomi.test', send: async (m: { to: string; subject: string; text: string }) => { outbox.push(m); return { ok: true as const }; } },
    } as Parameters<typeof buildProduction>[1]);
  }, 60_000);
  afterAll(async () => { await admin?.end(); await prod?.close(); });

  it('BELOW THE CAP a customer is answered as ever — yesterday\'s use is not today\'s', async () => {
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification', wantsPerson: false,
    } satisfies Analysis;
    replyWriter.replies = ['Yes, the brass one comes in black.'];
    const from = `9715${runDigits(RUN, 6)}1`;
    const before = analyzer.calls;
    expect((await writes(from, 'Does the brass lamp come in black?')).statusCode).toBe(200);
    firstConv = await until(async () => {
      const id = await convOf(from);
      if (!id) return undefined;
      const n = await q(async (tx) => (await sql<{ n: number }>`select count(*)::int as n from drafts where conversation_id = ${id}::uuid and status = 'pending'`.execute(tx)).rows[0]!.n);
      return n > 0 ? id : undefined;
    }, 'the draft');
    expect(analyzer.calls).toBeGreaterThan(before);
  }, 120_000);

  it('THE SOFT-WARN LINE AND 100% wait in the app: claimed once each a day, and nothing is e-mailed (phase 8)', async () => {
    // Deliberately changed from "by e-mail, once each a day" — the owner (2026-10-03): "Only two things
    // may interrupt the owner outside the app: an order waiting for their tap, and a conversation the
    // assistant handed over because it could not handle it. Everything else waits quietly in-app."
    const { allowanceAlerts } = await import('../../src/pipeline/allowanceWatch.js');
    const { QUEUES } = await import('../../src/queue/boss.js');
    // The five-minute sweep may get there first; the claim is once a day either way.
    const sweep = async () => {
      for (const job of (await allowanceAlerts(prod.db, new Date())).filter((j) => j.businessId === BIZ)) await prod.boss.send(QUEUES.notify, job);
    };
    await used(850);
    await sweep();
    await used(CAP);
    await sweep();
    await sweep();
    await new Promise((r) => setTimeout(r, 3000));
    expect(mails(t('en', 'notify.allowance_warn.subject'))).toHaveLength(0);
    expect(mails(t('en', 'notify.allowance_reached.subject'))).toHaveLength(0);
    // Their words are kept, for the day they are asked for again.
    expect(t('en', 'notify.allowance_reached', { time: '04:00' })).toContain('Needs you');
  }, 60_000);

  it('AT THE CAP: recorded, handed to a person in silence, no model asked, nothing sent', async () => {
    const from = `9715${runDigits(RUN, 6)}2`;
    const calls = analyzer.calls;
    expect((await writes(from, 'Do you ship to Sharjah?')).statusCode).toBe(200);
    const conv = await until(async () => {
      const id = await convOf(from);
      if (!id) return undefined;
      const s = await q(async (tx) => (await sql<{ n: number }>`
        select count(*)::int as n from conversation_signals where conversation_id = ${id}::uuid and kind = 'allowance_used'`.execute(tx)).rows[0]!.n);
      return s > 0 ? id : undefined;
    }, 'the allowance hand-off');
    expect(analyzer.calls, 'no model was asked').toBe(calls);
    const row = await q(async (tx) => (await sql<{ msgs: number; outbound: number; held: string | null; owner: string | null }>`
      select (select count(*)::int from messages where conversation_id = ${conv}::uuid and direction = 'inbound') as msgs,
             (select count(*)::int from outbound_messages where conversation_id = ${conv}::uuid) as outbound,
             (select decision->'action'->>'reason' from turns where conversation_id = ${conv}::uuid order by created_at desc limit 1) as held,
             (select assigned_to::text from conversations where id = ${conv}::uuid) as owner`.execute(tx)).rows[0]!);
    expect(row).toMatchObject({ msgs: 1, outbound: 0, held: 'allowance_used' });
    expect(row.owner, 'the conversation is with a person').not.toBeNull();
    // Phase 8 — this hand-over is what reaches the owner outside Nomi: e-mail, the default before Meta's approval.
    await until(async () => mails(t('en', 'notify.handoff.subject')).find((m) => m.text.includes(conv)), 'the hand-over e-mail');
  }, 120_000);

  it('HANDING BACK and APPROVING are refused while it lasts; the draft waits', async () => {
    const { resumeAi } = await import('../../src/conversations/takeover.js');
    const { applyOwnerCommand } = await import('../../src/pipeline/approve.js');
    const from = `9715${runDigits(RUN, 6)}2`;
    const conv = (await convOf(from))!;
    const back = await resumeAi({ db: prod.db, now: () => new Date() }, { businessId: await bid(), conversationId: conv, actor: 'owner' });
    expect(back.outcome).toBe('allowance_used');
    const draft = await q(async (tx) => (await sql<{ id: string }>`
      select id::text as id from drafts where conversation_id = ${firstConv}::uuid and status = 'pending' limit 1`.execute(tx)).rows[0]!.id);
    const sent: string[] = [];
    const r = await applyOwnerCommand({ db: prod.db, now: () => new Date(), kickOutbound: async (_b, _c, text) => { sent.push(text); } },
      { businessId: await bid(), draftId: draft, rawReply: '发送', decidedBy: 'owner' });
    expect(r.outcome).toBe('allowance_used');
    expect(sent).toEqual([]);
    expect(await q(async (tx) => (await sql<{ status: string }>`select status from drafts where id = ${draft}::uuid`.execute(tx)).rows[0]!.status)).toBe('pending');
  }, 60_000);

  it('PHOTOS OF A LIST: none read past the cap, and never more than 20 a day', async () => {
    const { startPhotoImport } = await import('../../src/api/web/importFlow.js');
    let reads = 0;
    const transcriber = { transcribe: async () => { reads++; return { text: 'Brass lamp 120', cutOff: false, unreadable: false }; } };
    const photo = { mediaType: 'image/jpeg' as const, bytes: Buffer.from('x') };
    const at = await startPhotoImport(prod.db, BIZ, 'owner', { transcriber: transcriber as never }, { hand: 'printed', photos: [photo] });
    expect(at).toMatchObject({ ok: false, reason: 'allowance_used' });
    await used(0, 18);
    const over = await startPhotoImport(prod.db, BIZ, 'owner', { transcriber: transcriber as never }, { hand: 'printed', photos: [photo, photo, photo] });
    expect(over).toMatchObject({ ok: false, reason: 'daily_limit', left: 2 });
    expect(reads, 'nothing was read').toBe(0);
  }, 60_000);

  it('A PRACTICE COPY spends its owner\'s allowance', async () => {
    const { allowanceOf } = await import('../../src/db/allowance.js');
    await used(CAP);
    await admin.query(`insert into businesses (id, name, practice_of) values ($1, $2, $3) on conflict (id) do nothing`, [COPY, `Cedar Lamps practice ${RUN}`, BIZ]);
    const a = await q((tx) => allowanceOf(tx), COPY);
    expect(a.usage.llmCalls).toBe(CAP);
    expect(a.verdict.kind).toBe('pause');
  });
});
