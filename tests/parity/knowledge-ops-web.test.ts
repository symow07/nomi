import { describe, it, expect } from 'vitest';
import {
  renderKnowledgeOps, renderKnowledgePeriod, renderUsageFact,
  type KnowledgeOps, type UsageFact,
} from '../../src/api/web/knowledge-insights.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { withoutIsolates } from './isolates.js';

const NOW = new Date('2026-07-31T12:00:00Z');

const ops = (over: Partial<KnowledgeOps> = {}): KnowledgeOps => ({
  range: 'week', hasActivity: true,
  report: { factsAdded: 3, answersCorrected: 1, certsAuthorized: 2, archived: 0,
    commonRequests: [{ question: 'do you ship to Egypt?', count: 4 }] },
  gaps: [
    { question: 'is it food safe?', reason: 'claim_requires_authorization', productId: 'p1', count: 2, lastAt: NOW },
    { question: 'what about a general item?', reason: 'no_product_match', productId: null, count: 1, lastAt: NOW },
  ],
  activity: [{ id: 'k1', productId: 'p1', kind: 'faq', label: 'Colors', change: 'corrected', at: NOW }],
  ...over,
});

describe('M14 · knowledge operations (localized renderer)', () => {
  it('range tabs, report counts, common requests — in en/zh/ar', () => {
    for (const l of LOCALES) {
      // Phase 9 (V1-358) — the period's part of the page, drawn at its foot.
      const html = withoutIsolates(renderKnowledgePeriod(ops(), l, NOW));
      // The tabs keep the reader at the period's part of the page.
      expect(html).toContain('href="/app/knowledge?range=today#period"');
      expect(html).toMatch(/class="tab on"[^>]*href="\/app\/knowledge\?range=week#period"/); // week is current
      expect(html).toContain(t(l, 'knowledge.report.facts'));
      expect(html).toContain('>3<');                       // facts added count (real number)
      expect(html).toContain(t(l, 'knowledge.ops.commonRequests'));
      expect(html).toContain('do you ship to Egypt?');
    }
  });

  it('gaps carry a deterministic reason + Teach and Test-in-sandbox links', () => {
    const html = withoutIsolates(renderKnowledgeOps(ops(), 'en', NOW));
    expect(html).toContain('is it food safe?');
    expect(html).toContain(t('en', 'knowledge.gap.reason.claim_requires_authorization'));
    expect(html).toContain(t('en', 'knowledge.gap.reason.no_product_match'));
    // product-scoped gap → teach on the product page; business-level → the index
    expect(html).toContain('href="/app/knowledge/p1?teach=is%20it%20food%20safe%3F"');
    expect(html).toContain('href="/app/knowledge?teach=what%20about%20a%20general%20item%3F"');
    // replay loop — onto the practice box, which CC-25 moved under the practice transcript;
    // every workspace's own Practice since P5
    expect(html).toContain('href="/app/sandbox?ask=is%20it%20food%20safe%3F#compose"');
    expect(html).toContain('×2');   // repeated count
  });

  it('recent changes show the change type; empty states are honest', () => {
    expect(withoutIsolates(renderKnowledgePeriod(ops(), 'en', NOW))).toContain(t('en', 'knowledge.activity.corrected'));
    // Questions were asked and every reply drew on what was taught: said so.
    const answered = withoutIsolates(renderKnowledgeOps(ops({ gaps: [], activity: [] }), 'en', NOW));
    expect(answered).toContain(t('en', 'knowledge.ops.noGaps', { period: 'this week' }));
    // Phase 9 (V1-359) — nothing asked at all: never "answered from what you taught".
    const none = { factsAdded: 0, answersCorrected: 0, certsAuthorized: 0, archived: 0, commonRequests: [] };
    const quiet = ops({ gaps: [], activity: [], hasActivity: false, report: none });
    expect(withoutIsolates(renderKnowledgeOps(quiet, 'en', NOW))).toContain(t('en', 'knowledge.ops.noQuestions', { period: 'this week' }));
    expect(withoutIsolates(renderKnowledgeOps(quiet, 'en', NOW))).not.toContain('what you taught');
    expect(withoutIsolates(renderKnowledgePeriod(quiet, 'en', NOW))).toContain(t('en', 'knowledge.ops.noActivity', { period: 'this week' }));
  });

  it('usage facts are plain counts — used, last used, revised, source; never a score', () => {
    const used: UsageFact = { usedCount: 5, lastUsedAt: NOW, correctionCount: 2, source: 'owner_corrected' };
    const h = withoutIsolates(renderUsageFact(used, 'en', NOW));
    expect(h).toContain(`${t('en', 'knowledge.usage.used')} 5`);
    expect(h).toContain(t('en', 'knowledge.usage.revised', { n: 2 }));
    expect(h).toContain(t('en', 'knowledge.source.owner_corrected'));
    expect(h).not.toMatch(/\d+\s*%/);   // no percentages

    const never: UsageFact = { usedCount: 0, lastUsedAt: null, correctionCount: 0, source: 'owner_confirmed' };
    expect(withoutIsolates(renderUsageFact(never, 'en', NOW))).toContain(t('en', 'knowledge.usage.never'));
    expect(withoutIsolates(renderUsageFact(undefined, 'en', NOW))).toBe('');   // no facts → nothing
  });
});
