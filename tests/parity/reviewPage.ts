import { parsePriceLines } from '../../src/core/onboard/catalogImport.js';
import { rowsFromParsed, type ImportKind, type ImportRow, type ReviewContext } from '../../src/core/onboard/importReview.js';
import type { CatalogueEntry } from '../../src/core/onboard/catalogDiff.js';
import { buildModel, renderImportReview, type ReviewModel } from '../../src/api/web/importFlow.js';
import type { Currency } from '../../src/core/types/money.js';
import type { Locale } from '../../src/core/owner/i18n/locale.js';

/**
 * K1 — the served review page, drawn from text the way the routes draw it:
 * the same rows (`rowsFromParsed`), the same model (`buildModel`), the same
 * renderer. Parity tests of what the review SHOWS use this, so they test the
 * page an owner is given, not a second renderer.
 */
export function reviewModel(text: string, opts: {
  readonly kind?: ImportKind; readonly currency?: Currency; readonly catalogue?: readonly CatalogueEntry[];
  readonly ctx?: Partial<ReviewContext>; readonly rows?: (rows: ImportRow[]) => ImportRow[];
} = {}): ReviewModel {
  const currency = opts.currency ?? 'USD';
  const kind = opts.kind ?? 'paste';
  const ctx: ReviewContext = { kind, currency, country: null, countryCurrency: null, defaultUnit: 'pcs', ...opts.ctx };
  const parsed = rowsFromParsed(parsePriceLines(text, currency), { photo: kind === 'photo' ? 1 : null, startAt: 1, defaultUnit: ctx.defaultUnit, page: kind === 'photo' });
  const rows = opts.rows ? opts.rows(parsed) : parsed;
  return buildModel({
    id: '11111111-1111-4111-8111-111111111111', kind, state: 'open', currency, sourceText: text, rows,
    checkEveryRow: false, discountPct: null, photos: [], createdAt: new Date(0),
  }, ctx, opts.catalogue ?? [], currency);
}

export const reviewPage = (text: string, locale: Locale, opts: Parameters<typeof reviewModel>[1] = {}): string =>
  renderImportReview(reviewModel(text, opts), locale);
