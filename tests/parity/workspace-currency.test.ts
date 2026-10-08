import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { currencyOfCountry, currencyForSignup, asksCurrency, currencyLabel, currencyInLine } from '../../src/core/owner/currencies.js';
import { readTypedAmount } from '../../src/core/commerce/amount.js';
import { parsePriceLines, validateExtracted } from '../../src/core/onboard/catalogImport.js';
import { validatePriceRules } from '../../src/core/commerce/priceRules.js';
import { validateSamplePolicy } from '../../src/core/commerce/samples.js';
import { validateSignup } from '../../src/core/owner/signup.js';
import { signupPage } from '../../src/api/web/layout.js';
import { renderRate, renderProfile, type RateView } from '../../src/api/web/settings.js';
import { renderAddForm } from '../../src/api/web/products.js';
import { CURRENCIES, type Currency } from '../../src/core/types/money.js';
import { OWNER_VIEW, type Viewer } from '../../src/core/conversation/people.js';
import { PASSWORD_MIN, PASSWORD_MAX } from '../../src/security/password.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * CUR, part two (the owner's decision, 2026-09-30: "one currency per
 * workspace, chosen during setup; USD/CNY for everyone is a leftover") — the
 * workspace's currency is chosen at sign-up and every price the owner types,
 * pastes or photographs is in it. What is pinned:
 *   · a country whose own money is on the list sells in it without being
 *     asked; any other is asked, and only the list answers;
 *   · a figure the owner types is read the way the currency writes it
 *     ("15.000" is fifteen thousand rupiah; "12,50" is 12.50 in every currency,
 *     since no thousands group is two digits long — the warmth run, V1-334);
 *   · the price list is read in the workspace's currency — its own marks are
 *     its price, anyone else's a refusal — and dollars read exactly as before;
 *   · floors and samples are in the workspace's currency;
 *   · the rate page converts only where there is something to convert;
 *   · the currency can change only until the first price is set, and only
 *     the owner changes it.
 */

const opts = { mode: 'open' as const, passwordMin: PASSWORD_MIN, passwordMax: PASSWORD_MAX };
const good = {
  factory: 'Oud House', name: 'Rana', email: 'rana@oud.example', password: 'correct horse battery', invite: '',
  kind: 'retail', sells: 'Perfume oils', country: 'AE', website: '', teamSize: '2-5', channels: ['instagram'], terms: 'on', age: '34',
};
const one = (line: string, c: Currency) => parsePriceLines(line, c)[0]!;

describe('CUR · the currency sign-up gives', () => {
  it('a country whose own money is on the list sells in it', () => {
    for (const [country, c] of [['US', 'USD'], ['CN', 'CNY'], ['AE', 'AED'], ['SA', 'SAR'], ['BR', 'BRL'], ['MX', 'MXN'], ['IN', 'INR'], ['ID', 'IDR'], ['EC', 'USD']] as const) {
      expect(currencyOfCountry(country), country).toBe(c);
      expect(asksCurrency(country), country).toBe(false);
    }
    const v = validateSignup(good, opts);
    expect(v.ok && v.value.profile.currency).toBe('AED');
    // A pick cannot move it elsewhere.
    expect(currencyForSignup('AE', 'USD')).toBe('AED');
  });

  it('any other country is asked, and only the list answers', () => {
    expect(currencyOfCountry('MA')).toBeNull();
    expect(asksCurrency('MA')).toBe(true);
    expect(asksCurrency('')).toBe(false);
    expect(validateSignup({ ...good, country: 'MA' }, opts)).toMatchObject({ ok: false, problems: { currency: 'currency_missing' } });
    expect(validateSignup({ ...good, country: 'MA', currency: 'EUR' }, opts)).toMatchObject({ ok: false, problems: { currency: 'currency_missing' } });
    const v = validateSignup({ ...good, country: 'MA', currency: 'usd' }, opts);
    expect(v.ok && v.value.profile.currency).toBe('USD');
  });

  it('the form asks only where it must, and offers the eight', () => {
    const ma = signupPage({ locale: 'en', path: '/signup', mode: 'open', passwordMin: PASSWORD_MIN, values: { country: 'MA' } });
    expect(ma).toContain('<select id="su-currency" name="currency" required>');
    for (const c of CURRENCIES) expect(ma).toContain(`value="${c}"`);
    expect(ma).not.toContain('value="EUR"');
    const ae = signupPage({ locale: 'en', path: '/signup', mode: 'open', passwordMin: PASSWORD_MIN, values: { country: 'AE' } });
    expect(ae).not.toContain('name="currency"');
  });

  it('a currency reads as its name in the owner\'s language, then its code', () => {
    expect(currencyLabel('en', 'AED')).toMatch(/dirham.*\(AED\)$/i);
    expect(currencyLabel('zh', 'CNY')).toMatch(/\(CNY\)$/);
  });
});

describe('CUR · a figure the owner types, read the currency\'s way', () => {
  it('reais and rupiah: a dot groups thousands, a comma marks decimals', () => {
    expect(readTypedAmount('15.000', 'IDR')).toBe(15000);
    expect(readTypedAmount('1.500.000', 'IDR')).toBe(1_500_000);
    expect(readTypedAmount('1.250,50', 'BRL')).toBe(1250.5);
    expect(readTypedAmount('12,50', 'BRL')).toBe(12.5);
    expect(readTypedAmount('12.50', 'BRL')).toBe(12.5);
  });
  it('every other: a comma groups thousands (and lakhs), a dot marks decimals; a comma before one or two digits is the decimal', () => {
    expect(readTypedAmount('1,250.50', 'USD')).toBe(1250.5);
    expect(readTypedAmount('1,50,000', 'INR')).toBe(150000);
    expect(readTypedAmount('1,250', 'USD')).toBe(1250);
    expect(readTypedAmount('12,50', 'USD')).toBe(12.5);
    expect(readTypedAmount('2,5', 'MXN')).toBe(2.5);
    expect(readTypedAmount('1,2,3', 'USD')).toBeNull();
    expect(readTypedAmount('abc', 'AED')).toBeNull();
    expect(readTypedAmount('', 'AED')).toBeNull();
    expect(readTypedAmount('-5', 'USD')).toBe(-5);
  });
});

describe('CUR · the price list is read in the workspace\'s currency', () => {
  it('its own marks are its price, in its own notation', () => {
    expect(one('Kaos polos Rp 150.000', 'IDR').price).toEqual({ amount: 150000, currency: 'IDR' });
    expect(one('Kaos polos\t150.000', 'IDR').price).toEqual({ amount: 150000, currency: 'IDR' });
    expect(one('Camiseta R$ 49,90', 'BRL').price).toEqual({ amount: 49.9, currency: 'BRL' });
    expect(one('Playera $199', 'MXN').price).toEqual({ amount: 199, currency: 'MXN' });
    expect(one('Playera MX$199', 'MXN').price).toEqual({ amount: 199, currency: 'MXN' });
    expect(one('Oud oil AED 120', 'AED').price).toEqual({ amount: 120, currency: 'AED' });
    expect(one('عطر 50 درهم', 'AED').price).toEqual({ amount: 50, currency: 'AED' });
    expect(one('帆布袋 18元', 'CNY').price).toEqual({ amount: 18, currency: 'CNY' });
    expect(one('Kurta ₹899', 'INR').price).toEqual({ amount: 899, currency: 'INR' });
    expect(one('Kurta Rs. 1,299', 'INR').price).toEqual({ amount: 1299, currency: 'INR' });
  });

  it('anyone else\'s money is refused, never read as the workspace\'s', () => {
    for (const [line, c] of [['Kaos $15', 'IDR'], ['Camiseta $10', 'BRL'], ['Camiseta US$10', 'BRL'], ['Playera US$10', 'MXN'],
      ['Oud oil $30', 'AED'], ['帆布袋 1.05美元', 'CNY'], ['Oud oil €30', 'AED'], ['Kurta Rp 15.000', 'INR'], ['Serum R$ 49,90', 'USD']] as const) {
      expect(one(line, c), `${line} in ${c}`).toMatchObject({ price: null, problem: 'other_currency' });
    }
  });

  it('dollars read exactly as they did', () => {
    expect(one('Cup $2.60', 'USD').price).toEqual({ amount: 2.6, currency: 'USD' });
    expect(one('Serum HK$25', 'USD')).toMatchObject({ price: null, problem: 'other_currency' });
    expect(one('Bag $1.250,00', 'USD')).toMatchObject({ price: null, problem: 'ambiguous_price' });
    expect(one('帆布袋 1.05美元 500个起', 'USD')).toMatchObject({ price: { amount: 1.05, currency: 'USD' }, moq: 500 });
    // "USD 2.60" is the dollar's own mark, before or after.
    expect(one('Cup USD 2.60', 'USD').price).toEqual({ amount: 2.6, currency: 'USD' });
  });

  it('a large price is a large price in rupiah, a misread in dollars', () => {
    expect(validateExtracted(parsePriceLines('Phone Rp 15.000.000', 'IDR')).accepted).toHaveLength(1);
    expect(validateExtracted(parsePriceLines('Phone $150,000', 'USD')).rejected.map((r) => r.reason)).toEqual(['bad_price']);
  });

  it('the examples on the paste page are in the workspace\'s money', () => {
    expect(renderAddForm('en', OWNER_VIEW, 'BRL')).toContain('R$ 179,90');
    expect(renderAddForm('en', OWNER_VIEW, 'BRL')).not.toContain('$34.90');
  });
});

describe('CUR · floors and samples are in the workspace\'s currency', () => {
  it('a floor', () => {
    const r = validatePriceRules({ floor: '0,35', maxDiscountPct: '10', askAbovePct: '7', currency: 'BRL' });
    expect(r.ok && r.value.floor).toEqual({ amount: 0.35, currency: 'BRL' });
    const a = validatePriceRules({ floor: '4', maxDiscountPct: '10', askAbovePct: '7', currency: 'AED' });
    expect(a.ok && a.value.floor.currency).toBe('AED');
    // Percentages keep their own refusal.
    const bad = validatePriceRules({ floor: '4', maxDiscountPct: '-5', askAbovePct: '7', currency: 'AED' });
    expect(!bad.ok && bad.errors.maxDiscountPct).toBe('pct_out_of_range');
  });
  it('a sample', () => {
    const s = validateSamplePolicy({ price: '15.000', creditedOnFirstOrder: false, currency: 'IDR', now: new Date() });
    expect(s.ok && s.value.price).toEqual({ amount: 15000, currency: 'IDR' });
    expect(validateSamplePolicy({ price: '-1', creditedOnFirstOrder: false, currency: 'IDR', now: new Date() })).toMatchObject({ ok: false, error: 'negative' });
  });
});

describe('CUR · the rate page converts only where there is something to convert', () => {
  const view = (over: Partial<RateView>): RateView => ({ current: null, previous: [], pair: null, currency: 'AED', ...over });
  it('no pair: one sentence, and no form', () => {
    const html = renderRate(view({}), 'en', null);
    // Phase 9 (V1-531) — the currency by its name, as on Business profile.
    expect(html).toContain(t('en', 'rate.none', { from: currencyInLine('en', 'AED') }));
    expect(html).not.toContain('name="rate"');
  });
  it('a pair: the rate is between those two', () => {
    const html = renderRate(view({ currency: 'USD', pair: { from: 'USD', to: 'INR' },
      current: { from: 'USD', to: 'INR', rate: 83.1, statedAt: new Date('2026-09-30T00:00:00Z') } }), 'en', null);
    expect(html).toContain('1 USD = 83.1 INR');
    expect(html).toContain('name="rate"');
    expect(html).not.toContain('￥');
  });
});

describe('CUR · the currency changes only until the first price, and only by the owner', () => {
  const profile = {
    name: 'Oud House', description: null, location: null, workingHours: null, languagesServed: ['en'],
    contactEmail: null, contactPhone: null, categories: [],
  } as unknown as Parameters<typeof renderProfile>[0];
  const STAFF: Viewer = { ...OWNER_VIEW, isOwner: false } as Viewer;
  const draw = (fixed: boolean, viewer: Viewer = OWNER_VIEW) =>
    renderProfile(profile, 'en', null, {}, {}, null, { currency: 'AED', fixed }, viewer);
  it('before a price: the owner chooses from the eight', () => {
    const html = draw(false);
    // Phase 3 — a row of the profile's one form, saved with it
    expect(html).toContain('<select id="pf-currency" name="currency">');
    expect(html).toContain('<option value="AED" selected>');
  });
  it('after a price: it is said, and fixed', () => {
    const html = draw(true);
    expect(html).not.toContain('name="currency"');
    expect(html).toContain(t('en', 'settings.currency.fixed'));
  });
  it('staff see it and who decides', () => {
    const html = draw(false, STAFF);
    expect(html).not.toContain('name="currency"');
    expect(html).toContain(t('en', 'staff.ownerDecides'));
  });
  it('the route is the owner\'s, and the check and the write share one lock', () => {
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(app).toMatch(/app\.post\('\/app\/settings\/currency'[\s\S]{0,200}ownerOnly\(req, reply, 'price_rules'/);
    const settings = readFileSync(new URL('../../src/api/web/settings.ts', import.meta.url), 'utf8');
    expect(settings).toMatch(/for update[\s\S]{0,300}hasPrices\(tx, bid\.value\)[\s\S]{0,200}update businesses set currency/);
  });
});

describe('CUR · the database holds the eight, and room for them', () => {
  const sql = readFileSync(new URL('../../migrations/0092_workspace_currency.sql', import.meta.url), 'utf8');
  it('every currency check names the same eight', () => {
    const list = "'USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR'";
    for (const c of ['businesses_currency_known', 'products_currency_known', 'price_tiers_currency_known', 'pricing_policy_currency_known',
      'quotes_currency_known', 'orders_currency_known', 'sample_policy_currency_known']) {
      expect(sql, c).toMatch(new RegExp(`${c} check \\(currency in \\(${list.replace(/[()]/g, '\\$&')}\\)\\)`));
    }
    expect(CURRENCIES.map((c) => `'${c}'`).join(', ')).toBe(list);
  });
  it('a price in rupiah fits', () => {
    expect(sql).toContain('alter table price_tiers    alter column unit_price_usd        type numeric(14,4)');
    expect(sql).toContain('alter column total_usd             type numeric(16,2)');
  });
});
