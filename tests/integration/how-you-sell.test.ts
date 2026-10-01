import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits, flashSaid } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { Analysis } from '../../src/core/conversation/decide.js';

/**
 * HS (0096) — "HOW YOU SELL", through the owner's real routes and into the
 * rows that already hold each fact, in production's own composition.
 *
 *   · Nothing is written that she did not tick: an answer is a draft until its
 *     lines are ticked, and a save with no line ticked writes nothing.
 *   · Each line goes to its own table, audited there; one `how_you_sell_saved`
 *     row names the lines.
 *   · Her returns answer, once ticked, is what a customer who asks gets, word
 *     for word, alone on "sells" — and a new answer replaces it (archived,
 *     never erased).
 *   · A question that is not this business's is no page.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd980000-0000-4000-8000-${RUN}0001`;
const P1 = `dd980000-0000-4000-8001-${RUN}0001`;
const P2 = `dd980000-0000-4000-8001-${RUN}0002`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const KEY = 'e'.repeat(64);

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 90_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

d('HS · How you sell, end to end (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let cookie = '';
  let webSecret = '';
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();

  const q = async <R>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };
  const post = (url: string, payload: string) => prod.app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload });
  const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });
  const answer = (question: string) => q((tx) => sql<{ state: string; told_id: string | null }>`
    select state, told_id::text as told_id from selling_answers where business_id = ${BIZ}::uuid and question = ${question}`
    .execute(tx).then((x) => x.rows[0]));
  const audit = (action: string) => q((tx) => sql<{ detail: Record<string, unknown> }>`
    select detail from channel_audit where business_id = ${BIZ}::uuid and action = ${action} order by at, id`
    .execute(tx).then((r) => r.rows.map((x) => x.detail)));

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { modesFor } = await import('../../src/core/conversation/autonomyLevel.js');
    const { createHmac } = await import('node:crypto');
    webSecret = createHmac('sha256', KEY).update('yf-web-session').digest('hex');
    sim = whatsappSimulator([], { tag: `hs${RUN}` });
    const setup = createDb(DATABASE_URL!);
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    await withTenantTx(setup, b.value, async (t) => {
      await sql`insert into businesses (id, name, engine, kind, timezone) values (${BIZ}, 'Juniper Linen', 'service', 'brand', 'Asia/Dubai') on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 10000 where id = ${BIZ}`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                values (${BIZ}, 'whatsapp', 'connected', '+971 50****0098', now(), now(), 'test', false)`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      for (const [cap, mode] of Object.entries(modesFor('sells'))) {
        if (cap === 'confirm_order') continue;
        await sql`insert into autonomy_policy (business_id, capability, mode) values (${BIZ}, ${cap}, ${mode})
                  on conflict (business_id, capability) do update set mode = ${mode}`.execute(t);
      }
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
      for (const [id, sku, name] of [[P1, 'JL-1', 'Linen shirt'], [P2, 'JL-2', 'Linen trousers']] as const) {
        await sql`insert into products (id, business_id, sku, name, unit, moq, price_usd_per_unit, currency, is_active)
                  values (${id}, ${BIZ}, ${sku}, ${name}, 'item', null, 40, 'USD', true)`.execute(t);
      }
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'hs-verify-token-xxxx', CREDENTIAL_KEY: KEY, PORT: 0,
    }, { adapter: sim.adapter, logger: false, media: {}, models: { analyzer, replyWriter } });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: FORM,
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  it('THE HUB: a brand is asked the catalogue questions; a question that is not its own is no page', async () => {
    const hub = await get('/app/business/selling');
    expect(hub.statusCode).toBe(200);
    for (const question of ['price', 'minimum', 'returns', 'delivery', 'payment', 'certifications', 'hours', 'words']) {
      expect(hub.body, question).toContain(`href="/app/business/selling/${question}"`);
    }
    expect(hub.body).not.toContain('href="/app/business/selling/offered"');
    const notOurs = await get('/app/business/selling/offered');
    expect(notOurs.statusCode).toBe(302);
    expect(notOurs.headers['location']).toBe('/app/business/selling');
    // My business opens it.
    expect((await get('/app/business')).body).toContain('href="/app/business/selling"');
  });

  it('AN ANSWER IS A DRAFT UNTIL ITS LINES ARE TICKED; then each goes to its own row, and the next question opens', async () => {
    const typed = await post('/app/business/selling/price', 'quantityFirst=yes');
    expect(typed.statusCode).toBe(303);
    expect(typed.headers['location']).toBe('/app/business/selling/price/confirm');
    expect((await answer('price'))?.state).toBe('draft');
    const quantityFirst = () => q((tx) => sql<{ v: boolean | null }>`select quantity_first as v from businesses where id = ${BIZ}::uuid`
      .execute(tx).then((x) => x.rows[0]!.v));
    expect(await quantityFirst()).toBeNull();
    const page = await get('/app/business/selling/price/confirm');
    expect(page.body).toContain('name="line:quantity_first"');
    const saved = await post('/app/business/selling/price/confirm', 'line:quantity_first=on');
    expect(saved.statusCode).toBe(302);
    expect(saved.headers['location']).toBe('/app/business/selling/minimum');
    expect(await quantityFirst()).toBe(true);
    expect((await answer('price'))?.state).toBe('answered');
    expect((await audit('selling_set')).at(-1)).toEqual({ field: 'quantityFirst', from: null, to: true, via: 'how_you_sell' });
    expect((await audit('how_you_sell_saved')).at(-1)).toEqual({ question: 'price', lines: ['quantity_first'] });
  });

  it('A SAVE WITH NO LINE TICKED WRITES NOTHING, and says so', async () => {
    expect((await post('/app/business/selling/words', `terms=${encodeURIComponent('cheap\nknock-off')}`)).statusCode).toBe(303);
    const none = await post('/app/business/selling/words/confirm', '');
    expect(none.statusCode).toBe(302);
    expect(none.headers['location']).toBe('/app/business/selling/words/confirm');
    expect(flashSaid(none, webSecret)).toContain('Nothing was saved');
    expect(await q((tx) => sql<{ n: number }>`select count(*)::int as n from forbidden_terms where business_id = ${BIZ}::uuid`
      .execute(tx).then((x) => x.rows[0]!.n))).toBe(0);
    expect((await answer('words'))?.state).toBe('draft');
    // One of the two ticked: only that one is kept.
    expect((await post('/app/business/selling/words/confirm', 'line:word:knock-off=on')).statusCode).toBe(302);
    expect(await q((tx) => sql<{ term: string }>`select term from forbidden_terms where business_id = ${BIZ}::uuid and archived_at is null`
      .execute(tx).then((x) => x.rows.map((r) => r.term)))).toEqual(['knock-off']);
  });

  it('THE MINIMUM: one line per product it would change, and only the ticked product changes', async () => {
    expect((await post('/app/business/selling/minimum', 'mode=same&qty=2')).statusCode).toBe(303);
    const page = await get('/app/business/selling/minimum/confirm');
    expect(page.body).toContain(`name="line:minimum:${P1}"`);
    expect(page.body).toContain(`name="line:minimum:${P2}"`);
    expect((await post('/app/business/selling/minimum/confirm', `line:minimum:${P2}=on`)).statusCode).toBe(302);
    const moq = await q((tx) => sql<{ id: string; moq: number | null }>`select id::text as id, moq from products where business_id = ${BIZ}::uuid order by sku`
      .execute(tx).then((x) => x.rows));
    expect(moq).toEqual([{ id: P1, moq: null }, { id: P2, moq: 2 }]);
    expect((await audit('product_edited')).at(-1)).toEqual({ productId: P2, changes: { moq: { from: null, to: 2 } }, source: { via: 'how_you_sell' } });
  });

  it('RETURNS: the switch and the words, each ticked — and a customer who asks gets her words, word for word, alone', async () => {
    const said = 'Free returns within 14 days, unworn and with the tags on.';
    expect((await post('/app/business/selling/returns', `offer:returns=on&told=${encodeURIComponent(said)}`)).statusCode).toBe(303);
    const page = await get('/app/business/selling/returns/confirm');
    expect(page.body).toContain('name="line:promise:returns"');
    expect(page.body).toContain('name="line:told:returns"');
    expect(page.body).toContain(said);
    expect(page.body).toMatch(/Figures in it, sent exactly as written:[\s\S]{0,80}14/);
    expect((await post('/app/business/selling/returns/confirm', 'line:promise:returns=on&line:told:returns=on')).statusCode).toBe(302);
    const told = await q((tx) => sql<{ id: string; label: string; content: string; kind: string; product_id: string | null; source_language: string }>`
      select id::text as id, label, content, kind, product_id, source_language from product_knowledge
       where business_id = ${BIZ}::uuid and status = 'active'`.execute(tx).then((x) => x.rows));
    expect(told).toEqual([{ id: expect.any(String), label: 'Returns and refunds', content: said, kind: 'faq', product_id: null, source_language: 'en' }]);
    expect((await answer('returns'))?.told_id).toBe(told[0]!.id);

    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification', wantsPerson: false,
    } satisfies Analysis;
    replyWriter.replies = ['THE WRITER WAS ASKED'];
    const from = `9715${runDigits(RUN, 6)}1`;
    const w = sim.inboundText({ from, text: 'What are your returns and refunds?' });
    expect((await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } })).statusCode).toBe(200);
    const sent = await until(() => q((tx) => sql<{ body: string }>`
      select o.body from outbound_messages o join conversations c on c.id = o.conversation_id join clients cl on cl.id = c.client_id
       where c.business_id = ${BIZ}::uuid and cl.phone like ${`%${from}`} and o.origin = 'employee'`.execute(tx)
      .then((x) => x.rows[0]?.body)), 'the reply');
    expect(sent).toContain(said);
    expect(sent).not.toContain('THE WRITER WAS ASKED');
  }, 120_000);

  it('A NEW ANSWER REPLACES THE OLD ONE: archived, never erased, the new row naming it', async () => {
    const before = (await answer('returns'))!.told_id!;
    const said = 'Free returns within 30 days.';
    expect((await post('/app/business/selling/returns', `offer:returns=on&told=${encodeURIComponent(said)}`)).statusCode).toBe(303);
    // The switch is already on: only the words are a line.
    const page = await get('/app/business/selling/returns/confirm');
    expect(page.body).not.toContain('name="line:promise:returns"');
    expect((await post('/app/business/selling/returns/confirm', 'line:told:returns=on')).statusCode).toBe(302);
    const rows = await q((tx) => sql<{ id: string; status: string; content: string; supersedes_id: string | null }>`
      select id::text as id, status, content, supersedes_id::text as supersedes_id from product_knowledge
       where business_id = ${BIZ}::uuid order by created_at`.execute(tx).then((x) => x.rows));
    expect(rows).toEqual([
      { id: before, status: 'archived', content: expect.stringContaining('14 days'), supersedes_id: null },
      { id: expect.any(String), status: 'active', content: said, supersedes_id: before },
    ]);
  });

  it('HOURS AND A CLOSURE, in her zone; a question left for later; payment in words for a shop', async () => {
    expect((await post('/app/business/selling/hours',
      'hours=' + encodeURIComponent('Sat–Thu 10:00–22:00') + '&closure0.label=Eid&closure0.from=2027-03-20&closure0.to=2027-03-23')).statusCode).toBe(303);
    const page = await get('/app/business/selling/hours/confirm');
    expect(page.body).toContain('name="line:hours"');
    expect(page.body).toContain('name="line:closure:0"');
    expect((await post('/app/business/selling/hours/confirm', 'line:hours=on&line:closure:0=on')).statusCode).toBe(302);
    expect(await q((tx) => sql<{ h: string | null }>`select working_hours as h from businesses where id = ${BIZ}::uuid`
      .execute(tx).then((x) => x.rows[0]!.h))).toBe('Sat–Thu 10:00–22:00');
    expect(await q((tx) => sql<{ label: string; s: string; e: string }>`
      select label, starts_on::text as s, ends_on::text as e from factory_closures where business_id = ${BIZ}::uuid`
      .execute(tx).then((x) => x.rows))).toEqual([{ label: 'Eid', s: '2027-03-20', e: '2027-03-23' }]);

    const skipped = await post('/app/business/selling/certifications/skip', '');
    expect(skipped.statusCode).toBe(302);
    expect((await answer('certifications'))?.state).toBe('skipped');

    // A shop says how customers pay in words; no trade terms are written.
    expect((await post('/app/business/selling/payment', `told=${encodeURIComponent('Card, Apple Pay or cash on delivery.')}`)).statusCode).toBe(303);
    expect((await post('/app/business/selling/payment/confirm', 'line:told:payment=on')).statusCode).toBe(302);
    expect(await q((tx) => sql<{ n: number }>`select count(*)::int as n from trade_terms where business_id = ${BIZ}::uuid`
      .execute(tx).then((x) => x.rows[0]!.n))).toBe(0);
    const hub = await get('/app/business/selling');
    expect(hub.body).toContain('Answered');
    expect(hub.body).toContain('Left for later');
    // Setup carries the door and where she is: price, words, minimum, returns, hours, payment.
    const setup = await get('/app/settings');
    expect(setup.body).toContain('href="/app/business/selling"');
    expect(setup.body).toContain('6 of 8 answered');
  });

  it('A REFUSED ANSWER is shown back with its problem, and nothing is kept', async () => {
    const bad = await post('/app/business/selling/minimum', 'mode=same&qty=0');
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('A whole number, 1 or more.');
    expect((await answer('minimum'))?.state).toBe('answered');   // the earlier answer stands
  });
});
