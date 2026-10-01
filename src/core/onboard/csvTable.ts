import type { StoreItem, StoreVariant } from './storeFeed.js';

/**
 * K8 — A STORE'S EXPORTED FILE, OR ANY TABLE, ITS COLUMNS MAPPED.
 *
 * A Shopify, WooCommerce or Etsy export pasted into the one-product-per-line
 * parser is noise: commas, quoted descriptions with line breaks, a weight in
 * grams read as the price (the plan measured it). So a table is read as a
 * table — RFC 4180 CSV, or tab-separated rows copied from a spreadsheet — and
 * the owner says which column is the name, the price, the article number and
 * the options. For the three stores' own exports the columns are already
 * known (presets); she confirms them. A compare-at column is never offered as
 * the price. Pure: no I/O.
 */

export type Table = { readonly header: readonly string[]; readonly rows: readonly (readonly string[])[] };

/** Rows of a CSV (quotes, doubled quotes, line breaks inside quotes) or a tab-separated paste. */
export function parseTable(text: string): Table | null {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = src.split('\n', 1)[0] ?? '';
  const sep = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  const body = rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ''));
  if (body.length < 2 || body[0]!.length < 2) return null;
  return { header: body[0]!, rows: body.slice(1) };
}

export type Preset = 'shopify' | 'woocommerce' | 'etsy';

/** What a column is for. `options` are value columns, each named by its own header unless paired with a name column. */
export type Mapping = {
  readonly name: number;
  readonly price: number;
  /** Read when the price cell is empty — WooCommerce's regular price under an empty sale price. Never a compare-at. */
  readonly priceFallback?: number | null;
  readonly sku: number | null;
  readonly options: readonly number[];
  /** Rows sharing this column's value are one item's variants (Shopify's Handle, WooCommerce's Parent). */
  readonly group: number | null;
  /** A column stating each row's currency (Etsy). */
  readonly currency: number | null;
};

const col = (header: readonly string[], ...names: string[]): number => {
  const lower = header.map((h) => h.toLowerCase());
  for (const n of names) { const i = lower.indexOf(n.toLowerCase()); if (i >= 0) return i; }
  return -1;
};

/** Is this header one of the three stores' own exports? */
export function detectPreset(header: readonly string[]): Preset | null {
  if (col(header, 'Handle') >= 0 && col(header, 'Variant Price') >= 0) return 'shopify';
  if (col(header, 'Type') >= 0 && col(header, 'Regular price') >= 0 && col(header, 'Name') >= 0) return 'woocommerce';
  if (col(header, 'TITLE') >= 0 && col(header, 'PRICE') >= 0 && col(header, 'CURRENCY_CODE') >= 0) return 'etsy';
  return null;
}

/** The columns a price may be read from: never a compare-at, "was" or original price. */
export const priceColumns = (header: readonly string[]): readonly number[] =>
  header.map((h, i) => ({ h, i })).filter(({ h }) => !/compare|was\b|original|msrp|rrp|cost per item/i.test(h)).map(({ i }) => i);

/** A preset's mapping, for the owner to confirm; a best guess for any other table. */
export function suggestMapping(t: Table): { readonly preset: Preset | null; readonly mapping: Mapping } {
  const h = t.header;
  const preset = detectPreset(h);
  if (preset === 'shopify') {
    return { preset, mapping: { name: col(h, 'Title'), price: col(h, 'Variant Price'), sku: nonNeg(col(h, 'Variant SKU')),
      options: [col(h, 'Option1 Value'), col(h, 'Option2 Value'), col(h, 'Option3 Value')].filter((i) => i >= 0),
      group: nonNeg(col(h, 'Handle')), currency: null } };
  }
  if (preset === 'woocommerce') {
    // The price customers pay now: the sale price when there is one, else the regular price.
    const sale = col(h, 'Sale price');
    return { preset, mapping: { name: col(h, 'Name'), price: sale >= 0 ? sale : col(h, 'Regular price'),
      priceFallback: sale >= 0 ? nonNeg(col(h, 'Regular price')) : null, sku: nonNeg(col(h, 'SKU')),
      options: [col(h, 'Attribute 1 value(s)'), col(h, 'Attribute 2 value(s)'), col(h, 'Attribute 3 value(s)')].filter((i) => i >= 0),
      group: nonNeg(col(h, 'Parent')), currency: null } };
  }
  if (preset === 'etsy') {
    return { preset, mapping: { name: col(h, 'TITLE'), price: col(h, 'PRICE'), sku: nonNeg(col(h, 'SKU')),
      options: [col(h, 'VARIATION 1 VALUES'), col(h, 'VARIATION 2 VALUES')].filter((i) => i >= 0),
      group: null, currency: nonNeg(col(h, 'CURRENCY_CODE')) } };
  }
  const prices = priceColumns(h);
  const guessName = col(h, 'name', 'title', 'product', 'product name', 'item', '名称', '产品', 'اسم', 'المنتج');
  const guessPrice = prices.find((i) => /price|precio|prix|preço|价格|售价|سعر/i.test(h[i]!)) ?? -1;
  return { preset: null, mapping: { name: guessName, price: guessPrice, sku: nonNeg(col(h, 'sku', 'code', 'article', 'ref', '货号', 'رمز')),
    options: [], group: null, currency: null } };
}
const nonNeg = (i: number): number | null => (i >= 0 ? i : null);

/** A price cell as a store writes it: "24.00", "24,00", "$24.00", "1,250.00". */
function priceCell(raw: string): number | null {
  const s = raw.replace(/[^\d.,]/g, '');
  if (!s) return null;
  let n: number;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) n = Number(s.replace(/,/g, ''));
  else if (/^\d+,\d{1,2}$/.test(s)) n = Number(s.replace(',', '.'));
  else if (/^\d+(\.\d+)?$/.test(s)) n = Number(s);
  else return null;
  return n > 0 ? n : null;
}

/** Why a mapping cannot be used. */
export type MappingProblem = 'no_name_column' | 'no_price_column' | 'price_is_compare_at' | 'other_currency';

export function checkMapping(t: Table, m: Mapping, currency: string): MappingProblem | null {
  if (m.name < 0 || m.name >= t.header.length) return 'no_name_column';
  if (m.price < 0 || m.price >= t.header.length) return 'no_price_column';
  if (!priceColumns(t.header).includes(m.price)) return 'price_is_compare_at';
  if (m.currency !== null) {
    const stated = new Set(t.rows.map((r) => (r[m.currency!] ?? '').trim().toUpperCase()).filter(Boolean));
    if ([...stated].some((c) => c !== currency)) return 'other_currency';
  }
  return null;
}

/**
 * The table as items. Rows sharing the group column are one item's variants;
 * an item's name is the first name in the group (a Shopify variant row has
 * none of its own). An option column's header names it, Shopify's "Option1
 * Value" by its paired "Option1 Name".
 */
export function tableToItems(t: Table, m: Mapping): StoreItem[] {
  /** The column that names option column `i`, when the export pairs them. */
  const nameColumn = (i: number): number => {
    const hdr = t.header[i] ?? '';
    const pair = /^option(\d) value$/i.exec(hdr);
    if (pair) return col(t.header, `Option${pair[1]} Name`);
    const woo = /^attribute (\d) value\(s\)$/i.exec(hdr);
    if (woo) return col(t.header, `Attribute ${woo[1]} name`);
    const etsy = /^variation (\d) values$/i.exec(hdr);
    if (etsy) return col(t.header, `VARIATION ${etsy[1]} NAME`);
    return -1;
  };
  /** An option's name, from the product's OWN rows first — each product names its options. */
  const optionNamesOf = (rows: readonly (readonly string[])[]): string[] => m.options.map((i) => {
    const ni = nameColumn(i);
    return (ni >= 0 ? rows.map((r) => r[ni] ?? '').find(Boolean) : undefined) ?? t.header[i] ?? '';
  });
  // A row its variations point at (WooCommerce's Parent says "id:123" or the
  // parent's SKU) is the head of their group.
  const idCol = col(t.header, 'ID');
  const referenced = new Set(m.group === null ? [] : t.rows.map((r) => r[m.group!] ?? '').filter(Boolean));
  const ownKey = (r: readonly string[]): string | null => {
    const byId = idCol >= 0 && r[idCol] ? `id:${r[idCol]}` : null;
    if (byId && referenced.has(byId)) return byId;
    const bySku = m.sku !== null ? (r[m.sku] ?? '') : '';
    return bySku && referenced.has(bySku) ? bySku : null;
  };
  const groups = new Map<string, (readonly string[])[]>();
  t.rows.forEach((r, i) => {
    const key = m.group !== null && (r[m.group] ?? '') !== '' ? `g:${r[m.group]}` : ownKey(r) ? `g:${ownKey(r)}` : `r:${i}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  });
  const priceOf = (r: readonly string[]): number | null =>
    priceCell(r[m.price] ?? '') ?? (m.priceFallback !== null && m.priceFallback !== undefined ? priceCell(r[m.priceFallback] ?? '') : null);
  const out: StoreItem[] = [];
  for (const rows of groups.values()) {
    const title = rows.map((r) => r[m.name] ?? '').find((x) => x.trim() !== '');
    if (!title) continue;
    const variants: StoreVariant[] = rows
      // A WooCommerce "variable" parent carries no price of its own: its variations do.
      .filter((r, idx) => !(rows.length > 1 && idx === 0 && priceOf(r) === null && m.group !== null))
      .map((r) => ({ price: priceOf(r), sku: m.sku !== null ? (r[m.sku] ?? '').trim() || null : null, options: m.options.map((i) => (r[i] ?? '').trim()) }));
    out.push({
      title: title.trim(), optionNames: optionNamesOf(rows), variants: variants.length ? variants : [{ price: null, sku: null, options: [] }],
      currency: m.currency !== null ? (rows[0]![m.currency] ?? '').trim().toUpperCase() || null : null,
    });
  }
  return out;
}
