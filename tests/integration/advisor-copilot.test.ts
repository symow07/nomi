import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { seedRunTenant, flashSaid } from './tenant.js';
import { FakeAnalyzer } from '../pipeline/fakes.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import type { AdvisorModel, ReplyWriter } from '../../src/llm/ports.js';

/**
 * Block 3 PR 4 — THE HAND-OFF THAT CARRIES CONTEXT, end to end. A customer asked a price, was told it (a message that
 * carried the quote), asked for a person, heard from the owner in the channel's own app ("we can ship in 5 days"), and
 * wrote again. The Copilot's route answers three lines as JSON:
 *   · what they want — worded by the advisor's model from their own words, checked, and kept until a new message;
 *   · what was said — the quote's figures with the product they came from, the owner's "5" with no price on record;
 *   · what waits — the hand-off's reason.
 * GROUNDED: a worded line naming a figure the facts do not carry is thrown away for the customer's own words.
 * METERED: each worded line is on the ledger; asked again with no new message, no model is asked.
 * NO CUSTOMER PATH: neither the summary nor "Suggest a reply" writes a reply, a draft, a message, a turn, or the hold;
 * the suggestion goes into the box (or back as JSON) and nothing is sent. A deletion request waiting: no suggestion.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `dd240000-0000-4000-8000-${RUN}0001`;
const PRODUCT = `dd240000-0000-4000-8001-${RUN}0001`;
const ASSISTANT = `dd240000-0000-4000-8002-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const WORDED = 'They want to know what 300 amber candles would cost.';

const bidOf = async (raw: string) => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
};
const reads = (): Analysis => ({
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary: 'price_request', productCandidate: { productId: PRODUCT as never, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
    quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'commercial_discussion', wantsPerson: false, wantsDeletion: false,
});
class EchoWriter implements ReplyWriter {
  calls = 0;
  async write(input: Parameters<ReplyWriter['write']>[0]) {
    this.calls++;
    const reply = input.quote ? `The amber candle is ${input.quote.unitPrice.amount} each.` : 'Happy to help with that.';
    return { reply, promptVersion: 'echo@1', modelId: 'fake-model', usage: { inputTokens: 300, outputTokens: 60 } };
  }
}
/** The advisor's model: words one line, and remembers what it was given. */
class FakeAdvisor implements AdvisorModel {
  phrased = 0; say = WORDED; facts: readonly string[] = [];
  async recognise() { return { pick: null, usage: { inputTokens: 1, outputTokens: 1 } }; }
  async phrase(input: { question: string; language: string; facts: readonly string[]; opinion: boolean }) {
    this.phrased++; this.facts = input.facts;
    return { text: this.say, usage: { inputTokens: 200, outputTokens: 20 } };
  }
}

d('Block 3 PR 4 · the hand-off that carries context (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let owner = ''; let accountant = '';
  let CONV = '';
  const advisor = new FakeAdvisor();
  const analyzer = new FakeAnalyzer();
  analyzer.next = reads();
  const writer = new EchoWriter();
  const login = async (code: string) => {
    const res = await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM });
    return String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  };
  const q = async <T>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, await bidOf(BIZ), fn);
  };
  const summary = (cookie: string, id = CONV) => app.inject({ method: 'GET', url: `/app/conversations/${id}/copilot`, headers: { cookie } });
  const suggestJson = (cookie: string) => app.inject({ method: 'POST', url: `/app/conversations/${CONV}/copilot/suggest`, payload: '', headers: { cookie, accept: 'application/json', ...FORM } });
  /** Everything a customer could ever receive, and everything a turn would keep. */
  const kept = () => q((t) => sql<{ outbound: number; drafts: number; messages: number; turns: number; quotes: number; held: string | null; open: number; calls: number; unsent: string | null }>`
    select (select count(*)::int from outbound_messages where business_id = ${BIZ}::uuid) as outbound,
           (select count(*)::int from drafts where business_id = ${BIZ}::uuid) as drafts,
           (select count(*)::int from messages where conversation_id = ${CONV}::uuid) as messages,
           (select count(*)::int from turns where business_id = ${BIZ}::uuid) as turns,
           (select count(*)::int from quotes where business_id = ${BIZ}::uuid) as quotes,
           (select assigned_to from conversations where id = ${CONV}::uuid) as held,
           (select count(*)::int from conversation_signals where conversation_id = ${CONV}::uuid and resolved_at is null) as open,
           (select coalesce(sum(llm_calls), 0)::int from usage_ledger where business_id = ${BIZ}::uuid) as calls,
           (select owner_unsent_reply from conversations where id = ${CONV}::uuid) as unsent`.execute(t).then((r) => r.rows[0]!));
  const inbound = (text: string) => q((t) => sql`insert into messages (conversation_id, direction, text_content, sent_at) values (${CONV}::uuid, 'inbound', ${text}, now())`.execute(t));

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { suggestReply } = await import('../../src/pipeline/suggestReply.js');
    db = createDb(DATABASE_URL!);
    const bid = await bidOf(BIZ);
    await withTenantTx(db, bid, async (t) => {
      await sql`insert into businesses (id, name, owner_locale, kind, country, currency, timezone) values (${BIZ}, 'Copilot Test Co', 'en', 'brand', 'US', 'USD', 'America/New_York') on conflict (id) do nothing`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, price_usd_per_unit, is_active, currency) values (${PRODUCT}, ${BIZ}, 'C-100', 'Amber candle', 'item', null, 12, true, 'USD')`.execute(t);
      await sql`insert into price_tiers (product_id, min_qty, unit_price_usd) values (${PRODUCT}, 1, 12)`.execute(t);
      await sql`insert into product_aliases (product_id, alias, language) values (${PRODUCT}, 'amber candle', 'en')`.execute(t);
      await sql`insert into assistants (id, business_id, name, role, is_default) values (${ASSISTANT}, ${BIZ}, 'Lily', 'sales', true)`.execute(t);
      const c = await ensureConversation(t, bid, `+1555${RUN.slice(0, 4)}02`, 'Copilot Buyer', 'whatsapp');
      CONV = c.conversationId;
      await sql`update conversation_state set identified_product_id = ${PRODUCT}::uuid where conversation_id = ${CONV}::uuid`.execute(t);
      await sql`insert into messages (conversation_id, direction, text_content, sent_at) values (${CONV}::uuid, 'inbound', 'How much for 200 amber candles?', now() - interval '3 days')`.execute(t);
      const quote = (await sql<{ id: string }>`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version, currency, created_at)
        values (${BIZ}, ${CONV}::uuid, ${PRODUCT}, 200, '{}'::jsonb, 12, 2400, 'test', 'USD', now() - interval '3 days') returning id::text`.execute(t)).rows[0]!.id;
      await sql`insert into messages (conversation_id, direction, text_content, sent_at, quote_id) values (${CONV}::uuid, 'outbound', '200 amber candles are 12.00 each, 2,400.00 in all.', now() - interval '3 days' + interval '1 minute', ${quote}::uuid)`.execute(t);
      await sql`insert into messages (conversation_id, direction, text_content, sent_at) values (${CONV}::uuid, 'inbound', 'Can I talk to a person?', now() - interval '2 days')`.execute(t);
      await sql`insert into conversation_signals (conversation_id, business_id, kind) values (${CONV}::uuid, ${BIZ}, 'human_requested')`.execute(t);
      await sql`update conversations set assigned_to = 'unclaimed' where id = ${CONV}::uuid`.execute(t);
      // The owner's own reply from the channel's app (CH3): a person's words, a figure no price on record holds.
      await sql`insert into messages (conversation_id, direction, text_content, sent_at, external_id) values (${CONV}::uuid, 'outbound', 'We can ship in 5 days.', now() - interval '1 day', ${`echo:${RUN}`})`.execute(t);
      await sql`insert into messages (conversation_id, direction, text_content, sent_at) values (${CONV}::uuid, 'inbound', 'And what would 300 cost?', now() - interval '1 hour')`.execute(t);
    });
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: { level: 'error' } });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: `copilot-${RUN}`, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
      advisorDb: db, advisorModel: advisor,
      suggestReply: (b: string, c: string) => suggestReply({ db, businessId: b as never, conversationId: c, models: { analyzer, replyWriter: writer }, publicBaseUrl: null }),
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    owner = await login(`copilot-${RUN}`);
    const books = await addPerson(db, BIZ, SECRET, `Books ${RUN}`, 'accountant'); if (books.code !== 'added') throw new Error('fixture');
    accountant = await login(books.accessCode);
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('three lines: what they want (worded, checked), what was said with each figure\'s source, what waits — and the line is on the ledger', async () => {
    const before = await kept();
    const res = await summary(owner);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; cached: boolean; lines: string[]; wants: { text: string; phrased: boolean };
      said: { text: string; figures: { what: string; amount: string | null; by: string; source: { href: string } | null }[] };
      waiting: { text: string; items: { kind: string }[] }; suggest: { href: string } };
    expect(body.ok).toBe(true);
    expect(body.lines).toHaveLength(3);
    expect(body.wants).toEqual({ text: WORDED, phrased: true });
    expect(body.cached).toBe(false);
    // the model was given the customer's own words, and the hand-off's reason
    expect(advisor.facts.join('\n')).toContain('And what would 300 cost?');
    expect(advisor.facts.join('\n')).toContain('the customer asked for a person');
    // said: the quote's figures, each with the product it came from; the owner's "5" with no price on record
    const price = body.said.figures.find((f) => f.what === 'unit_price')!;
    expect(Number(price.amount)).toBe(12);
    expect(price.by).toBe('assistant');
    expect(price.source?.href).toBe(`/app/products/${PRODUCT}`);
    expect(Number(body.said.figures.find((f) => f.what === 'total')!.amount)).toBe(2400);
    const five = body.said.figures.find((f) => f.what === 'figure' && f.amount === null && f.by === 'person')!;
    expect(five.source).toBeNull();
    expect(body.said.text).toContain('Amber candle');
    expect(body.said.text).toContain('5');
    expect(body.waiting.items.map((i) => i.kind)).toEqual(['handoff']);
    expect(body.waiting.text).toContain('the customer asked for a person');
    expect(body.suggest.href).toBe(`/app/conversations/${CONV}/copilot/suggest`);
    const after = await kept();
    expect(after.calls).toBe(before.calls + 1);
    expect({ ...after, calls: 0 }).toEqual({ ...before, calls: 0 });          // nothing else moved
  });

  it('kept per conversation: asked again with no new message, no model is asked and nothing is spent; a new message asks again', async () => {
    const before = await kept(); const n = advisor.phrased;
    const again = (await summary(owner)).json() as { cached: boolean; wants: { text: string } };
    expect(again.cached).toBe(true);
    expect(again.wants.text).toBe(WORDED);
    expect(advisor.phrased).toBe(n);
    expect((await kept()).calls).toBe(before.calls);
    await inbound('Is 300 possible this month?');
    const fresh = (await summary(owner)).json() as { cached: boolean };
    expect(fresh.cached).toBe(false);
    expect(advisor.phrased).toBe(n + 1);
    expect((await kept()).calls).toBe(before.calls + 1);
  });

  it('grounded: a worded line naming a figure the facts do not carry is thrown away; the customer\'s own words stand', async () => {
    advisor.say = 'They want 999 candles delivered.';
    await inbound('Could you send them soon?');
    const res = await summary(owner);
    const body = res.json() as { wants: { text: string; phrased: boolean } };
    expect(body.wants.phrased).toBe(false);
    expect(body.wants.text).toContain('Could you send them soon?');
    expect(res.body).not.toContain('999');
    advisor.say = WORDED;
  });

  it('not anyone\'s: signed out, the accountant, a conversation that is not there — refused, and no model asked', async () => {
    const n = advisor.phrased;
    // a stranger goes to the door; the accountant to the books, as on every page of the sales side
    for (const [who, door] of [['', '/login'], [accountant, '/app/books']] as const) {
      const res = await summary(who);
      expect(res.statusCode).toBe(302);
      expect(String(res.headers['location'])).toBe(door);
    }
    expect((await summary(owner, randomUUID())).statusCode).toBe(404);
    expect((await summary(owner, 'not-a-conversation')).statusCode).toBe(404);
    const w = writer.calls;
    const books = await app.inject({ method: 'POST', url: `/app/conversations/${CONV}/copilot/suggest`, payload: '', headers: { cookie: accountant, accept: 'application/json', ...FORM } });
    expect([books.statusCode, String(books.headers['location'])]).toEqual([302, '/app/books']);
    expect(advisor.phrased).toBe(n);
    expect(writer.calls).toBe(w);
  });

  it('suggest a reply: the real turn\'s words come back, metered — and nothing is sent, drafted, kept or handed back', async () => {
    const before = await kept(); const w = writer.calls;
    const res = await suggestJson(owner);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; text: string };
    expect(body.ok).toBe(true);
    expect(body.text.length).toBeGreaterThan(0);
    expect(writer.calls).toBe(w + 1);
    const after = await kept();
    expect(after.calls).toBe(before.calls + 2);                                // the analysis and the writer
    expect({ ...after, calls: 0 }).toEqual({ ...before, calls: 0 });          // the hold, the signal, no reply, no draft, no turn
    expect(after.held).toBe('unclaimed');
    expect(after.open).toBe(1);
  });

  it('from the page: the reply form carries the button; the words land in the box after what was typed, and nothing is sent', async () => {
    await q((t) => sql`update conversations set assigned_to = 'owner' where id = ${CONV}::uuid`.execute(t));
    const page = await app.inject({ method: 'GET', url: `/app/inbox/${CONV}`, headers: { cookie: owner } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(`formaction="/app/conversations/${CONV}/copilot/suggest" formnovalidate`);
    const before = await kept();
    const res = await app.inject({ method: 'POST', url: `/app/conversations/${CONV}/copilot/suggest`, payload: 'text=Hello%20again.', headers: { cookie: owner, ...FORM } });
    expect(res.statusCode).toBe(302);
    expect(String(res.headers['location'])).toContain(`/app/inbox/${CONV}`);
    expect(flashSaid(res, SECRET)).toContain('Nothing has been sent');
    const after = await kept();
    expect(after.unsent).toMatch(/^Hello again\.[\s\S]+\S/);
    expect(after.unsent!.length).toBeGreaterThan('Hello again.'.length + 2);
    expect({ ...after, calls: 0, unsent: null }).toEqual({ ...before, calls: 0, unsent: null });
  });

  it('a deletion request waiting: the summary leads with it, and no reply is suggested — no model asked', async () => {
    await q((t) => sql`insert into deletion_asks (business_id, client_id, conversation_id, asked_at)
      select business_id, client_id, id, now() from conversations where id = ${CONV}::uuid`.execute(t));
    const body = (await summary(owner)).json() as { waiting: { items: { kind: string }[] } };
    expect(body.waiting.items[0]!.kind).toBe('deletion');
    const w = writer.calls; const before = await kept();
    const res = await suggestJson(owner);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { reason: string }).reason).toBe('deletion');
    expect(writer.calls).toBe(w);
    expect((await kept()).calls).toBe(before.calls);
  });
});
