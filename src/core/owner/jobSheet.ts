import { TERM } from './vocabulary.js';
import { MARK } from './tokens.js';
import { joinLines, joinSections } from './components.js';
import { formatDateZh } from './format.js';

/**
 * M5 — 工作职责表: the employee's entire authority, readable in under a
 * minute. Three fixed groups (可以直接做 / 需要你确认 / 不能做) plus the
 * escalation and VIP rules. Content comes from the autonomy grants; the
 * hard limits are product constants — no capability id, mode name, or
 * anything technical ever appears.
 */

export type JobSheetInput = {
  readonly employeeName: string;
  readonly roleZh: string;                       // e.g. 外贸销售助理（试用期）
  readonly languagesZh: readonly string[];       // e.g. ['中文', '英文', '阿拉伯文']
  readonly nightShiftWindowZh: string | null;    // e.g. '22:00–07:00' — null = 无夜班
  /** Promoted capabilities with a concrete example each. */
  readonly canDoZh: readonly { readonly nameZh: string; readonly exampleZh: string }[];
  /** Capabilities still in draft mode. */
  readonly needsApprovalZh: readonly string[];
  readonly recentChanges: readonly { readonly at: Date; readonly lineZh: string }[];
  readonly lastReviewAt: Date | null;
  readonly lastReviewOutcomeZh: string | null;
};

/** Hard limits — never granted, never negotiable, shown on every sheet. */
export const NEVER_ALLOWED_ZH: readonly string[] = [
  '承诺库存',
  '修改付款账户',
  '答应未经确认的交期',
  `确认${TERM.order}（永远等你）`,
];

/** Situations that always come to the owner immediately. Price/terms cases
 * live under 需要你确认 — no duplication, the sheet stays one-minute short. */
export const ALWAYS_ESCALATE_ZH: readonly string[] = [
  '买家要找真人谈',
  '买家生气或投诉',
];

export function renderJobSheet(j: JobSheetInput): string {
  const header = joinLines([
    `【${j.employeeName} · ${TERM.jobSheet}】`,
    `职位：${j.roleZh}`,
    `语言：${j.languagesZh.join('、')} ｜ 全天在岗`,
    j.nightShiftWindowZh
      ? `${TERM.nightShift}：${j.nightShiftWindowZh} 独立接待`
      : `${TERM.nightShift}：暂未安排`,
  ]);

  const canDo = joinLines([
    '可以直接做：',
    ...(j.canDoZh.length
      ? j.canDoZh.map((c) => `${MARK.ok} ${c.nameZh}（如：${c.exampleZh}）`)
      : ['（还没有——都在学习中）']),
  ]);

  const needsApproval = joinLines([
    '需要你确认：',
    ...j.needsApprovalZh.map((n) => `· ${n}`),
    '· 低于最低价格 ｜ 大额订单',
    '· 特殊付款条件 ｜ 独家代理',
  ]);

  const never = joinLines(['不能做：', ...NEVER_ALLOWED_ZH.map((n) => `✗ ${n}`)]);

  const escalate = joinLines(['遇到这些立刻找你：', ...ALWAYS_ESCALATE_ZH.map((n) => `· ${n}`)]);

  const vip = `${TERM.vip}：报价前先给你看，不催单。`;

  const changes = j.recentChanges.length
    ? joinLines([
        '最近变化：',
        ...j.recentChanges.slice(0, 2).map((c) => `· ${formatDateZh(c.at)} ${c.lineZh}`),
      ])
    : null;

  const review = j.lastReviewAt
    ? `上次审查：${formatDateZh(j.lastReviewAt)}${j.lastReviewOutcomeZh ? `（${j.lastReviewOutcomeZh}）` : ''}`
    : null;

  return joinSections([header, canDo, needsApproval, never, escalate, vip, changes, review]);
}
