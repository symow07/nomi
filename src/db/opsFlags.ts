import { sql } from 'kysely';
import type { Tx } from './client.js';
import { switchesFrom, type KillSwitches, type OpsFlagRow } from '../core/ops/killSwitch.js';

/**
 * M34.6 — the one place production READS ops_flags (migration 0014).
 *
 * Before this, nothing did. `INCIDENT-PLAYBOOK.md` told an operator to insert a
 * `global_silence` row during an incident; the insert committed, the row sat
 * there, and the employee kept sending. This module is the missing half.
 *
 * It only SELECTs. Flags are written by ops as the table owner, never by the
 * application — the app role holds select and nothing else on this table
 * (0014's `tenant_read_app` policy), so a compromised app cannot silence a
 * tenant and, more importantly, cannot un-silence one.
 *
 * `business_id is null` means platform-wide. RLS already restricts the visible
 * rows to this tenant's plus the global ones; the explicit predicate is
 * belt-and-braces, the same convention as the rest of the read models.
 */
export async function loadKillSwitches(tx: Tx, businessId: string): Promise<KillSwitches> {
  const res = await sql<OpsFlagRow>`
    select flag, capability
      from ops_flags
     where cleared_at is null
       and (business_id is null or business_id = ${businessId}::uuid)
  `.execute(tx);
  return switchesFrom(res.rows);
}
