import { sql } from 'kysely';
import { type Tx, type Db, withTenantTx } from './client.js';
import { type BusinessId, parseBusinessId } from '../core/types/ids.js';
import { type Currency, parseCurrency } from '../core/types/money.js';
import { currencyOfCountry } from '../core/owner/currencies.js';

/**
 * CUR (2026-09-30) — the workspace's one currency (`businesses.currency`,
 * chosen at sign-up, changed on the profile page until the first price is
 * set). Every price the owner types is in it, and every figure the workspace
 * quotes. A value this build does not hold cannot be stored (0092's check);
 * USD is what every workspace made before CUR kept.
 */
export async function currencyOf(tx: Tx, businessId: BusinessId | string): Promise<Currency> {
  const c = (await sql<{ c: string | null }>`select currency as c from businesses where id = ${businessId}::uuid`
    .execute(tx)).rows[0]?.c;
  return parseCurrency(c ?? '') ?? 'USD';
}

/** The same, for a route that holds no transaction of its own. */
export async function workspaceCurrency(db: Db, businessIdRaw: string): Promise<Currency> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return 'USD';
  return withTenantTx(db, bid.value, (tx) => currencyOf(tx, bid.value));
}

/**
 * Has the workspace set any price yet? Once it has, its currency is fixed:
 * changing it would leave figures in two currencies, and a workspace that
 * sells in two waits for CONV. A price is a product's list price, a tier, a
 * floor, a quote, an order, a sample's price or a stated rate.
 */
export async function hasPrices(tx: Tx, businessId: BusinessId | string): Promise<boolean> {
  const r = (await sql<{ priced: boolean }>`
    select exists (select 1 from products where business_id = ${businessId}::uuid and price_usd_per_unit is not null)
        or exists (select 1 from price_tiers t join products p on p.id = t.product_id where p.business_id = ${businessId}::uuid)
        or exists (select 1 from pricing_policy where business_id = ${businessId}::uuid)
        or exists (select 1 from quotes where business_id = ${businessId}::uuid)
        or exists (select 1 from orders where business_id = ${businessId}::uuid)
        or exists (select 1 from sample_policy where business_id = ${businessId}::uuid and price_amount is not null)
        or exists (select 1 from owner_rates where business_id = ${businessId}::uuid) as priced`.execute(tx)).rows[0];
  return r?.priced ?? false;
}

/**
 * CUR — the rate page's pair: the currency the workspace sells in, and the one
 * its country's shops count in, when that one is on the list and is another.
 * A shop in Mumbai that sells in dollars sees USD → INR; one that sells in
 * rupees has nothing to convert, and no rate page. Null when there is no pair.
 */
export async function ratePairOf(tx: Tx, businessId: BusinessId | string): Promise<{ readonly from: Currency; readonly to: Currency } | null> {
  const country = (await sql<{ country: string | null }>`select country from businesses where id = ${businessId}::uuid`
    .execute(tx)).rows[0]?.country ?? null;
  const from = await currencyOf(tx, businessId);
  const to = currencyOfCountry(country);
  return to !== null && to !== from ? { from, to } : null;
}
