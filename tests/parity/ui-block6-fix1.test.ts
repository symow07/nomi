// UI Block 6 · fix round 1 (the tester's four points on e8cdcf55).
// 1. F33: on a phone a selling question and its Next fit above the tab bar — the step row stays one row, the spacing
//    is tighter and the told box is shorter at rest (taller on focus). Measured by the fit probe at 390x844, five languages.
// 2. F32: the Follow-ups fold's summary line is in the page's language: every string on it has a key in all five catalogues.
// 3. F39: the Results scope sentence, every assistantArea.* key and the pager's "of" are translated.
// 4. The live-refresh pin's comment states the limit it asserts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { messages, t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { renderFollowUpRule } from '../../src/api/web/followUps.js';
import { renderAnalytics, type AnalyticsData } from '../../src/api/web/analytics.js';
import { renderAssistantActivity } from '../../src/api/web/assistantActivity.js';
import type { AssistantActivityRow } from '../../src/db/assistantActivity.js';
import type { AssistantPage } from '../../src/db/assistantKnowledge.js';
import { withAssistantName } from '../../src/api/web/say.js';
import { usd } from '../../src/core/types/money.js';
import { withoutIsolates } from './isolates.js';

const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const OTHER = LOCALES.filter((l) => l !== 'en');
const translated = (k: MessageKey) => {
  for (const l of OTHER) expect(messages[l][k], `${l} ${k}`).not.toBe(messages.en[k]);
};

describe('UI Block 6 fix 1 · F33 — a selling question and its Next fit a phone', () => {
  it('the step row stays one row; spacing and the told box at rest are tightened, on a phone only', () => {
    const layout = src('../../src/api/web/layout.ts');
    const at = layout.indexOf('  @media (max-width:600px) {\n    .sa-content:has(> .hs-step) > .sa-page-chooser');
    expect(at).toBeGreaterThan(0);
    const block = layout.slice(at, layout.indexOf('\n  }\n', at));
    for (const rule of [
      '.sa-content:has(> .hs-step) > .sa-page-chooser { margin-bottom:var(--space-8); padding-bottom:var(--space-4); }',
      '.hs-step { margin-bottom:0; flex-wrap:nowrap; }',
      '.hs-step > .back { flex:none; }',
      '.hs-step > .hs-where { min-inline-size:0; justify-content:flex-end; text-align:end; }',
      '.hs-step ~ h1.page { margin-bottom:var(--space-12); }',
      '.hs-step ~ .pform { margin-top:0; gap:var(--space-8); }',
      '.hs-step ~ .pform .choices { row-gap:0; }',
      '.hs-step ~ .pform textarea[name="told"] { block-size:5rem; }',
      '.hs-step ~ .pform textarea[name="told"]:focus { block-size:8.5rem; }',
    ]) expect(block, rule).toContain(rule);
    // nothing is hidden by it
    expect(block).not.toMatch(/display:\s*none|visibility:\s*hidden|clip/);
  });
});

describe('UI Block 6 fix 1 · F32 — the Follow-ups summary in the page\'s language', () => {
  const keys: MessageKey[] = ['followUp.title', 'followUp.on', 'followUp.off', 'followUp.day', 'followUp.days'];
  it('every string on the summary line has a key in all five catalogues, the French its own', () => {
    for (const k of keys) { for (const l of LOCALES) expect(t(l, k), `${l} ${k}`).not.toBe(''); translated(k); }
  });
  it('on a non-English page the summary carries no English and no lang="en" mark', () => {
    for (const l of OTHER) {
      for (const rule of [{ enabled: false, delayDays: 2, wording: '' }, { enabled: true, delayDays: 1, wording: 'Hi' }]) {
        const html = withoutIsolates(renderFollowUpRule(l, rule, true));
        const summary = html.slice(html.indexOf('<summary>'), html.indexOf('</summary>'));
        expect(summary, l).not.toContain('lang="en"');
        for (const word of ['Follow-ups after a quote', 'Off', 'On', 'days', '1 day']) expect(summary, `${l} ${word}`).not.toContain(word);
        expect(summary, l).toContain(t(l, 'followUp.title'));
      }
    }
  });
  it('the days list is in the page\'s language too, not marked English', () => {
    const html = renderFollowUpRule('ar', { enabled: false, delayDays: 2, wording: '' }, true);
    expect(html).not.toMatch(/<option[^>]*lang="en"/);
  });
});

const DATA: AnalyticsData = {
  range: 'week', hasActivity: true, since: new Date('2026-11-23T00:00:00Z'),
  summary: { newClients: 6, activeConvos: 5, quotes: 2, orders: 1 },
  activity: { inbound: 6, replied: 3, waiting: 4 },
  commerce: { quotes: 2, orders: 1, deals: [{ status: 'confirmed', n: 1 }], totals: [usd('4600')] },
  employee: { handled: 8, waiting: 4, edits: 2 },
};
const ROWS: AssistantActivityRow[] = [
  { id: 'check:4', kind: 'spotcheck_pass', capability: null, at: new Date('2026-11-23T08:12:00Z'), why: null, language: null, conversationId: '00000000-0000-4000-8000-000000000001' },
];
const PAGE: AssistantPage<AssistantActivityRow> = { rows: ROWS, total: 61, page: 2, pageSize: 50, from: 51, to: 51, next: null, prev: 1 };

describe('UI Block 6 fix 1 · F39 — the Results scope, the assistant area and the pager translated', () => {
  it('area1.results.intro and every assistantArea.* key are translated in zh / ar / es / fr', () => {
    const area = (Object.keys(messages.en) as MessageKey[]).filter((k) => k.startsWith('assistantArea.'));
    expect(area.length).toBeGreaterThan(25);
    for (const k of ['area1.results.intro' as MessageKey, ...area]) translated(k);
  });
  it('the report header\'s scope is in the page\'s language', () => {
    for (const l of OTHER) {
      const html = renderAnalytics(DATA, l);
      const scope = html.slice(html.indexOf('results-scope'), html.indexOf('</p>', html.indexOf('results-scope')));
      expect(scope, l).not.toContain('lang="en"');
      expect(scope, l).toContain(t(l, 'area1.results.intro'));
    }
  });
  it('the pager says its range in the page\'s language: no English "of"', () => {
    for (const l of OTHER) {
      const html = withoutIsolates(withAssistantName('Lily', () => renderAssistantActivity(PAGE, l, 'all')));
      const pager = html.slice(html.indexOf('aa-pager-above'), html.indexOf('</nav>', html.indexOf('aa-pager-above')));
      expect(pager, l).not.toMatch(/\bof\b/);
      expect(pager, l).toContain(t(l, 'assistantArea.previous'));
    }
  });
});

describe('UI Block 6 fix 1 — the live-refresh pin says the limit it asserts', () => {
  // UI Block 7's F34 fix round raised the ceiling to 59,800 (Copy moved into the script); the rule is the same: the
  // comment above the ceiling names the limit it asserts and what was measured, Block 6's 58,800 / 58,766 kept in it.
  it('the comment above the 59,800 ceiling names 59,800 and what it measured', () => {
    const test = src('./live-refresh.test.ts');
    const at = test.indexOf('toBeLessThan(59_800)');
    expect(at).toBeGreaterThan(0);
    const comment = test.slice(test.lastIndexOf('// Block 2 fix round 2', at), at);
    expect(comment).toContain('59,800');
    expect(comment).toContain('59,767');
    expect(comment).toContain('58,800');
    expect(comment).toContain('58,766');
  });
});
