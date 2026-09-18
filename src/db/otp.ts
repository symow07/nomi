import { sql } from 'kysely';
import type { Db } from './client.js';

/**
 * A3 — the three things the application may do with a waiting code. Each is a
 * definer function of migration 0058; the table itself is closed to this role.
 */

export async function issueOtp(db: Db, input: {
  readonly email: string; readonly purpose: 'signup' | 'device'; readonly codeHash: string;
  readonly payload: unknown | null; readonly loginId: string | null; readonly ttlSeconds: number;
}): Promise<string | null> {
  const r = (await sql<{ id: string | null }>`
    select otp_issue(${input.email}, ${input.purpose}, ${input.codeHash},
                     ${input.payload === null ? null : JSON.stringify(input.payload)}::jsonb,
                     ${input.loginId}::uuid, ${input.ttlSeconds})::text as id`.execute(db)).rows[0];
  return r?.id ?? null;
}

export async function reissueOtp(db: Db, id: string, codeHash: string, ttlSeconds: number): Promise<
  { readonly id: string; readonly email: string; readonly purpose: 'signup' | 'device' } | null
> {
  const r = (await sql<{ id: string; email: string; purpose: 'signup' | 'device' }>`
    select id::text as id, email, purpose from otp_reissue(${id}::uuid, ${codeHash}, ${ttlSeconds})`.execute(db)).rows[0];
  return r ?? null;
}

export type OtpRedeemed =
  | { readonly ok: true; readonly email: string; readonly purpose: 'signup' | 'device'; readonly payload: unknown; readonly loginId: string | null }
  | { readonly ok: false; readonly reason: 'gone' | 'expired' | 'spent' | 'wrong' };

export async function redeemOtp(db: Db, id: string, codeHash: string): Promise<OtpRedeemed> {
  const r = (await sql<{
    ok: boolean; reason: 'gone' | 'expired' | 'spent' | 'wrong' | null; email: string | null;
    purpose: 'signup' | 'device' | null; payload: unknown; login_id: string | null;
  }>`select ok, reason, email, purpose, payload, login_id::text as login_id
       from otp_redeem(${id}::uuid, ${codeHash})`.execute(db)).rows[0];
  if (!r || !r.ok || !r.email || !r.purpose) return { ok: false, reason: r?.reason ?? 'gone' };
  return { ok: true, email: r.email, purpose: r.purpose, payload: r.payload, loginId: r.login_id };
}
