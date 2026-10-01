import type { FieldConfidence } from '../core/onboard/extract.js';
import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { type Currency, parseCurrency } from '../core/types/money.js';
import type { ImportKind, ImportRow, ChallengeState } from '../core/onboard/importReview.js';

/**
 * K1 — an import, kept until it is confirmed (0094). The rows are the review's
 * own state: what was read, what the owner changed, the ticks and the three
 * challenge rows. Photos are kept with their transcript; a product added from
 * one points at it (K3).
 *
 * The app role may insert and update these rows, never delete them: an import
 * the owner gives up on is `dropped`, a confirmed one stays as the record of
 * where each product came from.
 */

export type StoredPhoto = { readonly position: number; readonly mediaType: string; readonly transcript: string };

export type StoredImport = {
  readonly id: string;
  readonly kind: ImportKind;
  readonly state: 'open' | 'confirmed' | 'dropped';
  readonly currency: Currency;
  readonly sourceText: string | null;
  readonly rows: readonly ImportRow[];
  readonly checkEveryRow: boolean;
  readonly discountPct: number | null;
  readonly photos: readonly StoredPhoto[];
  readonly createdAt: Date;
};

const KINDS: readonly ImportKind[] = ['paste', 'photo', 'store', 'file'];
const CHALLENGE: readonly ChallengeState[] = ['ask', 'ok', 'mismatch'];

/**
 * A row as stored, read back defensively: the jsonb is ours, but a row this
 * build cannot read is dropped from the review rather than shown half-read, and
 * a row with an unreadable price is a row with no price — never a guessed one.
 */
function rowOf(x: unknown): ImportRow | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const key = str(o['key']);
  const name = str(o['name']);
  const line = str(o['line']);
  if (!key || name === null || line === null) return null;
  const challenge = str(o['challenge']);
  return {
    key, line, name,
    photo: num(o['photo']),
    sku: str(o['sku']),
    nameZh: str(o['nameZh']),
    price: num(o['price']),
    unit: str(o['unit']) ?? 'pcs',
    moq: num(o['moq']),
    names: Array.isArray(o['names']) ? (o['names'] as unknown[]).filter((n): n is string => typeof n === 'string') : [],
    refused: (str(o['refused']) as ImportRow['refused']) ?? null,
    removed: o['removed'] === true,
    ticked: o['ticked'] === true,
    challenge: challenge && (CHALLENGE as readonly string[]).includes(challenge) ? challenge as ChallengeState : null,
    reopened: o['reopened'] === true,
    edited: o['edited'] === true,
    ...(str(o['productId']) ? { productId: str(o['productId'])! } : {}),
    ...(typeof o['apply'] === 'boolean' ? { apply: o['apply'] } : {}),
    ...(str(o['options']) ? { options: str(o['options'])! } : {}),
    // EXT — the extractor's confidence per field, kept only whole and in range.
    ...(confidenceOf(o['confidence']) ? { confidence: confidenceOf(o['confidence'])! } : {}),
  };
}

function confidenceOf(v: unknown): FieldConfidence | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  const f = (k: string): number | null => (typeof c[k] === 'number' && (c[k] as number) >= 0 && (c[k] as number) <= 1 ? c[k] as number : null);
  const [name, price, unit, moq] = [f('name'), f('price'), f('unit'), f('moq')];
  return name === null || price === null || unit === null || moq === null ? null : { name, price, unit, moq };
}

export async function createImport(tx: Tx, bid: BusinessId, input: {
  readonly kind: ImportKind; readonly currency: Currency; readonly sourceText: string | null;
  readonly rows: readonly ImportRow[]; readonly createdBy: string;
}): Promise<string> {
  const r = await sql<{ id: string }>`
    insert into catalog_imports (business_id, kind, currency, source_text, rows, created_by)
    values (${bid}, ${input.kind}, ${input.currency}, ${input.sourceText}, ${JSON.stringify(input.rows)}::jsonb, ${input.createdBy})
    returning id`.execute(tx);
  return r.rows[0]!.id;
}

export async function addImportPhoto(tx: Tx, bid: BusinessId, importId: string, input: {
  readonly position: number; readonly mediaType: string; readonly bytes: Buffer; readonly transcript: string;
}): Promise<void> {
  await sql`
    insert into catalog_import_photos (business_id, import_id, position, media_type, bytes, transcript)
    values (${bid}, ${importId}::uuid, ${input.position}, ${input.mediaType}, ${input.bytes}, ${input.transcript})`.execute(tx);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One import of this business; null when there is none by that id (another business's is none). */
export async function loadImport(tx: Tx, bid: BusinessId, id: string, opts: { forUpdate?: boolean } = {}): Promise<StoredImport | null> {
  if (!UUID.test(id)) return null;
  const r = (await sql<{
    id: string; kind: string; state: string; currency: string; source_text: string | null; rows: unknown;
    check_every_row: boolean; discount_pct: string | null; created_at: Date;
  }>`
    select id, kind, state, currency, source_text, rows, check_every_row, discount_pct, created_at
      from catalog_imports where business_id = ${bid} and id = ${id}::uuid
      ${opts.forUpdate ? sql`for update` : sql``}`.execute(tx)).rows[0];
  if (!r) return null;
  const currency = parseCurrency(r.currency);
  if (!currency || !(KINDS as readonly string[]).includes(r.kind)) return null;
  const photos = (await sql<{ position: number; media_type: string; transcript: string }>`
    select position, media_type, transcript from catalog_import_photos
     where business_id = ${bid} and import_id = ${id}::uuid order by position`.execute(tx)).rows;
  return {
    id: r.id,
    kind: r.kind as ImportKind,
    state: r.state as StoredImport['state'],
    currency,
    sourceText: r.source_text,
    rows: (Array.isArray(r.rows) ? r.rows : []).map(rowOf).filter((x): x is ImportRow => x !== null),
    checkEveryRow: r.check_every_row,
    discountPct: r.discount_pct === null ? null : Number(r.discount_pct),
    photos: photos.map((p) => ({ position: p.position, mediaType: p.media_type, transcript: p.transcript })),
    createdAt: r.created_at,
  };
}

/** The newest import this business left open, if any: the add page offers to go back to it. */
export async function latestOpenImport(tx: Tx, bid: BusinessId): Promise<{ id: string; kind: ImportKind; createdAt: Date; lines: number } | null> {
  const r = (await sql<{ id: string; kind: string; created_at: Date; lines: number }>`
    select id, kind, created_at, jsonb_array_length(rows) as lines from catalog_imports
     where business_id = ${bid} and state = 'open' order by created_at desc limit 1`.execute(tx)).rows[0];
  return r ? { id: r.id, kind: r.kind as ImportKind, createdAt: r.created_at, lines: Number(r.lines) } : null;
}

export async function saveImport(tx: Tx, bid: BusinessId, id: string, patch: {
  readonly rows: readonly ImportRow[]; readonly checkEveryRow?: boolean; readonly discountPct?: number | null;
}): Promise<void> {
  await sql`
    update catalog_imports set
      rows = ${JSON.stringify(patch.rows)}::jsonb,
      check_every_row = ${patch.checkEveryRow === undefined ? sql`check_every_row` : sql`${patch.checkEveryRow}`},
      discount_pct = ${patch.discountPct === undefined ? sql`discount_pct` : sql`${patch.discountPct}`},
      updated_at = now()
     where business_id = ${bid} and id = ${id}::uuid and state = 'open'`.execute(tx);
}

/** A photo's corrected text, before its rows are read again. */
export async function saveTranscript(tx: Tx, bid: BusinessId, id: string, position: number, transcript: string): Promise<void> {
  await sql`update catalog_import_photos set transcript = ${transcript}
             where business_id = ${bid} and import_id = ${id}::uuid and position = ${position}`.execute(tx);
}

export async function dropImport(tx: Tx, bid: BusinessId, id: string): Promise<boolean> {
  const r = await sql`update catalog_imports set state = 'dropped', updated_at = now()
                       where business_id = ${bid} and id = ${id}::uuid and state = 'open'`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

export async function markConfirmed(tx: Tx, bid: BusinessId, id: string, rows: readonly ImportRow[], actor: string): Promise<void> {
  await sql`
    update catalog_imports set state = 'confirmed', rows = ${JSON.stringify(rows)}::jsonb,
           confirmed_at = now(), confirmed_by = ${actor}, updated_at = now()
     where business_id = ${bid} and id = ${id}::uuid and state = 'open'`.execute(tx);
}

/** The photo itself, for the review and the product page. */
export async function loadImportPhoto(tx: Tx, bid: BusinessId, id: string, position: number): Promise<{ mediaType: string; bytes: Buffer } | null> {
  if (!UUID.test(id) || !Number.isInteger(position)) return null;
  const r = (await sql<{ media_type: string; bytes: Buffer }>`
    select media_type, bytes from catalog_import_photos
     where business_id = ${bid} and import_id = ${id}::uuid and position = ${position}`.execute(tx)).rows[0];
  return r ? { mediaType: r.media_type, bytes: r.bytes } : null;
}

/** Photo ids by position, for the products an import adds (K3). */
export async function photoIds(tx: Tx, bid: BusinessId, id: string): Promise<ReadonlyMap<number, string>> {
  const r = (await sql<{ position: number; id: string }>`
    select position, id from catalog_import_photos where business_id = ${bid} and import_id = ${id}::uuid`.execute(tx)).rows;
  return new Map(r.map((x) => [x.position, x.id]));
}
