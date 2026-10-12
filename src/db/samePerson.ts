import { sql } from 'kysely';
import type { Tx } from './client.js';

/**
 * D3 (the data-protection audit, 2026-10-12; 0139) — THE SAME PERSON.
 *
 * A person who writes on two channels can be two customer rows: a WhatsApp
 * number and an e-mail address, say. The database's one definition
 * (`same_person_clients`) reaches every row of the business that shares a
 * normalised phone number, e-mail address or channel account with this one,
 * and onward. A customer's erasure takes them all; the buyer page names them
 * before the owner deletes. Read through `customer_same_person`, which takes
 * the workspace from the transaction.
 */
export type SamePersonRecord = { readonly clientId: string; readonly name: string | null; readonly channel: string | null };

export async function samePersonOf(tx: Tx, clientId: string): Promise<readonly SamePersonRecord[]> {
  return (await sql<{ id: string; name: string | null; channel: string | null }>`
    select cl.id::text as id, cl.display_name as name,
           coalesce((select cc.channel from client_channels cc where cc.client_id = cl.id order by cc.created_at, cc.id limit 1),
                    (select v.channel from conversations v where v.client_id = cl.id order by v.created_at, v.id limit 1)) as channel
      from customer_same_person(${clientId}::uuid) as s(id)
      join clients cl on cl.id = s.id
     order by cl.created_at, cl.id`.execute(tx)).rows.map((r) => ({ clientId: r.id, name: r.name, channel: r.channel }));
}
