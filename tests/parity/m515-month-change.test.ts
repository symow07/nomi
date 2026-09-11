import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { biggestChange, MONTH_DRIVERS, type MonthDriver } from '../../src/core/insights/changed.js';
import { renderInsights, type InsightsData } from '../../src/api/web/insights.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M51.5 — why did this month change?
 *
 * The question outlived its first implementation. `core/insights/questions.ts`
 * answered it in M7 and was deleted in M34.10 rather than wired, because it
 * ranked its drivers BY PERCENTAGE — and the product banned percentages
 * afterwards. The ranking mechanism WAS the percentage, so nothing was left to
 * port. It sat unassigned in the roadmap for six weeks under a note saying it
 * should not.
 *
 * These tests are mostly about the thing that killed version one.
 */

const counts = (over: Partial<Record<MonthDriver, { from: number; to: number }>> = {}) => ({
  inquiries: { from: 10, to: 10 }, quotes: { from: 5, to: 5 }, orders: { from: 2, to: 2 },
  ...over,
});

describe('M51.5 · two counts, never a rate', () => {
  it('names the driver and both numbers', () => {
    const c = biggestChange(counts({ inquiries: { from: 40, to: 25 } }));
    expect(c).toEqual({ driver: 'inquiries', from: 40, to: 25, change: -15 });
  });

  it('THERE IS NO PERCENTAGE ANYWHERE IN THE MODULE, and no division', async () => {
    // The exact defect that deleted version one. A ratio would also be a rate
    // however it is spelled, so the check is for the arithmetic, not the word.
    const src = await readFile(new URL('../../src/core/insights/changed.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code).not.toContain('%');
    expect(code, 'a division is a rate wearing arithmetic').not.toMatch(/\/(?!\/)/);
    expect(code).not.toMatch(/pct|percent|rate|ratio/i);
  });

  it('and no rendered line contains one either, in any locale', () => {
    for (const locale of LOCALES) {
      for (const driver of MONTH_DRIVERS) {
        for (const dir of ['up', 'down']) {
          const line = t(locale, `insight.monthChange.${driver}.${dir}` as MessageKey,
            { from: 40, to: 25, name: 'Lily' });
          expect(line, `${locale} ${driver} ${dir}`).not.toContain('%');
          expect(line).toContain('40');
          expect(line).toContain('25');
        }
      }
    }
  });
});

describe('M51.5 · ranked by the size of the change, which is also a count', () => {
  it('the biggest movement wins, regardless of the base it moved from', () => {
    // A percentage would have ranked orders first: 2 → 4 is a doubling, and
    // 40 → 25 is "only" a third. Fifteen buyers is the bigger news.
    const c = biggestChange(counts({ inquiries: { from: 40, to: 25 }, orders: { from: 2, to: 4 } }));
    expect(c!.driver).toBe('inquiries');
  });

  it('a tie goes to the driver closest to money', () => {
    const c = biggestChange(counts({ inquiries: { from: 10, to: 13 }, orders: { from: 2, to: 5 } }));
    expect(c!.driver).toBe('orders');
  });

  it('a rise and a fall are both reported, and the sign survives', () => {
    expect(biggestChange(counts({ orders: { from: 2, to: 9 } }))!.change).toBe(7);
    expect(biggestChange(counts({ orders: { from: 9, to: 2 } }))!.change).toBe(-7);
  });

  it('NOTHING is a legitimate answer — a quiet month has no news in it', () => {
    // Inventing one would be the fourth counts-with-nothing-to-do card this
    // page exists to avoid.
    expect(biggestChange(counts())).toBeNull();
  });

  it('there is NO THRESHOLD — a change of one is a change of one', () => {
    // "Only report a change bigger than three" would be an invented number,
    // and this product does not have those.
    const c = biggestChange(counts({ orders: { from: 2, to: 3 } }));
    expect(c).toEqual({ driver: 'orders', from: 2, to: 3, change: 1 });
  });
});

describe('M51.5 · it obeys the insight rule', () => {
  // G19 — it has its own place now, beside the three rather than inside them.
  const data = (): InsightsData => ({
    insights: [],
    monthChange: {
      key: 'insight.monthChange.inquiries.down',
      params: { from: 40, to: 25 },
      action: { kind: 'seeBuyers', href: '/app/conversations' },
    },
  });

  it('ends in something to tap, in every locale', () => {
    for (const locale of LOCALES) {
      const html = renderInsights(data(), locale);
      expect(html, locale).toContain('/app/conversations');
      expect(html, locale).toContain(t(locale, 'insight.action.seeBuyers'));
      expect(html).toContain('40');
      expect(html).toContain('25');
    }
  });

  it('the month boundary is HERS, not the server’s', async () => {
    // "This month" for a Yiwu factory is not this month in UTC, and a driver
    // that moved because of a date line is a fact about our servers.
    const src = await readFile(new URL('../../src/api/web/insights.ts', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('with bounds as'), src.indexOf('select * from inquiries'));
    expect(block).toContain("at time zone 'Asia/Shanghai'");
    expect(block).not.toMatch(/date_trunc\('month', now\(\)\)/);
  });

  it('it is LAST — the things to do come before the thing to know', async () => {
    const src = await readFile(new URL('../../src/api/web/insights.ts', import.meta.url), 'utf8');
    expect(src.indexOf("key: 'insight.productsNoPrice'"))
      .toBeLessThan(src.indexOf('const changed = biggestChange('));
  });

  it('every string exists in all three locales', () => {
    const keys: MessageKey[] = [
      ...MONTH_DRIVERS.flatMap((d) => [
        `insight.monthChange.${d}.up` as MessageKey,
        `insight.monthChange.${d}.down` as MessageKey,
      ]),
      'insight.action.seeBuyers',
    ];
    for (const locale of LOCALES) {
      for (const k of keys) {
        const s = t(locale, k, { from: 1, to: 2, name: 'Lily' });
        expect(s.length, `${locale} ${k}`).toBeGreaterThan(1);
        expect(s, `${locale} ${k}`).not.toContain('{');
      }
    }
  });
});
