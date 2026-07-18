/**
 * M5 — The repair protocol, as a typed record with a fixed lifecycle.
 * A meaningful mistake produces a RepairRecord; the record cannot reach
 * 'closed' until every step the situation requires has happened. The owner
 * reads it in the three-part grammar; developers get the same record —
 * there is no separate technical incident view to reconcile.
 */

export type RepairStatus = 'open' | 'contained' | 'corrected' | 'verified' | 'closed';

export type RepairRecord = {
  readonly id: string;
  readonly capability: string;
  readonly whatHappenedZh: string;          // owner language, one line
  readonly buyerReceivedMistake: boolean;
  readonly containment: 'auto_replies_stopped' | 'draft_blocked' | 'none_needed';
  readonly correctedDraft: string | null;   // buyer-facing correction, if one is due
  readonly correctionApproved: boolean;
  readonly correctionSent: boolean;
  readonly correctionDelivered: boolean;    // delivery receipt confirmed
  readonly learnedZh: string | null;        // what went into training
  readonly authorityChanged: boolean;       // did this trigger a demotion?
  readonly verifiedAt: Date | null;         // follow-up check happened
  readonly status: RepairStatus;
};

export type RepairStep =
  | 'stop_auto' | 'prepare_correction' | 'await_owner' | 'send_correction'
  | 'confirm_delivery' | 'record_learning' | 'verify' | 'done';

/** The next step the record demands. Pure — drives both worker and surface. */
export function nextRepairStep(r: RepairRecord): RepairStep {
  if (r.status === 'closed') return 'done';
  if (r.buyerReceivedMistake) {
    if (r.containment === 'none_needed') return 'stop_auto';   // buyer-facing ⇒ containment mandatory
    if (!r.correctedDraft) return 'prepare_correction';
    if (!r.correctionApproved) return 'await_owner';
    if (!r.correctionSent) return 'send_correction';
    if (!r.correctionDelivered) return 'confirm_delivery';
  }
  if (!r.learnedZh) return 'record_learning';
  if (!r.verifiedAt) return 'verify';
  return 'done';
}

/** A record may close only when nothing remains. Tested as the completeness rule. */
export function canClose(r: RepairRecord): boolean {
  return nextRepairStep(r) === 'done';
}
