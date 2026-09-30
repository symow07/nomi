import { describe, it, expect } from 'vitest';
import { parsePriceLines, ownPriceCount } from '../../src/core/onboard/catalogImport.js';
import {
  rowsFromParsed, flagsOf, needsTick, reviewOrder, editRow, pickChallenge, applyChallenge, derivedFloor,
  readDiscount, blockers, linesRead, liveRows, type ImportRow, type ReviewContext,
} from '../../src/core/onboard/importReview.js';
import { defaultUnitFor, isRetailKind } from '../../src/core/owner/sellingStyle.js';
import { diffAgainstCatalogue } from '../../src/core/onboard/catalogDiff.js';
import { renderImportReview, renderFloors, type ReviewModel } from '../../src/api/web/importFlow.js';
import { asExtracted } from '../../src/core/onboard/importReview.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import type { ExtractedProduct } from '../../src/core/onboard/catalogImport.js';

/**
 * K1 · K2 · K7 — the kept import review (the onboarding plan, Stage 2; 0094):
 * every rule on its own, then the page in every language.
 */

const PASTE: ReviewContext = { kind: 'paste', currency: 'USD', country: 'US', countryCurrency: 'USD', defaultUnit: 'item' };
const PHOTO: ReviewContext = { ...PASTE, kind: 'photo' };
const read = (text: string, ctx = PASTE, page = false): ImportRow[] =>
  rowsFromParsed(parsePriceLines(text, ctx.currency), { photo: page ? 1 : null, startAt: 1, defaultUnit: ctx.defaultUnit, page });

describe('K1 · every line is a row, the refused ones too', () => {
  it('"we read N lines" counts every line the list had', () => {
    const rows = read('PRICE LIST\nTote bag $12.00\nCap $8\nThank you', PHOTO, true);
    expect(linesRead(rows)).toBe(4);
    expect(liveRows(rows).map((r) => r.name)).toEqual(['Tote bag', 'Cap']);
    expect(rows.filter((r) => r.refused).map((r) => r.refused)).toEqual(['no_price_on_page', 'no_price_on_page']);
  });

  it('RT · a shop counts in "item", a factory in "pcs" — the parser\'s pcs is replaced, a unit the line named is kept', () => {
    expect(defaultUnitFor('online_shop')).toBe('item');
    expect(defaultUnitFor('brand')).toBe('item');
    expect(defaultUnitFor('retail')).toBe('item');
    for (const k of ['manufacturer', 'trading', 'wholesale', 'services', 'agency', 'startup', 'other', null]) expect(defaultUnitFor(k), String(k)).toBe('pcs');
    expect(isRetailKind('brand') && !isRetailKind('manufacturer')).toBe(true);
    expect(read('Tote bag $12')[0]!.unit).toBe('item');
    expect(read('Tote bag $12', { ...PASTE, defaultUnit: 'pcs' })[0]!.unit).toBe('pcs');
  });

  it('keys are stable: a paste line by its number, a photo line by photo and number', () => {
    expect(read('A tote $1\nB cap $2').map((r) => r.key)).toEqual(['l1', 'l2']);
    expect(read('A tote $1', PHOTO, true)[0]!.key).toBe('p1-1');
  });
});

describe('K1 · the flags', () => {
  const flags = (line: string, ctx = PASTE, others: readonly string[] = []) => {
    const rows = read([line, ...others].join('\n'), ctx);
    return flagsOf(rows[0]!, rows, ctx);
  };

  it('two prices on one line: a struck price, was/now, one per size — never "$12 USD" once', () => {
    expect(flags('Hoodie S-M $40 / L-XL $45')).toContain('two_prices');
    expect(flags('Serum $25.00 $22.00')).toContain('two_prices');
    expect(ownPriceCount('Tote $12 USD', 'USD')).toBe(1);
    expect(flags('Tote $12 USD')).not.toContain('two_prices');
  });

  it('"from", tax and old prices, in the languages owners write', () => {
    for (const line of ['Logo design from $150', 'Tote $12 incl. VAT', 'Cap $8 was $10', '帆布袋 $5 起', 'حقيبة $12 شامل الضريبة', 'Bolso desde $12']) {
      expect(flags(line), line).toContain('from_or_vat');
    }
    expect(flags('Tote bag $12')).not.toContain('from_or_vat');
  });

  it('far from the list\'s median, more than two decimals, a figure left in the name', () => {
    expect(flags('Tote $900', PASTE, ['Cap $10', 'Mug $12', 'Pen $9'])).toContain('outlier');
    expect(flags('Tote $11', PASTE, ['Cap $10', 'Mug $12', 'Pen $9'])).not.toContain('outlier');
    expect(flags('Tote $1.2345')).toContain('many_decimals');
    expect(flags('Cup 500ml $3')).toContain('digits_in_name');
  });

  it('a bare "$" from a country that does not count in US dollars; never from the US, never "US$"', () => {
    const ca: ReviewContext = { ...PASTE, country: 'CA', countryCurrency: null };
    expect(flags('Tote $12', ca)).toContain('bare_dollar');
    expect(flags('Tote US$12', ca)).not.toContain('bare_dollar');
    expect(flags('Tote $12')).not.toContain('bare_dollar');
    expect(flags('Tote $12', { ...ca, country: 'EC' })).not.toContain('bare_dollar');   // Ecuador counts in dollars
  });

  it('a refused or removed row carries none, and flagged rows come first', () => {
    const rows = read('Cap $10\nHoodie S-M $40 / L-XL $45\nMug $12');
    expect(reviewOrder(rows, PASTE, false).map((r) => r.name)[0]).toBe('Hoodie S-M / L-XL');
    const removed = rows.map((r) => (r.key === 'l2' ? { ...r, removed: true } : r));
    expect(flagsOf(removed[1]!, removed, PASTE)).toEqual([]);
  });
});

describe('K1 · what needs its own tick', () => {
  it('on a photo, every priced row; on a paste, the flagged ones; after a mismatch, every row', () => {
    const photo = read('Tote $12\nCap $8', PHOTO, true);
    expect(photo.every((r) => needsTick(r, photo, PHOTO, false))).toBe(true);
    const paste = read('Tote $12\nHoodie S-M $40 / L-XL $45\nMug');
    expect(paste.map((r) => needsTick(r, paste, PASTE, false))).toEqual([false, true, false]);
    expect(paste.every((r) => needsTick(r, paste, PASTE, true))).toBe(true);
    expect(blockers(paste, PASTE, false)).toEqual([{ kind: 'untick', keys: ['l2'] }]);
    expect(blockers(paste.map((r) => ({ ...r, removed: true })), PASTE, false)).toEqual([{ kind: 'nothing' }]);
  });
});

describe('K1 · the owner\'s edits', () => {
  const [row] = read('Tote bag $12 MOQ 50');
  it('name, price, unit, minimum and names customers use — each kept as typed, each refused whole when wrong', () => {
    const e = editRow(row!, { name: ' Canvas  tote ', price: '14,50', unit: 'pair', moq: '', names: 'shopper, 帆布袋\ntote' });
    expect(e.errors).toEqual([]);
    expect(e.row).toMatchObject({ name: 'Canvas tote', price: 14.5, unit: 'pair', moq: null, names: ['shopper', '帆布袋', 'tote'], edited: true });
    expect(editRow(row!, { price: 'twelve' }).errors).toEqual(['price_not_number']);
    expect(editRow(row!, { price: '0' }).errors).toEqual(['price_not_positive']);
    expect(editRow(row!, { moq: '2.5' }).errors).toEqual(['moq_not_whole']);
    expect(editRow(row!, { name: '  ' }).errors).toEqual(['name_empty']);
    // A minimum of one is no minimum; "no minimum" wins over a figure left in the box.
    expect(editRow(row!, { moq: '1' }).row.moq).toBeNull();
    expect(editRow(row!, { moq: '50', noMinimum: true }).row.moq).toBeNull();
  });
  it('a row changed and not re-ticked loses its tick; removing is not an edit', () => {
    const ticked = { ...row!, ticked: true };
    expect(editRow(ticked, { price: '13' }).row.ticked).toBe(false);
    expect(editRow(ticked, { price: '13', ticked: true }).row.ticked).toBe(true);
    expect(editRow(row!, { removed: true }).row).toMatchObject({ removed: true, edited: false });
  });
});

describe('K7 · the challenge rows', () => {
  const rows = read(['Aa tote $1', 'Bb cap $2', 'Cc mug $3', 'Dd pen $4', 'Ee hat $5', 'Ff bag $6'].join('\n'), PHOTO, true);
  it('three rows, always the last priced one', () => {
    const keys = pickChallenge(rows, () => 0);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe('p1-6');
    expect(new Set(keys).size).toBe(3);
    expect(pickChallenge(rows.slice(0, 2), () => 0)).toHaveLength(2);
  });
  it('typed as read: the row is fine; typed otherwise: it and its neighbours reopen, every tick goes, and nothing is guessed', () => {
    const asked = rows.map((r) => (['p1-3', 'p1-6'].includes(r.key) ? { ...r, challenge: 'ask' as const } : { ...r, ticked: true }));
    const ok = applyChallenge(asked, new Map([['p1-3', '3.00'], ['p1-6', '6']]));
    expect(ok.mismatch).toBe(false);
    expect(ok.rows.filter((r) => r.challenge === 'ok').map((r) => r.key)).toEqual(['p1-3', 'p1-6']);
    const bad = applyChallenge(asked, new Map([['p1-3', '3.50'], ['p1-6', '6']]));
    expect(bad.mismatch).toBe(true);
    expect(bad.rows.filter((r) => r.reopened).map((r) => r.key)).toEqual(['p1-2', 'p1-4']);
    expect(bad.rows.some((r) => r.ticked)).toBe(false);
    const half = applyChallenge(asked, new Map([['p1-3', '']]));
    expect(half.missing).toEqual(['p1-3', 'p1-6']);
  });
});

describe('K2 · the discount question', () => {
  it('a floor is the price less the discount, rounded UP to the cent — never more off than allowed', () => {
    expect(derivedFloor(12, 10)).toBe(10.8);
    expect(derivedFloor(9.99, 15)).toBe(8.5);          // 8.4915 → 8.50
    expect(derivedFloor(150000, 10)).toBe(135000);
    expect(derivedFloor(12, 0)).toBe(12);
  });
  it('a discount is 0 up to 99, with or without "%"; empty is "later"', () => {
    expect(readDiscount('10')).toBe(10);
    expect(readDiscount('12.5 %')).toBe(12.5);
    expect(readDiscount('')).toBeNull();
    expect(readDiscount('100')).toBe('invalid');
    expect(readDiscount('-5')).toBe('invalid');
  });
});

/** A model for the page, as the routes build it. */
function model(rows: ImportRow[], ctx: ReviewContext, extra: Partial<ReviewModel['imp']> = {}): ReviewModel {
  const keyOf = new Map<ExtractedProduct, string>();
  const lines = liveRows(rows).map((r) => { const e = asExtracted(r, ctx.currency); keyOf.set(e, r.key); return e; });
  const diff = diffAgainstCatalogue(lines, []);
  return {
    imp: { id: '11111111-1111-4111-8111-111111111111', kind: ctx.kind, state: 'open', currency: ctx.currency, sourceText: 'x',
           rows, checkEveryRow: false, discountPct: null, photos: ctx.kind === 'photo' ? [{ position: 1, mediaType: 'image/jpeg', transcript: 'Tote $12' }] : [],
           createdAt: new Date(0), ...extra },
    ctx, diff, keyOf, matched: new Set(), currencyNow: ctx.currency,
  };
}

describe('K1 · the page', () => {
  const rows = read('Tote bag $12.00\nHoodie S-M $40 / L-XL $45\nMug $9', PHOTO, true)
    .map((r) => (r.key === 'p1-3' ? { ...r, challenge: 'ask' as const } : r));

  it('in every language: no raw key, the count, the photo beside the rows, the discount question', () => {
    for (const l of LOCALES) {
      const html = renderImportReview(model(rows, PHOTO), l);
      expect(html, l).not.toMatch(/\b(import|product)\.[a-z]+\.[a-zA-Z_.]+/);
      expect(html, l).toContain('/photo/1');
      expect(html, l).toContain('name="discount"');
      expect(html, l).toContain('name="rows"');
    }
  });

  it('K7 · a challenge row shows no price, no line and no price box; the transcript waits', () => {
    const html = renderImportReview(model(rows, PHOTO), 'en');
    expect(html).toContain('name="typed:p1-3"');
    expect(html).not.toContain('name="price:p1-3"');
    expect(html).not.toContain('Mug $9');
    expect(html).not.toContain('$9.00');
    expect(html).toContain('What was read from the photo is shown once you have typed the prices');
  });

  it('a photo\'s priced row has its own tick box; the flag is said in words', () => {
    const html = renderImportReview(model(rows, PHOTO), 'en');
    expect(html).toContain('name="tick:p1-1"');
    expect(html).toContain('Two prices on this line');
  });

  it('K2 · the floors page: each new product\'s lowest price, a box each, none ticked for her', () => {
    const m = model(read('Tote bag $12.00\nMug $9'), PASTE, { discountPct: 10 });
    for (const l of LOCALES) {
      const html = renderFloors(m, l);
      expect(html, l).not.toMatch(/\bimport\.[a-z]+\.[a-zA-Z_.]+/);
      expect(html.match(/name="floor:/g), l).toHaveLength(2);
      expect(html, l).not.toMatch(/name="floor:[^"]+" checked/);
    }
    expect(renderFloors(m, 'en')).toContain('$10.80');
    expect(renderFloors(m, 'en')).toContain('10%');
  });
});
