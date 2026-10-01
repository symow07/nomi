import { describe, it, expect } from 'vitest';
import { readStoreAddress, isPublicAddress } from '../../src/core/onboard/storeAddress.js';
import { parseShopify, parseWoo, parseWooVariation, itemsToRows } from '../../src/core/onboard/storeFeed.js';
import { parseTable, detectPreset, suggestMapping, tableToItems, checkMapping, priceColumns } from '../../src/core/onboard/csvTable.js';
import { looksLikeTable, renderColumns, renderStoreForms, renderStoreRefusal, mappingFrom, type StoreRefusal } from '../../src/api/web/storeImport.js';
import { publicLookup } from '../../src/net/publicFetch.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * K8 — store import (the onboarding plan, decision 30): the address rule, the
 * two stores' public lists, the three stores' export files, and the variant
 * rule (each priced variant a product; options become knowledge).
 */

describe('K8 · an address is read only if it is public', () => {
  it('a typed address becomes the store\'s https origin', () => {
    expect(readStoreAddress('myshop.com')).toEqual({ ok: true, origin: 'https://myshop.com', host: 'myshop.com' });
    expect(readStoreAddress(' https://Shop.Example.org/collections/all ')).toMatchObject({ ok: true, origin: 'https://shop.example.org' });
  });
  it('refused: http, a bare IP, a private name, another port, credentials, not an address', () => {
    expect(readStoreAddress('http://myshop.com')).toEqual({ ok: false, reason: 'not_https' });
    for (const a of ['https://127.0.0.1', 'https://169.254.169.254', 'https://[::1]', 'https://localhost', 'https://intranet', 'https://shop.local', 'https://myshop.com:8443'])
      expect(readStoreAddress(a), a).toEqual({ ok: false, reason: 'not_public' });
    expect(readStoreAddress('https://me:pw@myshop.com')).toEqual({ ok: false, reason: 'not_an_address' });
    expect(readStoreAddress('   ')).toEqual({ ok: false, reason: 'not_an_address' });
  });
  it('a resolved address is public only outside every private, loopback, link-local and reserved range', () => {
    for (const ip of ['8.8.8.8', '104.16.0.1', '2606:4700::1111']) expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1',
      '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'ff02::1'])
      expect(isPublicAddress(ip), ip).toBe(false);
  });
  it('the connect-time lookup refuses a name that resolves to loopback (no rebinding past the check)', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => publicLookup('localhost', {}, (e) => resolve(e)));
    expect(err?.code).toBe('NOT_PUBLIC');
  });
});

const SHOPIFY = {
  products: [
    { title: 'Hoodie', options: [{ name: 'Size', values: ['S', 'M', 'L', 'XL'] }],
      variants: [
        { price: '40.00', compare_at_price: '55.00', sku: 'H-S', option1: 'S' },
        { price: '40.00', compare_at_price: '55.00', sku: 'H-M', option1: 'M' },
        { price: '45.00', compare_at_price: '60.00', sku: 'H-L', option1: 'L' },
        { price: '45.00', compare_at_price: '60.00', sku: 'H-XL', option1: 'XL' },
      ] },
    { title: 'Linen tee', options: [{ name: 'Size', values: ['S', 'M'] }, { name: 'Colour', values: ['Black', 'White'] }],
      variants: [
        { price: '24.00', sku: 'T-SB', option1: 'S', option2: 'Black' }, { price: '24.00', sku: 'T-SW', option1: 'S', option2: 'White' },
        { price: '24.00', sku: 'T-MB', option1: 'M', option2: 'Black' },
      ] },
    { title: 'Gift card', options: [{ name: 'Title', values: ['Default Title'] }], variants: [{ price: '25.00', sku: 'GC', option1: 'Default Title' }] },
  ],
};

describe('K8 · the variant rule', () => {
  const rows = itemsToRows(parseShopify(SHOPIFY)!, { defaultUnit: 'item', source: 'myshop.com' });
  it('each price of a product is a product; variants sharing a price stay one; the compare-at price is never the price', () => {
    expect(rows.map((r) => [r.name, r.price])).toEqual([
      ['Hoodie — S, M', 40], ['Hoodie — L, XL', 45], ['Linen tee', 24], ['Gift card', 25],
    ]);
    expect(rows.some((r) => r.price === 55 || r.price === 60)).toBe(false);
  });
  it('the options go with each product as its knowledge; a placeholder option is not one', () => {
    expect(rows[0]!.options).toBe('Size: S, M');
    expect(rows[2]!.options).toBe('Size: S, M · Colour: Black, White');
    expect(rows[3]!.options).toBeUndefined();
  });
  it('a one-variant product keeps its article number; several variants have none of their own', () => {
    expect(rows[3]!.sku).toBe('GC');
    expect(rows[2]!.sku).toBeNull();
    expect(rows.every((r) => r.unit === 'item' && r.moq === null)).toBe(true);
  });
});

describe('K8 · WooCommerce\'s public list', () => {
  const list = [
    { id: 11, name: 'Tote bag', sku: 'TB', prices: { price: '1200', currency_code: 'AED', currency_minor_unit: 2 }, attributes: [], variations: [] },
    { id: 12, name: 'Scarf', sku: '', prices: { price: '4000', currency_code: 'AED', currency_minor_unit: 2, price_range: { min_amount: '4000', max_amount: '4500' } },
      attributes: [{ name: 'Length', terms: [{ name: 'Short' }, { name: 'Long' }] }], variations: [{ id: 121 }, { id: 122 }] },
  ];
  it('prices in minor units, the currency stated, a variable product\'s variations to read', () => {
    const w = parseWoo(list)!;
    expect(w[0]!.item).toMatchObject({ title: 'Tote bag', currency: 'AED', variants: [{ price: 12, sku: 'TB' }] });
    expect(w[1]!.variationIds).toEqual([121, 122]);
    const v = parseWooVariation({ prices: { price: '4500', currency_minor_unit: 2 }, sku: 'SC-L', variation: [{ attribute: 'Length', value: 'Long' }] }, ['Length']);
    expect(v).toEqual({ price: 45, sku: 'SC-L', options: ['Long'] });
  });
  it('a page that is not a Store API list is not read as one', () => {
    expect(parseWoo({ products: [] })).toBeNull();
    expect(parseShopify([{ prices: {} }])).toBeNull();
  });
});

const SHOPIFY_CSV = [
  'Handle,Title,Body (HTML),Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Compare At Price',
  'hoodie,Hoodie,"<p>Warm, soft</p>",Size,S,H-S,40.00,55.00',
  'hoodie,,,,M,H-M,40.00,55.00',
  'hoodie,,,,L,H-L,45.00,60.00',
  'cap,"Cap, wool",,Title,Default Title,C-1,18.00,',
].join('\n');

describe('K8 · a store\'s exported file', () => {
  it('a CSV with quotes, commas and line breaks inside cells is a table; so are tab-separated rows', () => {
    const t = parseTable('Name,Notes,Price\n"Tote, canvas","line one\nline two",12.00\n')!;
    expect(t.rows).toEqual([['Tote, canvas', 'line one\nline two', '12.00']]);
    expect(parseTable('Name\tPrice\tStock\nTote\t12\t40\n')!.header).toEqual(['Name', 'Price', 'Stock']);
    expect(parseTable('just one line')).toBeNull();
  });
  it('the three stores\' exports are recognised, and a compare-at column is never offered as the price', () => {
    const t = parseTable(SHOPIFY_CSV)!;
    expect(detectPreset(t.header)).toBe('shopify');
    expect(priceColumns(t.header)).not.toContain(t.header.indexOf('Variant Compare At Price'));
    expect(detectPreset(['ID', 'Type', 'SKU', 'Name', 'Regular price', 'Sale price'])).toBe('woocommerce');
    expect(detectPreset(['TITLE', 'PRICE', 'CURRENCY_CODE', 'QUANTITY'])).toBe('etsy');
  });
  it('Shopify: rows of one handle are one product, by price; the option is named by its own column', () => {
    const t = parseTable(SHOPIFY_CSV)!;
    const { mapping } = suggestMapping(t);
    expect(checkMapping(t, mapping, 'USD')).toBeNull();
    const rows = itemsToRows(tableToItems(t, mapping), { defaultUnit: 'item', source: 'file' });
    expect(rows.map((r) => [r.name, r.price, r.options ?? null])).toEqual([
      ['Hoodie — S, M', 40, 'Size: S, M'], ['Hoodie — L', 45, 'Size: L'], ['Cap, wool', 18, null],
    ]);
  });
  it('WooCommerce: a variable parent and its variations are one product; the sale price, else the regular one', () => {
    const t = parseTable([
      'ID,Type,SKU,Name,Parent,Sale price,Regular price,Attribute 1 name,Attribute 1 value(s)',
      '7,variable,SHIRT,Shirt,,,,Colour,"Red, Blue"',
      '8,variation,SHIRT-R,Shirt - Red,id:7,20,25,Colour,Red',
      '9,variation,SHIRT-B,Shirt - Blue,id:7,,25,Colour,Blue',
      '10,simple,MUG,Mug,,,9.50,,',
    ].join('\n'))!;
    const rows = itemsToRows(tableToItems(t, suggestMapping(t).mapping), { defaultUnit: 'item', source: 'file' });
    expect(rows.map((r) => [r.name, r.price])).toEqual([['Shirt — Red', 20], ['Shirt — Blue', 25], ['Mug', 9.5]]);
  });
  it('Etsy: the file states its currency — another one is refused, nothing converted', () => {
    const t = parseTable('TITLE,PRICE,CURRENCY_CODE,QUANTITY\nRing,35.00,EUR,4\n')!;
    expect(checkMapping(t, suggestMapping(t).mapping, 'AED')).toBe('other_currency');
    expect(checkMapping(t, suggestMapping(t).mapping, 'EUR' as never)).toBeNull();
  });
  it('a price column that is a compare-at is refused however it was chosen', () => {
    const t = parseTable(SHOPIFY_CSV)!;
    expect(checkMapping(t, { ...suggestMapping(t).mapping, price: t.header.indexOf('Variant Compare At Price') }, 'USD')).toBe('price_is_compare_at');
  });
  it('"— none —" maps nothing: an empty choice is never read as the first column', () => {
    const t = parseTable(SHOPIFY_CSV)!;
    const m = mappingFrom({ name: '1', price: '6', sku: '', option1: '4', option2: '', option3: '', group: '0' }, t);
    expect(m).toMatchObject({ name: 1, price: 6, sku: null, options: [4], group: 0 });
    expect(mappingFrom({ name: '', price: 'x' }, t)).toMatchObject({ name: -1, price: -1 });
  });

  it('a pasted export or a spreadsheet table goes to the columns; an ordinary list does not', () => {
    expect(looksLikeTable(SHOPIFY_CSV)).toBe(true);
    expect(looksLikeTable('Name\tPrice\tStock\nTote\t12\t40\nCap\t8\t10\n')).toBe(true);
    expect(looksLikeTable('Tote bag $12\nCap $8\n')).toBe(false);
  });
});

describe('K8 · the pages', () => {
  it('the add page\'s two ways in, the columns page and every refusal, in every language, with no key showing', () => {
    const t = parseTable(SHOPIFY_CSV)!;
    const reasons: StoreRefusal[] = ['not_an_address', 'not_https', 'not_public', 'unreachable', 'timeout', 'too_large', 'too_many_redirects',
      'no_feed', 'no_products', 'other_currency', 'currency_unconfirmed', 'not_a_table'];
    for (const l of LOCALES) {
      expect(renderStoreForms(l, 'USD'), l).toContain('action="/app/products/add/store"');
      expect(renderStoreForms(l, 'USD'), l).toContain('action="/app/products/add/file"');
      const cols = renderColumns(l, 'imp-1', t, 'USD', null);
      expect(cols, l).toContain('action="/app/products/import/imp-1/columns"');
      expect(cols, l).not.toMatch(/\bimport\.[a-z]+\.[a-zA-Z_.]+/);
      for (const r of reasons) expect(renderStoreRefusal(l, r, 'EUR'), `${l} ${r}`).not.toMatch(/\bimport\.store\./);
    }
    // The compare-at column is not among the price choices.
    const priceSelect = /<select name="price">([\s\S]*?)<\/select>/.exec(renderColumns('en', 'x', t, 'USD', null))![1]!;
    expect(priceSelect).not.toContain('Compare At');
  });
});
