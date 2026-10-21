import { sql } from 'kysely';
import type { Tx } from './client.js';
import { credentialFingerprint, decryptSecret, encryptSecret } from '../security/credentials.js';
import type { ConnectRefusalReason, Grant } from '../core/books/connector.js';

/**
 * B3–B5 (Phase 5; 0179) — THE SHOP'S SYSTEMS THE BOOKS ARE CONNECTED TO. One row per system (`books_connections`):
 * where, the grant (sealed in `connector_credentials` with CREDENTIAL_KEY, like every token — tools/rekey.mjs knows
 * the column), and how the last read went. Nothing here is ever deleted: a new grant archives the old, a disconnect
 * archives the grant and says so.
 */
export type ConnectedSystem = 'sheets' | 'odoo' | 'xero' | 'quickbooks';
export type BooksConnection = {
  readonly system: ConnectedSystem;
  readonly state: 'connected' | 'connect_again' | 'stopped' | 'disconnected';
  readonly reason: ConnectRefusalReason | null;
  readonly settings: Readonly<Record<string, string>>;
  readonly keyExpiresOn: string | null;
  readonly cursor: string | null;
  /** ISO 8601, as JSON writes a timestamp. */
  readonly connectedAt: string;
  readonly lastReadAt: string | null;
  readonly lastOkAt: string | null;
  /** The grant, opened — null when there is none, or it no longer opens with this installation's key. */
  readonly grant: Grant | null;
};

/** Connect (or connect again): the grant sealed, the old one archived, the connection's row set to connected. */
export async function saveConnection(tx: Tx, credentialKey: Buffer, input: {
  readonly businessId: string; readonly system: ConnectedSystem; readonly secret: string; readonly by: string;
  readonly settings: Readonly<Record<string, string>>; readonly keyExpiresOn?: string | null;
}): Promise<void> {
  await sql`update connector_credentials set archived_at = now(), archived_by = ${input.by}
    where business_id = ${input.businessId}::uuid and connector = ${input.system} and archived_at is null`.execute(tx);
  const id = (await sql<{ id: string }>`insert into connector_credentials (business_id, connector, secret_ciphertext, fingerprint, created_by)
    values (${input.businessId}::uuid, ${input.system}, ${encryptSecret(input.secret, credentialKey)}, ${credentialFingerprint(input.secret)}, ${input.by})
    returning id::text as id`.execute(tx)).rows[0]!.id;
  await sql`insert into books_connections (business_id, system, state, reason, settings, credential_id, key_expires_on, connected_by)
    values (${input.businessId}::uuid, ${input.system}, 'connected', null, ${JSON.stringify(input.settings)}::jsonb, ${id}::uuid,
            ${input.keyExpiresOn ?? null}::date, ${input.by})
    on conflict (business_id, system) do update set state = 'connected', reason = null, settings = excluded.settings,
      credential_id = excluded.credential_id, key_expires_on = excluded.key_expires_on, cursor = null,
      connected_at = now(), connected_by = excluded.connected_by`.execute(tx);
}

/**
 * D8 — a grant the system ROTATED (Xero: every refresh returns the next refresh token, and the one before stops
 * working): kept at once, the way a connection's is — the old one archived, never deleted — and the connection left
 * as it is otherwise. Called before the new token is used, so a crash after a refresh never strands the grant.
 */
export async function rotateGrant(tx: Tx, credentialKey: Buffer, businessId: string, system: ConnectedSystem, secret: string, by: string): Promise<void> {
  await sql`update connector_credentials set archived_at = now(), archived_by = ${by}
    where business_id = ${businessId}::uuid and connector = ${system} and archived_at is null`.execute(tx);
  const id = (await sql<{ id: string }>`insert into connector_credentials (business_id, connector, secret_ciphertext, fingerprint, created_by)
    values (${businessId}::uuid, ${system}, ${encryptSecret(secret, credentialKey)}, ${credentialFingerprint(secret)}, ${by})
    returning id::text as id`.execute(tx)).rows[0]!.id;
  await sql`update books_connections set credential_id = ${id}::uuid where business_id = ${businessId}::uuid and system = ${system}`.execute(tx);
}

/** The connection, with its grant opened; null when this system was never connected. */
export async function loadConnection(tx: Tx, credentialKey: Buffer, businessId: string, system: ConnectedSystem): Promise<BooksConnection | null> {
  const r = (await sql<{ state: BooksConnection['state']; reason: string | null; settings: Record<string, string>; key_expires_on: string | null;
    cursor: string | null; connected_at: string; last_read_at: string | null; last_ok_at: string | null; secret: string | null }>`
    select c.state, c.reason, c.settings, c.key_expires_on::text as key_expires_on, c.cursor,
           -- in UTC, as the app counts days (a session in another zone made a key's age a day short before 08:00 there)
           to_char(c.connected_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as connected_at, to_json(c.last_read_at) #>> '{}' as last_read_at,
           to_json(c.last_ok_at) #>> '{}' as last_ok_at, k.secret_ciphertext as secret
      from books_connections c left join connector_credentials k on k.id = c.credential_id and k.archived_at is null
     where c.business_id = ${businessId}::uuid and c.system = ${system}`.execute(tx)).rows[0];
  if (!r) return null;
  let grant: Grant | null = null;
  if (r.secret) { try { grant = { secret: decryptSecret(r.secret, credentialKey).plain, expiresAt: r.key_expires_on }; } catch { grant = null; } }
  return {
    system, state: r.state, reason: (r.reason as ConnectRefusalReason | null), settings: r.settings ?? {}, keyExpiresOn: r.key_expires_on,
    cursor: r.cursor, connectedAt: r.connected_at, lastReadAt: r.last_read_at, lastOkAt: r.last_ok_at, grant,
  };
}

/**
 * How a read went. A refusal that waits on the owner (revoked, expired, gone) changes the state, and the page says so;
 * one that only needs time (Google or Odoo did not answer) changes nothing but the time it was tried.
 */
export async function noteRead(tx: Tx, businessId: string, system: ConnectedSystem,
  outcome: { readonly ok: true; readonly cursor: string | null } | { readonly ok: false; readonly reason: ConnectRefusalReason }): Promise<void> {
  if (outcome.ok) {
    await sql`update books_connections set last_read_at = now(), last_ok_at = now(), cursor = ${outcome.cursor}, reason = null
      where business_id = ${businessId}::uuid and system = ${system}`.execute(tx);
    return;
  }
  const state = outcome.reason === 'unreachable' ? null : outcome.reason === 'key_expired' ? 'stopped' : 'connect_again';
  await sql`update books_connections set last_read_at = now(), reason = ${outcome.reason}, state = coalesce(${state}, state)
    where business_id = ${businessId}::uuid and system = ${system}`.execute(tx);
}

/** Disconnect: the grant archived (never deleted), the row says so. */
export async function disconnectSystem(tx: Tx, businessId: string, system: ConnectedSystem, by: string): Promise<void> {
  await sql`update connector_credentials set archived_at = now(), archived_by = ${by}
    where business_id = ${businessId}::uuid and connector = ${system} and archived_at is null`.execute(tx);
  await sql`update books_connections set state = 'disconnected', reason = null, credential_id = null
    where business_id = ${businessId}::uuid and system = ${system}`.execute(tx);
}
