import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { seedRunTenant, flashSaid } from './tenant.js';
import { FakeAnalyzer } from '../pipeline/fakes.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import type { ReplyWriter } from '../../src/llm/ports.js';

/**
 * Block 3 PR 3 (0230) — "DID TEACHING BREAK ANYTHING?", end to end on a workspace with two saved cases (replies a
 * person typed): one about the amber candle's price, one about shipping. The owner moves the price from 12 to 15 on
 * the product's page: the price does NOT move — a check is staged and its job kicked. The job runs both cases through
 * the real turn against the staged price, in transactions that are rolled back: the candle case shows the new figure,
 * the shipping case is unchanged, the model calls are on the ledger, and no draft, turn or conversation was kept. Keep
 * moves the price; a second check reverted moves nothing. Staff may not decide.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `dd230000-0000-4000-8000-${RUN}0001`;
const PRODUCT = `dd230000-0000-4000-8001-${RUN}0001`;
const ASSISTANT = `dd230000-0000-4000-8002-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const Q_PRICE = 'How much is the amber candle?';
const Q_SHIP = 'Do you ship to Spain?';

const bidOf = async (raw: string) => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
};
const reads = (product: boolean): Analysis => ({
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary: product ? 'price_request' : 'inquiry', productCandidate: product ? { productId: PRODUCT as never, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' } : null,
    quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: product ? 'commercial_discussion' : 'clarification', wantsPerson: false, wantsDeletion: false,
});
/** A writer that says the quote it was handed, so the re-run shows the staged price and nothing else. */
class EchoWriter implements ReplyWriter {
  calls = 0;
  async write(input: Parameters<ReplyWriter['write']>[0]) {
    this.calls++;
    const reply = input.quote ? `The amber candle is ${input.quote.unitPrice.amount} each.` : 'Yes, we ship across Europe.';
    return { reply, promptVersion: 'echo@1', modelId: 'fake-model', usage: { inputTokens: 300, outputTokens: 60 } };
  }
}

d('0230 · before it goes live (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let owner = ''; let staff = '';
  const kicked: string[] = [];
  const analyzer = new FakeAnalyzer();
  analyzer.next = reads(false);
  analyzer.byText.set(Q_PRICE, reads(true));
  const writer = new EchoWriter();
  const login = async (code: string) => {
    const res = await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM });
    return String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  };
  const post = (cookie: string, url: string, body: Record<string, string>) =>
    app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(), headers: { cookie, ...FORM } });
  const q = async <T>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, await bidOf(BIZ), fn);
  };
  const price = () => q((t) => sql<{ p: string }>`select price_usd_per_unit::numeric(12,2)::text as p from products where id = ${PRODUCT}::uuid`.execute(t).then((r) => r.rows[0]!.p));
  const counts = () => q((t) => sql<{ drafts: number; turns: number; convs: number; calls: number }>`
    select (select count(*)::int from drafts where business_id = ${BIZ}::uuid) as drafts,
           (select count(*)::int from turns where business_id = ${BIZ}::uuid) as turns,
           (select count(*)::int from conversations where business_id = ${BIZ}::uuid) as convs,
           (select coalesce(sum(llm_calls), 0)::int from usage_ledger where business_id = ${BIZ}::uuid) as calls`.execute(t).then((r) => r.rows[0]!));

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    db = createDb(DATABASE_URL!);
    const bid = await bidOf(BIZ);
    await withTenantTx(db, bid, async (t) => {
      await sql`insert into businesses (id, name, owner_locale, kind, country, currency, timezone) values (${BIZ}, 'Cases Test Co', 'en', 'brand', 'US', 'USD', 'America/New_York') on conflict (id) do nothing`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, price_usd_per_unit, is_active, currency) values (${PRODUCT}, ${BIZ}, 'C-100', 'Amber candle', 'item', null, 12, true, 'USD')`.execute(t);
      await sql`insert into price_tiers (product_id, min_qty, unit_price_usd) values (${PRODUCT}, 1, 12)`.execute(t);
      await sql`insert into product_aliases (product_id, alias, language) values (${PRODUCT}, 'amber candle', 'en')`.execute(t);
      await sql`insert into assistants (id, business_id, name, role, is_default) values (${ASSISTANT}, ${BIZ}, 'Lily', 'sales', true)`.execute(t);
      // Two saved cases: a person typed each reply in the channel's own app (an echo), after the customer's question.
      const c = await ensureConversation(t, bid, `+1555${RUN.slice(0, 4)}01`, 'Case Buyer', 'whatsapp');
      await sql`insert into messages (conversation_id, direction, text_content, sent_at) values (${c.conversationId}::uuid, 'inbound', ${Q_PRICE}, now() - interval '3 days')`.execute(t);
      await sql`insert into messages (conversation_id, direction, text_content, sent_at, external_id) values (${c.conversationId}::uuid, 'outbound', 'It is 12.00 each.', now() - interval '3 days' + interval '1 minute', ${`echo:${RUN}a`})`.execute(t);
      await sql`insert into messages (conversation_id, direction, text_content, sent_at) values (${c.conversationId}::uuid, 'inbound', ${Q_SHIP}, now() - interval '2 days')`.execute(t);
      await sql`insert into messages (conversation_id, direction, text_content, sent_at, external_id) values (${c.conversationId}::uuid, 'outbound', 'Yes, we ship across Europe.', now() - interval '2 days' + interval '1 minute', ${`echo:${RUN}b`})`.execute(t);
    });
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: { level: 'error' } });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: `cases-${RUN}`, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
      kickCaseCheck: async (_b: string, id: string) => { kicked.push(id); },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    owner = await login(`cases-${RUN}`);
    const team = await addPerson(db, BIZ, SECRET, `Staff ${RUN}`, 'team'); if (team.code !== 'added') throw new Error('fixture');
    staff = await login(team.accessCode);
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('a price moved is staged, not written: a check is kicked and the product keeps its price', async () => {
    const before = await counts();
    const res = await post(owner, `/app/products/${PRODUCT}/edit`, { price: '15', isActive: 'on' });
    expect(res.statusCode).toBe(302);
    expect(String(res.headers['location'])).toMatch(/\/app\/assistant\/knowledge\/checks\//);
    expect(flashSaid(res, SECRET)).toContain('saved cases are running');
    expect(kicked).toHaveLength(1);
    expect(await price()).toBe('12.00');
    const row = await q((t) => sql<{ status: string; kind: string; n: number; touching: number }>`select status, kind, jsonb_array_length(refs)::int as n, touching from case_checks where id = ${kicked[0]}::uuid`.execute(t).then((r) => r.rows[0]!));
    expect(row).toEqual({ status: 'running', kind: 'price', n: 2, touching: 1 });
    expect(await counts()).toEqual(before);
    const page = await app.inject({ method: 'GET', url: `/app/assistant/knowledge/checks/${kicked[0]}`, headers: { cookie: owner } });
    expect(page.statusCode).toBe(200);
    expect(page.headers['refresh']).toBe('5');
    expect(page.body).toContain('The cases are running');
  });

  it('the job: both cases run against the staged price in rolled-back transactions — the candle shows 15, shipping is unchanged, the calls are on the ledger, nothing else is kept', async () => {
    const { runCheck } = await import('../../src/pipeline/caseChecks.js');
    const before = await counts();
    const out = await runCheck({ db, businessId: await bidOf(BIZ), checkId: kicked[0]!, models: { analyzer, replyWriter: writer }, publicBaseUrl: null });
    expect(out).toEqual({ ran: 2, status: 'done' });
    expect(writer.calls).toBe(2);
    const after = await counts();
    expect(after.drafts).toBe(before.drafts); expect(after.turns).toBe(before.turns); expect(after.convs).toBe(before.convs);
    expect(after.calls).toBe(before.calls + 4);                 // two cases, an analysis and a reply each
    expect(await price()).toBe('12.00');                         // still staged
    const { checkById } = await import('../../src/db/cases.js');
    const c = (await q((t) => checkById(t, BIZ as never, kicked[0]!)))!;
    expect(c.status).toBe('done');
    expect(c.results.map((r) => [r.touching, r.changed, r.figuresAccepted, r.figuresReply, r.reply])).toEqual([
      [true, true, ['12'], ['15'], 'The amber candle is 15 each.'],
      [false, false, [], [], 'Yes, we ship across Europe.'],
    ]);
    const page = await app.inject({ method: 'GET', url: `/app/assistant/knowledge/checks/${kicked[0]}`, headers: { cookie: owner } });
    expect(page.body).toContain(Q_PRICE);
    expect(page.body).toContain('Changed: the figures differ');
    expect(page.body).toContain('Same figures');
    expect(page.body).toContain('/keep"');
  });

  it('staff may not decide; the owner keeps it, and the price moves; decided once', async () => {
    const tried = await post(staff, `/app/assistant/knowledge/checks/${kicked[0]}/keep`, {});
    expect(tried.statusCode).toBe(302);
    expect(await price()).toBe('12.00');
    const kept = await post(owner, `/app/assistant/knowledge/checks/${kicked[0]}/keep`, {});
    expect(flashSaid(kept, SECRET)).toContain('Kept');
    expect(await price()).toBe('15.00');
    expect(flashSaid(await post(owner, `/app/assistant/knowledge/checks/${kicked[0]}/keep`, {}), SECRET)).toContain('already decided');
    const list = await app.inject({ method: 'GET', url: '/app/assistant/knowledge/checks', headers: { cookie: owner } });
    expect(list.body).toContain('Kept');
  });

  it('a change to the voice is checked against every case; reverted, nothing moves', async () => {
    const res = await post(owner, `/app/settings/people/assistants/${ASSISTANT}`, { name: 'Lily', role: 'sales', tone: 'formal', length: 'short', emoji: 'never' });
    expect(kicked).toHaveLength(2);
    expect(String(res.headers['location'])).toContain(kicked[1]);
    const { runCheck } = await import('../../src/pipeline/caseChecks.js');
    expect(await runCheck({ db, businessId: await bidOf(BIZ), checkId: kicked[1]!, models: { analyzer, replyWriter: writer }, publicBaseUrl: null })).toEqual({ ran: 2, status: 'done' });
    const reverted = await post(owner, `/app/assistant/knowledge/checks/${kicked[1]}/revert`, {});
    expect(flashSaid(reverted, SECRET)).toContain('Reverted');
    expect((await q((t) => sql<{ tone: string }>`select tone from assistants where id = ${ASSISTANT}::uuid`.execute(t))).rows[0]!.tone).toBe('warm');
  });

  it('a change that would not apply is never staged: the route refuses it as it always did', async () => {
    const n = kicked.length;
    const res = await post(owner, `/app/products/${PRODUCT}/edit`, { price: 'fifteen', isActive: 'on' });
    expect(kicked).toHaveLength(n);
    expect(res.statusCode).not.toBe(302);   // the product page, sent back with the field's error
  });
});
