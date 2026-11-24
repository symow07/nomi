// UI Block 6 · F30 — the knowledge lists: adding comes first, rows say type / source / status, the pages are above and
// below the list, recent changes are short with a door to the whole list. Every form the page had is kept.
import { describe, it, expect } from 'vitest';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { renderAssistantKnowledge, type KnowledgeView } from '../../src/api/web/assistantKnowledge.js';
import { renderKnowledgePeriod, type KnowledgeOps } from '../../src/api/web/knowledge-insights.js';
import { renderPageFactsForm } from '../../src/api/web/pageFacts.js';
import { ASSISTANT_AREA_CSS } from '../../src/api/web/assistantAreaStyle.js';
import { withoutIsolates } from './isolates.js';
import type { AssistantPage } from '../../src/db/assistantKnowledge.js';

const NOW = new Date('2026-11-24T08:00:00Z');
const pageOf = <T,>(rows: T[], total = rows.length): AssistantPage<T> => ({ rows, total, page: 1, pageSize: 50, from: rows.length ? 1 : 0, to: rows.length, next: total > rows.length ? 2 : null, prev: null });
const facts = Array.from({ length: 3 }, (_, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, productId: null, kind: 'faq' as const, label: `Shipping ${i}`, content: `We ship in ${i + 2} days.`, source: 'owner_confirmed' as const, createdAt: NOW }));
const products = [{ id: 'p1', name: 'Canvas tote', nameZh: null, count: 2, isActive: true }, { id: 'p2', name: 'Old mug', nameZh: null, count: 0, isActive: false }];
const readings = [{ id: 'r1', source: 'https://example.test/shipping', lineCount: 6, createdAt: NOW, decidedAt: null, written: null, replacedBy: null, state: 'pending' as const }];
const ops = (n: number): KnowledgeOps => ({ range: 'week', hasActivity: n > 0, report: { factsAdded: n, answersCorrected: 0, certsAuthorized: 0, archived: 0, commonRequests: [] }, gaps: [],
  activity: Array.from({ length: n }, (_, i) => ({ id: `a${i}`, productId: null, kind: 'faq' as const, label: `Change ${i}`, change: 'taught' as const, at: NOW })) });
const draw = (l: Locale, view: KnowledgeView, over: Record<string, unknown> = {}) => withoutIsolates(renderAssistantKnowledge(l, {
  view, q: '', state: view === 'products' ? 'active' : 'all', range: '', prefill: '', returnHref: '/app/assistant/knowledge?view=' + view, flash: null,
  gaps: '', suggestions: '', period: renderKnowledgePeriod(ops(8), l, NOW), readingForm: renderPageFactsForm(l),
  products: pageOf(products, 60), facts: pageOf(facts, 60), readings: pageOf(readings, 60), ...over,
} as Parameters<typeof renderAssistantKnowledge>[1]));

describe('UI Block 6 · F30 — the knowledge lists', () => {
  it('adding comes first: the teach form and the page reader are above the tabs and every list, in every view', () => {
    for (const l of LOCALES) for (const view of ['needs-answer', 'facts', 'products', 'readings'] as const) {
      const html = draw(l, view);
      const tabs = html.indexOf('class="ak-tabs"');
      expect(html.indexOf('action="/app/knowledge/teach"'), `${l} ${view}`).toBeGreaterThan(-1);
      expect(html.indexOf('action="/app/knowledge/teach"'), `${l} ${view}`).toBeLessThan(tabs);
      expect(html.indexOf('action="/app/knowledge/from-page"'), `${l} ${view}`).toBeLessThan(tabs);
      expect(html.indexOf('href="/app/products/add"'), `${l} ${view}`).toBeLessThan(tabs);
      expect(html.split('action="/app/knowledge/teach"').length - 1, `${l} ${view}: one teach form`).toBe(1);
      expect(html.split('id="teach"').length - 1, `${l} ${view}: #teach still lands`).toBe(1);
    }
  });

  it('a link that asks for a form opens it without a script; a prefilled question opens the teach form', () => {
    expect(draw('en', 'facts')).toMatch(/<details class="ak-add" id="add-fact">/);
    expect(draw('en', 'facts', { open: 'teach' })).toMatch(/<details class="ak-add" id="add-fact" open>/);
    expect(draw('en', 'facts', { prefill: 'Do you ship?' })).toMatch(/<details class="ak-add" id="add-fact" open>/);
    expect(draw('en', 'readings', { open: 'page' })).toMatch(/<details class="ak-add" id="add-page" open>/);
    expect(draw('en', 'readings', { readingOpen: true })).toMatch(/<details class="ak-add" id="add-page" open>/);
  });

  it('each list is rows that name their type, source and status; every fact keeps its change and archive forms', () => {
    for (const l of LOCALES) {
      const f = draw(l, 'facts');
      const rows = f.split('<li class="ak-row ak-fact"').slice(1);
      expect(rows, l).toHaveLength(3);
      for (const r of rows) {
        for (const k of ['knowledgeList.type', 'knowledgeList.source', 'knowledgeList.status'] as const) expect(r, `${l} ${k}`).toContain(`<span class="ak-k">${esc(t(l, k))}</span>`);
        expect(r).toContain(esc(t(l, 'knowledgeList.inUse')));
        expect(r).toContain('action="/app/knowledge/correct"');
        expect(r).toContain('action="/app/knowledge/archive"');
      }
      const p = draw(l, 'products');
      expect(p, l).toContain(`<span class="ak-k">${esc(t(l, 'knowledgeList.status'))}</span> <span class="ak-v">${esc(t(l, 'assistantKnowledge.inactive'))}</span>`);
      const r = draw(l, 'readings');
      expect(r, l).toContain(`<span class="ak-k">${esc(t(l, 'knowledgeList.lines'))}</span> <span class="ak-v">6</span>`);
      expect(r, l).toContain(`<span class="ak-k">${esc(t(l, 'knowledgeList.status'))}</span> <span class="ak-v">${esc(t(l, 'assistantKnowledge.pending'))}</span>`);
    }
  });

  it('the pages are above the list and below it, each a landmark of its own name', () => {
    for (const view of ['facts', 'products', 'readings'] as const) {
      const html = draw('en', view);
      const above = html.indexOf('class="aa-pager aa-pager-above"'), first = html.indexOf('class="ak-row'), below = html.indexOf('class="aa-pager aa-pager-below"');
      expect(above, view).toBeGreaterThan(-1);
      expect(above, view).toBeLessThan(first);
      expect(below, view).toBeGreaterThan(first);
      expect(html.match(/href="[^"]*page=2"/g), view).toHaveLength(2);
      expect(html).toContain(`aria-label="${esc(t('en', 'assistantArea.pagesAbove'))}"`);
      expect(html).toContain(`aria-label="${esc(t('en', 'assistantArea.pagesBelow'))}"`);
    }
  });

  it('recent changes are the newest five; the rest wait in a disclosure, and the whole list is one door away', () => {
    for (const l of LOCALES) {
      const html = draw(l, 'needs-answer');
      const first = html.split('<ul class="ki-acts">')[1]!.split('</ul>')[0]!;
      expect(first.split('<li>').length - 1, l).toBe(5);
      expect(html, l).toContain(`<details class="ki-older"><summary>${esc(t(l, 'knowledgeList.olderChanges'))}</summary>`);
      for (let i = 0; i < 8; i++) expect(html, l).toContain(`Change ${i}`);
      expect(html, l).toContain(`href="/app/assistant/knowledge?view=facts">${esc(t(l, 'knowledgeList.allFacts'))}</a>`);
    }
  });

  it('on a phone the column heads go and each cell says its own name; every new target is 44 px', () => {
    const phone = ASSISTANT_AREA_CSS.slice(ASSISTANT_AREA_CSS.indexOf('@media(max-width:650px){'));
    expect(phone).toContain('.ak-head{display:none;}');
    expect(phone).toMatch(/\.ak-k\{position:static;/);
    for (const sel of ['.ak-add>summary{', 'a.ak-name{', '.ak-row .knowledge-change>summary{', '.ki-older>summary{', '.ak-addproduct{']) {
      const rule = ASSISTANT_AREA_CSS.slice(ASSISTANT_AREA_CSS.indexOf(sel)).split('}')[0]!;
      expect(rule, sel).toContain('min-height:44px');
    }
  });
});
