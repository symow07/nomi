import { settingsHref } from '../../src/api/web/settingsNavigation.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import pg from 'pg';
import { runDigits, flashSaid } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import type { Analysis } from '../../src/core/conversation/decide.js';

/**
 * 4.1 — 0240's trial-over hold through the WHOLE production composition (`buildProduction`: the webhook, the worker,
 * the send gate, the web app), adapted from freeze.test.ts. Written by the independent tester (2026-11-11); kept in the
 * branch by the fix round, its D4 case now an assertion: the hold's own name, never "the subscription ended".
 * A self-serve workspace, WhatsApp connected 20 days ago, a 14-day trial granted, no card.
 *
 *   · switch off: nothing held — a message is stored (the control);
 *   · switch on: a message already stored whose turn runs after the switch → no model asked, handed to a person
 *     (`billing_trial_over`); a new message is acknowledged and dropped; a queued reply is cancelled `frozen`; the owner's
 *     reply refused with the trial's words; every page says so; told once (`billing_trial_over`);
 *   · a card saved (`card_saved_at`): lifted at once — messages stored, the owner's reply goes;
 *   · the card gone again and the switch cleared: nothing held.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `d4f10000-0000-4000-8000-${RUN}0001`;
const KEY = 'b'.repeat(64);
const DAY = 86_400_000;

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 60_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

d('4.1 verify · the trial over with no card, held through the production composition', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let admin: pg.Client;
  let cookie = '';
  let webSecret = '';
  let conv = '';
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();
  const BUYER = `9715${runDigits(RUN, 6)}8`;
  const ANALYSIS = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification', wantsPerson: false,
  } satisfies Analysis;

  const post = (url: string, form: Record<string, string>) => prod.app.inject({
    method: 'POST', url, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', referer: `https://app.example.test/app/inbox/${conv}` },
    payload: new URLSearchParams(form).toString() });
  const get = (url: string) => prod.app.inject({ method: 'GET', url: settingsHref(url), headers: { cookie } });
  const n = async (q: string, p: unknown[]) => Number((await admin.query(q, p)).rows[0].n);
  const write = async (text: string) => {
    const w = sim.inboundText({ from: BUYER, text });
    const r = await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });
    expect(r.statusCode).toBe(200);
  };
  const said = (text: string) => n(`select count(*) as n from messages m join conversations c on c.id = m.conversation_id
                                     where c.business_id = $1 and m.text_content = $2`, [BIZ, text]);
  const receipts = (text: string) => n(`select count(*) as n from channel_events where business_id = $1 and payload::text like $2`, [BIZ, `%${text}%`]);
  const flagOn = () => admin.query(`insert into ops_flags (flag, business_id, reason, set_by) values ('billing_required', null, $1, 'test')`, [`t41v ${RUN}`]);
  const flagOff = () => admin.query(`update ops_flags set cleared_at = now() where flag = 'billing_required' and cleared_at is null and reason = $1`, [`t41v ${RUN}`]);

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    webSecret = createHmac('sha256', KEY).update('yf-web-session').digest('hex');
    sim = whatsappSimulator([], { tag: `tv${RUN}` });
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    // Signed itself up (billed), WhatsApp connected 20 days ago; a 14-day trial granted; no card.
    await admin.query(`insert into businesses (id, name, engine, kind, owner_locale, signed_up_at, batch_debounce_ms, batch_max_window_ms)
                       values ($1, 'Trial Studio', 'service', 'brand', 'en', now() - interval '30 days', 2500, 10000)`, [BIZ]);
    await admin.query(`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                       values ($1, 'whatsapp', 'connected', '+971 50****0198', $2, $2, 'test', false)`, [BIZ, new Date(Date.now() - 20 * DAY)]);
    await admin.query(`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                       values ($1, 'whatsapp', $2, 'sim-test', 'service')`, [BIZ, sim.phoneNumberId]);
    await admin.query(`insert into assistants (business_id, name, is_default) values ($1, 'Lily', true)`, [BIZ]);
    await admin.query(`insert into onboarding_state (business_id, assistant_named_at) values ($1, now())
                       on conflict (business_id) do update set assistant_named_at = now()`, [BIZ]);
    await admin.query(`insert into people (business_id, name, is_owner) values ($1, 'Rana', true)`, [BIZ]);
    await admin.query(`insert into workspace_billing (business_id, trial_days, trial_granted_by, trial_granted_at) values ($1, 14, 'op', now())`, [BIZ]);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'tv-verify-token-xxxx', CREDENTIAL_KEY: KEY, PORT: 0,
      PUBLIC_BASE_URL: 'https://app.example.test',
    }, { adapter: sim.adapter, logger: false, media: {}, models: { analyzer, replyWriter } });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  }, 120_000);

  afterAll(async () => {
    await flagOff().catch(() => undefined);
    await admin?.query(`delete from pgboss.job where data->>'businessId' = $1`, [BIZ]).catch(() => undefined);
    await prod?.close();
    await admin?.end();
  });

  it('SWITCH OFF: the trial long over, no card — nothing held; a message is stored and answered (the control)', async () => {
    analyzer.next = ANALYSIS;
    replyWriter.replies = ['Yes, every Friday.'];
    await write(`do you ship on fridays ${RUN}`);
    await until(async () => ((await said(`do you ship on fridays ${RUN}`)) === 1 ? true : undefined), 'the control message');
    await until(async () => (analyzer.calls >= 1 ? true : undefined), 'the control turn');
    conv = (await admin.query(`select id::text as id from conversations where business_id = $1 order by created_at limit 1`, [BIZ])).rows[0].id;
  }, 90_000);

  it('SWITCH ON: a message stored before, its turn after — no model asked, handed to a person (billing_trial_over)', async () => {
    const before = analyzer.calls;
    await write(`a message in the gap ${RUN}`);  // stored: the switch is still off when the webhook asks
    expect(await receipts(`a message in the gap ${RUN}`)).toBe(1);
    await flagOn();  // inside the 2.5 s batching window: the turn runs held
    const handed = await until(async () => {
      const r = (await admin.query(`select assigned_to from conversations where id = $1`, [conv])).rows[0];
      return r && r.assigned_to ? r : undefined;
    }, 'the hand-off', 30_000);
    const signals = (await admin.query(`select kind from conversation_signals where conversation_id = $1 and resolved_at is null`, [conv])).rows.map((r: { kind: string }) => r.kind);
    expect({ analysedSince: analyzer.calls - before, signals, handed }).toMatchObject({ analysedSince: 0, signals: ['billing_trial_over'] });
  }, 90_000);

  it('D4 · the Inbox row and the conversation say the trial ended with no card — never "the subscription ended"', async () => {
    const list = (await get('/app/inbox')).body;
    expect(list, 'the row is listed').toContain(`/app/inbox/${conv}`);
    expect(list).not.toContain(esc(t('en', 'takeover.reason.billing_lapsed')));
    expect(list).toContain(esc(t('en', 'takeover.reason.billing_trial_over')));
    const page = (await get(`/app/inbox/${conv}`)).body;
    expect(page).not.toContain(esc(t('en', 'takeover.reason.billing_lapsed')));
    expect(page).toContain(esc(t('en', 'takeover.reason.billing_trial_over')));
    expect(page).not.toContain('subscription has ended');
    // Today and My business: the banner in the trial's words, nothing about a subscription.
    for (const at of ['/app', '/app/business']) {
      const body = (await get(at)).body;
      expect(body, at).toContain(esc(t('en', 'frozen.trialOver.title')));
      expect(body, at).not.toContain(esc(t('en', 'frozen.banner.title')));
      expect(body, at).not.toContain('subscription has ended');
      expect(body, at).not.toContain(esc(t('en', 'takeover.reason.billing_lapsed')));
    }
  });

  it('SWITCH ON: a new message is acknowledged and dropped; a queued reply is cancelled frozen', async () => {
    await write(`are you there ${RUN}`);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await receipts(`are you there ${RUN}`)).toBe(0);
    expect(await said(`are you there ${RUN}`)).toBe(0);
    const { QUEUES } = await import('../../src/queue/boss.js');
    await prod.boss.send(QUEUES.outbound, { businessId: BIZ, conversationId: conv, reply: `queued before the hold ${RUN}` });
    const row = await until(async () => {
      const r = (await admin.query<{ status: string; cancel_reason: string | null }>(
        `select status, cancel_reason from outbound_messages where conversation_id = $1 and body = $2`, [conv, `queued before the hold ${RUN}`])).rows[0];
      return r && r.status !== 'queued' ? r : undefined;
    }, 'the queued reply');
    expect(row).toEqual({ status: 'canceled', cancel_reason: 'canceled: frozen' });
  }, 90_000);

  it('SWITCH ON: the owner\'s reply refused in the trial\'s words; pages say so; told once', async () => {
    const r = await post(`/app/inbox/${conv}/reply`, { text: 'Hello from the owner' });
    expect(flashSaid(r, webSecret)).toBe(t('en', 'frozen.refused.trialOver'));
    expect((await get('/app')).body).toContain(esc(t('en', 'frozen.trialOver.title')));
    // D4 — the reply cancelled `frozen` is told on the conversation in the trial's words, not the lapse's.
    const page = (await get(`/app/inbox/${conv}`)).body;
    expect(page).toContain(esc(t('en', 'refused.frozen.trialOver.why', { name: 'Lily' })));
    expect(page).not.toContain(esc(t('en', 'refused.why.frozen', { name: 'Lily' })));
    const { billingAlerts } = await import('../../src/pipeline/billing.js');
    const first = (await billingAlerts(prod.db)).filter((j) => j.businessId === BIZ).map((j) => j.kind);
    const second = (await billingAlerts(prod.db)).filter((j) => j.businessId === BIZ).map((j) => j.kind);
    // The production composition runs the same claim every five minutes (`*/5`): if it ran first, its alert is queued.
    const bySweep = await n(`select count(*) as n from pgboss.job where data->>'businessId' = $1 and data->>'kind' = 'billing_trial_over'`, [BIZ]);
    expect({ told: first.length + bySweep, first: first.filter((k) => k !== 'billing_trial_over'), second }).toEqual({ told: 1, first: [], second: [] });
    expect((await admin.query(`select told_trial_over_at from workspace_billing where business_id = $1`, [BIZ])).rows[0].told_trial_over_at).not.toBeNull();
  });

  it('A CARD SAVED: lifted at once — messages stored, the owner\'s reply goes', async () => {
    await admin.query(`update workspace_billing set card_saved_at = now() where business_id = $1`, [BIZ]);
    analyzer.next = ANALYSIS;
    replyWriter.replies = ['Welcome back.'];
    await write(`back again ${RUN}`);
    await until(async () => ((await said(`back again ${RUN}`)) === 1 ? true : undefined), 'the message after the card');
    const r = await post(`/app/inbox/${conv}/reply`, { text: 'We are back' });
    expect(flashSaid(r, webSecret)).not.toBe(t('en', 'frozen.refused.trialOver'));
    expect((await get('/app')).body).not.toContain('id="frozen"');
  }, 90_000);

  it('NO CARD AGAIN, SWITCH CLEARED: nothing held', async () => {
    await admin.query(`update workspace_billing set card_saved_at = null where business_id = $1`, [BIZ]);
    expect((await get('/app')).body).toContain('id="frozen"');
    await flagOff();
    await write(`switch off again ${RUN}`);
    await until(async () => ((await said(`switch off again ${RUN}`)) === 1 ? true : undefined), 'the message with the switch off');
    expect((await get('/app')).body).not.toContain('id="frozen"');
  }, 90_000);
});
