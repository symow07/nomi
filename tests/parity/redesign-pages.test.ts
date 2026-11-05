import { describe, it, expect } from 'vitest';
import { renderCalendar, parseCalendarQuery } from '../../src/api/web/calendar.js';
import type { CalendarView } from '../../src/db/calendar.js';
import { renderGuide } from '../../src/api/web/guide.js';
import { SETUP_STEPS } from '../../src/db/setup.js';
import { renderPilotReadiness, type PilotReadiness } from '../../src/api/web/pilot.js';
import { renderSplitToday, type SplitData } from '../../src/api/web/splitToday.js';
import type { ConversationDetail } from '../../src/api/web/inbox.js';
import type { OperationsSnapshot } from '../../src/api/web/operations.js';
import { NOTHING_TODAY } from '../../src/api/web/today.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { esc } from '../../src/api/web/layout.js';
import { usd } from '../../src/core/types/money.js';

const NOW = new Date('2026-11-05T08:00:00Z');
const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';
const readiness: PilotReadiness = {
  detected: { profile: false, products: false, priceRules: false, knowledge: false, claims: false, sandbox: false, channel: false },
  attest: { backupTestedAt: null, secretsRotatedAt: null, ownerReadyAt: null, assistantNamedAt: null },
  assistantName: 'Nomi', validation: { at: null, pass: null, total: null }, backupVerifiedAt: null, readyToLaunch: false,
};
const snapshot: OperationsSnapshot = {
  range: 'today', attention: { pendingApprovals: 1, handoffs: 0, ownerHandling: 0, blockedMessages: 0 },
  activity: { handled: 0, draftsCreated: 1, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'connected', provider: 'meta', live: true }, budget: null, hasAttention: true,
};
const detail: ConversationDetail = {
  conversationId: CONVERSATION, buyer: 'Aisha', country: null, status: 'awaiting',
  product: { name: 'Bag', nameZh: null }, quantity: null,
  quote: { unitPrice: usd('2'), total: usd('20'), quantity: 10 }, order: null,
  messages: [{ direction: 'inbound', text: 'How much?', at: NOW }],
  pendingDraft: { draftId: 'draft-1', draftText: 'Ten bags are $20. <Thanks>', ownerEdit: 'My exact words & punctuation.', capability: 'quote', withheld: { reason: 'first_quote' } },
  ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null,
  lastHumanAction: null, knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null,
  proof: { quoteId: null, token: null }, channel: 'instagram',
};
const split: SplitData = {
  decision: { detail, extras: { clientId: CUSTOMER, photo: null, thumb: null } },
  sales: { kind: null, asked: 1, price: { count: 0, value: null, otherCurrency: 0 }, sample: { count: 0, open: 0 }, order: { count: 0, value: null, otherCurrency: 0 }, recent: [] },
  books: null,
};

describe('Area 1 working page controls', () => {
  it('explains which quotes and orders are excluded from the displayed currency totals', () => {
    const data: SplitData = { ...split, decision: null, sales: { ...split.sales,
      price: { count: 3, value: usd('25'), otherCurrency: 2 },
      order: { count: 2, value: usd('90'), otherCurrency: 1 },
    } };
    const html = renderSplitToday(snapshot, 'en', NOTHING_TODAY(NOW), '', data, NOW);
    expect(html).toContain('$25');
    expect(html).toContain('$90');
    expect(html).toContain('2 quotes in other currencies are counted above but excluded from the amount.');
    expect(html).toContain('1 order in another currency is counted above but excluded from the amount.');
  });

  it('shows foreign-only counts without implying a zero total, with isolated fallback copy in Arabic', () => {
    const data: SplitData = { ...split, decision: null, sales: { ...split.sales,
      price: { count: 1, value: null, otherCurrency: 1 },
      order: { count: 2, value: null, otherCurrency: 2 },
    } };
    const html = renderSplitToday(snapshot, 'ar', NOTHING_TODAY(NOW), '', data, NOW);
    expect(html).not.toContain('class="sp-val"');
    expect(html).toContain('quote in another currency');
    expect(html).toContain('orders in other currencies');
    expect(html).not.toContain('area1.sales.');
    expect(html).toContain('\u20681\u2069 quote');
    expect(html).toContain('\u20682\u2069 orders');
  });

  it('date selection needs no script, retains its filters, and can move outside the current month', () => {
    const v: CalendarView = {
      from: '2026-11-01', to: '2026-12-01', today: '2026-11-05', category: 'orders',
      buyer: { id: CUSTOMER, name: 'Aisha', country: null }, buyers: [], categories: ['orders'], entries: [],
    };
    const html = renderCalendar(v, 'en', { now: NOW });
    const form = /<form method="get" action="\/app\/calendar" class="cal-date-choice">[\s\S]*?<\/form>/.exec(html)?.[0];
    expect(form).toContain('type="date" name="day"');
    expect(form).toContain('name="category" value="orders"');
    expect(form).toContain(`name="who" value="${CUSTOMER}"`);
    expect(form).not.toContain('name="month"');
    const next = parseCalendarQuery({ day: '2027-01-14', category: 'orders', who: CUSTOMER }, NOW);
    expect(next.month).toBe('2027-01-01');
    expect(next.day).toBe('2027-01-14');
    expect(next.buyer).toBe(CUSTOMER);
    expect(html.indexOf('id="cal-list"')).toBeLessThan(html.indexOf('<details class="cal-grid"'));
  });

  it('setup composition preserves the name target and every existing owner command, with one page title', () => {
    const guide = { steps: SETUP_STEPS.map((step) => ({ step, done: false })), next: SETUP_STEPS[0]! };
    const html = '<h1>Getting started</h1>' + renderGuide(guide, 'en', 'Nomi', undefined, { embedded: true })
      + renderPilotReadiness(readiness, 'en', null, OWNER_VIEW, { embedded: true });
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html.match(/id="name"/g)).toHaveLength(1);
    expect(html).toContain('id="step-name"');
    expect(html).toContain('id="readiness"');
    for (const path of ['attest', 'assistant-name', 'validate']) expect(html).toContain(`action="/app/onboarding/${path}"`);
    const staff = renderPilotReadiness(readiness, 'en', null, { isOwner: false }, { embedded: true });
    for (const path of ['attest', 'assistant-name', 'validate']) expect(staff).not.toContain(`action="/app/onboarding/${path}"`);
  });

  it('complete setup is still readable and offers no incomplete-step action', () => {
    const html = renderGuide({ steps: SETUP_STEPS.map((step) => ({ step, done: true })), next: null }, 'en', 'Nomi');
    expect(html.match(/class="pill ok"/g)).toHaveLength(5);
    expect(html).not.toContain('data-first-step');
    expect(html).not.toContain('<video');
    expect(html).toContain('Your setup steps are complete.');
  });

  it('priority approval preserves exact words, the same command targets and the no-reply confirmation', () => {
    const html = renderSplitToday(snapshot, 'en', NOTHING_TODAY(NOW), '', split, NOW);
    expect(html.indexOf('id="approve"')).toBeLessThan(html.indexOf('class="sp-panels'));
    expect(html).toContain(`action="/app/inbox/${CONVERSATION}/act"`);
    expect(html).toContain(`formaction="/app/inbox/${CONVERSATION}/takeover"`);
    expect(html).toContain('name="command" value="send"');
    expect(html).toContain('name="command" value="不回"');
    expect(html).toContain('onclick="return confirm(this.dataset.confirm)" data-confirm=');
    expect(html).toContain(`>${esc(detail.pendingDraft!.ownerEdit! )}</textarea>`);
    expect(html).toContain(`data-keep="${CONVERSATION}:edit"`);
    expect(html).toContain('name="draftId" value="draft-1"');
    expect(html).not.toContain('id="sp-books"');
  });
});
