// UI Block 6 · F39 — Results and Activity. Results: ONE report header — the period (its three tabs and where it
// starts) and what is counted, said together on one line under the tabs (the assistant section keeps its own
// "this covers" line). Activity: compact dated events — the day once, then each event its time, who did it, what happened and
// its conversation — with filters, and the pages above the list as well as below it; a page keeps its filter.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { usd } from '../../src/core/types/money.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { renderAnalytics, type AnalyticsData } from '../../src/api/web/analytics.js';
import { renderAssistantActivity } from '../../src/api/web/assistantActivity.js';
import type { AssistantActivityRow } from '../../src/db/assistantActivity.js';
import type { AssistantPage } from '../../src/db/assistantKnowledge.js';
import { esc } from '../../src/api/web/layout.js';
import { withAssistantName } from '../../src/api/web/say.js';
import { withoutIsolates } from './isolates.js';

const area = readFileSync(new URL('../../src/api/web/assistantAreaStyle.ts', import.meta.url), 'utf8');
const split = readFileSync(new URL('../../src/api/web/splitStyle.ts', import.meta.url), 'utf8');
const at = (h: string, s: string) => h.indexOf(s);
const DATA: AnalyticsData = {
  range: 'week', hasActivity: true, since: new Date('2026-11-23T00:00:00Z'),
  summary: { newClients: 6, activeConvos: 5, quotes: 2, orders: 1 },
  activity: { inbound: 6, replied: 3, waiting: 4 },
  commerce: { quotes: 2, orders: 1, deals: [{ status: 'confirmed', n: 1 }], totals: [usd('4600')] },
  employee: { handled: 8, waiting: 4, edits: 2 },
};

describe('UI Block 6 · F39 — Results: one report header', () => {
  it('the period (tabs and its start) and what is counted sit together under the tabs, not split by the title', () => {
    for (const l of LOCALES) {
      const html = renderAnalytics(DATA, l);
      const header = html.slice(at(html, '<header class="results-header">'), at(html, '</header>'));
      expect(header, l).toMatch(/<div class="tabs">.*<\/div><p class="caption muted an-since">[^<]*<\/p><p class="caption muted results-scope">/s);
      // the scope no longer stands between the title and the period
      expect(header, l).not.toContain('<p class="muted">');
      expect(at(header, 'class="tabs"'), l).toBeLessThan(at(header, 'results-scope'));
      expect(html.match(/class="tab /g), l).toHaveLength(3);
      expect(html.match(/results-scope/g), l).toHaveLength(1);
    }
    expect(split).toContain('.results-page .results-header > .an-since, .results-page .results-header > .results-scope { display:inline; margin:0; }');
    expect(split).toContain('.results-page .results-header > .tabs { flex-wrap:wrap; }');
  });
});

const ROWS: AssistantActivityRow[] = [
  { id: 'capability:9', kind: 'promote', capability: 'greet', at: new Date('2026-11-23T10:15:00Z'), why: null, language: null, conversationId: null },
  { id: 'check:4', kind: 'spotcheck_pass', capability: null, at: new Date('2026-11-23T08:12:00Z'), why: null, language: null, conversationId: '00000000-0000-4000-8000-000000000001' },
  { id: 'capability:8', kind: 'self_demote', capability: 'quote', at: new Date('2026-11-21T12:15:00Z'), why: 'repeated_corrections', language: 'fr', conversationId: null },
];
const PAGE: AssistantPage<AssistantActivityRow> = { rows: ROWS, total: 61, page: 2, pageSize: 50, from: 51, to: 53, next: null, prev: 1 };
const render = (l: (typeof LOCALES)[number], only?: 'all' | 'checks', page = PAGE) =>
  withoutIsolates(withAssistantName('Lily', () => renderAssistantActivity(page, l, only)));

describe('UI Block 6 · F39 — Activity: compact dated events', () => {
  it('the day once, then each event its time, who did it, what happened and its conversation', () => {
    for (const l of LOCALES) {
      const html = render(l);
      expect(html.match(/<h2 class="aa-day">/g), l).toHaveLength(2);
      expect(html.match(/<li class="aa-event" id="event-/g), l).toHaveLength(3);
      expect(html, l).toContain('<li class="aa-event" id="event-capability:9"><time datetime="2026-11-23T10:15:00.000Z">');
      expect(html, l).toContain(`<span class="aa-actor">${esc(t(l, 'aaActivity.actor.team'))}</span><p class="aa-what">`);
      expect(html, l).toContain('<span class="aa-actor">Lily</span>');
      expect(html.match(/class="aa-body"><span class="aa-actor">[^<]+<\/span><p class="aa-what">[^<]+<\/p><a href="\/app\/inbox\//g), l).toHaveLength(1);
      expect(html, l).not.toContain('<article class="aa-event"');
    }
    expect(area).toContain('.aa-event{display:grid;grid-template-columns:4.5rem minmax(0,1fr);');
    expect(area).not.toContain('.aa-event{padding-block:var(--space-24);');
  });

  it('filters above the list, the current one marked; the pages above and below, keeping the filter', () => {
    for (const l of LOCALES) {
      const html = render(l, 'checks');
      expect(html, l).toContain(`<nav class="aa-filter" aria-label="${esc(t(l, 'aaActivity.filter.label'))}">`);
      for (const k of ['all', 'sending', 'checks', 'edits']) expect(html, l).toContain(`>${esc(t(l, `aaActivity.filter.${k}` as MessageKey))}</a>`);
      expect(html, l).toContain(`<a href="/app/assistant/activity?show=checks" aria-current="page">`);
      expect(html, l).toContain('<a href="/app/assistant/activity">');
      expect(at(html, 'aa-filter'), l).toBeLessThan(at(html, 'aa-pager-above'));
      expect(at(html, 'aa-pager-above'), l).toBeLessThan(at(html, 'class="aa-event"'));
      expect(at(html, 'aa-pager-below'), l).toBeGreaterThan(html.lastIndexOf('class="aa-event"'));
      expect(html, l).toContain('href="/app/assistant/activity?show=checks&amp;page=1"');
      expect(render(l), l).toContain('href="/app/assistant/activity?page=1"');
    }
    // nothing to page: no pages above an empty list; the empty sentence stays
    const none = render('en', 'all', { rows: [], total: 0, page: 1, pageSize: 50, from: 0, to: 0, next: null, prev: null });
    expect(none).not.toContain('aa-pager-above');
    expect(none).toContain(esc(t('en', 'assistantArea.activityEmpty')));
    expect(area).toContain('.aa-filter a{display:flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;');
    expect(area).toContain('.aa-pager a{min-height:44px;min-width:44px;');
  });

  it('every new label is in all five catalogues, the French its own', () => {
    for (const k of ['aaActivity.filter.label', 'aaActivity.filter.all', 'aaActivity.filter.sending', 'aaActivity.filter.checks', 'aaActivity.filter.edits', 'aaActivity.actor.team'] as MessageKey[]) {
      for (const l of LOCALES) expect(t(l, k), `${l} ${k}`).not.toBe('');
      expect(t('fr', k)).not.toBe(t('en', k));
    }
  });
});
