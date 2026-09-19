/**
 * T1 — HOW MUCH SHE DOES ON HER OWN is the owner's choice, from day one.
 *
 * Until now the only way a reply could go out without approval was the evidence
 * ladder: fifteen handled, twelve approved untouched, two spot checks, five days
 * — per kind of reply. On the first real day of use the owner said what that
 * means in practice: an assistant that needs a tap to say "Hi there! What are
 * you looking for today?" is not an assistant. He is right, and it is his risk
 * to weigh, not ours to withhold.
 *
 * So the ladder stays as ADVICE (the page still says what she has earned) and
 * stops being the only door. Three levels, because a per-capability matrix is
 * not a decision anybody makes on a phone:
 *
 *   waits       everything waits for the owner — the default, and what every
 *               workspace had until now;
 *   talks       she greets, asks, recommends and follows up on her own; anything
 *               that states a price waits;
 *   sells       she also quotes and negotiates on her own, INSIDE the owner's
 *               price rules.
 *
 * What no level changes: confirming an order always waits for a person; a turn
 * her rules hold (a discount above the ask line, a price that contradicts what
 * was said before, a heard quantity, guards that failed twice) still waits;
 * numbers still come only from her own engine; and a violation still takes the
 * capability back by itself (`autoDemote`).
 *
 * Pure.
 */
import { CAPABILITIES, type Capability } from './autonomy.js';

export const AUTONOMY_LEVELS = ['waits', 'talks', 'sells'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

const TALKS: readonly Capability[] = ['greet', 'qualify', 'recommend', 'follow_up'];
const SELLS: readonly Capability[] = [...TALKS, 'quote', 'negotiate'];

/** Which kinds of reply go out on their own at this level. Never `confirm_order`. */
export function aloneAt(level: AutonomyLevel): readonly Capability[] {
  return level === 'sells' ? SELLS : level === 'talks' ? TALKS : [];
}

/** The mode every capability should be in at this level. */
export function modesFor(level: AutonomyLevel): Readonly<Record<Capability, 'auto' | 'draft'>> {
  const alone = new Set<Capability>(aloneAt(level));
  return Object.fromEntries(CAPABILITIES.map((c) => [c, alone.has(c) ? 'auto' : 'draft'])) as Record<Capability, 'auto' | 'draft'>;
}

/**
 * The level a set of modes amounts to, for showing the current choice. A mix
 * that is none of the three — she earned one capability on the ladder, or lost
 * one to a violation — is `null`: the page then says what she does alone rather
 * than naming a level she is not at.
 */
export function levelOf(modes: Readonly<Partial<Record<string, 'auto' | 'draft'>>>): AutonomyLevel | null {
  for (const level of AUTONOMY_LEVELS) {
    const want = modesFor(level);
    if (CAPABILITIES.every((c) => (modes[c] ?? 'draft') === want[c])) return level;
  }
  return null;
}

export const isAutonomyLevel = (v: string): v is AutonomyLevel => (AUTONOMY_LEVELS as readonly string[]).includes(v);
