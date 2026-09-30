/**
 * RT — HOW A BUSINESS SELLS, by its kind (the owner's correction of
 * 2026-10-01: price-after-quantity, the "pcs" unit and the import minimum are
 * one piece of work, conditional on the kind of business).
 *
 *   · Shops and brands (retail, brand, online shop — the plan's retail kinds)
 *     give a unit price without asking how many first, count in whatever unit
 *     fits the goods ("each" by default), and import a list with no minimum.
 *   · Factories, exporters and wholesalers keep quantity first, "pcs" and
 *     minimums: for them it is correct.
 *
 * The kind sets the default; the owner may say otherwise (RT's setting on "How
 * you sell"). One definition: Practice's checklist, the import, the reply and
 * the ramp all read it from here. Pure.
 */

/** The kinds the plan calls retail: a customer asks "how much?" before "how many?". */
export const RETAIL_KINDS: ReadonlySet<string> = new Set(['retail', 'brand', 'online_shop']);

export const isRetailKind = (kind: string | null | undefined): boolean => !!kind && RETAIL_KINDS.has(kind);

/** The unit a new product counts in, until the owner says otherwise. */
export const defaultUnitFor = (kind: string | null | undefined): string => (isRetailKind(kind) ? 'item' : 'pcs');
