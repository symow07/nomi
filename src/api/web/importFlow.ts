import { sql } from 'kysely';
import { randomInt } from 'node:crypto';
import { withTenantTx, type Db, type Tx } from '../../db/client.js';
import { parseBusinessId, type BusinessId } from '../../core/types/ids.js';
import { type Currency } from '../../core/types/money.js';
import { parsePriceLines, type ExtractedProduct } from '../../core/onboard/catalogImport.js';
import { diffAgainstCatalogue, type CatalogueDiff, type CatalogueEntry } from '../../core/onboard/catalogDiff.js';
import {
  type ImportRow, type ImportKind, type ReviewContext, type RowEdit, type RowEditError, type Blocker, type ImportFlag,
  rowsFromParsed, asExtracted, liveRows, flagsOf, needsTick, reviewOrder, editRow, pickChallenge, applyChallenge,
  derivedFloor, readDiscount, blockers, linesRead,
} from '../../core/onboard/importReview.js';
import { defaultUnitFor } from '../../core/owner/sellingStyle.js';
import { currencyOfCountry } from '../../core/owner/currencies.js';
import { canonicalCountry } from '../../core/owner/business.js';
import { currencyOf } from '../../db/currency.js';
import {
  type StoredImport, createImport, addImportPhoto, loadImport, saveImport, saveTranscript, dropImport, markConfirmed, photoIds,
  latestOpenImport, loadImportPhoto,
} from '../../db/catalogImports.js';
import type { PageTranscriber } from '../../llm/ports.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, tn, assistantName } from './say.js';
import { esc, back } from './layout.js';
import { flashBanner, type Flash, type FlashPart } from './flash.js';
import { catalogueForTx, importFlash, writeImportRows, unitLabel, type ImportResult } from './products.js';
import { currencySymbol } from '../../core/types/money.js';
import * as show from './values.js';

/**
 * K1 — THE IMPORT REVIEW (the onboarding plan, Stage 2; 0094).
 *
 * A list the owner pastes or photographs becomes an import that is KEPT until
 * she confirms it: every row stays as she left it between visits, the photos
 * stay beside the rows, and the confirm writes the rows as they stand. The
 * pure rules — flags, ticks, the challenge rows, the derived floors — are in
 * core/onboard/importReview.ts; this is their storage, their routes' work and
 * their pages.
 *
 * THE FLOW. Add (paste, or photos with "printed or handwritten?") → the review
 * (rows, flags, ticks, three challenge rows on a photo, the discount question)
 * → when she gave a discount, the floors (each new product's lowest price, a
 * tick each) → added. Every step is a form that works without a script.
 */

/** RT — what a price can be per, as a unit code; the owner's own word is kept as she typed it. */
export const IMPORT_UNITS = ['item', 'pcs', 'pair', 'set', 'pack', 'box', 'carton', 'dozen', 'bottle', 'kg', 'g', 'm', 'l', 'ml'] as const;

/** At most this many photos in one import: a longer list comes from its spreadsheet or its store. */
export const MAX_PHOTOS = 10;

async function contextFor(tx: Tx, bid: BusinessId, kind: ImportKind, currency: Currency): Promise<ReviewContext> {
  const b = (await sql<{ kind: string | null; country: string | null }>`
    select kind, country from businesses where id = ${bid}`.execute(tx)).rows[0];
  const country = b?.country ? canonicalCountry(b.country.trim().toUpperCase()) : null;
  return { kind, currency, country, countryCurrency: currencyOfCountry(country), defaultUnit: defaultUnitFor(b?.kind) };
}

/** K7 — the challenge, picked with real randomness here (core has none). */
const pick = (n: number): number => randomInt(n);

/**
 * K7 — the challenge is asked of rows the list ADDS or CHANGES: a row that
 * agrees with her catalogue, or one the review holds back, is written nowhere,
 * and the review draws no box for it.
 */
function withChallenge(rows: readonly ImportRow[], idle: ReadonlySet<string>): ImportRow[] {
  const keys = new Set(pickChallenge(rows.filter((r) => !idle.has(r.key)), pick));
  return rows.map((r) => (keys.has(r.key) ? { ...r, challenge: 'ask' as const } : r));
}

/** Rows that agree with her catalogue or are held back: nothing of theirs is written. */
async function idleRows(tx: Tx, bid: BusinessId, rows: readonly ImportRow[], currency: Currency): Promise<ReadonlySet<string>> {
  const keyOf = new Map<ExtractedProduct, string>();
  const lines = liveRows(rows).map((r) => { const e = asExtracted(r, currency); keyOf.set(e, r.key); return e; });
  const diff = diffAgainstCatalogue(lines, await catalogueForTx(tx, bid));
  return new Set([...diff.unchanged.map((u) => keyOf.get(u.line)!), ...diff.held.map((h) => keyOf.get(h.line)!)]);
}

/**
 * K7 — a challenge row the owner removed is no longer asked; another takes its
 * place, so three rows are always typed from the paper while the list has three.
 */
function topUpChallenge(rows: readonly ImportRow[], idle: ReadonlySet<string>): ImportRow[] {
  let out = rows.map((r) => (r.challenge === 'ask' && (r.removed || r.refused !== null || idle.has(r.key)) ? { ...r, challenge: null } : r));
  const live = liveRows(out).filter((r) => r.price !== null && !idle.has(r.key));
  const asked = live.filter((r) => r.challenge !== null).length;
  const want = Math.min(3, live.length) - asked;
  if (want <= 0) return out;
  const free = out.filter((r) => r.challenge === null && r.refused === null && !r.removed && r.price !== null && !idle.has(r.key));
  const chosen = new Set(pickChallenge(free, pick).slice(0, want));
  out = out.map((r) => (chosen.has(r.key) ? { ...r, challenge: 'ask' as const } : r));
  return out;
}

/** ── Starting an import ───────────────────────────────────────────────────── */

export async function startPasteImport(db: Db, businessIdRaw: string, actor: string, text: string): Promise<string | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const currency = await currencyOf(tx, bid.value);
    const ctx = await contextFor(tx, bid.value, 'paste', currency);
    const rows = rowsFromParsed(parsePriceLines(text, currency), { photo: null, startAt: 1, defaultUnit: ctx.defaultUnit, page: false });
    return createImport(tx, bid.value, { kind: 'paste', currency, sourceText: text, rows, createdBy: actor });
  });
}

export type PhotoIn = { readonly bytes: Buffer; readonly mediaType: 'image/jpeg' | 'image/png' | 'image/webp' };

/** Why photos came to nothing; `photo` names which one, when one is to blame. */
export type PhotosRefused = {
  readonly reason: 'not_configured' | 'unreadable' | 'no_lines' | 'cut_off' | 'handwritten' | 'hand_unanswered' | 'too_many';
  readonly photo?: number;
};

/**
 * Photos → an import. Each is read to text (M37: vision DESCRIBES, the parser
 * EXTRACTS), in order. REFUSED IS WHOLE: one photo that cannot be read, or was
 * cut off, and nothing is added — the owner could not tell which half of her
 * list is missing. A handwritten list is refused before any photo is read
 * (decision 10: until the measurement shows handwriting can be read, a misread
 * digit would become a price).
 */
export async function startPhotoImport(
  db: Db, businessIdRaw: string, actor: string,
  deps: {
    readonly transcriber?: PageTranscriber | undefined;
    readonly spent?: ((u: { llmCalls: number; inputTokens: number; outputTokens: number }) => Promise<void>) | undefined;
  },
  input: { readonly hand: string | null; readonly photos: readonly PhotoIn[] },
): Promise<{ readonly ok: true; readonly id: string } | ({ readonly ok: false } & PhotosRefused)> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { ok: false, reason: 'unreadable' };
  if (input.hand === 'handwritten') return { ok: false, reason: 'handwritten' };
  if (input.hand !== 'printed') return { ok: false, reason: 'hand_unanswered' };
  if (input.photos.length > MAX_PHOTOS) return { ok: false, reason: 'too_many' };
  const currency = await withTenantTx(db, bid.value, (tx) => currencyOf(tx, bid.value));
  const unit = await withTenantTx(db, bid.value, async (tx) => (await contextFor(tx, bid.value, 'photo', currency)).defaultUnit);
  const read = await readPhotos(deps, input.photos, currency, unit);
  if (!read.ok) return read;
  return withTenantTx(db, bid.value, async (tx) => {
    const rows = withChallenge(read.rows, await idleRows(tx, bid.value, read.rows, currency));
    const id = await createImport(tx, bid.value, { kind: 'photo', currency, sourceText: null, rows, createdBy: actor });
    for (const [i, text] of read.transcripts.entries()) {
      await addImportPhoto(tx, bid.value, id, { position: i + 1, mediaType: input.photos[i]!.mediaType, bytes: input.photos[i]!.bytes, transcript: text });
    }
    return { ok: true as const, id };
  });
}

/**
 * M37 — VISION DESCRIBES; THE PARSER EXTRACTS. Each photo is read to TEXT, in
 * order; `parsePriceLines` — deterministic, no model — turns the text into
 * rows. So a price the reader invented cannot become a row unless it also
 * appears as a line, and the line travels with the row to the review.
 *
 * REFUSED IS WHOLE: one photo that cannot be read, or whose read stopped before
 * the page did (T5), and nothing comes of any of them. Text with no product on
 * any page is refused too, never an empty review she would read as "my
 * products vanished". No I/O but the reader and the ledger.
 */
export async function readPhotos(
  deps: {
    readonly transcriber?: PageTranscriber | undefined;
    readonly spent?: ((u: { llmCalls: number; inputTokens: number; outputTokens: number }) => Promise<void>) | undefined;
  },
  photos: readonly PhotoIn[], currency: Currency, defaultUnit: string,
): Promise<{ readonly ok: true; readonly rows: ImportRow[]; readonly transcripts: readonly string[] } | ({ readonly ok: false } & PhotosRefused)> {
  // Absent is a legitimate state: she is told the truth rather than shown an
  // empty result she would read as "nothing on the page".
  if (!deps.transcriber) return { ok: false, reason: 'not_configured' };
  const transcripts: string[] = [];
  let rows: ImportRow[] = [];
  for (const [i, photo] of photos.entries()) {
    const page = await deps.transcriber.transcribe({ imageBase64: photo.bytes.toString('base64'), mediaType: photo.mediaType });
    // T7 — what reading the page cost is on the ledger, a refused read too.
    await deps.spent?.({ llmCalls: 1, inputTokens: page.usage?.inputTokens ?? 0, outputTokens: page.usage?.outputTokens ?? 0 });
    if (page.cutOff) return { ok: false, reason: 'cut_off', photo: i + 1 };
    if (page.unreadable || !page.text.trim()) return { ok: false, reason: 'unreadable', photo: i + 1 };
    transcripts.push(page.text);
    // The PAGE rule, not the paste rule: a photograph carries the letterhead
    // and the headings too, and a priceless line there is not a product.
    rows = rows.concat(rowsFromParsed(parsePriceLines(page.text, currency), { photo: i + 1, startAt: 1, defaultUnit, page: true }));
  }
  if (liveRows(rows).length === 0) return { ok: false, reason: 'no_lines' };
  return { ok: true, rows, transcripts };
}

/** ── The review's model ───────────────────────────────────────────────────── */

export type ReviewModel = {
  readonly imp: StoredImport;
  readonly ctx: ReviewContext;
  readonly diff: CatalogueDiff;
  /** Which row each line of the diff came from. */
  readonly keyOf: ReadonlyMap<ExtractedProduct, string>;
  /** Rows that name a product she already has: their confirm is the change's own tick, or nothing to do. */
  readonly matched: ReadonlySet<string>;
  /** The workspace's currency now; the import cannot be added in another. */
  readonly currencyNow: Currency;
};

/** The review's model from what is stored and what she sells — pure, so a page can be drawn without a database. */
export function buildModel(imp: StoredImport, ctx: ReviewContext, catalogue: readonly CatalogueEntry[], currencyNow: Currency): ReviewModel {
  const keyOf = new Map<ExtractedProduct, string>();
  const lines = liveRows(imp.rows).map((r) => { const e = asExtracted(r, imp.currency); keyOf.set(e, r.key); return e; });
  const diff = diffAgainstCatalogue(lines, catalogue);
  const matched = new Set<string>([
    ...diff.changed.map((c) => keyOf.get(c.line)!), ...diff.unchanged.map((u) => keyOf.get(u.line)!), ...diff.held.map((h) => keyOf.get(h.line)!),
  ]);
  return { imp, ctx, diff, keyOf, matched, currencyNow };
}

async function modelIn(tx: Tx, bid: BusinessId, imp: StoredImport): Promise<ReviewModel> {
  return buildModel(imp, await contextFor(tx, bid, imp.kind, imp.currency), await catalogueForTx(tx, bid), await currencyOf(tx, bid));
}

export async function loadReviewModel(db: Db, businessIdRaw: string, id: string): Promise<ReviewModel | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const imp = await loadImport(tx, bid.value, id);
    return imp ? modelIn(tx, bid.value, imp) : null;
  });
}

/** The blockers of the model: only NEW rows need their own tick; a change's tick is its apply box. */
export function modelBlockers(m: ReviewModel): readonly Blocker[] {
  const newOnly = m.imp.rows.map((r) => (m.matched.has(r.key) ? { ...r, ticked: true } : r));
  return blockers(newOnly, m.ctx, m.imp.checkEveryRow);
}

/** ── Saving the review ────────────────────────────────────────────────────── */

type Body = Readonly<Record<string, string | undefined>>;
const keysIn = (b: Body, field: string): readonly string[] => (b[field] ?? '').split(',').map((k) => k.trim()).filter(Boolean);

export type SaveOutcome =
  | { readonly kind: 'review'; readonly errors: ReadonlyMap<string, readonly RowEditError[]>; readonly discountError: boolean; readonly blockers: readonly Blocker[]; readonly typed: Body }
  | { readonly kind: 'saved' }
  | { readonly kind: 'floors' }
  | { readonly kind: 'added'; readonly result: ImportResult & { readonly floors: number } }
  | { readonly kind: 'gone' }
  | { readonly kind: 'currency_changed'; readonly was: Currency; readonly now: Currency };

/** The row edits the review form posted, for the rows it drew. */
function editsFrom(b: Body, rows: readonly ImportRow[]): ReadonlyMap<string, RowEdit> {
  const drawn = new Set(keysIn(b, 'rows'));
  const ticks = new Set(keysIn(b, 'ticks'));
  const out = new Map<string, RowEdit>();
  for (const r of rows) {
    if (!drawn.has(r.key)) continue;
    const f = (name: string) => b[`${name}:${r.key}`];
    out.set(r.key, {
      name: f('name'), price: f('price'), unit: f('unit'), moq: f('moq'), names: f('names'),
      noMinimum: f('moq') !== undefined ? f('nomin') === 'on' : undefined,
      removed: f('remove') === 'on',
      ticked: ticks.has(r.key) ? f('tick') === 'on' : undefined,
    });
  }
  return out;
}

/**
 * The owner pressed "Save" or "Add these products" on the review. Her edits
 * are kept whatever else happens; then, on "Add", what still stands between the
 * review and the confirm is said, or the list goes on to its floors, or it is
 * added.
 */
export async function saveReview(db: Db, businessIdRaw: string, id: string, actor: string, b: Body): Promise<SaveOutcome> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { kind: 'gone' };
  return withTenantTx(db, bid.value, async (tx) => {
    const imp = await loadImport(tx, bid.value, id, { forUpdate: true });
    if (!imp || imp.state !== 'open') return { kind: 'gone' as const };
    const edits = editsFrom(b, imp.rows);
    const errors = new Map<string, readonly RowEditError[]>();
    let rows: ImportRow[] = imp.rows.map((r) => {
      const e = edits.get(r.key);
      if (!e) return r;
      const out = editRow(r, e);
      if (out.errors.length) errors.set(r.key, out.errors);
      return out.row;
    });
    // G16 — each change to a product she has is its own tick, `apply:<row>`.
    const applies = new Set(keysIn(b, 'applies'));
    rows = rows.map((r) => (applies.has(r.key) ? { ...r, apply: b[`apply:${r.key}`] === 'on' } : r));
    // K7 — what she typed from the paper.
    const typed = new Map<string, string>();
    for (const r of rows) { const v = b[`typed:${r.key}`]; if (r.challenge === 'ask' && v !== undefined && v.trim() !== '') typed.set(r.key, v); }
    let checkEveryRow = imp.checkEveryRow;
    if (typed.size > 0) {
      const c = applyChallenge(rows, typed);
      rows = c.rows.map((r) => (r.challenge === 'ok' && typed.has(r.key) ? { ...r, ticked: true } : r));
      if (c.mismatch) checkEveryRow = true;
    }
    rows = imp.kind === 'photo' ? topUpChallenge(rows, await idleRows(tx, bid.value, rows, imp.currency)) : rows;
    const d = b['discount'] === undefined ? undefined : readDiscount(b['discount']);
    const discountError = d === 'invalid';
    await saveImport(tx, bid.value, id, {
      rows, checkEveryRow, ...(d === undefined || d === 'invalid' ? {} : { discountPct: d }),
    });
    const saved = { ...imp, rows, checkEveryRow, discountPct: d === undefined || d === 'invalid' ? imp.discountPct : d };
    const m = await modelIn(tx, bid.value, saved);
    const stops = modelBlockers(m);
    if (b['next'] !== 'add' || errors.size > 0 || discountError || stops.length > 0) {
      return b['next'] === 'add' || errors.size > 0 || discountError
        ? { kind: 'review' as const, errors, discountError, blockers: b['next'] === 'add' ? stops : [], typed: b }
        : { kind: 'saved' as const };
    }
    if (m.currencyNow !== imp.currency) return { kind: 'currency_changed' as const, was: imp.currency, now: m.currencyNow };
    // K2 — a discount given, and new products with a price: their floors come first.
    if (saved.discountPct !== null && m.diff.added.some((p) => p.price !== null)) return { kind: 'floors' as const };
    return { kind: 'added' as const, result: await confirmIn(tx, bid.value, m, actor, null) };
  });
}

/** The floors page's confirm: each floor she ticked is written with its product. */
export async function confirmWithFloors(db: Db, businessIdRaw: string, id: string, actor: string, b: Body): Promise<SaveOutcome> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { kind: 'gone' };
  return withTenantTx(db, bid.value, async (tx) => {
    const imp = await loadImport(tx, bid.value, id, { forUpdate: true });
    if (!imp || imp.state !== 'open') return { kind: 'gone' as const };
    const m = await modelIn(tx, bid.value, imp);
    // Nothing that stood in the way of the review may be skipped by posting here.
    const stops = modelBlockers(m);
    if (stops.length > 0) return { kind: 'review' as const, errors: new Map(), discountError: false, blockers: stops, typed: {} };
    if (m.currencyNow !== imp.currency) return { kind: 'currency_changed' as const, was: imp.currency, now: m.currencyNow };
    const ticked = new Set(Object.keys(b).filter((k) => k.startsWith('floor:') && b[k] === 'on').map((k) => k.slice('floor:'.length)));
    return { kind: 'added' as const, result: await confirmIn(tx, bid.value, m, actor, ticked) };
  });
}

/** The rows written, the import marked added, the audit row for the whole list. */
async function confirmIn(tx: Tx, bid: BusinessId, m: ReviewModel, actor: string, floorTicks: ReadonlySet<string> | null): Promise<ImportResult & { readonly floors: number }> {
  const byRow = new Map<string, number>();
  if (floorTicks && m.imp.discountPct !== null) {
    for (const p of m.diff.added) {
      const key = m.keyOf.get(p)!;
      if (p.price !== null && floorTicks.has(key)) byRow.set(key, derivedFloor(p.price.amount, m.imp.discountPct));
    }
  }
  // G16 — the changes she ticked, by the rows she ticked them on. A change the
  // review showed and her floor now holds back (raised since) is still one she
  // asked for: the writer refuses it and she is told, never "left as it was".
  const ticked = (line: ExtractedProduct) => m.imp.rows.find((r) => r.key === m.keyOf.get(line))?.apply === true;
  const apply = new Set([
    ...m.diff.changed.filter((c) => ticked(c.line)).map((c) => c.product.id),
    ...m.diff.held.filter((h) => h.product && ticked(h.line)).map((h) => h.product!.id),
  ]);
  const out = await writeImportRows(tx, bid, m.imp.rows, m.imp.currency, { actor, apply },
    { importId: m.imp.id, photoIds: await photoIds(tx, bid, m.imp.id) },
    floorTicks && m.imp.discountPct !== null ? { byRow, discountPct: m.imp.discountPct } : null);
  await markConfirmed(tx, bid, m.imp.id, out.rows, actor);
  await sql`
    insert into channel_audit (business_id, channel_id, action, actor, detail)
    values (${bid}, null, 'import_confirmed', ${actor}, ${JSON.stringify({
      importId: m.imp.id, kind: m.imp.kind, lines: linesRead(m.imp.rows),
      removed: m.imp.rows.filter((r) => r.removed).length, edited: m.imp.rows.filter((r) => r.edited).length,
      checkEveryRow: m.imp.checkEveryRow, discountPct: m.imp.discountPct, ...out.result,
    })}::jsonb)`.execute(tx);
  return out.result;
}

/** A photo's corrected text, or a paste's new text, read again: that photo's rows (or all) are replaced. */
export async function rereadImport(db: Db, businessIdRaw: string, id: string, b: Body): Promise<'ok' | 'gone'> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return 'gone';
  return withTenantTx(db, bid.value, async (tx) => {
    const imp = await loadImport(tx, bid.value, id, { forUpdate: true });
    if (!imp || imp.state !== 'open') return 'gone';
    const ctx = await contextFor(tx, bid.value, imp.kind, imp.currency);
    const text = String(b['text'] ?? '');
    let rows: ImportRow[];
    if (imp.kind === 'photo') {
      const n = Number(b['photo']);
      if (!imp.photos.some((p) => p.position === n)) return 'gone';
      await saveTranscript(tx, bid.value, id, n, text);
      const fresh = rowsFromParsed(parsePriceLines(text, imp.currency), { photo: n, startAt: 1, defaultUnit: ctx.defaultUnit, page: true });
      const before = imp.rows.filter((r) => r.photo !== null && r.photo < n);
      const after = imp.rows.filter((r) => r.photo !== null && r.photo > n);
      rows = [...before, ...fresh, ...after];
      rows = topUpChallenge(rows, await idleRows(tx, bid.value, rows, imp.currency));
    } else {
      await sql`update catalog_imports set source_text = ${text} where business_id = ${bid.value} and id = ${id}::uuid`.execute(tx);
      rows = rowsFromParsed(parsePriceLines(text, imp.currency), { photo: null, startAt: 1, defaultUnit: ctx.defaultUnit, page: false });
    }
    await saveImport(tx, bid.value, id, { rows });
    return 'ok';
  });
}

export async function dropStagedImport(db: Db, businessIdRaw: string, id: string): Promise<boolean> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return false;
  return withTenantTx(db, bid.value, (tx) => dropImport(tx, bid.value, id));
}

/** The notice the products list shows after an import: what was added, and the floors. */
export const stagedFlash = (r: ImportResult & { readonly floors: number }): readonly FlashPart[] => [
  ...importFlash(r),
  ...(r.floors > 0 ? [{ key: 'import.flash.floorsSet', params: { n: r.floors } } as FlashPart] : []),
];

/** The newest open import, for the add page. */
export async function openImportOf(db: Db, businessIdRaw: string): Promise<{ id: string; createdAt: Date; lines: number } | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, (tx) => latestOpenImport(tx, bid.value));
}

/** A photo of an import, this business's only. */
export async function importPhoto(db: Db, businessIdRaw: string, id: string, n: number): Promise<{ mediaType: string; bytes: Buffer } | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, (tx) => loadImportPhoto(tx, bid.value, id, n));
}

export const notFoundImport = (locale: Locale): string =>
  `<h1 class="page">${esc(t(locale, 'import.title'))}</h1>
    <div class="block"><p>${esc(t(locale, 'import.gone'))}</p>${back('/app/products/add', t(locale, 'product.detail.back'))}</div>`;

/** ── Pages ────────────────────────────────────────────────────────────────── */

const base = (id: string): string => `/app/products/import/${encodeURIComponent(id)}`;

const unitOptions = (locale: Locale, current: string): string => {
  const codes: string[] = [...IMPORT_UNITS];
  if (!codes.includes(current)) codes.unshift(current);
  return codes.map((u) => `<option value="${esc(u)}"${u === current ? ' selected' : ''}>${esc(unitLabel(locale, u))}</option>`).join('');
};

const flagLine = (locale: Locale, f: ImportFlag): string =>
  `<span class="imp-warn">${esc(t(locale, `import.flag.${f}` as MessageKey))}</span>`;

function rowHtml(locale: Locale, m: ReviewModel, r: ImportRow, errors: readonly RowEditError[], typed: Body): string {
  const flags = flagsOf(r, m.imp.rows, m.ctx);
  const tickNeeded = !m.matched.has(r.key) && needsTick(r, m.imp.rows, m.ctx, m.imp.checkEveryRow);
  const asking = r.challenge === 'ask';
  const price = r.price === null ? t(locale, 'import.row.noPrice') : show.money(locale, { amount: r.price, currency: m.imp.currency });
  const minimum = r.moq === null ? t(locale, 'product.noMinimum') : t(locale, 'product.review.moqSuffix', { qty: show.quantity(locale, r.moq) });
  const v = (field: string, fallback: string): string => typed[`${field}:${r.key}`] ?? fallback;
  const err = errors.length ? `<p class="perr" role="alert">${errors.map((e) => esc(t(locale, `import.error.${e}` as MessageKey))).join(' ')}</p>` : '';
  const open = flags.length > 0 || errors.length > 0 || r.reopened || (m.imp.checkEveryRow && !r.ticked);
  // K7 — a challenge row keeps what was read hidden: its price, its line, its price box.
  const summary = asking
    ? `<b dir="auto">${esc(r.name)}</b> <span class="muted">${esc(t(locale, 'import.row.challengeHidden'))}</span>`
    : `<b dir="auto">${esc(r.name)}</b> <span class="muted">${price} · ${esc(unitLabel(locale, r.unit))} · ${esc(minimum)}</span>`;
  return `
    <div class="imp-row${open ? ' need' : ''}${r.removed ? ' out' : ''}" id="row-${esc(r.key)}">
      <div class="imp-h">
        ${tickNeeded && !asking ? `<label class="pcheck"><input type="checkbox" name="tick:${esc(r.key)}"${r.ticked ? ' checked' : ''} /> ${esc(t(locale, 'import.row.checked'))}</label>` : ''}
        ${summary}
        ${r.removed ? `<span class="pill">${esc(t(locale, 'import.row.removed'))}</span>` : ''}
      </div>
      ${flags.map((f) => flagLine(locale, f)).join('')}
      ${asking ? `<label class="imp-typed">${esc(t(locale, 'import.row.challenge'))}
        <input type="text" inputmode="decimal" name="typed:${esc(r.key)}" value="${esc(v('typed', ''))}" autocomplete="off" /> <span class="muted">${esc(m.imp.currency)}</span></label>` : ''}
      ${r.challenge === 'ok' ? `<span class="muted">${esc(t(locale, 'import.row.challengeOk'))}</span>` : ''}
      ${err}
      <details class="imp-edit"${open ? ' open' : ''}><summary>${esc(t(locale, 'import.row.change'))}</summary>
        <label>${esc(t(locale, 'import.row.name'))} <input type="text" name="name:${esc(r.key)}" value="${esc(v('name', r.name))}" dir="auto" maxlength="120" /></label>
        ${asking ? '' : `<label>${esc(t(locale, 'import.row.price', { currency: m.imp.currency }))} <input type="text" inputmode="decimal" name="price:${esc(r.key)}" value="${esc(v('price', r.price === null ? '' : String(r.price)))}" /></label>`}
        <label>${esc(t(locale, 'import.row.unit'))} <select name="unit:${esc(r.key)}">${unitOptions(locale, r.unit)}</select></label>
        <label>${esc(t(locale, 'import.row.moq'))} <input type="text" inputmode="numeric" name="moq:${esc(r.key)}" value="${esc(v('moq', r.moq === null ? '' : String(r.moq)))}" /></label>
        <label class="pcheck"><input type="checkbox" name="nomin:${esc(r.key)}"${r.moq === null ? ' checked' : ''} /> ${esc(t(locale, 'product.noMinimum'))}</label>
        <label>${esc(t(locale, 'import.row.names'))} <input type="text" name="names:${esc(r.key)}" value="${esc(v('names', r.names.join(', ')))}" dir="auto" /></label>
        <span class="muted small">${esc(t(locale, 'import.row.namesHint'))}</span>
        <label class="pcheck"><input type="checkbox" name="remove:${esc(r.key)}"${r.removed ? ' checked' : ''} /> ${esc(t(locale, 'import.row.remove'))}</label>
      </details>
      ${asking ? '' : `<span class="rev-src muted">${esc(t(locale, 'product.review.fromLine'))} <bdi>${esc(r.line)}</bdi></span>`}
    </div>`;
}

function blockerLine(locale: Locale, b: Blocker): string {
  if (b.kind === 'nothing') return esc(t(locale, 'import.blocker.nothing'));
  return esc(tn(locale, b.kind === 'untick' ? 'import.blocker.untick' : 'import.blocker.challenge', b.keys.length, { n: show.count(locale, b.keys.length) }));
}

export function renderImportReview(
  m: ReviewModel, locale: Locale,
  opts: { readonly errors?: ReadonlyMap<string, readonly RowEditError[]>; readonly blockers?: readonly Blocker[];
          readonly discountError?: boolean; readonly typed?: Body; readonly flash?: Flash | null } = {},
): string {
  const { imp } = m;
  if (imp.state !== 'open') {
    return `<h1 class="page">${esc(t(locale, 'import.title'))}</h1>
      <div class="block"><p>${esc(t(locale, 'import.gone'))}</p>${back('/app/products', t(locale, 'product.detail.back'))}</div>`;
  }
  const errors = opts.errors ?? new Map<string, readonly RowEditError[]>();
  const typed = opts.typed ?? {};
  const rowsByKey = new Map(imp.rows.map((r) => [r.key, r]));
  const keyOfLine = (l: ExtractedProduct) => m.keyOf.get(l)!;
  const changed = new Set(m.diff.changed.map((c) => keyOfLine(c.line)));
  const unchanged = new Set(m.diff.unchanged.map((u) => keyOfLine(u.line)));
  const held = new Map(m.diff.held.map((h) => [keyOfLine(h.line), h]));
  const ordered = reviewOrder(imp.rows, m.ctx, imp.checkEveryRow);
  const newRows = ordered.filter((r) => r.refused === null && !changed.has(r.key) && !unchanged.has(r.key) && !held.has(r.key));
  const need = newRows.filter((r) => !r.removed && (r.challenge === 'ask' || flagsOf(r, imp.rows, m.ctx).length > 0 || r.reopened)).length;
  const refused = imp.rows.filter((r) => r.refused !== null);
  const money = (n: number | null): string => n === null ? t(locale, 'product.list.priceTbd') : show.money(locale, { amount: n, currency: imp.currency });

  const changes = m.diff.changed.map((c) => {
    const key = keyOfLine(c.line);
    const r = rowsByKey.get(key)!;
    const moves = [
      c.price ? t(locale, 'product.review.change.price', { from: money(c.price.from), to: money(c.price.to) }) : null,
      c.moq ? t(locale, 'product.review.change.moq', {
        from: c.moq.from === null ? t(locale, 'product.noMinimum') : show.quantity(locale, c.moq.from), to: show.quantity(locale, c.moq.to) }) : null,
    ].filter((x): x is string => x !== null).map((x) => `<span class="rev-move">${esc(x)}</span>`).join('');
    // G16 — on by default: the page is what she wants her catalogue to say.
    const on = r.apply !== false;
    // K7 — a change whose row is a challenge row keeps the price read hidden too.
    if (r.challenge === 'ask') {
      return `<div class="rev chg"><label class="pcheck"><input type="checkbox" name="apply:${esc(key)}"${on ? ' checked' : ''} /> <b dir="auto">${esc(c.product.name)}</b></label>
        <label class="imp-typed">${esc(t(locale, 'import.row.challenge'))}
          <input type="text" inputmode="decimal" name="typed:${esc(key)}" value="${esc(typed[`typed:${key}`] ?? '')}" autocomplete="off" /> <span class="muted">${esc(imp.currency)}</span></label></div>`;
    }
    return `<label class="rev chg"><input type="checkbox" name="apply:${esc(key)}"${on ? ' checked' : ''} /> <b dir="auto">${esc(c.product.name)}</b>${moves}
      <span class="rev-src muted">${esc(t(locale, 'product.review.fromLine'))} <bdi>${esc(r.line)}</bdi></span></label>`;
  }).join('');
  // K7 — while a challenge row is asked, what was read stays hidden: the text
  // read from a photo carries every price on it.
  const asking = imp.rows.some((r) => r.challenge === 'ask' && !r.removed && r.refused === null);
  const photos = imp.photos.map((p) => `
    <figure class="imp-photo">
      <img src="${base(imp.id)}/photo/${p.position}" alt="${esc(t(locale, 'import.photoAlt', { n: p.position }))}" loading="lazy" />
      <figcaption>${esc(t(locale, 'import.photoLabel', { n: p.position }))}</figcaption>
      ${asking ? `<p class="muted small">${esc(t(locale, 'import.transcriptLater'))}</p>` : `<details><summary>${esc(t(locale, 'import.transcript'))}</summary>
        <form method="post" action="${base(imp.id)}/reread">
          <input type="hidden" name="photo" value="${p.position}" />
          <textarea name="text" rows="8" dir="auto">${esc(p.transcript)}</textarea>
          <p class="muted small">${esc(t(locale, 'import.transcriptHint'))}</p>
          <button class="btn" type="submit">${esc(t(locale, 'import.reread'))}</button>
        </form>
      </details>`}
    </figure>`).join('');
  const paste = imp.kind === 'paste' ? `
    <details class="block"><summary>${esc(t(locale, 'import.pasteText'))}</summary>
      <form method="post" action="${base(imp.id)}/reread">
        <textarea name="text" rows="8" dir="auto">${esc(imp.sourceText ?? '')}</textarea>
        <p class="muted small">${esc(t(locale, 'import.pasteHint'))}</p>
        <button class="btn" type="submit">${esc(t(locale, 'import.reread'))}</button>
      </form>
    </details>` : '';
  const drawn = [...newRows.map((r) => r.key)];
  const ticks = newRows.filter((r) => needsTick(r, imp.rows, m.ctx, imp.checkEveryRow) && r.challenge !== 'ask').map((r) => r.key);
  const stops = opts.blockers ?? [];
  // G16 — a list that changes nothing she has and adds nothing offers nothing to confirm, and says so.
  const offered = newRows.length + m.diff.changed.length;
  const discount = typed['discount'] ?? (imp.discountPct === null ? '' : String(imp.discountPct));

  return `<h1 class="page">${esc(t(locale, 'import.title'))}</h1>
    ${flashBanner(opts.flash ?? null)}
    <div class="block">
      <p><b>${esc(tn(locale, 'import.count', linesRead(imp.rows), { n: show.count(locale, linesRead(imp.rows)) }))}</b> ${esc(t(locale, 'import.countYours'))}</p>
      ${need > 0 ? `<p class="fwarn">${esc(tn(locale, 'import.needYou', need, { n: show.count(locale, need) }))}</p>` : ''}
      ${imp.checkEveryRow ? `<p class="fwarn" role="alert">${esc(t(locale, 'import.checkEvery'))}</p>` : ''}
      ${m.currencyNow !== imp.currency ? `<p class="perr" role="alert">${esc(t(locale, 'import.currencyChanged', { now: m.currencyNow, was: imp.currency }))}</p>` : ''}
      ${stops.length ? `<div class="perr" role="alert">${stops.map((b) => `<p>${blockerLine(locale, b)}</p>`).join('')}</div>` : ''}
    </div>
    <div class="imp${photos ? ' with-photos' : ''}">
      ${photos ? `<aside class="imp-photos">${photos}</aside>` : ''}
      <form class="imp-rows" method="post" action="${base(imp.id)}/save">
        <input type="hidden" name="rows" value="${esc(drawn.join(','))}" />
        <input type="hidden" name="ticks" value="${esc(ticks.join(','))}" />
        <input type="hidden" name="applies" value="${esc(m.diff.changed.map((c) => keyOfLine(c.line)).join(','))}" />
        ${changes ? `<div class="block"><h2>${esc(t(locale, 'product.review.changedTitle', { count: m.diff.changed.length }))}</h2>
          <p class="muted">${esc(t(locale, 'product.review.changedHint'))}</p>${changes}</div>` : ''}
        ${newRows.length ? `<div class="block"><h2>${esc(t(locale, 'product.review.addedTitle', { count: newRows.filter((r) => !r.removed).length }))}</h2>
          ${newRows.map((r) => rowHtml(locale, m, r, errors.get(r.key) ?? [], typed)).join('')}</div>` : ''}
        ${held.size ? `<div class="block"><h2>${esc(t(locale, 'product.review.heldTitle'))}</h2>${[...held.values()].map((h) => `
          <div class="rev">${h.product ? `<b dir="auto">${esc(h.product.name)}</b>` : `<b dir="auto">${esc(h.line.name)}</b>`}
            <span class="rev-move">${esc(t(locale, `product.review.held.${h.reason}`))}</span>
            ${h.product ? `<a href="/app/products/${esc(h.product.id)}">${esc(t(locale, 'product.review.openProduct'))}</a>` : ''}</div>`).join('')}</div>` : ''}
        ${unchanged.size ? `<div class="block"><h2>${esc(t(locale, 'product.review.unchangedTitle', { count: unchanged.size }))}</h2>${m.diff.unchanged.map((u) => `<div class="rev"><b dir="auto">${esc(u.product.name)}</b></div>`).join('')}</div>` : ''}
        ${refused.length ? `<div class="block"><h2>${esc(t(locale, 'product.review.rejectedTitle'))}</h2>${refused.map((r) => `<div class="rev muted"><bdi>${esc(r.line)}</bdi> <span class="rev-move">${esc(t(locale, `product.reject.${r.refused}` as MessageKey, { currency: imp.currency, sign: currencySymbol(imp.currency).trim() }))}</span></div>`).join('')}</div>` : ''}
        <div class="block">
          <label class="imp-q">${esc(t(locale, 'import.discount.q', { name: assistantName(locale) }))}
            <span class="imp-pct"><input type="text" inputmode="decimal" name="discount" value="${esc(discount)}" autocomplete="off" /> %</span></label>
          ${opts.discountError ? `<p class="perr" role="alert">${esc(t(locale, 'import.discount.invalid'))}</p>` : ''}
          <p class="muted small">${esc(t(locale, 'import.discount.hint'))}</p>
        </div>
        ${offered === 0 ? `<div class="block"><p class="muted">${esc(t(locale, 'product.review.nothingToChange'))}</p></div>` : `<div class="imp-acts">
          <button class="btn send" type="submit" name="next" value="add">${esc(t(locale, newRows.length === 0 ? 'product.review.confirmChanges' : 'import.add'))}</button>
          <button class="btn" type="submit" name="next" value="save">${esc(t(locale, 'import.save'))}</button>
        </div>`}
      </form>
    </div>
    ${paste}
    <form method="post" action="${base(imp.id)}/drop" class="block">
      <button class="btn ghost quiet" type="submit" data-confirm="${esc(t(locale, 'import.dropConfirm'))}">${esc(t(locale, 'import.drop'))}</button>
    </form>`;
}

/** K2 — each new product's lowest price, worked out from the discount, a tick each. */
export function renderFloors(m: ReviewModel, locale: Locale): string {
  const { imp } = m;
  const pct = imp.discountPct ?? 0;
  const rows = m.diff.added.filter((p) => p.price !== null).map((p) => {
    const key = m.keyOf.get(p)!;
    const floor = derivedFloor(p.price!.amount, pct);
    return `<label class="pcheck imp-floor"><input type="checkbox" name="floor:${esc(key)}" />
      <span><b dir="auto">${esc(p.name)}</b> <span class="muted">${esc(t(locale, 'import.floors.row', {
        list: show.money(locale, p.price!), floor: show.money(locale, { amount: floor, currency: p.price!.currency }) }))}</span></span></label>`;
  }).join('');
  return `<h1 class="page">${esc(t(locale, 'import.floors.title'))}</h1>
    <div class="block">
      <p>${esc(t(locale, 'import.floors.intro', { name: assistantName(locale), pct: show.percent(locale, pct) }))}</p>
      <p class="muted">${esc(t(locale, 'import.floors.caveat'))}</p>
      <form method="post" action="${base(imp.id)}/confirm">
        ${rows}
        <button class="btn send" type="submit">${esc(t(locale, 'import.add'))}</button>
      </form>
      ${back(base(imp.id), t(locale, 'import.floors.back'))}
    </div>`;
}

