import { sql } from 'kysely';
import type { Db } from './client.js';
import { signupModeFrom, type SignupMode } from '../core/owner/signup.js';

/**
 * BOT (0114) — the sign-up's guards in the database: the operator's switch,
 * read on every request, and the per-caller and per-domain limits, which
 * survive a deploy and are shared by every process. The app reaches both only
 * through definer functions; the tables are not its own.
 */

/** The operator's switch: open, invite or closed; null follows the deployment's SIGNUP_MODE. */
export async function signupModeSet(db: Db): Promise<SignupMode | null> {
  const r = (await sql<{ mode: string | null }>`select signup_mode_set() as mode`.execute(db)).rows[0];
  return r?.mode ? signupModeFrom(r.mode) : null;
}

/** Counts one try this UTC hour; false once the key is past its limit. The key is stored only as its hash. */
export async function claimSignupThrottle(db: Db, kind: 'caller' | 'domain', key: string, limit: number): Promise<boolean> {
  const r = (await sql<{ ok: boolean }>`select claim_signup_throttle(${kind}, ${key}, ${limit}::int) as ok`.execute(db)).rows[0];
  return r?.ok === true;
}
