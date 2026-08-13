import { sql } from 'kysely';
import { type Money, usd } from '../../core/types/money.js';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { parsePriceLines, validateExtracted, validatePage, type ValidatedImport } from '../../core/onboard/catalogImport.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatQty, formatMoney } from '../../core/owner/i18n/format.js';
import type { PageTranscriber } from '../../llm/ports.js';
import { esc, back } from './layout.js';

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
  readonly imageMatchable: boolean;
  /** Deactivated products stay in the list but are not something you sell. */
  readonly isActive: boolean;
};

export async function loadProductList(db: Db, businessIdRaw: string): Promise<readonly ProductListItem[]> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return [];
  return withTenantTx(db, bid.value, async (tx) => (await sql<{
    id: string; name: string; name_zh: string | null; sku: string; moq: number; unit: string;
    is_active: boolean; price: string | null;
    entry_qty: number | null; entry_price: string | null; extras: number;
  }>`
    select p.id, p.name, p.name_zh, p.sku, p.moq, p.unit, p.is_active, p.price_usd_per_unit as price,
           t.min_qty as entry_qty, t.unit_price_usd as entry_price,
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
      entryPrice: entryPrice === null ? null : usd(entryPrice),
      learned: r.is_active && entryPrice !== null,
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
      is_active: boolean; price: string | null;
    }>`select id, name, name_zh, sku, category, unit, moq, lead_time_days, customizable, is_active, price_usd_per_unit as price
         from products where id = ${productId} limit 1`.execute(tx)).rows[0];
    if (!p) return null;

    const tiers = (await sql<{ min_qty: number; max_qty: number | null; unit_price_usd: string }>`
      select min_qty, max_qty, unit_price_usd from price_tiers where product_id = ${productId} order by min_qty asc`
      .execute(tx)).rows.map((tr) => ({ minQty: tr.min_qty, maxQty: tr.max_qty, unitPrice: usd(Number(tr.unit_price_usd)) }));
    const aliases = (await sql<{ alias: string }>`
      select distinct alias from product_aliases where product_id = ${productId} order by alias limit 40`
      .execute(tx)).rows.map((a) => a.alias);
    const images = (await sql<{ url: string }>`
      select url from product_images where product_id = ${productId} order by is_primary desc, sort_order asc limit 8`
      .execute(tx)).rows.map((i) => i.url);
    const recentQuotes = (await sql<{ quantity: number; unit_price_usd: string; total_usd: string }>`
      select quantity, unit_price_usd, total_usd from quotes where product_id = ${productId} order by created_at desc limit 5`
      .execute(tx)).rows.map((q) => ({ quantity: q.quantity, unitPrice: usd(Number(q.unit_price_usd)), total: usd(Number(q.total_usd)) }));

    const learned = p.is_active && (tiers.length > 0 || p.price !== null);
    return {
      id: p.id, name: p.name, nameZh: p.name_zh, sku: p.sku,
      category: p.category, unit: p.unit, moq: p.moq, leadTimeDays: p.lead_time_days,
      customizable: p.customizable, learned, isActive: p.is_active,
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
 * M22 (F-02) — `alreadyHere` is reported rather than swallowed. `on conflict do
 * nothing` used to make a re-import look like it did nothing at all: "0 learned"
 * with no explanation, which is the false-success class in reverse. Now that the
 * owner's OWN sku is used, a re-import collides on purpose and she is told so.
 */
export type ImportResult = {
  /** Rows created. None is sellable: an import cannot know a floor. */
  readonly added: number;
  /** Of those, how many carry a price and so need only the price rules. */
  readonly withPrice: number;
  /** Her sku was already in the catalogue — reported, never swallowed (F-02). */
  readonly alreadyHere: number;
};

export async function confirmImport(db: Db, businessIdRaw: string, rawText: string): Promise<ImportResult> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { added: 0, withPrice: 0, alreadyHere: 0 };
  const { accepted } = reviewImport(rawText);
  let added = 0, withPrice = 0, alreadyHere = 0;

  await withTenantTx(db, bid.value, async (tx) => {
    for (let i = 0; i < accepted.length; i++) {
      const p = accepted[i]!;
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
                ${p.price?.amount ?? null}, ${p.price?.currency ?? 'USD'}, false)
        on conflict (business_id, sku) do nothing returning id`.execute(tx);
      const id = ins.rows[0]?.id;
      if (!id) { alreadyHere++; continue; }        // her sku is already in the catalogue
      added++;
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
  });
  return { added, withPrice, alreadyHere };
}

/** Localized confirm flash — called by the route (has locale). */
export const importFlash = (locale: Locale, r: { added: number; withPrice: number; alreadyHere?: number }): string => {
  // M29 — this used to say "Learned N products", which was the false-success
  // class: an imported product is not learned, because the floor that decides
  // what she may never go below has not been stated by anyone. It says what
  // was added and what is still needed before she can quote any of it.
  const name = EMPLOYEE_NAME[locale];
  const base = r.withPrice > 0
    ? t(locale, 'product.flash.addedNeedRules', { added: r.added, withPrice: r.withPrice, name })
    : t(locale, 'product.flash.addedNeedPrice', { added: r.added, name });
  // A re-import that changed nothing must say so, not report a silent zero.
  return r.alreadyHere ? `${base} ${t(locale, 'product.flash.alreadyHere', { n: r.alreadyHere })}` : base;
};

/** ── Renderers (pure, mobile-first, localized, escaped) ───────────────────── */

const statusPill = (locale: Locale, learned: boolean): string =>
  learned
    ? `<span class="pill ok">${esc(t(locale, 'product.status.learned'))} ✓</span>`
    : `<span class="pill warn">${esc(t(locale, 'product.status.needsConfirm'))}</span>`;

export function renderProductList(items: readonly ProductListItem[], locale: Locale): string {
  const head = `<div class="phead"><h1 class="page">${esc(t(locale, 'nav.products'))}</h1><a class="btn send" href="/app/products/add">${esc(t(locale, 'product.teach'))}</a></div>`;
  if (items.length === 0) {
    return `${head}
      <div class="block"><div class="empty">${esc(t(locale, 'product.list.empty.title'))}<br><span class="muted">${esc(t(locale, 'product.list.empty.body', { name: EMPLOYEE_NAME[locale] }))}</span>
      <div style="margin-top:16px"><a class="btn send" href="/app/products/add">${esc(t(locale, 'product.list.empty.cta'))}</a></div></div></div>${PRODUCT_STYLE}`;
  }
  const cards = items.map((p) => {
    const u = unitLabel(locale, p.unit);
    return `
    <a class="prod" href="/app/products/${encodeURIComponent(p.id)}">
      <div class="prod-h"><b>${esc(displayName(locale, p.name, p.nameZh))}</b> <span class="muted">${esc(p.sku)}</span>${statusPill(locale, p.learned)}</div>
      <div class="prod-b muted">
        ${p.entryPrice !== null && p.entryQty !== null ? `${esc(formatQty(locale, p.entryQty))}${esc(u)}: ${esc(formatMoney(p.entryPrice))}　` : `${esc(t(locale, 'product.list.priceTbd'))}　`}
        ${esc(t(locale, 'product.list.moq'))}: ${esc(formatQty(locale, p.moq))}${esc(u)}
      </div>
      ${p.imageMatchable ? `<div class="tag">📷 ${esc(t(locale, 'product.list.imageMatch'))}</div>` : ''}
    </a>`;
  }).join('');
  return `${head}<div class="list">${cards}</div>${PRODUCT_STYLE}`;
}

export function renderProductDetail(
  d: ProductDetail, locale: Locale, flash: string | null = null,
  errors: Partial<Record<ProductEditField, ProductEditError>> = {},
  draft: Record<string, string | undefined> = {},
): string {
  const u = unitLabel(locale, d.unit);
  const title = displayName(locale, d.name, d.nameZh);
  const alt = locale === 'zh' ? (d.name !== title ? d.name : null) : (d.nameZh && d.nameZh !== title ? d.nameZh : null);

  // M29 — the edit form. Everything an owner can change about a product she
  // already has; the price limits are their own page because they are three
  // questions about the business, not fields on a row.
  const name = EMPLOYEE_NAME[locale];
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
        <p class="muted">${esc(t(locale, 'product.detail.aliasesNote', { name: EMPLOYEE_NAME[locale] }))}</p></div>`
    : '';

  const images = d.images.length
    ? `<div class="block"><h2>${esc(t(locale, 'product.detail.imagesTitle'))}</h2><div class="imgs">${d.images.map((url) => `<img src="${esc(url)}" alt="${esc(title)}" loading="lazy" />`).join('')}</div></div>`
    : '';

  const quotes = d.recentQuotes.length
    ? `<div class="block"><h2>${esc(t(locale, 'product.detail.recentQuotesTitle'))}</h2>${d.recentQuotes.map((q) =>
        `<div class="qrow muted">${esc(formatQty(locale, q.quantity))}${esc(u)} · ${esc(formatMoney(q.unitPrice))}/${esc(u)} · ${esc(t(locale, 'product.detail.total'))} ${esc(formatMoney(q.total))}</div>`).join('')}</div>`
    : '';

  return `
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    <div class="dhead">${back('/app/products', t(locale, 'product.detail.back'))}
      <div class="who"><b>${esc(title)}</b>${alt ? ` <span class="muted">${esc(alt)}</span>` : ''} <span class="muted">${esc(d.sku)}</span></div>${statusPill(locale, d.learned)}</div>
    ${d.imageMatchable ? `<div class="tag big">📷 ${esc(t(locale, 'product.detail.imageMatchBig', { name: EMPLOYEE_NAME[locale] }))}</div>` : ''}
    <div class="block"><h2>${esc(t(locale, 'product.detail.infoTitle'))}</h2>
      <div class="info">
        ${d.category ? `<div><span class="muted">${esc(t(locale, 'product.detail.category'))}</span> ${esc(d.category)}</div>` : ''}
        <div><span class="muted">${esc(t(locale, 'product.list.moq'))}</span> ${esc(formatQty(locale, d.moq))}${esc(u)}</div>
        ${d.leadTimeDays !== null ? `<div><span class="muted">${esc(t(locale, 'product.detail.leadTime'))}</span> ${esc(t(locale, 'product.detail.leadTimeDays', { days: d.leadTimeDays }))}</div>` : ''}
        <div><span class="muted">${esc(t(locale, 'product.detail.customizable'))}</span> ${esc(d.customizable ? t(locale, 'product.detail.yes') : t(locale, 'product.detail.no'))}</div>
      </div>
    </div>
    ${tiers}${editForm}${aliases}${images}${quotes}${PRODUCT_STYLE}`;
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
      <p class="muted" style="font-size:var(--font-size-micro)">${esc(t(locale, 'product.add.note'))}</p>
    </div>
    <div class="block">
      <h2>${esc(t(locale, 'product.add.photoTitle'))}</h2>
      <p>${esc(t(locale, 'product.add.photoIntro'))}</p>
      <form method="post" action="/app/products/add/photo" enctype="multipart/form-data">
        <input class="photo-in" type="file" name="page" accept="image/jpeg,image/png,image/webp" capture="environment" required />
        <button class="btn send" type="submit">${esc(t(locale, 'product.add.photoButton'))}</button>
      </form>
      <p class="muted" style="font-size:var(--font-size-micro)">${esc(t(locale, 'product.photo.allOrNothing'))}</p>
    </div>${PRODUCT_STYLE}`;
}

export function renderReview(v: ValidatedImport, rawText: string, locale: Locale): string {
  // M37 — THE SOURCE LINE, beside every product, in BOTH flows.
  // What she confirms is a TRANSCRIPTION, not a list: the line she can compare
  // against the page in her hand sits under the product it produced. A price
  // that no line contains has nowhere to hide, because every price is shown
  // next to the text it came out of.
  const accepted = v.accepted.map((p) => `
    <div class="rev"><b>${esc(p.name)}</b>
      <span class="muted">${p.price !== null ? esc(formatMoney(p.price)) : esc(t(locale, 'product.list.priceTbd'))}${p.moq !== null ? ` · ${esc(t(locale, 'product.review.moqSuffix', { qty: formatQty(locale, p.moq) }))}` : ''}</span>
      ${p.price === null ? `<span class="pill warn">${esc(t(locale, 'product.status.needsConfirm'))}</span>` : `<span class="pill ok">${esc(t(locale, 'product.review.canLearn'))}</span>`}
      ${p.sourceLine ? `<span class="rev-src muted">${esc(t(locale, 'product.review.fromLine'))} <bdi>${esc(p.sourceLine)}</bdi></span>` : ''}
    </div>`).join('');
  const rejected = v.rejected.length
    ? `<div class="block"><h2>${esc(t(locale, 'product.review.rejectedTitle'))}</h2>${v.rejected.slice(0, 8).map((r) => `<div class="muted">· ${esc(r.product.name || t(locale, 'product.review.emptyLine'))} —— ${esc(t(locale, `product.reject.${r.reason}` as MessageKey))}</div>`).join('')}</div>`
    : '';
  return `<h1 class="page">${esc(t(locale, 'product.review.title'))}</h1>
    ${v.accepted.length
      ? `<div class="block"><h2>${esc(t(locale, 'product.review.recognized', { count: v.accepted.length }))}</h2>${accepted}</div>`
      : `<div class="block"><div class="empty muted">${esc(t(locale, 'product.review.noneRecognized'))} <a href="/app/products/add">${esc(t(locale, 'product.review.tryAgain'))}</a></div></div>`}
    ${rejected}
    ${v.accepted.length ? `<form method="post" action="/app/products/add/confirm">
      <input type="hidden" name="text" value="${esc(rawText)}" />
      <button class="btn send" type="submit">${esc(t(locale, 'product.review.confirm'))}</button>
      <a class="btn" href="/app/products/add">${esc(t(locale, 'product.review.repaste'))}</a>
    </form>` : ''}
    ${PRODUCT_STYLE}`;
}

const PRODUCT_STYLE = `<style>
  .pform { display:flex; flex-direction:column; gap:14px; max-width:var(--measure-form); margin-top:6px; }
  .pq { display:flex; flex-direction:column; gap:6px; font-size:var(--font-size-note); color:var(--color-ink); }
  .pq input { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px;
              color:var(--color-ink); padding:11px 14px; font:inherit; min-height:44px; }
  .pcheck { display:flex; align-items:center; gap:10px; font-size:var(--font-size-note); color:var(--color-ink); min-height:44px; }
  .perr { color:var(--color-highlight); font-size:var(--font-size-caption); margin:0; }
  .phead { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .prod { display:block; background:var(--color-surface); border:1px solid var(--color-border); border-radius:14px; padding:16px; }
  .prod:hover { border-color:var(--color-border); }
  .prod-h { display:flex; align-items:center; gap:8px; flex-wrap:wrap; } .prod-b { font-size:var(--font-size-caption); margin-top:6px; }
  .tag { color:var(--color-ok); font-size:var(--font-size-micro); margin-top:8px; } .tag.big { color:var(--color-ok); font-size:var(--font-size-note); margin-bottom:12px; }
  .dhead { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:8px; } 
  .info, .tiers { display:flex; flex-direction:column; gap:8px; font-size:var(--font-size-note); }
  .tier { display:flex; justify-content:space-between; background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:8px; padding:10px 12px; }
  .chips, .imgs { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:999px; padding:5px 12px; font-size:var(--font-size-caption); }
  .imgs img { width:96px; height:96px; object-fit:cover; border-radius:10px; border:1px solid var(--color-border); }
  .qrow { font-size:var(--font-size-caption); padding:6px 0; border-bottom:1px solid var(--color-border); } .qrow:last-child { border-bottom:none; }
  .rev { display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-note); flex-wrap:wrap; }
  .rev:last-child { border-bottom:none; }
  .rev-src { flex-basis:100%; font-size:var(--font-size-micro); }
  .photo-in { display:block; width:100%; margin:10px 0; font:inherit; color:var(--color-ink); min-height:44px; }
  textarea { width:100%; background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:12px; font:inherit; resize:vertical; margin:10px 0; }
  @media (max-width:560px) { .imgs img { width:72px; height:72px; } }
</style>`;

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

  return withTenantTx(db, bid.value, async (tx) => {
    const cur = (await sql<{
      price: string | null; moq: number; unit: string; is_active: boolean; floor: string | null;
    }>`
      select p.price_usd_per_unit as price, p.moq, p.unit, p.is_active,
             pp.floor_price_usd as floor
        from products p
        left join pricing_policy pp
          on pp.business_id = ${bid.value} and pp.product_id = p.id
       where p.business_id = ${bid.value} and p.id = ${productId} limit 1
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
       where business_id = ${bid.value} and id = ${productId}
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
      values (${bid.value}, null, 'product_edited', ${actor},
              ${JSON.stringify({ productId, changes: detail })}::jsonb)
    `.execute(tx);

    return { ok: true, changed };
  });
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
  | { readonly kind: 'refused'; readonly reason: 'not_configured' | 'unreadable' | 'no_lines' | 'too_large' };

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
export function renderPhotoRefusal(
  reason: 'not_configured' | 'unreadable' | 'no_lines' | 'too_large', locale: Locale,
): string {
  return `<h1 class="page">${esc(t(locale, 'product.photo.refusedTitle'))}</h1>
    <div class="block">
      <p>${esc(t(locale, `product.photo.refused.${reason}` as MessageKey))}</p>
      <p class="muted">${esc(t(locale, 'product.photo.allOrNothing'))}</p>
      <p><a class="btn" href="/app/products/add">${esc(t(locale, reason === 'not_configured' ? 'product.photo.pasteInstead' : 'product.photo.retake'))}</a></p>
    </div>${PRODUCT_STYLE}`;
}
