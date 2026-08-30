/**
 * M51.5 — why did this month change?
 *
 * The question survived its first implementation. `core/insights/questions.ts`
 * answered it in M7 and was DELETED in M34.10 rather than wired, because it
 * ranked its drivers by percentage — "询盘多了67%", "报价成单率升到23%" — and
 * the product banned percentages and conversion rates afterwards. The ranking
 * mechanism WAS the percentage, so there was nothing left to port.
 *
 * It is worth answering anyway, and this is why: an owner who can see that
 * orders fell because FEWER BUYERS WROTE, rather than because she priced
 * badly, makes a completely different decision. One of those is a marketing
 * problem and the other is a pricing problem, and a month's total tells her
 * neither.
 *
 * ── HOW IT AVOIDS THE THING THAT KILLED THE FIRST VERSION ────────────────
 *
 * TWO COUNTS, NEVER A RATE. "询盘从 40 变成 25" — both numbers are rows the
 * owner could count herself, and the sentence contains no figure that is not
 * one of them. There is no percentage, no ratio, no "up 37%", and no division
 * anywhere in this module. A test asserts that, because the temptation to
 * "just show the percent change" is exactly what happened last time.
 *
 * RANKED BY THE SIZE OF THE CHANGE, which is a count too: |to − from|. A drop
 * of fifteen inquiries outranks a drop of two orders because fifteen is the
 * bigger movement — and where two drivers moved by the same amount, the one
 * closer to money wins, because that is the one she will want to look at.
 *
 * NO THRESHOLD. "Only report a change bigger than three" would be an invented
 * number, and this product does not have those. A change of one is reported as
 * a change of one; if that is the biggest thing that happened to her month,
 * then it is the news.
 *
 * Pure per ADR-0002.
 */

/** The three things a month is made of, closest-to-money last. */
export const MONTH_DRIVERS = ['inquiries', 'quotes', 'orders'] as const;
export type MonthDriver = (typeof MONTH_DRIVERS)[number];

export type DriverCounts = { readonly from: number; readonly to: number };

export type MonthChange = {
  readonly driver: MonthDriver;
  /** Last period. A real count of rows. */
  readonly from: number;
  /** This period. A real count of rows. */
  readonly to: number;
  /** to − from. Negative is a fall; the sign is the whole point. */
  readonly change: number;
};

/**
 * The one thing most worth telling her about this month, or nothing.
 *
 * Nothing is a legitimate answer: a month in which the same number of buyers
 * wrote, were quoted and ordered has no news in it, and inventing some would
 * be the fourth counts-with-nothing-to-do card this page exists to avoid.
 */
export function biggestChange(
  counts: Readonly<Record<MonthDriver, DriverCounts>>,
): MonthChange | null {
  const moved = MONTH_DRIVERS
    .map((driver): MonthChange => ({
      driver,
      from: counts[driver].from,
      to: counts[driver].to,
      change: counts[driver].to - counts[driver].from,
    }))
    .filter((c) => c.change !== 0);

  if (moved.length === 0) return null;

  // Biggest movement first; on a tie the driver closest to money, which is the
  // one she will want to open. MONTH_DRIVERS is ordered for exactly this.
  return moved.reduce((best, c) => {
    const size = Math.abs(c.change);
    const bestSize = Math.abs(best.change);
    if (size !== bestSize) return size > bestSize ? c : best;
    return MONTH_DRIVERS.indexOf(c.driver) > MONTH_DRIVERS.indexOf(best.driver) ? c : best;
  });
}
