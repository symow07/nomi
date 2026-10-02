import { describe, it, expect } from 'vitest';
import * as show from '../../src/api/web/values.js';
import { withWorkspace, type RequestScope } from '../../src/api/web/say.js';
import { formatMoney } from '../../src/core/owner/i18n/format.js';
import { setupFrom } from '../../src/db/setup.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * PHASE 9 — the whole product, Today, Getting started, Before going live,
 * Ready, the machine room and Setup: the today-cross list, each finding
 * checked again on the page it was seen on.
 */

const strip = (s: string): string => s.replace(/[\u2066-\u2069]/g, '');
export const scopeOf = (over: Partial<RequestScope> = {}): RequestScope => ({
  name: null, several: false, outreach: false,
  setup: setupFrom({ profile: false, products: true, name: false, channels: true, first_success: true }),
  business: '义乌宏发日用品厂 (demo)', needsYou: 2, zone: 'Asia/Shanghai', country: 'CN', ...over,
});
const inCountry = <T>(country: string | null, fn: () => T): T => withWorkspace(scopeOf({ country }), fn);

describe('Phase 9 · an amount is written the reader\'s way in the workspace\'s country (V1-009, V1-404)', () => {
  const usd = { amount: 1.05, currency: 'USD' as const };
  const big = { amount: 1234.05, currency: 'USD' as const };
  it('Spanish in Mexico writes 1.05, in Spain 1,05 — the sign stays the product\'s own', () => {
    expect(inCountry('MX', () => show.money('es', usd))).toBe('$1.05');
    expect(inCountry('ES', () => show.money('es', usd))).toBe('1,05\u00a0$');
    expect(inCountry('AR', () => show.money('es', big))).toBe('$1.234,05');
    expect(inCountry('ES', () => show.moneyWhole('es', big))).toBe('1234\u00a0$');
  });
  it('French writes the comma and the sign after; English and Chinese as before; Arabic as the native reader confirmed', () => {
    expect(inCountry('FR', () => show.money('fr', big)).replace(/\u202f/g, ' ')).toBe('1 234,05\u00a0$');
    expect(inCountry('CA', () => show.money('fr', usd))).toBe('1,05\u00a0$');
    for (const c of ['US', 'CN', 'GB', 'AE', 'MX']) {
      expect(inCountry(c, () => show.money('en', big)), c).toBe('$1,234.05');
      expect(inCountry(c, () => show.money('zh', big)), c).toBe('$1,234.05');
      expect(strip(inCountry(c, () => show.money('ar', big))), c).toBe(strip(show.money('ar', big)));
    }
    expect(inCountry('CN', () => show.money('zh', { amount: 12, currency: 'CNY' }))).toBe('￥12.00');
  });
  it('the products list\'s figures (V1-009) and My business\'s range (V1-404) go through it', () => {
    const range = inCountry('ES', () => t('es', 'factory.promise.floorRange',
      { low: show.money('es', { amount: 0.3, currency: 'USD' }), high: show.money('es', { amount: 2.4, currency: 'USD' }), name: 'Lily' }));
    expect(range).toContain('0,30\u00a0$');
    expect(range).toContain('2,40\u00a0$');
    expect(range).not.toMatch(/\$\d/);
  });
  it('outside a workspace, or with no country on record, an amount is written as it always was; the send path\'s formatter never changes', () => {
    for (const l of LOCALES) expect(inCountry(null, () => show.money(l, usd)), l).toBe(show.money(l, usd));
    expect(show.money('es', usd)).toBe('$1.05');
    expect(inCountry('ES', () => formatMoney(usd))).toBe('$1.05');
  });
});
