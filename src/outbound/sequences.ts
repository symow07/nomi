import { withTenantTx, lockConversation, type Db } from '../db/client.js';
import { tenantRepos } from '../db/repos.js';
import { ensureConversation, enqueueOutboundRow } from '../db/channels.js';
import { outreachFacts } from '../db/outreach.js';
import { loadKillSwitches } from '../db/opsFlags.js';
import {
  advanceEnrollment, claimSend, completeEnrollment, contactName, deferEnrollment, dueEnrollments,
  insertEnrollment, loadSequence, lockStepFacts, recordSend, stopEnrollment,
} from '../db/sequences.js';
import { decideStep, dueAfter, type SequenceStop, type StepDecision } from '../core/outreach/sequence.js';
import { gateOutreach, type OutreachRefusal } from '../core/outreach/gate.js';
import { normalizeIdentity, type IdentityError } from '../core/outreach/consent.js';
import { aiMaySpeak, ownershipOf } from '../core/conversation/ownership.js';
import type { TemplateState } from '../core/channel/window.js';
import type { BusinessId, ConversationId } from '../core/types/ids.js';

/**
 * C4.b — carrying out what `decideStep` decides.
 *
 * ── THE SCHEDULE IS A TABLE, AND THE QUEUE ONLY WAKES IT ──────────────────
 *
 * Every enrolment holds its own `next_due_at`. A pg-boss cron job runs
 * `runDueSteps` once a minute and works whatever is due. There are no delayed
 * jobs per step, on purpose: a delayed job lost to a queue purge, a failed
 * deploy or a changed singleton key is a follow-up that silently never happens
 * — or, restored from a backup, happens twice. A row with a due time is
 * something she can read on her page and a sweep can always find again.
 * Follow-ups are measured in days; a minute of granularity costs nothing.
 *
 * ── A STEP IS AN ORDINARY OUTBOUND ROW ────────────────────────────────────
 *
 * Released through `enqueueOutboundRow` with origin 'outreach' and her subject,
 * then driven by the same worker as everything else — which means the gate, her
 * cap, his suppression and the unsubscribe headers all apply at the moment it
 * actually leaves, however long after it was queued.
 */

/** Private: the one failure that must undo the rows written before it. */
class Unreachable extends Error {}

export type SequenceDeps = {
  readonly db: Db;
  readonly now: () => Date;
  readonly templateState: TemplateState;
  /** The bare outbound re-drive tick, fired after commit for each queued step. */
  readonly kickDrive: (businessId: string, conversationId: string) => Promise<void>;
};

export type EnrollOutcome =
  | 'enrolled' | 'already' | 'not_approved' | IdentityError | OutreachRefusal;

/**
 * He starts receiving it — if he may be written to NOW.
 *
 * The gate is asked here as well as at every step and at send time, so she is
 * told at the moment she chooses him rather than finding a stopped enrolment
 * tomorrow. Counted with today's queued mail, like every precheck.
 */
export async function enroll(
  deps: SequenceDeps,
  input: { readonly businessId: BusinessId; readonly sequenceId: string; readonly identity: string; readonly by: string },
): Promise<EnrollOutcome> {
  const identity = normalizeIdentity('email', input.identity);
  if (!identity.ok) return identity.error;
  return withTenantTx(deps.db, input.businessId, async (tx) => {
    const seq = await loadSequence(tx, input.businessId, input.sequenceId);
    if (!seq || seq.state !== 'approved' || seq.steps.length === 0) return 'not_approved';
    const facts = await outreachFacts(tx, input.businessId, {
      channel: 'email', identity: identity.value, templateState: deps.templateState, now: deps.now(),
    });
    // The cap is today's, and a first step with a delay is not today's mail:
    // only a refusal about HIM, or about whether e-mail can go at all, stops the
    // choice here. Her quota is the scheduler's question on the day it falls due.
    const may = gateOutreach({ ...facts, ceilingReached: false });
    if (!may.ok) return may.error;
    return insertEnrollment(tx, input.businessId, input.sequenceId, {
      identity: identity.value, by: input.by, firstDueAt: dueAfter(deps.now(), seq.steps[0]!.delayDays),
    });
  });
}

export type SweepResult = {
  readonly looked: number;
  /** Enrolments whose transaction threw; each is looked at again next minute. */
  readonly failed: number;
  readonly queued: number;
  readonly stopped: readonly SequenceStop[];
  readonly completed: number;
  readonly deferred: number;
};

/** At most this many enrolments per minute — a sweep must finish before the next. */
export const SWEEP_BATCH = 100;

type Done = { readonly decision: StepDecision | null; readonly kick: string | null };

/**
 * One enrolment, under its row lock, in its own transaction: read the facts,
 * ask `decideStep`, carry the answer out. Returns what was decided and the
 * conversation to re-drive once the transaction has committed.
 */
async function stepOne(deps: SequenceDeps, businessId: BusinessId, enrollmentId: string, now: Date): Promise<Done> {
  try {
    return await withTenantTx(deps.db, businessId, async (tx): Promise<Done> => {
      const f = await lockStepFacts(tx, businessId, enrollmentId);
      // Taken by another sweep, or ended since the list was read.
      if (!f) return { decision: null, kick: null };

      const outreach = await outreachFacts(tx, businessId, {
        channel: 'email', identity: f.enrollment.identity, templateState: deps.templateState,
        now, counting: 'sent_or_queued',
      });
      const decision = decideStep({
        now, steps: f.steps, nextPosition: f.enrollment.nextPosition,
        nextDueAt: f.enrollment.nextDueAt, stepDueSince: f.enrollment.stepDueSince,
        sequenceArchived: f.sequenceArchived,
        repliedSinceEnrolment: f.repliedSinceEnrolment,
        handedOff: !aiMaySpeak(ownershipOf(f.assignedTo)),
        previous: f.previous,
        outreach,
      });

      if (decision.kind === 'stop') {
        await stopEnrollment(tx, businessId, enrollmentId, decision.reason);
        if (f.enrollment.conversationId) {
          await tenantRepos(tx, businessId).events.append(
            f.enrollment.conversationId as ConversationId, 'sequence_stopped',
            { enrollmentId, reason: decision.reason });
        }
        return { decision, kick: null };
      }
      if (decision.kind === 'complete') {
        await completeEnrollment(tx, enrollmentId);
        return { decision, kick: null };
      }
      if (decision.kind === 'wait') {
        await deferEnrollment(tx, enrollmentId, decision.until);
        return { decision, kick: null };
      }

      // SEND — claim the step's key first, so it can be queued at most once.
      const step = f.steps.find((s) => s.position === decision.position)!;
      if (!(await claimSend(tx, businessId, enrollmentId, step.position))) {
        // The key exists but the enrolment never advanced past it. Queuing and
        // advancing share one transaction, so this should be unreachable; if it
        // is reached, the step is NOT queued again, and the enrolment is looked
        // at in an hour rather than every minute.
        console.error('[sequences] send key already held', enrollmentId, step.position);
        await deferEnrollment(tx, enrollmentId, new Date(now.getTime() + 3600_000));
        return { decision: null, kick: null };
      }
      const conversationId = f.enrollment.conversationId ?? (await ensureConversation(
        tx, businessId, f.enrollment.identity, await contactName(tx, businessId, f.enrollment.identity), 'email',
      )).conversationId;
      await lockConversation(tx, conversationId);
      const outboundId = await enqueueOutboundRow(
        tx, businessId, conversationId, step.body, 'outreach', { subject: step.subject },
      );
      // Nothing here can reach the address — another factory holds it (C4.a's
      // `no_channel`). Thrown, so the client, the thread and the send key made
      // for him above roll back instead of surviving as an empty conversation;
      // the stop is recorded in a transaction of its own below.
      if (outboundId === null) throw new Unreachable();
      await recordSend(tx, enrollmentId, step.position, outboundId);
      const next = f.steps.find((s) => s.position === step.position + 1);
      await advanceEnrollment(tx, enrollmentId, {
        conversationId, nextPosition: step.position + 1,
        // After the last step the enrolment is looked at again straight away,
        // and completes once that mail is known to have gone.
        nextDueAt: next ? dueAfter(now, next.delayDays) : now,
      });
      await tenantRepos(tx, businessId).events.append(
        conversationId as ConversationId, 'sequence_step_queued',
        { enrollmentId, position: step.position, actor: f.enrollment.enrolledBy });
      return { decision, kick: conversationId };
    });
  } catch (e) {
    if (!(e instanceof Unreachable)) throw e;
    await withTenantTx(deps.db, businessId, (tx) => stopEnrollment(tx, businessId, enrollmentId, 'unreachable'));
    return { decision: { kind: 'stop', reason: 'unreachable' }, kick: null };
  }
}

/**
 * One pass over what is due. Each enrolment in its OWN transaction, so one that
 * throws — a constraint, a lost connection — is retried on the next minute and
 * cannot take the rest of the batch down with it.
 */
export async function runDueSteps(deps: SequenceDeps, businessId: BusinessId): Promise<SweepResult> {
  const now = deps.now();
  // THE OPS KILL SWITCH HOLDS EVERY FOLLOW-UP. Nothing is looked at, so nothing
  // is queued and nothing advances; when the switch is cleared, what is due goes
  // late rather than early. The send-time gate is the backstop for a step queued
  // the moment before the switch was thrown (`GateInput.automated`).
  const due = await withTenantTx(deps.db, businessId, async (tx) =>
    (await loadKillSwitches(tx, businessId)).globalSilence ? [] : dueEnrollments(tx, businessId, now, SWEEP_BATCH));
  let queued = 0; let completed = 0; let deferred = 0; let failed = 0;
  const stopped: SequenceStop[] = [];

  for (const enrollmentId of due) {
    let done: Done;
    try {
      done = await stepOne(deps, businessId, enrollmentId, now);
    } catch (e) {
      // Its transaction rolled back whole: nothing was queued, nothing advanced.
      failed += 1;
      console.error('[sequences] enrolment failed this minute', enrollmentId,
        e instanceof Error ? e.message : String(e));
      continue;
    }
    if (!done.decision) continue;
    if (done.decision.kind === 'send') queued += 1;
    if (done.decision.kind === 'stop') stopped.push(done.decision.reason);
    if (done.decision.kind === 'complete') completed += 1;
    if (done.decision.kind === 'wait') deferred += 1;
    if (done.kick) await deps.kickDrive(businessId, done.kick);
  }
  return { looked: due.length, failed, queued, stopped, completed, deferred };
}
