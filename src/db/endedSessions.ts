import { sql } from 'kysely';
import type { Db } from './client.js';

/**
 * 0243 — sessions ended by Log out. The session is a signed cookie with no store behind it; this is the one thing
 * kept on the server about it: the random id of a cookie whose owner signed out, until it would have expired anyway.
 * The app role reaches the table only through the two definer functions (0243), so no tenant context is needed: the
 * rows name no business and no person.
 */
export async function endSession(db: Db, sid: string, endsAtMs: number): Promise<void> {
  await sql`select end_session(${sid}::uuid, to_timestamp(${endsAtMs / 1000}))`.execute(db);
}

export async function sessionEnded(db: Db, sid: string): Promise<boolean> {
  const r = await sql<{ ended: boolean }>`select session_ended(${sid}::uuid) as ended`.execute(db);
  return r.rows[0]?.ended === true;
}
