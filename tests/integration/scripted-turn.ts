import { sql } from 'kysely';
import { withTenantTx, lockConversation, type Db } from '../../src/db/client.js';
import { tenantRepos } from '../../src/db/repos.js';
import { ensureConversation } from '../../src/db/channels.js';
import { computeTurn, commitTurn } from '../../src/pipeline/turn.js';
import { parseBusinessId, parseConversationId } from '../../src/core/types/ids.js';
import { analysis } from '../../src/trust/scenarios.js';
import type { Analyzer, ReplyWriter } from '../../src/llm/ports.js';
import type { Retriever } from '../../src/retrieval/ports.js';

/**
 * ONE SCRIPTED TURN on a scratch tenant, for the tests that need a real turn's
 * rows (knowledge used, gaps) and nothing of Practice: the turn the old
 * sandbox ran in the request with stand-in models, before P3 moved Practice
 * onto the worker. A fresh conversation each time, the old one archived.
 */
const WHO = 'scripted-turn-customer';
const REPLY = 'Thanks for your message — could you tell me a little more about what you need?';

const analyzer: Analyzer = {
  analyze: async () => ({ analysis: analysis(), promptVersion: 'test@scripted', modelId: 'scripted', usage: { inputTokens: 0, outputTokens: 0 } }),
} as unknown as Analyzer;
const replyWriter: ReplyWriter = {
  write: async () => ({ reply: REPLY, promptVersion: 'test@scripted', modelId: 'scripted', usage: { inputTokens: 0, outputTokens: 0 } }),
} as unknown as ReplyWriter;
const retriever: Retriever = { byText: async () => [], byImageDescription: async () => [], explore: async () => [] };

export async function scriptedTurn(db: Db, businessRaw: string, text: string): Promise<void> {
  const b = parseBusinessId(businessRaw); if (!b.ok) throw new Error('scriptedTurn: business id');
  const businessId = b.value;
  await withTenantTx(db, businessId, async (tx) => {
    await sql`
      update conversations set is_active = false, closed_at = now()
       where business_id = ${businessId} and is_active
         and client_id in (select client_id from client_channels where channel = 'whatsapp' and channel_user_id = ${WHO})`.execute(tx);
    const { conversationId } = await ensureConversation(tx, businessId, WHO, 'Scripted customer');
    const cid = parseConversationId(conversationId); if (!cid.ok) throw new Error('scriptedTurn: conversation id');
    await lockConversation(tx, conversationId);
    const messageId = `scripted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await sql`
      insert into messages (conversation_id, direction, input_type, text_content, sent_at, external_id)
      values (${conversationId}, 'inbound', 'text', ${text}, clock_timestamp(), ${messageId})`.execute(tx);
    const ports = { tenant: tenantRepos(tx, businessId), retriever, analyzer, replyWriter, now: () => new Date() };
    const req = { conversationId: cid.value, messageId, text };
    const result = await computeTurn(ports, req);
    await commitTurn(ports, req, result, Date.now());
  });
}
