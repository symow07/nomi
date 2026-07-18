/**
 * M7 — The five answerable questions, as arithmetic over recorded rows.
 * Answers are ranked driver lines in owner language — never charts, never
 * unexplained numbers, and each answer names what to do about it.
 */

export type PeriodStats = {
  readonly inquiries: number;
  readonly quotes: number;
  readonly orders: number;
  readonly orderValueUsd: number;
  readonly editRatio: number;            // 0..1
};

/** Q1: 为什么这个月单子多了/少了 — ranked, quantified drivers. */
export function whySalesChanged(current: PeriodStats, previous: PeriodStats): readonly string[] {
  const drivers: { impact: number; lineZh: string }[] = [];
  const pct = (a: number, b: number): number | null =>
    b === 0 ? (a > 0 ? 1 : null) : (a - b) / b;

  const inq = pct(current.inquiries, previous.inquiries);
  if (inq !== null && Math.abs(inq) >= 0.15) {
    drivers.push({ impact: Math.abs(inq), lineZh: `询盘${inq > 0 ? '多' : '少'}了${Math.round(Math.abs(inq) * 100)}%——${inq > 0 ? '进来的人变多' : '进来的人变少'}是主因` });
  }
  const q2o = (s: PeriodStats) => (s.quotes === 0 ? 0 : s.orders / s.quotes);
  const conv = q2o(current) - q2o(previous);
  if (Math.abs(conv) >= 0.05 && previous.quotes > 0) {
    drivers.push({ impact: Math.abs(conv) * 2, lineZh: `报价成单率${conv > 0 ? '升' : '降'}到${Math.round(q2o(current) * 100)}%（上期${Math.round(q2o(previous) * 100)}%）` });
  }
  if (current.editRatio - previous.editRatio >= 0.1) {
    drivers.push({ impact: current.editRatio - previous.editRatio, lineZh: `你改稿变多了（${Math.round(current.editRatio * 100)}%）——说法可能没跟上你的意思` });
  }
  if (drivers.length === 0) return ['和上期差不多，没有单一原因。'];
  return drivers.sort((a, b) => b.impact - a.impact).map((d) => d.lineZh);
}

/** Q2: 哪些国家的买家最容易成 — conversion by country, min sample. */
export function bestCountries(
  rows: readonly { readonly countryZh: string; readonly inquiries: number; readonly orders: number }[],
  minInquiries = 3,
): readonly string[] {
  return rows
    .filter((r) => r.inquiries >= minInquiries)
    .map((r) => ({ ...r, rate: r.orders / r.inquiries }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 3)
    .map((r) => `${r.countryZh}：${r.inquiries}个询盘成了${r.orders}单（${Math.round(r.rate * 100)}%）`);
}

/** Q3: 哪些产品总被压价/问完就跑 — objection & silence counts per product. */
export function objectionProducts(
  rows: readonly { readonly productNameZh: string; readonly quoted: number; readonly wentSilent: number; readonly priceObjections: number }[],
  minQuoted = 3,
): readonly string[] {
  return rows
    .filter((r) => r.quoted >= minQuoted && (r.wentSilent + r.priceObjections) > 0)
    .map((r) => ({ ...r, badRate: (r.wentSilent + r.priceObjections) / r.quoted }))
    .sort((a, b) => b.badRate - a.badRate)
    .slice(0, 3)
    .map((r) => `${r.productNameZh}：报了${r.quoted}次，${r.priceObjections}次嫌贵、${r.wentSilent}次没了下文`);
}

/** Q4: 你老是在改哪类回复 — repeated corrections worth a rule. */
export const REPEATED_EDIT_THRESHOLD = 3;

export function repeatedEdits(
  rows: readonly { readonly topicZh: string; readonly count: number }[],
): readonly string[] {
  return rows
    .filter((r) => r.count >= REPEATED_EDIT_THRESHOLD)
    .sort((a, b) => b.count - a.count)
    .map((r) => `「${r.topicZh}」你改了${r.count}次——要不要定成规矩？`);
}

/** Q5: 今天该跟进谁 — quoted-then-silent first, oldest wound first. */
export function followUpToday(
  rows: readonly {
    readonly buyerName: string;
    readonly daysSilent: number;
    readonly hasOpenQuote: boolean;
    readonly handedOff: boolean;         // human owns it — not the employee's call
  }[],
  now?: Date,
): readonly { readonly buyerName: string; readonly whyZh: string }[] {
  void now;
  return rows
    .filter((r) => !r.handedOff && r.daysSilent >= 2)
    .sort((a, b) =>
      Number(b.hasOpenQuote) - Number(a.hasOpenQuote) || b.daysSilent - a.daysSilent)
    .slice(0, 5)
    .map((r) => ({
      buyerName: r.buyerName,
      whyZh: r.hasOpenQuote
        ? `拿了报价${r.daysSilent}天没回——问一句最划算`
        : `${r.daysSilent}天没说话了`,
    }));
}
