import { sql } from 'kysely';
import { type Money, moneyFromRow } from '../../core/types/money.js';
import type { Db } from '../../db/client.js';
import { withTenantTx } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';
import { formatMoney, formatQty } from '../../core/owner/i18n/format.js';
import { esc, back } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
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
  readonly listPrice: Money | null;
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
  /**
   * G22 — WHEN SHE MAY COME DOWN, and by how much.
   *
   * Her limits above say what she will never go below and how much may ever
   * come off. Neither of them produces a discount: a discount only exists when
   * a `negotiation_rules` row says one does, and until now nothing in the
   * product wrote that table. So "above 5% off she asks you first" was a
   * promise about an event that could not occur, on the page where she checks
   * what her employee may do. These are the rows that make it reachable.
   */
  readonly volume: readonly VolumeDiscount[];
};

/** "From 10,000 pieces, 8% off" — one row of `negotiation_rules`, in her words. */
export type VolumeDiscount = {
  readonly id: string;
  /** null = every product she sells. */
  readonly productId: string | null;
  readonly productLabel: string | null;
  readonly minQty: number;
  readonly discountPct: number;
  /** Past her ask-me line for that product, so the reply waits for her (G7a). */
  readonly asksFirst: boolean;
};

// M43a — the currency comes from the ROW, and a policy this build cannot price
// reads as no policy rather than as a dollar floor.
const toRules = (
  r: { floor: string; max: string; ask: string; currency?: string } | undefined,
): PriceRules | null => {
  if (!r) return null;
  const floor = moneyFromRow(Number(r.floor), r.currency ?? 'USD');
  return floor === null ? null : { floor, maxDiscountPct: Number(r.max), askAbovePct: Number(r.ask) };
};

export async function loadPriceRules(db: Db, businessIdRaw: string): Promise<PriceRulesView> {
  const empty: PriceRulesView = { businessDefault: null, products: [], unanswered: 0, volume: [] };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return empty;

  return withTenantTx(db, bid.value, async (tx) => {
    const rows = (await sql<{
      product_id: string | null; sku: string | null; name: string | null; name_zh: string | null;
      list_price: string | null; list_currency: string | null; is_active: boolean | null;
      floor: string | null; max: string | null; ask: string | null; currency: string | null;
    }>`
      -- Every product, plus the business-wide row (product_id is null), in one
      -- read. A LEFT JOIN so a product with no rules comes back as a product
      -- with no rules, rather than not coming back.
      select p.id as product_id, p.sku, p.name, p.name_zh,
             p.price_usd_per_unit as list_price, p.currency as list_currency, p.is_active,
             pp.floor_price_usd as floor, pp.max_discount_pct as max,
             pp.human_required_above_pct as ask, pp.currency
        from products p
        left join pricing_policy pp
          on pp.business_id = ${bid.value} and pp.product_id = p.id
       where p.business_id = ${bid.value}
       union all
      select null, null, null, null, null, null, null,
             floor_price_usd, max_discount_pct, human_required_above_pct, currency
        from pricing_policy
       where business_id = ${bid.value} and product_id is null
    `.execute(tx)).rows;

    const businessRow = rows.find((r) => r.product_id === null);
    const businessDefault = businessRow?.floor
      ? toRules({ floor: businessRow.floor, max: businessRow.max!, ask: businessRow.ask!, currency: businessRow.currency ?? 'USD' })
      : null;

    const products = rows
      .filter((r) => r.product_id !== null)
      .map((r): ProductRules => ({
        productId: r.product_id!,
        sku: r.sku ?? '',
        name: r.name ?? '',
        nameZh: r.name_zh,
        // G18 — the row's own currency, for the price as well as the floor.
        // `toRules` has read it since M43a; the query never selected it, so
        // every floor was read back as dollars whatever it was stored as.
        listPrice: r.list_price === null ? null : moneyFromRow(Number(r.list_price), r.list_currency ?? 'USD'),
        own: r.floor ? toRules({ floor: r.floor, max: r.max!, ask: r.ask!, currency: r.currency ?? 'USD' }) : null,
        inheritsDefault: r.floor === null && businessDefault !== null,
        isActive: r.is_active ?? false,
      }));

    // G22 — her volume discounts. Only `discount_pct` rows: the table can also
    // carry lead-time and free-shipping actions, and a page that showed those
    // as discounts would be describing something else.
    const volumeRows = (await sql<{
      id: string; product_id: string | null; min_qty: number | null; pct: number | null;
    }>`
      select id::text as id,
             nullif(condition->>'productId', '')::uuid::text as product_id,
             (condition->>'qtyGte')::int as min_qty,
             (action->>'value')::numeric as pct
        from negotiation_rules
       where business_id = ${bid.value} and is_active
         and action->>'kind' = 'discount_pct'
       order by (condition->>'qtyGte')::int nulls first, priority
    `.execute(tx)).rows;

    const askFor = (productId: string | null): number | null => {
      const own = productId ? products.find((p) => p.productId === productId)?.own ?? null : null;
      return (own ?? businessDefault)?.askAbovePct ?? null;
    };
    const volume = volumeRows
      .filter((r) => r.min_qty !== null && r.pct !== null)
      .map((r): VolumeDiscount => {
        const p = r.product_id ? products.find((x) => x.productId === r.product_id) : undefined;
        const ask = askFor(r.product_id);
        return {
          id: r.id,
          productId: r.product_id,
          productLabel: p ? (p.name || p.sku) : null,
          minQty: Number(r.min_qty),
          discountPct: Number(r.pct),
          asksFirst: ask !== null && Number(r.pct) > ask,
        };
      });

    return {
      businessDefault,
      products,
      // What she cannot sell yet: a price, but no rule of her own and no default
      // to fall back on. This is a real count of rows, not a score.
      unanswered: products.filter((p) => p.listPrice !== null && p.own === null && !p.inheritsDefault).length,
      volume,
    };
  });
}

export type SaveRulesResult =
  | { readonly ok: true; readonly changed: readonly PriceRuleField[]; readonly activated: boolean;
      /** D1 — how many products her answer FOR EVERYTHING made sellable. 0 for a single product's answer. */
      readonly activatedCount: number }
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
    readonly floor: string | null | undefined;
    readonly maxDiscountPct: string | null | undefined;
    readonly askAbovePct: string | null | undefined;
  },
): Promise<SaveRulesResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { ok: false, errors: { floor: 'missing' } };

  return withTenantTx(db, bid.value, async (tx) => {
    // The list price is needed to reject a floor above it, so read it first.
    const product = input.productId
      ? (await sql<{ price: string | null; currency: string; is_active: boolean }>`
          select price_usd_per_unit as price, currency, is_active from products
           where business_id = ${bid.value} and id = ${input.productId} limit 1
        `.execute(tx)).rows[0]
      : undefined;
    if (input.productId && !product) return { ok: false, errors: { floor: 'missing' } };

    const listPrice = product?.price != null ? moneyFromRow(Number(product.price), product.currency) : null;
    const v = validatePriceRules({
      floor: input.floor, maxDiscountPct: input.maxDiscountPct, askAbovePct: input.askAbovePct,
      ...(input.productId ? { listPrice } : {}),
    });
    if (!v.ok) return v;

    const before = (await sql<{ floor: string; max: string; ask: string; currency: string }>`
      select floor_price_usd as floor, max_discount_pct as max, human_required_above_pct as ask, currency
        from pricing_policy
       where business_id = ${bid.value}
         and product_id is not distinct from ${input.productId}
    `.execute(tx)).rows[0];

    await sql`
      insert into pricing_policy
        (business_id, product_id, floor_price_usd, currency, max_discount_pct, human_required_above_pct)
      values (${bid.value}, ${input.productId}, ${v.value.floor.amount}, ${v.value.floor.currency},
              ${v.value.maxDiscountPct}, ${v.value.askAbovePct})
      on conflict (business_id, product_id) do update
        set floor_price_usd = excluded.floor_price_usd,
            currency = excluded.currency,
            max_discount_pct = excluded.max_discount_pct,
            human_required_above_pct = excluded.human_required_above_pct
    `.execute(tx);

    const changes = priceRuleChanges(toRules(before), v.value);

    // A priced product with a stated floor is sellable. This is the ONLY place
    // that turns one on, and it is an owner action, never an inference.
    let activated = false;
    let activatedCount = 0;
    if (input.productId && listPrice !== null && product && !product.is_active) {
      await sql`update products set is_active = true, updated_at = now()
                 where business_id = ${bid.value} and id = ${input.productId}`.execute(tx);
      activated = true;
    }
    /**
     * D1 — HER ANSWER FOR EVERYTHING COVERS EVERYTHING IT CAN.
     *
     * The page says "answer once and it covers every product", and the quote
     * already fell back to this row — but only a single product's answer ever
     * switched a product on. So an owner who answered once had a catalogue the
     * checklist still called empty, with every product reading "Needs a price"
     * beside its price, and the only way forward was a tick box one page deep,
     * one product at a time.
     *
     * It switches on exactly the products she has NOT decided about: priced, in
     * the same currency, not below her floor, with no answer of their own, and
     * untouched since they were imported (`updated_at = created_at`). A product
     * she switched off herself has been touched, and stays off.
     */
    if (!input.productId) {
      const on = await sql`
        update products p set is_active = true, updated_at = now()
         where p.business_id = ${bid.value} and not p.is_active
           and p.price_usd_per_unit is not null and p.updated_at = p.created_at
           and p.currency = ${v.value.floor.currency} and p.price_usd_per_unit >= ${v.value.floor.amount}
           and not exists (select 1 from pricing_policy own
                            where own.business_id = p.business_id and own.product_id = p.id)`.execute(tx);
      activatedCount = Number(on.numAffectedRows ?? 0);
      activated = activatedCount > 0;
    }

    await sql`
      insert into channel_audit (business_id, channel_id, action, actor, detail)
      values (${bid.value}, null, 'price_rules_set', ${actor},
              ${JSON.stringify({
                productId: input.productId, scope: input.productId ? 'product' : 'business_default',
                changes, activated, activatedCount,
              })}::jsonb)
    `.execute(tx);

    return { ok: true, changed: Object.keys(changes) as PriceRuleField[], activated, activatedCount };
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
/**
 * G22 — she says when she will come down, and by how much.
 *
 * WHY THIS EXISTS. `computeQuote` derives a discount from `negotiation_rules`
 * and from nowhere else. No owner surface has ever written that table, so
 * `discountPct` was always 0, her "never more than 8% off" was a ceiling on
 * nothing, and "above 5% off she asks you first" — which G7a made a real hold —
 * described an event the product could not produce. Found by the pre-pilot
 * walkthrough, which had to insert the row by hand to rehearse it.
 *
 * WHAT IT REFUSES. A discount above the most she said may ever come off is not
 * clamped quietly (which is what the engine would do) — it is refused, naming
 * her own number, because a rule she wrote and the engine silently narrowed is
 * a rule she believes she has and does not. A discount with no limits under it
 * at all is refused too: the floor is what makes a discount safe, and M29's
 * whole argument is that absence of a rule is never a default.
 */
export type VolumeField = 'minQty' | 'discountPct';
export type VolumeError = 'missing' | 'not_a_number' | 'not_positive' | 'above_max' | 'no_limits';
export type VolumeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: Partial<Record<VolumeField, VolumeError>> };

export async function saveVolumeDiscount(
  db: Db, businessIdRaw: string, actor: string,
  input: { readonly productId: string | null; readonly minQty: string | null; readonly discountPct: string | null },
): Promise<VolumeResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { ok: false, errors: { minQty: 'missing' } };

  return withTenantTx(db, bid.value, async (tx) => {
    const errors: Partial<Record<VolumeField, VolumeError>> = {};
    const qty = Number((input.minQty ?? '').trim());
    const pct = Number((input.discountPct ?? '').trim());
    if (!(input.minQty ?? '').trim()) errors.minQty = 'missing';
    else if (!Number.isFinite(qty)) errors.minQty = 'not_a_number';
    else if (!Number.isInteger(qty) || qty <= 0) errors.minQty = 'not_positive';
    if (!(input.discountPct ?? '').trim()) errors.discountPct = 'missing';
    else if (!Number.isFinite(pct)) errors.discountPct = 'not_a_number';
    else if (pct <= 0 || pct > 100) errors.discountPct = 'not_positive';
    if (Object.keys(errors).length) return { ok: false, errors };

    // The ceiling that applies: this product's own, else the business default.
    const ceiling = (await sql<{ max: string }>`
      select max_discount_pct as max from pricing_policy
       where business_id = ${bid.value}
         and product_id is not distinct from ${input.productId}
       union all
      select max_discount_pct from pricing_policy
       where business_id = ${bid.value} and product_id is null
       limit 1
    `.execute(tx)).rows[0];
    if (!ceiling) return { ok: false, errors: { discountPct: 'no_limits' } };
    if (pct > Number(ceiling.max)) return { ok: false, errors: { discountPct: 'above_max' } };

    await sql`
      insert into negotiation_rules (business_id, priority, condition, action, is_active)
      values (${bid.value}, 100,
              ${JSON.stringify({ qtyGte: qty, ...(input.productId ? { productId: input.productId } : {}) })}::jsonb,
              ${JSON.stringify({ kind: 'discount_pct', value: pct })}::jsonb, true)
    `.execute(tx);

    // The same verb her other price rules use: this IS a price rule she set,
    // and a second audit vocabulary for it would be a second way to read the
    // same history.
    await sql`
      insert into channel_audit (business_id, channel_id, action, actor, detail)
      values (${bid.value}, null, 'price_rules_set', ${actor},
              ${JSON.stringify({ kind: 'volume_discount', productId: input.productId, minQty: qty, discountPct: pct })}::jsonb)
    `.execute(tx);
    return { ok: true };
  });
}

/** Archive, never erase: she stops offering it, and the history stays. */
export async function archiveVolumeDiscount(
  db: Db, businessIdRaw: string, actor: string, id: string,
): Promise<{ readonly ok: boolean }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { ok: false };
  return withTenantTx(db, bid.value, async (tx) => {
    const done = await sql<{ id: string }>`
      update negotiation_rules set is_active = false
       where business_id = ${bid.value} and id = ${id}::uuid and is_active
       returning id::text as id
    `.execute(tx);
    if (!done.rows[0]) return { ok: false };
    await sql`
      insert into channel_audit (business_id, channel_id, action, actor, detail)
      values (${bid.value}, null, 'price_rules_set', ${actor},
              ${JSON.stringify({ kind: 'volume_discount_archived', ruleId: id })}::jsonb)
    `.execute(tx);
    return { ok: true };
  });
}

export function renderPriceRules(
  v: PriceRulesView, locale: Locale, flash: Flash | null = null,
  errors: Partial<Record<PriceRuleField, PriceRuleError>> = {},
  draft: { productId?: string | null } = {},
  volumeErrors: Partial<Record<VolumeField, VolumeError>> = {},
): string {
  const name = assistantName(locale);
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
        <input name="floor" inputmode="decimal" required
               value="${current ? esc(String(current.floor.amount)) : ''}" />${err('floor')}</label>
      <label class="pq"><span>${esc(t(locale, 'prices.q.maxDiscount', { name }))}</span>
        <input name="maxDiscountPct" inputmode="decimal" required
               value="${current ? esc(String(current.maxDiscountPct)) : ''}" />${err('maxDiscountPct')}</label>
      <label class="pq"><span>${esc(t(locale, 'prices.q.askAbove', { name }))}</span>
        <input name="askAbovePct" inputmode="decimal" required
               value="${current ? esc(String(current.askAbovePct)) : ''}" />${err('askAbovePct')}</label>
      <button class="btn send" type="submit">${esc(t(locale, 'prices.save'))}</button>
    </form>`;

  // Products she cannot sell yet come first — they are the reason to be here.
  // D1 — a general floor ABOVE a product's own price cannot cover it, so that
  // product still needs an answer of its own and says so.
  const beyondDefault = (p: ProductRules): boolean =>
    p.listPrice !== null && v.businessDefault !== null
    && (p.listPrice.currency !== v.businessDefault.floor.currency || p.listPrice.amount < v.businessDefault.floor.amount);
  const needing = v.products.filter((p) => p.listPrice !== null && p.own === null && (!p.inheritsDefault || beyondDefault(p)));
  const answered = v.products.filter((p) => p.own !== null);
  // D8 — and the ones it DOES cover stay listed. They vanished the moment she
  // answered for everything, under a sentence still promising "you can set a
  // different answer for any single product below".
  const covered = v.products.filter((p) => p.listPrice !== null && p.own === null && p.inheritsDefault && !beyondDefault(p));

  const isCovered = (p: ProductRules): boolean => covered.includes(p);
  const productRow = (p: ProductRules): string => {
    const label = productName(locale, { name: p.name, nameZh: p.nameZh }) ?? p.sku;
    const open = draft.productId === p.productId;
    return `<li class="prow">
      <div class="phead"><bdi>${esc(label)}</bdi> <span class="muted">${esc(p.sku)}</span>
        ${p.listPrice !== null ? `<span class="muted">${esc(formatMoney(p.listPrice))}</span>` : ''}</div>
      ${p.own
        ? `<p class="fdesc">${esc(t(locale, 'prices.stated', {
             floor: formatMoney(p.own.floor), max: p.own.maxDiscountPct, ask: p.own.askAbovePct, name }))}</p>`
        : isCovered(p) && v.businessDefault
          ? `<p class="fdesc">${esc(t(locale, 'prices.inherited.line', { floor: formatMoney(v.businessDefault.floor) }))}</p>`
          : `<p class="fwarn">${esc(t(locale, 'prices.notStated', { name }))}</p>`}
      ${open || (p.own === null && !isCovered(p))
        ? form(p.productId, p.own, t(locale, 'prices.forProduct', { product: label }), '')
        : `<a class="blink" href="/app/factory/prices?product=${encodeURIComponent(p.productId)}">${esc(t(locale, p.own ? 'prices.change' : 'prices.inherited.own'))}</a>`}
    </li>`;
  };

  return `<h1 class="page">${esc(t(locale, 'prices.title'))}</h1>
    ${flashBanner(flash)}
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

    ${covered.length > 0 ? `<section class="fblock">
      <h2>${esc(t(locale, 'prices.inherited.title'))}</h2>
      <ul class="plist">${covered.map(productRow).join('')}</ul>
    </section>` : ''}

    ${volumeSection(v, locale, volumeErrors)}

    ${back('/app/factory', t(locale, 'nav.factory'))}
    ${PRICES_STYLE}`;
}

/**
 * G22 — the section that makes her ceiling mean something.
 *
 * It sits AFTER her limits, on purpose: a discount is a thing she gives inside
 * a floor she has already stated, and the page reads in that order. With no
 * rule written, it says plainly that she never offers one — which is the truth
 * the product has always had and never said.
 */
function volumeSection(
  v: PriceRulesView, locale: Locale, errors: Partial<Record<VolumeField, VolumeError>>,
): string {
  const name = assistantName(locale);
  const err = (f: VolumeField): string =>
    errors[f] ? `<p class="perr">${esc(t(locale, `prices.volume.error.${errors[f]}` as MessageKey, { name }))}</p>` : '';

  const rows = v.volume.map((d) => `<li class="prow">
      <div class="phead"><bdi>${esc(t(locale, 'prices.volume.row', {
        qty: formatQty(locale, d.minQty), pct: d.discountPct,
        product: d.productLabel ?? t(locale, 'prices.volume.everyProduct'),
      }))}</bdi></div>
      ${d.asksFirst ? `<p class="fdesc">${esc(t(locale, 'prices.volume.asksFirst', { name }))}</p>` : ''}
      <form method="post" action="/app/factory/prices/volume/${esc(d.id)}/archive">
        <button class="btn" type="submit">${esc(t(locale, 'prices.volume.remove'))}</button>
      </form>
    </li>`).join('');

  return `<section class="fblock">
    <h2>${esc(t(locale, 'prices.volume.title'))}</h2>
    <p class="fdesc">${esc(t(locale, 'prices.volume.sub', { name }))}</p>
    ${v.volume.length
      ? `<ul class="plist">${rows}</ul>`
      : `<p class="fwarn">${esc(t(locale, 'prices.volume.none', { name }))}</p>`}
    <form method="post" action="/app/factory/prices/volume" class="pform">
      <label class="pq"><span>${esc(t(locale, 'prices.volume.q.product'))}</span>
        <select name="productId">
          <option value="">${esc(t(locale, 'prices.volume.everyProduct'))}</option>
          ${v.products.map((p) => `<option value="${esc(p.productId)}">${
            esc(productName(locale, { name: p.name, nameZh: p.nameZh }) ?? p.sku)}</option>`).join('')}
        </select></label>
      <label class="pq"><span>${esc(t(locale, 'prices.volume.q.minQty'))}</span>
        <input name="minQty" inputmode="numeric" required />${err('minQty')}</label>
      <label class="pq"><span>${esc(t(locale, 'prices.volume.q.discount'))}</span>
        <input name="discountPct" inputmode="decimal" required />${err('discountPct')}</label>
      <button class="btn send" type="submit">${esc(t(locale, 'prices.volume.add'))}</button>
    </form>
  </section>`;
}

const PRICES_STYLE = `<style>
  .pq { display:flex; flex-direction:column; gap:var(--space-4); font-size:var(--font-size-note); color:var(--color-ink); }
  .pq input { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px;
              color:var(--color-ink); padding:11px 14px; font:inherit; min-height:44px; }
  .perr { color:var(--color-highlight); font-size:var(--font-size-caption); margin:0; }
  .plist { list-style:none; margin:var(--space-16) 0 0; padding:0; display:flex; flex-direction:column; gap:var(--space-16); }
  .prow { border-top:1px solid var(--color-paper-sunk); padding-top:14px; }
  .phead { display:flex; gap:var(--space-8); flex-wrap:wrap; align-items:baseline; font-size:var(--font-size-small); color:var(--color-ink); }
</style>`;

/**
 * M29 follow-up — how many price rules were never authored by a human?
 *
 * Rows the OLD `confirmImport` wrote carry floor = the list price, no discount
 * authority, no ask-above threshold. Nothing migrates them and nothing should:
 * guessing at what the owner meant is the exact failure M29 removed.
 *
 * THE VALUES CANNOT DISCRIMINATE. `validatePriceRules` accepts floor == list
 * with 0/0 from a real owner — it only rejects a floor ABOVE list — so a
 * fabricated triple is indistinguishable from a conservative real one by
 * inspection. The AUDIT TRAIL can: `savePriceRules` is the only writer left and
 * it always records `price_rules_set`, which the importer never could. So this
 * reads what was recorded rather than inferring from what the row says.
 *
 * Operator-only. The owner cannot fix it and did not cause it, and on a factory
 * provisioned after M29 the answer is zero — the check earns its place by
 * staying silent until an old tenant appears.
 */
export async function countUnauthoredPriceRules(db: Db, businessIdRaw: string): Promise<number> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return 0;
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ n: number }>`
      select count(*)::int as n
        from pricing_policy pp
       where pp.business_id = ${bid.value}
         and not exists (
           select 1 from channel_audit ca
            where ca.business_id = ${bid.value}
              and ca.action = 'price_rules_set'
              -- Both sides are null for the business-wide default, and
              -- IS NOT DISTINCT FROM is the only comparison that matches
              -- there; plain equality would silently never match it.
              and (ca.detail ->> 'productId') is not distinct from pp.product_id::text
         )
    `.execute(tx);
    return Number(r.rows[0]?.n ?? 0);
  });
}
