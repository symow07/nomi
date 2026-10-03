import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { Analysis } from '../../src/core/conversation/decide.js';

/**
 * G5 — AN OWNER WHO SET NO ALERT NUMBER STILL HEARS OF A CUSTOMER, in
 * production's own composition: a signed webhook → the worker → the turn →
 * the notify queue → the installation's mail.
 *
 * PHASE 8 OF THE WARMTH RUN (2026-10-03) changed what leaves, deliberately —
 * the owner: "Only two things may interrupt the owner outside the app: an
 * order waiting for their tap, and a conversation the assistant handed over
 * because it could not handle it. Everything else waits quietly in-app."
 *
 *   · A reply waiting for the owner is no longer e-mailed: it waits under
 *     Needs you.
 *   · A hand-off is e-mailed to the sign-in address, with a link.
 *   · Each person hears ONE way — their choice, or the default (WhatsApp once
 *     Meta approved Nomi and a number is set on a live channel, e-mail
 *     otherwise) — and e-mail whenever that way fails.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd990000-0000-4000-8000-${RUN}0001`;
const OWNER = `owner-${RUN}@example.test`;
const BASE = 'https://app.example.test';

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 90_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

d('G5 · alerts by e-mail (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  const outbox: { to: string; subject: string; text: string }[] = [];
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();

  const q = async <R>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };
  /** A customer writes; wait until the turn has written its draft (or handed over). */
  const writes = async (from: string, text: string, drafts = 1) => {
    const w = sim.inboundText({ from, text });
    expect((await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } })).statusCode).toBe(200);
    return until(() => q(async (tx) => {
      const r = (await sql<{ conv: string; drafts: number; held: boolean }>`
        select c.id::text as conv,
               (select count(*)::int from drafts dr where dr.conversation_id = c.id) as drafts,
               exists (select 1 from conversation_signals s where s.conversation_id = c.id and s.kind = 'human_requested') as held
          from conversations c join clients cl on cl.id = c.client_id
         where c.business_id = ${BIZ}::uuid and cl.phone like ${`%${from}`}`.execute(tx)).rows[0];
      return r && (r.drafts >= drafts || r.held) ? r : undefined;
    }), `the turn for "${text}"`);
  };
  /** This run's owner's mail with that subject (another run's queued alert may reach this outbox too). */
  const ours = (subject: string) => outbox.filter((x) => x.subject === subject && x.to === OWNER);
  const mailFor = (subject: string, n = 1) => until(async () => {
    const m = ours(subject);
    return m.length >= n ? m : undefined;
  }, `${n} e-mail(s) "${subject}"`);

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    sim = whatsappSimulator([], { tag: `g5${RUN}` });
    const setup = createDb(DATABASE_URL!);
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    await withTenantTx(setup, b.value, async (t) => {
      await sql`insert into businesses (id, name, engine, kind, owner_locale) values (${BIZ}, 'Saffron Studio', 'service', 'brand', 'en') on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 10000 where id = ${BIZ}`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                values (${BIZ}, 'whatsapp', 'connected', '+971 50****0099', now(), now(), 'test', false)`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
      // The owner signs in with an e-mail address and set no alert number.
      const person = (await sql<{ id: string }>`insert into people (business_id, name, is_owner) values (${BIZ}, 'Mona', true) returning id::text as id`.execute(t)).rows[0]!.id;
      await sql`insert into logins (business_id, person_id, email, password_hash) values (${BIZ}, ${person}::uuid, ${OWNER}, 'scrypt$never-used')`.execute(t);
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'g5-verify-token-xxxx', CREDENTIAL_KEY: 'f'.repeat(64), PORT: 0,
      PUBLIC_BASE_URL: BASE,
    }, {
      adapter: sim.adapter, logger: false, media: {}, models: { analyzer, replyWriter },
      systemMail: { from: 'nomi@nomi.test', send: async (m: { to: string; subject: string; text: string }) => { outbox.push(m); return { ok: true as const }; } },
    } as Parameters<typeof buildProduction>[1]);
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  it('A REPLY WAITING FOR THE OWNER waits in the app: nothing is e-mailed for it (phase 8)', async () => {
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification', wantsPerson: false,
    } satisfies Analysis;
    replyWriter.replies = ['Yes, we have it in blue.'];
    const from = `9715${runDigits(RUN, 6)}1`;
    const first = await writes(from, 'Do you have the scarf in blue?');
    expect(first.drafts).toBeGreaterThanOrEqual(1);
    await writes(from, 'And in green?', 2);
    await new Promise((r) => setTimeout(r, 3000));
    // No e-mail, and no job queued for one: the worker queues only the two interruptions.
    expect(ours('A reply is waiting for you')).toHaveLength(0);
    const queued = await q(async (tx) => (await sql<{ n: number }>`
      select count(*)::int as n from pgboss.job where name = 'notify.team' and data->>'businessId' = ${BIZ}
         and data->>'kind' = 'draft_waiting'`.execute(tx)).rows[0]!.n);
    expect(queued).toBe(0);
    // The control that the quiet above is the rule, not a broken queue: the hand-off below is e-mailed.
  }, 180_000);

  it('A HAND-OFF is e-mailed too', async () => {
    const from = `9715${runDigits(RUN, 6)}3`;
    const r = await writes(from, 'Can I talk to a real person please?');
    expect(r.held).toBe(true);
    const mails = await mailFor('A customer is waiting for you');
    expect(mails.some((m) => m.text.includes(`${BASE}/app/inbox/${r.conv}#latest`))).toBe(true);
  }, 120_000);

  it('ONE WAY per person: the default is e-mail until Meta approves, then WhatsApp; a choice is kept; a failure falls back to e-mail', async () => {
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    const mails: string[] = [];
    const mail = { send: async (m: { to: string }) => { mails.push(m.to); return { ok: true as const }; } };
    const texts: string[] = [];
    const ok = { sendText: async (to: string) => { texts.push(to); return { ok: true as const, providerMessageId: 'x' }; } };
    const retry = { sendText: async () => ({ ok: false as const, retryable: true, error: '503' }) };
    const clear = () => { mails.length = 0; texts.length = 0; };
    const choose = (way: string | null) => q((tx) => sql`update people set alert_channel = ${way}
      where business_id = ${BIZ}::uuid and is_owner`.execute(tx));
    // A number is set and the channel is live (beforeAll): only approval is missing.
    await q((tx) => sql`update businesses set owner_phone = '+971500009999' where id = ${BIZ}::uuid`.execute(tx));
    const job = { businessId: BIZ, kind: 'handoff' as const, conversationId: null };

    // Before approval, the default is e-mail — and only e-mail.
    expect(await deliverOwnerAlert({ db: prod.db, adapter: ok, mail }, job)).toBe('sent');
    expect([mails, texts]).toEqual([[OWNER], []]);
    // The day it lands, the same row (still the default) is WhatsApp — and only WhatsApp.
    clear();
    expect(await deliverOwnerAlert({ db: prod.db, adapter: ok, mail, whatsappApproved: true }, job)).toBe('sent');
    expect([mails, texts]).toEqual([[], ['+971500009999']]);
    // WhatsApp failing falls back to e-mail at once; nothing is thrown (a retry would tell twice).
    clear();
    expect(await deliverOwnerAlert({ db: prod.db, adapter: retry, mail, whatsappApproved: true }, job)).toBe('sent');
    expect(mails).toEqual([OWNER]);
    // With no e-mail to fall back on, a retryable failure is retried.
    await expect(deliverOwnerAlert({ db: prod.db, adapter: retry, whatsappApproved: true }, job)).rejects.toThrow();
    // An owner who chose e-mail stays on it after approval.
    clear();
    await choose('email');
    expect(await deliverOwnerAlert({ db: prod.db, adapter: ok, mail, whatsappApproved: true }, job)).toBe('sent');
    expect([mails, texts]).toEqual([[OWNER], []]);
    // Browser with no phone turned on: e-mail carries it.
    clear();
    await choose('browser');
    expect(await deliverOwnerAlert({ db: prod.db, adapter: ok, mail, whatsappApproved: true }, job)).toBe('sent');
    expect([mails, texts]).toEqual([[OWNER], []]);
    await choose(null);
    // What waits in the app leaves by no way at all.
    clear();
    expect(await deliverOwnerAlert({ db: prod.db, adapter: ok, mail, whatsappApproved: true },
      { businessId: BIZ, kind: 'hot_lead', conversationId: null })).toBe('skipped_quiet');
    expect([mails, texts]).toEqual([[], []]);
    // No number and no sender: nowhere to go, and it says so.
    await q((tx) => sql`update businesses set owner_phone = null where id = ${BIZ}::uuid`.execute(tx));
    expect(await deliverOwnerAlert({ db: prod.db, adapter: ok, whatsappApproved: true }, job)).toBe('skipped_no_destination');
  });
});
