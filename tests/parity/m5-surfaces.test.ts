import { describe, it, expect } from 'vitest';
import { renderJobSheet, NEVER_ALLOWED_ZH, type JobSheetInput } from '../../src/core/owner/jobSheet.js';
import { renderPersonnelFile } from '../../src/core/owner/personnelFile.js';
import {
  renderPromotionCard, renderReductionCard, renderRepairCard, renderSpotCheckCard,
} from '../../src/core/owner/trustCards.js';
import { renderMonthlyReview, renderWeeklySummary } from '../../src/core/owner/reviewReport.js';
import { renderDailyDigest } from '../../src/core/owner/digest.js';
import { notifyRoute, renderPush } from '../../src/core/owner/notifications.js';
import { BANNED_OWNER_TERMS, TERM } from '../../src/core/owner/vocabulary.js';
import { textWidth } from '../../src/core/owner/components.js';
import { computeReview } from '../../src/core/trust/review.js';
import {
  DEMO_MONTH_STATS, DEMO_PROMOTED_EVIDENCE, DEMO_REPAIR, DEMO_NOW,
} from '../../src/demo/trust.js';

const NOW = DEMO_NOW;

/* ── Fixtures: every M5 surface rendered once ────────────────────────────── */
const jobSheet = renderJobSheet({
  employeeName: '小雅', roleZh: '外贸销售助理（试用期）',
  languagesZh: ['中文', '英文', '阿拉伯文'], nightShiftWindowZh: '22:00–07:00',
  canDoZh: [{ nameZh: '接待问候', exampleZh: '回复常见产品问题' }],
  needsApprovalZh: ['报价', '谈价', '跟进客户'],
  recentChanges: [{ at: NOW, lineZh: '「接待问候」晋升' }],
  lastReviewAt: NOW, lastReviewOutcomeZh: '有进步，建议继续观察',
} satisfies JobSheetInput);

const personnelFile = renderPersonnelFile({
  employeeName: '小雅', hireDate: new Date('2026-07-09T00:00:00Z'),
  roleZh: '外贸销售助理（试用期）', trainingZh: ['产品目录 12 个产品', '价格表'],
  languagesZh: ['中文', '英文'], scheduleZh: '全天在岗，夜班 22:00–07:00',
  capabilityHistory: [{
    at: NOW, whatZh: '「接待问候」晋升',
    whyZh: '连续28次接待，25次你没改一个字',
    evidenceZh: '28次完成、25次无修改、抽查3次全过',
    canNowZh: '直接回复常见产品问题',
    stillSupervisedZh: '报价、谈价、确认订单',
  }],
  correctionsCount: 9,
  incidents: [{ at: NOW, whatZh: '交期写错15天', repairedZh: '已更正并加入培训' }],
  reviews: [{ at: NOW, outcomeZh: '有进步，建议继续观察' }],
  trendZh: '修改率连续两周下降',
});

const promotionCard = renderPromotionCard({
  employeeName: '小雅', capabilityZh: '接待问候',
  evidence: DEMO_PROMOTED_EVIDENCE, windowDays: 9,
  stillNeedsApprovalZh: ['特殊价格', '大额订单', '特殊付款条件'],
});

const reductionCard = renderReductionCard({
  employeeName: '小雅', capabilityZh: '报价', action: 'pause',
  reasonZh: '最近两次报价都需要你修改付款条件。',
  alreadyDoneZh: '我已经把这两次修改加入培训记录。',
});

const repairCard = renderRepairCard(DEMO_REPAIR, { employeeName: '小雅', buyerName: 'Ahmed' });

const spotCheckCard = renderSpotCheckCard({
  employeeName: '小雅', capabilityZh: '接待问候', buyerName: 'Ivan',
  buyerMessage: 'Do you ship to Moscow?',
  reply: 'Yes, we ship to Russia regularly. FOB Ningbo or CIF — which do you prefer?',
  replyZh: '可以发俄罗斯，问他要FOB还是CIF。',
  at: new Date(NOW.getTime() - 3600_000), now: NOW,
});

const monthlyReview = renderMonthlyReview({
  employeeName: '小雅', monthZh: '7月',
  stats: DEMO_MONTH_STATS, computed: computeReview(DEMO_MONTH_STATS),
});

const weeklySummary = renderWeeklySummary({
  employeeName: '小雅', handled: 34, approved: 28, edited: 6,
  learnedZh: ['报价先报FOB', 'Ahmed只走TT'],
  stillSupervisedZh: '报价、谈价、确认订单',
  suggestedNextZh: '「接待问候」快到晋升标准了',
});

const SURFACES: Record<string, string> = {
  jobSheet, personnelFile, promotionCard, reductionCard,
  repairCard, spotCheckCard, monthlyReview, weeklySummary,
};

/* ── Trust vocabulary + budgets on every surface ─────────────────────────── */
describe('M5 · owner test: language, budgets', () => {
  for (const [name, text] of Object.entries(SURFACES)) {
    it(`${name}: no banned terms`, () => {
      const lower = text.toLowerCase();
      for (const banned of BANNED_OWNER_TERMS) {
        const needle = banned.toLowerCase();
        const hit = /^[a-z ]+$/.test(needle)
          ? new RegExp(`\\b${needle}\\b`).test(lower)
          : lower.includes(needle);
        expect(hit, `"${banned}" in ${name}`).toBe(false);
      }
    });
    it(`${name}: authored lines fit a phone`, () => {
      for (const l of text.split('\n')) {
        // content-carrying lines (buyer text / reply) are exempt, same rule as cards
        if ((l.match(/[A-Za-z]/g)?.length ?? 0) >= 15) continue;
        expect(textWidth(l), `${name}: ${l}`).toBeLessThanOrEqual(48);
      }
    });
  }

  it('no artificial confidence language anywhere', () => {
    for (const text of Object.values(SURFACES)) {
      for (const fake of ['100%', '绝对', '放心吧', '完美', '零错误', '请相信']) {
        expect(text).not.toContain(fake);
      }
    }
  });
});

/* ── Job sheet: whole authority in under a minute ────────────────────────── */
describe('M5 · 工作职责表', () => {
  it('three groups in order: 可以直接做 → 需要你确认 → 不能做', () => {
    const a = jobSheet.indexOf('可以直接做：');
    const b = jobSheet.indexOf('需要你确认：');
    const c = jobSheet.indexOf('不能做：');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
  it('hard limits always present; short enough for one minute', () => {
    for (const n of NEVER_ALLOWED_ZH) expect(jobSheet).toContain(n);
    expect(jobSheet).toContain('遇到这些立刻找你');
    expect(jobSheet).toContain(TERM.vip);
    expect(jobSheet.split('\n').length).toBeLessThanOrEqual(32);
  });
});

/* ── Personnel file: five questions per change ───────────────────────────── */
describe('M5 · 员工档案', () => {
  it('every capability change answers what/why/evidence/now/supervised', () => {
    for (const needle of ['为什么：', '依据：', '现在：', `仍需${TERM.approval}：`]) {
      expect(personnelFile).toContain(needle);
    }
  });
  it('reads as a record: training, corrections, incidents, reviews, trend', () => {
    for (const needle of ['入职：', '完成培训：', '培训记录：', '重要事件：', '历次审查：', '近期趋势：']) {
      expect(personnelFile).toContain(needle);
    }
  });
});

/* ── Promotion & reduction: evidence visible, reversibility explicit ─────── */
describe('M5 · promotion ceremony and withdrawal', () => {
  it('promotion shows countable evidence and the remaining limits', () => {
    expect(promotionCard).toContain('通过了「接待问候」的考察');
    expect(promotionCard).toContain('完成28次');
    expect(promotionCard).toContain('25次无需修改');
    expect(promotionCard).toContain('3次修改后已学习');
    expect(promotionCard).toContain(`仍然等你${TERM.approval}`);
    expect(promotionCard).toContain(`随时${TERM.revoke}`);
  });

  it('reduction explains cause, present behavior, and the way back — no fear', () => {
    expect(reductionCard).toContain('已暂时收回');
    expect(reductionCard).toContain('原因：');
    expect(reductionCard).toContain('先等你确认');
    expect(reductionCard).toContain(`重新申请${TERM.promotion}`);
    expect(reductionCard).not.toContain('错误');   // calm, not alarming
  });
});

/* ── Repair card: three parts + honest status ────────────────────────────── */
describe('M5 · repair surface', () => {
  it('three-part grammar with containment and learning visible', () => {
    expect(repairCard).toContain('交期写成了15天');
    expect(repairCard).toContain('已加入培训：');
    expect(repairCard).toContain(`状态：${TERM.repair}完成`);
  });
});

/* ── Spot check: everything needed, one card, fast verdict ───────────────── */
describe('M5 · 抽查 card', () => {
  it('shows capability, both messages, back-translation, and the reply words', () => {
    expect(spotCheckCard).toContain(`【${TERM.spotCheck}】`);
    expect(spotCheckCard).toContain('「接待问候」');
    expect(spotCheckCard).toContain('Ivan 说：');
    expect(spotCheckCard).toContain('〔意思〕');
    expect(spotCheckCard).toContain('回复「好」通过');
  });
});

/* ── Monthly review: three minutes, an answer, no vanity ─────────────────── */
describe('M5 · 员工月报', () => {
  it('answers useful/reliable/supervise/next and ends with a fixed outcome', () => {
    expect(monthlyReview).toContain('省下约');
    expect(monthlyReview).toContain('按每条 3 分钟估算');   // labeled estimate, not a claim
    expect(monthlyReview).toContain('还要你看的：');
    expect(monthlyReview).toContain('结论：有进步，建议继续观察');
    expect(monthlyReview.split('\n').length).toBeLessThanOrEqual(28);
  });
  it('weekly summary closes the first week with learning and a next step', () => {
    expect(weeklySummary).toContain(TERM.weeklyReport);
    expect(weeklySummary).toContain('学会了：');
    expect(weeklySummary).toContain('下一步：');
  });
});

/* ── Daily trust loop: routing + digest additions within budget ──────────── */
describe('M5 · daily trust loop', () => {
  it('repairs push immediately; authority changes and spot checks wait for evening', () => {
    expect(notifyRoute({ kind: 'repair_waiting', buyerName: 'A' })).toBe('push_now');
    expect(notifyRoute({ kind: 'capability_changed' })).toBe('evening_digest');
    expect(notifyRoute({ kind: 'spot_check_ready' })).toBe('evening_digest');
    expect(renderPush({ kind: 'capability_changed' }, '小雅')).toBeNull();
    expect(renderPush({ kind: 'repair_waiting', buyerName: 'Ahmed' }, '小雅')).toContain('更正稿');
  });

  it('digest with learning + authority + night shift still fits 16 lines', () => {
    const digest = renderDailyDigest({
      employeeName: '小雅', date: NOW, now: NOW,
      stats: { conversations: 12, handled: 9, quotes: 3, orders: 1, orderValueUsd: 7300 },
      highlight: { buyerName: 'Ahmed', countryZh: '阿联酋', what: '谈到了2万个的报价', at: NOW },
      pending: [
        { buyerName: 'Sara', what: '想要样品' },
        { buyerName: 'Ivan', what: '问定制' },
        { buyerName: 'Omar', what: '问运费' },
      ],
      onDutyTonightZh: '接待问候、了解需求',
      learnedTodayZh: '报价先报FOB',
      authorityChangeZh: '「接待问候」已晋升',
    });
    expect(digest.split('\n').length).toBeLessThanOrEqual(16);
    expect(digest).toContain('学会了：报价先报FOB');
    expect(digest).toContain('「接待问候」已晋升');
  });
});
