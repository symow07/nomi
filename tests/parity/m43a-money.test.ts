import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import {
  type Money, usd, parseCurrency, moneyFromRow, subMoney, scaleMoney,
  compareMoney, isBelow, isAbove, roundMoney, currencySymbol,
} from '../../src/core/types/money.js';
import { computeQuote, selectTier, contradictsHistory } from '../../src/core/commerce/quote.js';
import { validatePriceRules } from '../../src/core/commerce/priceRules.js';
import { renderInvoiceEn, buildInvoice } from '../../src/core/commerce/invoice.js';
import { guardFallbackReply } from '../../src/core/conversation/templates.js';
import { product, tiers, policy } from './fixtures.js';

/**
 * M43a — money is a pair, and this milestone changes no behaviour.
 *
 * The defect it removes is one nobody can see yet: the currency lived in the
 * IDENTIFIER (`unitPriceUsd`, `floorPriceUsd`, `totalUsd`), and an identifier
 * is a comment. Comments do not participate in arithmetic. The day a second
 * currency exists, a euro price compared against a dollar floor type-checks,
 * clears the guard, and reaches a buyer as a quote — and every test in this
 * repository still passes, because the numbers were always just numbers.
 *
 * So these tests are about SHAPE, not sums. The sums were correct before.
 */

const cheap = usd(0.38);
const dear = usd(0.44);

describe('M43a · the currency travels with the amount', () => {
  it('a price is an amount AND a currency, never one alone', () => {
    expect(cheap).toEqual({ amount: 0.38, currency: 'USD' });
  });

  it('the quote engine returns money, not numbers', () => {
    const r = computeQuote({ product: product(), tiers: tiers(), policy: policy(), rules: [], quantity: 20000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.unitPrice.currency).toBe('USD');
    expect(r.value.total.currency).toBe('USD');
    // and the total is the unit price SCALED by the quantity, in the same currency
    expect(r.value.total.amount).toBeCloseTo(r.value.unitPrice.amount * 20000, 2);
  });

  it('the tier, the floor and the refusal all carry it too', () => {
    expect(selectTier(tiers(), 20000)?.unitPrice.currency).toBe('USD');
    expect(policy()!.floorPrice.currency).toBe('USD');
    const r = computeQuote({
      product: product(), tiers: tiers(),
      policy: { ...policy()!, floorPrice: usd(99) }, rules: [], quantity: 20000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'below_floor') expect(r.error.floorPrice).toEqual(usd(99));
  });

  it('and so does a price she was quoted before', () => {
    const c = contradictsHistory([{ quantity: 20000, unitPrice: cheap, at: new Date('2026-03-01') }], 20000, dear);
    expect(c).not.toBeNull();
    expect(c!.prior.unitPrice).toEqual(cheap);
    expect(c!.proposedUnitPrice).toEqual(dear);
  });
});

describe('M43a · arithmetic that mixes currencies cannot happen quietly', () => {
  /**
   * `Currency` is a union of ONE, so the compiler makes every mismatch
   * unrepresentable today and these casts are the only way to reach the guard.
   * That is the point: the runtime check is for the day the union grows, and a
   * check nobody has ever executed is a check nobody knows works.
   */
  const eur = { amount: 1, currency: 'EUR' } as unknown as Money;

  it('subtraction throws rather than returning a plausible number', () => {
    expect(() => subMoney(usd(5), eur)).toThrow(/not comparable/);
  });

  it('comparison throws rather than ordering two currencies', () => {
    expect(() => compareMoney(usd(5), eur)).toThrow(/not comparable/);
    expect(() => isBelow(usd(5), eur)).toThrow(/not comparable/);
    expect(() => isAbove(usd(5), eur)).toThrow(/not comparable/);
  });

  it('scaling by a plain number is always safe — a quantity has no currency', () => {
    expect(scaleMoney(usd(0.38), 20000)).toEqual(usd(7600));
    expect(roundMoney({ amount: 7599.9999, currency: 'USD' })).toEqual(usd(7600));
  });
});

describe('M43a · a row whose currency this build cannot price is DROPPED, never defaulted', () => {
  it('an unknown currency parses to null, not to USD', () => {
    expect(parseCurrency('USD')).toBe('USD');
    expect(parseCurrency('EUR')).toBeNull();
    expect(parseCurrency('')).toBeNull();
    expect(moneyFromRow(1.05, 'EUR')).toBeNull();
    expect(moneyFromRow(1.05, 'USD')).toEqual(usd(1.05));
  });

  it('the repos drop such a tier rather than quoting it in dollars', async () => {
    // Structural: a `?? usd(...)` here would turn every unpriceable row into a
    // dollar price, which is the exact failure this milestone exists to remove.
    const src = await readFile(new URL('../../src/db/repos.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/const unitPrice = moneyFromRow\(num\(r\.unit_price_usd\), r\.currency\);/);
    expect(src).toContain('return unitPrice === null ? [] : [{');
    // and a prior quote in another currency is not compared against
    expect(src).toMatch(/priorQuotes[\s\S]{0,900}unitPrice === null \? \[\] : \[\{ quantity: x\.quantity, unitPrice, at: x\.created_at \}\]/);
  });

  it('a floor it cannot read is not silently treated as a dollar floor', async () => {
    const src = await readFile(new URL('../../src/db/repos.ts', import.meta.url), 'utf8');
    expect(src).toContain('const floorPrice = moneyFromRow(num(r.floor_price_usd), r.currency);');
    expect(src).toContain('if (floorPrice === null) return null;');
  });
});

describe('M43a · no surface prints a symbol it did not read from the money', () => {
  it('the buyer invoice takes its symbol from the currency', () => {
    const q = computeQuote({ product: product(), tiers: tiers(), policy: policy(), rules: [], quantity: 20000 });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    const inv = buildInvoice({
      quote: q.value, sellerName: 'Tianhe', sellerPrefix: 'TH', buyerName: 'Buyer',
      productName: 'Bag', productSku: 'BAG-1', incoterm: 'FOB Ningbo',
      paymentTermsZh: '30%订金', paymentTermsEn: '30% deposit',
      conversationRef: 'conv-0301', now: new Date('2026-08-13T00:00:00Z'),
    });
    expect(inv.unitPrice).toEqual(q.value.unitPrice);
    expect(renderInvoiceEn(inv)).toContain(`${currencySymbol('USD')}${inv.unitPrice.amount.toFixed(2)}`);
  });

  it('the deterministic fallback reply names the currency it is quoting in', () => {
    const q = computeQuote({ product: product(), tiers: tiers(), policy: policy(), rules: [], quantity: 20000 });
    if (!q.ok) throw new Error('fixture');
    const reply = guardFallbackReply(q.value, null);
    expect(reply).toContain(q.value.unitPrice.currency);
    expect(reply).toContain(currencySymbol(q.value.unitPrice.currency));
  });

  it('no owner-facing formatter hardcodes a currency symbol beside an amount', async () => {
    for (const f of ['src/core/owner/format.ts', 'src/core/owner/i18n/format.ts']) {
      const src = await readFile(new URL(`../../${f}`, import.meta.url), 'utf8');
      const money = src.slice(src.indexOf('formatMoney'));
      expect(money.slice(0, 400), f).toContain('currencySymbol(m.currency)');
    }
  });
});

describe('M43a · the owner states her floor and it becomes money', () => {
  it('a typed number leaves validation as a pair', () => {
    const r = validatePriceRules({ floor: '0.36', maxDiscountPct: '10', askAbovePct: '7' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.floor).toEqual(usd(0.36));
  });

  it('and it is still compared against the list price she actually has', () => {
    const r = validatePriceRules({
      floor: '9.99', maxDiscountPct: '10', askAbovePct: '7', listPrice: usd(1.05),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.floor).toBe('floor_above_list');
  });
});

describe('M43a · the schema carries it too', () => {
  it('every money-bearing table got a currency column, additively', async () => {
    const sql = await readFile(new URL('../../migrations/0030_money_currency.sql', import.meta.url), 'utf8');
    for (const table of ['price_tiers', 'pricing_policy', 'quotes', 'orders', 'products']) {
      expect(sql, table).toMatch(new RegExp(`alter table ${table}\\s+add column if not exists currency`));
    }
    // Additive and forward-only: no rename, no drop, no rewrite of history.
    expect(sql).not.toMatch(/\bdrop column\b/i);
    expect(sql).not.toMatch(/\brename\b/i);
  });

  it('and a currency the code cannot price cannot be written at all', async () => {
    const sql = await readFile(new URL('../../migrations/0030_money_currency.sql', import.meta.url), 'utf8');
    for (const table of ['price_tiers', 'pricing_policy', 'quotes', 'orders', 'products']) {
      expect(sql, table).toContain(`${table}_currency_known check (currency in ('USD'))`);
    }
  });

  it('the build REQUIRES it — it reads the column on every quote', async () => {
    const { REQUIRED_SCHEMA_VERSION } = await import('../../src/db/schemaVersion.js');
    const files = (await readdir(new URL('../../migrations/', import.meta.url))).filter((f) => f.endsWith('.sql'));
    expect(REQUIRED_SCHEMA_VERSION).toBe(Math.max(...files.map((f) => Number(f.slice(0, 4)))));
  });
});

describe('M43a · nothing is named for its currency any more', () => {
  it('no `*Usd` identifier survives in src', async () => {
    // The rename is the milestone. A single `floorPriceUsd` left behind is a
    // place where the currency is still a comment.
    const { execSync } = await import('node:child_process');
    const hits = execSync('grep -rn "[A-Za-z]Usd[A-Za-z]*" src || true', {
      cwd: new URL('../../', import.meta.url).pathname, encoding: 'utf8',
    })
      .split('\n')
      .filter((l) => l.trim() !== '')
      // COMMENTS may still say the old name — two places read a payload written
      // before this milestone (a stored signal, a recorded practice run), and
      // the comment explaining that is the reason it is safe. What must not
      // survive is a live IDENTIFIER carrying its currency in its name.
      .filter((l) => !/^[^:]+:\d+:\s*(\*|\/\/|\/\*)/.test(l))
      .filter((l) => !/\?\?\s*p\['totalUsd'\]/.test(l))
      .filter((l) => !/unitPriceUsd\?: number/.test(l));
    expect(hits, `still named for a currency:\n${hits.join('\n')}`).toEqual([]);
  });

  it('the SQL columns keep their historical names, on purpose', async () => {
    // Renaming them would rewrite four tables and invalidate every snapshot in
    // `quotes.inputs`. The code is what had to stop lying.
    const sql = await readFile(new URL('../../migrations/0030_money_currency.sql', import.meta.url), 'utf8');
    expect(sql).toContain('The amount columns keep their historical names');
  });
});
