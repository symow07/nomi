/**
 * B3/B4 — a system's JSON answer, read without letting a number pass through a float: Google Sheets' values and
 * Odoo's amounts arrive as JSON numbers, and 33.34 parsed the usual way is a double. Each number is kept as its own
 * digits, `{ number: "33.34" }`, for the books' readers to take exactly.
 */
/**
 * JSON whose numbers keep their own digits: `{ number: "33.34" }`, never 33.34 as a float. Uses the parser's source
 * text (V8's JSON.parse source access); where that is missing, the answer is unreadable rather than read loosely.
 */
export function parseExact(text: string): unknown {
  return JSON.parse(text, function (this: unknown, _k: string, v: unknown, ctx?: { source?: string }) {
    if (typeof v !== 'number') return v;
    if (!ctx || typeof ctx.source !== 'string') throw new Error('books: numbers cannot be read exactly here');
    return { number: ctx.source };
  } as (this: unknown, k: string, v: unknown) => unknown);
}

/** A body whose `{ number }` values are written as JSON numbers with their own digits — never a float's. */
export function exactBody(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    (x && typeof x === 'object' && 'number' in x && typeof (x as { number: unknown }).number === 'string' ? `\u0000n${(x as { number: string }).number}` : x))
    .replace(/"\\u0000n(-?\d+(?:\.\d+)?)"/g, '$1');
}
