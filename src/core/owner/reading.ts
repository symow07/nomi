import { asciiDigits, extractNumerals, isSafeSmall, near } from '../safety/numerals.js';

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
  | 'product' | 'price' | 'total' | 'discount' | 'minimum' | 'lead_time' | 'their_words' | 'order' | 'unsourced';

export type ReadingLine =
  | { readonly kind: 'product'; readonly name: string }
  /** The fix wave (V1-220) — the product's own code as the reply writes it ("ZX-300"): its digits are the code, not a figure. */
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'figure'; readonly value: number; readonly source: Exclude<ReadingSource, 'product'>; readonly words?: string; readonly customerText?: string };

/**
 * 5.5 (t1r's ruling, 2026-11-10) — what a figure of the `order_sourced` record is. The worker knows which of the
 * order's fields each figure came from when it intersects the order with the reply, and keeps it: an `identifier` (the
 * order's name, a tracking number, any other code) carries the whole token the reply wrote it in (`written`), and the
 * card shows that token as written, one line, never split; an `amount`, a `quantity` or a `date` keeps its format.
 * A record from before the ruling holds bare numbers, and is read as it was then.
 */
export type OrderFigureKind = 'amount' | 'quantity' | 'date' | 'identifier';
export type KindedOrderFigure = { readonly value: number; readonly kind: OrderFigureKind; readonly written?: string };
export type OrderFigure = number | KindedOrderFigure;

/**
 * The token a figure sits in, where `at` is the figure's place in `text` (ASCII digits): Latin letters and digits,
 * with "-", "_" or "/" between two of them, wherever the token starts. A comma closing the figure is the sentence's.
 */
export function tokenAround(text: string, at: readonly [number, number]): readonly [number, number] {
  const alnum = (i: number) => i >= 0 && i < text.length && /[A-Za-z0-9]/.test(text[i]!);
  const joined = (i: number) => (text[i] === '-' || text[i] === '_' || text[i] === '/') && alnum(i - 1) && alnum(i + 1);
  let [from, to] = at;
  while (to > from && text[to - 1] === ',') to--;
  while (from > 0 && (alnum(from - 1) || joined(from - 1))) from--;
  while (to < text.length && (alnum(to) || joined(to))) to++;
  return [from, to];
}

export type ReadingQuote = {
  readonly unitPrice: number; readonly total: number; readonly quantity: number;
  readonly discountPct: number; readonly leadTimeDays: number | null; readonly moq: number | null;
};

export function readReply(input: {
  readonly reply: string;
  /** Display-only inspection of every extracted figure; the default mirrors the numeral guard. */
  readonly includeSmallFigures?: boolean;
  /** The identified product's names (English and Chinese), when there is one. */
  readonly productNames: readonly string[];
  readonly quote: ReadingQuote | null;
  /** Everything the customer wrote that the page shows. */
  readonly theirTexts: readonly string[];
  /** The quantity the conversation already holds, which the guard counts as theirs. */
  readonly heldQuantity: number | null;
  /**
   * The fix wave (V1-220) — the identified product's own code (its SKU, when
   * it is the owner's: `ownSku`). "ZX-300" in a reply is the product's name
   * for itself; the card listed its "300" as a figure with no source, and the
   * line every owner reads said "No source for 300".
   */
  readonly productCodes?: readonly string[];
  /**
   * 5.5 — the figures of a verified Shopify order that this reply itself writes: the `order_sourced` record the worker
   * keeps beside an `order_facts` draft (the order's facts INTERSECTED with the draft's own text, nothing else). A
   * figure here reads "from the order in Shopify"; one that is not still reads as having no source. Absent: none.
   */
  readonly orderFigures?: readonly OrderFigure[];
}): { readonly lines: readonly ReadingLine[]; readonly everyFigureSourced: boolean } {
  const lines: ReadingLine[] = [];
  const lower = input.reply.toLocaleLowerCase();
  const named = input.productNames.find((n) => n.trim().length >= 2 && lower.includes(n.toLocaleLowerCase()));
  if (named) lines.push({ kind: 'product', name: named });

  // Where the product's name and its code stand in the reply: a figure inside
  // either is part of the name ("Thermos 500ml", "ZX-300"), said by its line.
  const text = asciiDigits(input.reply);
  const spans: (readonly [number, number])[] = [];
  const occurrences = (needle: string): (readonly [number, number])[] =>
    [...text.matchAll(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'))].map((m) => [m.index, m.index + m[0].length] as const);
  if (named) spans.push(...occurrences(asciiDigits(named)));
  for (const code of new Set((input.productCodes ?? []).map((c) => c.trim()).filter((c) => c.length >= 3 && /\d/.test(c)))) {
    const at = occurrences(asciiDigits(code));
    if (at.length === 0) continue;
    lines.push({ kind: 'code', code: input.reply.slice(at[0]![0], at[0]![1]) });
    spans.push(...at);
  }
  const inside = (n: { readonly at?: readonly [number, number] }): boolean =>
    !!n.at && spans.some(([s, e]) => n.at![0] >= s && n.at![1] <= e);

  const theirs = [
    ...input.theirTexts.flatMap((x) => extractNumerals(x).map((n) => n.value)),
    ...(input.heldQuantity !== null ? [input.heldQuantity] : []),
  ];
  const q = input.quote;
  const recorded = input.orderFigures ?? [];
  // A bare number is a record from before the kinds: read as it was then (`asWritten` below).
  const fromOldRecord = (v: number): boolean => recorded.some((o) => typeof o === 'number' && near(o, v));
  // An identifier is matched by its token, never by its value: the "1" of "1Z999AA10123456784" is no figure of the order.
  const fromOrder = (v: number): boolean => fromOldRecord(v)
    || recorded.some((o) => typeof o !== 'number' && o.kind !== 'identifier' && near(o.value, v));
  const identifiers = new Set(recorded.flatMap((o) => (typeof o !== 'number' && o.kind === 'identifier' && o.written ? [o.written] : [])));
  const identifierSpans: (readonly [number, number])[] = [];
  // A figure the record names as a date and as nothing else: its digits as the reply wrote them.
  const isOrderDate = (v: number): boolean =>
    recorded.some((o) => typeof o !== 'number' && o.kind === 'date' && near(o.value, v))
    && !recorded.some((o) => typeof o !== 'number' && (o.kind === 'amount' || o.kind === 'quantity') && near(o.value, v));
  const dateAsWritten = (n: ReturnType<typeof extractNumerals>[number]): string | undefined => {
    if (!n.at) return undefined;
    let [from, to] = n.at;
    while (to > from && /[,.]/.test(text[to - 1]!)) to--;
    return from < to ? input.reply.slice(from, to) : undefined;
  };
  // A record from before the kinds (bare numbers) — on an order-source line, a figure that is part of a code (Latin letters and
  // digits together: "TRK4455667788", "T55-4401") or a long run of digits alone (seven or more: a tracking number,
  // which no date or quantity of an order reaches) is an identifier: it is shown as the reply wrote it, never as
  // "4,455,667,788". Quantities, amounts and dates keep their formats; an ordinal ("21st") is a date, not a code.
  const asWritten = (n: ReturnType<typeof extractNumerals>[number]): string | undefined => {
    if (!n.at) return undefined;
    const alnum = (i: number) => i >= 0 && i < text.length && /[A-Za-z0-9]/.test(text[i]!);
    const joined = (i: number) => (text[i] === '-' || text[i] === '_') && alnum(i - 1) && alnum(i + 1);
    let [from, to] = n.at;
    while (to > from && text[to - 1] === ',') to--;   // "4455667788," — the comma is the sentence's, not the number's
    const digits = [from, to] as const;
    while (from > 0 && (alnum(from - 1) || joined(from - 1))) from--;
    while (to < text.length && (alnum(to) || joined(to))) to++;
    const token = text.slice(from, to);
    if (/[A-Za-z]/.test(token) && !/^\d{1,2}(?:st|nd|rd|th)$/i.test(token)) return input.reply.slice(from, to);
    if (/^\d{7,}$/.test(text.slice(...digits))) return input.reply.slice(...digits);
    return undefined;
  };
  const sourceOf = (v: number): Exclude<ReadingSource, 'product'> => {
    if (q && near(v, q.unitPrice)) return 'price';
    if (q && near(v, q.total)) return 'total';
    if (q && q.discountPct > 0 && near(v, q.discountPct)) return 'discount';
    if (q && q.moq !== null && near(v, q.moq)) return 'minimum';
    if (q && q.leadTimeDays !== null && near(v, q.leadTimeDays)) return 'lead_time';
    if ((q && near(v, q.quantity)) || theirs.some((t) => near(t, v))) return 'their_words';
    if (fromOrder(v)) return 'order';
    return 'unsourced';
  };

  // These figures were previously omitted by the guard-compatible reading.
  // Display inspection must not promote a matching price into evidence for days or pieces.
  const context = (raw: string, n: ReturnType<typeof extractNumerals>[number]) => {
    const normalized = asciiDigits(raw), end = n.at?.[1] ?? 0;
    const tail = normalized.slice(end);
    const duration = /^\s*(?:days?\b|天|日)/iu.exec(tail);
    const quantity = /^\s*(?:pieces?\b|pcs\b|units?\b|bottles?\b|件|个|個|瓶)/iu.exec(tail);
    const unit = duration ?? quantity;
    return { kind: duration ? 'duration' : quantity ? 'quantity' : 'unknown',
      words: n.at ? raw.slice(n.at[0], end + (unit?.[0].length ?? 0)) : String(n.value) };
  };
  const seen: number[] = [];
  const smallSeen = new Set<string>();
  for (const n of extractNumerals(input.reply)) {
    if (inside(n)) continue;
    // An identifier of the order: the whole token, as the reply wrote it, on one line; every figure in it is that line.
    if (n.at && identifierSpans.some(([s, e]) => n.at![0] >= s && n.at![1] <= e)) continue;
    if (n.at && identifiers.size > 0) {
      const [from, to] = tokenAround(text, n.at);
      const written = input.reply.slice(from, to);
      if (identifiers.has(written)) {
        identifierSpans.push([from, to]);
        if (!lines.some((l) => l.kind === 'figure' && l.source === 'order' && l.words === written)) {
          lines.push({ kind: 'figure', value: n.value, source: 'order', words: written });
        }
        continue;
      }
    }
    if (isSafeSmall(n)) {
      if (!input.includeSmallFigures) continue;
      const c = context(input.reply, n);
      const key = `${n.value}:${c.kind}`;
      if (smallSeen.has(key)) continue;
      smallSeen.add(key);
      const customerText = c.kind === 'quantity' ? input.theirTexts.find((raw) =>
        extractNumerals(raw).some((other) => near(other.value, n.value) && context(raw, other).kind === 'quantity')) : undefined;
      const source = c.kind === 'duration' && q?.leadTimeDays !== null && q?.leadTimeDays !== undefined && near(n.value, q.leadTimeDays) ? 'lead_time'
        : c.kind === 'quantity' && ((q && near(n.value, q.quantity)) || (input.heldQuantity !== null && near(n.value, input.heldQuantity)) || customerText !== undefined) ? 'their_words'
        : fromOrder(n.value) ? 'order'
        : 'unsourced';
      lines.push({kind:'figure',value:n.value,source,words:c.words,...(customerText !== undefined ? {customerText} : {})});
      continue;
    }
    if (seen.some((s) => near(s, n.value))) continue;
    seen.push(n.value);
    const source = sourceOf(n.value);
    // The old record's guess applies only to a figure the old record holds. A date of the order (a year, a day) is
    // shown as the reply wrote it — "2026", never "2,026" (t1r, 2026-11-10); an amount or a quantity keeps its format.
    const written = source !== 'order' ? undefined
      : fromOldRecord(n.value) ? asWritten(n)
      : isOrderDate(n.value) ? dateAsWritten(n) : undefined;
    // Two figures of one code ("T55-4401") are one line: the code as written.
    if (written !== undefined && lines.some((l) => l.kind === 'figure' && l.words === written)) continue;
    lines.push({ kind: 'figure', value: n.value, source, ...(written !== undefined ? { words: written } : {}) });
  }
  return {
    lines,
    everyFigureSourced: lines.every((l) => l.kind !== 'figure' || l.source !== 'unsourced'),
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
