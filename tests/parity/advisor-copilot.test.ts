import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { handoffSummary, forgetHandoff, type HandoffFacts } from '../../src/advisor/handoff.js';
import { moneyFromRow } from '../../src/core/types/money.js';
import type { AdvisorModel } from '../../src/llm/ports.js';

/**
 * Block 3 PR 4 — the hand-off's three lines, without a database: what is worded and checked, what is read from the
 * records and never worded, what is kept and when it is asked again; and the walls — the summary sits behind the
 * advisor's (no sender, no pipeline, no database but reads.ts), the suggestion runs in a transaction that never
 * commits and reaches no sender, and the page's button only fills the box. tests/integration/advisor-copilot.test.ts
 * runs both routes on a real database.
 */
const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const valueImports = (f: string): string[] =>
  [...read(f).matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)';/gms)].map((m) => m[1]!);

const usd = (a: string) => moneyFromRow(a, 'USD')!;
const facts = (over: Partial<HandoffFacts> = {}): HandoffFacts => ({
  conversationId: '11111111-1111-4111-8111-111111111111', latestMessageId: 'm3', lastWasInbound: true,
  customerName: 'Rosa Vale', assignedTo: 'unclaimed',
  inbound: [{ id: 'm1', text: 'How much for 200 amber candles?', at: '2026-11-01T10:00:00Z' }, { id: 'm3', text: 'And for 300?', at: '2026-11-03T10:00:00Z' }],
  topic: { productId: 'p1', name: 'Amber candle', unit: 'item', quantity: 300 },
  told: [{ productId: 'p1', productName: 'Amber candle', unit: 'item', quantity: 200, unitPrice: usd('12.00'), total: usd('2400.00'), at: '2026-11-01T10:01:00Z', byPerson: false }],
  saidElse: [{ text: 'We can ship in 5 days.', at: '2026-11-02T10:00:00Z', byPerson: true }],
  reasons: ['human_requested'], pendingDraft: false, orderWaiting: null, deletionWaiting: false, unsentReply: false,
  ...over,
});
class Words implements AdvisorModel {
  calls = 0;
  constructor(public say: string | null) {}
  async recognise() { return { pick: null, usage: { inputTokens: 1, outputTokens: 1 } }; }
  async phrase() { this.calls++; return { text: this.say, usage: { inputTokens: 100, outputTokens: 10 } }; }
}
const known = async () => ['Rosa Vale', 'Amber candle', 'Juniper soap'];
let n = 0;
/** Each test its own business, so nothing kept by one is read by another. */
const biz = () => `b-${++n}`;

describe('what they want · the one worded line, checked, and kept until a new message', () => {
  it('worded from their words: used, counted, kept — and asked again only when a newer message is there', async () => {
    const m = new Words('They want the price of 300 amber candles.'); const b = biz();
    const one = await handoffSummary(facts(), { businessId: b, locale: 'en', model: m, known });
    expect(one.summary.wants).toEqual({ text: 'They want the price of 300 amber candles.', phrased: true });
    expect([one.cached, one.spent.llmCalls]).toEqual([false, 1]);
    const two = await handoffSummary(facts(), { businessId: b, locale: 'en', model: m, known });
    expect([two.cached, two.spent.llmCalls, m.calls]).toEqual([true, 0, 1]);
    const three = await handoffSummary(facts({ latestMessageId: 'm4' }), { businessId: b, locale: 'en', model: m, known });
    expect([three.cached, three.spent.llmCalls, m.calls]).toEqual([false, 1, 2]);
    // kept per language: the same conversation read in Spanish is its own line
    const es = await handoffSummary(facts({ latestMessageId: 'm4' }), { businessId: b, locale: 'es', model: m, known });
    expect(es.cached).toBe(false);
  });

  it('thrown away when it names what the facts do not carry — a figure, another product — and their own words stand', async () => {
    for (const say of ['They want 999 candles.', 'They want the Juniper soap instead.', 'They want 15% off.', 'They want it by March.']) {
      const r = await handoffSummary(facts(), { businessId: biz(), locale: 'en', model: new Words(say), known });
      expect(r.summary.wants, say).toEqual({ text: 'Their last words: "And for 300?"', phrased: false });
      expect(r.spent.llmCalls, say).toBe(1);
    }
  });

  it('nothing worded and nothing kept without a model (the allowance used, or none here); nothing asked when they wrote nothing', async () => {
    const b = biz(); const m = new Words('They want the price of 300 amber candles.');
    const off = await handoffSummary(facts(), { businessId: b, locale: 'en', model: null, known });
    expect(off.summary.wants.phrased).toBe(false);
    expect((await handoffSummary(facts(), { businessId: b, locale: 'en', model: m, known })).cached).toBe(false);
    const silent = await handoffSummary(facts({ inbound: [] }), { businessId: biz(), locale: 'en', model: m, known });
    expect(silent.summary.wants).toEqual({ text: 'They have not written anything yet.', phrased: false });
    expect(silent.spent.llmCalls).toBe(0);
  });

  it('a conversation forgotten is asked again', async () => {
    const b = biz(); const m = new Words('They want the price of 300 amber candles.');
    await handoffSummary(facts(), { businessId: b, locale: 'en', model: m, known });
    forgetHandoff(b, facts().conversationId);
    expect((await handoffSummary(facts(), { businessId: b, locale: 'en', model: m, known })).cached).toBe(false);
  });
});

describe('what was said, and what waits · records, never worded', () => {
  it('the quote told: its quantity, price and total, each with the product it came from; other figures with no source', async () => {
    const r = await handoffSummary(facts(), { businessId: biz(), locale: 'en', model: null, known });
    const by = (what: string) => r.summary.said.figures.filter((f) => f.what === what);
    expect(by('unit_price').map((f) => [f.amount, f.currency, f.by, f.source?.href])).toEqual([[usd('12.00').amount, 'USD', 'assistant', '/app/products/p1']]);
    expect(by('total').map((f) => f.amount)).toEqual([usd('2400.00').amount]);
    expect(by('figure').map((f) => [f.value, f.by, f.source])).toEqual([['5', 'person', null]]);
    // A figure and its unit are spaced with a no-break space (CC-13); read here as a plain one.
    expect(r.summary.said.text.replace(/\s/g, ' ')).toBe('Your assistant told them Amber candle: 200 item at $12.00 each, $2,400.00 in all. Other figures said, with no price on record behind them: 5.');
  });

  it('nothing told: it says so', async () => {
    const r = await handoffSummary(facts({ told: [], saidElse: [] }), { businessId: biz(), locale: 'en', model: null, known });
    expect(r.summary.said).toEqual({ text: 'No price on record has been given to them yet.', figures: [] });
  });

  it('what waits, in order: a deletion request, an order, a reply to approve, the hand-off\'s reason, words not sent', async () => {
    const all = await handoffSummary(facts({ deletionWaiting: true, orderWaiting: 'Amber candle', pendingDraft: true, unsentReply: true, reasons: ['deletion_requested', 'human_requested'] }),
      { businessId: biz(), locale: 'en', model: null, known });
    expect(all.summary.waiting.items.map((i) => i.kind)).toEqual(['deletion', 'order', 'draft', 'handoff', 'unsent']);
    // the deletion request is said once, not again as a hand-off reason
    expect(all.summary.waiting.items[3]!.text).toBe('Handed to you: the customer asked for a person.');
    expect(all.summary.waiting.items[0]!.href).toBe('/app/conversations/11111111-1111-4111-8111-111111111111#deletion');
    const held = await handoffSummary(facts({ reasons: [], assignedTo: 'owner' }), { businessId: biz(), locale: 'en', model: null, known });
    expect(held.summary.waiting.text).toBe('Rosa Vale wrote last and is waiting for an answer.');
    const calm = await handoffSummary(facts({ reasons: [], assignedTo: null }), { businessId: biz(), locale: 'en', model: null, known });
    expect(calm.summary.waiting).toEqual({ text: 'Nothing is waiting on you.', items: [] });
  });
});

describe('the walls · nothing here reaches a customer', () => {
  it('the summary is the advisor\'s: no sender, queue, pipeline or database of its own; its route only reads and meters', () => {
    expect(valueImports('src/advisor/handoff.ts').filter((x) => /\/(db|pipeline|outbound|channels|queue|worker|llm)\//.test(x))).toEqual([]);
    const route = read('src/api/web/conversationAdvisor.ts');
    const at = route.indexOf("app.get('/app/conversations/:conversationId/copilot'");
    expect(at).toBeGreaterThan(0);
    const body = route.slice(at, route.indexOf('\n  });', at));
    expect(body).toContain('readHandoffFacts(ctx, cid)');
    expect(body).toContain('io.spent(v.businessId, r.spent)');
    expect(body).toContain("able === 'available' ? io.model : null");
    expect(body).not.toMatch(/kick|enqueue|applyOwnerCommand|withTenantTx|deps\./);
  });

  it('the suggestion runs the turn in a transaction that never commits, and reaches no sender', () => {
    const src = read('src/pipeline/suggestReply.ts');
    expect(valueImports('src/pipeline/suggestReply.ts').filter((x) => /\/(outbound|channels|queue|worker)\/|commit|approve/.test(x))).toEqual([]);
    expect(src).toContain('throw new RolledBack({ reply: r.reply, path: r.answerPath, usage: r.usage });');
    expect(src).not.toMatch(/commitTurn|enqueueOutbound|kickOutbound|boss\./);
    // the hold is lifted only inside that transaction
    const lifted = src.indexOf('update conversations set assigned_to = null');
    expect(lifted).toBeGreaterThan(src.indexOf('await withTenantTx(d.db, d.businessId, async (tx) => {\n      // For this reading only'));
    // a deletion request waiting: refused before any model
    expect(src.indexOf("refused: 'deletion'")).toBeLessThan(src.indexOf('computeTurn(ports'));
  });

  it('the route hands the words back or puts them in the box — the one write is the kept words; it never sends', () => {
    const app = read('src/api/web/app.ts');
    const at = app.indexOf("app.post('/app/conversations/:conversationId/copilot/suggest'");
    expect(at).toBeGreaterThan(0);
    const body = app.slice(at, app.indexOf('\n  });', at));
    expect(body).toContain('keepUnsentReply(tx, bid.value, cid, boxWithSaved(typed, r.text))');
    expect(body).toContain("personOf(s).kind === 'accountant'");
    expect(body).not.toMatch(/kickOutbound|kickDrive|applyOwnerCommand|ownerReply|enqueue/);
  });

  it('the page: a button of the reply form, which fills the box — never a send of its own', () => {
    const inbox = read('src/api/web/inbox.ts');
    const form = inbox.slice(inbox.indexOf('<form method="post" action="/app/inbox/${cid}/reply" class="replyform">'));
    const button = form.slice(0, form.indexOf('</form>'));
    expect(button).toContain('formaction="/app/conversations/${encodeURIComponent(d.conversationId)}/copilot/suggest" formnovalidate');
  });
});
