import { describe, it, expect } from 'vitest';
import { renderLabels } from '../../src/api/web/labels.js';
import { renderEarlier } from '../../src/api/web/advisor.js';
import { renderKnowledgeOps, type KnowledgeOps } from '../../src/api/web/knowledge-insights.js';
import { renderInvoices, type InvoiceListOptions } from '../../src/api/web/booksInvoices.js';
import type { BooksOverviewOptions, OverviewPage, OverviewBankLine } from '../../src/db/booksOverview.js';
import { booksPager } from '../../src/api/web/booksOverview.js';
import { renderBooksUnmatched } from '../../src/api/web/booksOverviewReports.js';
import { renderBilling, type BillingView } from '../../src/api/web/billing.js';
import { renderChannelScreen, type ChannelsData } from '../../src/api/web/channels.js';
import { shell, esc } from '../../src/api/web/layout.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { messages, t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { withoutIsolates } from './isolates.js';
import { linkedCss } from './linked-css.js';

// UI correction, Block 9 — F47 "Empty, unavailable and complete states are inconsistent". A page in one of its states
// draws it as a state of its own (stateBlock.ts): section.state[data-state=<kind>], one heading, one sentence of why,
// one next step. Each page's state has its own heading, so "nothing yet", "nothing matches", "every line is matched"
// and "not offered here" read differently; a range of "0–0 of 0" is no longer drawn under nothing. Measured in a
// browser by the harness's f47probe.mjs (36 cases: base fails 36, head 0); this file holds the markup and the words.

// a dynamic import: at the base the module is missing, and every case below fails on its own instead of the file
const SB = await import('../../src/api/web/stateBlock.js' as string).catch(() => null) as typeof import('../../src/api/web/stateBlock.js') | null;
const STATE_KINDS = SB?.STATE_KINDS ?? [];
const stateBlock: NonNullable<typeof SB>['stateBlock'] = (...a) => { if (!SB) throw new Error('no stateBlock module'); return SB.stateBlock(...a); };
const stateNext: NonNullable<typeof SB>['stateNext'] = (...a) => { if (!SB) throw new Error('no stateBlock module'); return SB.stateNext(...a); };
const NOW = new Date('2026-11-25T12:00:00Z');
const plain = (h: string) => withoutIsolates(h);
/** The state blocks a page draws: kind, heading, sentence and its next steps. */
const states = (html: string) => [...plain(html).matchAll(/<section class="state" data-state="([a-z]+)"[^>]*><h([23]) class="state-h">([^<]*)<\/h\2><p class="state-p">([^<]*)<\/p>(?:<p class="state-next">([\s\S]*?)<\/p>)?<\/section>/g)]
  .map((m) => ({ kind: m[1]!, heading: m[3]!, body: m[4]!, next: [...(m[5] ?? '').matchAll(/<(a|button)\b[^>]*>/g)].map((x) => x[0]) }));
const one = (html: string, kind: string) => {
  const s = states(html);
  expect(s.map((x) => x.kind)).toEqual([kind]);
  expect(s[0]!.heading).not.toBe('');
  expect(s[0]!.body).not.toBe(s[0]!.heading);
  expect(s[0]!.next.length).toBe(1);
  return s[0]!;
};
const quietOps: KnowledgeOps = { range: 'week', hasActivity: false, gaps: [], activity: [],
  report: { factsAdded: 0, answersCorrected: 0, certsAuthorized: 0, archived: 0, commonRequests: [] } };
const billingOff: BillingView = { configured: false, state: { billed: true, exempt: false, planId: null, status: 'none', cardSavedAt: null, trialDays: 14,
  trialStartedAt: null, trialEndsAt: null, currentPeriodEnd: null, hasCustomer: false, customersThisMonth: 0, firstChannelAt: null },
  plans: [], people: 1, assistants: 1, returned: null };
const nothing: OverviewPage<OverviewBankLine> = { rows: [], total: 0, from: 0, to: 0, page: 1, pageSize: 50, next: null, prev: null };
const noPage: NonNullable<InvoiceListOptions['page']> = { from: 0, to: 0, total: 0, next: null, prev: null };
const scope: BooksOverviewOptions = { today: '2026-11-25' };
type Who = Parameters<typeof renderInvoices>[1];
const owner: Who = { isOwner: true }, staff: Who = { isOwner: false, kind: 'accountant' };
const channels: ChannelsData = {
  whatsapp: { kind: 'whatsapp', connected: false, status: 'not_connected', healthOk: false, displayId: null, lastActivityAt: null, problem: null, activated: false },
  ownerPhone: null, templateState: 'none', outreach: new Map(), domain: null,
};

describe('F47 · a page in a state says which state, why, and the one next step', () => {
  it('the block: its kinds, one heading, one sentence, one next step; announced only for a search and a wait', () => {
    expect([...STATE_KINDS]).toEqual(['empty', 'nomatch', 'loading', 'error', 'forbidden', 'unavailable']);
    const b = stateBlock('nomatch', { heading: 'H <x>', body: 'Why', nextHtml: stateNext('/a?b=1&c=2', 'Go') });
    expect(b).toBe('<section class="state" data-state="nomatch" role="status"><h2 class="state-h">H &lt;x&gt;</h2><p class="state-p">Why</p>'
      + '<p class="state-next"><a class="deeper" href="/a?b=1&amp;c=2">Go</a></p></section>');
    expect(stateBlock('empty', { heading: 'H', body: 'W' }, { level: 3 })).toBe('<section class="state" data-state="empty"><h3 class="state-h">H</h3><p class="state-p">W</p></section>');
    expect(stateBlock('loading', { heading: 'H', body: 'W' })).toContain('role="status"');
  });

  it('the pages: each state drawn as its own, in every language', () => {
    for (const l of LOCALES) {
      const labels = one(renderLabels(l, []), 'empty');
      expect(labels.heading, l).toBe(esc(t(l, 'state.labels.h' as MessageKey)));
      expect(labels.next[0], l).toContain('href="/app/customers"');
      expect(one(renderEarlier(l, []), 'empty').next[0], l).toContain('href="/app/assistant/ask"');
      const gaps = one(renderKnowledgeOps(quietOps, l, NOW), 'empty');
      expect(gaps.next[0], l).toContain('href="/app/assistant/knowledge?open=teach"');
      // the pinned sentence is the reason (knowledge-ops-web, p9-products-knowledge)
      expect(gaps.body, l).toBe(esc(t(l, 'knowledge.ops.noQuestions', { period: t(l, 'knowledge.ops.period.week') })));
      expect(one(renderInvoices(l, owner, []), 'empty').next[0], l).toContain('href="/app/books/invoices/new"');
      expect(one(renderInvoices(l, staff, []), 'empty').next[0], l).toContain('href="/app/books"');
      const none = one(renderInvoices(l, owner, [], { q: 'zzz', page: noPage }), 'nomatch');
      expect(none.next[0], l).toContain('href="/app/books/invoices"');
      expect(one(renderBooksUnmatched(l, scope, nothing), 'empty').next[0], l).toContain('href="/app/books/bank"');
      const bill = renderBilling(billingOff, l, null, 'Back');
      expect(one(bill, 'unavailable').next[0], l).toContain('href="/app/settings/setup"');
      // the lede still says payments are off; the rows still say what is charged (w5-settings-a, phase9-inbox-settings)
      expect(plain(bill), l).toMatch(/<\/h1>\s*<p class="lede">/);
      expect(plain(bill), l).toContain(esc(t(l, 'billing.value.nothing')));
      for (const screen of ['telegram', 'tiktok', 'chat'] as const) {
        const ch = one(renderChannelScreen(screen, channels, l, null, OWNER_VIEW, {}), 'unavailable');
        expect(ch.next[0], `${l} ${screen}`).toContain('href="/app/settings/channels"');
      }
    }
  });

  it('two different states never share a heading, in any language', () => {
    const KINDS: Record<string, string> = {
      'state.labels.h': 'empty', 'state.advisor.h': 'empty', 'state.gaps.h': 'empty', 'state.invoices.h': 'empty', 'state.bank.h': 'empty',
      'state.invoices.none.h': 'nomatch', 'state.report.h': 'nomatch', 'state.billing.h': 'unavailable', 'state.channel.h': 'unavailable',
    };
    for (const l of LOCALES) {
      const seen = new Map<string, string>();
      for (const [k, kind] of Object.entries(KINDS)) {
        const h = t(l, k as MessageKey);
        expect((messages[l] as Record<string, string>)[k], `${l} ${k} has words`).toBe(h);
        expect(seen.get(h), `${l} ${k}`).toBeUndefined();
        seen.set(h, kind);
      }
      // and none is the same words as the page's error, not-found or refusal
      for (const other of ['error.crash.title', 'error.notfound.title', 'staff.notAllowed'] as MessageKey[]) expect(seen.has(t(l, other)), `${l} ${other}`).toBe(false);
    }
  });

  it('every state word is in all five catalogues, and none falls back to English', () => {
    const keys = Object.keys(messages.en).filter((k) => k.startsWith('state.'));
    expect(keys.length).toBe(20);
    for (const l of LOCALES) for (const k of keys) {
      expect((messages[l] as Record<string, string>)[k], `${l} ${k}`).toBeTruthy();
      if (l !== 'en') expect((messages[l] as Record<string, string>)[k], `${l} ${k}`).not.toBe((messages.en as Record<string, string>)[k]);
    }
  });

  it('a range of "0–0 of 0" is not drawn under nothing', () => {
    expect(booksPager('en', { from: 0, to: 0, total: 0, next: null, prev: null }, () => '/x')).toBe('');
    expect(booksPager('en', { from: 1, to: 1, total: 1, next: null, prev: null }, () => '/x')).toContain('class="ba-pager"');
    for (const l of LOCALES) expect(plain(renderInvoices(l, owner, [], { q: 'zzz', page: noPage })), l).not.toContain('bd-pager');
  });

  it('each kind carries a mark of its own shape, so the kinds differ by more than colour', () => {
    const css = linkedCss(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
    expect(STATE_KINDS.length).toBe(6);
    const marks = STATE_KINDS.map((k) => (css.match(new RegExp(`\\.state\\[data-state="${k}"\\] \\.state-h::before\\{([^}]*)\\}`)) ?? [])[1] ?? '');
    for (const [i, m] of marks.entries()) expect(m, STATE_KINDS[i]).not.toBe('');
    expect(new Set(marks).size).toBe(STATE_KINDS.length);
    expect(css).toContain('.state-next a,.state-next button{min-block-size:44px;');
  });
});
