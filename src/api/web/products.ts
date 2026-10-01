import { PHOTO_READS_A_DAY } from '../../db/allowance.js';
import { sql } from 'kysely';
import { type Money, type Currency, parseCurrency, moneyFromRow } from '../../core/types/money.js';
import { readTypedAmount } from '../../core/commerce/amount.js';
import { currencyOf } from '../../db/currency.js';
import { withTenantTx, type Db, type Tx } from '../../db/client.js';
import { parseBusinessId, type BusinessId } from '../../core/types/ids.js';
import { parsePriceLines, type ExtractedProduct } from '../../core/onboard/catalogImport.js';
import { diffAgainstCatalogue, type CatalogueEntry } from '../../core/onboard/catalogDiff.js';
import { rowsFromParsed, asExtracted, liveRows, type ImportRow } from '../../core/onboard/importReview.js';
import { defaultUnitFor, sellsByQuantity } from '../../core/owner/sellingStyle.js';
import { renderStoreForms } from './storeImport.js';
import { savePriceRulesTx } from './priceRules.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, tn, assistantName } from './say.js';
import { labelled } from '../../core/owner/i18n/format.js';
import { generatedSku, ownSku } from '../../core/owner/sku.js';
import { cleanName, parseCustomerNames, MAX_ALIAS_LENGTH } from '../../core/onboard/aliases.js';
import { addAliases, renameAlias } from '../../db/productAliases.js';
import { esc, back, deeper } from './layout.js';
import { flashBanner, type Flash, type FlashPart } from './flash.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';
import * as show from './values.js';

/** Phase 4 — prices and products are the owner's (CC-07). A sales assistant
 *  reads them; in place of each form that would only refuse, this line. */
const ownerDecides = (locale: Locale): string =>
  `<p class="muted">${esc(t(locale, 'staff.ownerDecides'))}</p>`;

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
/** RT — the unit codes a price can be per, each in the reader's language; the owner's own word as she typed it. */
const UNIT_CODES = new Set(['item', 'pcs', 'pair', 'set', 'pack', 'box', 'carton', 'dozen', 'bottle', 'kg', 'g', 'm', 'l', 'ml']);
export const unitLabel = (locale: Locale, unit: string): string =>
  UNIT_CODES.has(unit) ? t(locale, `product.unit.${unit}` as MessageKey) : unit;

/** One figure (or a figure and its word), isolated so a right-to-left line cannot reorder it. */
const iso = (x: string): string => `<bdi>${esc(x)}</bdi>`;

/** CC-31 — her own article number beside a name, muted; nothing for one the import made up. */
const skuMark = (sku: string): string => {
  const own = ownSku(sku);
  return own ? ` <span class="muted"><bdi>${esc(own)}</bdi></span>` : '';
};

export type ProductListItem = {
  readonly id: string;
  readonly name: string;
  readonly nameZh: string | null;
  readonly sku: string;
  /** 0081 — null: no minimum. */
  readonly moq: number | null;
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
export type ProductStatus = 'learned' | 'needs_price' | 'needs_limits' | 'not_offered' | 'not_findable';

/**
 * T3 — "Ready" (no mark) only for a product customers can reach: offered, priced,
 * AND found by some name (`src/core/onboard/aliases.ts`). Offered and priced but
 * found by no name is its own state, said on the page.
 */
export const productStatus = (p: {
  readonly isActive: boolean; readonly hasPrice: boolean; readonly hasLimits: boolean; readonly findable: boolean;
}): ProductStatus =>
  !p.hasPrice ? 'needs_price'
  : p.isActive ? (p.findable ? 'learned' : 'not_findable')
  : p.hasLimits ? 'not_offered' : 'needs_limits';

/** RT — the business's kind, for what its product pages state (`sellsByQuantity`). */
export async function businessKind(db: Db, businessIdRaw: string): Promise<string | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, (tx) => kindOf(tx, bid.value));
}

export async function loadProductList(db: Db, businessIdRaw: string): Promise<readonly ProductListItem[]> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return [];
  return withTenantTx(db, bid.value, async (tx) => (await sql<{
    id: string; name: string; name_zh: string | null; sku: string; moq: number | null; unit: string;
    is_active: boolean; price: string | null; currency: string;
    entry_qty: number | null; entry_price: string | null; extras: number; has_limits: boolean; has_alias: boolean;
  }>`
    select p.id, p.name, p.name_zh, p.sku, p.moq, p.unit, p.is_active, p.price_usd_per_unit as price,
           p.currency, t.min_qty as entry_qty, t.unit_price_usd as entry_price,
           exists (select 1 from pricing_policy pp where pp.business_id = p.business_id
                    and (pp.product_id = p.id or pp.product_id is null)) as has_limits,
           (select count(*) from product_aliases a where a.product_id = p.id)
             + (select count(*) from product_images i where i.product_id = p.id) as extras,
           exists (select 1 from product_aliases a where a.product_id = p.id) as has_alias
      from products p
      left join lateral (select min_qty, unit_price_usd from price_tiers pt
                          where pt.product_id = p.id order by min_qty asc limit 1) t on true
     order by p.is_active desc, p.updated_at desc
     limit 200
  `.execute(tx)).rows.map((r): ProductListItem => {
    const entryPrice = r.entry_price !== null ? Number(r.entry_price) : (r.price !== null ? Number(r.price) : null);
    return {
      id: r.id, name: r.name, nameZh: r.name_zh, sku: r.sku, moq: r.moq, unit: r.unit,
      entryQty: r.entry_qty ?? (entryPrice !== null ? r.moq ?? 1 : null),
      // G18 — her product's own currency, not an assumed dollar.
      entryPrice: entryPrice === null ? null : moneyFromRow(entryPrice, r.currency),
      learned: r.is_active && entryPrice !== null,
      status: productStatus({ isActive: r.is_active, hasPrice: entryPrice !== null, hasLimits: r.has_limits, findable: r.has_alias }),
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
  /** 0081 — null: no minimum. */
  readonly moq: number | null;
  readonly leadTimeDays: number | null;
  readonly customizable: boolean;
  /** RT — the business's kind: a shop's page shows a minimum only where one is set. Absent: bulk. */
  readonly businessKind?: string | null;
  readonly learned: boolean;
  readonly status: ProductStatus;
  readonly imageMatchable: boolean;
  /** M29 — whether she offers it to buyers. Archive-never-erase: false, not gone. */
  readonly isActive: boolean;
  readonly tiers: readonly { minQty: number; maxQty: number | null; unitPrice: Money }[];
  readonly aliases: readonly string[];
  readonly images: readonly string[];
  readonly recentQuotes: readonly { quantity: number; unitPrice: Money; total: Money }[];
  /** CUR — the workspace's one currency: a price typed on this page is in it. */
  readonly currency: Currency;
  /** K3 — the line of her list it was added from, and the photo, when it came from one. */
  readonly source?: { readonly line: string; readonly importId: string | null; readonly photo: number | null } | null;
};

export async function loadProductDetail(db: Db, businessIdRaw: string, productId: string): Promise<ProductDetail | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const p = (await sql<{
      id: string; name: string; name_zh: string | null; sku: string; category: string | null;
      unit: string; moq: number | null; lead_time_days: number | null; customizable: boolean;
      is_active: boolean; price: string | null; currency: string; has_limits: boolean;
      source_line: string | null; source_import_id: string | null; photo: number | null; kind: string | null;
    }>`select id, name, name_zh, sku, category, unit, moq, lead_time_days, customizable, is_active,
              price_usd_per_unit as price, currency, source_line, source_import_id,
              (select b.kind from businesses b where b.id = products.business_id) as kind,
              (select ph.position from catalog_import_photos ph where ph.id = products.source_photo_id) as photo,
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
      category: p.category, unit: p.unit, moq: p.moq, leadTimeDays: p.lead_time_days, businessKind: p.kind,
      customizable: p.customizable, learned, isActive: p.is_active,
      status: productStatus({ isActive: p.is_active, hasPrice: tiers.length > 0 || p.price !== null, hasLimits: p.has_limits, findable: aliases.length > 0 }),
      imageMatchable: p.is_active && aliases.length + images.length > 0,
      tiers, aliases, images, recentQuotes,
      currency: await currencyOf(tx, bid.value),
      source: p.source_line === null ? null : { line: p.source_line, importId: p.source_import_id, photo: p.photo },
    };
  });
}

/** ── Teach flow: paste → parse (reuse M6) → review → confirm → available ─── */

/**
 * G16 — her catalogue, as the comparison with a page needs to see it.
 *
 * The floor is the product's own, the one `updateProduct` refuses below — the
 * review holds back exactly the change the save would refuse, by the same rule.
 */
export async function catalogueForTx(tx: Tx, bid: BusinessId): Promise<readonly CatalogueEntry[]> {
  const rows = (await sql<{
    id: string; sku: string; name: string; name_zh: string | null;
    price: string | null; currency: string; moq: number | null; floor: string | null;
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
  return withTenantTx(db, bid.value, async (tx) => {
    // CUR — the same lines, read in the same currency the review read them in.
    const currency = await currencyOf(tx, bid.value);
    const rows = rowsFromParsed(parsePriceLines(rawText, currency),
      { photo: null, startAt: 1, defaultUnit: defaultUnitFor(await kindOf(tx, bid.value)), page: false });
    return (await writeImportRows(tx, bid.value, rows, currency, approval ?? { actor: 'owner', apply: new Set() },
      { importId: null, photoIds: new Map() }, null)).result;
  });
}

/** The business's kind (RT: it decides the unit a new product counts in). */
async function kindOf(tx: Tx, bid: BusinessId): Promise<string | null> {
  return (await sql<{ kind: string | null }>`select kind from businesses where id = ${bid}`.execute(tx)).rows[0]?.kind ?? null;
}

/**
 * K1 — THE ONE WRITER. The rows as they stand when the owner confirms — her
 * names, units, minimums and removals — become products, or change the ones
 * she has; nothing is re-read from text on the way.
 *
 * Inside the caller's transaction. `floors` (K2) is the lowest price for each
 * new priced row whose floor she ticked, keyed by row: each is written through
 * the one price-rules save, so each carries its own `price_rules_set` audit row
 * and switches its product on. Without one, a product arrives off — unless her
 * answer for everything already covers it (D1).
 */
export async function writeImportRows(
  tx: Tx, bid: BusinessId, rows: readonly ImportRow[], currency: Currency, approval: ImportApproval,
  source: { readonly importId: string | null; readonly photoIds: ReadonlyMap<number, string> },
  floors: { readonly byRow: ReadonlyMap<string, number>; readonly discountPct: number } | null,
): Promise<{ readonly result: ImportResult & { readonly floors: number }; readonly rows: readonly ImportRow[] }> {
  let added = 0, withPrice = 0, updated = 0, alreadyHere = 0, refused = 0, ready = 0, floorsSet = 0;
  const live = liveRows(rows);
  const byLine = new Map<ExtractedProduct, ImportRow>();
  const lines = live.map((r) => { const e = asExtracted(r, currency); byLine.set(e, r); return e; });
  const productOf = new Map<string, string>();
  // The SAME diff the review showed, from the same rows — recomputed here rather
  // than trusted from the form, so a posted product id can only choose among
  // changes this business's own catalogue produced.
  const diff = diffAgainstCatalogue(lines, await catalogueForTx(tx, bid));
  // D1 — has she already answered FOR EVERYTHING? Then a priced line her floor
  // does not exceed arrives sellable: M29's rule is that a human states the
  // floor, and she has. Without that answer nothing changes — still off.
  const general = (await sql<{ floor: string; currency: string }>`
    select floor_price_usd as floor, currency from pricing_policy
     where business_id = ${bid} and product_id is null limit 1`.execute(tx)).rows[0];
  const coveredByGeneral = (price: { amount: number; currency: string } | null): boolean =>
    price !== null && general !== undefined && price.currency === general.currency && price.amount >= Number(general.floor);
  for (let i = 0; i < diff.added.length; i++) {
    const p = diff.added[i]!;
    const row = byLine.get(p)!;
    // Her article number is who this product IS — to her, her customers and her
    // stock. A generated id in its place means she cannot find her own goods and
    // every re-import silently duplicates her catalogue. One is generated ONLY
    // when the line carried no number at all.
    const sku = p.sku ?? generatedSku(Date.now(), i);
    // M29 — TRUST RULE, applied to BOTH halves of a sellable product. A price
    // with no owner-stated floor is not a product she can quote: nothing
    // imported is sellable on arrival unless she answered for it (D1, K2).
    const ins = await sql<{ id: string }>`
      insert into products (business_id, sku, name, name_zh, unit, moq, price_usd_per_unit, currency, is_active,
                            source_line, source_import_id, source_photo_id)
      values (${bid}, ${sku}, ${p.name}, ${p.nameZh}, ${p.unit}, ${p.moq},
              ${p.price?.amount ?? null}, ${p.price?.currency ?? currency}, ${coveredByGeneral(p.price)},
              ${row.line}, ${source.importId}, ${row.photo === null ? null : source.photoIds.get(row.photo) ?? null})
      on conflict (business_id, sku) do nothing returning id`.execute(tx);
    const id = ins.rows[0]?.id;
    if (!id) { alreadyHere++; continue; }        // written by someone else since the review
    added++;
    productOf.set(row.key, id);
    // T3 — the names it is found by: its own, and the ones she said customers use.
    const findable = (await addAliases(tx, id, [p.name, p.nameZh, ...row.names])) > 0;
    if (p.price !== null) {
      withPrice++;
      await sql`insert into price_tiers (product_id, min_qty, unit_price_usd, currency)
                values (${id}, 1, ${p.price.amount}, ${p.price.currency}) on conflict do nothing`.execute(tx);
      // NO pricing_policy row unless she answered: absence is the only honest
      // representation of "not asked yet" (M29).
    }
    // K8 — a store's options (sizes, colours, shades) are what the product is
    // offered in: its knowledge, never a price. Figures in it ("EU 38") are
    // sourced for this product, as product knowledge always is.
    if (row.options) {
      const label = row.options.split(' · ').map((part) => part.split(':')[0]!.trim()).filter(Boolean).join(', ').slice(0, 80) || 'Options';
      await sql`insert into product_knowledge (business_id, product_id, kind, label, content, source_language, source, status)
                values (${bid}, ${id}::uuid, 'specification', ${label}, ${row.options}, 'und', 'owner_confirmed', 'active')`.execute(tx);
    }
    // K3 — where it came from, on the audit trail: the line, the import, the photo.
    await sql`
      insert into channel_audit (business_id, channel_id, action, actor, detail)
      values (${bid}, null, 'product_imported', ${approval.actor}, ${JSON.stringify({
        productId: id, importId: source.importId, line: row.line, photo: row.photo,
        name: p.name, price: p.price?.amount ?? null, currency: p.price?.currency ?? currency, unit: p.unit, moq: p.moq,
        names: row.names, edited: row.edited,
      })}::jsonb)`.execute(tx);
    // K2 — her discount, as this product's lowest price, the one she ticked.
    const floor = floors?.byRow.get(row.key);
    let sellable = coveredByGeneral(p.price);
    if (floors && floor !== undefined && p.price !== null) {
      const pct = String(floors.discountPct);
      const r = await savePriceRulesTx(tx, bid, approval.actor, { productId: id, floor: String(floor), maxDiscountPct: pct, askAbovePct: pct });
      if (r.ok) { floorsSet++; sellable = true; }
    }
    if (sellable && findable) ready++;
  }
  // G16 — a changed line goes through the ONE audited edit, the same as her
  // typing the new price on the product's page: her floor still applies, and
  // the trail says "0.45 → 0.38" and which line of the page said so.
  for (const c of diff.changed) {
    if (!approval.apply.has(c.product.id)) { alreadyHere++; continue; }
    const r = await updateProductTx(tx, bid, c.product.id, approval.actor, {
      price: c.price ? String(c.price.to) : null,
      moq: c.moq ? String(c.moq.to) : null,
    }, { via: 'import', line: c.line.sourceLine ?? c.line.name });
    if (!r.ok) refused++;
    else if (r.changed.length > 0) { updated++; productOf.set(byLine.get(c.line)!.key, c.product.id); }
    else alreadyHere++;
  }
  alreadyHere += diff.unchanged.length;
  // A change she ticked that her floor now forbids — raised between the review
  // and this confirm — is a refusal she must hear about, not one more product
  // "left as it is". The recomputed diff is what catches it.
  for (const h of diff.held) {
    if (h.reason === 'below_floor' && h.product && approval.apply.has(h.product.id)) refused++;
    else alreadyHere++;
  }
  return {
    result: { added, withPrice, updated, alreadyHere, refused, ready, floors: floorsSet },
    rows: rows.map((r) => (productOf.has(r.key) ? { ...r, productId: productOf.get(r.key)! } : r)),
  };
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
  not_findable: 'product.status.notFindable',
} as const;
const statusPill = (locale: Locale, status: ProductStatus): string =>
  // An absent mark means fine: only what is NOT in order gets a pill.
  status === 'learned' ? '' : `<span class="pill warn">${esc(t(locale, STATUS_KEY[status]))}</span>`;

export function renderProductList(
  items: readonly ProductListItem[], locale: Locale, flash: Flash | null = null, viewer: Viewer = OWNER_VIEW,
  kind: string | null = null,
): string {
  const byQuantity = sellsByQuantity(kind);
  const waiting = items.filter((p) => p.status === 'needs_limits').length;
  const head = `<div class="phead"><h1 class="page">${esc(t(locale, 'nav.products'))}</h1>${viewer.isOwner ? deeper('/app/products/add', t(locale, 'product.teach')) : ''}</div>
    ${flashBanner(flash)}
    ${waiting > 0 ? `<div class="block"><p class="fwarn">${esc(t(locale, 'product.list.needLimits', { n: waiting, name: assistantName(locale) }))}
      ${viewer.isOwner ? `<a class="blink" href="/app/business/prices">${esc(t(locale, 'product.list.needLimits.link'))}</a>` : ''}</p></div>` : ''}`;
  if (items.length === 0) {
    return `${head}
      <div class="block"><div class="empty">${esc(t(locale, 'product.list.empty.title'))}<br><span class="muted">${esc(t(locale, 'product.list.empty.body', { name: assistantName(locale) }))}</span>
      <div style="margin-top:var(--space-16)">${viewer.isOwner ? deeper('/app/products/add', t(locale, 'product.list.empty.cta')) : ownerDecides(locale)}</div></div></div>`;
  }
  const cards = items.map((p) => {
    const u = unitLabel(locale, p.unit);
    // CC-13 — each locale's own colon and gap: "500 pcs: $2.10 · Min. order: 500 pcs",
    // "500个：$2.10　最低起订：500个". The full-width colon and space were in every language.
    // Each figure isolated: after an Arabic word a bare "$2.10" is drawn "2.10$".
    // RT — a shop's price of one is the price; a quantity is named only where the price starts above one.
    const price = p.entryPrice !== null && p.entryQty !== null
      ? (!byQuantity && p.entryQty <= 1 ? iso(show.money(locale, p.entryPrice))
        : labelled(locale, iso(show.quantityOf(locale, p.entryQty, u)), iso(show.money(locale, p.entryPrice))))
      : esc(t(locale, 'product.list.priceTbd'));
    const moq = !byQuantity && p.moq === null ? null : labelled(locale, esc(t(locale, 'product.list.moq')),
      p.moq === null ? esc(t(locale, 'product.noMinimum')) : iso(show.quantityOf(locale, p.moq, u)));
    return `
    <a class="prod" href="/app/products/${encodeURIComponent(p.id)}">
      <div class="prod-h"><b><bdi>${esc(displayName(locale, p.name, p.nameZh))}</bdi></b>${skuMark(p.sku)}${statusPill(locale, p.status)}</div>
      <div class="prod-b muted">${price}${moq === null ? '' : `${locale === 'zh' ? '　' : ' · '}${moq}`}</div>
      ${p.imageMatchable ? '' : `<div class="p-tag">${esc(t(locale, 'product.list.noImageMatch'))}</div>`}
    </a>`;
  }).join('');
  return `${head}<div class="rows">${cards}</div>`;
}

export function renderProductDetail(
  d: ProductDetail, locale: Locale, flash: Flash | null = null,
  errors: Partial<Record<ProductEditField, ProductEditError>> = {},
  draft: Record<string, string | undefined> = {},
  viewer: Viewer = OWNER_VIEW,
): string {
  const u = unitLabel(locale, d.unit);
  const title = displayName(locale, d.name, d.nameZh);
  const alt = locale === 'zh' ? (d.name !== title ? d.name : null) : (d.nameZh && d.nameZh !== title ? d.nameZh : null);

  // M29 — the edit form. Everything an owner can change about a product she
  // already has; the price limits are their own page because they are three
  // questions about the business, not fields on a row.
  const name = assistantName(locale);
  const ferr = (f: ProductEditField): string =>
    // CC-20 — a refusal is announced as one, like every other field error.
    errors[f] ? `<p class="perr" role="alert">${esc(t(locale, `product.edit.error.${errors[f]}` as MessageKey, { name }))}</p>` : '';
  const val = (f: string, fallback: string): string =>
    esc(draft[f] !== undefined ? draft[f]! : fallback);
  const editForm = !viewer.isOwner ? `<div class="block">
    <h2>${esc(t(locale, 'product.edit.title'))}</h2>
    ${ownerDecides(locale)}
  </div>` : `<div class="block">
    <h2>${esc(t(locale, 'product.edit.title'))}</h2>
    <form method="post" action="/app/products/${encodeURIComponent(d.id)}/edit" class="pform">
      <label class="pq"><span>${esc(t(locale, 'product.edit.name'))}</span>
        <input name="name" dir="auto" value="${val('name', d.name)}" />${ferr('name')}</label>
      <label class="pq"><span>${esc(t(locale, 'product.edit.nameZh'))}</span>
        <input name="nameZh" lang="zh" value="${val('nameZh', d.nameZh ?? '')}" />${ferr('nameZh')}</label>
      <label class="pq"><span>${esc(t(locale, 'product.edit.customerNames'))}</span>
        <textarea name="customerNames" rows="3" dir="auto">${val('customerNames', '')}</textarea>${ferr('customerNames')}
        <span class="caption muted">${esc(t(locale, 'product.edit.customerNames.hint'))}</span></label>
      <label class="pq"><span>${esc(t(locale, 'product.edit.price', { currency: d.currency }))}</span>
        <input name="price" inputmode="decimal"
               value="${val('price', d.tiers[0] ? String(d.tiers[0].unitPrice.amount) : '')}" />${ferr('price')}</label>
      <label class="pq"><span>${esc(t(locale, 'product.edit.moq'))}</span>
        <input name="moq" inputmode="numeric" placeholder="${esc(t(locale, 'product.noMinimum'))}"
               value="${val('moq', d.moq === null ? '' : String(d.moq))}" />${ferr('moq')}
        <span class="caption muted">${esc(t(locale, 'product.edit.moq.hint'))}</span></label>
      <label class="pq"><span>${esc(t(locale, 'product.edit.unit'))}</span>
        <input name="unit" value="${val('unit', d.unit)}" />${ferr('unit')}</label>
      <label class="pq"><span>${esc(t(locale, 'product.edit.leadTime'))}</span>
        <input name="leadTime" inputmode="numeric" value="${val('leadTime', d.leadTimeDays === null ? '' : String(d.leadTimeDays))}" />${ferr('leadTime')}
        <span class="caption muted">${esc(t(locale, 'product.edit.leadTime.hint', { name }))}</span></label>
      <label class="pcheck"><input type="checkbox" name="isActive" ${d.isActive ? 'checked' : ''} />
        <span>${esc(t(locale, 'product.edit.active'))}</span></label>
      <button class="btn send" type="submit">${esc(t(locale, 'product.edit.save'))}</button>
    </form>
  </div>`;

  const tiers = d.tiers.length
    ? `<div class="block"><h2>${esc(t(locale, 'product.detail.priceTitle'))}</h2><div class="tiers">${d.tiers.map((tr) =>
        `<div class="tier"><span>${esc(show.figureOf(locale, tr.maxQty ? `${show.quantity(locale, tr.minQty)}–${show.quantity(locale, tr.maxQty)}` : `${show.quantity(locale, tr.minQty)}+`, u))}</span><b>${esc(show.money(locale, tr.unitPrice))}</b></div>`).join('')}</div></div>`
    : `<div class="block"><h2>${esc(t(locale, 'product.detail.priceTitle'))}</h2><p class="muted">${esc(t(locale, 'product.detail.noPrice'))}${viewer.isOwner ? ` <a href="/app/products/add">${esc(t(locale, 'product.detail.addPrice'))}</a>` : ''}</p></div>`;

  const aliases = d.aliases.length
    ? `<div class="block"><h2>${esc(t(locale, 'product.detail.aliasesTitle'))}</h2><div class="chips">${d.aliases.map((a) => `<span class="chip" dir="auto">${esc(a)}</span>`).join('')}</div>
        <p class="muted">${esc(t(locale, 'product.detail.aliasesNote', { name: assistantName(locale) }))}</p></div>`
    // T3 — found by no name: said, with what makes it findable.
    : `<div class="block"><h2>${esc(t(locale, 'product.detail.aliasesTitle'))}</h2>
        <p class="fwarn">${esc(t(locale, 'product.detail.notFindable'))}</p></div>`;

  const images = d.images.length
    ? `<div class="block"><h2>${esc(t(locale, 'product.detail.imagesTitle'))}</h2><div class="imgs">${d.images.map((url) => `<img src="${esc(url)}" alt="${esc(title)}" loading="lazy" />`).join('')}</div></div>`
    : '';

  const quotes = d.recentQuotes.length
    ? `<div class="block"><h2>${esc(t(locale, 'product.detail.recentQuotesTitle'))}</h2>${d.recentQuotes.map((q) =>
        `<div class="qrow muted">${[show.quantityOf(locale, q.quantity, u), `${show.money(locale, q.unitPrice)}/${u}`,
          `${t(locale, 'product.detail.total')} ${show.money(locale, q.total)}`].map(iso).join(' · ')}</div>`).join('')}</div>`
    : '';

  return `
    ${flashBanner(flash)}
    <div class="dhead">${back('/app/products', t(locale, 'product.detail.back'))}
      <h1 class="who"><b>${esc(title)}</b>${alt ? ` <span class="muted">${esc(alt)}</span>` : ''}${skuMark(d.sku)}</h1>${statusPill(locale, d.status)}</div>
    ${d.imageMatchable ? `<div class="p-tag big">📷 ${esc(t(locale, 'product.detail.imageMatchBig', { name: assistantName(locale) }))}</div>` : ''}
    <div class="block"><h2>${esc(t(locale, 'product.detail.infoTitle'))}</h2>
      <div class="info">
        ${d.category ? `<div><span class="muted">${esc(t(locale, 'product.detail.category'))}</span> ${esc(d.category)}</div>` : ''}
        ${d.moq === null && !sellsByQuantity(d.businessKind) ? '' : `<div><span class="muted">${esc(t(locale, 'product.list.moq'))}</span> ${esc(d.moq === null ? t(locale, 'product.noMinimum') : show.quantityOf(locale, d.moq, u))}</div>`}
        ${d.leadTimeDays !== null ? `<div><span class="muted">${esc(t(locale, 'product.detail.leadTime'))}</span> ${esc(t(locale, 'product.detail.leadTimeDays', { days: d.leadTimeDays }))}</div>` : ''}
        <div><span class="muted">${esc(t(locale, 'product.detail.customizable'))}</span> ${esc(d.customizable ? t(locale, 'product.detail.yes') : t(locale, 'product.detail.no'))}</div>
        ${d.source ? `<div><span class="muted">${esc(t(locale, 'product.detail.fromList'))}</span> <bdi>${esc(d.source.line)}</bdi>${viewer.isOwner && d.source.importId && d.source.photo !== null
          ? ` <a href="/app/products/import/${encodeURIComponent(d.source.importId)}/photo/${d.source.photo}">${esc(t(locale, 'product.detail.fromPhoto', { n: d.source.photo }))}</a>` : ''}</div>` : ''}
      </div>
    </div>
    ${tiers}${editForm}${aliases}${images}${quotes}`;
}

/**
 * CUR — the three example lines, in the workspace's own currency and the way
 * its people write a figure: "Rp 15.000", not "$1.05" for everyone. Round
 * shop prices in each currency, not conversions of one another.
 */
const EXAMPLE_PRICES: Readonly<Record<Currency, readonly [string, string, string]>> = {
  USD: ['$1.05', '$2.60', '$34.90'],
  CNY: ['￥7.50', '￥18', '￥249'],
  AED: ['AED 4', 'AED 9.50', 'AED 129'],
  SAR: ['SAR 4', 'SAR 9.50', 'SAR 129'],
  BRL: ['R$ 5,50', 'R$ 13,90', 'R$ 179,90'],
  MXN: ['$19', '$45', '$599'],
  INR: ['₹90', '₹220', '₹2,899'],
  IDR: ['Rp 15.000', 'Rp 40.000', 'Rp 499.000'],
};

export function renderAddForm(
  locale: Locale, viewer: Viewer = OWNER_VIEW, currency: Currency = 'USD',
  /** K1 — a list she started and did not finish checking. */
  open: { id: string; createdAt: Date; lines: number } | null = null,
  flash: Flash | null = null,
  /** K5 — the owner chose "prices go to me". */
  pricesToOwner = false,
): string {
  if (!viewer.isOwner) {
    return `<h1 class="page">${esc(t(locale, 'product.teach'))}</h1>
    <div class="block">${ownerDecides(locale)}
      <p>${back('/app/products', t(locale, 'product.detail.back'))}</p></div>`;
  }
  return `<h1 class="page">${esc(t(locale, 'product.teach'))}</h1>
    ${flashBanner(flash)}
    ${renderOpenImport(locale, open)}
    <div class="block">
      <p>${esc(t(locale, 'product.add.intro'))}</p>
      <p class="muted">${esc(t(locale, 'product.add.exampleLabel'))}<br>${[1, 2, 3].map((i) =>
        esc(t(locale, `product.add.example${i}` as MessageKey, { price: EXAMPLE_PRICES[currency][i - 1]! }))).join('<br>')}</p>
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
        <fieldset class="choices"><legend>${esc(t(locale, 'import.hand.q'))}</legend>
          <label class="pcheck"><input type="radio" name="hand" value="printed" required /> ${esc(t(locale, 'import.hand.printed'))}</label>
          <label class="pcheck"><input type="radio" name="hand" value="handwritten" /> ${esc(t(locale, 'import.hand.handwritten'))}</label>
        </fieldset>
        <input class="photo-in" type="file" name="page" accept="image/jpeg,image/png,image/webp" multiple required />
        <button class="btn send" type="submit">${esc(t(locale, 'product.add.photoButton'))}</button>
      </form>
      <p class="muted" style="font-size:var(--font-size-caption)">${esc(t(locale, 'product.photo.allOrNothing'))}</p>
    </div>
    ${renderStoreForms(locale, currency)}
    ${renderPricesToMe(locale, pricesToOwner)}`;
}

/**
 * K5 — the fallback for an owner with no list (services, agencies, a shop that
 * prices only in private messages): nothing is priced, and every price
 * question comes to her. Its own form: one press either way.
 */
export function renderPricesToMe(locale: Locale, on: boolean): string {
  const name = assistantName(locale);
  return `<div class="block">
      <h2>${esc(t(locale, 'product.pricesToMe.title'))}</h2>
      <p>${esc(t(locale, on ? 'product.pricesToMe.on' : 'product.pricesToMe.intro', { name }))}</p>
      <form method="post" action="/app/products/prices-to-me">
        <input type="hidden" name="on" value="${on ? '0' : '1'}" />
        <button class="btn" type="submit">${esc(t(locale, on ? 'product.pricesToMe.turnOff' : 'product.pricesToMe.turnOn', { name }))}</button>
      </form>
    </div>`;
}

/** The add page's note about a list left open. */
export function renderOpenImport(locale: Locale, open: { id: string; createdAt: Date; lines: number } | null): string {
  if (!open) return '';
  return `<div class="block imp-open"><p>${esc(tn(locale, 'import.waiting', open.lines, { n: show.count(locale, open.lines), date: show.date(locale, open.createdAt) }))}</p>
    <a class="deeper" href="/app/products/import/${encodeURIComponent(open.id)}">${esc(t(locale, 'import.continue'))}<span class="go" aria-hidden="true">›</span></a></div>`;
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
  /** T3 — the name, the Chinese name, and names customers use to ADD (one per line). Null leaves each as it is. */
  readonly name?: string | null;
  readonly nameZh?: string | null;
  readonly customerNames?: string | null;
  /** RT — the days until it is ready to send; an empty box is "not said". Null leaves it as it is. */
  readonly leadTime?: string | null;
};

export type ProductEditField = 'price' | 'moq' | 'unit' | 'isActive' | 'name' | 'nameZh' | 'customerNames' | 'leadTime';
export type ProductEditError = 'not_a_number' | 'not_positive' | 'empty' | 'below_floor' | 'too_long' | 'too_many' | 'too_far';

/** RT — the longest lead time a product may state: a year. */
export const MAX_LEAD_TIME_DAYS = 365;

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
    price: string | null; moq: number | null; unit: string; is_active: boolean; floor: string | null;
    name: string; name_zh: string | null; lead_time_days: number | null;
  }>`
    select p.price_usd_per_unit as price, p.moq, p.unit, p.is_active, p.name, p.name_zh, p.lead_time_days,
           pp.floor_price_usd as floor
      from products p
      left join pricing_policy pp
        on pp.business_id = ${bid} and pp.product_id = p.id
     where p.business_id = ${bid} and p.id = ${productId} limit 1
  `.execute(tx)).rows[0];
  if (!cur) return { ok: false, errors: {} };

  const errors: Partial<Record<ProductEditField, ProductEditError>> = {};
  // CUR — the price box is in the workspace's one currency, read its way.
  const currency = await currencyOf(tx, bid);
  let price: number | null = cur.price === null ? null : Number(cur.price);
  let moq: number | null = cur.moq;
  let unit = cur.unit;

  if (edit.price !== undefined && edit.price !== null && edit.price.trim() !== '') {
    const n = readTypedAmount(edit.price, currency) ?? NaN;
    if (!Number.isFinite(n)) errors.price = 'not_a_number';
    else if (!(n > 0)) errors.price = 'not_positive';
    // A new list price BELOW her own floor would make the product silently
    // unquotable — quote.ts refuses `below_floor` rather than selling at a
    // loss. She is told now, not by a buyer's silence later.
    else if (cur.floor !== null && n < Number(cur.floor)) errors.price = 'below_floor';
    else price = Number(n.toFixed(4));
  }
  // 0081 — an empty box is "no minimum"; absent (null) leaves it as it is.
  if (edit.moq !== undefined && edit.moq !== null) {
    const raw = edit.moq.trim();
    const n = Number(raw);
    if (raw === '') moq = null;
    else if (!Number.isFinite(n)) errors.moq = 'not_a_number';
    else if (!(n > 0) || !Number.isInteger(n)) errors.moq = 'not_positive';
    else moq = n;
  }
  // RT — the lead-time writer. Until now only the demo ever wrote one.
  let leadTime: number | null = cur.lead_time_days;
  if (edit.leadTime !== undefined && edit.leadTime !== null) {
    const raw = edit.leadTime.trim();
    const n = Number(raw);
    if (raw === '') leadTime = null;
    else if (!Number.isFinite(n)) errors.leadTime = 'not_a_number';
    else if (!(n > 0) || !Number.isInteger(n)) errors.leadTime = 'not_positive';
    else if (n > MAX_LEAD_TIME_DAYS) errors.leadTime = 'too_far';
    else leadTime = n;
  }
  if (edit.unit !== undefined && edit.unit !== null) {
    const u = edit.unit.trim();
    if (u === '') errors.unit = 'empty';
    else unit = u;
  }
  // T3 — a name is what customers' words are matched against: one space
  // between words, and short enough to be matched (a longer one could never be).
  let name = cur.name;
  let nameZh = cur.name_zh;
  if (edit.name !== undefined && edit.name !== null) {
    const n = cleanName(edit.name);
    if (n === null) errors.name = 'empty';
    else if (n !== cur.name && n.length > MAX_ALIAS_LENGTH) errors.name = 'too_long';
    else name = n;
  }
  if (edit.nameZh !== undefined && edit.nameZh !== null) {
    const n = cleanName(edit.nameZh);
    if (n !== null && n !== cur.name_zh && n.length > MAX_ALIAS_LENGTH) errors.nameZh = 'too_long';
    else nameZh = n;
  }
  let customerNames: readonly string[] = [];
  if (edit.customerNames !== undefined && edit.customerNames !== null) {
    const c = parseCustomerNames(edit.customerNames);
    if (!c.ok) errors.customerNames = c.error;
    else customerNames = c.names;
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
  note('name', cur.name, name);
  note('nameZh', cur.name_zh, nameZh);
  note('leadTime', cur.lead_time_days, leadTime);

  if (changed.length === 0 && customerNames.length === 0) return { ok: true, changed: [] };

  if (changed.length > 0) {
    await sql`
      update products set price_usd_per_unit = ${price}, moq = ${moq}, unit = ${unit},
                          is_active = ${isActive}, name = ${name}, name_zh = ${nameZh}, lead_time_days = ${leadTime}, updated_at = now(),
                          currency = case when ${detail['price'] !== undefined} then ${currency} else currency end
       where business_id = ${bid} and id = ${productId}
    `.execute(tx);
  }

  // T3 — the names it is found by follow the names it has: the old name's row
  // is rewritten to the new one, a product found by no name (imported before
  // T3) gains its own, and the names customers use are added.
  if (detail['name']) await renameAlias(tx, productId, cur.name, name);
  if (detail['nameZh']) await renameAlias(tx, productId, cur.name_zh, nameZh);
  await addAliases(tx, productId, [name, nameZh]);
  if (customerNames.length > 0 && (await addAliases(tx, productId, customerNames)) > 0) {
    changed.push('customerNames');
    detail['customerNames'] = { from: null, to: customerNames };
  }
  if (changed.length === 0) return { ok: true, changed: [] };

  // The entry tier is the same fact as the list price. Letting them drift is
  // how a quote comes out at a number the owner never set. CUR — in the same
  // currency: this insert once left it to the column's default, USD.
  if (detail['price'] && price !== null) {
    await sql`
      insert into price_tiers (product_id, min_qty, unit_price_usd, currency)
      values (${productId}, 1, ${price}, ${currency})
      on conflict (product_id, min_qty) do update set unit_price_usd = excluded.unit_price_usd, currency = excluded.currency
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
export type PhotoRefusal = 'not_configured' | 'unreadable' | 'no_lines' | 'cut_off' | 'too_large' | 'not_a_photo' | 'upload_failed'
  // K1 — several photos, and the question asked before any is read.
  | 'too_many' | 'handwritten' | 'hand_unanswered'
  // G3 — the day's 20 photos, or the day's allowance, are used.
  | 'daily_limit' | 'allowance_used';

/**
 * The page she cannot read.
 *
 * A refusal, rendered whole: no partial list, no "here is what we got". It
 * names the reason in her language and names the next action — take another
 * photo, or paste the text, which is the path that always works.
 */
export function renderPhotoRefusal(reason: PhotoRefusal, locale: Locale, photo?: number, left?: number): string {
  // K1 — with several photos, the one to take again is named.
  const key = photo !== undefined && (reason === 'unreadable' || reason === 'cut_off')
    ? `product.photo.refused.${reason}_n`
    // G3 — how many photos are left today, or that none are.
    : reason === 'daily_limit' && !left ? 'product.photo.refused.daily_limit_none'
    : `product.photo.refused.${reason}`;
  const params = reason === 'daily_limit' ? { n: left ?? 0, max: PHOTO_READS_A_DAY }
    : photo !== undefined ? { n: photo } : undefined;
  return `<h1 class="page">${esc(t(locale, 'product.photo.refusedTitle'))}</h1>
    <div class="block">
      <p>${esc(t(locale, key as MessageKey, params))}</p>
      <p class="muted">${esc(t(locale, 'product.photo.allOrNothing'))}</p>
      ${deeper('/app/products/add', t(locale, reason === 'not_configured' ? 'product.photo.pasteInstead' : 'product.photo.retake'))}
    </div>`;
}
