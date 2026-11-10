import { sql } from 'kysely';
import { withTenantTx, type Db } from './client.js';
import { parseBusinessId } from '../core/types/ids.js';
import { currencyOf } from './currency.js';
import { createImport } from './catalogImports.js';
import { itemsToRows } from '../core/onboard/storeFeed.js';
import { liveRows } from '../core/onboard/importReview.js';
import { defaultUnitFor } from '../core/owner/sellingStyle.js';
import { readShopifyForm } from '../core/onboard/shopifyGraphql.js';
import { readShopifyStore, type ShopifyTransport } from '../net/shopifyAdmin.js';
import type { ShopifyForm, ShopifyRefusal } from '../core/onboard/setupMinutes.js';

/**
 * BLOCK 4.4 — A PASSWORD-PROTECTED SHOPIFY STORE, READ WITH THE OWNER'S OWN APP, INTO THE K1 REVIEW.
 *
 * What the owner posted (the address, and the token or the Client ID and secret) is read once (`readShopifyForm`),
 * the store's ACTIVE products read (src/net/shopifyAdmin.ts), and they become the same kept review a public store's
 * feed makes (`catalog_imports`, kind `store`): every K1 rule then applies — ticks, the currency, floors. The kept row
 * holds the store's address and the products; no credential is ever passed to it, nor to the refusal: a refused form
 * comes back with the address alone and every credential field empty (C0's `ShopifyForm`).
 *
 * The shop states its currency, so K8's rule is "it must be the workspace's" — a store in another currency adds
 * nothing (`currency_mismatch`), and there is nothing for the owner's tick to confirm.
 */
export type ShopifyImportResult = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly form: ShopifyForm };

const refusedForm = (address: string, refusal: ShopifyRefusal): ShopifyForm =>
  ({ address, token: '', client_id: '', client_secret: '', refusal });

export async function startShopifyImport(db: Db, businessIdRaw: string, actor: string,
  fields: Readonly<Record<string, unknown>>, transport: ShopifyTransport): Promise<ShopifyImportResult> {
  const bid = parseBusinessId(businessIdRaw);
  const form = readShopifyForm(fields);
  if (!form.ok) return { ok: false, form: refusedForm(form.address, form.refusal) };
  if (!bid.ok) return { ok: false, form: refusedForm(form.shop, 'unavailable') };
  const { currency, kind } = await withTenantTx(db, bid.value, async (tx) => ({
    currency: await currencyOf(tx, bid.value),
    kind: (await sql<{ kind: string | null }>`select kind from businesses where id = ${bid.value}::uuid`.execute(tx)).rows[0]?.kind ?? null,
  }));
  const read = await readShopifyStore({ shop: form.shop, credential: form.credential, currency }, transport);
  if (!read.ok) return { ok: false, form: refusedForm(form.shop, read.refusal) };
  const rows = itemsToRows(read.items, { defaultUnit: defaultUnitFor(kind), source: new URL(form.shop).host });
  if (liveRows(rows).length === 0) return { ok: false, form: refusedForm(form.shop, 'no_products') };
  const id = await withTenantTx(db, bid.value, (tx) =>
    createImport(tx, bid.value, { kind: 'store', currency, sourceText: form.shop, rows, createdBy: actor }));
  return { ok: true, id };
}
