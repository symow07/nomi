import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * WA (0120) — the WhatsApp number a business connected itself through
 * Embedded Signup. A store, like `metaAccounts`: it decides nothing, and the
 * business token arrives encrypted and leaves encrypted.
 */

export type WhatsAppAccount = {
  readonly id: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly display: string | null;
  readonly verifiedName: string | null;
  readonly nameStatus: string | null;
  readonly ciphertext: string;
  readonly connectedBy: string;
  readonly connectedAt: Date;
  /** Set when a send found the token dead. The owner is asked to connect again. */
  readonly needsAttention: 'revoked' | 'refused' | null;
};

export async function liveWhatsAppAccount(tx: Tx, businessId: BusinessId): Promise<WhatsAppAccount | null> {
  const r = (await sql<{
    id: string; waba_id: string; phone_number_id: string; display_phone: string | null; verified_name: string | null;
    name_status: string | null; token_ciphertext: string; connected_by: string; connected_at: Date; last_error: 'revoked' | 'refused' | null;
  }>`select id::text as id, waba_id, phone_number_id, display_phone, verified_name, name_status, token_ciphertext,
            connected_by, connected_at, last_error
       from whatsapp_accounts where business_id = ${businessId}::uuid and archived_at is null limit 1`.execute(tx)).rows[0];
  return r ? {
    id: r.id, wabaId: r.waba_id, phoneNumberId: r.phone_number_id, display: r.display_phone, verifiedName: r.verified_name,
    nameStatus: r.name_status, ciphertext: r.token_ciphertext, connectedBy: r.connected_by, connectedAt: r.connected_at,
    needsAttention: r.last_error,
  } : null;
}

/**
 * A new connection archives the live one in the same transaction: one number
 * per business. `number_taken` is the other index speaking — another business
 * holds that number, invisible under RLS, so the conflict is how we learn it.
 */
export async function connectWhatsAppAccount(
  tx: Tx, businessId: BusinessId,
  input: {
    readonly wabaId: string; readonly phoneNumberId: string; readonly display: string | null;
    readonly verifiedName: string | null; readonly nameStatus: string | null;
    readonly ciphertext: string; readonly fingerprint: string; readonly pinCiphertext: string | null; readonly by: string;
  },
): Promise<{ readonly ok: true; readonly id: string } | { readonly ok: false; readonly reason: 'number_taken' }> {
  await archiveWhatsAppAccount(tx, businessId, input.by);
  try {
    const r = (await sql<{ id: string }>`
      insert into whatsapp_accounts
        (business_id, waba_id, phone_number_id, display_phone, verified_name, name_status,
         token_ciphertext, fingerprint, pin_ciphertext, connected_by)
      values (${businessId}::uuid, ${input.wabaId}, ${input.phoneNumberId}, ${input.display}, ${input.verifiedName},
              ${input.nameStatus}, ${input.ciphertext}, ${input.fingerprint}, ${input.pinCiphertext}, ${input.by})
      returning id::text as id`.execute(tx)).rows[0]!;
    return { ok: true, id: r.id };
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return { ok: false, reason: 'number_taken' };
    throw e;
  }
}

export async function archiveWhatsAppAccount(tx: Tx, businessId: BusinessId, by: string): Promise<boolean> {
  const r = await sql`update whatsapp_accounts set archived_at = now(), archived_by = ${by}
                       where business_id = ${businessId}::uuid and archived_at is null`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

/**
 * The credential row that ROUTES: `resolve_tenant('whatsapp', phone_number_id)`
 * finds the business by its number, and `secret_ref` names the row that holds
 * the token. One WhatsApp credential per business: a business that used the
 * installation's number and now connects its own re-points the same row. The
 * channel keeps its activation and pilot mode — a new number is still the
 * owner's WhatsApp, and going live stays the owner's step.
 */
export async function linkWhatsAppCredentials(
  tx: Tx, businessId: BusinessId,
  input: { readonly accountId: string; readonly phoneNumberId: string; readonly display: string | null; readonly actor: string },
): Promise<'linked' | 'number_taken'> {
  const secretRef = `whatsapp_accounts:${input.accountId}`;
  const existing = (await sql<{ id: string }>`
    select id::text as id from channel_credentials where business_id = ${businessId} and channel = 'whatsapp' limit 1`.execute(tx)).rows[0];
  let credId: string | undefined;
  try {
    credId = existing
      ? (await sql<{ id: string }>`
          update channel_credentials set external_ref = ${input.phoneNumberId}, secret_ref = ${secretRef}, is_active = true
           where id = ${existing.id}::uuid returning id::text as id`.execute(tx)).rows[0]?.id
      : (await sql<{ id: string }>`
          insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
          values (${businessId}, 'whatsapp', ${input.phoneNumberId}, ${secretRef}, 'service')
          on conflict (channel, external_ref) do nothing
          returning id::text as id`.execute(tx)).rows[0]?.id;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return 'number_taken';
    throw e;
  }
  if (!credId) return 'number_taken';
  const channelRow = (await sql<{ id: string }>`
    insert into channels (business_id, kind, status, credential_id, display_phone, connected_at, disconnected_at, updated_at)
    values (${businessId}, 'whatsapp', 'connected', ${credId}::uuid, ${input.display}, now(), null, now())
    on conflict (business_id, kind) do update
      set status = 'connected', credential_id = excluded.credential_id, display_phone = excluded.display_phone,
          connected_at = now(), disconnected_at = null, updated_at = now()
    returning id::text as id`.execute(tx)).rows[0]!;
  await sql`
    insert into channel_audit (business_id, channel_id, action, actor, detail)
    values (${businessId}, ${channelRow.id}::uuid, 'connect', ${input.actor},
            ${JSON.stringify({ channel: 'whatsapp', number: input.phoneNumberId, via: 'embedded_signup' })}::jsonb)`.execute(tx);
  return 'linked';
}

/** Disconnect: the credential switches off, so Meta's next delivery is dropped; nothing is erased. */
export async function unlinkWhatsAppCredentials(tx: Tx, businessId: BusinessId, actor: string): Promise<void> {
  await sql`update channel_credentials set is_active = false
             where business_id = ${businessId} and channel = 'whatsapp' and secret_ref like 'whatsapp_accounts:%'`.execute(tx);
  const row = (await sql<{ id: string }>`
    update channels set status = 'disconnected', disconnected_at = now(), updated_at = now()
     where business_id = ${businessId} and kind = 'whatsapp' returning id::text as id`.execute(tx)).rows[0];
  if (row) {
    await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
              values (${businessId}, ${row.id}::uuid, 'disconnect', ${actor}, ${JSON.stringify({ channel: 'whatsapp', via: 'embedded_signup' })}::jsonb)`.execute(tx);
  }
}

/** The token is dead: recorded once, so the page asks the owner and every later send says why. */
export async function markWhatsAppNeedsAttention(tx: Tx, accountId: string, reason: 'revoked' | 'refused'): Promise<void> {
  await sql`update whatsapp_accounts set needs_attention_at = coalesce(needs_attention_at, now()), last_error = ${reason}
             where id = ${accountId}::uuid and archived_at is null`.execute(tx);
}
