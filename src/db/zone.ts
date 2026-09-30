import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { isZone } from '../core/owner/zones.js';

/**
 * TZ (2026-09-30) — the workspace's own time zone (`businesses.timezone`,
 * chosen at sign-up, changed on the profile page). Every "today", every date
 * and time an owner reads, the daily send ceiling and the night-shift windows
 * are in it. A value this build cannot format in reads as UTC — never as
 * somebody else's zone. Metering stays in UTC (T7).
 */
export async function zoneOf(tx: Tx, businessId: BusinessId | string): Promise<string> {
  const z = (await sql<{ z: string | null }>`select timezone as z from businesses where id = ${businessId}::uuid`
    .execute(tx)).rows[0]?.z;
  return isZone(z) ? z : 'UTC';
}
