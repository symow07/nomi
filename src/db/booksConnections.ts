import { sql } from 'kysely';
import type { Tx } from './client.js';
import { credentialFingerprint, decryptSecret, encryptSecret } from '../security/credentials.js';
import type { ConnectRefusalReason, Grant, RevokeOutcome } from '../core/books/connector.js';

/**
 * B3–B5 (Phase 5; 0179) — THE SHOP'S SYSTEMS THE BOOKS ARE CONNECTED TO. One row per system (`books_connections`):
 * where, the grant (sealed in `connector_credentials` with CREDENTIAL_KEY, like every token — tools/rekey.mjs knows
 * the column), and how the last read went. Nothing here is ever deleted: a new grant archives the old, a disconnect
 * archives the grant and says so.
 *
 * 0212 — A STALE GRANT: one Nomi no longer uses that the system has not confirmed given back (QuickBooks, Xero). Its
 * row says so (`stale_since`), the books' page shows it, and src/books/staleGrants.ts tries again every hour.
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

/** The systems whose grants are given back at the system, and kept track of until they are (0212). */
const GIVES_BACK: ReadonlySet<ConnectedSystem> = new Set(['xero', 'quickbooks']);

/**
 * Connect (or connect again): the grant sealed, the old one archived, the connection's row set to connected. An old
 * QuickBooks or Xero grant still held here was NOT given back first (src/books/staleGrants.ts gives it back before the
 * consent, and the callback never does — it could end the new grant too): it is archived as stale, and `stale` says so.
 */
export async function saveConnection(tx: Tx, credentialKey: Buffer, input: {
  readonly businessId: string; readonly system: ConnectedSystem; readonly secret: string; readonly by: string;
  readonly settings: Readonly<Record<string, string>>; readonly keyExpiresOn?: string | null;
}): Promise<{ readonly stale: boolean }> {
  const old = await sql<{ id: string; stale: boolean }>`update connector_credentials set archived_at = now(), archived_by = ${input.by},
      stale_since = case when ${GIVES_BACK.has(input.system)} and revoked_at is null then now() end
    where business_id = ${input.businessId}::uuid and connector = ${input.system} and archived_at is null
    returning id::text as id, stale_since is not null as stale`.execute(tx);
  const id = (await sql<{ id: string }>`insert into connector_credentials (business_id, connector, secret_ciphertext, fingerprint, created_by)
    values (${input.businessId}::uuid, ${input.system}, ${encryptSecret(input.secret, credentialKey)}, ${credentialFingerprint(input.secret)}, ${input.by})
    returning id::text as id`.execute(tx)).rows[0]!.id;
  await sql`insert into books_connections (business_id, system, state, reason, settings, credential_id, key_expires_on, connected_by)
    values (${input.businessId}::uuid, ${input.system}, 'connected', null, ${JSON.stringify(input.settings)}::jsonb, ${id}::uuid,
            ${input.keyExpiresOn ?? null}::date, ${input.by})
    on conflict (business_id, system) do update set state = 'connected', reason = null, settings = excluded.settings,
      credential_id = excluded.credential_id, key_expires_on = excluded.key_expires_on, cursor = null,
      connected_at = now(), connected_by = excluded.connected_by`.execute(tx);
  return { stale: old.rows.some((r) => r.stale) };
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

/**
 * Disconnect: the grant archived (never deleted), the row says so. `gaveBack` is how giving it back at the system went:
 * confirmed, the row says when; not confirmed (QuickBooks, Xero), it is a stale grant from now on.
 */
export async function disconnectSystem(tx: Tx, businessId: string, system: ConnectedSystem, by: string, gaveBack?: RevokeOutcome): Promise<void> {
  const done = gaveBack === 'given_back'; const stale = gaveBack === 'not_given_back' && GIVES_BACK.has(system);
  await sql`update connector_credentials set archived_at = now(), archived_by = ${by},
      revoked_at = case when ${done} then now() end, stale_since = case when ${stale} then now() end,
      revoke_tries = revoke_tries + ${gaveBack === undefined || gaveBack === 'nothing_held' ? 0 : 1}
    where business_id = ${businessId}::uuid and connector = ${system} and archived_at is null`.execute(tx);
  await sql`update books_connections set state = 'disconnected', reason = null, credential_id = null
    where business_id = ${businessId}::uuid and system = ${system}`.execute(tx);
}

/** A grant still in use that the system did not confirm given back (connecting again goes on: the owner is not locked out). */
export async function noteGiveBackTried(tx: Tx, businessId: string, system: ConnectedSystem): Promise<void> {
  await sql`update connector_credentials set revoke_tries = revoke_tries + 1
    where business_id = ${businessId}::uuid and connector = ${system} and archived_at is null`.execute(tx);
}

export type StaleGrant = {
  readonly id: string; readonly system: 'xero' | 'quickbooks'; readonly staleSince: Date; readonly tries: number;
  /** The grant, opened — null when it no longer opens with this installation's key (nothing can give it back then). */
  readonly grant: Grant | null;
};
/** This workspace's stale grants, oldest first: archived, not confirmed given back, and young enough to live there (0212). */
export async function staleGrants(tx: Tx, credentialKey: Buffer | null, businessId: string): Promise<StaleGrant[]> {
  const rows = (await sql<{ id: string; connector: 'xero' | 'quickbooks'; stale_since: Date; revoke_tries: number; secret: string }>`
    select id::text as id, connector, stale_since, revoke_tries, secret_ciphertext as secret from connector_credentials
     where business_id = ${businessId}::uuid and archived_at is not null and stale_since is not null and revoked_at is null
       and connector in ('xero', 'quickbooks') and created_at > now() - interval '100 days'
     order by stale_since, id`.execute(tx)).rows;
  return rows.map((r) => {
    let grant: Grant | null = null;
    if (credentialKey) { try { grant = { secret: decryptSecret(r.secret, credentialKey).plain, expiresAt: null }; } catch { grant = null; } }
    return { id: r.id, system: r.connector, staleSince: new Date(r.stale_since), tries: r.revoke_tries, grant };
  });
}

/** One more try at giving a stale grant back: confirmed, it is done; not, it is counted. */
export async function noteStaleTried(tx: Tx, id: string, outcome: RevokeOutcome): Promise<void> {
  await sql`update connector_credentials set revoke_tries = revoke_tries + 1,
      revoked_at = case when ${outcome === 'given_back'} then now() else revoked_at end
    where id = ${id}::uuid and stale_since is not null and revoked_at is null`.execute(tx);
}
