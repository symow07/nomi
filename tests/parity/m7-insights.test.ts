import { describe, it, expect } from 'vitest';
import { renderDailyBrief, deriveInsights, MAX_INSIGHTS, type DailyData } from '../../src/core/insights/daily.js';
import {
  whySalesChanged, bestCountries, objectionProducts, repeatedEdits, followUpToday,
  REPEATED_EDIT_THRESHOLD,
} from '../../src/core/insights/questions.js';
import { knowledgeLineZh, knowledgeDeltaZh } from '../../src/core/trust/knowledge.js';
import { renderMonthlyReview } from '../../src/core/owner/reviewReport.js';
import { renderShareableWeekly, SHARE_MARK_ZH } from '../../src/core/owner/weeklyShare.js';
import { computeReview } from '../../src/core/trust/review.js';
import { PWA_TOKENS, MOTION_SPECS, KEYBOARD_SHORTCUTS, BOX } from '../../src/core/owner/tokens.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { textWidth } from '../../src/core/owner/components.js';
import { DEMO_MONTH_STATS } from '../../src/demo/trust.js';

const daily = (over: Partial<DailyData> = {}): DailyData => ({
  handled: 12, waitingApproval: 3,
  needFollowUp: [{ buyerName: 'Ivan', daysSilent: 3 }],
  hotLeadSilent: null, promotionReady: null, productsMissingPrice: 0, ...over,
});

/* ── Daily brief + insights: every insight ends in a tap ─────────────────── */
describe('M7 · smart insights, not dashboards', () => {
  it('the brief reads exactly like the spec line', () => {
    expect(renderDailyBrief(daily())).toBe('今天：12个已处理，3个等你审批，1个客户需要跟进');
    expect(renderDailyBrief(daily({ handled: 0, waitingApproval: 0, needFollowUp: [] })))
      .toBe('今天：0个已处理');
  });

  it('every insight carries a one-tap action — structurally', () => {
    const insights = deriveInsights(daily({
      hotLeadSilent: { buyerName: 'Ahmed', quotedUsd: 42000 },
      promotionReady: '接待问候', productsMissingPrice: 2,
    }));
    expect(insights.length).toBeLessThanOrEqual(MAX_INSIGHTS);
    for (const i of insights) {
      expect(i.action.labelZh.length).toBeGreaterThan(0);
      expect(i.lineZh.length).toBeGreaterThan(0);
    }
  });

  it('priority: money at risk beats hygiene; max three, deterministic', () => {
    const d = daily({
      hotLeadSilent: { buyerName: 'Ahmed', quotedUsd: 42000 },
      promotionReady: '接待问候', productsMissingPrice: 5,
    });
    const insights = deriveInsights(d);
    expect(insights[0]!.lineZh).toContain('Ahmed');
    expect(insights[0]!.lineZh).toContain('$42,000');
    expect(insights).toEqual(deriveInsights(d));
    expect(insights.some((i) => i.action.kind === 'fix_catalog')).toBe(false); // squeezed out by priority
  });

  it('quiet day → no manufactured insights', () => {
    expect(deriveInsights(daily({ waitingApproval: 0, needFollowUp: [] }))).toHaveLength(0);
  });
});

/* ── The five answerable questions ───────────────────────────────────────── */
describe('M7 · answerable questions', () => {
  it('why sales changed: ranked quantified drivers', () => {
    const answers = whySalesChanged(
      { inquiries: 30, quotes: 20, orders: 2, orderValueUsd: 9000, editRatio: 0.35 },
      { inquiries: 50, quotes: 25, orders: 6, orderValueUsd: 30000, editRatio: 0.15 },
    );
    expect(answers.length).toBeGreaterThanOrEqual(2);
    expect(answers.join('\n')).toContain('询盘少了40%');
    expect(answers.join('\n')).toContain('成单率降');
    expect(answers.join('\n')).toContain('你改稿变多了');
  });

  it('no single cause → says so instead of inventing one', () => {
    const flat = { inquiries: 30, quotes: 20, orders: 4, orderValueUsd: 9000, editRatio: 0.2 };
    expect(whySalesChanged(flat, { ...flat })).toEqual(['和上期差不多，没有单一原因。']);
  });

  it('best countries: conversion-ranked, small samples excluded', () => {
    const top = bestCountries([
      { countryZh: '阿联酋', inquiries: 10, orders: 4 },
      { countryZh: '俄罗斯', inquiries: 8, orders: 1 },
      { countryZh: '德国', inquiries: 1, orders: 1 },     // sample too small
    ]);
    expect(top[0]).toContain('阿联酋');
    expect(top[0]).toContain('40%');
    expect(top.join('')).not.toContain('德国');
  });

  it('objection products: silence + price pushback per quote', () => {
    const bad = objectionProducts([
      { productNameZh: '保温杯', quoted: 10, wentSilent: 4, priceObjections: 3 },
      { productNameZh: '帆布袋', quoted: 12, wentSilent: 1, priceObjections: 0 },
      { productNameZh: '灯串', quoted: 2, wentSilent: 2, priceObjections: 0 },   // too few
    ]);
    expect(bad[0]).toContain('保温杯');
    expect(bad[0]).toContain('3次嫌贵');
    expect(bad.join('')).not.toContain('灯串');
  });

  it('repeated edits become rule suggestions at the threshold', () => {
    expect(REPEATED_EDIT_THRESHOLD).toBe(3);
    const s = repeatedEdits([
      { topicZh: '付款条件', count: 4 },
      { topicZh: '问候语', count: 2 },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0]).toContain('「付款条件」你改了4次');
    expect(s[0]).toContain('定成规矩');
  });

  it('follow up today: open quotes first, handed-off buyers never listed', () => {
    const list = followUpToday([
      { buyerName: 'Ivan', daysSilent: 5, hasOpenQuote: false, handedOff: false },
      { buyerName: 'Ahmed', daysSilent: 3, hasOpenQuote: true, handedOff: false },
      { buyerName: 'Sara', daysSilent: 9, hasOpenQuote: true, handedOff: true },
      { buyerName: 'Omar', daysSilent: 1, hasOpenQuote: false, handedOff: false },
    ]);
    expect(list.map((l) => l.buyerName)).toEqual(['Ahmed', 'Ivan']);
    expect(list[0]!.whyZh).toContain('拿了报价');
  });
});

/* ── Knowledge counter ───────────────────────────────────────────────────── */
describe('M7 · knowledge counter', () => {
  const now = { products: 340, buyers: 85, corrections: 210, rules: 12 };

  it('reads like the spec: products, buyers, corrections', () => {
    const line = knowledgeLineZh('小雅', now);
    expect(line).toContain('340 个产品');
    expect(line).toContain('85 位买家');
    expect(line).toContain('你的 210 条改法');
    expect(line).toContain('12 条规矩');
  });

  it('delta shows growth only — no growth, no line', () => {
    expect(knowledgeDeltaZh(now, { products: 320, buyers: 80, corrections: 200, rules: 12 }))
      .toBe('这个月：新认识 20 个产品、5 位买家、新记住 10 条改法');
    expect(knowledgeDeltaZh(now, now)).toBeNull();
  });

  it('appears in the monthly review between quality and authority', () => {
    const review = renderMonthlyReview({
      employeeName: '小雅', monthZh: '7月',
      stats: DEMO_MONTH_STATS, computed: computeReview(DEMO_MONTH_STATS),
      knowledgeZh: knowledgeLineZh('小雅', now),
      knowledgeDeltaZh: knowledgeDeltaZh(now, { products: 320, buyers: 80, corrections: 200, rules: 12 }),
    });
    expect(review).toContain('340 个产品');
    expect(review).toContain('这个月：新认识 20 个产品');
    expect(review.split('\n').length).toBeLessThanOrEqual(30);
  });
});

/* ── Shareable weekly card ───────────────────────────────────────────────── */
describe('M7 · shareable 员工周报', () => {
  const card = renderShareableWeekly({
    employeeName: '小雅', avatar: '👩‍💼', weekZh: '7月13日–7月19日',
    conversations: 47, nightShiftHandled: 9, quotes: 14, orderValueUsd: 7300,
    highlightZh: '凌晨2点接住了俄罗斯买家的询盘',
    knowledgeZh: knowledgeLineZh('小雅', { products: 12, buyers: 6, corrections: 9, rules: 2 }),
  });

  it('uses the box grammar and carries the referral mark', () => {
    expect(card.split('\n')[0]).toBe(BOX.top('👩‍💼 小雅的一周'));
    expect(card).toContain(SHARE_MARK_ZH);
    expect(SHARE_MARK_ZH).toContain('YiwuFlow');
  });

  it('brags honestly: real numbers, one story, zero-value lines omitted', () => {
    expect(card).toContain('接待 47 个询盘');
    expect(card).toContain('夜班独立接待 9 次');
    expect(card).toContain('$7,300');
    expect(card).toContain('凌晨2点');
    const zeroOrders = renderShareableWeekly({
      employeeName: '小雅', avatar: '👩‍💼', weekZh: 'x', conversations: 5,
      nightShiftHandled: 0, quotes: 2, orderValueUsd: 0, highlightZh: 'y', knowledgeZh: null,
    });
    expect(zeroOrders).not.toContain('谈成');
    expect(zeroOrders).not.toContain('夜班');
  });

  it('passes the owner test: banned terms + screenshot-width lines', () => {
    const lower = card.toLowerCase();
    for (const banned of BANNED_OWNER_TERMS) {
      const needle = banned.toLowerCase();
      const hit = /^[a-z ]+$/.test(needle)
        ? new RegExp(`\\b${needle}\\b`).test(lower)
        : lower.includes(needle);
      expect(hit, `"${banned}" in weekly card`).toBe(false);
    }
    for (const l of card.split('\n')) {
      if ((l.match(/[A-Za-z]/g)?.length ?? 0) >= 15) continue;
      expect(textWidth(l), l).toBeLessThanOrEqual(48);
    }
  });
});

/* ── PWA polish as data ──────────────────────────────────────────────────── */
describe('M7 · premium feel tokens', () => {
  it('dark palette mirrors light semantics key-for-key, valid hex', () => {
    expect(Object.keys(PWA_TOKENS.colorDark).sort()).toEqual(Object.keys(PWA_TOKENS.color).sort());
    for (const hex of Object.values(PWA_TOKENS.colorDark)) expect(hex).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('every micro-interaction is ≤300ms and skippable; reduced motion collapses', () => {
    for (const spec of Object.values(MOTION_SPECS)) {
      expect(spec.durationMs).toBeLessThanOrEqual(PWA_TOKENS.motionMs.max);
      expect(spec.skippable).toBe(true);
    }
  });

  it('keyboard shortcuts cover the approval flow without conflicts', () => {
    const keys = Object.values(KEYBOARD_SHORTCUTS);
    expect(new Set(keys).size).toBe(keys.length);
    expect(KEYBOARD_SHORTCUTS.approve).toBe('Enter');
  });
});

/* ── Insight surfaces pass the owner test ────────────────────────────────── */
describe('M7 · insight copy passes the owner test', () => {
  const texts = [
    renderDailyBrief(daily()),
    ...deriveInsights(daily({ hotLeadSilent: { buyerName: 'Ahmed', quotedUsd: 42000 }, promotionReady: '接待问候' }))
      .flatMap((i) => [i.lineZh, i.action.labelZh]),
    ...whySalesChanged(
      { inquiries: 30, quotes: 20, orders: 2, orderValueUsd: 9000, editRatio: 0.35 },
      { inquiries: 50, quotes: 25, orders: 6, orderValueUsd: 30000, editRatio: 0.15 }),
    ...followUpToday([{ buyerName: 'Ivan', daysSilent: 5, hasOpenQuote: true, handedOff: false }]).map((f) => f.whyZh),
  ].join('\n');

  it('no banned terms, phone-width lines', () => {
    const lower = texts.toLowerCase();
    for (const banned of BANNED_OWNER_TERMS) {
      const needle = banned.toLowerCase();
      const hit = /^[a-z ]+$/.test(needle)
        ? new RegExp(`\\b${needle}\\b`).test(lower)
        : lower.includes(needle);
      expect(hit, `"${banned}" in insights`).toBe(false);
    }
    for (const l of texts.split('\n')) expect(textWidth(l), l).toBeLessThanOrEqual(48);
  });
});
