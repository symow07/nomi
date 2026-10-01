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

/** A shop or a brand: a customer asks "how much?" before "how many?" (the retail profile, below). */
export const isRetailKind = (kind: string | null | undefined): boolean => profileOf(kind) === 'retail';

/** The unit a new product counts in, until the owner says otherwise. */
export const defaultUnitFor = (kind: string | null | undefined): string => (isRetailKind(kind) ? 'item' : 'pcs');

/**
 * RT (0095) — THE THREE WAYS OF SELLING, and the four answers each gives
 * until the owner gives her own (the positioning inventory's proposal, §5):
 *
 *   bulk      manufacturer, trading (exporters), wholesale
 *   services  agency, services
 *   retail    everyone else — brand, online shop, retail shop, startup,
 *             something else — and so every shop the plan calls retail
 *
 * A workspace made before 0093 has no kind: it keeps the bulk defaults, which
 * is how the product behaved for everyone until now.
 */
export type SellingProfile = 'bulk' | 'retail' | 'services';

const BULK_KINDS: ReadonlySet<string> = new Set(['manufacturer', 'trading', 'wholesale']);
const SERVICE_KINDS: ReadonlySet<string> = new Set(['agency', 'services']);

export function profileOf(kind: string | null | undefined): SellingProfile {
  if (!kind || BULK_KINDS.has(kind)) return 'bulk';
  return SERVICE_KINDS.has(kind) ? 'services' : 'retail';
}

export type SellingAnswers = {
  /** Ask how many before giving a price. */
  readonly quantityFirst: boolean;
  /** Samples are offered. */
  readonly offersSamples: boolean;
  /** Orders are summed up as a proforma with delivery terms; an order needs the customer's e-mail. */
  readonly usesProforma: boolean;
  /** Products carry a minimum order. */
  readonly sellsWithMinimum: boolean;
};

export const SELLING_DEFAULTS: Readonly<Record<SellingProfile, SellingAnswers>> = {
  bulk: { quantityFirst: true, offersSamples: true, usesProforma: true, sellsWithMinimum: true },
  retail: { quantityFirst: false, offersSamples: false, usesProforma: false, sellsWithMinimum: false },
  services: { quantityFirst: false, offersSamples: false, usesProforma: false, sellsWithMinimum: false },
};

/** The owner's own answers, where she gave them (null: she did not). */
export type SellingOverrides = { readonly [K in keyof SellingAnswers]: boolean | null };

/** What is in force: her answer, else her kind's. */
export function sellingAnswers(kind: string | null | undefined, own: Partial<SellingOverrides> = {}): SellingAnswers {
  const d = SELLING_DEFAULTS[profileOf(kind)];
  return {
    quantityFirst: own.quantityFirst ?? d.quantityFirst,
    offersSamples: own.offersSamples ?? d.offersSamples,
    usesProforma: own.usesProforma ?? d.usesProforma,
    sellsWithMinimum: own.sellsWithMinimum ?? d.sellsWithMinimum,
  };
}
