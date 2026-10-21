import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { WAITING_HUMAN_AGENT } from '../core/conversation/ownership.js';
import { nextInRotation, type RotationMember } from '../core/conversation/rotation.js';

/**
 * S3 (Phase 5, item 21; 0198) — HAND-OFFS IN TURN, kept and carried out. The owner switches it on and says who is in
 * turn and who is away (the team page). After a hand-off commits, the worker asks here: if the turn is on and the
 * conversation still waits for anyone, the next one in turn is given it — they hold it, as if they had taken it — and
 * their turn moves on. Nothing is ever taken from a person who holds it, and a hand-off a deletion request made stays
 * the owner's (recording one is the owner's alone).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RotationView = {
  readonly on: boolean;
  readonly people: readonly { readonly id: string; readonly name: string; readonly inRotation: boolean; readonly awayUntil: Date | null;
    readonly lastGivenAt: Date | null; readonly accountant: boolean }[];
};

export async function rotationOf(tx: Tx, businessId: BusinessId): Promise<RotationView> {
  const on = (await sql<{ on: boolean }>`select rotation_on as on from businesses where id = ${businessId}::uuid`.execute(tx)).rows[0]?.on === true;
  const people = (await sql<{ id: string; name: string; in_rotation: boolean; away_until: Date | null; rotation_last_at: Date | null; kind: string }>`
    select id::text as id, name, in_rotation, away_until, rotation_last_at, kind from people
     where business_id = ${businessId}::uuid and archived_at is null order by created_at, id`.execute(tx)).rows;
  return { on, people: people.map((p) => ({ id: p.id, name: p.name, inRotation: p.in_rotation, awayUntil: p.away_until,
    lastGivenAt: p.rotation_last_at, accountant: p.kind === 'accountant' })) };
}

export async function setRotationOn(tx: Tx, businessId: BusinessId, on: boolean): Promise<void> {
  await sql`update businesses set rotation_on = ${on} where id = ${businessId}::uuid`.execute(tx);
}

/** In turn or not, and away until when (null: here). An accountant is never in turn (0198 refuses it too). */
export async function setPersonTurn(tx: Tx, businessId: BusinessId, personId: string, o: { readonly inRotation: boolean; readonly awayUntil: Date | null }): Promise<boolean> {
  if (!UUID.test(personId)) return false;
  return ((await sql`update people set in_rotation = ${o.inRotation}, away_until = ${o.awayUntil}
    where business_id = ${businessId}::uuid and id = ${personId}::uuid and archived_at is null and (kind <> 'accountant' or not ${o.inRotation})`
    .execute(tx)).numAffectedRows ?? 0n) > 0n;
}

/**
 * The hand-off just committed, given to the next one in turn — or nothing, and why not. The people in turn are locked
 * first, so two hand-offs at once never pick the same person; the conversation moves only while it still waits for
 * anyone, so a person who took it in between keeps it.
 */
export async function giveToNextInTurn(tx: Tx, businessId: BusinessId, conversationId: string, now: Date):
  Promise<{ readonly kind: 'given'; readonly personId: string; readonly name: string }
    | { readonly kind: 'not_given'; readonly why: 'off' | 'nobody' | 'held' | 'deletion' }> {
  if (!UUID.test(conversationId)) return { kind: 'not_given', why: 'held' };
  const on = (await sql<{ on: boolean }>`select rotation_on as on from businesses where id = ${businessId}::uuid`.execute(tx)).rows[0]?.on === true;
  if (!on) return { kind: 'not_given', why: 'off' };
  // A deletion request waiting on this buyer: the owner's to record, never a colleague's to be handed.
  const deletion = (await sql<{ d: boolean }>`select exists (
      select 1 from conversation_signals s where s.conversation_id = ${conversationId}::uuid and s.kind = 'deletion_requested' and s.resolved_at is null)
    or exists (select 1 from deletion_asks a join conversations c on c.client_id = a.client_id
                where c.id = ${conversationId}::uuid and a.state = 'waiting') as d`.execute(tx)).rows[0]?.d === true;
  if (deletion) return { kind: 'not_given', why: 'deletion' };
  const rows = (await sql<{ id: string; name: string; in_rotation: boolean; kind: string; away_until: Date | null; rotation_last_at: Date | null; created_at: Date }>`
    select id::text as id, name, in_rotation, kind, away_until, rotation_last_at, created_at from people
     where business_id = ${businessId}::uuid and archived_at is null and in_rotation
     order by id for update`.execute(tx)).rows;
  const members: RotationMember[] = rows.map((r) => ({ id: r.id, inRotation: r.in_rotation, archived: false, accountant: r.kind === 'accountant',
    awayUntil: r.away_until, lastGivenAt: r.rotation_last_at, joinedAt: r.created_at }));
  const next = nextInRotation(members, now);
  if (!next) return { kind: 'not_given', why: 'nobody' };
  const moved = (await sql`update conversations set assigned_to = ${next}, assigned_at = ${now}
    where business_id = ${businessId}::uuid and id = ${conversationId}::uuid and assigned_to = ${WAITING_HUMAN_AGENT}`.execute(tx)).numAffectedRows ?? 0n;
  if (moved === 0n) return { kind: 'not_given', why: 'held' };
  await sql`update people set rotation_last_at = ${now} where id = ${next}::uuid`.execute(tx);
  // Who it went to, by id only, on the conversation's own record.
  await sql`insert into conversation_events (business_id, conversation_id, type, payload)
    values (${businessId}::uuid, ${conversationId}::uuid, 'given_in_turn', ${JSON.stringify({ to: next })}::jsonb)`.execute(tx);
  return { kind: 'given', personId: next, name: rows.find((r) => r.id === next)!.name };
}
