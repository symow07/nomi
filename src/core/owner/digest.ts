import { STATUS, TERM } from './vocabulary.js';
import { formatDateZh, formatUsdCompact, formatWhenZh } from './format.js';
import { INDENT, MARK } from './tokens.js';
import { joinLines, numberedList } from './components.js';

/**
 * M1 — 今日总结 (the evening digest). One of the three daily actions.
 *
 * Spec: ONE evening digest carries everything that isn't "needs review".
 * Design contract (thumb-perfect, TRUST docs): readable in ≤10 seconds,
 * fits one phone screen, leads with either 一切正常 or the one thing that
 * needs the owner, exactly one highlight story, max 3 pending items.
 */

export type DigestInput = {
  readonly employeeName: string;
  readonly date: Date;
  readonly now: Date;
  readonly stats: {
    readonly conversations: number;   // touched today
    readonly handled: number;         // completed without the owner
    readonly quotes: number;
    readonly orders: number;
    readonly orderValueUsd: number;
  };
  /** ONE story. The best thing that happened, with a name and a country. */
  readonly highlight: {
    readonly buyerName: string;
    readonly countryZh: string | null;
    readonly what: string;            // zh, from copy below — e.g. 谈到了5000个的报价
    readonly at: Date;
  } | null;
  /** Things waiting on the owner. Render max 3; summarize the rest. */
  readonly pending: readonly { readonly buyerName: string; readonly what: string }[];
  /** Tonight's duty line, e.g. 夜班：接待问候、报价（新买家） */
  readonly onDutyTonightZh: string | null;
  /** M5 daily trust loop: learning visible, authority changes visible. */
  readonly learnedTodayZh?: string | null;      // e.g. 学会了：报价先报FOB
  readonly authorityChangeZh?: string | null;   // e.g. 「接待问候」已晋升
};

export function renderDailyDigest(d: DigestInput): string {
  const s = d.stats;
  const pendingCount = d.pending.length;

  const headline =
    pendingCount > 0
      ? `${pendingCount} 件事${STATUS.waitingForYou}`
      : '一切正常，不用管';

  const numbers = [
    `${TERM.inquiry} ${s.conversations}`,
    `${STATUS.handled} ${s.handled}`,
    s.quotes > 0 ? `${TERM.quote} ${s.quotes}` : null,
    s.orders > 0 ? `${TERM.order} ${s.orders}（${formatUsdCompact(s.orderValueUsd)}）` : null,
  ].filter(Boolean).join(' · ');

  // Two lines on purpose: who+when, then what. One long line wraps ugly
  // mid-word on a phone; we control the break instead.
  const highlight = d.highlight
    ? `${MARK.star} ${formatWhenZh(d.highlight.at, d.now)} ${d.highlight.buyerName}` +
      `${d.highlight.countryZh ? `（${d.highlight.countryZh}）` : ''}\n${INDENT}${d.highlight.what}`
    : null;

  const pendingLines = numberedList(
    d.pending.map((p) => `${p.buyerName}：${p.what}`),
    3,
  );

  return joinLines([
    `【${d.employeeName} · ${TERM.dailySummary}】${formatDateZh(d.date)}`,
    headline,
    '',
    numbers,
    highlight ? '' : null,
    highlight,
    pendingLines.length ? '' : null,
    pendingLines.length ? `${STATUS.waitingForYou}：` : null,
    ...pendingLines,
    // Footer group: learning + authority + night shift, contiguous — one
    // blank line before the group keeps the 16-line budget at worst case.
    (d.learnedTodayZh || d.authorityChangeZh || d.onDutyTonightZh) ? '' : null,
    d.learnedTodayZh ? `学会了：${d.learnedTodayZh}` : null,
    d.authorityChangeZh ?? null,
    d.onDutyTonightZh ? `今晚${TERM.nightShift}：${d.onDutyTonightZh}` : null,
  ]);
}
