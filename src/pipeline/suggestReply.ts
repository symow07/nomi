import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import { withTenantTx } from '../db/client.js';
import type { BusinessId, ConversationId } from '../core/types/ids.js';
import type { Analyzer, ReplyWriter } from '../llm/ports.js';
import { tenantRepos } from '../db/repos.js';
import { hybridRetriever } from '../retrieval/hybrid.js';
import { recordSpendAlone } from '../db/usage.js';
import { allowanceOf, allowanceUsed } from '../db/allowance.js';
import { computeTurn } from './turn.js';

/**
 * "SUGGEST A REPLY" (Block 3 PR 4). One tap gives the person holding a conversation the words the assistant would
 * write now, in the voice the owner chose for it (tone, length, emoji, "how we talk": 0228), for them to read, change
 * and send themselves. It NEVER sends: the words go back to whoever asked, nothing else.
 *
 * The words are the real turn's — the same retriever, analyser and writer, and every guard on them (the figure guard,
 * price-first, the claims policy, the deletion and promise rules, 您). A person holds the conversation, so the turn
 * would stop at its first gate; for this reading only, the hold is lifted and the open signals are set aside, INSIDE A
 * TRANSACTION THAT IS ROLLED BACK with everything the turn touched (as the case checks run, 0230): no draft, no turn,
 * no quote, no signal and no state is kept, so a suggestion is never evidence for the ramp. A message that itself asks
 * for a person, a stock question, anything the turn hands over on its own words, gives no suggestion.
 *
 * Not offered, and no model asked: a conversation with a deletion request waiting (the assistant says nothing there,
 * rule 18), one where the customer has written nothing, or a day's allowance used. The model calls are paid, so they
 * go on the workspace's ledger in their own transaction.
 */

/** `unavailable`: the installation has no writer to ask (the route's own answer; this function never gives it). */
export type SuggestRefusal = 'not_found' | 'nothing_to_answer' | 'deletion' | 'allowance' | 'no_reply' | 'unavailable';
export type Suggestion = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: SuggestRefusal };

/** The paths whose words a person may take: the writer's, the owner's own taught answer, an order's own status. */
const WORDED: ReadonlySet<string> = new Set(['model', 'taught_answer', 'order_status']);
/** How many of the customer's unanswered messages the reading answers at once, as a batch does. */
const RUN = 5;

class RolledBack { constructor(readonly value: { reply: string | null; path: string; usage: { llmCalls: number; inputTokens: number; outputTokens: number; cachedInputTokens: number } }) {} }

export type SuggestDeps = {
  readonly db: Db; readonly businessId: BusinessId; readonly conversationId: string;
  readonly models: { readonly analyzer: Analyzer; readonly replyWriter: ReplyWriter };
  readonly publicBaseUrl: string | null;
};

export async function suggestReply(d: SuggestDeps): Promise<Suggestion> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.conversationId)) return { ok: false, reason: 'not_found' };
  const cid = d.conversationId;
  const first = await withTenantTx(d.db, d.businessId, async (tx) => {
    const there = (await sql<{ n: number }>`select count(*)::int as n from conversations where id = ${cid}::uuid and business_id = ${d.businessId}::uuid`.execute(tx)).rows[0]!.n > 0;
    if (!there) return { refused: 'not_found' as const };
    const deletion = (await sql<{ yes: boolean }>`
      select exists (select 1 from deletion_asks where conversation_id = ${cid}::uuid and state = 'waiting')
          or exists (select 1 from conversation_signals where conversation_id = ${cid}::uuid and kind = 'deletion_requested' and resolved_at is null) as yes`.execute(tx)).rows[0]!.yes;
    if (deletion) return { refused: 'deletion' as const };
    // The customer's newest run of messages: from their latest one back to the seller's side's last word before it.
    const rows = (await sql<{ ref: string; text: string | null; heard: boolean; direction: string }>`
      select coalesce(external_id, id::text) as ref, coalesce(transcription, text_content) as text,
             (transcription is not null) as heard, direction
        from messages where conversation_id = ${cid}::uuid order by sent_at desc, id desc limit 40`.execute(tx)).rows;
    const from = rows.findIndex((r) => r.direction === 'inbound');
    const run: typeof rows = [];
    for (const r of from < 0 ? [] : rows.slice(from)) { if (r.direction !== 'inbound' || run.length >= RUN) break; run.push(r); }
    run.reverse();
    const said = run.filter((r) => (r.text ?? '').trim().length > 0);
    if (said.length === 0) return { refused: 'nothing_to_answer' as const };
    if (allowanceUsed(await allowanceOf(tx))) return { refused: 'allowance' as const };
    return { run: said };
  });
  if ('refused' in first) return { ok: false, reason: first.refused };

  const run = first.run;
  let out: RolledBack['value'];
  try {
    await withTenantTx(d.db, d.businessId, async (tx) => {
      // For this reading only: rolled back below with everything else.
      await sql`update conversations set assigned_to = null where id = ${cid}::uuid and business_id = ${d.businessId}::uuid`.execute(tx);
      await sql`update conversation_signals set resolved_at = now() where conversation_id = ${cid}::uuid and resolved_at is null`.execute(tx);
      const ports = { tenant: tenantRepos(tx, d.businessId), retriever: hybridRetriever(tx, d.businessId), analyzer: d.models.analyzer,
        replyWriter: d.models.replyWriter, now: () => new Date(), publicBaseUrl: d.publicBaseUrl };
      const r = await computeTurn(ports, {
        conversationId: cid as ConversationId, messageId: run.at(-1)!.ref, text: run.map((m) => m.text!.trim()).join('\n'),
        answering: run.map((m) => m.ref), ...(run.some((m) => m.heard) ? { provenance: 'transcribed' as const } : {}),
      });
      throw new RolledBack({ reply: r.reply, path: r.answerPath, usage: r.usage });
    });
    throw new Error('suggestReply: the reading was kept');
  } catch (e) {
    if (!(e instanceof RolledBack)) throw e;
    out = e.value;
  }
  if (out.usage.llmCalls > 0) await recordSpendAlone(d.db, d.businessId, out.usage, { turn: false });
  const text = out.reply?.trim() ?? '';
  return WORDED.has(out.path) && text.length > 0 ? { ok: true, text } : { ok: false, reason: 'no_reply' };
}
