import { sql } from 'kysely';
import type { Tx } from './client.js';

/**
 * G4 (0102) — may this workspace send anything alone yet? Yes for every
 * workspace the operator made; for one that signed itself up, only once it
 * has earned it (`auto_earned_at`: the ramp, or the operator for a pilot). A
 * practice copy answers as its workspace does. Asked in a transaction bound to
 * the business: the function answers for that one only, and says no outside.
 */
export async function sendingAloneEarned(tx: Tx): Promise<boolean> {
  return (await sql<{ earned: boolean }>`select sending_alone_earned() as earned`.execute(tx)).rows[0]?.earned === true;
}
