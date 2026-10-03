import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { parseAlertChannel, type AlertChannel } from '../core/owner/alertChannel.js';
import { channelIsLive } from './backups.js';
import { livePhones, type PhoneSubscription } from './pushSubscriptions.js';

/**
 * THE WARMTH RUN (2026-10-03), phase 8 — each person's way out of Nomi (0124),
 * and the facts the default is decided from. A store: what to do with them is
 * `src/core/owner/alertChannel.ts`'s.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One person, as notifications see them: their choice, their sign-in address, and whether they own the business. */
export type AlertPerson = {
  readonly id: string;
  readonly isOwner: boolean;
  readonly choice: AlertChannel | null;
  readonly email: string | null;
};

type PersonRow = { id: string; is_owner: boolean; alert_channel: string | null; email: string | null };

/** The person's sign-in address: their first live login, as `ownerLoginEmail` reads the owner's. */
const EMAIL = sql<string | null>`(select l.email from logins l
   where l.person_id = p.id and l.business_id = p.business_id and l.archived_at is null
   order by l.created_at limit 1)`;

const personOf = (r: PersonRow): AlertPerson =>
  ({ id: r.id, isOwner: r.is_owner, choice: parseAlertChannel(r.alert_channel), email: r.email });

/**
 * The person a session names. A session opened with the deployment's own
 * access code carries no person row (`personOf` in app.ts says 'owner'): it
 * is the owner, so it reads and writes the owner's row.
 */
export async function alertPerson(tx: Tx, bid: BusinessId, sessionPersonId: string): Promise<AlertPerson | null> {
  const r = (await sql<PersonRow>`
    select p.id::text as id, p.is_owner, p.alert_channel, ${EMAIL} as email
      from people p
     where p.business_id = ${bid} and p.archived_at is null
       and ${UUID.test(sessionPersonId) ? sql`p.id = ${sessionPersonId}::uuid` : sql`p.is_owner`}
     limit 1`.execute(tx)).rows[0];
  return r ? personOf(r) : null;
}

/** Write a person's way: a choice, or null for "the default". */
export async function saveAlertChoice(tx: Tx, bid: BusinessId, personId: string, choice: AlertChannel | null): Promise<boolean> {
  if (!UUID.test(personId)) return false;
  const r = await sql<{ id: string }>`
    update people set alert_channel = ${choice}
     where business_id = ${bid} and id = ${personId}::uuid and archived_at is null
    returning id::text as id`.execute(tx);
  return r.rows.length > 0;
}

/** The owner's alert number, the owner's language, and whether a channel is live. */
export async function ownerAlertFacts(tx: Tx, bid: BusinessId): Promise<{
  readonly locale: string; readonly ownerPhone: string | null; readonly channelLive: boolean;
} | null> {
  const row = (await sql<{ owner_locale: string; owner_phone: string | null }>`
    select owner_locale, owner_phone from businesses where id = ${bid}`.execute(tx)).rows[0];
  if (!row) return null;
  return { locale: row.owner_locale, ownerPhone: row.owner_phone, channelLive: await channelIsLive(tx, bid) };
}

/** A person a notification goes to, with the phones and browsers that turned alerts on. */
export type InterruptionPerson = AlertPerson & { readonly phones: readonly PhoneSubscription[] };

/**
 * WHO HEARS OF THE TWO INTERRUPTIONS: the owner, always (as before, e-mail
 * to the owner's sign-in address was always there); and each colleague who
 * asked — by choosing a way on Notifications, or (0124) by having turned on
 * phone alerts before that page existed. A phone turned on through the
 * owner's access code carries no person (`phonePerson` in app.ts): it is the
 * owner's.
 *
 * A workspace with no owner row (one seeded straight into the tables; every
 * sign-up and 0035 gave the rest theirs) still has an owner — the one the
 * access code lets in, with the business's alert number: they are heard the
 * default way, with no sign-in address.
 */
export async function interruptionPeople(tx: Tx, bid: BusinessId): Promise<InterruptionPerson[]> {
  const rows = (await sql<PersonRow>`
    select p.id::text as id, p.is_owner, p.alert_channel, ${EMAIL} as email
      from people p
     where p.business_id = ${bid} and p.archived_at is null and (p.is_owner or p.alert_channel is not null)
     order by p.is_owner desc, p.created_at, p.id`.execute(tx)).rows;
  const phones = await livePhones(tx, bid);
  const people: InterruptionPerson[] = rows.map((r) => ({
    ...personOf(r),
    phones: phones.filter((ph) => ph.personId === r.id || (r.is_owner && ph.personId === null)),
  }));
  return people.some((x) => x.isOwner) ? people
    : [{ id: '', isOwner: true, choice: null, email: null, phones: phones.filter((ph) => ph.personId === null) }, ...people];
}
