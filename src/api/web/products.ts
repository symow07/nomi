import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { parsePriceLines, validateExtracted, type ValidatedImport } from '../../core/onboard/catalogImport.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatQty, formatUsd } from '../../core/owner/i18n/format.js';
import { esc } from './layout.js';

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
  readonly entryPriceUsd: number | null;
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
      entryPriceUsd: entryPrice,
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
  readonly tiers: readonly { minQty: number; maxQty: number | null; unitPriceUsd: number }[];
  readonly aliases: readonly string[];
  readonly images: readonly string[];
  readonly recentQuotes: readonly { quantity: number; unitPriceUsd: number; totalUsd: number }[];
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
      .execute(tx)).rows.map((tr) => ({ minQty: tr.min_qty, maxQty: tr.max_qty, unitPriceUsd: Number(tr.unit_price_usd) }));
    const aliases = (await sql<{ alias: string }>`
      select distinct alias from product_aliases where product_id = ${productId} order by alias limit 40`
      .execute(tx)).rows.map((a) => a.alias);
    const images = (await sql<{ url: string }>`
      select url from product_images where product_id = ${productId} order by is_primary desc, sort_order asc limit 8`
      .execute(tx)).rows.map((i) => i.url);
    const recentQuotes = (await sql<{ quantity: number; unit_price_usd: string; total_usd: string }>`
      select quantity, unit_price_usd, total_usd from quotes where product_id = ${productId} order by created_at desc limit 5`
      .execute(tx)).rows.map((q) => ({ quantity: q.quantity, unitPriceUsd: Number(q.unit_price_usd), totalUsd: Number(q.total_usd) }));

    const learned = p.is_active && (tiers.length > 0 || p.price !== null);
    return {
      id: p.id, name: p.name, nameZh: p.name_zh, sku: p.sku,
      category: p.category, unit: p.unit, moq: p.moq, leadTimeDays: p.lead_time_days,
      customizable: p.customizable, learned, imageMatchable: p.is_active && aliases.length + images.length > 0,
      tiers, aliases, images, recentQuotes,
    };
  });
}

/** ── Teach flow: paste → parse (reuse M6) → review → confirm → available ─── */

export function reviewImport(rawText: string): ValidatedImport {
  return validateExtracted(parsePriceLines(rawText));
}

export async function confirmImport(db: Db, businessIdRaw: string, rawText: string): Promise<{ learned: number; needsConfirm: number }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { learned: 0, needsConfirm: 0 };
  const { accepted } = reviewImport(rawText);
  let learned = 0, needsConfirm = 0;

  await withTenantTx(db, bid.value, async (tx) => {
    for (let i = 0; i < accepted.length; i++) {
      const p = accepted[i]!;
      const sku = `NEW-${Date.now().toString(36)}-${i}`;
      const moq = p.moq ?? 100;
      const active = p.priceUsd !== null;   // TRUST RULE: no price → not activated
      const ins = await sql<{ id: string }>`
        insert into products (business_id, sku, name, name_zh, unit, moq, price_usd_per_unit, is_active)
        values (${bid.value}, ${sku}, ${p.name}, ${p.nameZh}, ${p.unit}, ${moq}, ${p.priceUsd}, ${active})
        on conflict (business_id, sku) do nothing returning id`.execute(tx);
      const id = ins.rows[0]?.id;
      if (id && p.priceUsd !== null) {
        await sql`insert into price_tiers (product_id, min_qty, unit_price_usd) values (${id}, 1, ${p.priceUsd}) on conflict do nothing`.execute(tx);
        await sql`insert into pricing_policy (business_id, product_id, floor_price_usd, max_discount_pct, human_required_above_pct)
                  values (${bid.value}, ${id}, ${p.priceUsd}, 0, 0) on conflict (business_id, product_id) do nothing`.execute(tx);
        learned++;
      } else if (id) {
        needsConfirm++;
      }
    }
  });
  return { learned, needsConfirm };
}

/** Localized confirm flash — called by the route (has locale). */
export const importFlash = (locale: Locale, r: { learned: number; needsConfirm: number }): string =>
  r.needsConfirm > 0
    ? t(locale, 'product.flash.learnedAndPending', { learned: r.learned, needsConfirm: r.needsConfirm })
    : t(locale, 'product.flash.learnedOnly', { learned: r.learned });

/** ── Renderers (pure, mobile-first, localized, escaped) ───────────────────── */

const statusPill = (locale: Locale, learned: boolean): string =>
  learned
    ? `<span class="pill ok">${esc(t(locale, 'product.status.learned'))} ✓</span>`
    : `<span class="pill warn">${esc(t(locale, 'product.status.needsConfirm'))}</span>`;

export function renderProductList(items: readonly ProductListItem[], locale: Locale): string {
  const head = `<div class="phead"><h1 class="page">${esc(t(locale, 'nav.products'))}</h1><a class="btn send" href="/app/products/add">${esc(t(locale, 'product.teach'))}</a></div>`;
  if (items.length === 0) {
    return `${head}
      <div class="card"><div class="empty">${esc(t(locale, 'product.list.empty.title'))}<br><span class="muted">${esc(t(locale, 'product.list.empty.body', { name: EMPLOYEE_NAME[locale] }))}</span>
      <div style="margin-top:16px"><a class="btn send" href="/app/products/add">${esc(t(locale, 'product.list.empty.cta'))}</a></div></div></div>${PRODUCT_STYLE}`;
  }
  const cards = items.map((p) => {
    const u = unitLabel(locale, p.unit);
    return `
    <a class="prod" href="/app/products/${encodeURIComponent(p.id)}">
      <div class="prod-h"><b>${esc(displayName(locale, p.name, p.nameZh))}</b> <span class="muted">${esc(p.sku)}</span>${statusPill(locale, p.learned)}</div>
      <div class="prod-b muted">
        ${p.entryPriceUsd !== null && p.entryQty !== null ? `${esc(formatQty(locale, p.entryQty))}${esc(u)}: ${esc(formatUsd(p.entryPriceUsd))}　` : `${esc(t(locale, 'product.list.priceTbd'))}　`}
        ${esc(t(locale, 'product.list.moq'))}: ${esc(formatQty(locale, p.moq))}${esc(u)}
      </div>
      ${p.imageMatchable ? `<div class="tag">📷 ${esc(t(locale, 'product.list.imageMatch'))}</div>` : ''}
    </a>`;
  }).join('');
  return `${head}<div class="list">${cards}</div>${PRODUCT_STYLE}`;
}

export function renderProductDetail(d: ProductDetail, locale: Locale): string {
  const u = unitLabel(locale, d.unit);
  const title = displayName(locale, d.name, d.nameZh);
  const alt = locale === 'zh' ? (d.name !== title ? d.name : null) : (d.nameZh && d.nameZh !== title ? d.nameZh : null);

  const tiers = d.tiers.length
    ? `<div class="card"><h2>${esc(t(locale, 'product.detail.priceTitle'))}</h2><div class="tiers">${d.tiers.map((tr) =>
        `<div class="tier"><span>${esc(formatQty(locale, tr.minQty))}${tr.maxQty ? `–${esc(formatQty(locale, tr.maxQty))}` : '+'}${esc(u)}</span><b>${esc(formatUsd(tr.unitPriceUsd))}</b></div>`).join('')}</div></div>`
    : `<div class="card"><h2>${esc(t(locale, 'product.detail.priceTitle'))}</h2><p class="muted">${esc(t(locale, 'product.detail.noPrice'))} <a href="/app/products/add">${esc(t(locale, 'product.detail.addPrice'))}</a></p></div>`;

  const aliases = d.aliases.length
    ? `<div class="card"><h2>${esc(t(locale, 'product.detail.aliasesTitle'))}</h2><div class="chips">${d.aliases.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}</div>
        <p class="muted">${esc(t(locale, 'product.detail.aliasesNote', { name: EMPLOYEE_NAME[locale] }))}</p></div>`
    : '';

  const images = d.images.length
    ? `<div class="card"><h2>${esc(t(locale, 'product.detail.imagesTitle'))}</h2><div class="imgs">${d.images.map((url) => `<img src="${esc(url)}" alt="${esc(title)}" loading="lazy" />`).join('')}</div></div>`
    : '';

  const quotes = d.recentQuotes.length
    ? `<div class="card"><h2>${esc(t(locale, 'product.detail.recentQuotesTitle'))}</h2>${d.recentQuotes.map((q) =>
        `<div class="qrow muted">${esc(formatQty(locale, q.quantity))}${esc(u)} · ${esc(formatUsd(q.unitPriceUsd))}/${esc(u)} · ${esc(t(locale, 'product.detail.total'))} ${esc(formatUsd(q.totalUsd))}</div>`).join('')}</div>`
    : '';

  return `
    <div class="dhead"><a class="back" href="/app/products">${esc(t(locale, 'product.detail.back'))}</a>
      <div class="who"><b>${esc(title)}</b>${alt ? ` <span class="muted">${esc(alt)}</span>` : ''} <span class="muted">${esc(d.sku)}</span></div>${statusPill(locale, d.learned)}</div>
    ${d.imageMatchable ? `<div class="tag big">📷 ${esc(t(locale, 'product.detail.imageMatchBig', { name: EMPLOYEE_NAME[locale] }))}</div>` : ''}
    <div class="card"><h2>${esc(t(locale, 'product.detail.infoTitle'))}</h2>
      <div class="info">
        ${d.category ? `<div><span class="muted">${esc(t(locale, 'product.detail.category'))}</span> ${esc(d.category)}</div>` : ''}
        <div><span class="muted">${esc(t(locale, 'product.list.moq'))}</span> ${esc(formatQty(locale, d.moq))}${esc(u)}</div>
        ${d.leadTimeDays !== null ? `<div><span class="muted">${esc(t(locale, 'product.detail.leadTime'))}</span> ${esc(t(locale, 'product.detail.leadTimeDays', { days: d.leadTimeDays }))}</div>` : ''}
        <div><span class="muted">${esc(t(locale, 'product.detail.customizable'))}</span> ${esc(d.customizable ? t(locale, 'product.detail.yes') : t(locale, 'product.detail.no'))}</div>
      </div>
    </div>
    ${tiers}${aliases}${images}${quotes}${PRODUCT_STYLE}`;
}

export function renderAddForm(locale: Locale): string {
  return `<h1 class="page">${esc(t(locale, 'product.teach'))}</h1>
    <div class="card">
      <p>${esc(t(locale, 'product.add.intro'))}</p>
      <p class="muted">${esc(t(locale, 'product.add.exampleLabel'))}<br>${esc(t(locale, 'product.add.example1'))}<br>${esc(t(locale, 'product.add.example2'))}</p>
      <form method="post" action="/app/products/add/review">
        <textarea name="text" rows="8" placeholder="${esc(t(locale, 'product.add.placeholder'))}" autofocus></textarea>
        <button class="btn send" type="submit">${esc(t(locale, 'product.add.submit'))}</button>
      </form>
      <p class="muted" style="font-size:12px">${esc(t(locale, 'product.add.note'))}</p>
    </div>${PRODUCT_STYLE}`;
}

export function renderReview(v: ValidatedImport, rawText: string, locale: Locale): string {
  const accepted = v.accepted.map((p) => `
    <div class="rev"><b>${esc(p.name)}</b>
      <span class="muted">${p.priceUsd !== null ? esc(formatUsd(p.priceUsd)) : esc(t(locale, 'product.list.priceTbd'))}${p.moq !== null ? ` · ${esc(t(locale, 'product.review.moqSuffix', { qty: formatQty(locale, p.moq) }))}` : ''}</span>
      ${p.priceUsd === null ? `<span class="pill warn">${esc(t(locale, 'product.status.needsConfirm'))}</span>` : `<span class="pill ok">${esc(t(locale, 'product.review.canLearn'))}</span>`}
    </div>`).join('');
  const rejected = v.rejected.length
    ? `<div class="card"><h2>${esc(t(locale, 'product.review.rejectedTitle'))}</h2>${v.rejected.slice(0, 8).map((r) => `<div class="muted">· ${esc(r.product.name || t(locale, 'product.review.emptyLine'))} —— ${esc(t(locale, `product.reject.${r.reason}` as MessageKey))}</div>`).join('')}</div>`
    : '';
  return `<h1 class="page">${esc(t(locale, 'product.review.title'))}</h1>
    ${v.accepted.length
      ? `<div class="card"><h2>${esc(t(locale, 'product.review.recognized', { count: v.accepted.length }))}</h2>${accepted}</div>`
      : `<div class="card"><div class="empty muted">${esc(t(locale, 'product.review.noneRecognized'))} <a href="/app/products/add">${esc(t(locale, 'product.review.tryAgain'))}</a></div></div>`}
    ${rejected}
    ${v.accepted.length ? `<form method="post" action="/app/products/add/confirm">
      <input type="hidden" name="text" value="${esc(rawText)}" />
      <button class="btn send" type="submit">${esc(t(locale, 'product.review.confirm'))}</button>
      <a class="btn" href="/app/products/add">${esc(t(locale, 'product.review.repaste'))}</a>
    </form>` : ''}
    ${PRODUCT_STYLE}`;
}

const PRODUCT_STYLE = `<style>
  .phead { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .list { display:flex; flex-direction:column; gap:10px; }
  .prod { display:block; background:#14171c; border:1px solid #23272e; border-radius:14px; padding:16px; }
  .prod:hover { border-color:#3a4250; }
  .prod-h { display:flex; align-items:center; gap:8px; flex-wrap:wrap; } .prod-b { font-size:13px; margin-top:6px; }
  .tag { color:#4ade80; font-size:12px; margin-top:8px; } .tag.big { color:#4ade80; font-size:14px; margin-bottom:12px; }
  .pill { display:inline-block; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:600; margin-inline-start:auto; }
  .pill.ok { background:#0f2e1c; color:#4ade80; } .pill.warn { background:#2e2413; color:#fbbf24; }
  .dhead { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:8px; } .back { color:#60a5fa; }
  .info, .tiers { display:flex; flex-direction:column; gap:8px; font-size:14px; }
  .tier { display:flex; justify-content:space-between; background:#0f1216; border:1px solid #23272e; border-radius:8px; padding:10px 12px; }
  .chips, .imgs { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { background:#0f1216; border:1px solid #23272e; border-radius:999px; padding:5px 12px; font-size:13px; }
  .imgs img { width:96px; height:96px; object-fit:cover; border-radius:10px; border:1px solid #23272e; }
  .qrow { font-size:13px; padding:6px 0; border-bottom:1px solid #1c2026; } .qrow:last-child { border-bottom:none; }
  .rev { display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid #1c2026; font-size:14px; flex-wrap:wrap; }
  .rev:last-child { border-bottom:none; }
  textarea { width:100%; background:#0f1216; border:1px solid #2b313a; border-radius:10px; color:#fff; padding:12px; font:inherit; resize:vertical; margin:10px 0; }
  .btn { padding:10px 18px; border:0; border-radius:9px; background:#2a313c; color:#fff; font-size:14px; font-weight:600; cursor:pointer; text-decoration:none; display:inline-block; }
  .btn.send { background:#2563eb; } .btn.send:hover { background:#1d4ed8; }
  .empty { text-align:center; padding:28px 16px; }
  button:focus-visible, a:focus-visible, textarea:focus-visible { outline:2px solid #60a5fa; outline-offset:2px; }
  @media (max-width:560px) { .imgs img { width:72px; height:72px; } }
</style>`;
