import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { moneyFromRow } from '../core/types/money.js';
import { formatMoney } from '../core/owner/format.js';
import { catalogueProducts, type CatalogueRow } from './waCatalogue.js';
import { liveWhatsAppAccount } from './whatsappAccounts.js';
import type { OutboundProduct } from '../channels/contract.js';

/**
 * Part B — a WhatsApp product card the OWNER sends: one item of the linked catalogue, as Meta accepted it.
 *
 * A product may be carried only while what Meta holds is what Nomi holds now: the item synced, eligible today,
 * its current fingerprint the one Meta accepted, in the catalogue and account the business's live number uses.
 * The same question is asked when the card is queued and again when the worker is about to send it, so a price,
 * photo, link or vetting changed in between refuses the card; it is never sent as its words instead.
 */

export type ProductCardSnapshot = {
  readonly itemId: string; readonly productId: string; readonly catalogId: string; readonly retailerId: string;
  readonly name: string; readonly price: string; readonly currency: string; readonly fingerprint: string;
};

function carried(p: CatalogueRow, liveAccount: string | null): boolean {
  return p.state === 'synced' && p.reasons.length === 0 && !!p.itemId && !!p.retailerId && !!p.acceptedCatalog
    && p.acceptedFingerprint === p.fingerprint && !!liveAccount && p.acceptedAccount === liveAccount && p.amount !== null;
}

/** The products a card may carry now, for the conversation page's picker. */
export async function sendableCatalogueProducts(tx: Tx, business: BusinessId): Promise<readonly ProductCardSnapshot[]> {
  const account = await liveWhatsAppAccount(tx, business);
  if (!account || account.needsAttention) return [];
  return (await catalogueProducts(tx, business)).filter((p) => carried(p, account.id)).map(snapshotOf);
}

function snapshotOf(p: CatalogueRow): ProductCardSnapshot {
  return {
    itemId: p.itemId!, productId: p.id, catalogId: p.acceptedCatalog!, retailerId: p.retailerId!,
    name: p.name, price: p.amount!, currency: p.currency, fingerprint: p.fingerprint,
  };
}

/** At enqueue: the one product, if a card may carry it now. */
export async function productCardSnapshot(tx: Tx, business: BusinessId, productId: string): Promise<ProductCardSnapshot | null> {
  return (await sendableCatalogueProducts(tx, business)).find((p) => p.productId === productId) ?? null;
}

/** What the customer's transcript says the card was: from the snapshot, never re-read. */
export function productCardText(s: Pick<ProductCardSnapshot, 'name' | 'price' | 'currency'>): string {
  const money = moneyFromRow(s.price, s.currency);
  return `Product card: ${s.name}, ${money ? formatMoney(money) : `${s.price} ${s.currency}`}`;
}

/** The snapshot kept beside the queued row: what was chosen, so the dispatch can tell whether it still holds. */
export async function recordProductCard(tx: Tx, business: BusinessId, outboundId: string, s: ProductCardSnapshot): Promise<void> {
  await sql`insert into wa_catalogue_sends(outbound_id,business_id,item_id,catalog_id,retailer_id,name,price,currency,fingerprint)
    values(${outboundId}::uuid,${business}::uuid,${s.itemId}::uuid,${s.catalogId},${s.retailerId},${s.name},${s.price},${s.currency},${s.fingerprint})`
    .execute(tx);
}

/**
 * At dispatch: the payload the adapter carries, or null when the card no longer holds (a changed or ineligible
 * product, another catalogue or number, no snapshot at all). Null is refused by the worker, never downgraded.
 */
export async function productCardPayloads(tx: Tx, business: BusinessId, outboundIds: readonly string[]): Promise<ReadonlyMap<string, OutboundProduct | null>> {
  const out = new Map<string, OutboundProduct | null>();
  if (outboundIds.length === 0) return out;
  const sends = (await sql<{ outbound_id: string; item_id: string; catalog_id: string; retailer_id: string; fingerprint: string }>`
    select outbound_id::text, item_id::text, catalog_id, retailer_id, fingerprint from wa_catalogue_sends
     where business_id=${business}::uuid and outbound_id = any(${outboundIds as string[]}::uuid[])`.execute(tx)).rows;
  const current = sends.length ? await sendableCatalogueProducts(tx, business) : [];
  for (const id of outboundIds) {
    const s = sends.find((r) => r.outbound_id === id);
    const now = s ? current.find((p) => p.itemId === s.item_id) : undefined;
    out.set(id, s && now && now.fingerprint === s.fingerprint && now.catalogId === s.catalog_id && now.retailerId === s.retailer_id
      ? { catalogId: s.catalog_id, retailerId: s.retailer_id } : null);
  }
  return out;
}
