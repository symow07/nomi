import { sql } from 'kysely';
import { withTenantTx, lockConversation, type Db } from '../db/client.js';
import { tenantRepos } from '../db/repos.js';
import type { BusinessId, ConversationId } from '../core/types/ids.js';

/**
 * A5.4 — "hand this buyer to Yasmin": the owner moves ONE conversation to
 * another of her assistants.
 *
 * Who answers is otherwise decided once, when a conversation starts. This is
 * the only other writer of `conversations.assistant_id`, and it changes who
 * SPEAKS — name, job, tone — and nothing about what may be said: facts, prices
 * and guards are the business's. It is recorded in the conversation's own
 * history, with who did it, like every other hand-over.
 */

export type AssistantHandover =
  | { readonly outcome: 'changed' | 'same'; readonly name: string }
  | { readonly outcome: 'not_found' | 'unknown_assistant' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handToAssistant(
  db: Db,
  input: { businessId: BusinessId; conversationId: string; assistantId: string; actor: string },
): Promise<AssistantHandover> {
  if (!UUID.test(input.conversationId)) return { outcome: 'not_found' };
  if (!UUID.test(input.assistantId)) return { outcome: 'unknown_assistant' };
  return withTenantTx(db, input.businessId, async (tx) => {
    await lockConversation(tx, input.conversationId);
    // Who answers NOW: its own assistant, else the main one.
    const conv = (await sql<{ current: string | null }>`
      select coalesce(c.assistant_id,
               (select d.id from assistants d
                 where d.business_id = c.business_id and d.is_default and d.archived_at is null))::text as current
        from conversations c
       where c.id = ${input.conversationId}::uuid and c.business_id = ${input.businessId}::uuid`.execute(tx)).rows[0];
    if (!conv) return { outcome: 'not_found' as const };

    // Only someone still on the team can be handed a buyer.
    const to = (await sql<{ id: string; name: string }>`
      select id::text as id, name from assistants
       where id = ${input.assistantId}::uuid and business_id = ${input.businessId}::uuid
         and archived_at is null limit 1`.execute(tx)).rows[0];
    if (!to) return { outcome: 'unknown_assistant' as const };
    if (conv.current === to.id) return { outcome: 'same' as const, name: to.name };

    await sql`update conversations set assistant_id = ${to.id}::uuid
               where id = ${input.conversationId}::uuid and business_id = ${input.businessId}::uuid`.execute(tx);
    await tenantRepos(tx, input.businessId).events.append(
      input.conversationId as ConversationId, 'assistant_changed',
      { actor: input.actor, from: conv.current, to: to.id });
    return { outcome: 'changed' as const, name: to.name };
  });
}
