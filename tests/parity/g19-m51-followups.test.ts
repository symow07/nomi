import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { renderInsights, MAX_INSIGHTS, type InsightsData, type Insight } from '../../src/api/web/insights.js';
import { checkBudget } from '../../src/core/budget.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, ASSISTANT_FALLBACK } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * G19 · M51 follow-ups — two things that were computed and then thrown away.
 *
 *  · `checkBudget` has returned `soft_warn` since M51.2, and the send gate asks
 *    only "is it pause?". The one warning that exists to arrive BEFORE the stop
 *    arrived nowhere, on a product whose owner watches this page.
 *  · The month-change insight was pushed onto the same list as the three things
 *    to DO and then cut by `slice(0, 3)` — so on exactly the busy month it
 *    exists to explain, it was the line that got dropped.
 */

const snapshot = (over: Partial<OperationsSnapshot> = {}): OperationsSnapshot => ({
  range: 'today',
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 },
  activity: { handled: 3, draftsCreated: 2, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'connected', provider: 'meta' },
  budget: null,
  hasAttention: false,
  ...over,
});

const insight = (key: Insight['key'], over: Partial<Insight> = {}): Insight => ({
  key, params: { count: 2 }, action: { kind: 'review_drafts', href: '/app/inbox' }, ...over,
} as Insight);

describe('G19 · the ceiling she set is said before it stops her', () => {
  it('the warning is on Today, with her percentage and what happens at 100%', () => {
    const html = renderOperationsHome(snapshot({ budget: { pctUsed: 84, stops: true } }), 'en');
    expect(html).toContain(esc(t('en', 'today.budget.near', { name: ASSISTANT_FALLBACK.en, pct: 84 })));
    expect(html).toContain(esc(t('en', 'today.budget.thenStops')));
    expect(html).not.toContain(esc(t('en', 'today.budget.thenKeeps')));
  });

  it('and says what HER setting does — not a general fact about limits', () => {
    // Two tenants, two settings, two different sentences. `stops` comes from
    // `on_exceeded`, so the page never promises a stop that was not configured.
    const keeps = renderOperationsHome(snapshot({ budget: { pctUsed: 91, stops: false } }), 'en');
    expect(keeps).toContain(esc(t('en', 'today.budget.thenKeeps')));
    expect(keeps).not.toContain(esc(t('en', 'today.budget.thenStops')));
  });

  it('below her line, nothing is said — a warning shown every day is not read', () => {
    expect(renderOperationsHome(snapshot(), 'en')).not.toContain(esc(t('en', 'today.budget.thenStops')));
    expect(renderOperationsHome(snapshot(), 'en')).not.toContain('%');
  });

  it('it is a notice, never a demand: a quiet day with a warning is still quiet', () => {
    const html = renderOperationsHome(snapshot({ budget: { pctUsed: 84, stops: true } }), 'en');
    // The calm state is what a day with nothing to do looks like; the budget
    // line sits under it rather than turning the page into a work list.
    expect(html).toContain('calm-page');
  });

  it('in every locale, and it is the same rule core/budget.ts states', () => {
    for (const locale of LOCALES) {
      const html = renderOperationsHome(snapshot({ budget: { pctUsed: 84, stops: true } }), locale);
      expect(html, locale).toContain(esc(t(locale, 'today.budget.near', { name: ASSISTANT_FALLBACK[locale], pct: 84 })));
    }
    // 84% of a 2,000-call day is a soft warning; the page shows what core decided.
    const verdict = checkBudget({ llmCalls: 1680, tokens: 0 },
      { dailyLlmCalls: 2000, dailyTokens: 5_000_000, softWarnPct: 80, onExceeded: 'pause' });
    expect(verdict).toEqual({ kind: 'soft_warn', pctUsed: 84 });
  });

  it('Today reads that verdict rather than re-deciding it', async () => {
    const src = await readFile(new URL('../../src/api/web/operations.ts', import.meta.url), 'utf8');
    expect(src).toContain("import { checkBudget }");
    // No second threshold: the only percentages here come from core.
    expect(src).not.toMatch(/pctUsed\s*[><]=?\s*\d/);
  });
});

describe('G19 · the month never loses its place to a busy month', () => {
  const three = [insight('insight.draftsWaiting'), insight('insight.quotedNoReply'), insight('insight.productsNoPrice')];
  const month = insight('insight.monthChange.inquiries.up', {
    params: { from: 12, to: 30 }, action: { kind: 'seeBuyers', href: '/app/conversations' },
  });

  it('three things to do AND the month change are all shown', () => {
    const data: InsightsData = { insights: three, monthChange: month };
    const html = renderInsights(data, 'en');
    expect(three.length).toBe(MAX_INSIGHTS);
    expect(html).toContain('/app/conversations');
    expect(html).toContain(esc(t('en', 'insight.action.seeBuyers')));
    // and the three it was competing with are all still there
    for (const i of three) expect(html).toContain(esc(t('en', `insight.action.${i.action.kind}`)));
  });

  it('the cap still applies to the things to DO', async () => {
    const src = await readFile(new URL('../../src/api/web/insights.ts', import.meta.url), 'utf8');
    expect(src).toContain('out.slice(0, MAX_INSIGHTS)');
    // the month change is returned beside them, never pushed into them
    expect(src).not.toMatch(/out\.push\(\{[^}]*monthChange/);
    expect(src).toContain('monthChange');
  });

  it('and with nothing to do at all, the month change alone still renders', () => {
    const html = renderInsights({ insights: [], monthChange: month }, 'en');
    expect(html).toContain(esc(t('en', 'insight.action.seeBuyers')));
    expect(renderInsights({ insights: [], monthChange: null }, 'en')).toBe('');
  });
});
