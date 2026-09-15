import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { emptyState, CONVERSATION, PRODUCT } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';
import { guardNumerals } from '../../src/core/safety/numerals.js';

/**
 * G11 — every quote she sends carries a link.
 *
 * M35 opens with that sentence and it was never true of a TURN: the owner had
 * to tap a button afterwards, on a page that then showed her a relative path.
 */

const BASE = 'https://nomi.example.com';

function ports(publicBaseUrl: string | null): TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter } {
  return {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'), publicBaseUrl,
  };
}

const analysis = (over: Partial<Analysis['language']> = {}): Analysis => ({
  language: { detected: 'en', replyIn: 'en', ...over },
  intent: {
    primary: 'inquiry', productCandidate: null, quantityMentioned: null,
    nextLogicalQuestion: null, missingFields: [],
  },
  recommendedPhase: 'commercial_discussion',
});

/** A turn that prices 5,000 pcs. */
function quoting(publicBaseUrl: string | null) {
  const p = ports(publicBaseUrl);
  p.tenant.seed(CONVERSATION, emptyState({
    phase: 'commercial_discussion',
    product: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
    quantity: { value: 5000, unit: 'pcs' },
  }));
  p.analyzer.next = analysis();
  p.replyWriter.replies = ['For 5,000 pcs the price is $0.45 each.'];
  p.tenant.grantRows = [{ capability: 'quote', mode: 'auto', timeWindow: null }];
  return { p, req: { conversationId: CONVERSATION, messageId: 'm-q', text: 'price for 5000?' } };
}

describe('G11 · the quote carries its proof', () => {
  it('the link is on the reply that goes out, and it is a WHOLE link', async () => {
    const { p, req } = quoting(BASE);
    const r = await computeTurn(p, req);
    const fx = await commitTurn(p, req, r, Date.now());

    expect(p.tenant.proofsIssued).toHaveLength(1);
    expect(fx.outbound?.reply).toBe(`For 5,000 pcs the price is $0.45 each.\n\n${BASE}/p/tok-1`);
    expect(p.tenant.eventRows.some((e) => e.type === 'proof_link_sent')).toBe(true);
  });

  it('APPENDED AFTER THE GUARDS — a token is not a sourced figure', async () => {
    const { p, req } = quoting(BASE);
    const r = await computeTurn(p, req);
    // What the guards passed carries no link…
    expect(r.reply).not.toContain(BASE);
    expect(guardNumerals({
      reply: r.reply ?? '', quote: r.quote, state: r.newState, clientText: req.text, allow: [],
    }).ok).toBe(true);
    // …and the link is added by the commit, where nothing re-guards it. A
    // token's digits would otherwise read as a number she invented.
    const fx = await commitTurn(p, req, r, Date.now());
    expect(fx.outbound?.reply).toContain(`${BASE}/p/`);
  });

  it('a draft carries it too, so what she approves is what he receives', async () => {
    const { p, req } = quoting(BASE);
    p.tenant.grantRows = [];                       // draft-first
    const r = await computeTurn(p, req);
    const fx = await commitTurn(p, req, r, Date.now());
    expect(fx.outbound).toBeNull();
    expect(p.tenant.draftsCreated[0]!.draftText).toContain(`${BASE}/p/tok-1`);
  });

  it('NO ADDRESS, NO LINK — never a path a buyer cannot open', async () => {
    const { p, req } = quoting(null);
    const r = await computeTurn(p, req);
    const fx = await commitTurn(p, req, r, Date.now());
    expect(p.tenant.proofsIssued).toEqual([]);
    expect(fx.outbound?.reply).toBe('For 5,000 pcs the price is $0.45 each.');
    expect(p.tenant.eventRows.some((e) => e.type === 'proof_link_sent')).toBe(false);
  });

  it('no quote, no link — there is nothing to prove', async () => {
    const p = ports(BASE);
    p.tenant.seed(CONVERSATION, emptyState());
    p.analyzer.next = analysis();
    p.replyWriter.replies = ['Which size are you looking for?'];
    p.tenant.grantRows = [{ capability: 'qualify', mode: 'auto', timeWindow: null }];
    const req = { conversationId: CONVERSATION, messageId: 'm-h', text: 'do you make bags?' };
    const r = await computeTurn(p, req);
    const fx = await commitTurn(p, req, r, Date.now());
    expect(p.tenant.proofsIssued).toEqual([]);
    // Wherever it went — sent, or waiting for her — it carries no link.
    const said = fx.outbound?.reply ?? p.tenant.draftsCreated[0]?.draftText;
    expect(said).toBe('Which size are you looking for?');
  });
});

describe('G11 · his language is remembered on him', () => {
  it('written from the analyser, once, and not rewritten when unchanged', async () => {
    const { p, req } = quoting(BASE);
    p.analyzer.next = analysis({ detected: 'ar', replyIn: 'ar' });
    const r = await computeTurn(p, req);
    await commitTurn(p, req, r, Date.now());
    expect(p.tenant.preferredLanguage).toBe('ar');

    const again = quoting(BASE);
    again.p.tenant.seed(CONVERSATION, emptyState({
      phase: 'commercial_discussion', preferredLanguage: 'ar',
      product: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
      quantity: { value: 5000, unit: 'pcs' },
    }));
    again.p.analyzer.next = analysis({ detected: 'ar', replyIn: 'ar' });
    const r2 = await computeTurn(again.p, again.req);
    await commitTurn(again.p, again.req, r2, Date.now());
    expect(again.p.tenant.preferredLanguage).toBeNull();   // nothing to write
  });
});
