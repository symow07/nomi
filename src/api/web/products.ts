import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { parsePriceLines, validateExtracted, type ValidatedImport } from '../../core/onboard/catalogImport.js';
import { formatUsd, formatQtyZh } from '../../core/owner/format.js';
import { esc } from './layout.js';

/**
 * M9.5 — Product Knowledge Center. The employee's product memory, not an
 * inventory system. A VIEW over the EXISTING catalog (products / price_tiers /
 * product_aliases / product_images) plus a teach flow that reuses the M6
 * parser (parsePriceLines + validateExtracted).
 *
 * Trust rule, enforced by the engine (not a UI promise): retrieve_products
 * and search_product_by_text both filter is_active. So a product without a
 * confirmed price is inserted is_active=false — it shows 需要确认 and CANNOT
 * affect a quote until the owner completes it. Nothing unconfirmed is ever
 * silently used.
 */

export type ProductListItem = {
  readonly id: string;
  readonly nameZh: string;
  readonly sku: string;
  readonly moq: number;
  readonly unit: string;
  readonly entryQty: number | null;
  readonly entryPriceUsd: number | null;
  readonly learned: boolean;          // is_active AND has a price
  readonly imageMatchable: boolean;   // active + has an alias/image → retrievable by photo
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
      id: r.id, nameZh: r.name_zh ?? r.name, sku: r.sku, moq: r.moq, unit: r.unit,
      entryQty: r.entry_qty ?? (entryPrice !== null ? r.moq : null),
      entryPriceUsd: entryPrice,
      learned: r.is_active && entryPrice !== null,
      imageMatchable: r.is_active && Number(r.extras) > 0,
    };
  }));
}

export type ProductDetail = {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string | null;
  readonly sku: string;
  readonly categoryZh: string | null;
  readonly unit: string;
  readonly moq: number;
  readonly leadTimeDays: number | null;
  readonly customizable: boolean;
  readonly learned: boolean;
  readonly imageMatchable: boolean;
  readonly tiers: readonly { minQty: number; maxQty: number | null; unitPriceUsd: number }[];
  readonly aliases: readonly string[];       // buyer-facing names
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
      .execute(tx)).rows.map((t) => ({ minQty: t.min_qty, maxQty: t.max_qty, unitPriceUsd: Number(t.unit_price_usd) }));
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
      id: p.id, nameZh: p.name_zh ?? p.name, nameEn: p.name_zh ? p.name : null, sku: p.sku,
      categoryZh: p.category, unit: p.unit, moq: p.moq, leadTimeDays: p.lead_time_days,
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
  const { accepted } = reviewImport(rawText);   // re-parse deterministically on confirm
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
        // A tier + a conservative floor make it immediately quotable at its price.
        await sql`insert into price_tiers (product_id, min_qty, unit_price_usd) values (${id}, 1, ${p.priceUsd}) on conflict do nothing`.execute(tx);
        await sql`insert into pricing_policy (business_id, product_id, floor_price_usd, max_discount_pct, human_required_above_pct)
                  values (${bid.value}, ${id}, ${p.priceUsd}, 0, 0) on conflict (business_id, product_id) do nothing`.execute(tx);
        learned++;
      } else if (id) {
        needsConfirm++;   // inserted is_active=false — excluded from retrieval/quotes
      }
    }
  });
  return { learned, needsConfirm };
}

/** ── Renderers (pure, mobile-first, owner language, escaped) ─────────────── */

const statusPill = (learned: boolean): string =>
  learned ? `<span class="pill ok">已学习 ✓</span>` : `<span class="pill warn">需要确认</span>`;

export function renderProductList(items: readonly ProductListItem[]): string {
  if (items.length === 0) {
    return `<div class="phead"><h1 class="page">产品目录</h1><a class="btn send" href="/app/products/add">教她认产品</a></div>
      <div class="card"><div class="empty">还没有产品。<br><span class="muted">把你的价格表发过来，小雅就能开始按你的价格报价。</span>
      <div style="margin-top:16px"><a class="btn send" href="/app/products/add">上传产品目录开始培训</a></div></div></div>${PRODUCT_STYLE}`;
  }
  const cards = items.map((p) => `
    <a class="prod" href="/app/products/${encodeURIComponent(p.id)}">
      <div class="prod-h"><b>${esc(p.nameZh)}</b> <span class="muted">${esc(p.sku)}</span>${statusPill(p.learned)}</div>
      <div class="prod-b muted">
        ${p.entryPriceUsd !== null && p.entryQty !== null ? `${esc(formatQtyZh(p.entryQty))}${esc(p.unit === 'pcs' ? '个' : p.unit)}：${esc(formatUsd(p.entryPriceUsd))}　` : '价格待补　'}
        最低起订：${esc(formatQtyZh(p.moq))}${esc(p.unit === 'pcs' ? '个' : p.unit)}
      </div>
      ${p.imageMatchable ? `<div class="tag">📷 可以被图片识别</div>` : ''}
    </a>`).join('');
  return `<div class="phead"><h1 class="page">产品目录</h1><a class="btn send" href="/app/products/add">教她认产品</a></div>
    <div class="list">${cards}</div>${PRODUCT_STYLE}`;
}

export function renderProductDetail(d: ProductDetail): string {
  const tiers = d.tiers.length
    ? `<div class="card"><h2>价格</h2><div class="tiers">${d.tiers.map((t) =>
        `<div class="tier"><span>${esc(formatQtyZh(t.minQty))}${t.maxQty ? `–${esc(formatQtyZh(t.maxQty))}` : '+'}${esc(d.unit === 'pcs' ? '个' : d.unit)}</span><b>${esc(formatUsd(t.unitPriceUsd))}</b></div>`).join('')}</div></div>`
    : `<div class="card"><h2>价格</h2><p class="muted">还没有价格。<a href="/app/products/add">补上价格</a>后就能报价。</p></div>`;

  const aliases = d.aliases.length
    ? `<div class="card"><h2>买家怎么称呼它</h2><div class="chips">${d.aliases.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}</div>
        <p class="muted">买家用这些说法问，小雅都能认出来。</p></div>`
    : '';

  const images = d.images.length
    ? `<div class="card"><h2>图片</h2><div class="imgs">${d.images.map((u) => `<img src="${esc(u)}" alt="${esc(d.nameZh)}" loading="lazy" />`).join('')}</div></div>`
    : '';

  const quotes = d.recentQuotes.length
    ? `<div class="card"><h2>最近报过的价</h2>${d.recentQuotes.map((q) =>
        `<div class="qrow muted">${esc(formatQtyZh(q.quantity))}${esc(d.unit === 'pcs' ? '个' : d.unit)} · ${esc(formatUsd(q.unitPriceUsd))}/个 · 共 ${esc(formatUsd(q.totalUsd))}</div>`).join('')}</div>`
    : '';

  return `
    <div class="dhead"><a class="back" href="/app/products">← 产品目录</a>
      <div class="who"><b>${esc(d.nameZh)}</b> <span class="muted">${esc(d.sku)}</span></div>${statusPill(d.learned)}</div>
    ${d.imageMatchable ? `<div class="tag big">📷 可以被图片识别 — 买家发照片，小雅能认出这个产品</div>` : ''}
    <div class="card"><h2>产品信息</h2>
      <div class="info">
        ${d.nameEn ? `<div><span class="muted">英文名</span> ${esc(d.nameEn)}</div>` : ''}
        ${d.categoryZh ? `<div><span class="muted">类别</span> ${esc(d.categoryZh)}</div>` : ''}
        <div><span class="muted">最低起订</span> ${esc(formatQtyZh(d.moq))}${esc(d.unit === 'pcs' ? '个' : d.unit)}</div>
        ${d.leadTimeDays !== null ? `<div><span class="muted">交期</span> ${d.leadTimeDays} 天</div>` : ''}
        <div><span class="muted">可定制</span> ${d.customizable ? '可以' : '否'}</div>
      </div>
    </div>
    ${tiers}${aliases}${images}${quotes}${PRODUCT_STYLE}`;
}

export function renderAddForm(): string {
  return `<h1 class="page">教她认产品</h1>
    <div class="card">
      <p>把你的价格表贴进来就行——一行一个产品，乱一点没关系。</p>
      <p class="muted">例如：<br>帆布袋 1.05美元 500个起<br>保温杯 $2.60 MOQ 1000</p>
      <form method="post" action="/app/products/add/review">
        <textarea name="text" rows="8" placeholder="把产品和价格贴到这里…" autofocus></textarea>
        <button class="btn send" type="submit">看看认出了哪些</button>
      </form>
      <p class="muted" style="font-size:12px">你确认之前，什么都不会启用；没有价格的产品会标「需要确认」，不会用来报价。</p>
    </div>${PRODUCT_STYLE}`;
}

export function renderReview(v: ValidatedImport, rawText: string): string {
  const accepted = v.accepted.map((p) => `
    <div class="rev"><b>${esc(p.name)}</b>
      <span class="muted">${p.priceUsd !== null ? esc(formatUsd(p.priceUsd)) : '价格待补'}${p.moq !== null ? ` · ${esc(formatQtyZh(p.moq))}起` : ''}</span>
      ${p.priceUsd === null ? `<span class="pill warn">需要确认</span>` : `<span class="pill ok">可学习</span>`}
    </div>`).join('');
  const rejected = v.rejected.length
    ? `<div class="card"><h2>没认出来的</h2>${v.rejected.slice(0, 8).map((r) => `<div class="muted">· ${esc(r.product.name || '（空行）')} —— ${esc(r.reasonZh)}</div>`).join('')}</div>`
    : '';
  return `<h1 class="page">确认一下</h1>
    ${v.accepted.length
      ? `<div class="card"><h2>认出了 ${v.accepted.length} 个产品</h2>${accepted}</div>`
      : `<div class="card"><div class="empty muted">没认出产品。<a href="/app/products/add">换个写法再试</a></div></div>`}
    ${rejected}
    ${v.accepted.length ? `<form method="post" action="/app/products/add/confirm">
      <input type="hidden" name="text" value="${esc(rawText)}" />
      <button class="btn send" type="submit">确认入册</button>
      <a class="btn" href="/app/products/add">重新贴</a>
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
  .pill { display:inline-block; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:600; margin-left:auto; }
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
