import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { readStoreAddress } from '../../core/onboard/storeAddress.js';
import { parseShopify, parseWoo, parseWooVariation, itemsToRows, type StoreItem } from '../../core/onboard/storeFeed.js';
import { parseTable, suggestMapping, checkMapping, tableToItems, priceColumns, detectPreset, type Mapping, type MappingProblem, type Table } from '../../core/onboard/csvTable.js';
import { liveRows } from '../../core/onboard/importReview.js';
import { defaultUnitFor } from '../../core/owner/sellingStyle.js';
import { currencyOf } from '../../db/currency.js';
import { createImport, loadImport, saveImport } from '../../db/catalogImports.js';
import { StoreFetchError, type StoreFetcher } from '../../net/publicFetch.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import { esc, back, deeper } from './layout.js';

/**
 * K8 — STORE IMPORT (the onboarding plan, decision 30).
 *
 * "Your store's address": the public product list a Shopify or WooCommerce
 * store serves is read (through `publicFetcher`, which reaches the public
 * internet only), each priced variant becomes a row, options become the
 * product's knowledge, and the rows go through K1's review like any list.
 * Or the file the store exported: its columns are mapped (presets for
 * Shopify, WooCommerce and Etsy), then the same review. The currency is
 * confirmed once: a store that states another currency is refused; a store
 * that states none (Shopify) is read only after the owner says its prices are
 * in the workspace's.
 */

const SHOPIFY_PAGES = 8;       // 250 a page: 2,000 products
const WOO_PAGES = 20;          // 100 a page: 2,000 products
const WOO_VARIATIONS = 120;    // variations read one by one, at most

export type StoreRefusal =
  | 'not_an_address' | 'not_https' | 'not_public' | 'unreachable' | 'timeout' | 'too_large' | 'too_many_redirects'
  | 'no_feed' | 'no_products' | 'other_currency' | 'currency_unconfirmed' | 'not_a_table';

const json = (body: string): unknown => { try { return JSON.parse(body); } catch { return null; } };

/** The store's products, from whichever public list it serves. */
export async function readStore(fetcher: StoreFetcher, origin: string): Promise<{ ok: true; items: StoreItem[]; platform: 'shopify' | 'woocommerce' } | { ok: false; reason: StoreRefusal }> {
  try {
    // Shopify: /products.json, 250 a page.
    const first = await fetcher.get(`${origin}/products.json?limit=250&page=1`);
    const shop = first.status === 200 ? parseShopify(json(first.body)) : null;
    if (shop) {
      const items = [...shop];
      for (let page = 2; page <= SHOPIFY_PAGES && items.length === (page - 1) * 250; page++) {
        const next = await fetcher.get(`${origin}/products.json?limit=250&page=${page}`);
        const more = next.status === 200 ? parseShopify(json(next.body)) : null;
        if (!more || more.length === 0) break;
        items.push(...more);
      }
      return { ok: true, items, platform: 'shopify' };
    }
    // WooCommerce: the Store API, 100 a page; a variable product's prices, one variation at a time.
    const woo = await fetcher.get(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=1`);
    const wooFirst = woo.status === 200 ? parseWoo(json(woo.body)) : null;
    if (wooFirst) {
      const products = [...wooFirst];
      for (let page = 2; page <= WOO_PAGES && products.length === (page - 1) * 100; page++) {
        const next = await fetcher.get(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
        const more = next.status === 200 ? parseWoo(json(next.body)) : null;
        if (!more || more.length === 0) break;
        products.push(...more);
      }
      let budget = WOO_VARIATIONS;
      const items: StoreItem[] = [];
      for (const p of products) {
        if (p.variationIds.length === 0 || budget <= 0) { items.push(p.item); continue; }
        const variants = [];
        for (const vid of p.variationIds.slice(0, budget)) {
          budget--;
          const r = await fetcher.get(`${origin}/wp-json/wc/store/v1/products/${vid}`);
          const v = r.status === 200 ? parseWooVariation(json(r.body), p.item.optionNames) : null;
          if (v) variants.push(v);
        }
        items.push(variants.length ? { ...p.item, variants } : p.item);
      }
      return { ok: true, items, platform: 'woocommerce' };
    }
    return { ok: false, reason: 'no_feed' };
  } catch (e) {
    return { ok: false, reason: e instanceof StoreFetchError ? e.reason : 'unreachable' };
  }
}

/** Her store's address → a kept import of its products. */
export async function startStoreImport(
  db: Db, businessIdRaw: string, actor: string, fetcher: StoreFetcher,
  input: { readonly address: string; readonly currencyConfirmed: boolean },
): Promise<{ ok: true; id: string } | { ok: false; reason: StoreRefusal; stated?: string }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { ok: false, reason: 'not_an_address' };
  const at = readStoreAddress(input.address);
  if (!at.ok) return { ok: false, reason: at.reason };
  const { currency, kind } = await withTenantTx(db, bid.value, async (tx) => ({
    currency: await currencyOf(tx, bid.value),
    kind: (await sql<{ kind: string | null }>`select kind from businesses where id = ${bid.value}`.execute(tx)).rows[0]?.kind ?? null,
  }));
  const read = await readStore(fetcher, at.origin);
  if (!read.ok) return read;
  // The currency, confirmed once: stated by the store, it must be hers; unstated, she says so.
  const stated = [...new Set(read.items.map((i) => i.currency).filter((c): c is string => c !== null))];
  if (stated.some((c) => c.toUpperCase() !== currency)) return { ok: false, reason: 'other_currency', stated: stated.join(', ') };
  if (stated.length === 0 && !input.currencyConfirmed) return { ok: false, reason: 'currency_unconfirmed' };
  const rows = itemsToRows(read.items, { defaultUnit: defaultUnitFor(kind), source: at.host });
  if (liveRows(rows).length === 0) return { ok: false, reason: 'no_products' };
  const id = await withTenantTx(db, bid.value, (tx) =>
    createImport(tx, bid.value, { kind: 'store', currency, sourceText: at.origin, rows, createdBy: actor }));
  return { ok: true, id };
}

/**
 * A pasted list that is a TABLE — a store's export, or spreadsheet rows with
 * several numbers — goes to the column mapping, not the line parser.
 */
export function looksLikeTable(text: string): boolean {
  const t = parseTable(text);
  if (!t) return false;
  if (detectPreset(t.header) !== null) return true;
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const tabbed = lines.filter((l) => l.includes('\t')).length;
  return tabbed >= Math.max(2, Math.ceil(lines.length * 0.7)) && !/\d/.test(t.header.join(' ')) && t.header.length >= 3;
}

/** A table (pasted or uploaded) → an import waiting for its columns. */
export async function startTableImport(db: Db, businessIdRaw: string, actor: string, text: string): Promise<{ ok: true; id: string } | { ok: false; reason: StoreRefusal }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { ok: false, reason: 'not_a_table' };
  if (!parseTable(text)) return { ok: false, reason: 'not_a_table' };
  return withTenantTx(db, bid.value, async (tx) => ({
    ok: true as const,
    id: await createImport(tx, bid.value, { kind: 'file', currency: await currencyOf(tx, bid.value), sourceText: text, rows: [], createdBy: actor }),
  }));
}

/** The mapping she chose, read from the columns form. */
export function mappingFrom(b: Readonly<Record<string, string | undefined>>, t: Table): Mapping {
  // An empty choice ("— none —") is no column: Number('') would read it as the first one.
  const idx = (k: string): number => {
    const raw = (b[k] ?? '').trim();
    if (!/^\d+$/.test(raw)) return -1;
    const n = Number(raw);
    return n < t.header.length ? n : -1;
  };
  const opt = (k: string): number | null => { const n = idx(k); return n >= 0 ? n : null; };
  const suggested = suggestMapping(t).mapping;
  return {
    name: idx('name'), price: idx('price'), sku: opt('sku'),
    options: [opt('option1'), opt('option2'), opt('option3')].filter((x): x is number => x !== null),
    group: opt('group'), currency: suggested.currency,
    ...(suggested.priceFallback !== undefined && idx('price') === suggested.price ? { priceFallback: suggested.priceFallback } : {}),
  };
}

/** The columns applied: the table's rows become the import's rows, and the review follows. */
export async function applyColumns(db: Db, businessIdRaw: string, id: string, b: Readonly<Record<string, string | undefined>>): Promise<{ ok: true } | { ok: false; problem: MappingProblem | 'unconfirmed' | 'no_products' | 'gone' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { ok: false, problem: 'gone' };
  return withTenantTx(db, bid.value, async (tx) => {
    const imp = await loadImport(tx, bid.value, id, { forUpdate: true });
    if (!imp || imp.state !== 'open' || imp.kind !== 'file') return { ok: false as const, problem: 'gone' as const };
    const table = parseTable(imp.sourceText ?? '');
    if (!table) return { ok: false as const, problem: 'gone' as const };
    const m = mappingFrom(b, table);
    const problem = checkMapping(table, m, imp.currency);
    if (problem) return { ok: false as const, problem };
    if (m.currency === null && b['currency'] !== 'on') return { ok: false as const, problem: 'unconfirmed' as const };
    const kind = (await sql<{ kind: string | null }>`select kind from businesses where id = ${bid.value}`.execute(tx)).rows[0]?.kind ?? null;
    const rows = itemsToRows(tableToItems(table, m), { defaultUnit: defaultUnitFor(kind), source: 'file' });
    if (liveRows(rows).length === 0) return { ok: false as const, problem: 'no_products' as const };
    await saveImport(tx, bid.value, id, { rows });
    return { ok: true as const };
  });
}

/** ── Pages ────────────────────────────────────────────────────────────────── */

const base = (id: string): string => `/app/products/import/${encodeURIComponent(id)}`;

/** The columns page: which column is which, the store's own presets filled in. */
export function renderColumns(locale: Locale, id: string, table: Table, currency: string, problem: MappingProblem | 'unconfirmed' | 'no_products' | null, chosen?: Mapping): string {
  const { preset, mapping } = suggestMapping(table);
  const m = chosen ?? mapping;
  const prices = new Set(priceColumns(table.header));
  const select = (name: string, value: number | null, opts: { optional: boolean; only?: ReadonlySet<number> }) =>
    `<select name="${name}">${opts.optional ? `<option value="">${esc(t(locale, 'import.columns.none'))}</option>` : ''}${table.header.map((h, i) =>
      opts.only && !opts.only.has(i) ? '' : `<option value="${i}"${value === i ? ' selected' : ''}>${esc(h || `#${i + 1}`)}</option>`).join('')}</select>`;
  const sample = table.rows.slice(0, 3).map((r) => `<tr>${table.header.map((_, i) => `<td dir="auto">${esc((r[i] ?? '').slice(0, 40))}</td>`).join('')}</tr>`).join('');
  return `<h1 class="page">${esc(t(locale, 'import.columns.title'))}</h1>
    <div class="block">
      <p>${esc(t(locale, preset ? `import.columns.preset.${preset}` as MessageKey : 'import.columns.intro', { n: table.rows.length }))}</p>
      ${problem ? `<p class="perr" role="alert">${esc(t(locale, `import.columns.problem.${problem}` as MessageKey, { currency }))}</p>` : ''}
      <div class="imp-table"><table><thead><tr>${table.header.map((h) => `<th dir="auto">${esc(h)}</th>`).join('')}</tr></thead><tbody>${sample}</tbody></table></div>
      <form method="post" action="${base(id)}/columns" class="imp-cols">
        <label>${esc(t(locale, 'import.columns.name'))} ${select('name', m.name, { optional: false })}</label>
        <label>${esc(t(locale, 'import.columns.price'))} ${select('price', m.price, { optional: false, only: prices })}</label>
        <p class="muted small">${esc(t(locale, 'import.columns.priceHint'))}</p>
        <label>${esc(t(locale, 'import.columns.sku'))} ${select('sku', m.sku, { optional: true })}</label>
        ${[0, 1, 2].map((n) => `<label>${esc(t(locale, 'import.columns.option', { n: n + 1 }))} ${select(`option${n + 1}`, m.options[n] ?? null, { optional: true })}</label>`).join('')}
        <label>${esc(t(locale, 'import.columns.group'))} ${select('group', m.group, { optional: true })}</label>
        <p class="muted small">${esc(t(locale, 'import.columns.groupHint'))}</p>
        ${m.currency === null ? `<label class="pcheck"><input type="checkbox" name="currency" /> ${esc(t(locale, 'import.columns.currency', { currency }))}</label>` : ''}
        <button class="btn send" type="submit">${esc(t(locale, 'import.columns.apply'))}</button>
      </form>
      ${back('/app/products/add', t(locale, 'product.detail.back'))}
    </div>`;
}

/** The add page's two store ways in: the address, and a file. */
export function renderStoreForms(locale: Locale, currency: string): string {
  return `<div class="block">
      <h2>${esc(t(locale, 'import.store.title'))}</h2>
      <p>${esc(t(locale, 'import.store.intro'))}</p>
      <form method="post" action="/app/products/add/store">
        <label class="pq"><span>${esc(t(locale, 'import.store.address'))}</span> <input type="text" name="address" inputmode="url" autocomplete="url" placeholder="myshop.com" dir="ltr" required /></label>
        <label class="pcheck"><input type="checkbox" name="currency" /> ${esc(t(locale, 'import.store.currency', { currency }))}</label>
        <button class="btn" type="submit">${esc(t(locale, 'import.store.read'))}</button>
      </form>
    </div>
    <div class="block">
      <h2>${esc(t(locale, 'import.file.title'))}</h2>
      <p>${esc(t(locale, 'import.file.intro'))}</p>
      <form method="post" action="/app/products/add/file" enctype="multipart/form-data">
        <input class="photo-in" type="file" name="file" accept=".csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
        <button class="btn" type="submit">${esc(t(locale, 'import.file.read'))}</button>
      </form>
    </div>`;
}

/** A store or a file that came to nothing: why, and the way on. */
export function renderStoreRefusal(locale: Locale, reason: StoreRefusal, stated?: string): string {
  return `<h1 class="page">${esc(t(locale, 'import.store.refusedTitle'))}</h1>
    <div class="block">
      <p>${esc(t(locale, `import.store.refused.${reason}` as MessageKey, { stated: stated ?? '' }))}</p>
      ${deeper('/app/products/add', t(locale, 'import.store.again'))}
    </div>`;
}
