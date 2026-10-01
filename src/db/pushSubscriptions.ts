import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { isPushEndpoint } from '../net/webPush.js';

/**
 * G5b (0098) — the phones that asked for alerts. A store: it decides nothing.
 * One live row per address; turning alerts on again from the same phone keeps
 * one row; a phone the push service says is gone is archived, never deleted.
 */

export type PhoneSubscription = {
  readonly id: string; readonly personId: string | null; readonly endpoint: string;
  readonly p256dh: string; readonly auth: string; readonly device: string | null; readonly createdAt: Date;
};

/** What the browser handed over, checked: an https push address and two keys of the right size. */
export function readSubscription(raw: string): { readonly endpoint: string; readonly p256dh: string; readonly auth: string } | null {
  try {
    const o = JSON.parse(raw) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    const endpoint = typeof o.endpoint === 'string' ? o.endpoint : '';
    const p256dh = typeof o.keys?.p256dh === 'string' ? o.keys.p256dh : '';
    const auth = typeof o.keys?.auth === 'string' ? o.keys.auth : '';
    if (!isPushEndpoint(endpoint) || endpoint.length > 2000) return null;
    if (Buffer.from(p256dh, 'base64url').length !== 65 || Buffer.from(auth, 'base64url').length !== 16) return null;
    return { endpoint, p256dh, auth };
  } catch {
    return null;
  }
}

export async function savePhone(
  tx: Tx, bid: BusinessId, personId: string | null,
  sub: { readonly endpoint: string; readonly p256dh: string; readonly auth: string }, device: string | null,
): Promise<string> {
  const kept = (await sql<{ id: string }>`
    select id::text as id from push_subscriptions where business_id = ${bid} and endpoint = ${sub.endpoint} and archived_at is null`
    .execute(tx)).rows[0];
  if (kept) {
    await sql`update push_subscriptions set p256dh = ${sub.p256dh}, auth = ${sub.auth}, person_id = ${personId}::uuid,
              device = ${device} where id = ${kept.id}::uuid`.execute(tx);
    return kept.id;
  }
  return (await sql<{ id: string }>`
    insert into push_subscriptions (business_id, person_id, endpoint, p256dh, auth, device)
    values (${bid}, ${personId}::uuid, ${sub.endpoint}, ${sub.p256dh}, ${sub.auth}, ${device})
    returning id::text as id`.execute(tx)).rows[0]!.id;
}

/** Every live phone of the business, or only one person's. */
export async function livePhones(tx: Tx, bid: BusinessId, personId?: string | null): Promise<PhoneSubscription[]> {
  const rows = (await sql<{ id: string; person_id: string | null; endpoint: string; p256dh: string; auth: string; device: string | null; created_at: Date }>`
    select id::text as id, person_id::text as person_id, endpoint, p256dh, auth, device, created_at
      from push_subscriptions
     where business_id = ${bid} and archived_at is null
       ${personId === undefined ? sql`` : personId === null ? sql`and person_id is null` : sql`and person_id = ${personId}::uuid`}
     order by created_at`.execute(tx)).rows;
  return rows.map((r) => ({ id: r.id, personId: r.person_id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth, device: r.device, createdAt: r.created_at }));
}

export async function archivePhone(tx: Tx, bid: BusinessId, id: string, reason: 'removed' | 'gone', personId?: string | null): Promise<boolean> {
  const r = await sql<{ id: string }>`
    update push_subscriptions set archived_at = now(), archived_reason = ${reason}
     where business_id = ${bid} and id = ${id}::uuid and archived_at is null
       ${personId === undefined ? sql`` : personId === null ? sql`and person_id is null` : sql`and person_id = ${personId}::uuid`}
    returning id::text as id`.execute(tx);
  return r.rows.length > 0;
}

export async function markPhoneSent(tx: Tx, id: string): Promise<void> {
  await sql`update push_subscriptions set last_sent_at = now() where id = ${id}::uuid`.execute(tx);
}
