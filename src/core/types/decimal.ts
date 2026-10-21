/**
 * A1 (Phase 5, 2026-10-22) — EXACT DECIMALS. The one place money arithmetic happens.
 *
 * THE DEFECT THIS EXISTS FOR (docs/PHASE-5.md §2.1). Amounts were stored exactly (Postgres `numeric`) and then turned
 * into floating-point numbers to be discounted, multiplied and rounded. $5.30 less 5% is exactly $5.035; in floating
 * point it is 5.0349999…, and the quote said $5.03 where any rounding rule gives $5.04. Measured over 700,000 price ×
 * discount pairs: 1.34% a cent wrong, every one of them DOWN — the shop under-charged on one discounted quote in 75.
 *
 * So an amount is a decimal STRING ("5.035"), the same text Postgres hands back for a `numeric` and the same text JSON
 * carries without loss, and every operation below works on BigInt integers scaled by a power of ten. No floating point
 * value ever holds money. A static test forbids arithmetic on amounts anywhere else (tests/parity/exact-money.test.ts).
 *
 * ROUNDING is half away from zero ("arrondi commercial": 5.035 → 5.04, -5.035 → -5.04), at the places the caller asks
 * for — a currency's minor unit (ISO 4217) for a price or a total.
 */

/** A decimal number written as text: an optional minus, digits, and an optional fraction. Never an exponent. */
export type Decimal = string & { readonly __exactDecimal: unique symbol };

const SHAPE = /^-?\d+(\.\d+)?$/;

/** An integer `n` scaled by 10^-`s`: 5.035 is { n: 5035n, s: 3 }. */
type Scaled = { readonly n: bigint; readonly s: number };

const TEN = 10n;
const pow10 = (k: number): bigint => TEN ** BigInt(k);

/** The canonical text of a scaled integer: no leading zeros, no trailing fractional zeros, never "-0". */
function text({ n, s }: Scaled): Decimal {
  if (n === 0n) return '0' as Decimal;
  const neg = n < 0n;
  let digits = (neg ? -n : n).toString();
  let scale = s;
  while (scale > 0 && digits.endsWith('0')) { digits = digits.slice(0, -1); scale -= 1; }
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  }
  return `${neg ? '-' : ''}${digits}` as Decimal;
}

function scaled(d: Decimal | string): Scaled {
  if (!SHAPE.test(d)) throw new Error(`decimal: "${d}" is not a decimal number`);
  const neg = d.startsWith('-');
  const body = neg ? d.slice(1) : d;
  const dot = body.indexOf('.');
  const int = dot === -1 ? body : body.slice(0, dot);
  const frac = dot === -1 ? '' : body.slice(dot + 1);
  const n = BigInt(int + frac);
  return { n: neg ? -n : n, s: frac.length };
}

/** Two scaled integers brought to the same scale. */
function aligned(a: Scaled, b: Scaled): [bigint, bigint, number] {
  const s = Math.max(a.s, b.s);
  return [a.n * pow10(s - a.s), b.n * pow10(s - b.s), s];
}

/** Text into a Decimal, or null when it is not one. Accepts "5", "5.0350", "-0.5"; refuses "", "1e3", "5,03", " 5". */
export function parseDecimal(raw: string): Decimal | null {
  return SHAPE.test(raw) ? text(scaled(raw)) : null;
}

/** Text that must be a decimal: a stored `numeric`, a literal. Throws on anything else — a defect, not input. */
export function decimal(raw: string): Decimal {
  const d = parseDecimal(raw);
  if (d === null) throw new Error(`decimal: "${raw}" is not a decimal number`);
  return d;
}

/**
 * A whole number into a Decimal. Integers only — quantities, counts — so no fraction is ever read out of a float.
 * A float that holds a price is refused: it is exactly the value this module exists to keep out.
 */
export function fromInteger(n: number): Decimal {
  if (!Number.isSafeInteger(n)) throw new Error(`decimal: ${n} is not a whole number`);
  return text({ n: BigInt(n), s: 0 });
}

/**
 * A value read back from STORAGE — a `numeric` column's text, or a number an older JSON payload holds (an import draft,
 * an event written before A1). A number is read from its shortest text, which is the decimal that was written; an
 * exponent form ("1e-7") or a non-finite number is not a stored amount and is refused. Reading, never computing.
 */
export function storedDecimal(v: string | number): Decimal | null {
  if (typeof v === 'number') return Number.isFinite(v) ? parseDecimal(String(v)) : null;
  return parseDecimal(v);
}

export const addDecimal = (a: Decimal, b: Decimal): Decimal => {
  const [x, y, s] = aligned(scaled(a), scaled(b));
  return text({ n: x + y, s });
};

export const subDecimal = (a: Decimal, b: Decimal): Decimal => {
  const [x, y, s] = aligned(scaled(a), scaled(b));
  return text({ n: x - y, s });
};

export const mulDecimal = (a: Decimal, b: Decimal): Decimal => {
  const x = scaled(a), y = scaled(b);
  return text({ n: x.n * y.n, s: x.s + y.s });
};

/** Negative when a < b, zero when equal, positive when a > b. */
export const compareDecimal = (a: Decimal, b: Decimal): number => {
  const [x, y] = aligned(scaled(a), scaled(b));
  return x < y ? -1 : x > y ? 1 : 0;
};

/** -1, 0 or 1. */
export const signOf = (a: Decimal): number => compareDecimal(a, '0' as Decimal);

/** Half away from zero, at `places` decimals (0 or more). */
function roundScaled(v: Scaled, places: number): Scaled {
  if (v.s <= places) return v;
  const drop = pow10(v.s - places);
  const neg = v.n < 0n;
  const abs = neg ? -v.n : v.n;
  let q = abs / drop;
  if ((abs % drop) * 2n >= drop) q += 1n;
  return { n: neg ? -q : q, s: places };
}

export const roundDecimal = (a: Decimal, places: number): Decimal => {
  if (!Number.isInteger(places) || places < 0) throw new Error(`decimal: ${places} decimal places`);
  return text(roundScaled(scaled(a), places));
};

/** Up, toward positive infinity, at `places` decimals: a floor price that must never allow more off than was said. */
export const ceilDecimal = (a: Decimal, places: number): Decimal => {
  if (!Number.isInteger(places) || places < 0) throw new Error(`decimal: ${places} decimal places`);
  const v = scaled(a);
  if (v.s <= places) return text(v);
  const drop = pow10(v.s - places);
  let q = v.n / drop;                       // BigInt division truncates toward zero
  if (v.n > 0n && v.n % drop !== 0n) q += 1n;
  return text({ n: q, s: places });
};

/**
 * a ÷ b, rounded half away from zero at `places` decimals — exact up to that rounding (the quotient is computed as
 * a fraction, never as a float). Division by zero throws.
 */
export const divDecimal = (a: Decimal, b: Decimal, places: number): Decimal => {
  if (!Number.isInteger(places) || places < 0) throw new Error(`decimal: ${places} decimal places`);
  const [x, y] = aligned(scaled(a), scaled(b));
  if (y === 0n) throw new Error('decimal: division by zero');
  // x/y with `places` decimals, plus one more digit's worth of precision handled by the remainder test below.
  const neg = (x < 0n) !== (y < 0n);
  const ax = x < 0n ? -x : x, ay = y < 0n ? -y : y;
  const num = ax * pow10(places);
  let q = num / ay;
  if ((num % ay) * 2n >= ay) q += 1n;
  return text({ n: neg ? -q : q, s: places });
};

/**
 * A decimal through `Intl.NumberFormat`, exactly. Intl formats a numeric STRING without converting it to a float
 * (ECMA-402 "Intl.NumberFormat v3", in every Node this product runs on); TypeScript's ES2022 library types do not
 * know that yet, hence the one cast, here and nowhere else.
 */
export const formatDecimal = (nf: Intl.NumberFormat, d: Decimal): string => nf.format(d as unknown as number);

/** The same, in parts (for a page that styles the integer and the fraction separately). */
export const formatDecimalToParts = (nf: Intl.NumberFormat, d: Decimal): Intl.NumberFormatPart[] =>
  nf.formatToParts(d as unknown as number);
