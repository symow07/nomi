import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { SEQUENCE_STOPS, type SequenceStop, type PreviousStep } from '../core/outreach/sequence.js';

/**
 * C4.b — the rows behind a first e-mail and its follow-ups (0047).
 *
 * A store: it reads and writes and decides nothing. Whether a step goes is
 * `decideStep` (core) and, at send time, `gateOutbound`; whether a person may
 * approve is the route's owner-only check. What IS enforced here is only what a
 * query must not get wrong — which rows are live, and that a step is keyed so it
 * cannot be queued twice.
 */

export const MAX_STEPS = 10;

export type SequenceStep = {
  readonly position: number;
  readonly delayDays: number;
  readonly subject: string;
  readonly body: string;
};

export type SequenceState = 'draft' | 'approved' | 'archived';

export type SequenceSummary = {
  readonly id: string;
  readonly name: string;
  readonly state: SequenceState;
  readonly steps: number;
  readonly live: number;
  readonly finished: number;
  readonly stopped: number;
  readonly createdAt: Date;
};

export type Enrollment = {
  readonly id: string;
  readonly identity: string;
  readonly displayName: string | null;
  readonly conversationId: string | null;
  readonly enrolledBy: string;
  readonly enrolledAt: Date;
  readonly nextPosition: number;
  readonly nextDueAt: Date;
  readonly stepDueSince: Date;
  readonly stoppedAt: Date | null;
  readonly stopReason: SequenceStop | null;
  readonly completedAt: Date | null;
};

export type SequenceDetail = {
  readonly id: string;
  readonly name: string;
  readonly state: SequenceState;
  readonly createdBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly steps: readonly SequenceStep[];
  readonly enrollments: readonly Enrollment[];
};

const stateOf = (r: { approved_at: Date | null; archived_at: Date | null }): SequenceState =>
  r.archived_at ? 'archived' : r.approved_at ? 'approved' : 'draft';

const asStop = (v: string | null): SequenceStop | null =>
  SEQUENCE_STOPS.find((s) => s === v) ?? null;

/**
 * THE WORDS SHE READ, as one value.
 *
 * The approve form carries this, and approval is refused if the steps no longer
 * hash to it. Otherwise a colleague editing step two while she reads step one
 * would have her approve a sentence she never saw — and once approved, the
 * trigger in 0047 makes that sentence permanent.
 */
export function stepsFingerprint(steps: readonly SequenceStep[]): string {
  const h = createHash('sha256');
  for (const s of [...steps].sort((a, b) => a.position - b.position)) {
    h.update(JSON.stringify([s.position, s.delayDays, s.subject, s.body]));
  }
  return h.digest('hex');
}

export async function listSequences(tx: Tx, businessId: BusinessId): Promise<readonly SequenceSummary[]> {
  const rows = await sql<{
    id: string; name: string; approved_at: Date | null; archived_at: Date | null; created_at: Date;
    steps: number; live: number; finished: number; stopped: number;
  }>`
    select s.id::text as id, s.name, s.approved_at, s.archived_at, s.created_at,
           (select count(*)::int from sequence_steps st where st.sequence_id = s.id) as steps,
           (select count(*)::int from sequence_enrollments e where e.sequence_id = s.id
               and e.stopped_at is null and e.completed_at is null) as live,
           (select count(*)::int from sequence_enrollments e where e.sequence_id = s.id
               and e.completed_at is not null) as finished,
           (select count(*)::int from sequence_enrollments e where e.sequence_id = s.id
               and e.stopped_at is not null) as stopped
      from sequences s
     where s.business_id = ${businessId}::uuid
     order by (s.archived_at is not null), s.created_at desc`.execute(tx);
  return rows.rows.map((r) => ({
    id: r.id, name: r.name, state: stateOf(r), steps: r.steps, live: r.live,
    finished: r.finished, stopped: r.stopped, createdAt: r.created_at,
  }));
}

export async function loadSequence(
  tx: Tx, businessId: BusinessId, id: string,
): Promise<SequenceDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const s = (await sql<{
    id: string; name: string; created_by: string; approved_by: string | null;
    approved_at: Date | null; archived_at: Date | null;
  }>`select id::text as id, name, created_by, approved_by, approved_at, archived_at
       from sequences where id = ${id}::uuid and business_id = ${businessId}::uuid`.execute(tx)).rows[0];
  if (!s) return null;
  const steps = (await sql<{ position: number; delay_days: number; subject: string; body: string }>`
    select position, delay_days, subject, body from sequence_steps
     where sequence_id = ${id}::uuid order by position`.execute(tx)).rows;
  const enrollments = (await sql<{
    id: string; identity: string; display_name: string | null; conversation_id: string | null;
    enrolled_by: string; enrolled_at: Date; next_position: number; next_due_at: Date;
    step_due_since: Date; stopped_at: Date | null; stop_reason: string | null; completed_at: Date | null;
  }>`
    select e.id::text as id, e.identity, k.display_name, e.conversation_id::text as conversation_id,
           e.enrolled_by, e.enrolled_at, e.next_position, e.next_due_at, e.step_due_since,
           e.stopped_at, e.stop_reason, e.completed_at
      from sequence_enrollments e
      left join lateral (
        select display_name from contacts c
         where c.business_id = e.business_id and c.channel = e.channel and c.identity = e.identity
         order by (c.archived_at is null) desc limit 1
      ) k on true
     where e.sequence_id = ${id}::uuid
     order by (e.stopped_at is null and e.completed_at is null) desc, e.enrolled_at desc`.execute(tx)).rows;
  return {
    id: s.id, name: s.name, state: stateOf(s), createdBy: s.created_by,
    approvedBy: s.approved_by, approvedAt: s.approved_at, archivedAt: s.archived_at,
    steps: steps.map((r) => ({ position: r.position, delayDays: r.delay_days, subject: r.subject, body: r.body })),
    enrollments: enrollments.map((r) => ({
      id: r.id, identity: r.identity, displayName: r.display_name, conversationId: r.conversation_id,
      enrolledBy: r.enrolled_by, enrolledAt: r.enrolled_at, nextPosition: r.next_position,
      nextDueAt: r.next_due_at, stepDueSince: r.step_due_since, stoppedAt: r.stopped_at,
      stopReason: asStop(r.stop_reason), completedAt: r.completed_at,
    })),
  };
}

export async function createSequence(
  tx: Tx, businessId: BusinessId, input: { readonly name: string; readonly by: string },
): Promise<string> {
  return (await sql<{ id: string }>`
    insert into sequences (business_id, name, created_by)
    values (${businessId}::uuid, ${input.name}, ${input.by})
    returning id::text as id`.execute(tx)).rows[0]!.id;
}

/** Appended at the end. Refused past `MAX_STEPS` or on anything but a draft. */
export async function addStep(
  tx: Tx, businessId: BusinessId, sequenceId: string,
  step: { readonly delayDays: number; readonly subject: string; readonly body: string },
): Promise<'added' | 'full' | 'not_draft'> {
  const s = (await sql<{ approved_at: Date | null; archived_at: Date | null; n: number }>`
    select q.approved_at, q.archived_at,
           (select count(*)::int from sequence_steps st where st.sequence_id = q.id) as n
      from sequences q where q.id = ${sequenceId}::uuid and q.business_id = ${businessId}::uuid
       for update`.execute(tx)).rows[0];
  if (!s || s.approved_at || s.archived_at) return 'not_draft';
  if (s.n >= MAX_STEPS) return 'full';
  await sql`
    insert into sequence_steps (business_id, sequence_id, position, delay_days, subject, body)
    values (${businessId}::uuid, ${sequenceId}::uuid, ${s.n + 1}, ${step.delayDays}, ${step.subject}, ${step.body})`
    .execute(tx);
  return 'added';
}

export async function updateStep(
  tx: Tx, businessId: BusinessId, sequenceId: string, position: number,
  step: { readonly delayDays: number; readonly subject: string; readonly body: string },
): Promise<'saved' | 'not_draft'> {
  const s = (await sql<{ approved_at: Date | null; archived_at: Date | null }>`
    select approved_at, archived_at from sequences
     where id = ${sequenceId}::uuid and business_id = ${businessId}::uuid for update`.execute(tx)).rows[0];
  if (!s || s.approved_at || s.archived_at) return 'not_draft';
  const r = await sql`
    update sequence_steps set delay_days = ${step.delayDays}, subject = ${step.subject}, body = ${step.body}
     where sequence_id = ${sequenceId}::uuid and position = ${position}`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0 ? 'saved' : 'not_draft';
}

/**
 * Her approval — of exactly the words she read.
 *
 * `for update` on the sequence first, so a step edit in flight either commits
 * before this reads the steps (and the fingerprint then refuses) or waits on the
 * trigger's `for share` and is refused as an edit to an approved sequence.
 */
export async function approveSequence(
  tx: Tx, businessId: BusinessId, sequenceId: string,
  input: { readonly by: string; readonly fingerprint: string },
): Promise<'approved' | 'changed' | 'empty' | 'not_draft'> {
  const s = (await sql<{ approved_at: Date | null; archived_at: Date | null }>`
    select approved_at, archived_at from sequences
     where id = ${sequenceId}::uuid and business_id = ${businessId}::uuid for update`.execute(tx)).rows[0];
  if (!s || s.approved_at || s.archived_at) return 'not_draft';
  const detail = await loadSequence(tx, businessId, sequenceId);
  if (!detail || detail.steps.length === 0) return 'empty';
  if (stepsFingerprint(detail.steps) !== input.fingerprint) return 'changed';
  await sql`update sequences set approved_by = ${input.by}, approved_at = now()
             where id = ${sequenceId}::uuid`.execute(tx);
  return 'approved';
}

/**
 * ARCHIVE, NEVER ERASE — and everyone still on it stops, in the same
 * transaction. The scheduler would stop them on its next look anyway; doing it
 * here means the page she lands on already says so.
 */
export async function archiveSequence(
  tx: Tx, businessId: BusinessId, sequenceId: string,
): Promise<boolean> {
  const r = await sql`update sequences set archived_at = now()
                       where id = ${sequenceId}::uuid and business_id = ${businessId}::uuid
                         and archived_at is null`.execute(tx);
  if (Number(r.numAffectedRows ?? 0) === 0) return false;
  await sql`update sequence_enrollments set stopped_at = now(), stop_reason = 'sequence_archived'
             where sequence_id = ${sequenceId}::uuid and stopped_at is null and completed_at is null`.execute(tx);
  return true;
}

/**
 * A buyer starts receiving an approved sequence. The first step falls due after
 * its own delay; `step_due_since` starts at the same moment.
 */
export async function insertEnrollment(
  tx: Tx, businessId: BusinessId, sequenceId: string,
  input: { readonly identity: string; readonly by: string; readonly firstDueAt: Date },
): Promise<'enrolled' | 'already'> {
  const r = await sql<{ id: string }>`
    insert into sequence_enrollments
      (business_id, sequence_id, channel, identity, enrolled_by, next_due_at, step_due_since)
    values (${businessId}::uuid, ${sequenceId}::uuid, 'email', ${input.identity}, ${input.by},
            ${input.firstDueAt}, ${input.firstDueAt})
    on conflict (business_id, sequence_id, channel, identity) where stopped_at is null and completed_at is null
    do nothing
    returning id::text as id`.execute(tx);
  return r.rows.length > 0 ? 'enrolled' : 'already';
}

export async function stopEnrollment(
  tx: Tx, businessId: BusinessId, enrollmentId: string, reason: SequenceStop,
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(enrollmentId)) return false;
  const r = await sql`update sequence_enrollments set stopped_at = now(), stop_reason = ${reason}
                       where id = ${enrollmentId}::uuid and business_id = ${businessId}::uuid
                         and stopped_at is null and completed_at is null`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

/** Live enrolments whose next look is due. Ids only: each is then taken under lock. */
export async function dueEnrollments(
  tx: Tx, businessId: BusinessId, now: Date, limit: number,
): Promise<readonly string[]> {
  return (await sql<{ id: string }>`
    select id::text as id from sequence_enrollments
     where business_id = ${businessId}::uuid and stopped_at is null and completed_at is null
       and next_due_at <= ${now}
     order by next_due_at limit ${limit}`.execute(tx)).rows.map((r) => r.id);
}

/** Everything `decideStep` needs about one enrolment, read under its row lock. */
export type StepFacts = {
  readonly enrollment: Enrollment & { readonly sequenceId: string };
  readonly sequenceArchived: boolean;
  readonly sequenceApproved: boolean;
  readonly steps: readonly SequenceStep[];
  readonly repliedSinceEnrolment: boolean;
  readonly assignedTo: string | null;
  readonly previous: PreviousStep;
};

/**
 * `for update skip locked`: two sweeps — two processes during a deploy, or a
 * slow minute overlapping the next — never work the same enrolment at once. The
 * one that finds it locked moves on; the other finishes it.
 */
export async function lockStepFacts(
  tx: Tx, businessId: BusinessId, enrollmentId: string,
): Promise<StepFacts | null> {
  const e = (await sql<{
    id: string; sequence_id: string; identity: string; conversation_id: string | null;
    enrolled_by: string; enrolled_at: Date; next_position: number; next_due_at: Date;
    step_due_since: Date; stopped_at: Date | null; stop_reason: string | null; completed_at: Date | null;
  }>`
    select id::text as id, sequence_id::text as sequence_id, identity, conversation_id::text as conversation_id,
           enrolled_by, enrolled_at, next_position, next_due_at, step_due_since,
           stopped_at, stop_reason, completed_at
      from sequence_enrollments
     where id = ${enrollmentId}::uuid and business_id = ${businessId}::uuid
       and stopped_at is null and completed_at is null
       for update skip locked`.execute(tx)).rows[0];
  if (!e) return null;

  const seq = (await sql<{ approved_at: Date | null; archived_at: Date | null }>`
    select approved_at, archived_at from sequences where id = ${e.sequence_id}::uuid`.execute(tx)).rows[0];
  const steps = (await sql<{ position: number; delay_days: number; subject: string; body: string }>`
    select position, delay_days, subject, body from sequence_steps
     where sequence_id = ${e.sequence_id}::uuid order by position`.execute(tx)).rows;

  // ANY message from him since he was enrolled, on any thread of any client
  // this tenant holds his address on. C4.c is what makes an e-mail reply land;
  // until then this still sees a reply that reached her some other way.
  const replied = (await sql<{ yes: boolean }>`
    select exists (
      select 1 from client_channels cc
        join conversations c on c.client_id = cc.client_id
        join messages m      on m.conversation_id = c.id
       where cc.channel = 'email' and cc.channel_user_id = ${e.identity}
         and m.direction = 'inbound' and m.sent_at > ${e.enrolled_at}
    ) as yes`.execute(tx)).rows[0]?.yes === true;

  const assignedTo = e.conversation_id
    ? (await sql<{ assigned_to: string | null }>`
        select assigned_to from conversations where id = ${e.conversation_id}::uuid`.execute(tx)).rows[0]?.assigned_to ?? null
    : null;

  let previous: PreviousStep = 'none';
  if (e.next_position > 1) {
    const prev = (await sql<{ status: string | null }>`
      select o.status from sequence_sends s
        left join outbound_messages o on o.id = s.outbound_id
       where s.enrollment_id = ${e.id}::uuid and s.position = ${e.next_position - 1}`.execute(tx)).rows[0];
    const status = prev?.status ?? null;
    previous = status === 'sent' || status === 'delivered' || status === 'read' ? 'sent'
      : status === 'queued' || status === 'sending' ? 'pending'
      // No send row, no outbound row, or canceled/failed: it did not arrive.
      : 'not_sent';
  }

  return {
    enrollment: {
      id: e.id, sequenceId: e.sequence_id, identity: e.identity, displayName: null,
      conversationId: e.conversation_id, enrolledBy: e.enrolled_by, enrolledAt: e.enrolled_at,
      nextPosition: e.next_position, nextDueAt: e.next_due_at, stepDueSince: e.step_due_since,
      stoppedAt: e.stopped_at, stopReason: asStop(e.stop_reason), completedAt: e.completed_at,
    },
    sequenceArchived: seq?.archived_at != null,
    sequenceApproved: seq?.approved_at != null,
    steps: steps.map((r) => ({ position: r.position, delayDays: r.delay_days, subject: r.subject, body: r.body })),
    repliedSinceEnrolment: replied,
    assignedTo,
    previous,
  };
}

/**
 * The key that makes a step queue at most once. Returns false when it already
 * exists — a retried job, or a sweep that lost a race it should not have been
 * able to enter — and the caller then queues nothing.
 */
export async function claimSend(
  tx: Tx, businessId: BusinessId, enrollmentId: string, position: number,
): Promise<boolean> {
  const r = await sql<{ position: number }>`
    insert into sequence_sends (business_id, enrollment_id, position)
    values (${businessId}::uuid, ${enrollmentId}::uuid, ${position})
    on conflict (enrollment_id, position) do nothing
    returning position`.execute(tx);
  return r.rows.length > 0;
}

export async function recordSend(
  tx: Tx, enrollmentId: string, position: number, outboundId: string,
): Promise<void> {
  await sql`update sequence_sends set outbound_id = ${outboundId}::uuid
             where enrollment_id = ${enrollmentId}::uuid and position = ${position}`.execute(tx);
}

export async function advanceEnrollment(
  tx: Tx, enrollmentId: string,
  input: { readonly conversationId: string; readonly nextPosition: number; readonly nextDueAt: Date },
): Promise<void> {
  await sql`update sequence_enrollments
               set conversation_id = ${input.conversationId}::uuid,
                   next_position = ${input.nextPosition},
                   next_due_at = ${input.nextDueAt}, step_due_since = ${input.nextDueAt}
             where id = ${enrollmentId}::uuid`.execute(tx);
}

/**
 * A hold or a look-again: the step does not change, only when it is next looked
 * at — and ONLY LATER, never sooner.
 *
 * `greatest`, evaluated against the row as committed when this UPDATE runs, not
 * as this transaction first read it. Found by mutation: with the row lock
 * removed, a sweep that lost the race for a step deferred the enrolment "an hour
 * from now" over the winner's "in two days", and the follow-up went out on the
 * next day. The lock makes that race unreachable; this makes the write itself
 * unable to bring a follow-up forward, whoever calls it.
 */
export async function deferEnrollment(tx: Tx, enrollmentId: string, until: Date): Promise<void> {
  await sql`update sequence_enrollments set next_due_at = greatest(next_due_at, ${until}::timestamptz)
             where id = ${enrollmentId}::uuid`.execute(tx);
}

export async function completeEnrollment(tx: Tx, enrollmentId: string): Promise<void> {
  await sql`update sequence_enrollments set completed_at = now() where id = ${enrollmentId}::uuid`.execute(tx);
}

/** Her own name for him, from her contact list, for the thread the first step opens. */
export async function contactName(
  tx: Tx, businessId: BusinessId, identity: string,
): Promise<string | null> {
  return (await sql<{ display_name: string | null }>`
    select display_name from contacts
     where business_id = ${businessId}::uuid and channel = 'email' and identity = ${identity}
     order by (archived_at is null) desc limit 1`.execute(tx)).rows[0]?.display_name ?? null;
}
