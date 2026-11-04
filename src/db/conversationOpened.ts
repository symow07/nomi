import { sql } from 'kysely';
import { withTenantTx, type Db } from './client.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * A conversation was opened, so its row on the Customers list stops being bold (0223). Never waits on a turn holding the
 * row, and never costs the owner the page: a mark missed is a name still bold until the next opening.
 */
export async function markConversationOpened(db: Db, bid: BusinessId, conversationId: string): Promise<void> {
  try {
    await withTenantTx(db, bid, (tx) => sql`
      update conversations set owner_opened_at = now()
       where id in (select id from conversations where id = ${conversationId}::uuid and business_id = ${bid} for update skip locked)`.execute(tx));
  } catch {
    // The page goes on; see above.
  }
}
