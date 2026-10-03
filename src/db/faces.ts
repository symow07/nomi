import { sql } from 'kysely';
import { createHash } from 'node:crypto';
import type { Db, Tx } from './client.js';

/**
 * THE WARMTH RUN (2026-10-03) — customers' photos, kept (0123).
 *
 * Pages ask one question, `faceVersions`: which of these customers has a
 * photo, and which version — the face is drawn from that and nothing is
 * fetched while a page renders. The bytes are read by one route
 * (`/app/faces/:clientId`), under the business's row security. The job that
 * fills the table (src/worker/faces.ts) is the only writer.
 */

/** The photo's version for each customer that has one kept; customers with none are absent. */
export async function faceVersions(tx: Tx, clientIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(clientIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0) return new Map();
  const rows = (await sql<{ client_id: string; version: string }>`
    select client_id::text as client_id, version from client_faces
     where state = 'kept' and client_id = any(${ids}::uuid[])`.execute(tx)).rows;
  return new Map(rows.map((r) => [r.client_id, r.version]));
}

/** The kept photo itself, for the route that serves it. */
export async function keptFace(tx: Tx, clientId: string): Promise<{ readonly type: string; readonly bytes: Buffer; readonly version: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return null;
  const r = (await sql<{ content_type: string; bytes: Buffer; version: string }>`
    select content_type, bytes, version from client_faces
     where client_id = ${clientId}::uuid and state = 'kept'`.execute(tx)).rows[0];
  return r ? { type: r.content_type, bytes: r.bytes, version: r.version } : null;
}

export type FaceDue = { readonly businessId: string; readonly clientId: string; readonly channel: 'instagram' | 'messenger'; readonly channelUserId: string };

/** Who is due a look, across businesses (0123's `faces_due`, which says when). */
export async function facesDue(db: Db, max: number): Promise<readonly FaceDue[]> {
  const rows = (await sql<{ business_id: string; client_id: string; channel: string; channel_user_id: string }>`
    select business_id::text as business_id, client_id::text as client_id, channel, channel_user_id
      from faces_due(${max})`.execute(db)).rows;
  return rows.flatMap((r) => r.channel === 'instagram' || r.channel === 'messenger'
    ? [{ businessId: r.business_id, clientId: r.client_id, channel: r.channel, channelUserId: r.channel_user_id }] : []);
}

/** What a look found: a photo, no photo, or no answer. */
export type FaceFound =
  | { readonly state: 'kept'; readonly type: string; readonly bytes: Buffer }
  | { readonly state: 'none' }
  | { readonly state: 'failed' };

/**
 * Writes what a look found. A failure never takes away a photo already kept:
 * the old one stays shown, and the look is tried again later.
 */
export async function recordFace(tx: Tx, businessId: string, clientId: string, found: FaceFound): Promise<void> {
  if (found.state === 'kept') {
    const version = createHash('sha256').update(found.bytes).digest('hex').slice(0, 12);
    await sql`
      insert into client_faces (client_id, business_id, state, content_type, bytes, version, tried_at, kept_at, attempts)
      values (${clientId}::uuid, ${businessId}::uuid, 'kept', ${found.type}, ${found.bytes}, ${version}, now(), now(), 1)
      on conflict (client_id) do update set state = 'kept', content_type = excluded.content_type, bytes = excluded.bytes,
        version = excluded.version, tried_at = now(), kept_at = now(), attempts = 1`.execute(tx);
    return;
  }
  if (found.state === 'none') {
    await sql`
      insert into client_faces (client_id, business_id, state, tried_at, attempts)
      values (${clientId}::uuid, ${businessId}::uuid, 'none', now(), 1)
      on conflict (client_id) do update set state = 'none', content_type = null, bytes = null, version = null,
        kept_at = null, tried_at = now(), attempts = 1`.execute(tx);
    return;
  }
  await sql`
    insert into client_faces (client_id, business_id, state, tried_at, attempts)
    values (${clientId}::uuid, ${businessId}::uuid, 'failed', now(), 1)
    on conflict (client_id) do update set
      tried_at = now(),
      attempts = case when client_faces.state = 'failed' then client_faces.attempts + 1 else 1 end,
      state = case when client_faces.state = 'kept' then 'kept' else 'failed' end`.execute(tx);
}
