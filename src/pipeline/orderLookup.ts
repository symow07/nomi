import { withTenantTx, type Db } from '../db/client.js';
import type { BusinessId } from '../core/types/ids.js';
import { parseEmail } from '../core/types/ids.js';
import type { OrderContext, OrderOutcome } from '../core/commerce/shopifyOrders.js';
import {
  claimOrderLookup, finishOrderLookup, lookupReadiness, noteVersionSeen, openShopifyCredential,
} from '../db/shopifyConnections.js';
import { zoneOf } from '../db/zone.js';
import { lookUpShopifyOrder, realClock, type Clock, type ShopifyPacer } from '../net/shopifyOrders.js';
import type { ShopifyTransport } from '../net/shopifyAdmin.js';
import { loggableMessage } from '../security/loggable.js';

/**
 * BLOCK 5.5 — THE TURN'S ORDER LOOKUP (`TurnPorts.orderLookup`).
 *
 * The turn calls `look` only when the customer's message carries one `#` order number (`readOrderAsk`). Then:
 *
 *   1. ITS OWN TRANSACTION, no lock the turn may hold: the connection (live, switched on, not a practice copy), the
 *      e-mail (typed, else the e-mail channel's confirmed sender), the zone, and — only when all are there — a slot
 *      from `claim_order_lookup` (five per conversation in any 60 minutes, serialised on its own advisory key).
 *      Committed before Shopify is asked, so a turn that later fails still counted its lookup.
 *   2. NO TRANSACTION OF ITS OWN: the credential is opened and Shopify asked (`lookUpShopifyOrder`, 10 s in all). The
 *      worker's turn transaction is open meanwhile, as it is while the model writes (t1r's ruling (a), 2026-11-10).
 *   3. ITS OWN TRANSACTION: the outcome on the audit row (the order's name only when verified), and the version
 *      Shopify said it served.
 *
 * 'off' — nothing connected, the switch off, a practice copy, no e-mail — asks Shopify nothing and claims nothing.
 * Every other outcome but a verified order is 'refused': the customer cannot tell which.
 */
export type OrderLookupResult =
  | { readonly kind: 'off' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'verified'; readonly order: OrderContext };

export type OrderLookup = {
  look(input: { readonly conversationId: string; readonly orderName: string; readonly email: string | null }): Promise<OrderLookupResult>;
};

export type OrderLookupDeps = {
  readonly db: Db;
  readonly businessId: BusinessId;
  readonly credentialKey: Buffer;
  readonly transport: ShopifyTransport;
  readonly pacer: ShopifyPacer;
  readonly clock?: Clock;
};

const OFF: OrderLookupResult = { kind: 'off' };
const REFUSED: OrderLookupResult = { kind: 'refused' };

export function shopifyOrderLookup(deps: OrderLookupDeps): OrderLookup {
  const clock = deps.clock ?? realClock;
  return {
    async look({ conversationId, orderName, email }) {
      const ready = await withTenantTx(deps.db, deps.businessId, async (tx) => {
        const r = await lookupReadiness(tx, deps.businessId, conversationId);
        if (!r) return null;
        const typed = email === null ? null : parseEmail(email);
        const sender = r.senderEmail === null ? null : parseEmail(r.senderEmail);
        const customerEmail = typed?.ok ? typed.value : sender?.ok ? sender.value : null;
        if (customerEmail === null) return null;
        const zone = await zoneOf(tx, deps.businessId);
        const lookupId = await claimOrderLookup(tx, conversationId);
        return { ...r, customerEmail, zone, lookupId };
      });
      if (!ready) return OFF;
      if (ready.lookupId === null) return REFUSED;

      let outcome: OrderOutcome = 'unavailable';
      let order: OrderContext | null = null;
      let version: string | null | undefined;
      try {
        const credential = openShopifyCredential(ready.ciphertext, deps.credentialKey);
        if (credential) {
          const read = await lookUpShopifyOrder({
            shop: ready.shop, credential, scopes: ready.scopes, orderName, email: ready.customerEmail, zone: ready.zone,
          }, { transport: deps.transport, pacer: deps.pacer, clock });
          outcome = read.reading.outcome;
          if (read.reading.outcome === 'verified') order = read.reading.order;
          version = read.version;
        }
      } catch (e) {
        // A fixed phrase and Shopify's own words never: nothing of the order or the credential reaches a log.
        console.error(`[shopify-orders] lookup failed: ${loggableMessage((e as Error).name)}`);
        outcome = 'unavailable';
      }

      try {
        await withTenantTx(deps.db, deps.businessId, async (tx) => {
          await finishOrderLookup(tx, ready.lookupId!, outcome, order?.name ?? null);
          if (version !== undefined && version !== ready.versionSeen) await noteVersionSeen(tx, ready.connectionId, version);
        });
      } catch {
        // The answer stands whether or not its record was finished: the row stays `asking`, and still counts.
        console.error('[shopify-orders] lookup outcome not recorded');
      }
      return outcome === 'verified' && order ? { kind: 'verified', order } : REFUSED;
    },
  };
}
