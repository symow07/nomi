import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { renderInsights, MAX_INSIGHTS, type InsightsData, type Insight } from '../../src/api/web/insights.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M34.10 — AN INSIGHT THAT DOES NOT TELL THE OWNER WHAT TO TAP DOES NOT RENDER.
 *
 * The rule M7's `core/insights/daily.ts` existed to carry. That module was
 * written, tested, and reached by nothing for a year, while the live analytics
 * page drifted into exactly what its own header warned against: counts with
 * nothing to do about them. The module is deleted; the rule is here, because a
 * rule that survives only as a habit is a rule that gets lost in the next
 * rewrite — which is precisely what happened to this one.
 *
 * The TYPE already makes an actionless insight unconstructable. This is the
 * belt: types are erased at runtime and `as never` walks through them, and this
 * repo has had both.
 */

const insight = (over: Partial<Insight> = {}): Insight => ({
  key: 'insight.draftsWaiting',
  params: { count: 2 },
  action: { kind: 'review_drafts', href: '/app/inbox' },
  ...over,
} as Insight);

const ALL: InsightsData = {
  monthChange: null,
  insights: [
    insight(),
    insight({ key: 'insight.quotedNoReply', params: { buyer: 'Ahmed' },
      action: { kind: 'follow_up', href: '/app/inbox/c1', buyer: 'Ahmed' } }),
    insight({ key: 'insight.promotionReady', params: { cap: 'quote' },
      action: { kind: 'consider_promotion', href: '/app/employee', capability: 'quote' } }),
  ],
};

describe('M34.10 · every insight carries somewhere to go', () => {
  it('renders one tappable link per insight, in every locale', () => {
    for (const locale of LOCALES) {
      const html = renderInsights(ALL, locale);
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      expect(links.length, locale).toBe(ALL.insights.length);
      for (const href of links) expect(href, `${locale}: ${href}`).toMatch(/^\/app/);
    }
  });

  it('an insight without an action cannot be rendered — the type forbids it', async () => {
    // Asserted against the source, because the guarantee is structural: if
    // `action` ever becomes optional, an actionless insight becomes possible
    // and this rule quietly stops being true.
    const src = await readFile(new URL('../../src/api/web/insights.ts', import.meta.url), 'utf8');
    const type = src.slice(src.indexOf('export type Insight = {'), src.indexOf('export type InsightsData'));
    expect(type).toContain('readonly action: InsightAction;');
    expect(type, 'action must not be optional').not.toMatch(/action\?:/);
  });

  it('nothing to report renders nothing at all — not an empty heading', () => {
    expect(renderInsights({ insights: [], monthChange: null }, 'en')).toBe('');
  });

  it('caps at three: a list of demands is a chore, not an insight', async () => {
    expect(MAX_INSIGHTS).toBe(3);
    const src = await readFile(new URL('../../src/api/web/insights.ts', import.meta.url), 'utf8');
    expect(src).toContain('.slice(0, MAX_INSIGHTS)');
  });

  it('every line and every action label exists in all three locales', () => {
    const KEYS: MessageKey[] = [
      'insight.title', 'insight.quotedNoReply', 'insight.draftsWaiting',
      'insight.promotionReady', 'insight.productsNoPrice',
      'insight.action.review_drafts', 'insight.action.follow_up',
      'insight.action.consider_promotion', 'insight.action.fix_catalog',
    ];
    for (const locale of LOCALES) {
      for (const k of KEYS) {
        const s = t(locale, k, { count: 2, buyer: 'Ahmed', cap: '报价', name: '小雅' });
        expect(s.length, `${locale} ${k}`).toBeGreaterThan(1);
        expect(s, `${locale} ${k} left a placeholder`).not.toContain('{');
      }
    }
  });

  it('states findings, never rates or scores — the M7 module could not say this', () => {
    // core/insights/questions.ts ranked its drivers by percentage
    // ("询盘多了67%", "报价成单率升到23%"), which the product banned afterwards.
    // The ranking mechanism WAS the percentage, so it was deleted rather than
    // ported. What replaced it may not reintroduce one.
    for (const locale of LOCALES) {
      const visible = renderInsights(ALL, locale).replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]*>/g, ' ');
      expect(/\d\s*%/.test(visible), `${locale}: a percentage`).toBe(false);
      for (const word of ['score', 'rate', 'ratio', '转化率', '成单率'])
        expect(visible.toLowerCase().includes(word), `${locale}: "${word}"`).toBe(false);
    }
  });

  it('the production caller renders it on Today', async () => {
    const src = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(src).toContain('loadInsights(deps.db, deps.businessId)');
    expect(src).toContain('renderInsights(insights, locale)');
  });
});
