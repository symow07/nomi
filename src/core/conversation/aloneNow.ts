/**
 * THE WARMTH RUN, phase 9 (V1-417) — WHAT GOES OUT WITHOUT THE OWNER, NOW.
 *
 * Every screen that says a kind of reply goes out without the owner asks this
 * one function, so no screen can say it while something keeps every reply
 * waiting. The send decision (`commitTurn`, the send gate, the worker) is not
 * changed by it and is not read through it: it states, for the owner's pages,
 * what those already decide.
 *
 * What holds EVERY reply, strongest first — the order the notices are said in:
 *
 *   silenced   the operator paused sending (0071): nothing is sent at all;
 *   stopped    the owner's Stop (0070, rule 13): nothing is sent at all;
 *   release    rule 1 — no language's sentence saying who is answering has had
 *              its native read: every reply is drafted;
 *   name       rule 2 — the name customers read is not confirmed: every reply
 *              is drafted;
 *   ramp       G4 — a workspace that signed itself up has not earned sending
 *              alone yet: every reply is drafted.
 *
 * And, with none of those, a kind set to go alone past the rung the workspace
 * has earned (R2) still waits: it is "set, still waiting", never "goes out".
 *
 * Pure: the caller reads the facts (the page's loader), this decides what they
 * mean.
 */
import { rungOf } from '../trust/ramp.js';
import type { Capability } from './autonomy.js';

export type AloneHold = 'silenced' | 'stopped' | 'release' | 'name' | 'ramp';

export type AloneFacts = {
  /** Each kind of reply and how it is set. */
  readonly capabilities: readonly { readonly capability: string; readonly mode: 'auto' | 'draft' }[];
  /** Rule 1 — some language's sentence has had its native read. */
  readonly released: boolean;
  /** Rule 2 — the name customers read is confirmed. */
  readonly named: boolean;
  /** G4 — sending alone is earned. Absent reads as earned (a workspace the operator made). */
  readonly earned?: boolean;
  /** R2 — how far the switch may go, for a workspace that signed itself up. Absent: no rung binds. */
  readonly rung?: number;
  /** Rule 13 — the owner's Stop. */
  readonly stopped?: boolean;
  /** 0071 — the operator's pause. */
  readonly silenced?: boolean;
};

export type AloneNow = {
  /** What keeps every reply from going out alone right now; null when nothing does. */
  readonly hold: AloneHold | null;
  /** The kinds set to go alone that DO go out without the owner now. */
  readonly alone: readonly string[];
  /** The kinds set to go alone that still wait (a hold, or past the rung). */
  readonly setButHeld: readonly string[];
};

export function aloneNow(f: AloneFacts): AloneNow {
  const hold: AloneHold | null = f.silenced ? 'silenced'
    : f.stopped ? 'stopped'
    : !f.released ? 'release'
    : !f.named ? 'name'
    : f.earned === false ? 'ramp'
    : null;
  const set = f.capabilities.filter((c) => c.mode === 'auto').map((c) => c.capability);
  const goes = (c: string): boolean => hold === null && !(f.rung !== undefined && rungOf(c as Capability) > f.rung);
  return { hold, alone: set.filter(goes), setButHeld: set.filter((c) => !goes(c)) };
}

/** Nothing is sent at all (not even drafted): the two holds that stop the assistant writing. */
export const nothingSent = (hold: AloneHold | null): boolean => hold === 'silenced' || hold === 'stopped';
