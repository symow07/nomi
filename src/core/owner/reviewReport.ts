import { TERM } from './vocabulary.js';
import { MARK } from './tokens.js';
import { joinLines, joinSections } from './components.js';
import type { ComputedReview, ReviewStats } from '../trust/review.js';

/**
 * M5 — 员工月报 (and the day-7 员工周报). One page, three minutes, no vanity:
 * every line either helps the owner decide, understand, or trust. The
 * outcome sentence comes from review.ts — the renderer cannot invent one.
 */

export function renderMonthlyReview(input: {
  readonly employeeName: string;
  readonly monthZh: string;                  // e.g. 7月
  readonly stats: ReviewStats;
  readonly computed: ComputedReview;
  /** M7 knowledge counter — accumulation visible (knowledgeLineZh/DeltaZh). */
  readonly knowledgeZh?: string | null;
  readonly knowledgeDeltaZh?: string | null;
}): string {
  const s = input.stats;
  const c = input.computed;
  const hours = Math.round(c.minutesSavedEstimate / 60);

  const numbers = joinLines([
    `接待 ${s.conversations} 个${TERM.inquiry} ｜ ${TERM.quote} ${s.quotes} 次`,
    `你${TERM.approval} ${s.draftsApproved} 次 ｜ 改了 ${s.draftsEdited} 次`,
    `独立处理 ${s.autoReplies} 次（含${TERM.nightShift} ${s.nightShiftHandled} 次）`,
    s.ordersProgressed > 0 ? `${TERM.order}推进 ${s.ordersProgressed} 单` : null,
  ]);

  const quality = joinLines([
    `${TERM.spotCheck}：通过 ${s.spotChecksPassed} 次` +
      (s.spotChecksFailed > 0 ? `，要改 ${s.spotChecksFailed} 次` : ''),
    s.repairsOpened > 0
      ? `问题与${TERM.repair}：${s.repairsOpened} 起，已完成 ${s.repairsClosed} 起`
      : `问题与${TERM.repair}：0 起`,
    `新学 ${s.trainingExamplesAdded} 条你的说法`,
  ]);

  const authority = (s.capabilitiesPromoted.length || s.capabilitiesLimited.length)
    ? joinLines([
        ...s.capabilitiesPromoted.map((z) => `${MARK.ok} 「${z}」${TERM.promotion}`),
        ...s.capabilitiesLimited.map((z) => `${MARK.warn} 「${z}」已${TERM.revoke}，等新${TERM.spotCheck}`),
      ])
    : null;

  const value = joinLines([
    `给你省下约 ${hours} 小时（按每条 3 分钟估算）`,
    c.improving === true ? '修改率比上月低——更顺手了' :
    c.improving === false ? '修改率比上月高——下月重点培训' : null,
  ]);

  const nextMonth = joinLines([
    `下月建议：`,
    `· 还要你看的：${c.supervisionFocusZh}`,
  ]);

  const knowledge = (input.knowledgeZh || input.knowledgeDeltaZh)
    ? joinLines([input.knowledgeZh ?? null, input.knowledgeDeltaZh ?? null])
    : null;

  return joinSections([
    `【${input.employeeName} · ${input.monthZh}${TERM.monthlyReview}】`,
    numbers, quality, knowledge, authority, value, nextMonth,
    `结论：${c.outcome}`,
  ]);
}

/** Day-7 weekly summary — the close of the first-week journey. */
export function renderWeeklySummary(input: {
  readonly employeeName: string;
  readonly handled: number;
  readonly approved: number;
  readonly edited: number;
  readonly learnedZh: readonly string[];     // max 2 shown
  readonly stillSupervisedZh: string;
  readonly suggestedNextZh: string;          // e.g. 「接待问候」快到晋升标准了
}): string {
  return joinSections([
    `【${input.employeeName} · ${TERM.weeklyReport}】第一周`,
    joinLines([
      `处理 ${input.handled} 条，你${TERM.approval} ${input.approved} 次，改了 ${input.edited} 次`,
      ...input.learnedZh.slice(0, 2).map((l) => `学会了：${l}`),
    ]),
    `仍需${TERM.approval}：${input.stillSupervisedZh}`,
    `下一步：${input.suggestedNextZh}`,
  ]);
}
