import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { profileOf, sellingAnswers, SELLING_DEFAULTS, isRetailKind, defaultUnitFor } from '../../src/core/owner/sellingStyle.js';
import { BUSINESS_KINDS } from '../../src/core/owner/business.js';
import { renderSelling, type SellingView } from '../../src/api/web/selling.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * RT (0095) — how a business sells: three profiles by kind, the answer each
 * gives, the owner's own answer over her kind's; and the page that asks her.
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

describe('RT · the page', () => {
  const view = (kind: string | null, quantityFirst: boolean | null): SellingView => {
    const own = { quantityFirst };
    return { kind, profile: profileOf(kind), own, answers: sellingAnswers(kind, own) };
  };
  it('asks in every language, marks what is usual for her kind, and shows what is in force', () => {
    for (const l of LOCALES) {
      const html = renderSelling(view('online_shop', null), l, null);
      expect(html, l).not.toMatch(/\bselling\.[a-zA-Z_.]+/);
      expect(html, l).toContain('action="/app/business/selling"');
      expect(html, l).toMatch(/value="no" checked/);
    }
    expect(renderSelling(view('manufacturer', null), 'en', null)).toMatch(/value="yes" checked/);
    expect(renderSelling(view('online_shop', true), 'en', null)).toMatch(/value="yes" checked/);
    expect(renderSelling(view('online_shop', null), 'en', null)).toContain('usual for shops and brands');
  });
  it('the page and its form are the owner\'s (rule 11), and the turn reads the column', () => {
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(app).toMatch(/app\.get\('\/app\/business\/selling', ownerPage\('price_rules'/);
    expect(app).toMatch(/app\.post\('\/app\/business\/selling'[\s\S]{0,120}ownerOnly\(req, reply, 'price_rules'/);
    const repos = readFileSync(new URL('../../src/db/repos.ts', import.meta.url), 'utf8');
    expect(repos).toMatch(/quantity_first from businesses/);
  });
});
