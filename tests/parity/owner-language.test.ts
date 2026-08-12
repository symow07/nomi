import { describe, it, expect } from 'vitest';
import { STATUS, TERM, BANNED_OWNER_TERMS, capabilityStatus } from '../../src/core/owner/vocabulary.js';
import { formatRmb, formatUsd, formatQtyZh, formatDateZh, formatWhenZh } from '../../src/core/owner/format.js';
import { messages, t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { renderQuoteCard, renderApprovalCard } from '../../src/core/conversation/cards.js';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { renderInboxList, renderConversationDetail } from '../../src/api/web/inbox.js';
import { renderEmployee } from '../../src/api/web/employee.js';
import { renderOperationsHome } from '../../src/api/web/operations.js';
import { renderAnalytics } from '../../src/api/web/analytics.js';
import { product, tiers, policy } from './fixtures.js';

/**
 * M1's oldest rule: nothing we say to the owner is software talk.
 *
 * M34.8 — RE-POINTED. This file used to assert that rule against
 * `renderDailyDigest`, `renderPush` and `renderConversation`: three text-card
 * renderers superseded by the web app in Phase A–F and reachable from no
 * production entrypoint. The rule was being enforced against text no owner
 * would ever read, while the surfaces she DOES read were covered only where
 * some other test happened to look. Deleting those modules first would have
 * removed the product's oldest invariant with a green suite — the disease
 * applied to its own cure — so the rule moved first and the modules go next.
 *
 * It now binds two things instead of six fixtures:
 *   1. the ENTIRE i18n catalogue, in all three locales — every owner-facing
 *      string this product can emit, which is strictly more than any set of
 *      rendered examples could ever be; and
 *   2. the live rendered surfaces, which catches copy hardcoded into a page
 *      instead of going through the catalogue.
 *
 * The vocabulary, the number formats and the quote/approval cards are asserted
 * exactly as before: those modules are reachable and were never in question.
 */

const NOW = new Date('2026-07-17T11:30:00Z'); // 19:30 Beijing

const quote = (() => {
  const r = computeQuote({ product: product(), tiers: tiers(), policy: policy(), rules: [], quantity: 20000 });
  if (!r.ok) throw new Error('fixture');
  return r.value;
})();

const quoteCard = renderQuoteCard(quote, product().name);

const approvalCard = renderApprovalCard({
  buyerName: 'Ahmed', buyerCountryHint: '阿联酋', isReturning: true,
  buyerMessage: 'Can you do 20000 pcs FOB Ningbo?', buyerMessageZh: '能做2万个FOB宁波吗？',
  draft: 'Yes — for 20,000 pcs the unit price is $0.38 FOB Ningbo.',
  draftZh: '可以，2万个单价0.38美元，FOB宁波。',
  whyLineZh: '买家问大货价；按你的价格表第三档计算。',
  quoteCard,
});

/** Whole-word for Latin terms, substring for CJK — unchanged from M1. */
const containsBanned = (text: string, banned: string): boolean => {
  const needle = banned.toLowerCase();
  const lower = text.toLowerCase();
  return /^[a-z ]+$/.test(needle)
    ? new RegExp(`\\b${needle}\\b`).test(lower)
    : lower.includes(needle);
};

/* ── the rule, over every string we can say ──────────────────────────────── */

describe('M1 · no owner-facing string is software talk (the whole catalogue)', () => {
  for (const locale of LOCALES) {
    it(`${locale}: no message in the catalogue contains a banned term`, () => {
      const table = messages[locale];
      for (const [key, value] of Object.entries(table)) {
        for (const banned of BANNED_OWNER_TERMS) {
          expect(containsBanned(value, banned), `"${banned}" in ${locale} ${key}: "${value}"`).toBe(false);
        }
      }
    });
  }

  it('the catalogue is complete — no locale falls back to English by omission', () => {
    const keys = Object.keys(messages.en) as MessageKey[];
    for (const locale of LOCALES) {
      for (const k of keys) {
        expect(messages[locale][k], `${locale} is missing ${k}`).toBeTruthy();
      }
    }
  });
});

/* ── the rule, over what the surfaces actually render ────────────────────── */

const emptyOps = renderOperationsHome({
  range: 'today',
  attention: { pendingApprovals: 2, handoffs: 1, ownerHandling: 0, blockedMessages: 1 },
  hasAttention: true,
  activity: { handled: 9, draftsCreated: 3, corrections: 1 },
  knowledge: { openGaps: 2, recentCorrections: 1, recentlyTaught: 4 },
  channel: { provider: 'meta', status: 'connected' },
}, 'zh');

const inboxList = renderInboxList({
  filter: 'all', waitingCount: 2, blockedCount: 1,
  conversations: [{
    conversationId: 'c1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
    needsAction: true, ownership: 'AI', awaitingReview: true, handoffReason: null,
    latestMessage: 'Can you quote 20000 pcs?', latestAt: NOW,
    product: { name: 'Canvas tote', nameZh: '帆布袋' }, quantity: 20000, unitPriceUsd: 0.38,
  }],
}, 'zh', NOW);

const conversationDetail = renderConversationDetail({
  conversationId: 'c1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
  product: { name: 'Canvas tote', nameZh: '帆布袋' }, quantity: 20000, quote: null, order: null,
  messages: [{ direction: 'inbound', text: 'Can you quote 20000 pcs?', at: NOW }],
  pendingDraft: { draftId: 'd1', draftText: 'For 20,000 pcs: $0.38/pc FOB Ningbo.', capability: 'quote' },
  ownership: 'AI', refusals: [], handoffReasons: [], unheardReason: null,
  lastHumanAction: null, knowledgeUsed: [],
}, 'zh', NOW, null);

const analytics = renderAnalytics({
  range: 'month', hasActivity: true,
  summary: { newClients: 4, activeConvos: 12, quotes: 3, orders: 1 },
  activity: { inbound: 12, replied: 9, waiting: 2 },
  commerce: { quotes: 3, orders: 1, deals: [{ status: 'confirmed', n: 1 }], totalValueUsd: 7300 },
  employee: { handled: 9, waiting: 2, edits: 1 },
}, 'zh');

/**
 * A rendered page carries markup and a stylesheet; neither is read by the
 * owner. Strip both before scanning, or `<html lang=…>` and a CSS class fail a
 * vocabulary rule about human words.
 */
const ownerReads = (html: string): string =>
  html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]*>/g, ' ');

const employee = renderEmployee({
  hireDate: NOW, knows: 14, stage: 'probation',
  canDo: [], needConfirm: ['quote', 'negotiate'],
  capabilities: [{ capability: 'quote', mode: 'draft', promotable: true }],
  growth: [{ kind: 'spotcheck_pass', capability: null, at: NOW }],
  promoted: false,
  conditions: [{ cond: 'passed_spotcheck', met: true }, { cond: 'learned_correction', met: false }],
  spotChecks: [{
    id: 's1', capability: 'quote', conversationId: 'c1', askedAt: NOW,
    buyerMessage: 'Can you quote 20000 pcs?',
    reply: 'For 20,000 pcs: $0.38/pc FOB Ningbo.',
  }],
}, 'zh', null);

const LIVE_SURFACES: Record<string, string> = {
  employee,
  operations: emptyOps,
  inboxList,
  conversationDetail,
  analytics,
  quoteCard,          // still reachable: core/conversation/cards.ts
  approvalCard,
};

describe('M1 · no live surface renders software talk', () => {
  for (const [name, html] of Object.entries(LIVE_SURFACES)) {
    it(`${name}: contains no banned term`, () => {
      const text = ownerReads(html);
      for (const banned of BANNED_OWNER_TERMS) {
        expect(containsBanned(text, banned), `"${banned}" found in ${name}`).toBe(false);
      }
    });
  }
});

/* ── the owner alerts (P3): the live replacement for renderPush ──────────── */

describe('M1 · an owner alert fits a lock screen and exists in every language', () => {
  /**
   * `renderPush` and its routing table lived in the deleted notifications.ts.
   * The live path is `pipeline/notify.ts`: a language-NEUTRAL alert code on the
   * queue, localized by `t()` at delivery. The KIND LIST IS THE WIRE TYPE'S —
   * transcribing it here is the bug this repo keeps paying for, so it is
   * derived from the notify copy keys instead.
   *
   * The routing rule the old test asserted (hot_lead → digest, never a push) is
   * NOT carried over, because the live product does push hot_lead: `alertKindFor`
   * returns it and the notify consumer sends it. Porting a rule the product no
   * longer follows would be inventing coverage, not preserving it.
   */
  const ALERT_KEYS = (Object.keys(messages.en) as MessageKey[])
    .filter((k) => k.startsWith('notify.'));

  /**
   * NOT CARRIED OVER: the old "≤60 columns" budget. That was a phone LOCK
   * SCREEN measurement for `renderPush`, and the live alert is a WhatsApp
   * message to the owner — a channel with no such limit. `notify.hot_lead` is
   * 71 columns in English today and is perfectly fine as a message.
   *
   * Transplanting the number would have invented a rule the product never
   * adopted; raising it to 72 to make the copy pass would have been choosing
   * the budget to fit the text. Neither is coverage. Whether an owner alert
   * deserves a length budget on WhatsApp is an open product question, flagged
   * rather than answered here.
   */
  it('there is at least one alert, and every one of them is a single line', () => {
    expect(ALERT_KEYS.length).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      for (const k of ALERT_KEYS) {
        const s = t(locale, k, { name: '小雅', buyer: 'Ahmed' });
        expect(s.includes('\n'), `${locale} ${k} wraps`).toBe(false);
        expect(s.trim().length, `${locale} ${k} is empty`).toBeGreaterThan(4);
      }
    }
  });

  it('an alert never leaves a placeholder unfilled', () => {
    for (const locale of LOCALES) {
      for (const k of ALERT_KEYS) {
        expect(t(locale, k, { name: '小雅', buyer: 'Ahmed' })).not.toContain('{');
      }
    }
  });
});

/* ── M1: vocabulary, unchanged (vocabulary.ts is reachable) ──────────────── */
describe('M1 · locked vocabulary', () => {
  it('the five canonical statuses are exactly the spec strings', () => {
    expect(Object.values(STATUS)).toEqual(['已处理', '等你审批', '学习中', '已晋升', '夜班中']);
  });

  it('capability status maps to canonical labels only', () => {
    expect(capabilityStatus('draft', false)).toBe('学习中');
    expect(capabilityStatus('auto', false)).toBe('已晋升');
    expect(capabilityStatus('auto', true)).toBe('夜班中');
  });

  it('glossary terms appear where they should (发送 on the card)', () => {
    expect(approvalCard).toContain('发送');
    expect(TERM.nightShift.length).toBeGreaterThan(0);
  });
});

/* ── M1: Chinese business formats, unchanged (format.ts is reachable) ────── */
describe('M1 · ￥, 万, GMT+8', () => {
  it('currency', () => {
    expect(formatRmb(1234.5)).toBe('￥1,234.50');
    expect(formatUsd(7300)).toBe('$7,300.00');
  });
  it('万-quantities the way owners say them', () => {
    expect(formatQtyZh(5000)).toBe('5000');
    expect(formatQtyZh(12000)).toBe('1.2万');
    expect(formatQtyZh(20000)).toBe('2万');
    expect(formatQtyZh(200000)).toBe('20万');
  });
  it('dates and relative times in Beijing time', () => {
    expect(formatDateZh(NOW)).toBe('7月17日 周五');
    expect(formatWhenZh(new Date('2026-07-17T01:15:00Z'), NOW)).toBe('今天09:15');
    expect(formatWhenZh(new Date('2026-07-16T15:40:00Z'), NOW)).toBe('昨晚23:40');
  });
  it('the quote card speaks 万 and 个', () => {
    expect(quoteCard).toContain('2万 个');
    expect(quoteCard).toContain('最低起订：1000 个');
  });
});

/* ── M1: the approval card still fits one screen (cards.ts is reachable) ─── */
describe('M1 · one screen, one thumb', () => {
  it('approval card (with quote card) fits one screen: ≤24 lines', () => {
    expect(approvalCard.split('\n').length).toBeLessThanOrEqual(24);
  });
});
