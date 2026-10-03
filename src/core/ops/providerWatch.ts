/**
 * BILLING RESILIENCE (2026-10-04) — when the operator hears about the model
 * provider's account, and what each word means. Pure, so every step is tested
 * without a database or a provider (tests/parity/provider-watch.test.ts); the
 * sweeps in src/pipeline/providerWatch.ts ask these and send what they say.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * THE REFUSAL'S ESCALATION — while the provider refuses for billing, the
 * operator is told at the start, after an hour, after six hours, and then once
 * a day for as long as it lasts. Step k is due once the refusal is that old
 * and k alerts went before it; each step is claimed in the database
 * (`claim_provider_alert`), so a redeploy, a retry or two workers never make
 * it two. Why these steps: the first says it happened (it may be a blip — the
 * hour says it is not); six hours is a working day's half, the point at which
 * an unanswered first alert has clearly been missed; after that a daily
 * reminder keeps it from being forgotten without becoming noise.
 */
export const REFUSAL_ALERT_AFTER_MS: readonly number[] = [0, HOUR, 6 * HOUR, DAY];

/** How old the refusal must be for alert number `k` (0-based): 0, 1 h, 6 h, 24 h, 48 h, … */
export function refusalAlertAt(k: number): number {
  if (k < REFUSAL_ALERT_AFTER_MS.length) return REFUSAL_ALERT_AFTER_MS[k]!;
  return DAY * (k - REFUSAL_ALERT_AFTER_MS.length + 2);
}

/** The step due now, or null: `sent` alerts went already for the refusal that began at `since`. */
export function refusalAlertDue(since: Date, sent: number, now: Date): number | null {
  return now.getTime() - since.getTime() >= refusalAlertAt(sent) ? sent : null;
}

// ── The balance ─────────────────────────────────────────────────────────────

/** One currency's figures, as the provider states them (DeepSeek's `balance_infos`). */
export type BalanceLine = {
  readonly currency: string;
  readonly total: number;
  readonly granted: number | null;
  readonly toppedUp: number | null;
};

export type BalanceReading = { readonly available: boolean; readonly lines: readonly BalanceLine[] };

/**
 * The line that pays. DeepSeek lists every currency an account can hold (the
 * production account, read 2026-10-04: CNY 7.21 topped up, USD 0.00); the one
 * with money in it is the account's. None funded: the first line, at zero.
 */
export function payingLine(r: BalanceReading): BalanceLine | null {
  if (r.lines.length === 0) return null;
  return [...r.lines].sort((a, b) => b.total - a.total)[0]!;
}

/**
 * THE FLOOR — the balance below which the operator is told whatever the
 * recent spend says, in the account's own currency. `LLM_BALANCE_FLOOR` sets
 * it (a plain number in that currency); otherwise:
 *
 *   · USD 1.50, CNY 10 — about the same money. At the price T7 measured
 *     (about $0.000667 a turn at peak list price, 2026-09-29) that is roughly
 *     2,000 turns: about a week for one busy workspace answering 300
 *     customers' messages a day, and months at the pilot's present traffic.
 *     Enough time for an e-mail to be read and an account to be topped up by
 *     hand, which is the only way DeepSeek takes money (see PROGRESS).
 *   · Any other currency: no default — a floor is only meaningful in money the
 *     operator chose, so it is said once in the log and the steps that follow
 *     the spend (three days, one day, unavailable) still hold.
 */
export const DEFAULT_BALANCE_FLOOR: Readonly<Record<string, number>> = { USD: 1.5, CNY: 10 };

export function balanceFloor(currency: string, configured: string | undefined): number | null {
  const raw = configured?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_BALANCE_FLOOR[currency] ?? null;
}

/** One earlier reading of the paying line. */
export type BalancePoint = { readonly at: Date; readonly currency: string; readonly total: number };

/** The window the spend is read over, and the least history that makes an estimate. */
export const BURN_WINDOW_MS = 7 * DAY;
export const BURN_MIN_SPAN_MS = 12 * HOUR;

/**
 * THE RECENT SPEND, from the balance's own trend: every fall between two
 * readings in the last seven days, summed, over the time those readings span.
 * A rise is a top-up or a grant, never negative spend, so it is left out.
 * Read from the provider's own figures because they are the money itself — in
 * the account's currency, every paid call included, at whatever price applied
 * (DeepSeek's changes with the hour) — where `usage_ledger` holds tokens and
 * this build holds no price list to turn them into money.
 *
 * Null when there is not yet enough history (12 hours) or nothing was spent.
 */
export function spendPerDay(points: readonly BalancePoint[], currency: string, now: Date): number | null {
  const inWindow = points
    .filter((p) => p.currency === currency && now.getTime() - p.at.getTime() <= BURN_WINDOW_MS && p.at.getTime() <= now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (inWindow.length < 2) return null;
  const span = inWindow[inWindow.length - 1]!.at.getTime() - inWindow[0]!.at.getTime();
  if (span < BURN_MIN_SPAN_MS) return null;
  let spent = 0;
  for (let i = 1; i < inWindow.length; i++) {
    const fall = inWindow[i - 1]!.total - inWindow[i]!.total;
    if (fall > 0) spent += fall;
  }
  if (spent <= 0) return null;
  return spent / (span / DAY);
}

/**
 * THE STEPS, from least to most urgent. Each is sent once and not again until
 * it stops being true (a top-up re-arms it):
 *
 *   · `floor` — the balance is at or under the floor;
 *   · `days3` — about three days left at the recent spend;
 *   · `days1` — about one day left;
 *   · `unavailable` — the provider says the balance no longer pays for a call
 *     (`is_available: false`): replies stop now. Critical.
 */
export const BALANCE_STEPS = ['floor', 'days3', 'days1', 'unavailable'] as const;
export type BalanceStep = typeof BALANCE_STEPS[number];

export type BalanceVerdict = {
  /** Every step true now. */
  readonly steps: readonly BalanceStep[];
  /** Days left at the recent spend, when it can be told. */
  readonly daysLeft: number | null;
  readonly line: BalanceLine | null;
  readonly floor: number | null;
  readonly perDay: number | null;
};

export function balanceVerdict(
  r: BalanceReading, history: readonly BalancePoint[], now: Date, floorSetting: string | undefined,
): BalanceVerdict {
  const line = payingLine(r);
  const floor = line ? balanceFloor(line.currency, floorSetting) : null;
  const perDay = line ? spendPerDay([...history, { at: now, currency: line.currency, total: line.total }], line.currency, now) : null;
  const daysLeft = line && perDay ? Math.max(0, line.total / perDay) : null;
  const steps: BalanceStep[] = [];
  if (line && floor !== null && line.total <= floor) steps.push('floor');
  if (daysLeft !== null && daysLeft <= 3) steps.push('days3');
  if (daysLeft !== null && daysLeft <= 1) steps.push('days1');
  if (!r.available) steps.push('unavailable');
  return { steps, daysLeft, line, floor, perDay };
}

/** The most urgent of some steps: what one alert names. */
export function mostUrgent(steps: readonly BalanceStep[]): BalanceStep | null {
  for (let i = BALANCE_STEPS.length - 1; i >= 0; i--) if (steps.includes(BALANCE_STEPS[i]!)) return BALANCE_STEPS[i]!;
  return null;
}

/**
 * DeepSeek's balance answer, read defensively: `is_available` and the
 * `balance_infos` strings ("110.00"). Null when it is not that shape.
 * (api-docs.deepseek.com/api/get-user-balance)
 */
export function parseDeepSeekBalance(body: unknown): BalanceReading | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as { is_available?: unknown; balance_infos?: unknown };
  if (typeof b.is_available !== 'boolean' || !Array.isArray(b.balance_infos)) return null;
  const num = (v: unknown): number | null => {
    const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const lines: BalanceLine[] = [];
  for (const raw of b.balance_infos) {
    if (typeof raw !== 'object' || raw === null) continue;
    const x = raw as Record<string, unknown>;
    const currency = typeof x['currency'] === 'string' ? x['currency'].toUpperCase() : '';
    const total = num(x['total_balance']);
    if (!/^[A-Z]{3}$/.test(currency) || total === null) continue;
    lines.push({ currency, total, granted: num(x['granted_balance']), toppedUp: num(x['topped_up_balance']) });
  }
  return { available: b.is_available, lines };
}

/** Where the balance can be read: DeepSeek's host has an endpoint; Anthropic has none. */
export function balanceEndpointFor(baseURL: string | null): string | null {
  if (!baseURL) return null;   // Anthropic: no balance endpoint exists (its Admin API reports cost, not credit)
  try {
    return new URL(baseURL).host === 'api.deepseek.com' ? 'https://api.deepseek.com/user/balance' : null;
  } catch {
    return null;
  }
}
