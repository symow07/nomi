import { describe, it, expect } from 'vitest';
import { STATUS, TERM, BANNED_OWNER_TERMS, capabilityStatus, unitZh } from '../../src/core/owner/vocabulary.js';
import { formatRmb, formatUsd, formatQtyZh, formatDateZh, formatWhenZh } from '../../src/core/owner/format.js';
import { renderDailyDigest, type DigestInput } from '../../src/core/owner/digest.js';
import { notifyRoute, renderPush, OWNER_PROBLEM, type OwnerEvent } from '../../src/core/owner/notifications.js';
import { renderConversation } from '../../src/core/owner/conversation.js';
import { renderQuoteCard, renderApprovalCard } from '../../src/core/conversation/cards.js';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { product, tiers, policy } from './fixtures.js';

/* Shared fixtures — every owner surface rendered once, scanned everywhere. */
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

const digest = renderDailyDigest({
  employeeName: '小雅', date: NOW, now: NOW,
  stats: { conversations: 12, handled: 9, quotes: 3, orders: 1, orderValueUsd: 7300 },
  highlight: { buyerName: 'Ahmed', countryZh: '阿联酋', what: '谈到了2万个的报价，等他确认', at: new Date('2026-07-16T19:40:00Z') },
  pending: [
    { buyerName: 'Sara', what: '想要样品，等你审批回复' },
    { buyerName: 'Ivan', what: '问定制印刷，等你审批报价' },
  ],
  onDutyTonightZh: '接待问候、了解需求（新买家）',
} satisfies DigestInput);

const conversation = renderConversation({
  buyerName: 'Ahmed', countryZh: '阿联酋', employeeName: '小雅', now: NOW,
  messages: [
    { direction: 'inbound', text: 'Can you quote 20000 pcs?', textZh: '能报2万个的价吗？', at: new Date('2026-07-16T19:35:00Z'), sentBy: null },
    { direction: 'outbound', text: 'For 20,000 pcs: $0.38/pc FOB Ningbo.', textZh: '2万个：单价0.38美元，FOB宁波。', at: new Date('2026-07-16T19:41:00Z'), sentBy: 'employee' },
    { direction: 'outbound', text: '兄弟，最低0.37，看你要不要', textZh: null, at: new Date('2026-07-17T02:10:00Z'), sentBy: 'owner' },
  ],
});

const pushes = [
  renderPush({ kind: 'draft_waiting', buyerName: 'Ahmed', whatZh: '问2万个的价格' }, '小雅'),
  renderPush({ kind: 'handoff', buyerName: 'Sara' }, '小雅'),
  renderPush({ kind: 'quote_approval', buyerName: 'Ivan' }, '小雅'),
].filter((p): p is string => p !== null);

const problems = [
  OWNER_PROBLEM.whatsappReconnect('小雅'),
  OWNER_PROBLEM.sendDelayed('Ahmed'),
  OWNER_PROBLEM.needManualReply('Ahmed', '小雅'),
];

/** Every string WE author for the owner. Buyer-authored text is exempt. */
const OWNER_SURFACES: Record<string, string> = {
  quoteCard, approvalCard, digest, conversation,
  pushes: pushes.join('\n'), problems: problems.join('\n'),
};

/* ── M1: zero technical strings, glossary locked ─────────────────────────── */
describe('M1 · locked vocabulary and zero technical language', () => {
  for (const [name, text] of Object.entries(OWNER_SURFACES)) {
    it(`${name}: contains no banned term`, () => {
      const lower = text.toLowerCase();
      for (const banned of BANNED_OWNER_TERMS) {
        const needle = banned.toLowerCase();
        // Latin terms match whole-word to avoid false hits inside product text
        const hit = /^[a-z ]+$/.test(needle)
          ? new RegExp(`\\b${needle}\\b`).test(lower)
          : lower.includes(needle);
        expect(hit, `"${banned}" found in ${name}`).toBe(false);
      }
    });
  }

  it('the five canonical statuses are exactly the spec strings', () => {
    expect(Object.values(STATUS)).toEqual(['已处理', '等你审批', '学习中', '已晋升', '夜班中']);
  });

  it('capability status maps to canonical labels only', () => {
    expect(capabilityStatus('draft', false)).toBe('学习中');
    expect(capabilityStatus('auto', false)).toBe('已晋升');
    expect(capabilityStatus('auto', true)).toBe('夜班中');
  });

  it('glossary terms appear where they should (审批 in cards, 夜班 in digest)', () => {
    expect(approvalCard).toContain('发送');
    expect(digest).toContain(TERM.nightShift);
    expect(digest).toContain(STATUS.waitingForYou);
    expect(digest).toContain(TERM.dailySummary);
  });
});

/* ── M1: Chinese business formats ────────────────────────────────────────── */
describe('M1 · ￥, 万, GMT+8', () => {
  it('currency', () => {
    expect(formatRmb(1234.5)).toBe('￥1,234.50');
    expect(formatUsd(7300)).toBe('$7,300.00');
    expect(digest).toContain('$7,300）'); // digest money: whole dollars, no cents
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

/* ── M1: thumb-perfect budgets (the mobile audit, enforced) ──────────────── */
describe('M1 · one screen, one thumb', () => {
  const width = (line: string): number =>
    [...line].reduce((w, ch) => w + ((ch.codePointAt(0) ?? 0) > 0xff ? 2 : 1), 0);

  it('digest reads in ≤10 seconds: ≤16 lines, no line wider than a phone', () => {
    const lines = digest.split('\n');
    expect(lines.length).toBeLessThanOrEqual(16);
    for (const l of lines) expect(width(l), l).toBeLessThanOrEqual(48);
  });

  it('approval card (with quote card) fits one screen: ≤24 lines', () => {
    expect(approvalCard.split('\n').length).toBeLessThanOrEqual(24);
  });

  it('pushes fit a lock screen: single line, ≤60 columns', () => {
    for (const p of pushes) {
      expect(p.includes('\n')).toBe(false);
      expect(width(p), p).toBeLessThanOrEqual(60);
    }
  });

  it('digest shows max 3 pending items and summarizes the rest', () => {
    const many = renderDailyDigest({
      employeeName: '小雅', date: NOW, now: NOW,
      stats: { conversations: 30, handled: 20, quotes: 0, orders: 0, orderValueUsd: 0 },
      highlight: null,
      pending: Array.from({ length: 7 }, (_, i) => ({ buyerName: `买家${i}`, what: '等你审批' })),
      onDutyTonightZh: null,
    });
    expect(many).toContain('……还有 4 件');
    expect(many.split('\n').filter((l) => /^\d\./.test(l)).length).toBe(3);
  });
});

/* ── M1: notification strategy ───────────────────────────────────────────── */
describe('M1 · push for needs-review, evening digest for everything else', () => {
  const cases: Array<[OwnerEvent, string]> = [
    [{ kind: 'draft_waiting', buyerName: 'A', whatZh: 'x' }, 'push_now'],
    [{ kind: 'handoff', buyerName: 'A' }, 'push_now'],
    [{ kind: 'quote_approval', buyerName: 'A' }, 'push_now'],
    [{ kind: 'message_handled' }, 'evening_digest'],
    [{ kind: 'night_activity' }, 'evening_digest'],
    [{ kind: 'hot_lead' }, 'evening_digest'],
    [{ kind: 'learning_note' }, 'evening_digest'],
    [{ kind: 'order_created' }, 'evening_digest'],
  ];
  it.each(cases)('%o → %s', (event, route) => {
    expect(notifyRoute(event)).toBe(route);
  });

  it('digest-only events can never render a push (no-spam is structural)', () => {
    expect(renderPush({ kind: 'hot_lead' }, '小雅')).toBeNull();
    expect(renderPush({ kind: 'message_handled' }, '小雅')).toBeNull();
  });

  it('quiet day leads with 一切正常', () => {
    const quiet = renderDailyDigest({
      employeeName: '小雅', date: NOW, now: NOW,
      stats: { conversations: 3, handled: 3, quotes: 0, orders: 0, orderValueUsd: 0 },
      highlight: null, pending: [], onDutyTonightZh: null,
    });
    expect(quiet).toContain('一切正常，不用管');
  });
});
