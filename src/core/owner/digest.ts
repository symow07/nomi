import { STATUS, TERM } from './vocabulary.js';
import { formatDateZh, formatQtyZh, formatUsdCompact, formatWhenZh } from './format.js';

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
    ? `⭐ ${formatWhenZh(d.highlight.at, d.now)} ${d.highlight.buyerName}` +
      `${d.highlight.countryZh ? `（${d.highlight.countryZh}）` : ''}\n　${d.highlight.what}`
    : null;

  const pendingLines = d.pending.slice(0, 3)
    .map((p, i) => `${i + 1}. ${p.buyerName}：${p.what}`);
  if (pendingCount > 3) pendingLines.push(`……还有 ${formatQtyZh(pendingCount - 3)} 件`);

  return [
    `【${d.employeeName} · ${TERM.dailySummary}】${formatDateZh(d.date)}`,
    headline,
    '',
    numbers,
    highlight ? '' : null,
    highlight,
    pendingLines.length ? '' : null,
    pendingLines.length ? `${STATUS.waitingForYou}：` : null,
    ...pendingLines,
    d.onDutyTonightZh ? '' : null,
    d.onDutyTonightZh ? `今晚${TERM.nightShift}：${d.onDutyTonightZh}` : null,
  ].filter((l): l is string => l !== null).join('\n');
}
