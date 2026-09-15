import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { quantityWasHeardNotTyped } from '../../src/core/safety/heardNumbers.js';
import { holdReasonOf, HOLD_REASONS } from '../../src/core/conversation/hold.js';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { product, tiers, policy } from './fixtures.js';

/**
 * M34.5 — a number she HEARD is not a number she was told.
 *
 * M34 lets her act on an uncertain transcript, which is right. Numbers are the
 * exception: "2,000 pieces" heard as "20,000" changes the tier, changes the
 * price, and she states it with total confidence — the machine's guess become a
 * factory price, in writing, to a B2B buyer.
 */

const quoteFor = (quantity: number) => {
  const r = computeQuote({ product: product(), tiers: tiers(), policy: policy(), rules: [], quantity });
  if (!r.ok) throw new Error(`fixture: ${quantity}`);
  return r.value;
};

describe('M34.5 · a heard quantity that priced a quote does not auto-send', () => {
  it('fires when the figure in the transcript is the one that set the price', () => {
    const q = quoteFor(20000);
    expect(quantityWasHeardNotTyped({
      provenance: 'transcribed', quote: q, turnText: 'can you do 20000 pieces?',
    })).toBe(true);
  });

  it('does NOT fire when the buyer typed it — the historical path is untouched', () => {
    expect(quantityWasHeardNotTyped({
      provenance: 'typed', quote: quoteFor(20000), turnText: 'can you do 20000 pieces?',
    })).toBe(false);
  });

  it('does NOT fire when the quantity came from elsewhere and was not re-heard', () => {
    // She was told 20,000 last week; this turn's voice note asks about
    // shipping. The quote still carries the quantity, but the transcript did
    // not produce it, so there is nothing new to be wrong about.
    expect(quantityWasHeardNotTyped({
      provenance: 'transcribed', quote: quoteFor(20000), turnText: 'and how long does shipping take?',
    })).toBe(false);
  });

  it('does NOT fire when the turn produced no quote', () => {
    expect(quantityWasHeardNotTyped({
      provenance: 'transcribed', quote: null, turnText: 'we might want 20000',
    })).toBe(false);
  });

  it('catches the mishearing that motivates the rule', () => {
    // The buyer said two thousand; the machine heard twenty thousand; the tier
    // and the unit price both move. Before this rule that reply could auto-send.
    const misheard = quoteFor(20000);
    const actual = quoteFor(2000);
    expect(misheard.unitPrice).not.toBe(actual.unitPrice);
    expect(quantityWasHeardNotTyped({
      provenance: 'transcribed', quote: misheard, turnText: 'twenty thousand pieces please',
    })).toBe(false);   // words, not digits — the pipeline's numeral extractor sees none
    expect(quantityWasHeardNotTyped({
      provenance: 'transcribed', quote: misheard, turnText: '20,000 pieces please',
    })).toBe(true);
  });

  it('a photo caption is not a transcript — only heard words downgrade', () => {
    expect(quantityWasHeardNotTyped({
      provenance: 'photo', quote: quoteFor(20000), turnText: '20000 pcs [photo: canvas bag]',
    })).toBe(false);
  });
});

describe('M34.5 · the rule narrows permission and never widens it', () => {
  it('auto becomes draft; it can never turn a draft into an auto-send', async () => {
    // G7a folded this rule into the one hold rule (core/conversation/hold.ts);
    // what it forces did not change. The heard quantity is a hold reason...
    expect(holdReasonOf({
      provenance: 'transcribed', quote: quoteFor(20000), turnText: 'can you do 20000 pieces?',
    })).toBe('quantity_heard_not_typed');
    // ...and a hold forces the constant 'draft' — never the shape of the
    // statement it sits in, which M34.6 and G7a each rewrapped.
    const src = await readFile(new URL('../../src/pipeline/turn.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/r\.hold \? 'draft' : policyMode/);
  });

  it('the worker marks a transcript as transcribed, and typed text as typed', async () => {
    const src = await readFile(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    // M51.1 moved the choice to the call site; the rule did not move.
    const dispatch = src.slice(src.indexOf('const heard = job.data.messageType'));
    expect(dispatch).toContain("'transcribed'");
    expect(dispatch).toContain("'typed'");
  });

  it('the audit trail says why a draft the owner did not ask for is waiting', async () => {
    const src = await readFile(new URL('../../src/pipeline/turn.ts', import.meta.url), 'utf8');
    expect(src).toContain('heldBecause: r.hold');
    expect(HOLD_REASONS).toContain('quantity_heard_not_typed');
  });

  it('provenance defaults to typed, so every existing caller is unaffected', async () => {
    const src = await readFile(new URL('../../src/pipeline/turn.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/provenance: req\.provenance \?\? 'typed'/);
  });
});
