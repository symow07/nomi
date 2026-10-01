/**
 * R2 — THE RAMP (the onboarding plan's phase 6; decisions 9, 12, 23). A
 * workspace that signed itself up earns sending alone in two rungs, counted
 * over the workspace — not per capability — from the drafts its owner (and,
 * for the first rung, its staff) decided for real customers. The capabilities
 * stay the switch; a rung only says how far the switch may go.
 *
 *   rung 1 · talks — greet, qualify, recommend, follow_up. Of the last 20
 *     decided drafts, at least 17 sent as written; at least 5 customers and 3
 *     days among them; none of them flagged (a guard trip on the kept reply, an
 *     identity slip, a deletion promise); the Practice checklist complete; the
 *     name confirmed. Staff decisions count (decision 12).
 *   rung 2 · sells — quote, negotiate. Rung 1, plus: the last 30 priced
 *     drafts the OWNER decided, none with a figure changed (wording edits are
 *     fine; a skipped one is not a pass); at least 10 customers and 7 days
 *     among them. A business whose prices go to the owner, or that has no
 *     priced products, stops at rung 1.
 *   confirm_order — never alone.
 *
 * Rung 1's N is the talks capabilities' `auto_after_clean_approvals` (20 by
 * default); its bar is 85% of N. Pure: no I/O.
 */
import type { Capability } from '../conversation/autonomy.js';

export type Rung = 0 | 1 | 2;
export const TALKS: readonly Capability[] = ['greet', 'qualify', 'recommend', 'follow_up'];
export const SELLS: readonly Capability[] = ['quote', 'negotiate'];

/** The rung a capability needs before it may go out alone; confirm_order never may (3). */
export const rungOf = (capability: Capability): Rung | 3 =>
  capability === 'confirm_order' ? 3 : (SELLS as readonly string[]).includes(capability) ? 2 : 1;

/** A level, as the rung it needs. */
export const rungOfLevel = (level: 'waits' | 'talks' | 'sells'): Rung => (level === 'sells' ? 2 : level === 'talks' ? 1 : 0);

export const TALKS_RULE = { window: 20, share: 0.85, customers: 5, days: 3 } as const;
export const SELLS_RULE = { window: 30, customers: 10, days: 7 } as const;

/** One draft decided for a real customer, newest first. */
export type RampDecision = {
  /** Sent exactly as drafted (after whitespace normalisation). */
  readonly asWritten: boolean;
  /** Sent, with a figure that differs from the draft's; a skipped draft counts as changed for prices. */
  readonly figureChanged: boolean;
  /** The draft carried a price (a quote or a negotiation). */
  readonly priced: boolean;
  /** Decided by the owner — not by staff. */
  readonly byOwner: boolean;
  readonly customer: string;
  /** The day it was decided, in the workspace's own zone (YYYY-MM-DD). */
  readonly day: string;
  /** A guard trip on the kept reply, an identity slip, or a deletion promise. */
  readonly flagged: boolean;
};

export type RungProgress = {
  readonly done: number;
  readonly of: number;
  readonly customers: number;
  readonly customersNeed: number;
  readonly days: number;
  readonly daysNeed: number;
  /** Nothing in the window was flagged (rung 1 only; rung 2 counts figures). */
  readonly clean: boolean;
  readonly ready: boolean;
};

const distinct = (xs: readonly string[]): number => new Set(xs).size;

export function talksProgress(
  newestFirst: readonly RampDecision[],
  extras: { readonly n?: number; readonly checklistComplete: boolean; readonly named: boolean },
): RungProgress & { readonly need: number } {
  const n = extras.n && extras.n > 0 ? extras.n : TALKS_RULE.window;
  const last = newestFirst.slice(0, n);
  const need = Math.ceil(TALKS_RULE.share * n);
  const done = last.filter((d) => d.asWritten).length;
  const customers = distinct(last.map((d) => d.customer));
  const days = distinct(last.map((d) => d.day));
  const clean = last.every((d) => !d.flagged);
  return {
    done, of: n, need, customers, customersNeed: TALKS_RULE.customers, days, daysNeed: TALKS_RULE.days, clean,
    ready: last.length >= n && done >= need && customers >= TALKS_RULE.customers && days >= TALKS_RULE.days
      && clean && extras.checklistComplete && extras.named,
  };
}

export function sellsProgress(newestFirst: readonly RampDecision[], talksReady: boolean, pricesAreTheirs: boolean): RungProgress | null {
  if (!pricesAreTheirs) return null;
  const priced = newestFirst.filter((d) => d.priced && d.byOwner).slice(0, SELLS_RULE.window);
  // The run of figures unchanged, from the newest back: one changed figure starts it again.
  const firstChanged = priced.findIndex((d) => d.figureChanged);
  const done = firstChanged === -1 ? priced.length : firstChanged;
  const counted = priced.slice(0, done);
  const customers = distinct(counted.map((d) => d.customer));
  const days = distinct(counted.map((d) => d.day));
  return {
    done, of: SELLS_RULE.window, customers, customersNeed: SELLS_RULE.customers, days, daysNeed: SELLS_RULE.days, clean: true,
    ready: talksReady && done >= SELLS_RULE.window && customers >= SELLS_RULE.customers && days >= SELLS_RULE.days,
  };
}
