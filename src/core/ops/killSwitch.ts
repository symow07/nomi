import { CAPABILITIES, type Capability } from '../conversation/autonomy.js';

/**
 * M8 — Per-capability kill switches (ops_flags, migration 0014). A switch
 * only ever REDUCES authority: auto → draft → silent. It can never grant.
 * Global kill silences the employee entirely (messages still ingest and
 * queue — the never-drop invariant is not this module's to break).
 *
 * M34.6 — WIRED. For its first six months this module was correct, tested, and
 * reached by nothing, while INCIDENT-PLAYBOOK.md handed an operator SQL to
 * insert a `global_silence` row. The insert committed; the employee kept
 * sending. A safety control that does not run is worse than one that was never
 * built, because it stops the operator looking for the control that works.
 *
 * There are two enforcement points, because the two questions are answerable at
 * different moments:
 *   - `globalSilence` at the SEND gate (`core/channel/sendGate.ts`), which runs
 *     at send time and therefore also catches messages queued before the flag
 *     was set. A queued reply must not escape a switch thrown after it queued.
 *   - `forceDraft` / `silenceCapability` at mode resolution (`pipeline/turn.ts`),
 *     because only the turn knows which capability a reply exercises.
 */

export type KillSwitches = {
  readonly globalSilence: boolean;                       // employee says nothing
  readonly forceDraft: readonly Capability[];            // capability demoted to draft
  readonly silenceCapability: readonly Capability[];     // capability fully off
};

export const NO_KILL_SWITCHES: KillSwitches = {
  globalSilence: false, forceDraft: [], silenceCapability: [],
};

/** One live `ops_flags` row, as the database stores it. */
export type OpsFlagRow = {
  readonly flag: string;
  readonly capability: string | null;
};

const isCapability = (c: string | null): c is Capability =>
  c !== null && (CAPABILITIES as readonly string[]).includes(c);

/**
 * Interpret live ops_flags rows. Pure, so the meaning of a switch is testable
 * without a database and lives in exactly one place — the SQL only selects.
 *
 * Unknown flag names and unknown capabilities are IGNORED rather than guessed
 * at. A row this build does not understand must not become a switch it applies
 * by accident; the table's CHECK constraint is the vocabulary's real guard, and
 * an older build reading a newer row is the ADR-0007 case.
 */
export function switchesFrom(rows: readonly OpsFlagRow[]): KillSwitches {
  const forceDraft: Capability[] = [];
  const silenceCapability: Capability[] = [];
  let globalSilence = false;
  for (const r of rows) {
    if (r.flag === 'global_silence') globalSilence = true;
    else if (r.flag === 'force_draft' && isCapability(r.capability)) forceDraft.push(r.capability);
    else if (r.flag === 'silence_capability' && isCapability(r.capability)) silenceCapability.push(r.capability);
  }
  return { globalSilence, forceDraft, silenceCapability };
}

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
