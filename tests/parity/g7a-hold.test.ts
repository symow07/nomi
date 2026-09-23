import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { holdReasonOf, HOLD_REASONS, isHoldReason, type HoldReason } from '../../src/core/conversation/hold.js';
import { runCheck, type TurnOutcome } from '../../src/trust/invariants.js';
import { evaluateScenario } from '../../src/trust/harness.js';
import { SCENARIOS } from '../../src/trust/scenarios.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { esc } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, ASSISTANT_FALLBACK, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { formatDate } from '../../src/core/owner/i18n/format.js';
import { product, tiers, policy, BUSINESS } from './fixtures.js';

/**
 * G7a — her "ask me above this discount" line is a gate.
 *
 * It was computed (`requiresHuman`), stored, and never read. This file proves
 * the rule; tests/pipeline/hold.test.ts proves the turn obeys it, and the
 * golden scenario `discount-above-ask-line-waits-for-owner` proves it in the
 * trust harness.
 */

const NOW = new Date('2026-09-11T08:00:00Z');
const discount = (value: number) => [{ businessId: BUSINESS, priority: 1, condition: {}, action: { kind: 'discount_pct' as const, value } }];

describe('G7a · the ask line is decided on the discount actually given', () => {
  it('FLOOR-CLAMPED: 25% asked, 20% authority, the floor leaves 6.67% — under a 15% line, no hold', () => {
    // The golden `price-floor-clamp-under-aggressive-discount` numbers. Decided
    // before the floor clamp, this read 20% > 15% and held a reply for a
    // discount nobody was being given.
    const r = computeQuote({
      product: product(), quantity: 5000,
      tiers: [{ productId: product().id, minQty: 1000, maxQty: null, unitPrice: usd(0.45) }],
      policy: policy({ floorPrice: usd(0.42), maxDiscountPct: 20, humanRequiredAbovePct: 15 }),
      rules: discount(25),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.unitPrice).toEqual(usd(0.42));
    expect(r.value.discountPct).toBeLessThan(15);
    expect(r.value.requiresHuman).toBe(false);
  });

  it('AUTHORITY-CLAMPED: 25% asked, 10% given, past a 7% line — held', () => {
    const r = computeQuote({
      product: product(), tiers: tiers(), quantity: 5000,
      policy: policy({ maxDiscountPct: 10, humanRequiredAbovePct: 7 }), rules: discount(25),
    });
    expect(r.ok && r.value.discountPct).toBe(10);
    expect(r.ok && r.value.requiresHuman).toBe(true);
  });

  it('at the line is not past it; no rules is no hold', () => {
    const at = computeQuote({ product: product(), tiers: tiers(), quantity: 5000, policy: policy({ humanRequiredAbovePct: 7 }), rules: discount(7) });
    expect(at.ok && at.value.requiresHuman).toBe(false);
    const none = computeQuote({ product: product(), tiers: tiers(), quantity: 5000, policy: null, rules: discount(9) });
    expect(none.ok && none.value.requiresHuman).toBe(false);
  });
});

describe('G7a · one hold reason', () => {
  const held = computeQuote({ product: product(), tiers: tiers(), quantity: 5000, policy: policy(), rules: discount(9) });
  const clean = computeQuote({ product: product(), tiers: tiers(), quantity: 5000, policy: policy(), rules: [] });
  if (!held.ok || !clean.ok) throw new Error('fixture');

  it('her discount line', () => {
    expect(holdReasonOf({ provenance: 'typed', quote: held.value, turnText: 'best price?' })).toBe('discount_needs_owner');
  });

  it('a heard quantity wins — a price built on a mishearing is wrong before it is generous', () => {
    expect(holdReasonOf({ provenance: 'transcribed', quote: held.value, turnText: 'can you do 5000' }))
      .toBe('quantity_heard_not_typed');
  });

  it('nothing to hold: no quote, or a quote inside her rules', () => {
    expect(holdReasonOf({ provenance: 'typed', quote: null, turnText: '' })).toBeNull();
    expect(holdReasonOf({ provenance: 'typed', quote: clean.value, turnText: '' })).toBeNull();
  });

  it('the stored reason is read back only if it is one of ours', () => {
    for (const r of HOLD_REASONS) expect(isHoldReason(r)).toBe(true);
    for (const bad of [null, undefined, '', 'owner_said_so', 42]) expect(isHoldReason(bad)).toBe(false);
  });
});

describe('G7a · a held turn never auto-sends — the invariant', () => {
  /** A REAL outcome from the harness, with only the applied mode varied. */
  const outcomeOf = async (id: string): Promise<TurnOutcome> => {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) throw new Error(`no scenario ${id}`);
    return (await evaluateScenario(s)).outcome;
  };

  it('fails exactly when a held turn went out on its own', async () => {
    const held = await outcomeOf('discount-above-ask-line-waits-for-owner');
    const clean = await outcomeOf('standard-volume-quote-within-authority');
    expect(held.result.hold).toBe('discount_needs_owner');
    expect(clean.result.hold).toBeNull();
    const check = (o: TurnOutcome, appliedMode: TurnOutcome['appliedMode']) =>
      runCheck({ invariant: 'heldTurnNeverAutoSends' }, { ...o, appliedMode }).pass;
    expect(check(held, 'auto')).toBe(false);
    expect(check(held, 'draft')).toBe(true);
    expect(check(held, 'none')).toBe(true);    // a silenced capability
    expect(check(clean, 'auto')).toBe(true);
  });

  it('it is on the sandbox’s universal watchlist, with owner words in every locale', async () => {
    const { readFile } = await import('node:fs/promises');
    const sandbox = await readFile(new URL('../../src/api/web/sandbox.ts', import.meta.url), 'utf8');
    const watch = sandbox.slice(sandbox.indexOf('const DEFAULT_INVARIANTS'), sandbox.indexOf('];', sandbox.indexOf('const DEFAULT_INVARIANTS')));
    expect(watch).toContain("'heldTurnNeverAutoSends'");
    for (const l of LOCALES) {
      const label = t(l, 'sandbox.inv.heldTurnNeverAutoSends');
      expect(label, l).not.toBe('sandbox.inv.heldTurnNeverAutoSends');
    }
  });
});

describe('G7a · the draft card says why it is waiting', () => {
  const detail = (heldBecause: HoldReason | null): ConversationDetail => ({
    conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
    product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: 5000,
    quote: { unitPrice: usd(0.41), total: usd(2050), quantity: 5000 },
    order: null, messages: [],
    pendingDraft: { draftId: 'd-1', draftText: 'For 5,000 pcs: $0.41/pc.', capability: 'quote', heldBecause },
    ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null, lastHumanAction: null,
    knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
  });

  it('G7b · a contradiction shows both prices, the date of the first, and names the worse case', () => {
    const contradicts = {
      before: { price: usd(0.40), quantity: 5000, at: new Date('2026-03-04T10:00:00Z') },
      now: { price: usd(0.45), quantity: 8000 }, largerQuantity: true,
    };
    for (const l of LOCALES) {
      const html = renderConversationDetail({
        ...detail('contradicts_history'),
        pendingDraft: { ...detail('contradicts_history').pendingDraft!, contradicts },
      }, l, NOW, null);
      const at = html.indexOf('<div class="held-then">');
      expect(at, l).toBeGreaterThan(-1);
      const then = html.slice(at, html.indexOf('</form>', at));
      expect(then, l).toContain('$0.40');
      expect(then, l).toContain('$0.45');
      expect(then, l).toContain(esc(t(l, 'inbox.draft.contradicts.before', { date: formatDate(l, contradicts.before.at) })));
      expect(then, l).toContain(esc(t(l, 'inbox.draft.contradicts.larger')));
    }
    const same = renderConversationDetail({
      ...detail('contradicts_history'),
      pendingDraft: { ...detail('contradicts_history').pendingDraft!, contradicts: { ...contradicts, largerQuantity: false } },
    }, 'en', NOW, null);
    expect(same).not.toContain(esc(t('en', 'inbox.draft.contradicts.larger')));
  });

  it('each reason, in every locale', () => {
    for (const reason of HOLD_REASONS) {
      for (const l of LOCALES) {
        const html = renderConversationDetail(detail(reason), l, NOW, null);
        const said = t(l, `inbox.draft.held.${reason}` as MessageKey, { name: ASSISTANT_FALLBACK[l] });
        expect(said, `${l} ${reason}`).not.toContain('{');
        expect(html, `${l} ${reason}`).toContain(esc(said));
      }
    }
  });

  it('a draft that waited only because of her autonomy setting says nothing extra', () => {
    const html = renderConversationDetail(detail(null), 'en', NOW, null);
    expect(html).not.toContain('class="held-why"');
  });
});
