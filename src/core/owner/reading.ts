import { extractNumerals, isSafeSmall, near } from '../safety/numerals.js';

/**
 * "HOW {name} READ THIS" — the approval card's reasons (the design pass,
 * 2026-09-29; the plan's §1).
 *
 * One line per product name and per figure in the reply, each with where it
 * came from: the owner's product names, the customer's own words, the
 * owner's prices and the quote worked out from them, what the owner taught.
 * No confidence number: nothing Nomi computes means "the chance this reply is
 * right". What it has are facts — the sources below, and whether a second,
 * separate reading of the message agreed (`own_understanding`, 0060–0061).
 *
 * The sources are the numeral guard's own (`guardNumerals`), read the same
 * way, so a figure the card calls sourced is one the guard let through for
 * that reason. A figure nothing accounts for is said so — the card then does
 * not claim every figure has a source.
 *
 * Pure per ADR-0002: values in, values out.
 */

export type ReadingSource =
  | 'product' | 'price' | 'total' | 'discount' | 'minimum' | 'lead_time' | 'their_words' | 'unsourced';

export type ReadingLine =
  | { readonly kind: 'product'; readonly name: string }
  | { readonly kind: 'figure'; readonly value: number; readonly source: Exclude<ReadingSource, 'product'> };

export type ReadingQuote = {
  readonly unitPrice: number; readonly total: number; readonly quantity: number;
  readonly discountPct: number; readonly leadTimeDays: number | null; readonly moq: number | null;
};

export function readReply(input: {
  readonly reply: string;
  /** The identified product's names (English and Chinese), when there is one. */
  readonly productNames: readonly string[];
  readonly quote: ReadingQuote | null;
  /** Everything the customer wrote that the page shows. */
  readonly theirTexts: readonly string[];
  /** The quantity the conversation already holds, which the guard counts as theirs. */
  readonly heldQuantity: number | null;
}): { readonly lines: readonly ReadingLine[]; readonly everyFigureSourced: boolean } {
  const lines: ReadingLine[] = [];
  const lower = input.reply.toLocaleLowerCase();
  const named = input.productNames.find((n) => n.trim().length >= 2 && lower.includes(n.toLocaleLowerCase()));
  if (named) lines.push({ kind: 'product', name: named });

  const theirs = [
    ...input.theirTexts.flatMap((x) => extractNumerals(x).map((n) => n.value)),
    ...(input.heldQuantity !== null ? [input.heldQuantity] : []),
  ];
  const q = input.quote;
  const sourceOf = (v: number): Exclude<ReadingSource, 'product'> => {
    if (q && near(v, q.unitPrice)) return 'price';
    if (q && near(v, q.total)) return 'total';
    if (q && q.discountPct > 0 && near(v, q.discountPct)) return 'discount';
    if (q && q.moq !== null && near(v, q.moq)) return 'minimum';
    if (q && q.leadTimeDays !== null && near(v, q.leadTimeDays)) return 'lead_time';
    if ((q && near(v, q.quantity)) || theirs.some((t) => near(t, v))) return 'their_words';
    return 'unsourced';
  };

  const seen: number[] = [];
  for (const n of extractNumerals(input.reply)) {
    if (isSafeSmall(n) || seen.some((s) => near(s, n.value))) continue;
    seen.push(n.value);
    lines.push({ kind: 'figure', value: n.value, source: sourceOf(n.value) });
  }
  return {
    lines,
    everyFigureSourced: lines.every((l) => l.kind === 'product' || l.source !== 'unsourced'),
  };
}

/** The fields a second reading can differ on, in the order the card names them. */
export const READING_FIELDS = ['product', 'quantity', 'language', 'complaint', 'phase'] as const;
export type ReadingField = typeof READING_FIELDS[number];

/** Which fields a stored agreement says differ; null when there is none to read. */
export function differsOn(raw: unknown): readonly ReadingField[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const agrees = (raw as { agrees?: unknown }).agrees;
  if (!agrees || typeof agrees !== 'object') return null;
  const a = agrees as Record<string, unknown>;
  // `language: null` is "could not tell", which is not a disagreement.
  return READING_FIELDS.filter((f) => a[f] === false);
}
