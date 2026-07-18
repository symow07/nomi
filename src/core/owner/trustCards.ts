import { TERM } from './vocabulary.js';
import { MARK } from './tokens.js';
import { joinLines, joinSections } from './components.js';
import { formatWhenZh } from './format.js';
import type { CapabilityEvidence, DemotionAction } from '../trust/evidence.js';
import type { RepairRecord } from '../trust/repair.js';
import { nextRepairStep } from '../trust/repair.js';

/**
 * M5 — The trust ceremony cards: promotion, reduction, repair, spot check.
 * Earned, visible, understandable, reversible — and never frightening,
 * never technical, never overclaiming.
 */

/** ── Promotion (晋升) ────────────────────────────────────────────────────── */

export function renderPromotionCard(input: {
  readonly employeeName: string;
  readonly capabilityZh: string;
  readonly evidence: CapabilityEvidence;
  readonly windowDays: number;
  readonly stillNeedsApprovalZh: readonly string[];
}): string {
  const e = input.evidence;
  const learned = e.edited > 0 ? `${MARK.ok} ${e.edited}次修改后已学习` : null;
  return joinSections([
    `${input.employeeName}通过了「${input.capabilityZh}」的考察`,
    joinLines([
      `过去${input.windowDays}天：`,
      `${MARK.ok} 完成${e.handled}次${input.capabilityZh}`,
      `${MARK.ok} ${e.approvedNoEdit}次无需修改`,
      learned,
      `${MARK.ok} ${TERM.spotCheck}全部通过`,
    ]),
    joinLines([
      '从现在开始：',
      '她可以直接处理这类消息。',
    ]),
    joinLines([
      `以下情况仍然等你${TERM.approval}：`,
      ...input.stillNeedsApprovalZh.map((s) => `- ${s}`),
    ]),
    `你可以随时${TERM.revoke}这项职责。`,
  ]);
}

/** ── Reduction (收回 / 退回试用) — equal care, no fear, no silence ───────── */

const ACTION_HEAD_ZH: Record<Exclude<DemotionAction, 'none'>, string> = {
  pause: '已暂时收回',
  return_to_learning: `已${TERM.demotion}`,
  withdraw: '已收回，重新培训中',
};

export function renderReductionCard(input: {
  readonly employeeName: string;
  readonly capabilityZh: string;
  readonly action: Exclude<DemotionAction, 'none'>;
  readonly reasonZh: string;                 // one honest line, e.g. 最近两次报价都需要你修改付款条件
  readonly alreadyDoneZh: string;            // what the system did, e.g. 这两次修改已加入培训记录
}): string {
  return joinSections([
    `${input.employeeName}的「${input.capabilityZh}」${ACTION_HEAD_ZH[input.action]}`,
    joinLines(['原因：', input.reasonZh]),
    joinLines([
      '现在：',
      `她会继续准备${input.capabilityZh}，但会先等你确认。`,
    ]),
    joinLines([
      input.alreadyDoneZh,
      `完成新的${TERM.spotCheck}后，可以重新申请${TERM.promotion}。`,
    ]),
  ]);
}

/** ── Repair record (修复) — three-part grammar + honest status ──────────── */

const REPAIR_STATUS_ZH: Record<RepairRecord['status'], string> = {
  open: '处理中',
  contained: '已止住，准备更正',
  corrected: '更正已发出',
  verified: '已复查',
  closed: `${TERM.repair}完成`,
};

export function renderRepairCard(r: RepairRecord, ctx: {
  readonly employeeName: string;
  readonly buyerName: string;
}): string {
  const step = nextRepairStep(r);
  const beingDone =
    r.buyerReceivedMistake
      ? step === 'await_owner'
        ? `已暂停对 ${ctx.buyerName} 的自动回复，更正稿等你${TERM.approval}。`
        : `已暂停对 ${ctx.buyerName} 的自动回复，正在准备更正。`
      : `这条没有发给${TERM.buyer}，已经拦下了。`;
  const youDo =
    step === 'await_owner' ? `看一眼更正稿，回复「发送」或直接改。`
    : step === 'done' || r.status === 'closed' ? '不用你操作。'
    : '不用你操作，好了会告诉你。';

  return joinSections([
    joinLines([
      `${MARK.warn} ${r.whatHappenedZh}`,
      beingDone,
      youDo,
    ]),
    r.learnedZh ? `已加入培训：${r.learnedZh}` : null,
    r.authorityChanged ? `相关职责已先${TERM.revoke}，等新的${TERM.spotCheck}。` : null,
    `状态：${REPAIR_STATUS_ZH[r.status]}`,
  ]);
}

/** ── Spot check (抽查) — under two minutes, everything on one card ──────── */

export function renderSpotCheckCard(input: {
  readonly employeeName: string;
  readonly capabilityZh: string;
  readonly buyerName: string;
  readonly buyerMessage: string;
  readonly reply: string;
  readonly replyZh: string;
  readonly at: Date;
  readonly now: Date;
}): string {
  return joinSections([
    `【${TERM.spotCheck}】${input.employeeName}${formatWhenZh(input.at, input.now)}的一次「${input.capabilityZh}」`,
    joinLines([
      `${MARK.person} ${input.buyerName} 说：${input.buyerMessage}`,
    ]),
    joinLines([
      `${input.employeeName}回了：${input.reply}`,
      `${MARK.meaningShort}${input.replyZh}`,
    ]),
    '回复「好」通过 ｜ 要改直接写 ｜「有问题」马上停',
  ]);
}
