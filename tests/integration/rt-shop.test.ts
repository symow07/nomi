import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import type { ProductId } from '../../src/core/types/ids.js';

/**
 * RT — A SHOP, END TO END, in production's own composition (a signed webhook →
 * pg-boss → the worker → the turn → the send path; the owner's real routes).
 *
 *   · On "sells", a shop's price question is answered with the price, alone:
 *     a quote at one, no "how many?" first. Retail reaches "sells".
 *   · A shop's pages state a single price as the price, and a minimum only
 *     where one is set.
 *   · The lead-time writer: the owner's days, audited, refused past a year.
 *   · What a shop promises (returns, here) is refused until the owner ticks it
 *     on How you sell, goes out once she has, and is refused again once she
 *     has not — the box binds the guard on the next turn.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd970000-0000-4000-8000-${RUN}0001`;
const PID = `dd970000-0000-4000-8001-${RUN}0001`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 90_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

d('RT · a shop, end to end (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let cookie = '';
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();

  const q = async <R>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };
  const post = (url: string, payload: string) =>
    prod.app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload });
  const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });
  const audit = (action: string) => q((tx) => sql<{ detail: Record<string, unknown> }>`
    select detail from channel_audit where business_id = ${BIZ}::uuid and action = ${action} order by at, id`
    .execute(tx).then((r) => r.rows.map((x) => x.detail)));

  /** A customer writes; wait until the turn has settled — a reply queued alone, or a draft. */
  const writes = async (from: string, text: string) => {
    const w = sim.inboundText({ from, text });
    expect((await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } })).statusCode).toBe(200);
    return until(() => q(async (tx) => {
      const r = (await sql<{ conv: string; sent: string | null; drafts: number }>`
        select c.id::text as conv,
               (select string_agg(o.body, ' | ') from outbound_messages o where o.conversation_id = c.id and o.origin = 'employee') as sent,
               (select count(*)::int from drafts dr where dr.conversation_id = c.id) as drafts
          from conversations c join clients cl on cl.id = c.client_id
         where c.business_id = ${BIZ}::uuid and cl.phone like ${`%${from}`}`.execute(tx)).rows[0];
      return r && (r.sent !== null || r.drafts > 0) ? r : undefined;
    }), `the turn for "${text}"`);
  };
  const asks = (over: Partial<Analysis['intent']> = {}): Analysis => ({
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [], ...over },
    recommendedPhase: 'clarification', wantsPerson: false,
  });

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { modesFor } = await import('../../src/core/conversation/autonomyLevel.js');
    sim = whatsappSimulator([], { tag: `rt${RUN}` });
    const setup = createDb(DATABASE_URL!);
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    await withTenantTx(setup, b.value, async (t) => {
      await sql`insert into businesses (id, name, engine, kind) values (${BIZ}, 'Rose Oil Studio', 'service', 'brand') on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 10000 where id = ${BIZ}`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                values (${BIZ}, 'whatsapp', 'connected', '+971 50****0097', now(), now(), 'test', false)`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      // The "sells" level, as the owner's choice writes it.
      for (const [cap, mode] of Object.entries(modesFor('sells'))) {
        if (cap === 'confirm_order') continue;
        await sql`insert into autonomy_policy (business_id, capability, mode) values (${BIZ}, ${cap}, ${mode})
                  on conflict (business_id, capability) do update set mode = ${mode}`.execute(t);
      }
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, price_usd_per_unit, currency, is_active)
                values (${PID}, ${BIZ}, 'ROSE-1', 'Rose lip oil', 'item', null, 12, 'USD', true)`.execute(t);
      await sql`insert into price_tiers (product_id, min_qty, unit_price_usd, currency) values (${PID}, 1, 12, 'USD')`.execute(t);
      await sql`insert into product_aliases (product_id, alias, language, alias_type) values (${PID}, 'Rose lip oil', 'en', 'common')`.execute(t);
      await sql`insert into pricing_policy (business_id, product_id, floor_price_usd, max_discount_pct, human_required_above_pct, currency)
                values (${BIZ}, ${PID}, 10, 5, 5, 'USD')`.execute(t);
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'rt-verify-token-xxxx', CREDENTIAL_KEY: 'd'.repeat(64), PORT: 0,
    }, { adapter: sim.adapter, logger: false, media: {}, models: { analyzer, replyWriter } });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: FORM,
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  it('ON "SELLS", A SHOP\'S PRICE QUESTION IS ANSWERED WITH THE PRICE, ALONE — a quote at one, no quantity asked', async () => {
    analyzer.next = asks({ primary: 'price_request',
      productCandidate: { productId: PID as ProductId, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' } });
    replyWriter.replies = ['The rose lip oil is $12.00.'];
    const r = await writes(`9715${runDigits(RUN, 6)}1`, 'How much is the rose lip oil?');
    expect(r.drafts).toBe(0);
    expect(r.sent).toContain('The rose lip oil is $12.00.');
    const quote = await q((tx) => sql<{ quantity: number; unit_price_usd: string }>`
      select quantity, unit_price_usd from quotes where conversation_id = ${r.conv}::uuid`.execute(tx).then((x) => x.rows[0]));
    expect(quote).toEqual({ quantity: 1, unit_price_usd: expect.stringMatching(/^12(\.0+)?$/) });
    // The writer was told: the price first.
    expect(replyWriter.inputs.at(-1)!.priceFirst).toBe(true);
  }, 120_000);

  it('A SHOP\'S PAGES: a single price is the price, and no minimum is shown where none is set', async () => {
    const list = await get('/app/products');
    expect(list.statusCode).toBe(200);
    expect(list.body).toContain('Rose lip oil');
    expect(list.body).toContain('$12.00');
    expect(list.body).not.toContain('Min. order');
    const page = await get(`/app/products/${PID}`);
    expect(page.body).not.toContain('Min. order');
    // A minimum she set is shown.
    expect((await post(`/app/products/${PID}/edit`, 'moq=3&isActive=on')).statusCode).toBe(302);
    expect((await get('/app/products')).body).toMatch(/Min\. order[\s\S]{0,80}3/);
    expect((await post(`/app/products/${PID}/edit`, 'moq=&isActive=on')).statusCode).toBe(302);
  });

  it('THE LEAD-TIME WRITER: her days, on the product and the audit trail; empty is "not said"; past a year is refused', async () => {
    const leadTime = () => q((tx) => sql<{ d: number | null }>`select lead_time_days as d from products where id = ${PID}::uuid`
      .execute(tx).then((x) => x.rows[0]!.d));
    expect(await leadTime()).toBeNull();
    expect((await post(`/app/products/${PID}/edit`, 'leadTime=5&isActive=on')).statusCode).toBe(302);
    expect(await leadTime()).toBe(5);
    expect((await audit('product_edited')).at(-1)).toMatchObject({ productId: PID, changes: { leadTime: { from: null, to: 5 } } });
    expect((await get(`/app/products/${PID}`)).body).toContain('5 days');
    const far = await post(`/app/products/${PID}/edit`, 'leadTime=400&isActive=on');
    expect(far.statusCode).toBe(400);
    expect(far.body).toContain('At most 365 days.');
    expect(await leadTime()).toBe(5);
    expect((await post(`/app/products/${PID}/edit`, 'leadTime=&isActive=on')).statusCode).toBe(302);
    expect(await leadTime()).toBeNull();
  });

  it('A RETURNS PROMISE goes out once she ticks it — and is refused again once she has not', async () => {
    const promises = () => q((tx) => sql<{ claim_key: string; allowed: boolean }>`
      select claim_key, allowed from claims_policy where business_id = ${BIZ}::uuid and kind = 'guarantee' and claim_key = 'returns'`
      .execute(tx).then((x) => x.rows));
    analyzer.next = asks();
    replyWriter.replies = ['Yes, returns are free.'];

    // She ticks it: recorded, audited, and the page shows it ticked.
    const on = await post('/app/business/selling/promises', 'promise:returns=on');
    expect(on.statusCode).toBe(302);
    expect(await promises()).toEqual([{ claim_key: 'returns', allowed: true }]);
    expect((await audit('selling_set')).at(-1)).toEqual({ field: 'promise', key: 'returns', from: false, to: true });
    expect((await get('/app/business/selling')).body).toMatch(/name="promise:returns" checked/);
    const allowed = await writes(`9715${runDigits(RUN, 6)}2`, 'Do you take returns?');
    expect(allowed.sent).toContain('Yes, returns are free.');

    // She unticks it: the next customer is not promised it.
    expect((await post('/app/business/selling/promises', '')).statusCode).toBe(302);
    expect(await promises()).toEqual([{ claim_key: 'returns', allowed: false }]);
    expect((await audit('selling_set')).at(-1)).toEqual({ field: 'promise', key: 'returns', from: true, to: false });
    const refused = await writes(`9715${runDigits(RUN, 6)}3`, 'Can I send it back if it does not suit me?');
    expect(refused.sent ?? '').not.toContain('returns are free');
    const draft = await q((tx) => sql<{ body: string }>`select draft_text as body from drafts where conversation_id = ${refused.conv}::uuid`
      .execute(tx).then((x) => x.rows[0]?.body ?? ''));
    expect(draft).not.toContain('returns are free');
  }, 180_000);
});
