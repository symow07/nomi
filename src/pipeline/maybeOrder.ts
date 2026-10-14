import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { withTenantTx, type Db } from '../db/client.js';
import { tenantRepos } from '../db/repos.js';
import { proposeOrder } from '../db/orderProposals.js';
import { computeQuote } from '../core/commerce/quote.js';
import { confirmableFromProposal } from '../core/commerce/confirmable.js';
import { parseEmail, type BusinessId, type ClientId, type ConversationId } from '../core/types/ids.js';
import type { Money } from '../core/types/money.js';

/**
 * THE "MAY BE SAYING YES" CARD'S WAY TO A REAL ORDER — the owner's, in two deliberate steps (the owner, on PR 345:
 * "what do I actually do when the buyer HAS said yes in a phrasing that wasn't on the list? If my only route is to ask
 * the buyer to repeat themselves, I'm annoying a customer who already confirmed… if it's a dead end, build one.")
 *
 * It was a dead end: an order exists only through a proposal (0080), a proposal only from the turn's own "yes", and a
 * maybe is handed to a person — no turn runs while a person holds the conversation, so nothing the buyer said next
 * could become one either.
 *
 * Step one, here: the owner, having read the buyer's words and the price they were given, PREPARES the order — the
 * product, a quantity (the one priced, or the one the buyer named), the buyer's e-mail. The price is the one this buyer
 * was actually given for that quantity; where they were never given one, the list price for it (`computeQuote`, never
 * below her floor), and the order card says plainly that this price was never sent to them. Nothing is confirmed and
 * nothing is sent. Step two is the order card's own Confirm (`confirmOrderProposal`), with every fact above it.
 *
 * Not owner-only, like the order card (core/conversation/people.ts: staff record orders); the price is never typed.
 */
export type PrepareOutcome =
  | 'prepared'          // a proposal waits on the order card
  | 'no_maybe'          // nothing waits as "may be saying yes" (already prepared, or handed back)
  | 'already_waiting'   // an order already waits for a tap
  | 'bad_email'
  | 'bad_quantity'
  | 'no_product'        // the product is gone, or none was ever identified
  | 'not_priceable';    // no price for that quantity (below the minimum, no tier, a closed catalogue)

export async function prepareOrderFromMaybe(
  db: Db,
  input: { businessId: BusinessId; conversationId: string; quantity: number; email: string; by: string },
): Promise<{ outcome: PrepareOutcome; quoted?: boolean }> {
  const email = parseEmail(input.email);
  if (!email.ok) return { outcome: 'bad_email' };
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100_000_000) return { outcome: 'bad_quantity' };

  return withTenantTx(db, input.businessId, async (tx) => {
    const cid = input.conversationId as ConversationId;
    const maybe = (await sql<{ payload: { offer?: { productId?: string } | null; messageId?: string } | null }>`
      select payload from conversation_signals
       where conversation_id = ${input.conversationId}::uuid and kind = 'maybe_confirmation' and resolved_at is null
       order by created_at desc limit 1 for update`.execute(tx)).rows[0];
    if (!maybe) return { outcome: 'no_maybe' };
    const repos = tenantRepos(tx, input.businessId);
    if (await repos.orderProposals.waiting(cid)) return { outcome: 'already_waiting' };

    const conv = (await sql<{ client_id: string; product: string | null }>`
      select c.client_id::text as client_id, cs.identified_product_id::text as product
        from conversations c left join conversation_state cs on cs.conversation_id = c.id
       where c.id = ${input.conversationId}::uuid`.execute(tx)).rows[0];
    const productId = maybe.payload?.offer?.productId ?? conv?.product ?? null;
    const product = conv && productId ? await repos.catalog.product(productId) : null;
    if (!conv || !product) return { outcome: 'no_product' };

    // The price this buyer was GIVEN for this quantity (G7b's record), newest first; else the list price, flagged.
    const told = [...await repos.audit.priorQuotesForClient(conv.client_id as ClientId, product.id)]
      .filter((q) => q.quantity === input.quantity)
      .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    let unitPrice: Money;
    if (told) {
      unitPrice = told.unitPrice;
    } else {
      const [tiers, policy, rules, closures] = await Promise.all([
        repos.catalog.priceTiers(product.id), repos.catalog.pricingPolicy(product.id),
        repos.catalog.negotiationRules(), repos.catalog.factoryClosures(),
      ]);
      const q = computeQuote({ product, tiers, policy, rules, quantity: input.quantity, closures, now: new Date() });
      if (!q.ok) return { outcome: 'not_priceable' };
      unitPrice = q.value.unitPrice;
    }
    const total: Money = { amount: Math.round(unitPrice.amount * input.quantity * 100) / 100, currency: unitPrice.currency };
    const order = confirmableFromProposal({
      productId: product.id, quantity: input.quantity, unit: product.unit, unitPrice, total,
      email: email.value, paymentTerms: null, incoterm: null,
    });
    if (!order.ok) return { outcome: 'not_priceable' };

    await repos.clients.saveEmail(conv.client_id as ClientId, email.value);
    // The proposal is tied to the message that may have said yes, so the order card shows those words above Confirm.
    const messageId = maybe.payload?.messageId ?? (await sql<{ id: string | null }>`
      select external_id as id from messages
       where conversation_id = ${input.conversationId}::uuid and direction = 'inbound' and external_id is not null
       order by sent_at desc limit 1`.execute(tx)).rows[0]?.id ?? `owner-${randomUUID()}`;
    const { proposalId } = await proposeOrder(tx, input.businessId, { conversationId: cid, messageId, order: order.value });
    await repos.signals.resolve(cid, 'maybe_confirmation');
    await repos.events.append(cid, 'order_prepared', {
      proposalId, actor: input.by, quantity: input.quantity, quoted: told !== undefined,
    });
    return { outcome: 'prepared', quoted: told !== undefined };
  });
}
