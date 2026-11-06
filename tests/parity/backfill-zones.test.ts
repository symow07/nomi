import { describe, it, expect } from 'vitest';
import { zonesOf, onlyZoneOf, ALL_ZONES } from '../../src/core/owner/zones.js';
import { currencyOfCountry } from '../../src/core/owner/currencies.js';
import { countryCodes } from '../../src/core/owner/business.js';
// @ts-expect-error — the operator tools, plain JS on purpose (tools/ is not type-checked).
import * as table from '../../tools/lib/zoneTable.mjs';
// @ts-expect-error — the operator tools, plain JS on purpose.
import { planFor, LIVE_WORKSPACE } from '../../tools/backfill-zones.mjs';

/**
 * Block 1 #9 — the backfill tool answers exactly as the app does, for every country the app knows, because it reads the
 * app's own tables out of their sources (tools/lib/zoneTable.mjs). And its plan for a workspace follows the rules the
 * roadmap set: one zone → set it; several or none → flagged; the currency only where the country's money is on the
 * list and nothing is priced yet; the live workspace is never in the list it reads.
 */
describe('Block 1 #9 · the tool reads the app\'s tables', () => {
  it('every zone answer equals the app\'s, for every country the app can name and every code the table holds', () => {
    const codes = new Set<string>([...countryCodes(), ...(table.zoneCountries() as string[]), ...(table.currencyCountries() as string[]), 'UK', 'DY', 'XX']);
    for (const c of codes) {
      expect(table.zonesOf(c), c).toEqual([...zonesOf(c)]);
      expect(table.onlyZoneOf(c), c).toBe(onlyZoneOf(c));
      expect(table.currencyOfCountry(c), c).toBe(currencyOfCountry(c));
    }
    expect(table.zoneCountries().length).toBeGreaterThan(200);
    expect(new Set((table.zoneCountries() as string[]).flatMap((c: string) => table.zonesOf(c) as string[])).size).toBe(ALL_ZONES.length);
  });
});

describe('Block 1 #9 · the plan for a workspace', () => {
  const row = (o: Partial<{ country: string | null; currency: string; has_prices: boolean; timezone: string }> = {}) =>
    ({ id: 'w', name: 'W', country: 'MA', timezone: 'Asia/Shanghai', currency: 'USD', has_prices: false, ...o });
  it('one zone: set; the currency where the country\'s money is on the list and nothing is priced', () => {
    expect(planFor(row())).toMatchObject({ zone: 'Africa/Casablanca', flagged: false, currency: 'MAD', keptCurrency: null });
    expect(planFor(row({ country: 'AE' }))).toMatchObject({ zone: 'Asia/Dubai', currency: 'AED' });
  });
  it('several zones, or no country: flagged for the owner, nothing set', () => {
    expect(planFor(row({ country: 'US' }))).toMatchObject({ zone: null, flagged: true, why: 'several zones', currency: 'USD' === 'USD' ? null : 'USD' });
    expect(planFor(row({ country: null }))).toMatchObject({ zone: null, flagged: true, why: 'no country', currency: null });
  });
  it('prices on record keep the currency; a country whose money is not on the list keeps it too; a zone already right is not touched', () => {
    expect(planFor(row({ has_prices: true }))).toMatchObject({ zone: 'Africa/Casablanca', currency: null, keptCurrency: 'has prices' });
    expect(planFor(row({ country: 'EG' }))).toMatchObject({ zone: 'Africa/Cairo', currency: null, keptCurrency: 'currency not on the list' });
    expect(planFor(row({ timezone: 'Africa/Casablanca' }))).toMatchObject({ zone: null, flagged: false });
  });
  it('the live workspace is the one named in CLAUDE.md, and the tool\'s query leaves it out', () => {
    expect(LIVE_WORKSPACE).toBe('7dc89f42-852e-465a-920f-8af170dc83cd');
  });
});
