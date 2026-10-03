import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runDigits } from './tenant.js';
import { FakeReplyWriter } from '../pipeline/fakes.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import type { BalanceReading } from '../../src/core/ops/providerWatch.js';

/**
 * BILLING RESILIENCE (2026-10-04), through the PRODUCTION composition: a
 * signed WhatsApp webhook, the real worker and queue, Postgres — and the real
 * analyser, pointed at a FAKE PROVIDER on this machine that refuses for
 * billing exactly as DeepSeek documents it (HTTP 402, "Insufficient
 * Balance"). Nothing reaches a real provider: the probe and the balance are
 * this file's own.
 *
 *   · A customer writes while it refuses: the conversation goes to a person AT
 *     ONCE as `provider_billing` — nothing drafted, nothing sent, the job not
 *     retried, one call made — with the ordinary hand-off alert.
 *   · The operator hears once, with the provider's words; an hour later, a
 *     second time ("still"); never twice for one step.
 *   · /health says `"model":"refusing"`; Today and the conversation page say
 *     why in the owner's words; the Inbox gives the reason.
 *   · It answers again: the sweep's probe ends it, /health says `answering`,
 *     Today's line goes, the conversation keeps its reason, the operator is
 *     told it is back, and the next customer is answered as usual.
 *   · The balance: the floor once and not again, again after a top-up went
 *     and came; "no longer available" is its own, and critical.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd8b0000-0000-4000-8000-${RUN}0001`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
type Tx = import('../../src/db/client.js').Tx;

const bidOf = async (raw: string) => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
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

const n = (i: number) => `9718${runDigits(RUN, 5)}${String(i).padStart(2, '0')}`;
let next = 0;
const buyer = () => n(++next);

/** The fake provider: refuses for billing, or answers an analysis. */
type Mode = 'refuse' | 'ok';
const ANALYSIS = JSON.stringify({
  language: { detected: 'en', reply_in: 'en' },
  intent: { primary_intent: 'inquiry', product_candidates: [], quantity_mentioned: null, next_logical_question: null, missing_fields: [] },
  phase: { recommended_phase: 'clarification' },
  wants_person: false,
});
const REFUSAL = JSON.stringify({ error: { message: 'Insufficient Balance', type: 'unknown_error', param: null, code: 'invalid_request_error' } });

d('billing resilience, through production, against a provider that refuses for billing (requires DATABASE_URL)', { timeout: 180_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let admin: import('../../src/db/client.js').Db;
  let server: Server;
  let mode: Mode = 'refuse';
  let calls = 0;
  let cookie = '';
  let balance: BalanceReading = { available: true, lines: [{ currency: 'CNY', total: 100, granted: 0, toppedUp: 100 }] };
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = ['Yes, we have it in blue.'];
  /** The analyser the worker asks: the real one at the fake provider, or a stand-in for one case. */
  let analyze: import('../../src/llm/ports.js').Analyzer['analyze'] = async () => { throw new Error('not built yet'); };

  const q = async <T>(fn: (tx: Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, await bidOf(BIZ), fn);
  };
  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });
  const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });
  const convOf = (wa: string) => until(() => q((tx) => sql<{ id: string }>`
    select c.id::text as id from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
     where cc.channel_user_id = ${wa} and c.is_active limit 1`.execute(tx).then((r) => r.rows[0]?.id)), `conversation of ${wa}`);
  const state = (conv: string) => q((tx) => sql<{ assigned: string | null; signals: string[]; drafts: number; outbound: number; turns: number }>`
    select c.assigned_to as assigned,
           coalesce((select array_agg(s.kind order by s.kind) from conversation_signals s
                      where s.conversation_id = c.id and s.resolved_at is null), '{}') as signals,
           (select count(*)::int from drafts dd where dd.conversation_id = c.id) as drafts,
           (select count(*)::int from outbound_messages o where o.conversation_id = c.id) as outbound,
           (select count(*)::int from turns tt where tt.conversation_id = c.id) as turns
      from conversations c where c.id = ${conv}::uuid`.execute(tx).then((r) => r.rows[0]!));
  const jobs = async (kind: string, conv: string | null = null) => {
    const { QUEUES } = await import('../../src/queue/boss.js');
    return (await sql<{ data: Record<string, unknown> }>`
      select data from pgboss.job
       where name = ${QUEUES.notify} and data->>'kind' = ${kind} and data->>'businessId' = ${BIZ}
         and (${conv}::text is null or data->>'conversationId' = ${conv})
       order by created_on`.execute(prod.db)).rows.map((r) => r.data);
  };
  /** Send one job to a queue and wait until it has run. */
  const runJob = async (queue: string) => {
    const id = await prod.boss.send(queue, {});
    await until(async () => ((await sql<{ state: string }>`select state from pgboss.job where id = ${id}::uuid`
      .execute(prod.db)).rows[0]?.state === 'completed' ? true : undefined), `${queue} to run`);
  };
  const health = async () => (await prod.app.inject({ method: 'GET', url: '/health' })).json() as { ok: boolean; model: string };
  const send = async (text: string) => {
    const from = buyer();
    expect((await post(sim.inboundText({ from, text }))).statusCode).toBe(200);
    return convOf(from);
  };

  beforeAll(async () => {
    // The fake provider, on this machine.
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
      req.on('end', () => {
        // The analysis, not the sweep's probe (a scheduled sweep may run meanwhile).
        if (body.includes('"max_tokens":1200')) calls++;
        if (mode === 'refuse') { res.writeHead(402, { 'content-type': 'application/json' }); res.end(REFUSAL); return; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'msg_stub', type: 'message', role: 'assistant', model: 'deepseek-flash',
          content: [{ type: 'text', text: ANALYSIS }], stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 40, output_tokens: 30 },
        }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const stub = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { llmClient } = await import('../../src/llm/provider.js');
    const { anthropicAnalyzer } = await import('../../src/llm/anthropic.js');
    admin = createDb(ADMIN_URL!);
    // The provider's state is the installation's: begin from "answering", with no balance step sent.
    await sql`update provider_health set refusing_since = null, reason = null, last_refused_at = null, refusals = 0,
                words = null, alerts_sent = 0, last_alert_at = null, last_since = null, answered_again_at = null,
                recovery_owed = false`.execute(admin);
    await sql`delete from provider_balance_alerts`.execute(admin);
    // Readings an earlier run left would make a spend this run never had.
    await sql`delete from provider_balance_checks`.execute(admin);
    sim = whatsappSimulator([], { tag: `pbl${RUN}` });
    await withTenantTx(admin, await bidOf(BIZ), async (tx) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Billing Resilience', 'service')
                on conflict (id) do nothing`.execute(tx);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 1000 where id = ${BIZ}`.execute(tx);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at)
                values (${BIZ}, 'whatsapp', 'connected', '+86 579****0128', now())`.execute(tx);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(tx);
    });
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    const client = llmClient({ name: 'custom', apiKey: 'stub-key-not-real-0000', baseURL: stub, model: 'deepseek-flash' });
    const real = anthropicAnalyzer(client, 'deepseek-flash', { thinking: { type: 'disabled' } });
    analyze = (input) => real.analyze(input);
    prod = await buildProduction({
      provider: 'meta',
      DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'pbl-verify-token-xx',
      CREDENTIAL_KEY: 'b'.repeat(64),
      PORT: 0,
    }, {
      adapter: sim.adapter, logger: false,
      models: {
        // The REAL analyser, at the fake provider: the refusal arrives as the SDK throws it.
        analyzer: { analyze: (input) => analyze(input) },
        replyWriter,
        probe: async () => { await client.messages.create({ model: 'deepseek-flash', max_tokens: 8, messages: [{ role: 'user', content: 'OK?' }] }, { timeout: 5_000, maxRetries: 0 }); },
        balance: async () => balance,
      },
    });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: FORM,
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 90_000);

  afterAll(async () => {
    await prod?.close();
    // Leave the installation answering, whatever happened above.
    if (admin) {
      await sql`update provider_health set refusing_since = null, reason = null, alerts_sent = 0, recovery_owed = false`.execute(admin).catch(() => {});
      await sql`delete from provider_balance_alerts`.execute(admin).catch(() => {});
      await admin.destroy();
    }
    server?.closeAllConnections();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  let first = '';

  it('a customer writes while it refuses: handed to a person at once as provider_billing — nothing drafted or sent, one call, no retry', async () => {
    mode = 'refuse';
    calls = 0;
    expect((await health()).model).toBe('answering');
    first = await send('Do you have this in blue?');
    await until(async () => ((await state(first)).assigned !== null ? true : undefined), 'the hand-over');
    const s = await state(first);
    expect(s.assigned).toBe('unclaimed');
    expect(s.signals).toEqual(['provider_billing']);
    expect(s.drafts).toBe(0);
    expect(s.outbound).toBe(0);
    expect(s.turns).toBe(0);
    expect(calls).toBe(1);                    // one analysis call: a 402 is not retried by the SDK…
    const { QUEUES } = await import('../../src/queue/boss.js');
    const inbound = (await sql<{ state: string; retry_count: number }>`
      select state, retry_count from pgboss.job where name = ${QUEUES.inbound} and data->>'conversationId' = ${first}`
      .execute(prod.db)).rows;
    expect(inbound.length).toBeGreaterThan(0);
    // …nor by the queue: every job of the conversation completed on its first try, none dead.
    await until(async () => ((await sql<{ state: string }>`
      select state from pgboss.job where name = ${QUEUES.inbound} and data->>'conversationId' = ${first}`
      .execute(prod.db)).rows.every((r) => r.state === 'completed') ? true : undefined), 'the jobs to complete');
    const after = (await sql<{ state: string; retry_count: number }>`
      select state, retry_count from pgboss.job where name = ${QUEUES.inbound} and data->>'conversationId' = ${first}`
      .execute(prod.db)).rows;
    expect(after.every((r) => r.retry_count === 0)).toBe(true);
    expect((await sql<{ n: number }>`select count(*)::int as n from pgboss.job
      where name = ${`${QUEUES.inbound}.dead`} and data->>'conversationId' = ${first}`.execute(prod.db)).rows[0]!.n).toBe(0);
    // The owner is told the way any hand-over is told.
    await until(async () => ((await jobs('handoff', first)).length > 0 ? true : undefined), 'the hand-over alert');
  });

  it('the operator hears once, with the provider’s own words; a second customer adds no second alert', async () => {
    const told = await until(async () => { const j = await jobs('provider_refusing'); return j.length ? j : undefined; }, 'the operator alert');
    expect(told).toHaveLength(1);
    expect(told[0]!['providerRefusal']).toMatchObject({ step: 0, words: 'Insufficient Balance' });
    const second = await send('And in red?');
    await until(async () => ((await state(second)).assigned !== null ? true : undefined), 'the second hand-over');
    expect((await state(second)).signals).toEqual(['provider_billing']);
    expect(await jobs('provider_refusing')).toHaveLength(1);
    const h = (await sql<{ refusals: number; words: string }>`select refusals, words from provider_health_now()`.execute(prod.db)).rows[0]!;
    expect(h.refusals).toBe(2);
    expect(h.words).toBe('Insufficient Balance');
  });

  it('/health says refusing; Today and the conversation page say why, in the owner’s words; the Inbox gives the reason', async () => {
    const hr = await prod.app.inject({ method: 'GET', url: '/health' });
    expect(hr.statusCode).toBe(200);              // the app serves: a 503 would block a deploy
    expect(hr.json()).toMatchObject({ ok: true, db: true, model: 'refusing' });
    const today = await get('/app');
    expect(today.statusCode).toBe(200);
    expect(today.body).toContain('id="provider-billing"');
    expect(today.body).toContain('ran out of credit');
    expect(today.body).toContain('Nothing was sent to your customers');
    expect(today.body).toContain('Nomi’s team has been told');
    const page = await get(`/app/inbox/${first}`);
    expect(page.body).toContain(t('en', 'providerBilling.title'));
    expect(page.body).toContain(t('en', 'providerBilling.why'));
    const inbox = await get('/app/inbox?filter=pending');
    expect(inbox.body).toContain(t('en', 'takeover.reason.provider_billing'));
    // Never a figure or the provider's words on an owner's page.
    expect(today.body).not.toContain('Insufficient Balance');
    expect(page.body).not.toContain('Insufficient Balance');
  });

  it('an hour on, the sweep tells the operator again ("still"); the step after it is not due yet', async () => {
    const { QUEUES } = await import('../../src/queue/boss.js');
    await sql`update provider_health set refusing_since = refusing_since - interval '2 hours'`.execute(admin);
    await runJob(QUEUES.provider);          // the probe is refused too: still refusing
    const told = await until(async () => { const j = await jobs('provider_refusing'); return j.length === 2 ? j : undefined; }, 'the second alert');
    expect(told[1]!['providerRefusal']).toMatchObject({ step: 1 });
    await runJob(QUEUES.provider);
    expect(await jobs('provider_refusing')).toHaveLength(2);
    expect((await health()).model).toBe('refusing');
  });

  it('it answers again: the probe ends it, Today’s line goes, the reason stays, the operator is told, and customers are answered', async () => {
    const { QUEUES } = await import('../../src/queue/boss.js');
    mode = 'ok';
    await runJob(QUEUES.provider);
    expect((await health()).model).toBe('answering');
    const today = await get('/app');
    expect(today.body).not.toContain('id="provider-billing"');
    expect(today.body).not.toContain('Nothing was sent to your customers');
    // …while the customer it handed over still waits, under its reason.
    expect(today.body).toContain(t('en', 'takeover.reason.provider_billing'));
    // The conversation it touched keeps its reason.
    const page = await get(`/app/inbox/${first}`);
    expect(page.body).toContain(t('en', 'providerBilling.title'));
    expect((await state(first)).signals).toEqual(['provider_billing']);
    const back = await until(async () => { const j = await jobs('provider_answering'); return j.length ? j : undefined; }, 'the "it answers again" notice');
    expect(back).toHaveLength(1);
    expect(back[0]!['providerRefusal']).toHaveProperty('until');
    // And the next customer is answered as usual: the model was asked, a reply waits.
    // (Not "in stock": a question about stock goes to the owner by its own rule, VAR.)
    const later = await send('Hello, what colours do you have?');
    await until(async () => ((await state(later)).drafts > 0 ? true : undefined), 'an ordinary answer');
    const s = await state(later);
    expect(s.assigned).toBeNull();
    expect(s.signals).toEqual([]);
    await runJob(QUEUES.provider);
    expect(await jobs('provider_answering')).toHaveLength(1);   // told once
  });

  it('the balance: the floor once and not again; again after a top-up went and came; unavailable is its own', async () => {
    const { QUEUES } = await import('../../src/queue/boss.js');
    const checks = async () => (await sql<{ n: number }>`select count(*)::int as n from provider_balance_checks`.execute(admin)).rows[0]!.n;
    const before = await checks();
    balance = { available: true, lines: [{ currency: 'CNY', total: 7.21, granted: 0, toppedUp: 7.21 },
                                         { currency: 'USD', total: 0, granted: 0, toppedUp: 0 }] };
    await runJob(QUEUES.providerBalance);
    const one = await jobs('provider_balance');
    expect(one).toHaveLength(1);
    expect(one[0]!['providerBalance']).toMatchObject({ step: 'floor', currency: 'CNY', total: 7.21, floor: 10, available: true });
    await runJob(QUEUES.providerBalance);
    expect(await jobs('provider_balance')).toHaveLength(1);            // the same step is not sent again
    balance = { available: true, lines: [{ currency: 'CNY', total: 100, granted: 0, toppedUp: 100 }] };
    await runJob(QUEUES.providerBalance);                               // topped up: nothing, and the floor re-armed
    expect(await jobs('provider_balance')).toHaveLength(1);
    balance = { available: true, lines: [{ currency: 'CNY', total: 5, granted: 0, toppedUp: 5 }] };
    await runJob(QUEUES.providerBalance);
    expect(await jobs('provider_balance')).toHaveLength(2);            // under the floor again: told again
    balance = { available: false, lines: [{ currency: 'CNY', total: 0, granted: 0, toppedUp: 0 }] };
    await runJob(QUEUES.providerBalance);
    const all = await jobs('provider_balance');
    expect(all).toHaveLength(3);
    expect(all[2]!['providerBalance']).toMatchObject({ step: 'unavailable', available: false });
    expect(await checks()).toBeGreaterThanOrEqual(before + 5);          // every reading kept, for the trend
  });

  it('no answer in time while the balance says it no longer pays: the real reason is billing — handed over at once', async () => {
    // The 2026-10-01 stall said nothing but silence. The balance (unavailable, read just above) says why.
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const before = analyze;
    analyze = async () => { throw new Anthropic.APIConnectionTimeoutError(); };
    try {
      const conv = await send('What sizes does it come in?');
      await until(async () => ((await state(conv)).assigned !== null ? true : undefined), 'the hand-over');
      const s = await state(conv);
      expect(s.signals).toEqual(['provider_billing']);
      expect(s.drafts).toBe(0);
      expect(s.outbound).toBe(0);
      expect((await health()).model).toBe('refusing');
      const h = (await sql<{ words: string }>`select words from provider_health_now()`.execute(prod.db)).rows[0]!;
      expect(h.words).toContain('is_available: false');
    } finally {
      analyze = before;
    }
  });
});
