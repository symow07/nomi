/**
 * COUNTRY PACKS FOR THE BOOKS (Block 2 PR 1; 0225; the owner's decision of 2026-11-06 that all three are built).
 *
 * One page under Books settings asks the country once; choosing it loads the pack: a chart of accounts template
 * (0190's CGNC for Morocco; Nomi's own plain charts for the United Kingdom and the United States), the tax codes the
 * country's invoices carry, the identifier its books carry, and how long its records are kept. What is here is the
 * definition — pure, so a test reads it as the page does; `src/db/booksCountry.ts` writes it.
 *
 *   · Morocco — the CGNC chart (`cgnc-normal`); TVA collected on 4455 (Etat, T.V.A. facturée) at 20, 14, 10 and 7 %,
 *     the same four deductible on 34552 (T.V.A. récupérable sur les charges), and an exempt code; the ICE, IF and RC
 *     on the profile (0206); months by default (D10, Avis 24's periods); ten years (0172).
 *   · United Kingdom — `uk-plain`; VAT collected on 2100 (VAT control) at 20 and 5 %, a zero rate (collected, 0 — not
 *     exempt: a zero-rated sale is still a VAT sale), and an exempt code; the Companies House number by R3's rule
 *     (src/core/books/registry.ts); six years (0218).
 *   · United States — `us-plain`; no VAT; sales tax as a rate per state the owner types (`ST_<STATE>`, collected on
 *     2100, Sales tax payable); the EIN; seven years (0225, Nomi's own choice).
 *
 * France, Spain and China are not built (RESEARCHED, docs/PHASE-5.md §1b): the page names the three it keeps books
 * for. Nothing here files anything with any authority.
 */
export type BooksCountry = 'MA' | 'GB' | 'US';
export const BOOKS_COUNTRIES: readonly BooksCountry[] = ['MA', 'GB', 'US'];
export const isBooksCountry = (c: string | null | undefined): c is BooksCountry => c === 'MA' || c === 'GB' || c === 'US';

export type PackTaxCode = {
  readonly code: string;
  readonly label: string;
  /** A percentage, exact, as `tax_codes.rate` keeps it. */
  readonly rate: string;
  readonly kind: 'collected' | 'deductible' | 'exempt';
  /** The account's code in the pack's chart; none for an exempt code. */
  readonly account: string | null;
};

export type CountryPack = {
  readonly country: BooksCountry;
  readonly chart: 'cgnc-normal' | 'uk-plain' | 'us-plain';
  /** The accounts Nomi drafts with when the owner has not chosen (`books_settings`), by code in the pack's chart. */
  readonly drafts: { readonly salesJournal: string; readonly receivable: string; readonly sales: string; readonly fxLoss: string; readonly fxGain: string };
  readonly periodDefault: 'month' | 'quarter';
  readonly taxCodes: readonly PackTaxCode[];
  /** The account a state's sales tax is collected on; the US only. */
  readonly salesTaxAccount: string | null;
  /** Which identifier the pack asks for: Morocco's three live on the profile (0206). */
  readonly identifier: 'morocco' | 'company_number' | 'ein';
  readonly retentionYears: number;
};

const tva = (rate: string): PackTaxCode[] => [
  { code: `TVA${rate}`, label: `TVA ${rate} % facturée`, rate, kind: 'collected', account: '4455' },
  { code: `TVA${rate}_D`, label: `TVA ${rate} % récupérable sur les charges`, rate, kind: 'deductible', account: '34552' },
];

export const COUNTRY_PACKS: Readonly<Record<BooksCountry, CountryPack>> = {
  MA: {
    country: 'MA', chart: 'cgnc-normal', periodDefault: 'month', identifier: 'morocco', retentionYears: 10, salesTaxAccount: null,
    drafts: { salesJournal: 'VE', receivable: '3421', sales: '7111', fxLoss: '6331', fxGain: '7331' },
    taxCodes: [...tva('20'), ...tva('14'), ...tva('10'), ...tva('7'), { code: 'EXO', label: 'Exonéré de TVA', rate: '0', kind: 'exempt', account: null }],
  },
  GB: {
    country: 'GB', chart: 'uk-plain', periodDefault: 'month', identifier: 'company_number', retentionYears: 6, salesTaxAccount: null,
    drafts: { salesJournal: 'SJ', receivable: '1100', sales: '4000', fxLoss: '7900', fxGain: '4900' },
    taxCodes: [
      { code: 'VAT20', label: 'VAT standard rate 20%', rate: '20', kind: 'collected', account: '2100' },
      { code: 'VAT5', label: 'VAT reduced rate 5%', rate: '5', kind: 'collected', account: '2100' },
      { code: 'VAT0', label: 'VAT zero rate', rate: '0', kind: 'collected', account: '2100' },
      { code: 'EXEMPT', label: 'VAT exempt', rate: '0', kind: 'exempt', account: null },
    ],
  },
  US: {
    country: 'US', chart: 'us-plain', periodDefault: 'month', identifier: 'ein', retentionYears: 7, salesTaxAccount: '2100',
    drafts: { salesJournal: 'SJ', receivable: '1100', sales: '4000', fxLoss: '7900', fxGain: '4900' },
    taxCodes: [],
  },
};

/** The EIN as it is kept: nine digits typed any way ("12 3456789", "123456789") become 00-0000000; anything else as typed. */
export const einAsTyped = (raw: string): string => {
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{9}$/.test(digits) ? `${digits.slice(0, 2)}-${digits.slice(2)}` : raw.trim();
};
export const isEin = (s: string): boolean => /^\d{2}-\d{7}$/.test(s);

/** The fifty states and the District of Columbia, as the USPS abbreviates them. */
export const US_STATES: readonly string[] = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];
export const usStateOf = (raw: string): string | null => {
  const s = raw.trim().toUpperCase();
  return US_STATES.includes(s) ? s : null;
};
/** One tax code per state: `ST_` and the state. */
export const stateTaxCode = (state: string): string => `ST_${state}`;
export const stateOfTaxCode = (code: string): string | null => (/^ST_([A-Z]{2})$/.exec(code)?.[1] ?? null);

/** A sales-tax rate as typed: a percentage from 0 to 100 with at most four decimals, kept exact ("8.25"). */
export const taxRateOf = (raw: string): string | null => {
  const s = raw.trim().replace(/%$/, '').trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s)) return null;
  const n = Number(s);
  if (!(n >= 0 && n <= 100)) return null;
  // at most four decimals, so the number's own text is the exact figure ("8.25", "10", "0.5")
  return String(n);
};
