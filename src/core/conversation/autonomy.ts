import type { TurnDecision } from './decide.js';

/**
 * Autonomy resolution: given what the engine decided, which CAPABILITY is
 * being exercised, and is it currently granted auto — including the
 * night-shift window (值夜班)? Everything else stays a draft.
 */

export type Capability =
  | 'greet' | 'qualify' | 'recommend' | 'quote'
  | 'negotiate' | 'confirm_order' | 'follow_up';

export type AutonomyGrant = {
  readonly capability: Capability;
  readonly mode: 'draft' | 'auto';
  /** 'HH:MM-HH:MM' local to the business tz; null = whole day when auto. */
  readonly timeWindow: string | null;
};

/** Which capability does this turn exercise? Deterministic, worst-case wins:
 * a reply that contains a quote IS quoting, whatever else it does. */
export function capabilityOf(d: TurnDecision, hasQuote: boolean): Capability {
  if (d.action.kind === 'confirm_order') return 'confirm_order';
  if (hasQuote) return 'quote';
  if (d.product !== null) return 'recommend';
  if (d.nextPhase === 'warm_intake' && d.pendingQuestion === null) return 'greet';
  return 'qualify';
}

/** Local wall-clock minutes in an IANA timezone, no dependencies. */
export function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** '22:00-07:00' handles windows that cross midnight — the whole point of 夜班. */
export function withinWindow(now: Date, timeZone: string, window: string): boolean {
  const m = window.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!m) return false; // malformed window = never auto. Fail toward drafts.
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  const cur = localMinutes(now, timeZone);
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

export type Mode = 'auto' | 'draft';

/**
 * The routing rule. Defaults matter more than logic here:
 * unknown capability → draft. No grant row → draft. Malformed window → draft.
 * confirm_order → ALWAYS draft (the final tap is permanently the owner's).
 */
export function resolveMode(input: {
  capability: Capability;
  grants: readonly AutonomyGrant[];
  now: Date;
  timeZone: string;
}): Mode {
  if (input.capability === 'confirm_order') return 'draft';

  const grant = input.grants.find((g) => g.capability === input.capability);
  if (!grant || grant.mode !== 'auto') return 'draft';
  if (grant.timeWindow === null) return 'auto';
  return withinWindow(input.now, input.timeZone, grant.timeWindow) ? 'auto' : 'draft';
}
