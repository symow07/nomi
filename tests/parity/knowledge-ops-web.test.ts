import { describe, it, expect } from 'vitest';
import {
  renderKnowledgeOps, renderUsageFact,
  type KnowledgeOps, type UsageFact,
} from '../../src/api/web/knowledge-insights.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

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
      const html = renderKnowledgeOps(ops(), l, NOW);
      expect(html).toContain('href="/app/knowledge?range=today"');
      expect(html).toMatch(/class="tab on"[^>]*href="\/app\/knowledge\?range=week"/); // week is current
      expect(html).toContain(t(l, 'knowledge.report.facts'));
      expect(html).toContain('>3<');                       // facts added count (real number)
      expect(html).toContain(t(l, 'knowledge.ops.commonRequests'));
      expect(html).toContain('do you ship to Egypt?');
    }
  });

  it('gaps carry a deterministic reason + Teach and Test-in-sandbox links', () => {
    const html = renderKnowledgeOps(ops(), 'en', NOW);
    expect(html).toContain('is it food safe?');
    expect(html).toContain(t('en', 'knowledge.gap.reason.claim_requires_authorization'));
    expect(html).toContain(t('en', 'knowledge.gap.reason.no_product_match'));
    // product-scoped gap → teach on the product page; business-level → the index
    expect(html).toContain('href="/app/knowledge/p1?teach=is%20it%20food%20safe%3F"');
    expect(html).toContain('href="/app/knowledge?teach=what%20about%20a%20general%20item%3F"');
    expect(html).toContain('href="/app/sandbox?ask=is%20it%20food%20safe%3F"');   // replay loop
    expect(html).toContain('×2');   // repeated count
  });

  it('recent changes show the change type; empty states are honest', () => {
    expect(renderKnowledgeOps(ops(), 'en', NOW)).toContain(t('en', 'knowledge.activity.corrected'));
    const quiet = renderKnowledgeOps(ops({ gaps: [], activity: [] }), 'en', NOW);
    expect(quiet).toContain(t('en', 'knowledge.ops.noGaps'));
    expect(quiet).toContain(t('en', 'knowledge.ops.noActivity'));
  });

  it('usage facts are plain counts — used, last used, revised, source; never a score', () => {
    const used: UsageFact = { usedCount: 5, lastUsedAt: NOW, correctionCount: 2, source: 'owner_corrected' };
    const h = renderUsageFact(used, 'en', NOW);
    expect(h).toContain(`${t('en', 'knowledge.usage.used')} 5`);
    expect(h).toContain(t('en', 'knowledge.usage.revised', { n: 2 }));
    expect(h).toContain(t('en', 'knowledge.source.owner_corrected'));
    expect(h).not.toMatch(/\d+\s*%/);   // no percentages

    const never: UsageFact = { usedCount: 0, lastUsedAt: null, correctionCount: 0, source: 'owner_confirmed' };
    expect(renderUsageFact(never, 'en', NOW)).toContain(t('en', 'knowledge.usage.never'));
    expect(renderUsageFact(undefined, 'en', NOW)).toBe('');   // no facts → nothing
  });
});
