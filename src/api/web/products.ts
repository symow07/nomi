import { sql } from 'kysely';
import { type Money, usd, parseCurrency, moneyFromRow } from '../../core/types/money.js';
import { withTenantTx, type Db, type Tx } from '../../db/client.js';
import { parseBusinessId, type BusinessId } from '../../core/types/ids.js';
import { parsePriceLines, validateExtracted, validatePage, type ValidatedImport, type ExtractedProduct } from '../../core/onboard/catalogImport.js';
import { diffAgainstCatalogue, type CatalogueDiff, type CatalogueEntry } from '../../core/onboard/catalogDiff.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';
import { formatQty, formatMoney } from '../../core/owner/i18n/format.js';
import type { PageTranscriber } from '../../llm/ports.js';
import { esc, back } from './layout.js';
import { flashBanner, type Flash, type FlashPart } from './flash.js';

/**
 * M9.5 + ADR-0008 — Product Knowledge Center. A VIEW over the EXISTING catalog
 * plus a teach flow that reuses the M6 parser. The read model is language-NEUTRAL
 * (raw name + name_zh, unit codes, reject codes); the renderer localizes. Product
 * NAMES are data, not chrome: zh prefers name_zh, en/ar use the neutral latin name
 * (there is no Arabic product name — never invented).
 *
 * Trust rule (engine-enforced): a product without a confirmed price is inserted
 * is_active=false — it shows "Needs a price" and CANNOT affect a quote.
 */

const displayName = (locale: Locale, name: string, nameZh: string | null): string =>
  locale === 'zh' ? (nameZh ?? name) : name;
const unitLabel = (locale: Locale, unit: string): string =>
  unit === 'pcs' ? t(locale, 'product.unit.pcs') : unit;

export type ProductListItem = {
  readonly id: string;
  readonly name: string;
  readonly nameZh: string | null;
  readonly sku: string;
  readonly moq: number;
  readonly unit: string;
  readonly entryQty: number | null;
  readonly entryPrice: Money | null;
  readonly learned: boolean;
  /** D1 — WHAT is missing, so the badge can say it instead of "Needs a price" beside a price. */
  readonly status: ProductStatus;
  readonly imageMatchable: boolean;
  /** Deactivated products stay in the list but are not something you sell. */
  readonly isActive: boolean;
};

/**
 * D1 — four states, because "not learned" was three different things and the
 * badge named only one of them:
 *   needs_price    no price at all
 *   needs_limits   priced, but no price limits cover it — her next step is one page away
 *   not_offered    priced and covered, and switched off (by her, or a floor above its price)
 *   learned        she sells it
 */
export type ProductStatus = 'learned' | 'needs_price' | 'needs_limits' | 'not_offered';

export const productStatus = (p: { readonly isActive: boolean; readonly hasPrice: boolean; readonly hasLimits: boolean }): ProductStatus =>
  !p.hasPrice ? 'needs_price' : p.isActive ? 'learned' : p.hasLimits ? 'not_offered' : 'needs_limits';

export async function loadProductList(db: Db, businessIdRaw: string): Promise<readonly ProductListItem[]> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return [];
  return withTenantTx(db, bid.value, async (tx) => (await sql<{
    id: string; name: string; name_zh: string | null; sku: string; moq: number; unit: string;
    is_active: boolean; price: string | null; currency: string;
    entry_qty: number | null; entry_price: string | null; extras: number; has_limits: boolean;
  }>`
    select p.id, p.name, p.name_zh, p.sku, p.moq, p.unit, p.is_active, p.price_usd_per_unit as price,
           p.currency, t.min_qty as entry_qty, t.unit_price_usd as entry_price,
           exists (select 1 from pricing_policy pp where pp.business_id = p.business_id
                    and (pp.product_id = p.id or pp.product_id is null)) as has_limits,
           (select count(*) from product_aliases a where a.product_id = p.id)
             + (select count(*) from product_images i where i.product_id = p.id) as extras
      from products p
      left join lateral (select min_qty, unit_price_usd from price_tiers pt
                          where pt.product_id = p.id order by min_qty asc limit 1) t on true
     order by p.is_active desc, p.updated_at desc
     limit 200
  `.execute(tx)).rows.map((r): ProductListItem => {
    const entryPrice = r.entry_price !== null ? Number(r.entry_price) : (r.price !== null ? Number(r.price) : null);
    return {
      id: r.id, name: r.name, nameZh: r.name_zh, sku: r.sku, moq: r.moq, unit: r.unit,
      entryQty: r.entry_qty ?? (entryPrice !== null ? r.moq : null),
      // G18 — her product's own currency, not an assumed dollar.
      entryPrice: entryPrice === null ? null : moneyFromRow(entryPrice, r.currency),
      learned: r.is_active && entryPrice !== null,
      status: productStatus({ isActive: r.is_active, hasPrice: entryPrice !== null, hasLimits: r.has_limits }),
      imageMatchable: r.is_active && Number(r.extras) > 0,
      isActive: r.is_active,
    };
  }));
}

export type ProductDetail = {
  readonly id: string;
  readonly name: string;
  readonly nameZh: string | null;
  readonly sku: string;
  readonly category: string | null;
  readonly unit: string;
  readonly moq: number;
  readonly leadTimeDays: number | null;
  readonly customizable: boolean;
  readonly learned: boolean;
  readonly status: ProductStatus;
  readonly imageMatchable: boolean;
  /** M29 — whether she offers it to buyers. Archive-never-erase: false, not gone. */
  readonly isActive: boolean;
  readonly tiers: readonly { minQty: number; maxQty: number | null; unitPrice: Money }[];
  readonly aliases: readonly string[];
  readonly images: readonly string[];
  readonly recentQuotes: readonly { quantity: number; unitPrice: Money; total: Money }[];
};

export async function loadProductDetail(db: Db, businessIdRaw: string, productId: string): Promise<ProductDetail | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const p = (await sql<{
      id: string; name: string; name_zh: string | null; sku: string; category: string | null;
      unit: string; moq: number; lead_time_days: number | null; customizable: boolean;
      is_active: boolean; price: string | null; currency: string; has_limits: boolean;
    }>`select id, name, name_zh, sku, category, unit, moq, lead_time_days, customizable, is_active,
              price_usd_per_unit as price, currency,
              exists (select 1 from pricing_policy pp where pp.business_id = products.business_id
                       and (pp.product_id = products.id or pp.product_id is null)) as has_limits
         from products where id = ${productId} limit 1`.execute(tx)).rows[0];
    if (!p) return null;

    const tiers = (await sql<{ min_qty: number; max_qty: number | null; unit_price_usd: string; currency: string }>`
      select min_qty, max_qty, unit_price_usd, currency from price_tiers where product_id = ${productId} order by min_qty asc`
      .execute(tx)).rows
      .map((tr) => ({ minQty: tr.min_qty, maxQty: tr.max_qty, unitPrice: moneyFromRow(Number(tr.unit_price_usd), tr.currency) }))
      .filter((tr): tr is { minQty: number; maxQty: number | null; unitPrice: Money } => tr.unitPrice !== null);
    const aliases = (await sql<{ alias: string }>`
      select distinct alias from product_aliases where product_id = ${productId} order by alias limit 40`
      .execute(tx)).rows.map((a) => a.alias);
    const images = (await sql<{ url: string }>`
      select url from product_images where product_id = ${productId} order by is_primary desc, sort_order asc limit 8`
      .execute(tx)).rows.map((i) => i.url);
    const recentQuotes = (await sql<{ quantity: number; unit_price_usd: string; total_usd: string; currency: string }>`
      select quantity, unit_price_usd, total_usd, currency from quotes where product_id = ${productId} order by created_at desc limit 5`
      .execute(tx)).rows
      .map((q) => ({
        quantity: q.quantity,
        unitPrice: moneyFromRow(Number(q.unit_price_usd), q.currency),
        total: moneyFromRow(Number(q.total_usd), q.currency),
      }))
      .filter((q): q is { quantity: number; unitPrice: Money; total: Money } => q.unitPrice !== null && q.total !== null);

    const learned = p.is_active && (tiers.length > 0 || p.price !== null);
    return {
      id: p.id, name: p.name, nameZh: p.name_zh, sku: p.sku,
      category: p.category, unit: p.unit, moq: p.moq, leadTimeDays: p.lead_time_days,
      customizable: p.customizable, learned, isActive: p.is_active,
      status: productStatus({ isActive: p.is_active, hasPrice: tiers.length > 0 || p.price !== null, hasLimits: p.has_limits }),
      imageMatchable: p.is_active && aliases.length + images.length > 0,
      tiers, aliases, images, recentQuotes,
    };
  });
}

/** ── Teach flow: paste → parse (reuse M6) → review → confirm → available ─── */

export function reviewImport(rawText: string): ValidatedImport {
  return validateExtracted(parsePriceLines(rawText));
}

/**
 * G16 — her catalogue, as the comparison with a page needs to see it.
 *
 * The floor is the product's own, the one `updateProduct` refuses below — the
 * review holds back exactly the change the save would refuse, by the same rule.
 */
async function catalogueFor(tx: Tx, bid: BusinessId): Promise<readonly CatalogueEntry[]> {
  const rows = (await sql<{
    id: string; sku: string; name: string; name_zh: string | null;
    price: string | null; currency: string; moq: number; floor: string | null;
  }>`
    select p.id, p.sku, p.name, p.name_zh, p.price_usd_per_unit as price, p.currency, p.moq,
           pp.floor_price_usd as floor
      from products p
      left join pricing_policy pp on pp.business_id = p.business_id and pp.product_id = p.id
     where p.business_id = ${bid}
  `.execute(tx)).rows;
  return rows.map((r) => ({
    id: r.id, sku: r.sku, name: r.name, nameZh: r.name_zh,
    price: r.price === null ? null : Number(r.price),
    currency: parseCurrency(r.currency), moq: r.moq,
    floor: r.floor === null ? null : Number(r.floor),
  }));
}

/** G16 — what the review shows: the lines she is about to confirm, against what she sells. */
export async function diffImport(db: Db, businessIdRaw: string, v: ValidatedImport): Promise<CatalogueDiff> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return diffAgainstCatalogue(v.accepted, []);
  return withTenantTx(db, bid.value, async (tx) => diffAgainstCatalogue(v.accepted, await catalogueFor(tx, bid.value)));
}

/**
 * M22 (F-02) — `alreadyHere` is reported rather than swallowed. `on conflict do
 * nothing` used to make a re-import look like it did nothing at all: "0 learned"
 * with no explanation, which is the false-success class in reverse. Now that the
 * owner's OWN sku is used, a re-import collides on purpose and she is told so.
 *
 * G16 — and a line that CHANGES a product she has is no longer one of them.
 */
export type ImportResult = {
  /** Rows created. None is sellable: an import cannot know a floor. */
  readonly added: number;
  /** Of those, how many carry a price and so need only the price rules. */
  readonly withPrice: number;
  /** G16 — products whose price or MOQ she ticked to change, changed. */
  readonly updated: number;
  /**
   * Already in her catalogue and left as they are: the page agreed with it, she
   * left the change unticked, or it is one to change on the product's own page.
   * Reported, never swallowed (F-02).
   */
  readonly alreadyHere: number;
  /**
   * G16 — a change she ticked that her floor refused at the moment of saving,
   * because she raised it between the review and the confirm. Never counted as
   * done, and never as "left as it is".
   */
  readonly refused: number;
  /** D1 — of the rows created, how many her answer for everything already made sellable. */
  readonly ready: number;
};

/** G16 — who confirmed, and which of the changes the review offered she kept ticked. */
export type ImportApproval = {
  /** The signed-in person, for the audit trail (G9b). */
  readonly actor: string;
  /** Product ids. A change whose product is not here is left as it is. */
  readonly apply: ReadonlySet<string>;
};

export async function confirmImport(
  db: Db, businessIdRaw: string, rawText: string, approval?: ImportApproval,
): Promise<ImportResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { added: 0, withPrice: 0, updated: 0, alreadyHere: 0, refused: 0, ready: 0 };
  const { accepted } = reviewImport(rawText);
  let added = 0, withPrice = 0, updated = 0, alreadyHere = 0, refused = 0, ready = 0;

  await withTenantTx(db, bid.value, async (tx) => {
    // The SAME diff the review showed, from the same staged lines — recomputed
    // here rather than trusted from the form, so a posted product id can only
    // choose among changes this business's own catalogue produced.
    const diff = diffAgainstCatalogue(accepted, await catalogueFor(tx, bid.value));
    // D1 — has she already answered FOR EVERYTHING? Then a priced line her floor
    // does not exceed arrives sellable: M29's rule is that a human states the
    // floor, and she has. Without that answer nothing changes — still off.
    const general = (await sql<{ floor: string; currency: string }>`
      select floor_price_usd as floor, currency from pricing_policy
       where business_id = ${bid.value} and product_id is null limit 1`.execute(tx)).rows[0];
    const coveredByGeneral = (price: { amount: number; currency: string } | null): boolean =>
      price !== null && general !== undefined && price.currency === general.currency && price.amount >= Number(general.floor);
    for (let i = 0; i < diff.added.length; i++) {
      const p = diff.added[i]!;
      // Her article number is who this product IS — to her, her buyers and her
      // factory floor. A generated id in its place means she cannot find her own
      // goods and every re-import silently duplicates her catalogue. One is
      // generated ONLY when the line carried no number at all.
      const sku = p.sku ?? `NEW-${Date.now().toString(36)}-${i}`;
      const moq = p.moq ?? 100;
      // M29 — TRUST RULE, now applied to BOTH halves of a sellable product.
      // A price with no owner-stated floor is not a product she can quote: the
      // floor decides what she may never go below, and an import has no way to
      // know it. So nothing imported is sellable on arrival. The owner answers
      // three questions (savePriceRules) and that is what turns it on.
      const ins = await sql<{ id: string }>`
        insert into products (business_id, sku, name, name_zh, unit, moq, price_usd_per_unit, currency, is_active)
        values (${bid.value}, ${sku}, ${p.name}, ${p.nameZh}, ${p.unit}, ${moq},
                ${p.price?.amount ?? null}, ${p.price?.currency ?? 'USD'}, ${coveredByGeneral(p.price)})
        on conflict (business_id, sku) do nothing returning id`.execute(tx);
      const id = ins.rows[0]?.id;
      if (!id) { alreadyHere++; continue; }        // written by someone else since the review
      added++;
      if (coveredByGeneral(p.price)) ready++;
      if (p.price !== null) {
        withPrice++;
        await sql`insert into price_tiers (product_id, min_qty, unit_price_usd, currency)
                  values (${id}, 1, ${p.price.amount}, ${p.price.currency}) on conflict do nothing`.execute(tx);
        // NO pricing_policy row. This used to write
        //   floor = the list price, maxDiscount = 0, askAbove = 0
        // which is not a cautious default but a fabricated one: it asserts she
        // will never take a cent off and has granted no authority, and she said
        // neither. Every quote was then clamped against a rule she never wrote,
        // under a product whose central claim is that it quotes within HER
        // rules. Absence is the only honest representation of "not asked yet".
      }
    }
    // G16 — a changed line goes through the ONE audited edit, the same as her
    // typing the new price on the product's page: her floor still applies, and
    // the trail says "0.45 → 0.38" and which line of the page said so.
    for (const c of diff.changed) {
      if (!approval || !approval.apply.has(c.product.id)) { alreadyHere++; continue; }
      const r = await updateProductTx(tx, bid.value, c.product.id, approval.actor, {
        price: c.price ? String(c.price.to) : null,
        moq: c.moq ? String(c.moq.to) : null,
      }, { via: 'import', line: c.line.sourceLine ?? c.line.name });
      if (!r.ok) refused++;
      else if (r.changed.length > 0) updated++;
      else alreadyHere++;
    }
    alreadyHere += diff.unchanged.length;
    // A change she ticked that her floor now forbids — raised between the
    // review and this confirm — is a refusal she must hear about, not one more
    // product "left as it is". The recomputed diff is what catches it.
    for (const h of diff.held) {
      if (h.reason === 'below_floor' && h.product && approval?.apply.has(h.product.id)) refused++;
      else alreadyHere++;
    }
  });
  return { added, withPrice, updated, alreadyHere, refused, ready };
}

/** Localized confirm flash — called by the route (has locale). */
export const importFlash = (
  r: { added: number; withPrice: number; updated?: number; alreadyHere?: number; refused?: number; ready?: number },
): readonly FlashPart[] => {
  // M29 — this used to say "Learned N products", which was the false-success
  // class: an imported product is not learned, because the floor that decides
  // what she may never go below has not been stated by anyone. It says what
  // was added and what is still needed before she can quote any of it.
  //
  // A1 — it returns the SENTENCES IT WANTS SAID, not the said sentences: the
  // notice now travels as keys and is written out by the page that shows it,
  // in the language being read rather than the one that posted the form.
  // `{name}` needs no passing — `t` fills it from the locale it is given.
  const parts: FlashPart[] = [];
  // G16 — "Added 0 products" is not news when the page changed prices instead.
  if (r.added > 0 || !(r.updated || r.alreadyHere || r.refused)) {
    parts.push((r.ready ?? 0) > 0 && r.ready === r.withPrice
      // D1 — every priced one is already covered by her answer for everything.
      ? { key: 'product.flash.addedReady', params: { added: r.added, ready: r.ready ?? 0 } }
      : r.withPrice > 0
      ? { key: 'product.flash.addedNeedRules', params: { added: r.added, withPrice: r.withPrice } }
      : { key: 'product.flash.addedNeedPrice', params: { added: r.added } });
  }
  if (r.updated) parts.push({ key: 'product.flash.updated', params: { n: r.updated } });
  // A re-import that changed nothing must say so, not report a silent zero.
  if (r.alreadyHere) parts.push({ key: 'product.flash.alreadyHere', params: { n: r.alreadyHere } });
  // A change she ticked and did not get is said, never folded into "done".
  if (r.refused) parts.push({ key: 'product.flash.refused', params: { n: r.refused } });
  return parts;
};

/** ── Renderers (pure, mobile-first, localized, escaped) ───────────────────── */

const STATUS_KEY = {
  needs_price: 'product.status.needsConfirm', needs_limits: 'product.status.needsLimits', not_offered: 'product.status.notOffered',
} as const;
const statusPill = (locale: Locale, status: ProductStatus): string =>
  status === 'learned'
    ? `<span class="pill ok">${esc(t(locale, 'product.status.learned'))} ✓</span>`
    : `<span class="pill warn">${esc(t(locale, STATUS_KEY[status]))}</span>`;

export function renderProductList(items: readonly ProductListItem[], locale: Locale, flash: Flash | null = null): string {
  const waiting = items.filter((p) => p.status === 'needs_limits').length;
  const head = `<div class="phead"><h1 class="page">${esc(t(locale, 'nav.products'))}</h1><a class="btn send" href="/app/products/add">${esc(t(locale, 'product.teach'))}</a></div>
    ${flashBanner(flash)}
    ${waiting > 0 ? `<div class="block"><p class="fwarn">${esc(t(locale, 'product.list.needLimits', { n: waiting, name: assistantName(locale) }))}
      <a class="blink" href="/app/factory/prices">${esc(t(locale, 'product.list.needLimits.link'))}</a></p></div>` : ''}`;
  if (items.length === 0) {
    return `${head}
      <div class="block"><div class="empty">${esc(t(locale, 'product.list.empty.title'))}<br><span class="muted">${esc(t(locale, 'product.list.empty.body', { name: assistantName(locale) }))}</span>
      <div style="margin-top:var(--space-16)"><a class="btn send" href="/app/products/add">${esc(t(locale, 'product.list.empty.cta'))}</a></div></div></div>`;
  }
  const cards = items.map((p) => {
    const u = unitLabel(locale, p.unit);
    return `
    <a class="prod" href="/app/products/${encodeURIComponent(p.id)}">
      <div class="prod-h"><b>${esc(displayName(locale, p.name, p.nameZh))}</b> <span class="muted">${esc(p.sku)}</span>${statusPill(locale, p.status)}</div>
      <div class="prod-b muted">
        ${p.entryPrice !== null && p.entryQty !== null ? `${esc(formatQty(locale, p.entryQty))}${esc(u)}: ${esc(formatMoney(p.entryPrice))}　` : `${esc(t(locale, 'product.list.priceTbd'))}　`}
        ${esc(t(locale, 'product.list.moq'))}: ${esc(formatQty(locale, p.moq))}${esc(u)}
      </div>
      ${p.imageMatchable ? `<div class="p-tag">📷 ${esc(t(locale, 'product.list.imageMatch'))}</div>` : ''}
    </a>`;
  }).join('');
  return `${head}<div class="list">${cards}</div>`;
}

export function renderProductDetail(
  d: ProductDetail, locale: Locale, flash: Flash | null = null,
  errors: Partial<Record<ProductEditField, ProductEditError>> = {},
  draft: Record<string, string | undefined> = {},
): string {
  const u = unitLabel(locale, d.unit);
  const title = displayName(locale, d.name, d.nameZh);
  const alt = locale === 'zh' ? (d.name !== title ? d.name : null) : (d.nameZh && d.nameZh !== title ? d.nameZh : null);

  // M29 — the edit form. Everything an owner can change about a product she
  // already has; the price limits are their own page because they are three
  // questions about the business, not fields on a row.
  const name = assistantName(locale);
  const ferr = (f: ProductEditField): string =>
    errors[f] ? `<p class="perr">${esc(t(locale, `product.edit.error.${errors[f]}` as MessageKey, { name }))}</p>` : '';
  const val = (f: string, fallback: string): string =>
    esc(draft[f] !== undefined ? draft[f]! : fallback);
  const editForm = `<div class="block">
    <h2>${esc(t(locale, 'product.edit.title'))}</h2>
    <form method="post" action="/app/products/${encodeURIComponent(d.id)}/edit" class="pform">
      <label class="pq"><span>${esc(t(locale, 'product.edit.price'))}</span>
        <input name="price" inputmode="decimal"
               value="${val('price', d.tiers[0] ? String(d.tiers[0].unitPrice.amount) : '')}" />${ferr('price')}</label>
      <label class="pq"><span>${esc(t(locale, 'product.edit.moq'))}</span>
        <input name="moq" inputmode="numeric" value="${val('moq', String(d.moq))}" />${ferr('moq')}</label>
      <label class="pq"><span>${esc(t(locale, 'product.edit.unit'))}</span>
        <input name="unit" value="${val('unit', d.unit)}" />${ferr('unit')}</label>
      <label class="pcheck"><input type="checkbox" name="isActive" ${d.isActive ? 'checked' : ''} />
        <span>${esc(t(locale, 'product.edit.active'))}</span></label>
      <button class="btn send" type="submit">${esc(t(locale, 'product.edit.save'))}</button>
    </form>
  </div>`;

  const tiers = d.tiers.length
    ? `<div class="block"><h2>${esc(t(locale, 'product.detail.priceTitle'))}</h2><div class="tiers">${d.tiers.map((tr) =>
        `<div class="tier"><span>${esc(formatQty(locale, tr.minQty))}${tr.maxQty ? `–${esc(formatQty(locale, tr.maxQty))}` : '+'}${esc(u)}</span><b>${esc(formatMoney(tr.unitPrice))}</b></div>`).join('')}</div></div>`
    : `<div class="block"><h2>${esc(t(locale, 'product.detail.priceTitle'))}</h2><p class="muted">${esc(t(locale, 'product.detail.noPrice'))} <a href="/app/products/add">${esc(t(locale, 'product.detail.addPrice'))}</a></p></div>`;

  const aliases = d.aliases.length
    ? `<div class="block"><h2>${esc(t(locale, 'product.detail.aliasesTitle'))}</h2><div class="chips">${d.aliases.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}</div>
        <p class="muted">${esc(t(locale, 'product.detail.aliasesNote', { name: assistantName(locale) }))}</p></div>`
    : '';

  const images = d.images.length
    ? `<div class="block"><h2>${esc(t(locale, 'product.detail.imagesTitle'))}</h2><div class="imgs">${d.images.map((url) => `<img src="${esc(url)}" alt="${esc(title)}" loading="lazy" />`).join('')}</div></div>`
    : '';

  const quotes = d.recentQuotes.length
    ? `<div class="block"><h2>${esc(t(locale, 'product.detail.recentQuotesTitle'))}</h2>${d.recentQuotes.map((q) =>
        `<div class="qrow muted">${esc(formatQty(locale, q.quantity))}${esc(u)} · ${esc(formatMoney(q.unitPrice))}/${esc(u)} · ${esc(t(locale, 'product.detail.total'))} ${esc(formatMoney(q.total))}</div>`).join('')}</div>`
    : '';

  return `
    ${flashBanner(flash)}
    <div class="dhead">${back('/app/products', t(locale, 'product.detail.back'))}
      <div class="who"><b>${esc(title)}</b>${alt ? ` <span class="muted">${esc(alt)}</span>` : ''} <span class="muted">${esc(d.sku)}</span></div>${statusPill(locale, d.status)}</div>
    ${d.imageMatchable ? `<div class="p-tag big">📷 ${esc(t(locale, 'product.detail.imageMatchBig', { name: assistantName(locale) }))}</div>` : ''}
    <div class="block"><h2>${esc(t(locale, 'product.detail.infoTitle'))}</h2>
      <div class="info">
        ${d.category ? `<div><span class="muted">${esc(t(locale, 'product.detail.category'))}</span> ${esc(d.category)}</div>` : ''}
        <div><span class="muted">${esc(t(locale, 'product.list.moq'))}</span> ${esc(formatQty(locale, d.moq))}${esc(u)}</div>
        ${d.leadTimeDays !== null ? `<div><span class="muted">${esc(t(locale, 'product.detail.leadTime'))}</span> ${esc(t(locale, 'product.detail.leadTimeDays', { days: d.leadTimeDays }))}</div>` : ''}
        <div><span class="muted">${esc(t(locale, 'product.detail.customizable'))}</span> ${esc(d.customizable ? t(locale, 'product.detail.yes') : t(locale, 'product.detail.no'))}</div>
      </div>
    </div>
    ${tiers}${editForm}${aliases}${images}${quotes}`;
}

export function renderAddForm(locale: Locale): string {
  return `<h1 class="page">${esc(t(locale, 'product.teach'))}</h1>
    <div class="block">
      <p>${esc(t(locale, 'product.add.intro'))}</p>
      <p class="muted">${esc(t(locale, 'product.add.exampleLabel'))}<br>${esc(t(locale, 'product.add.example1'))}<br>${esc(t(locale, 'product.add.example2'))}</p>
      <form method="post" action="/app/products/add/review">
        <textarea name="text" rows="8" placeholder="${esc(t(locale, 'product.add.placeholder'))}" autofocus></textarea>
        <button class="btn send" type="submit">${esc(t(locale, 'product.add.submit'))}</button>
      </form>
      <p class="muted" style="font-size:var(--font-size-caption)">${esc(t(locale, 'product.add.note'))}</p>
    </div>
    <div class="block">
      <h2>${esc(t(locale, 'product.add.photoTitle'))}</h2>
      <p>${esc(t(locale, 'product.add.photoIntro'))}</p>
      <form method="post" action="/app/products/add/photo" enctype="multipart/form-data">
        <input class="photo-in" type="file" name="page" accept="image/jpeg,image/png,image/webp" capture="environment" required />
        <button class="btn send" type="submit">${esc(t(locale, 'product.add.photoButton'))}</button>
      </form>
      <p class="muted" style="font-size:var(--font-size-caption)">${esc(t(locale, 'product.photo.allOrNothing'))}</p>
    </div>`;
}

/** Rejected lines shown one by one before the rest become "and N more". */
const REJECTED_SHOWN = 8;

export function renderReview(
  v: ValidatedImport, rawText: string, locale: Locale,
  diff: CatalogueDiff = diffAgainstCatalogue(v.accepted, []),
): string {
  // M37 — THE SOURCE LINE, beside every product, in BOTH flows.
  // What she confirms is a TRANSCRIPTION, not a list: the line she can compare
  // against the page in her hand sits under the product it produced. A price
  // that no line contains has nowhere to hide, because every price is shown
  // next to the text it came out of.
  const from = (p: ExtractedProduct): string => p.sourceLine
    ? `<span class="rev-src muted">${esc(t(locale, 'product.review.fromLine'))} <bdi>${esc(p.sourceLine)}</bdi></span>` : '';
  const known = (e: CatalogueEntry): string =>
    `<b>${esc(displayName(locale, e.name, e.nameZh))}</b> <span class="muted">${esc(e.sku)}</span>`;

  // G16 — what the page CHANGES, first: the one thing she must look at. Each
  // change is its own tick, on by default, so a price the page does not really
  // say can be left out without throwing away the rest of the sheet.
  const changed = diff.changed.map((c) => {
    const money = (n: number | null): string => n === null || c.product.currency === null
      ? t(locale, 'product.list.priceTbd') : formatMoney({ amount: n, currency: c.product.currency });
    const moves = [
      c.price ? t(locale, 'product.review.change.price', { from: money(c.price.from), to: money(c.price.to) }) : null,
      c.moq ? t(locale, 'product.review.change.moq', { from: formatQty(locale, c.moq.from), to: formatQty(locale, c.moq.to) }) : null,
    ].filter((m): m is string => m !== null).map((m) => `<span class="rev-move">${esc(m)}</span>`).join('');
    return `
    <label class="rev chg"><input type="checkbox" name="apply:${esc(c.product.id)}" checked /> ${known(c.product)}
      ${moves}${from(c.line)}
    </label>`;
  }).join('');
  const added = diff.added.map((p) => `
    <div class="rev"><b>${esc(p.name)}</b>
      <span class="muted">${p.price !== null ? esc(formatMoney(p.price)) : esc(t(locale, 'product.list.priceTbd'))}${p.moq !== null ? ` · ${esc(t(locale, 'product.review.moqSuffix', { qty: formatQty(locale, p.moq) }))}` : ''}</span>
      ${p.price === null ? `<span class="pill warn">${esc(t(locale, 'product.status.needsConfirm'))}</span>` : `<span class="pill ok">${esc(t(locale, 'product.review.canLearn'))}</span>`}
      ${from(p)}
    </div>`).join('');
  const unchanged = diff.unchanged.map((u) => `<div class="rev">${known(u.product)}</div>`).join('');
  const held = diff.held.map((h) => `
    <div class="rev">${h.product ? known(h.product) : `<b>${esc(h.line.name)}</b>`}
      <span class="rev-move">${esc(t(locale, `product.review.held.${h.reason}`))}</span>
      ${h.product ? `<a href="/app/products/${esc(h.product.id)}">${esc(t(locale, 'product.review.openProduct'))}</a>` : ''}
      ${from(h.line)}
    </div>`).join('');

  // Every line the page had and the catalogue will not get is accounted for:
  // shown, or counted. A silent cut at eight was a page that seemed shorter.
  const rest = v.rejected.length - REJECTED_SHOWN;
  const rejected = v.rejected.length
    ? `<div class="block"><h2>${esc(t(locale, 'product.review.rejectedTitle'))}</h2>${v.rejected.slice(0, REJECTED_SHOWN).map((r) => `<div class="muted">· ${esc(r.product.name || t(locale, 'product.review.emptyLine'))} —— ${esc(t(locale, `product.reject.${r.reason}` as MessageKey))}</div>`).join('')}${rest > 0 ? `<div class="muted">${esc(t(locale, 'activation.recipients.more', { n: rest }))}</div>` : ''}</div>`
    : '';

  const everythingNew = diff.added.length === v.accepted.length;
  const offered = diff.added.length + diff.changed.length;
  const body = `
    ${changed ? `<div class="block"><h2>${esc(t(locale, 'product.review.changedTitle', { count: diff.changed.length }))}</h2>
      <p class="muted">${esc(t(locale, 'product.review.changedHint'))}</p>${changed}</div>` : ''}
    ${added ? `<div class="block"><h2>${esc(everythingNew
      ? t(locale, 'product.review.recognized', { count: diff.added.length })
      : t(locale, 'product.review.addedTitle', { count: diff.added.length }))}</h2>${added}</div>` : ''}
    ${held ? `<div class="block"><h2>${esc(t(locale, 'product.review.heldTitle'))}</h2>${held}</div>` : ''}
    ${unchanged ? `<div class="block"><h2>${esc(t(locale, 'product.review.unchangedTitle', { count: diff.unchanged.length }))}</h2>${unchanged}</div>` : ''}
    ${v.accepted.length === 0
      ? `<div class="block"><div class="empty muted">${esc(t(locale, 'product.review.noneRecognized'))} <a href="/app/products/add">${esc(t(locale, 'product.review.tryAgain'))}</a></div></div>`
      : offered === 0
        ? `<div class="block"><div class="empty muted">${esc(t(locale, 'product.review.nothingToChange'))} <a href="/app/products">${esc(t(locale, 'product.detail.back'))}</a></div></div>`
        : ''}
    ${rejected}`;

  return `<h1 class="page">${esc(t(locale, 'product.review.title'))}</h1>
    ${offered > 0 ? `<form method="post" action="/app/products/add/confirm">
      <input type="hidden" name="text" value="${esc(rawText)}" />
      ${body}
      <button class="btn send" type="submit">${esc(t(locale, diff.added.length > 0 ? 'product.review.confirm' : 'product.review.confirmChanges'))}</button>
      <a class="btn" href="/app/products/add">${esc(t(locale, 'product.review.repaste'))}</a>
    </form>` : body}
    `;
}


/**
 * M29 — the owner edits her own product.
 *
 * Until now `confirmImport` was the only writer of `products` outside the demo
 * seeds, and every insert was `on conflict do nothing`. A wrong price could not
 * be corrected: re-importing the same sku collided and was reported as "already
 * here", so the catalogue was write-once by accident rather than by design.
 *
 * ARCHIVE, NEVER ERASE. The app role holds no DELETE anywhere; a product the
 * owner stops selling is `is_active = false`, which the retrieval and quote
 * paths already treat as not-on-offer. Nothing is removed.
 *
 * A PRICE CHANGE READS AS A CHANGE. Every field that moved is audited with its
 * BEFORE and AFTER, so "0.45 → 0.38" is recoverable from the trail rather than
 * being a silent overwrite. The list price and the entry tier move together —
 * they are the same fact stored twice, and letting them drift is how a quote
 * comes out at a price the owner never set.
 */
export type ProductEdit = {
  readonly price?: string | null;
  readonly moq?: string | null;
  readonly unit?: string | null;
  readonly isActive?: boolean;
};

export type ProductEditField = 'price' | 'moq' | 'unit' | 'isActive';
export type ProductEditError = 'not_a_number' | 'not_positive' | 'empty' | 'below_floor';

export type EditResult =
  | { readonly ok: true; readonly changed: readonly ProductEditField[] }
  | { readonly ok: false; readonly errors: Partial<Record<ProductEditField, ProductEditError>> };

export async function updateProduct(
  db: Db, businessIdRaw: string, productId: string, actor: string, edit: ProductEdit,
): Promise<EditResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { ok: false, errors: {} };
  return withTenantTx(db, bid.value, (tx) => updateProductTx(tx, bid.value, productId, actor, edit));
}

/**
 * G16 — where a change came from when it was not typed on the product's page:
 * a line of a price sheet she confirmed, kept verbatim on the audit row so the
 * trail can say which line moved the price.
 */
type EditSource = { readonly via: 'import'; readonly line: string };

/** The one audited edit, inside a caller's transaction (G16: the import's). */
async function updateProductTx(
  tx: Tx, bid: BusinessId, productId: string, actor: string, edit: ProductEdit, source?: EditSource,
): Promise<EditResult> {
  const cur = (await sql<{
    price: string | null; moq: number; unit: string; is_active: boolean; floor: string | null;
  }>`
    select p.price_usd_per_unit as price, p.moq, p.unit, p.is_active,
           pp.floor_price_usd as floor
      from products p
      left join pricing_policy pp
        on pp.business_id = ${bid} and pp.product_id = p.id
     where p.business_id = ${bid} and p.id = ${productId} limit 1
  `.execute(tx)).rows[0];
  if (!cur) return { ok: false, errors: {} };

  const errors: Partial<Record<ProductEditField, ProductEditError>> = {};
  let price: number | null = cur.price === null ? null : Number(cur.price);
  let moq = cur.moq;
  let unit = cur.unit;

  if (edit.price !== undefined && edit.price !== null && edit.price.trim() !== '') {
    const n = Number(edit.price.trim());
    if (!Number.isFinite(n)) errors.price = 'not_a_number';
    else if (!(n > 0)) errors.price = 'not_positive';
    // A new list price BELOW her own floor would make the product silently
    // unquotable — quote.ts refuses `below_floor` rather than selling at a
    // loss. She is told now, not by a buyer's silence later.
    else if (cur.floor !== null && n < Number(cur.floor)) errors.price = 'below_floor';
    else price = Number(n.toFixed(4));
  }
  if (edit.moq !== undefined && edit.moq !== null && edit.moq.trim() !== '') {
    const n = Number(edit.moq.trim());
    if (!Number.isFinite(n)) errors.moq = 'not_a_number';
    else if (!(n > 0) || !Number.isInteger(n)) errors.moq = 'not_positive';
    else moq = n;
  }
  if (edit.unit !== undefined && edit.unit !== null) {
    const u = edit.unit.trim();
    if (u === '') errors.unit = 'empty';
    else unit = u;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const isActive = edit.isActive ?? cur.is_active;
  const changed: ProductEditField[] = [];
  const detail: Record<string, { from: unknown; to: unknown }> = {};
  const note = (f: ProductEditField, from: unknown, to: unknown) => {
    if (from !== to) { changed.push(f); detail[f] = { from, to }; }
  };
  note('price', cur.price === null ? null : Number(cur.price), price);
  note('moq', cur.moq, moq);
  note('unit', cur.unit, unit);
  note('isActive', cur.is_active, isActive);

  if (changed.length === 0) return { ok: true, changed: [] };

  await sql`
    update products set price_usd_per_unit = ${price}, moq = ${moq}, unit = ${unit},
                        is_active = ${isActive}, updated_at = now()
     where business_id = ${bid} and id = ${productId}
  `.execute(tx);

  // The entry tier is the same fact as the list price. Letting them drift is
  // how a quote comes out at a number the owner never set.
  if (detail['price'] && price !== null) {
    await sql`
      insert into price_tiers (product_id, min_qty, unit_price_usd)
      values (${productId}, 1, ${price})
      on conflict (product_id, min_qty) do update set unit_price_usd = excluded.unit_price_usd
    `.execute(tx);
  }

  await sql`
    insert into channel_audit (business_id, channel_id, action, actor, detail)
    values (${bid}, null, 'product_edited', ${actor},
            ${JSON.stringify({ productId, changes: detail, ...(source ? { source } : {}) })}::jsonb)
  `.execute(tx);

  return { ok: true, changed };
}

/* ── M37 · photograph the price list ─────────────────────────────────────── */

/**
 * The outcome of pointing a phone at a printed price sheet.
 *
 * REFUSED IS WHOLE. A page that cannot be read produces no products at all —
 * never "we got some of them". A half-read price sheet is worse than none,
 * because the owner cannot tell WHICH half is missing and will assume the
 * catalogue is complete.
 */
export type PhotoImport =
  | {
      readonly kind: 'read';
      /**
       * THE STAGED TEXT — the lines that became products, not the whole page.
       *
       * It round-trips through the confirm form's hidden field, and `confirmImport`
       * re-parses it. So it must contain exactly what the review showed as
       * accepted: staging the whole page instead would let confirm write rows the
       * review never displayed, which is this repo's recurring bug in its purest
       * form — two paths deriving the same list by different rules.
       */
      readonly text: string;
      readonly review: ValidatedImport;
    }
  | { readonly kind: 'refused'; readonly reason: 'not_configured' | 'unreadable' | 'no_lines' };

/**
 * Every reason a photograph comes to nothing, each named for what it is — the
 * three above from reading it, and three from the upload itself, because each
 * asks her to do something different:
 *
 *   too_large      over the limit          → take it again, smaller
 *   not_a_photo    a PDF, a document       → photograph the page instead
 *   upload_failed  it did not arrive whole → send it again
 *
 * G16 — every upload failure used to read "too large", so a photo that broke
 * on the way told her to shrink a picture that was never too big.
 */
export type PhotoRefusal = Extract<PhotoImport, { kind: 'refused' }>['reason'] | 'too_large' | 'not_a_photo' | 'upload_failed';

/**
 * Vision DESCRIBES; the parser EXTRACTS. This joins them and does neither.
 *
 * The transcriber returns TEXT. `parsePriceLines` — deterministic, no model —
 * turns text into products. So a price the model invented cannot become a
 * product unless it also appears as a line, and the line is shown to the owner
 * beside the product it produced.
 */
export async function importFromPhoto(
  deps: { transcriber?: PageTranscriber | undefined },
  input: { imageBase64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' },
): Promise<PhotoImport> {
  // Absent is a legitimate state, like M34's transcriber: she is told the truth
  // rather than shown an empty result she would read as "nothing on the page".
  if (!deps.transcriber) return { kind: 'refused', reason: 'not_configured' };

  const page = await deps.transcriber.transcribe(input);
  if (page.unreadable || !page.text.trim()) return { kind: 'refused', reason: 'unreadable' };

  // The PAGE rule, not the paste rule: a photograph carries the letterhead and
  // the column headings too, and under the paste rule every one of those would
  // become a priceless product in her catalogue.
  const review = validatePage(parsePriceLines(page.text));
  // Text came back, but nothing on the page parsed as a product. Refusing here
  // rather than showing an empty review with reject codes is the same rule:
  // she learns the page was not a price list, instead of reading a screenful of
  // "not recognized" and concluding her products vanished.
  //
  // NOT a threshold. Lines that are not products — a letterhead, a phone
  // number, a column heading — are on every real price sheet, and refusing a
  // page because it has a header would make this useless. The rule is
  // structural: nothing recognized is not an import.
  if (review.accepted.length === 0) return { kind: 'refused', reason: 'no_lines' };
  // Stage the lines that became products, so what confirm writes is what the
  // review showed. Every accepted product has a source line, because the parser
  // only produces one from a line.
  const staged = review.accepted.map((p) => p.sourceLine ?? '').filter((l) => l !== '').join('\n');
  return { kind: 'read', text: staged, review };
}

/**
 * The page she cannot read.
 *
 * A refusal, rendered whole: no partial list, no "here is what we got". It
 * names the reason in her language and names the next action — take another
 * photo, or paste the text, which is the path that always works.
 */
export function renderPhotoRefusal(reason: PhotoRefusal, locale: Locale): string {
  return `<h1 class="page">${esc(t(locale, 'product.photo.refusedTitle'))}</h1>
    <div class="block">
      <p>${esc(t(locale, `product.photo.refused.${reason}` as MessageKey))}</p>
      <p class="muted">${esc(t(locale, 'product.photo.allOrNothing'))}</p>
      <p><a class="btn" href="/app/products/add">${esc(t(locale, reason === 'not_configured' ? 'product.photo.pasteInstead' : 'product.photo.retake'))}</a></p>
    </div>`;
}
