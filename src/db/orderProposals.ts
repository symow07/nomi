import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId, ConversationId } from '../core/types/ids.js';
import type { ConfirmableOrder } from '../core/types/commerce.js';
import { moneyFromRow, type Money } from '../core/types/money.js';

/**
 * 0080 — AN ORDER WAITS FOR THE OWNER'S TAP.
 *
 * A customer's "yes" to "shall I confirm?" is written here as a PROPOSAL: what
 * they said yes to, at that moment. It is not an order. Nothing is confirmed,
 * nothing is sent to the customer and the conversation stays open. The owner's
 * tap (`src/pipeline/orderProposal.ts`) turns it into an order through the one
 * order writer, and only then is the customer told; or the owner steps into
 * the conversation and it is set aside.
 *
 * One waiting per conversation (`order_proposals_one_pending`): a second "yes"
 * while one waits is the same proposal, and keeps the first time.
 */

/** A proposal waiting for the owner, as the conversation page and the turn read it. */
export type PendingProposal = {
  readonly id: string;
  readonly conversationId: string;
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly unit: string;
  readonly unitPrice: Money;
  readonly total: Money;
  readonly email: string;
  readonly paymentTerms: string | null;
  readonly incoterm: string | null;
  readonly createdAt: Date;
};

/** The row as the owner's tap reads it, under its lock. */
export type ProposalRow = PendingProposal & {
  readonly state: 'pending' | 'confirmed' | 'set_aside';
};

type Raw = {
  id: string; conversation_id: string; product_id: string; product_name: string;
  quantity: number; unit: string; unit_price: string; total: string; currency: string;
  client_email: string; payment_terms: string | null; incoterm: string | null;
  created_at: Date; state: ProposalRow['state'];
};

/**
 * A row as the product can use it. Null when its currency is not one this
 * product holds: a proposal that cannot be priced is never shown with a
 * guessed currency, and never confirmed (moneyFromRow's own rule).
 */
const rowOf = (r: Raw): ProposalRow | null => {
  const unitPrice = moneyFromRow(Number(r.unit_price), r.currency);
  const total = moneyFromRow(Number(r.total), r.currency);
  if (!unitPrice || !total) return null;
  return {
  id: r.id,
  conversationId: r.conversation_id,
  productId: r.product_id,
  productName: r.product_name,
  quantity: r.quantity,
  unit: r.unit,
  unitPrice,
  total,
  email: r.client_email,
  paymentTerms: r.payment_terms,
  incoterm: r.incoterm,
  createdAt: r.created_at,
  state: r.state,
  };
};

const SELECT = sql`
  select op.id, op.conversation_id, op.product_id, p.name as product_name,
         op.quantity, op.unit, op.unit_price::text as unit_price, op.total::text as total,
         op.currency, op.client_email, op.payment_terms, op.incoterm, op.created_at, op.state
    from order_proposals op
    join products p on p.id = op.product_id`;

/**
 * Write what the customer said yes to. Idempotent: while one waits, a second
 * "yes" returns it unchanged (`fresh: false`), so the owner is alerted once.
 */
export async function proposeOrder(
  tx: Tx,
  businessId: BusinessId,
  input: { readonly conversationId: ConversationId; readonly messageId: string; readonly order: ConfirmableOrder },
): Promise<{ readonly proposalId: string; readonly fresh: boolean }> {
  const o = input.order;
  const inserted = await sql<{ id: string }>`
    insert into order_proposals (business_id, conversation_id, client_id, turn_message_id,
                                 product_id, quantity, unit, unit_price, total, currency,
                                 client_email, payment_terms, incoterm)
    select ${businessId}::uuid, c.id, c.client_id, ${input.messageId},
           ${o.productId}::uuid, ${o.quantity.value}, ${o.quantity.unit},
           ${o.unitPrice.amount}, ${o.total.amount}, ${o.total.currency},
           ${o.email}, ${o.paymentTerms}, ${o.incoterm}
      from conversations c where c.id = ${input.conversationId}::uuid
    on conflict (conversation_id) where state = 'pending' do nothing
    returning id`.execute(tx);
  const id = inserted.rows[0]?.id;
  if (id) return { proposalId: id, fresh: true };
  const waiting = await sql<{ id: string }>`
    select id from order_proposals
     where conversation_id = ${input.conversationId}::uuid and state = 'pending'`.execute(tx);
  return { proposalId: waiting.rows[0]!.id, fresh: false };
}

/** The proposal waiting on this conversation, or null. */
export async function pendingProposalOf(tx: Tx, conversationId: string): Promise<PendingProposal | null> {
  const r = await sql<Raw>`${SELECT}
     where op.conversation_id = ${conversationId}::uuid and op.state = 'pending'`.execute(tx);
  const row = r.rows[0] ? rowOf(r.rows[0]) : null;
  if (!row) return null;
  const { state: _state, ...pending } = row;
  return pending;
}

/** One proposal, locked for the owner's decision. Null when it is not this conversation's. */
export async function lockProposal(tx: Tx, conversationId: string, proposalId: string): Promise<ProposalRow | null> {
  const r = await sql<Raw>`${SELECT}
     where op.id = ${proposalId}::uuid and op.conversation_id = ${conversationId}::uuid
     for update of op`.execute(tx);
  return r.rows[0] ? rowOf(r.rows[0]) : null;
}

/** The owner's decision, written once: `pending` → `confirmed` (with its order) or `set_aside`. */
export async function decideProposal(
  tx: Tx,
  input: { readonly proposalId: string; readonly state: 'confirmed' | 'set_aside'; readonly orderId: string | null; readonly by: string; readonly at: Date },
): Promise<void> {
  await sql`
    update order_proposals
       set state = ${input.state}, order_id = ${input.orderId}::uuid,
           decided_at = ${input.at}, decided_by = ${input.by}
     where id = ${input.proposalId}::uuid and state = 'pending'`.execute(tx);
}
