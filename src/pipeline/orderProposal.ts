import { sql } from 'kysely';
import { withTenantTx, lockConversation, type Db } from '../db/client.js';
import { tenantRepos } from '../db/repos.js';
import type { BusinessId, ConversationId } from '../core/types/ids.js';
import { confirmableFromProposal } from '../core/commerce/confirmable.js';
import { orderConfirmedReply } from '../core/conversation/templates.js';
import { lockProposal, decideProposal } from '../db/orderProposals.js';
import { assistantHold } from '../db/assistantStop.js';
import { takeOver } from '../conversations/takeover.js';

/**
 * 0080 — THE OWNER'S TAP ON AN ORDER.
 *
 * A customer's "yes" to "shall I confirm?" is written down as a proposal
 * (db/orderProposals.ts) and nothing else happens. The owner decides it here,
 * in one of two ways, and nowhere else:
 *
 *   confirm  — the order is created from exactly what the customer said yes
 *              to, through the one order writer; the conversation closes; and
 *              only now is the customer told it is confirmed. The message goes
 *              through the existing outbound path like an approved draft, so
 *              every gate still applies to it.
 *   step in  — the owner takes the conversation, and the proposal is set
 *              aside. Nothing is created and nothing is sent: the owner answers
 *              the customer in their own words.
 *
 * Idempotent: the proposal is locked FOR UPDATE and decided only while it is
 * pending, so a double tap or a refresh cannot create or send twice.
 *
 * Not owner-only, by the rule in core/conversation/people.ts: a sales
 * assistant "can record an order". The price was set when the customer said
 * yes; nothing here changes one.
 */

export type ProposalOutcome =
  | 'confirmed'          // the order exists and the confirmation is queued
  | 'set_aside'          // the owner stepped in; nothing created, nothing sent
  | 'not_found'          // no such proposal on this conversation
  | 'already_decided'    // someone decided it already (idempotent no-op)
  | 'incomplete'         // the proposal cannot make an order (a product or price is gone)
  | 'assistant_stopped'  // 0070 — stopped on every channel: it stays waiting
  | 'assistant_silenced'; // 0071 — ops paused sending: it stays waiting

export type ProposalDeps = {
  readonly db: Db;
  readonly now: () => Date;
  /** The existing outbound path (main.ts: boss.send(QUEUES.outbound, …)). */
  readonly kickOutbound: (businessId: string, conversationId: string, reply: string) => Promise<void>;
};

export async function confirmOrderProposal(
  deps: ProposalDeps,
  input: { businessId: BusinessId; conversationId: string; proposalId: string; decidedBy: string },
): Promise<{ outcome: ProposalOutcome; orderReference?: string }> {
  const now = deps.now();
  const r = await withTenantTx(deps.db, input.businessId, async (tx): Promise<{
    outcome: ProposalOutcome; orderReference?: string; sendText: string | null;
  }> => {
    const p = await lockProposal(tx, input.conversationId, input.proposalId);
    if (!p) return { outcome: 'not_found', sendText: null };
    if (p.state !== 'pending') return { outcome: 'already_decided', sendText: null };
    await lockConversation(tx, input.conversationId);

    // The confirmation is Nomi's sentence, sent in the assistant's place: while
    // the assistant is stopped (0070) or ops has paused sending (0071), the
    // send gate would refuse it after the order was made and the conversation
    // closed. Refused here instead, before anything changes; it stays waiting.
    const hold = await assistantHold(tx, input.businessId);
    if (hold) return { outcome: hold === 'silenced' ? 'assistant_silenced' : 'assistant_stopped', sendText: null };

    const confirmable = confirmableFromProposal(p);
    if (!confirmable.ok) return { outcome: 'incomplete', sendText: null };

    const repos = tenantRepos(tx, input.businessId);
    const cid = input.conversationId as ConversationId;
    const created = await repos.orders.create(cid, confirmable.value, input.decidedBy);
    await decideProposal(tx, { proposalId: p.id, state: 'confirmed', orderId: created.orderId, by: input.decidedBy, at: now });
    await repos.events.append(cid, 'order_created', {
      orderId: created.orderId, alreadyExisted: created.alreadyExisted, proposalId: p.id, actor: input.decidedBy,
    });
    if (!created.alreadyExisted) await repos.conversations.close(cid);
    const sendText = created.alreadyExisted ? null : orderConfirmedReply({
      orderReference: created.orderReference,
      productName: p.productName,
      quantity: p.quantity,
      unit: p.unit,
    });
    return { outcome: 'confirmed', orderReference: created.orderReference, sendText };
  });

  if (r.sendText) await deps.kickOutbound(input.businessId, input.conversationId, r.sendText);
  return r.orderReference ? { outcome: r.outcome, orderReference: r.orderReference } : { outcome: r.outcome };
}

/**
 * The other answer to a proposal: the owner steps into the conversation. The
 * proposal is set aside in the same transaction as it is read, then the
 * conversation is taken over by the same service as the take-over button. If
 * the owner already holds it, it stays theirs.
 */
export async function stepIntoOrder(
  deps: Pick<ProposalDeps, 'db' | 'now'>,
  input: { businessId: BusinessId; conversationId: string; proposalId: string; decidedBy: string },
): Promise<{ outcome: ProposalOutcome }> {
  const now = deps.now();
  const r = await withTenantTx(deps.db, input.businessId, async (tx): Promise<ProposalOutcome> => {
    const p = await lockProposal(tx, input.conversationId, input.proposalId);
    if (!p) return 'not_found';
    if (p.state !== 'pending') return 'already_decided';
    await decideProposal(tx, { proposalId: p.id, state: 'set_aside', orderId: null, by: input.decidedBy, at: now });
    await sql`
      insert into conversation_events (business_id, conversation_id, type, payload)
      values (${input.businessId}, ${input.conversationId}, 'order_set_aside',
              ${JSON.stringify({ proposalId: p.id, actor: input.decidedBy })}::jsonb)`.execute(tx);
    return 'set_aside';
  });
  if (r !== 'set_aside') return { outcome: r };
  await takeOver({ db: deps.db, now: deps.now }, {
    businessId: input.businessId, conversationId: input.conversationId, actor: input.decidedBy,
  });
  return { outcome: 'set_aside' };
}
