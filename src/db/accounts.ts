import { sql } from 'kysely';
import { type Db, withTenantTx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * A1 — the questions asked BEFORE a tenant is known, and the one act that
 * makes a tenant.
 *
 * Every function here goes through a definer function of migration 0055, not
 * a table: the application role has no tenant set at the door, so row-level
 * security would (rightly) show it nothing. `resolve_tenant` answers "whose
 * number is this?" the same way for a webhook.
 */

export type LoginRow = {
  readonly loginId: string; readonly businessId: string;
  readonly person: { readonly id: string; readonly name: string; readonly isOwner: boolean };
  readonly passwordHash: string; readonly lockedUntil: Date | null;
};

export async function lookupLogin(db: Db, email: string): Promise<LoginRow | null> {
  const r = (await sql<{
    login_id: string; business_id: string; person_id: string; person_name: string;
    is_owner: boolean; password_hash: string; locked_until: Date | null;
  }>`select login_id::text as login_id, business_id::text as business_id, person_id::text as person_id,
            person_name, is_owner, password_hash, locked_until
       from login_lookup(${email})`.execute(db)).rows[0];
  if (!r) return null;
  return {
    loginId: r.login_id, businessId: r.business_id,
    person: { id: r.person_id, name: r.person_name, isOwner: r.is_owner },
    passwordHash: r.password_hash, lockedUntil: r.locked_until,
  };
}

export async function recordLoginAttempt(db: Db, loginId: string, ok: boolean): Promise<void> {
  await sql`select login_record(${loginId}::uuid, ${ok})`.execute(db);
}

/** A staff code names its own business — see `person_for_code` (0055). */
export async function personForCodeHash(db: Db, codeHash: string): Promise<{
  readonly businessId: string; readonly person: { readonly id: string; readonly name: string; readonly isOwner: boolean };
} | null> {
  const r = (await sql<{ business_id: string; person_id: string; person_name: string; is_owner: boolean }>`
    select business_id::text as business_id, person_id::text as person_id, person_name, is_owner
      from person_for_code(${codeHash})`.execute(db)).rows[0];
  return r ? { businessId: r.business_id, person: { id: r.person_id, name: r.person_name, isOwner: r.is_owner } } : null;
}

export async function inviteIsOpen(db: Db, invite: string): Promise<boolean> {
  const r = (await sql<{ open: boolean }>`select invite_is_open(${invite}::uuid) as open`.execute(db)).rows[0];
  return r?.open === true;
}

export type ProvisionOutcome =
  | { readonly code: 'created'; readonly businessId: string; readonly personId: string }
  | { readonly code: 'email_taken' | 'invite_not_open' | 'failed' };

/**
 * A business, its owner and the owner's login — together or not at all. The
 * caller passes a HASH; a password never reaches this module.
 */
export async function provisionAccount(db: Db, input: {
  readonly factory: string; readonly language: string; readonly ownerName: string;
  readonly email: string; readonly passwordHash: string;
  readonly invite: string | null; readonly inviteRequired: boolean;
  /** A2 — what sign-up asked about the business. Checked again by the columns of 0056. */
  readonly profile: {
    readonly kind: string; readonly sells: string; readonly country: string;
    readonly website: string | null; readonly teamSize: string; readonly channels: readonly string[];
  };
}): Promise<ProvisionOutcome> {
  try {
    const r = (await sql<{ business_id: string; person_id: string }>`
      select business_id::text as business_id, person_id::text as person_id
        from provision_workspace(${input.factory}, ${input.language}, ${input.ownerName},
                                 ${input.email}, ${input.passwordHash},
                                 ${input.invite}::uuid, ${input.inviteRequired},
                                 ${JSON.stringify(input.profile)}::jsonb)`.execute(db)).rows[0];
    return r ? { code: 'created', businessId: r.business_id, personId: r.person_id } : { code: 'failed' };
  } catch (e) {
    const pg = e as { code?: string; message?: string };
    if (pg.code === '23505') return { code: 'email_taken' };
    if (pg.code === 'P0001' && /invite_not_open/.test(pg.message ?? '')) return { code: 'invite_not_open' };
    return { code: 'failed' };
  }
}

/** The live businesses the clock has something to do for — see `live_business_ids` (0055). */
export async function liveBusinessIds(db: Db): Promise<readonly string[]> {
  const r = await sql<{ business_id: string }>`select business_id::text as business_id from live_business_ids()`.execute(db);
  return r.rows.map((x) => x.business_id);
}

// ── Inside a tenant ─────────────────────────────────────────────────────────

/** The signed-in person's own login, if she has one (the pilot's owner signs in by code and has none). */
export async function loginOfPerson(db: Db, businessId: BusinessId, personId: string): Promise<{
  readonly email: string; readonly passwordHash: string;
} | null> {
  if (!/^[0-9a-f-]{36}$/i.test(personId)) return null;
  return withTenantTx(db, businessId, async (tx) => {
    const r = (await sql<{ email: string; password_hash: string }>`
      select email, password_hash from logins
       where business_id = ${businessId}::uuid and person_id = ${personId}::uuid and archived_at is null
       limit 1`.execute(tx)).rows[0];
    return r ? { email: r.email, passwordHash: r.password_hash } : null;
  });
}

export async function setPassword(db: Db, businessId: BusinessId, personId: string, passwordHash: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(personId)) return false;
  return withTenantTx(db, businessId, async (tx) => {
    const r = await sql`
      update logins
         set password_hash = ${passwordHash}, password_changed_at = now(), failed_attempts = 0, locked_until = null
       where business_id = ${businessId}::uuid and person_id = ${personId}::uuid and archived_at is null`.execute(tx);
    return Number(r.numAffectedRows ?? 0) === 1;
  });
}
