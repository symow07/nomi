import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from '../db/client.js';
import { normalizePhone } from '../core/channel/phone.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * M18.2 — the pilot allowlist: who the employee is permitted to message while
 * the channel is in pilot mode.
 *
 * Owner-controlled, tenant-scoped (RLS), and archive-not-erase — an entry is
 * archived, never deleted, so "who was reachable on the day this went wrong?"
 * stays answerable. Every add/archive writes a channel_audit row.
 *
 * The ENFORCEMENT lives in the existing send gate (core/channel/sendGate.ts);
 * this module only answers "is this number allowed?" and lets the owner manage
 * the list. There is no second gate.
 */

export type AllowlistEntry = {
  readonly id: string;
  readonly phone: string;          // normalized digits, comparison key
  readonly label: string | null;
  readonly addedBy: string;
  readonly addedAt: Date;
  readonly archivedAt: Date | null;
};

export type AllowlistResult =
  | { readonly ok: true; readonly phone: string }
  | { readonly ok: false; readonly code: 'invalid_phone' | 'not_found' };

async function audit(
  tx: Tx, businessId: BusinessId, action: 'allowlist_add' | 'allowlist_archive',
  actor: string, detail: Record<string, unknown>,
): Promise<void> {
  await sql`
    insert into channel_audit (business_id, action, actor, detail)
    values (${businessId}, ${action}, ${actor}, ${JSON.stringify(detail)}::jsonb)
  `.execute(tx);
}

/** Add (or un-archive) a number. Normalized before storage so the owner's
 *  "+971 50 …" and WhatsApp's "97150…" are the same row. */
export async function addToAllowlist(
  db: Db, businessId: BusinessId, rawPhone: string, label: string | null, actor: string,
): Promise<AllowlistResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, code: 'invalid_phone' };

  await withTenantTx(db, businessId, async (tx) => {
    await sql`
      insert into pilot_allowlist (business_id, phone, label, added_by)
      values (${businessId}, ${phone}, ${label}, ${actor})
      on conflict (business_id, phone) do update
        set archived_at = null, archived_by = null,
            label = coalesce(excluded.label, pilot_allowlist.label),
            added_by = excluded.added_by, added_at = now()
    `.execute(tx);
    await audit(tx, businessId, 'allowlist_add', actor, { phone, label });
  });
  return { ok: true, phone };
}

/** Archive a number — it stops being reachable immediately. Never deleted. */
export async function archiveFromAllowlist(
  db: Db, businessId: BusinessId, rawPhone: string, actor: string,
): Promise<AllowlistResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, code: 'invalid_phone' };

  const found = await withTenantTx(db, businessId, async (tx) => {
    const r = await sql<{ id: string }>`
      update pilot_allowlist set archived_at = now(), archived_by = ${actor}
       where business_id = ${businessId} and phone = ${phone} and archived_at is null
       returning id
    `.execute(tx);
    if (r.rows.length > 0) await audit(tx, businessId, 'allowlist_archive', actor, { phone });
    return r.rows.length > 0;
  });
  return found ? { ok: true, phone } : { ok: false, code: 'not_found' };
}

/** The owner's view: active entries first, then archived history. */
export async function listAllowlist(db: Db, businessId: BusinessId): Promise<readonly AllowlistEntry[]> {
  return withTenantTx(db, businessId, async (tx) => {
    const r = await sql<{
      id: string; phone: string; label: string | null;
      added_by: string; added_at: Date; archived_at: Date | null;
    }>`
      select id, phone, label, added_by, added_at, archived_at
        from pilot_allowlist where business_id = ${businessId}
       order by (archived_at is not null), added_at desc
    `.execute(tx);
    return r.rows.map((x): AllowlistEntry => ({
      id: x.id, phone: x.phone, label: x.label,
      addedBy: x.added_by, addedAt: x.added_at, archivedAt: x.archived_at,
    }));
  });
}

/** Count of ACTIVE entries — activation requires at least one (M18.1). */
export async function activeAllowlistCount(db: Db, businessId: BusinessId): Promise<number> {
  return withTenantTx(db, businessId, (tx) =>
    sql<{ n: number }>`
      select count(*)::int as n from pilot_allowlist
       where business_id = ${businessId} and archived_at is null
    `.execute(tx).then((r) => r.rows[0]!.n));
}

/**
 * The question the send gate needs answered, inside the caller's transaction:
 * "is this recipient allowed right now?" An unparseable number is NOT allowed —
 * never fall open.
 */
export async function isAllowlisted(tx: Tx, businessId: BusinessId, rawPhone: string | null): Promise<boolean> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return false;
  const r = await sql<{ ok: boolean }>`
    select exists(
      select 1 from pilot_allowlist
       where business_id = ${businessId} and phone = ${phone} and archived_at is null
    ) as ok
  `.execute(tx);
  return r.rows[0]?.ok ?? false;
}
