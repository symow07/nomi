import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { profileOf, sellingAnswers, SELLING_DEFAULTS, isRetailKind, defaultUnitFor } from '../../src/core/owner/sellingStyle.js';
import { BUSINESS_KINDS } from '../../src/core/owner/business.js';

/**
 * RT (0095) — how a business sells: three profiles by kind, the answer each
 * gives, and the owner's own answer over her kind's. The page that asks her is
 * How you sell's first question (tests/parity/hs-how-you-sell.test.ts).
 */

describe('RT · the profiles', () => {
  it('every kind the form offers has a profile; a workspace with no kind keeps the old (bulk) way', () => {
    expect(BUSINESS_KINDS.map((k) => [k, profileOf(k)])).toEqual([
      ['brand', 'retail'], ['online_shop', 'retail'], ['retail', 'retail'], ['agency', 'services'], ['services', 'services'],
      ['startup', 'retail'], ['manufacturer', 'bulk'], ['trading', 'bulk'], ['wholesale', 'bulk'], ['other', 'retail'],
    ]);
    expect(profileOf(null)).toBe('bulk');
  });
  it('shops and brands give the price first and count in items; factories ask how many and count in pcs', () => {
    expect(sellingAnswers('brand')).toEqual(SELLING_DEFAULTS.retail);
    expect(SELLING_DEFAULTS).toEqual({ retail: { quantityFirst: false }, services: { quantityFirst: false }, bulk: { quantityFirst: true } });
    expect(defaultUnitFor('brand')).toBe('item');
    expect(defaultUnitFor('wholesale')).toBe('pcs');
    expect(isRetailKind('startup') && !isRetailKind('agency')).toBe(true);
  });
  it('her own answer wins over her kind\'s, one question at a time', () => {
    expect(sellingAnswers('brand', { quantityFirst: true }).quantityFirst).toBe(true);
    expect(sellingAnswers('manufacturer', { quantityFirst: false })).toEqual({ quantityFirst: false });
    expect(sellingAnswers('manufacturer', { quantityFirst: null })).toEqual({ quantityFirst: true });
  });
});

describe('RT · the turn reads the column', () => {
  it('the repo reads quantity_first for every turn', () => {
    const repos = readFileSync(new URL('../../src/db/repos.ts', import.meta.url), 'utf8');
    expect(repos).toMatch(/quantity_first from businesses/);
  });
});
