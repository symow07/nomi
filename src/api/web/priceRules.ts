import { sql } from 'kysely';
import type { Db } from '../../db/client.js';
import { withTenantTx } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatUsd } from '../../core/owner/i18n/format.js';
import { esc, back } from './layout.js';
import { productName } from './inbox.js';
import {
  validatePriceRules, priceRuleChanges,
  type PriceRules, type PriceRuleError, type PriceRuleField,
} from '../../core/commerce/priceRules.js';

/**
 * M29 — reading and writing the owner's price rules.
 *
 * ONE STORE, the one the quote engine already reads: `pricing_policy`, keyed
 * `unique (business_id, product_id)` with NULL product_id as the business
 * default. No new table, no second source, and `repos.pricingPolicy` — which
 * `turn.ts` calls per product on every quote — picks these up unchanged.
 *
 * ABSENCE IS THE ANSWER "not yet". Nothing here writes a row the owner did not
 * ask for, and `confirmImport` no longer writes one at all.
 */

export type ProductRules = {
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly nameZh: string | null;
  /** The entry price the owner listed, when she has one. */
  readonly listPriceUsd: number | null;
  /** Her answers for THIS product, or null when she has not given any. */
  readonly own: PriceRules | null;
  /** Whether the business-wide default would apply in their absence. */
  readonly inheritsDefault: boolean;
  readonly isActive: boolean;
};

export type PriceRulesView = {
  /** Her business-wide answers, or null. */
  readonly businessDefault: PriceRules | null;
  readonly products: readonly ProductRules[];
  /** Products with a price but no rules — the ones she cannot sell yet. */
  readonly unanswered: number;
};

const toRules = (r: { floor: string; max: string; ask: string } | undefined): PriceRules | null =>
  r ? { floorUsd: Number(r.floor), maxDiscountPct: Number(r.max), askAbovePct: Number(r.ask) } : null;

export async function loadPriceRules(db: Db, businessIdRaw: string): Promise<PriceRulesView> {
  const empty: PriceRulesView = { businessDefault: null, products: [], unanswered: 0 };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return empty;

  return withTenantTx(db, bid.value, async (tx) => {
    const rows = (await sql<{
      product_id: string | null; sku: string | null; name: string | null; name_zh: string | null;
      list_price: string | null; is_active: boolean | null;
      floor: string | null; max: string | null; ask: string | null;
    }>`
      -- Every product, plus the business-wide row (product_id is null), in one
      -- read. A LEFT JOIN so a product with no rules comes back as a product
      -- with no rules, rather than not coming back.
      select p.id as product_id, p.sku, p.name, p.name_zh,
             p.price_usd_per_unit as list_price, p.is_active,
             pp.floor_price_usd as floor, pp.max_discount_pct as max,
             pp.human_required_above_pct as ask
        from products p
        left join pricing_policy pp
          on pp.business_id = ${bid.value} and pp.product_id = p.id
       where p.business_id = ${bid.value}
       union all
      select null, null, null, null, null, null,
             floor_price_usd, max_discount_pct, human_required_above_pct
        from pricing_policy
       where business_id = ${bid.value} and product_id is null
    `.execute(tx)).rows;

    const businessRow = rows.find((r) => r.product_id === null);
    const businessDefault = businessRow?.floor
      ? toRules({ floor: businessRow.floor, max: businessRow.max!, ask: businessRow.ask! })
      : null;

    const products = rows
      .filter((r) => r.product_id !== null)
      .map((r): ProductRules => ({
        productId: r.product_id!,
        sku: r.sku ?? '',
        name: r.name ?? '',
        nameZh: r.name_zh,
        listPriceUsd: r.list_price === null ? null : Number(r.list_price),
        own: r.floor ? toRules({ floor: r.floor, max: r.max!, ask: r.ask! }) : null,
        inheritsDefault: r.floor === null && businessDefault !== null,
        isActive: r.is_active ?? false,
      }));

    return {
      businessDefault,
      products,
      // What she cannot sell yet: a price, but no rule of her own and no default
      // to fall back on. This is a real count of rows, not a score.
      unanswered: products.filter((p) => p.listPriceUsd !== null && p.own === null && !p.inheritsDefault).length,
    };
  });
}

export type SaveRulesResult =
  | { readonly ok: true; readonly changed: readonly PriceRuleField[]; readonly activated: boolean }
  | { readonly ok: false; readonly errors: Partial<Record<PriceRuleField, PriceRuleError>> };

/**
 * Record the owner's answers for one product, or as her business default
 * (`productId: null`).
 *
 * Three things happen together, in one transaction:
 *   1. the rules are written (upsert — she is allowed to change her mind),
 *   2. the change is audited old → new, so a price rule reads as a change,
 *   3. a product that now has BOTH a price and a floor becomes sellable.
 *
 * (3) is the other half of making the importer honest: import leaves a priced
 * product pending precisely because no human has stated a floor, so stating one
 * is what completes it. Nothing else in the product flips `is_active` on.
 */
export async function savePriceRules(
  db: Db, businessIdRaw: string, actor: string,
  input: {
    readonly productId: string | null;
    readonly floorUsd: string | null | undefined;
    readonly maxDiscountPct: string | null | undefined;
    readonly askAbovePct: string | null | undefined;
  },
): Promise<SaveRulesResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { ok: false, errors: { floorUsd: 'missing' } };

  return withTenantTx(db, bid.value, async (tx) => {
    // The list price is needed to reject a floor above it, so read it first.
    const product = input.productId
      ? (await sql<{ price: string | null; is_active: boolean }>`
          select price_usd_per_unit as price, is_active from products
           where business_id = ${bid.value} and id = ${input.productId} limit 1
        `.execute(tx)).rows[0]
      : undefined;
    if (input.productId && !product) return { ok: false, errors: { floorUsd: 'missing' } };

    const listPriceUsd = product?.price != null ? Number(product.price) : null;
    const v = validatePriceRules({
      floorUsd: input.floorUsd, maxDiscountPct: input.maxDiscountPct, askAbovePct: input.askAbovePct,
      ...(input.productId ? { listPriceUsd } : {}),
    });
    if (!v.ok) return v;

    const before = (await sql<{ floor: string; max: string; ask: string }>`
      select floor_price_usd as floor, max_discount_pct as max, human_required_above_pct as ask
        from pricing_policy
       where business_id = ${bid.value}
         and product_id is not distinct from ${input.productId}
    `.execute(tx)).rows[0];

    await sql`
      insert into pricing_policy
        (business_id, product_id, floor_price_usd, max_discount_pct, human_required_above_pct)
      values (${bid.value}, ${input.productId}, ${v.value.floorUsd},
              ${v.value.maxDiscountPct}, ${v.value.askAbovePct})
      on conflict (business_id, product_id) do update
        set floor_price_usd = excluded.floor_price_usd,
            max_discount_pct = excluded.max_discount_pct,
            human_required_above_pct = excluded.human_required_above_pct
    `.execute(tx);

    const changes = priceRuleChanges(toRules(before), v.value);

    // A priced product with a stated floor is sellable. This is the ONLY place
    // that turns one on, and it is an owner action, never an inference.
    let activated = false;
    if (input.productId && listPriceUsd !== null && product && !product.is_active) {
      await sql`update products set is_active = true, updated_at = now()
                 where business_id = ${bid.value} and id = ${input.productId}`.execute(tx);
      activated = true;
    }

    await sql`
      insert into channel_audit (business_id, channel_id, action, actor, detail)
      values (${bid.value}, null, 'price_rules_set', ${actor},
              ${JSON.stringify({
                productId: input.productId, scope: input.productId ? 'product' : 'business_default',
                changes, activated,
              })}::jsonb)
    `.execute(tx);

    return { ok: true, changed: Object.keys(changes) as PriceRuleField[], activated };
  });
}

/** ── Renderer (pure, mobile-first, localized, escaped) ────────────────────── */

/**
 * The three questions, as questions. Not a form with field labels — an owner
 * who has never priced for a machine can answer "what is the least you would
 * ever accept for one of these?" and cannot answer "floor_price_usd".
 *
 * No "policy", no "threshold", no "authority" anywhere in the copy. And no
 * score: the page shows how many products still need answering, which is a
 * count of rows she can verify by looking at them.
 */
export function renderPriceRules(
  v: PriceRulesView, locale: Locale, flash: string | null = null,
  errors: Partial<Record<PriceRuleField, PriceRuleError>> = {},
  draft: { productId?: string | null } = {},
): string {
  const name = EMPLOYEE_NAME[locale];
  const err = (f: PriceRuleField): string =>
    errors[f] ? `<p class="perr">${esc(t(locale, `prices.error.${errors[f]}` as MessageKey, { name }))}</p>` : '';

  const form = (
    productId: string | null, current: PriceRules | null, title: string, sub: string,
  ): string => `
    <form method="post" action="/app/factory/prices" class="pform">
      <input type="hidden" name="productId" value="${esc(productId ?? '')}" />
      <h3 class="sub3">${esc(title)}</h3>
      <p class="fdesc">${esc(sub)}</p>
      <label class="pq"><span>${esc(t(locale, 'prices.q.floor', { name }))}</span>
        <input name="floorUsd" inputmode="decimal" required
               value="${current ? esc(String(current.floorUsd)) : ''}" />${err('floorUsd')}</label>
      <label class="pq"><span>${esc(t(locale, 'prices.q.maxDiscount', { name }))}</span>
        <input name="maxDiscountPct" inputmode="decimal" required
               value="${current ? esc(String(current.maxDiscountPct)) : ''}" />${err('maxDiscountPct')}</label>
      <label class="pq"><span>${esc(t(locale, 'prices.q.askAbove', { name }))}</span>
        <input name="askAbovePct" inputmode="decimal" required
               value="${current ? esc(String(current.askAbovePct)) : ''}" />${err('askAbovePct')}</label>
      <button class="btn send" type="submit">${esc(t(locale, 'prices.save'))}</button>
    </form>`;

  // Products she cannot sell yet come first — they are the reason to be here.
  const needing = v.products.filter((p) => p.listPriceUsd !== null && p.own === null && !p.inheritsDefault);
  const answered = v.products.filter((p) => p.own !== null);

  const productRow = (p: ProductRules): string => {
    const label = productName(locale, { name: p.name, nameZh: p.nameZh }) ?? p.sku;
    const open = draft.productId === p.productId;
    return `<li class="prow">
      <div class="phead"><bdi>${esc(label)}</bdi> <span class="muted">${esc(p.sku)}</span>
        ${p.listPriceUsd !== null ? `<span class="muted">${esc(formatUsd(p.listPriceUsd))}</span>` : ''}</div>
      ${p.own
        ? `<p class="fdesc">${esc(t(locale, 'prices.stated', {
             floor: formatUsd(p.own.floorUsd), max: p.own.maxDiscountPct, ask: p.own.askAbovePct, name }))}</p>`
        : `<p class="fwarn">${esc(t(locale, 'prices.notStated', { name }))}</p>`}
      ${open || p.own === null
        ? form(p.productId, p.own, t(locale, 'prices.forProduct', { product: label }), '')
        : `<a class="blink" href="/app/factory/prices?product=${encodeURIComponent(p.productId)}">${esc(t(locale, 'prices.change'))}</a>`}
    </li>`;
  };

  return `<h1 class="page">${esc(t(locale, 'prices.title'))}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    <p class="lede">${esc(t(locale, 'prices.lede', { name }))}</p>

    <section class="fblock">
      ${form(null, v.businessDefault,
        t(locale, 'prices.default.title'), t(locale, 'prices.default.sub', { name }))}
    </section>

    ${needing.length > 0 ? `<section class="fblock">
      <h2>${esc(t(locale, 'prices.needing.title', { name }))}</h2>
      <p class="fdesc">${esc(t(locale, 'prices.needing.sub', { n: needing.length, name }))}</p>
      <ul class="plist">${needing.map(productRow).join('')}</ul>
    </section>` : ''}

    ${answered.length > 0 ? `<section class="fblock">
      <h2>${esc(t(locale, 'prices.answered.title'))}</h2>
      <ul class="plist">${answered.map(productRow).join('')}</ul>
    </section>` : ''}

    ${back('/app/factory', t(locale, 'nav.factory'))}
    ${PRICES_STYLE}`;
}

const PRICES_STYLE = `<style>
  .pform { display:flex; flex-direction:column; gap:14px; max-width:44ch; margin-top:12px; }
  .pq { display:flex; flex-direction:column; gap:6px; font-size:14px; color:#d6dae0; }
  .pq input { background:#0f1216; border:1px solid #2b313a; border-radius:10px;
              color:#fff; padding:11px 14px; font:inherit; min-height:44px; }
  .perr { color:#e0b551; font-size:13px; margin:0; }
  .plist { list-style:none; margin:14px 0 0; padding:0; display:flex; flex-direction:column; gap:18px; }
  .prow { border-top:1px solid #1e2229; padding-top:14px; }
  .phead { display:flex; gap:10px; flex-wrap:wrap; align-items:baseline; font-size:15px; color:#e7eaee; }
</style>`;
