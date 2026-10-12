import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID, createHmac } from 'node:crypto';
import pg from 'pg';
import { runDigits, flashSaid } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import type { Analysis } from '../../src/core/conversation/decide.js';

/**
 * D4 (the owner's decision, 2026-10-12) — FROZEN ON LAPSE, NEVER ERASED BY A
 * TIMER. Through the whole production composition (the webhook, the worker,
 * the web app), against real Postgres:
 *
 *   · a buyer writes while the subscription is live: stored, as ever (the control);
 *   · the subscription lapses: the next message is acknowledged and dropped —
 *     no receipt, no message; the owner's own reply is refused; a reply already
 *     queued is cancelled at send time as `frozen`; every page says so and stays
 *     readable; taking a copy works; closing the workspace still reaches its own
 *     handler; what was there before is all still there;
 *   · the subscription is renewed: everything comes back as it was.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `d4f00000-0000-4000-8000-${RUN}0001`;
const KEY = 'b'.repeat(64);

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 60_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

d('D4 · frozen on lapse (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let admin: pg.Client;
  let cookie = '';
  let webSecret = '';
  let conv = '';
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();
  const BUYER = `9715${runDigits(RUN, 6)}7`;

  const post = (url: string, form: Record<string, string>) => prod.app.inject({
    method: 'POST', url, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', referer: `https://app.example.test/app/inbox/${conv}` },
    payload: new URLSearchParams(form).toString() });
  const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });
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
  const lapse = () => admin.query(`insert into workspace_billing (business_id, status, lapsed_at) values ($1, 'lapsed', now())
                                   on conflict (business_id) do update set status = 'lapsed', lapsed_at = now()`, [BIZ]);
  const renew = () => admin.query(`update workspace_billing set status = 'active', lapsed_at = null where business_id = $1`, [BIZ]);

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    webSecret = createHmac('sha256', KEY).update('yf-web-session').digest('hex');
    sim = whatsappSimulator([], { tag: `fz${RUN}` });
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    // A workspace that signed itself up (so it is billed), live on WhatsApp.
    await admin.query(`insert into businesses (id, name, engine, kind, owner_locale, signed_up_at, batch_debounce_ms, batch_max_window_ms)
                       values ($1, 'Frozen Studio', 'service', 'brand', 'en', now(), 300, 10000)`, [BIZ]);
    await admin.query(`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                       values ($1, 'whatsapp', 'connected', '+971 50****0199', now(), now(), 'test', false)`, [BIZ]);
    await admin.query(`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                       values ($1, 'whatsapp', $2, 'sim-test', 'service')`, [BIZ, sim.phoneNumberId]);
    await admin.query(`insert into assistants (business_id, name, is_default) values ($1, 'Lily', true)`, [BIZ]);
    await admin.query(`insert into onboarding_state (business_id, assistant_named_at) values ($1, now())
                       on conflict (business_id) do update set assistant_named_at = now()`, [BIZ]);
    await admin.query(`insert into people (business_id, name, is_owner) values ($1, 'Rana', true)`, [BIZ]);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'fz-verify-token-xxxx', CREDENTIAL_KEY: KEY, PORT: 0,
      PUBLIC_BASE_URL: 'https://app.example.test',
    }, { adapter: sim.adapter, logger: false, media: {}, models: { analyzer, replyWriter } });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  }, 120_000);

  afterAll(async () => {
    await admin?.query(`delete from pgboss.job where data->>'businessId' = $1`, [BIZ]).catch(() => undefined);
    await prod?.close();
    await admin?.end();
  });

  it('LIVE: a buyer\'s message is stored, as ever (the control)', async () => {
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification', wantsPerson: false,
    } satisfies Analysis;
    replyWriter.replies = ['Yes, every Friday.'];
    await write(`do you ship on fridays ${RUN}`);
    await until(async () => ((await said(`do you ship on fridays ${RUN}`)) === 1 ? true : undefined), 'the live message');
    conv = (await admin.query(`select id::text as id from conversations where business_id = $1 order by created_at limit 1`, [BIZ])).rows[0].id;
  }, 90_000);

  it('LAPSED: what arrives is acknowledged and dropped — no receipt, no message', async () => {
    await lapse();
    await write(`are you there ${RUN}`);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await receipts(`are you there ${RUN}`)).toBe(0);
    expect(await said(`are you there ${RUN}`)).toBe(0);
  });

  it('LAPSED: the owner\'s own reply is refused, and nothing is queued', async () => {
    const before = await n(`select count(*) as n from outbound_messages where conversation_id = $1`, [conv]);
    const r = await post(`/app/inbox/${conv}/reply`, { text: 'Hello from the owner' });
    expect(flashSaid(r, webSecret)).toBe(t('en', 'frozen.refused'));
    expect(await n(`select count(*) as n from outbound_messages where conversation_id = $1`, [conv])).toBe(before);
  });

  it('LAPSED: a reply already on its way is cancelled at send time, as frozen', async () => {
    const { QUEUES } = await import('../../src/queue/boss.js');
    await prod.boss.send(QUEUES.outbound, { businessId: BIZ, conversationId: conv, reply: `queued before the lapse ${RUN}` });
    const row = await until(async () => {
      const r = (await admin.query<{ status: string; cancel_reason: string | null }>(
        `select status, cancel_reason from outbound_messages where conversation_id = $1 and body = $2`, [conv, `queued before the lapse ${RUN}`])).rows[0];
      return r && r.status !== 'queued' ? r : undefined;
    }, 'the queued reply to be decided');
    expect(row.status).toBe('canceled');
    expect(row.cancel_reason).toBe('canceled: frozen');
    expect(await n(`select count(*) as n from messages where conversation_id = $1 and text_content = $2`, [conv, `queued before the lapse ${RUN}`])).toBe(0);
  }, 90_000);

  it('LAPSED: every page says so and stays readable; a copy can be taken; closing still reaches its own door', async () => {
    const today = await get('/app');
    expect(today.statusCode).toBe(200);
    expect(today.body).toContain(esc(t('en', 'frozen.banner.title')));
    const page = await get(`/app/conversations/${conv}`);
    expect(page.body).toContain(esc(`do you ship on fridays ${RUN}`));
    expect(page.body).toContain('id="frozen"');
    const copy = await get('/app/settings/data/messages.csv');
    expect(String(copy.headers['content-type'])).toContain('text/csv');
    expect(copy.body).toContain(`do you ship on fridays ${RUN}`);
    // The installation's own workspace is never closed from inside: refused by its own rule, not by the freeze.
    const close = await post('/app/settings/data/close', { name: 'Frozen Studio' });
    expect(flashSaid(close, webSecret)).not.toBe(t('en', 'frozen.refused'));
  });

  it('RENEWED: everything comes back as it was — messages are stored and the owner\'s replies go', async () => {
    await renew();
    await write(`back again ${RUN}`);
    await until(async () => ((await said(`back again ${RUN}`)) === 1 ? true : undefined), 'the message after renewal');
    const r = await post(`/app/inbox/${conv}/reply`, { text: 'We are back' });
    expect(flashSaid(r, webSecret)).not.toBe(t('en', 'frozen.refused'));
    expect(await said(`do you ship on fridays ${RUN}`)).toBe(1);
    expect((await get('/app')).body).not.toContain('id="frozen"');
  }, 90_000);
});
