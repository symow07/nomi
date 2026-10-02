import { lessSure, figuresOn, type FieldConfidence } from './extract.js';
import type { Currency } from '../types/money.js';
import { type ExtractedProduct, type RejectReason, ownPriceCount, validateExtracted, validatePage } from './catalogImport.js';
import { parseCustomerNames, MAX_ALIAS_LENGTH } from './aliases.js';

/**
 * K1 — THE IMPORT REVIEW, KEPT (the onboarding plan, Stage 2, 2026-10-01).
 *
 * An import used to live in the review page's hidden field: the lines went back
 * and forth and the confirm read them again. So nothing the owner did on the
 * review could last — not removing one wrong row, not fixing a name, not saying
 * what a price is per — and a photo was read and thrown away.
 *
 * Now an import is a list of ROWS, kept until it is confirmed. Every line the
 * reader or the paste produced is a row, the refused ones too (so the count is
 * the count of lines); the owner edits them, removes them, ticks them; the
 * confirm writes exactly the rows as they stand. Pure: the routes store and load
 * them (src/db/catalogImports.ts).
 *
 * WHAT THE OWNER CONFIRMS LINE BY LINE (the plan's rule: anything the numeral
 * guard will treat as sourced gets its own confirm):
 *   · on a PHOTO, every price — digits are misread, a struck price comes through
 *     as two plain numbers, and "Read from" shows the reader's text, not the
 *     paper;
 *   · on a paste or a store's own list, every FLAGGED row; the rest as a block;
 *   · once a challenge row was typed differently (K7), EVERY row.
 */

/** Why a row wants the owner's eye. Each is a sentence on the review. */
export type ImportFlag =
  | 'two_prices'          // more than one price on the line: struck, was/now, one per size
  | 'outlier'             // far from the list's other prices (under a tenth, over ten times the median)
  | 'digits_in_name'      // a figure or a currency sign left in the name
  | 'many_decimals'       // more than two decimal places
  | 'from_or_vat'         // "from", "incl. VAT", "compare at", 起, 含税… — the figure may not be the price
  | 'bare_dollar'         // a bare "$" from a seller whose country does not count in US dollars
  | 'challenge_mismatch'  // K7: typed from the paper differently, or next to one that was
  | 'low_confidence'      // EXT: read by the extractor, less surely than LOW_CONFIDENCE somewhere
  | 'no_sign'             // phase 9: a price read with no currency sign anywhere on the line
  | 'unread_figure';      // phase 9: no price, and a figure on the line that was not read as one

export const FLAG_ORDER: readonly ImportFlag[] = [
  'challenge_mismatch', 'low_confidence', 'two_prices', 'from_or_vat', 'bare_dollar', 'no_sign', 'outlier', 'many_decimals', 'unread_figure', 'digits_in_name',
];

export type ImportKind = 'paste' | 'photo' | 'store' | 'file';

/** K7 — where a row stands in the challenge: asked, typed right, or typed differently. */
export type ChallengeState = 'ask' | 'ok' | 'mismatch';

export type ImportRow = {
  /** Stable within the import: `l<n>` for a pasted line, `p<photo>-<n>` for a photo's. */
  readonly key: string;
  /** The line it was read from, verbatim. */
  readonly line: string;
  /** Which photo (1-based) it came from; null for a paste or a store. */
  readonly photo: number | null;
  readonly sku: string | null;
  readonly name: string;
  readonly nameZh: string | null;
  /** In the import's currency. null: no price (a paste may add a product to price later). */
  readonly price: number | null;
  /** What the price is per: a unit code (`item`, `pcs`, `pair`…) or the owner's own word. */
  readonly unit: string;
  /** null: no minimum. */
  readonly moq: number | null;
  /** Names customers use for it (T3: they become the names it is found by). */
  readonly names: readonly string[];
  /** Not a product: why (the review shows it with the reason, and counts it). */
  readonly refused: RejectReason | null;
  readonly removed: boolean;
  /** The owner ticked this row as checked. */
  readonly ticked: boolean;
  /** K7 — null: not a challenge row. */
  readonly challenge: ChallengeState | null;
  /** K7 — a row next to a mismatched challenge row, opened for the owner to check again. */
  readonly reopened: boolean;
  /** The owner changed something the reader produced (the audit trail says so). */
  readonly edited: boolean;
  /** Once confirmed: the product this row added or changed. */
  readonly productId?: string;
  /** G16 — a row that changes a product she has: false once she unticked the change (on until then). */
  readonly apply?: boolean;
  /** K8 — the options a store gave (sizes, colours, shades): the product's knowledge, never a price. */
  readonly options?: string;
  /** EXT — read by the model extractor, with how sure it was of each field: the row needs its own tick. */
  readonly confidence?: FieldConfidence;
};

/** What the review needs to know about the business to read its rows. */
export type ReviewContext = {
  readonly kind: ImportKind;
  readonly currency: Currency;
  /** The seller's country's own currency, when known (a bare "$" from a peso or Canadian-dollar seller is flagged). */
  readonly countryCurrency: Currency | null;
  /** The country itself, for the dollar check; null when unknown. */
  readonly country: string | null;
  /** RT — the unit a new row counts in: `item` for shops and brands, `pcs` for factories and traders. */
  readonly defaultUnit: string;
};

/** Countries whose own money is the US dollar: a bare "$" there is a dollar. */
const DOLLAR_COUNTRIES = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'EC', 'SV', 'PA', 'TL', 'FM', 'MH', 'PW', 'BQ', 'TC', 'VG', 'IO']);

/**
 * Words that say the figure beside them may not be the price: a starting price,
 * a price with or without tax, a former price. In the languages owners write
 * their lists in; a new one goes here with its reason, never into the parser.
 */
const FROM_OR_VAT = new RegExp([
  String.raw`(?<![A-Za-z])(?:from|starting(?:\s+at|\s+from)?|starts?\s+at|incl\.?|including|excl\.?|excluding|plus|\+\s*VAT|VAT|GST|tax|compare\s+at|was|now|RRP|MSRP)(?![A-Za-z])`,
  '起|含税|不含税|未税|原价|现价|划线价',
  'ابتداء|ابتداءً|يبدأ\\s+من|تبدأ\\s+من|شامل|غير\\s+شامل|الضريبة|السعر\\s+السابق',
  String.raw`(?<![A-Za-z])(?:desde|a\s+partir\s+de|IVA|TTC|HT|dès|ab|antes|ahora|avant)(?![A-Za-z])`,
].join('|'), 'i');

const CURRENCY_SIGN = /[$＄€£¥￥₹₩₽₺₫₪]|(?<![A-Za-z])(?:USD|AED|SAR|BRL|MXN|INR|IDR|RMB|CNY|Rp|Rs)(?![A-Za-z])|美元|元|درهم|ريال/;

/** A price with more than two decimal places, as written. */
const moreThanTwoDecimals = (n: number): boolean => Math.abs(Math.round(n * 100) - n * 100) > 1e-6;

/** The list's median price, over the rows that will be imported; null under three. */
export function medianPrice(rows: readonly ImportRow[]): number | null {
  const prices = rows.filter((r) => !r.removed && r.refused === null && r.price !== null).map((r) => r.price!).sort((a, b) => a - b);
  if (prices.length < 3) return null;
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 ? prices[mid]! : (prices[mid - 1]! + prices[mid]!) / 2;
}

/** Every flag on one row, in the review's order. A refused or removed row carries none. */
export function flagsOf(row: ImportRow, all: readonly ImportRow[], ctx: ReviewContext): readonly ImportFlag[] {
  if (row.refused !== null || row.removed) return [];
  const out = new Set<ImportFlag>();
  if (row.challenge === 'mismatch' || row.reopened) out.add('challenge_mismatch');
  if (row.confidence && lessSure(row.confidence, row).length > 0) out.add('low_confidence');
  if (ownPriceCount(row.line, ctx.currency) >= 2) out.add('two_prices');
  if (FROM_OR_VAT.test(row.line)) out.add('from_or_vat');
  if (ctx.currency === 'USD' && ctx.country !== null && !DOLLAR_COUNTRIES.has(ctx.country)
      && /(?<![A-Za-z])[$＄]\s*\d/.test(row.line) && !/(?<![A-Za-z])US[$＄]|USD/i.test(row.line)) out.add('bare_dollar');
  const median = medianPrice(all);
  if (row.price !== null && median !== null && (row.price < median * 0.1 || row.price > median * 10)) out.add('outlier');
  if (row.price !== null && moreThanTwoDecimals(row.price)) out.add('many_decimals');
  // Phase 9 (V1-334) — a price nothing on the line said was money: its own tick.
  if (row.price !== null && (ctx.kind === 'paste' || ctx.kind === 'photo') && !row.confidence
      && ownPriceCount(row.line, ctx.currency) === 0 && !row.line.includes('\t')) out.add('no_sign');
  // Phase 9 (missed-11) — a line with a figure and no price: the figure was not
  // read as its price. Said as that, not as a name with digits left in it.
  if (row.price === null && figuresOn(row.line).length > 0) out.add('unread_figure');
  else if (/\d/.test(row.name) || CURRENCY_SIGN.test(row.name)) out.add('digits_in_name');
  return FLAG_ORDER.filter((f) => out.has(f));
}

/** Does this row need its own tick before the import can be confirmed? */
export function needsTick(row: ImportRow, all: readonly ImportRow[], ctx: ReviewContext, checkEveryRow: boolean): boolean {
  if (row.refused !== null || row.removed) return false;
  if (checkEveryRow) return true;
  // EXT — a row the extractor read always waits for her own tick.
  if (row.confidence) return true;
  if (ctx.kind === 'photo' && row.price !== null) return true;
  return flagsOf(row, all, ctx).length > 0;
}

/**
 * EXT — a row the extractor may read more closely: one the parser refused, or
 * one it read without a price although the line holds a figure. Never one the
 * extractor already read, never one she removed.
 */
export const extractCandidate = (r: ImportRow): boolean =>
  !r.removed && !r.confidence && (r.refused !== null || (r.price === null && figuresOn(r.line).length > 0));

/** Rows the owner must look at come first; within each, the page's own order. */
export function reviewOrder(rows: readonly ImportRow[], ctx: ReviewContext, checkEveryRow: boolean): readonly ImportRow[] {
  const wants = (r: ImportRow) => (r.challenge === 'ask' || flagsOf(r, rows, ctx).length > 0 || (checkEveryRow && needsTick(r, rows, ctx, true))) ? 0 : 1;
  return rows.map((r, i) => ({ r, i })).sort((a, b) => wants(a.r) - wants(b.r) || a.i - b.i).map((x) => x.r);
}

/** Rows that become (or change) products: not refused, not removed. */
export const liveRows = (rows: readonly ImportRow[]): readonly ImportRow[] => rows.filter((r) => r.refused === null && !r.removed);

/**
 * Rows from what the parser read. Each accepted line is a row; each refused one
 * too, with its reason, so "we read N lines" counts every line the list had.
 * `validate` is the paste rule or the page rule (a photo's line with no price is
 * a heading, not a product to price later).
 */
export function rowsFromParsed(
  parsed: readonly ExtractedProduct[], opts: { photo: number | null; startAt: number; defaultUnit: string; page: boolean },
): ImportRow[] {
  const v = opts.page ? validatePage(parsed) : validateExtracted(parsed);
  const refusedFor = new Map<ExtractedProduct, RejectReason>();
  for (const r of v.rejected) refusedFor.set(r.product, r.reason);
  return parsed.map((p, i): ImportRow => ({
    key: opts.photo === null ? `l${opts.startAt + i}` : `p${opts.photo}-${opts.startAt + i}`,
    line: p.sourceLine ?? p.name,
    photo: opts.photo,
    sku: p.sku,
    name: p.name,
    nameZh: p.nameZh,
    price: p.price?.amount ?? null,
    // RT — the parser writes 'pcs' because it knows no better; the business's own unit replaces it.
    unit: p.unit === 'pcs' ? opts.defaultUnit : p.unit,
    moq: p.moq,
    names: [],
    refused: refusedFor.get(p) ?? null,
    removed: false,
    ticked: false,
    challenge: null,
    reopened: false,
    edited: false,
  }));
}

/** The row as the catalogue diff and the writer take it. */
export const asExtracted = (r: ImportRow, currency: Currency): ExtractedProduct => ({
  sku: r.sku, name: r.name, nameZh: r.nameZh,
  price: r.price === null ? null : { amount: r.price, currency },
  moq: r.moq, unit: r.unit, sourceLine: r.line,
});

/** ── The owner's edits ─────────────────────────────────────────────────────── */

export type RowEdit = {
  readonly name?: string | undefined;
  readonly price?: string | undefined;
  readonly unit?: string | undefined;
  readonly moq?: string | undefined;
  readonly noMinimum?: boolean | undefined;
  readonly names?: string | undefined;
  /** K8 — the options line; empty clears it. */
  readonly options?: string | undefined;
  readonly removed?: boolean | undefined;
  readonly ticked?: boolean | undefined;
};

export type RowEditError = 'name_empty' | 'name_long' | 'price_not_number' | 'price_not_positive' | 'moq_not_whole' | 'unit_empty' | 'names_too_long' | 'names_too_many';

/** A figure as the owner types it into a box: digits, one decimal point or comma. */
export function readTypedFigure(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, '');
  if (s === '') return null;
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.NaN;
}


/** Apply one row's edit. Returns the row as it stands and what was wrong with the edit, if anything. */
export function editRow(row: ImportRow, e: RowEdit): { readonly row: ImportRow; readonly errors: readonly RowEditError[] } {
  const errors: RowEditError[] = [];
  let next: ImportRow = row;
  let edited = row.edited;
  const set = <K extends keyof ImportRow>(k: K, v: ImportRow[K]) => {
    if (JSON.stringify(next[k]) !== JSON.stringify(v)) { next = { ...next, [k]: v }; if (k !== 'ticked' && k !== 'removed') edited = true; }
  };
  if (e.removed !== undefined) set('removed', e.removed);
  if (e.ticked !== undefined) set('ticked', e.ticked);
  if (e.name !== undefined) {
    const n = e.name.replace(/\s+/g, ' ').trim();
    if (n === '') errors.push('name_empty');
    else if (n.length > MAX_ALIAS_LENGTH) errors.push('name_long');
    else {
      set('name', n);
      // A name the owner typed in Chinese is its Chinese name too, as the parser reads it.
      set('nameZh', /[一-鿿]/.test(n) ? n : (row.nameZh === row.name ? null : row.nameZh));
    }
  }
  if (e.price !== undefined) {
    const p = readTypedFigure(e.price);
    if (p === null) set('price', null);
    else if (Number.isNaN(p)) errors.push('price_not_number');
    else if (p <= 0) errors.push('price_not_positive');
    else set('price', p);
  }
  if (e.unit !== undefined) {
    const u = e.unit.replace(/\s+/g, ' ').trim();
    if (u === '') errors.push('unit_empty');
    else set('unit', u.slice(0, 24));
  }
  if (e.noMinimum) set('moq', null);
  else if (e.moq !== undefined) {
    const m = e.moq.trim();
    if (m === '') set('moq', null);
    else if (!/^\d+$/.test(m) || Number(m) < 1) errors.push('moq_not_whole');
    else set('moq', Number(m) === 1 ? null : Number(m));
  }
  if (e.options !== undefined) {
    const o = e.options.replace(/\s+/g, ' ').trim().slice(0, 600);
    if (o === '') { if (next.options !== undefined) { const { options: _gone, ...rest } = next; next = rest; edited = true; } }
    else set('options', o);
  }
  if (e.names !== undefined) {
    // The product page's own rule (T3): one per line or comma, refused whole, never cut.
    const c = parseCustomerNames(e.names);
    if (!c.ok) errors.push(c.error === 'too_long' ? 'names_too_long' : 'names_too_many');
    else set('names', c.names);
  }
  // A row the owner changed is a row to look at again: its tick goes, unless this edit ticked it.
  if (edited && !row.edited && e.ticked === undefined) next = { ...next, ticked: false };
  return { row: { ...next, edited }, errors };
}

/** ── K7: the challenge rows ────────────────────────────────────────────────── */

/**
 * Three rows whose price the owner types from the paper before confirming, the
 * value read staying hidden: the LAST priced row (a skipped row shifts every
 * price after it, so the last one is wrong) and two others at random. `pick` is
 * the caller's randomness — core has none: given n, it returns an index below n.
 */
export function pickChallenge(rows: readonly ImportRow[], pick: (n: number) => number): readonly string[] {
  const priced = liveRows(rows).filter((r) => r.price !== null);
  if (priced.length === 0) return [];
  const last = priced[priced.length - 1]!;
  const rest = priced.slice(0, -1);
  const chosen = [last.key];
  while (chosen.length < 3 && rest.length > 0) {
    const [r] = rest.splice(pick(rest.length), 1);
    chosen.push(r!.key);
  }
  return chosen;
}

/** Two figures are the same price when they agree to the cent. */
const samePrice = (a: number, b: number): boolean => Math.round(a * 100) === Math.round(b * 100);

/**
 * The owner typed what the paper says. A row typed differently from what was
 * read is a mismatch: it and its neighbours on the same photo are opened again,
 * every tick is cleared, and the import becomes "check every row".
 */
export function applyChallenge(
  rows: readonly ImportRow[], typed: ReadonlyMap<string, string>,
): { readonly rows: ImportRow[]; readonly mismatch: boolean; readonly missing: readonly string[] } {
  const missing: string[] = [];
  let mismatch = false;
  const out = rows.map((r) => ({ ...r }));
  const index = new Map(out.map((r, i) => [r.key, i]));
  for (const r of out) {
    if (r.challenge !== 'ask') continue;
    const raw = typed.get(r.key);
    const n = raw === undefined ? null : readTypedFigure(raw);
    if (n === null || Number.isNaN(n)) { missing.push(r.key); continue; }
    if (r.price !== null && samePrice(n, r.price)) (r as { challenge: ChallengeState }).challenge = 'ok';
    else { (r as { challenge: ChallengeState }).challenge = 'mismatch'; mismatch = true; }
  }
  if (mismatch) {
    for (const r of out) (r as { ticked: boolean }).ticked = false;
    for (const r of out) {
      if (r.challenge !== 'mismatch') continue;
      const i = index.get(r.key)!;
      for (const j of [i - 1, i + 1]) {
        const n = out[j];
        if (n && n.photo === r.photo && n.refused === null) (n as { reopened: boolean }).reopened = true;
      }
    }
  }
  return { rows: out, mismatch, missing };
}

/** ── K2: the discount question ─────────────────────────────────────────────── */

/**
 * The lowest price a discount leaves: list × (1 − discount), rounded UP to the
 * cent, so the floor never allows more off than the owner said. A derived floor
 * cannot catch a price misread too low — the plan says so, and the owner is
 * told on the floors page.
 */
export function derivedFloor(list: number, discountPct: number): number {
  return Math.ceil(list * (100 - discountPct) - 1e-7) / 100;
}

/** A discount as the owner types it: a whole or decimal percentage, 0 up to (not including) 100. */
export function readDiscount(raw: string): number | null | 'invalid' {
  const s = raw.trim().replace(/%$/, '').trim();
  if (s === '') return null;
  const n = readTypedFigure(s);
  if (n === null) return null;
  if (Number.isNaN(n) || n < 0 || n >= 100) return 'invalid';
  return Math.round(n * 100) / 100;
}

/** ── Ready to confirm? ─────────────────────────────────────────────────────── */

export type Blocker =
  | { readonly kind: 'untick'; readonly keys: readonly string[] }
  | { readonly kind: 'challenge'; readonly keys: readonly string[] }
  | { readonly kind: 'nothing' };

/** What still stands between the review and the confirm, in the order the owner meets it. */
export function blockers(rows: readonly ImportRow[], ctx: ReviewContext, checkEveryRow: boolean): readonly Blocker[] {
  const out: Blocker[] = [];
  if (liveRows(rows).length === 0) return [{ kind: 'nothing' }];
  const asked = rows.filter((r) => r.challenge === 'ask' && r.refused === null && !r.removed).map((r) => r.key);
  if (asked.length > 0) out.push({ kind: 'challenge', keys: asked });
  const unticked = rows.filter((r) => needsTick(r, rows, ctx, checkEveryRow) && !r.ticked).map((r) => r.key);
  if (unticked.length > 0) out.push({ kind: 'untick', keys: unticked });
  return out;
}

/** "We read N lines" — every line the list had, refused ones included. */
export const linesRead = (rows: readonly ImportRow[]): number => rows.length;
