import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withCountry } from '../../src/api/web/zone.js';
import * as show from '../../src/api/web/values.js';

/**
 * Phase 9 (V1-169, V1-229, V1-300, V1-307) — a quantity on an owner's page by
 * the same rule as an amount (V1-009): Spanish and French in the workspace's
 * country; English, Chinese and Arabic as they were. "5,000 uds." read as five
 * units in Spain.
 */
const strip = (s: string): string => s.replace(/[\u2066-\u2069\u200e\u200f]/g, '').replace(/\u202f/g, ' ');

describe('Phase 9 · a quantity is written the reader\'s way in the workspace\'s country', () => {
  it('Spanish: Spain "5000" and "12.000", Mexico "5,000"; with the unit, as one', () => {
    expect(withCountry('ES', () => strip(show.quantity('es', 5000)))).toBe('5000');
    expect(withCountry('ES', () => strip(show.quantity('es', 12000)))).toBe('12.000');
    expect(withCountry('ES', () => strip(show.quantityOf('es', 5000, 'uds.')))).toBe('5000\u00a0uds.');
    expect(withCountry('MX', () => strip(show.quantityOf('es', 5000, 'uds.')))).toBe('5,000\u00a0uds.');
  });
  it('French spaces its thousands; English, Chinese and Arabic are as they were; no country, as before', () => {
    expect(withCountry('FR', () => strip(show.quantity('fr', 5000)))).toBe('5 000');
    expect(withCountry('ES', () => strip(show.quantity('en', 120000)))).toBe('120,000');
    expect(withCountry('ES', () => strip(show.quantity('zh', 12000)))).toBe('1.2万');
    expect(withCountry('ES', () => strip(show.quantityOf('ar', 5000, 'قطعة')))).toBe('5,000\u00a0قطعة');
    // The warmth run, phase 9 (w4-products-knowledge-08) — a workspace with no country on record writes
    // Spanish and French the language's own way; outside a workspace, as before.
    expect(withCountry(null, () => strip(show.quantity('es', 5000)))).toBe('5000');
    expect(withCountry(null, () => strip(show.quantity('es', 12000)))).toBe('12.000');
    expect(withCountry(null, () => strip(show.quantity('fr', 2000)).replace(/\u202f/g, ' '))).toBe('2 000');
    expect(withCountry(null, () => strip(show.money('fr', { amount: 1.05, currency: 'USD' })))).toBe('1,05\u00a0$');
    expect(withCountry(null, () => strip(show.quantity('en', 5000)))).toBe('5,000');
    expect(strip(show.quantity('es', 5000))).toBe('5,000');
  });
  it('the send path\'s own figures are not this rule', () => {
    expect(readFileSync(new URL('../../src/core/owner/i18n/format.ts', import.meta.url), 'utf8')).not.toContain('workspaceCountry');
  });
});
