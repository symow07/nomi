import { TERM } from './vocabulary.js';
import { joinLines } from './components.js';

/**
 * M2 — The Big Four states, as copy. Every surface has all four; none of
 * them says "No Data" or leaks software language.
 *
 * Empty teaches the next action. Progress says what's being worked on.
 * Problems follow what-happened → what's-being-done → what-you-do
 * (see OWNER_PROBLEM in notifications.ts — same pattern, same register).
 * Success rewards the moment — trust is built at these beats.
 */

/** Empty states — always: what this will be + the one action that starts it. */
export const EMPTY = {
  /** No products yet — the first onboarding step. */
  products: (employeeName: string) =>
    `${employeeName}还不认识你的产品。\n发几张产品图或价格表，马上开始培训。`,
  /** No conversations yet — waiting for the first buyer. */
  conversations: (employeeName: string) =>
    `还没有${TERM.inquiry}。\n把你的 WhatsApp 号发给${TERM.buyer}，${employeeName}随时开始接待。`,
  /** Nothing pending — the good kind of empty. */
  pending: () => `没有${TERM.approval}要处理，都安排好了。`,
  /** No orders yet — normal early on; say so. */
  orders: (employeeName: string) =>
    `还没有${TERM.order}。\n${TERM.quote}谈着呢——${employeeName}谈到关键一步会先问你。`,
} as const;

/** Progress copy — what is being worked on, in work terms. Never a spinner word. */
export const PROGRESS = {
  quoting: '正在按你的价格表算价……',
  translating: '正在翻译……',
  readingCatalog: '正在看你发的产品资料……',
  digest: `正在整理${TERM.dailySummary}……`,
  sending: '正在发出……',
} as const;

/** Success moments — short, warm, one line. The beats that build trust. */
export const SUCCESS = {
  firstSend: (employeeName: string) =>
    `第一条消息发出去了！${employeeName}正式上岗。`,
  sent: (buyerName: string) => `已发给 ${buyerName}。`,
  orderConfirmed: (buyerName: string) =>
    `${buyerName} 的${TERM.order}确认了！记得安排收款和生产。`,
  catalogLearned: (employeeName: string, count: number) =>
    `${employeeName}学会了 ${count} 个产品，可以开始接待了。`,
  promoted: (capabilityZh: string) =>
    `「${capabilityZh}」${TERM.promotion}成功！\n以后这类消息不用等你，随时可以${TERM.revoke}。`,
} as const;

/**
 * Problem builder — the canonical three-part pattern for anything that goes
 * wrong. what-you-do may be null when the honest answer is "nothing".
 */
export function renderProblem(input: {
  readonly whatHappened: string;
  readonly beingDone: string;
  readonly whatYouDo: string | null;
}): string {
  return joinLines([
    input.whatHappened,
    input.beingDone,
    input.whatYouDo,
  ]);
}
