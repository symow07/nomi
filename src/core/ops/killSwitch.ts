import type { Capability } from '../conversation/autonomy.js';

/**
 * M8 — Per-capability kill switches (ops_flags, migration 0014). A switch
 * only ever REDUCES authority: auto → draft → silent. It can never grant.
 * Global kill silences the employee entirely (messages still ingest and
 * queue — the never-drop invariant is not this module's to break).
 */

export type KillSwitches = {
  readonly globalSilence: boolean;                       // employee says nothing
  readonly forceDraft: readonly Capability[];            // capability demoted to draft
  readonly silenceCapability: readonly Capability[];     // capability fully off
};

export const NO_KILL_SWITCHES: KillSwitches = {
  globalSilence: false, forceDraft: [], silenceCapability: [],
};

export type EffectiveMode = 'auto' | 'draft' | 'silent';

/** Resolved autonomy mode ∘ kill switches. Monotone: never upgrades. */
export function effectiveMode(
  resolved: 'auto' | 'draft',
  capability: Capability,
  k: KillSwitches,
): EffectiveMode {
  if (k.globalSilence) return 'silent';
  if (k.silenceCapability.includes(capability)) return 'silent';
  if (k.forceDraft.includes(capability)) return 'draft';
  return resolved;
}
