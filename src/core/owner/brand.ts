import { DESIGN_TOKENS } from './tokens.js';

/**
 * M30 — the Nomi mark, inlined.
 *
 * SOURCE OF RECORD is `assets/brand/`. These are the cuts of it the product
 * ships: inline SVG, so the mark inherits the design tokens through `var(--…)`
 * and costs no request — which matters because the shell is server-rendered
 * with no static file handler, and an `<img>` would mean inventing a route.
 *
 * `brand.test.ts` reads `assets/brand/*.svg` and asserts the geometry below is
 * byte-identical to it, so the copy cannot drift from the source silently. If
 * you change one, change both — the test will tell you if you forgot.
 *
 * TWO CUTS, NOT ONE SCALED.
 *   detail  ≥40px — jade figure on a pale jade-wash disc.
 *   small   <40px — REVERSED: the figure knocked out of a SOLID jade disc,
 *                   because a pale disc loses its edge against the page at
 *                   favicon size.
 * Same geometry, inverted ground. Below about 40px the pale disc stops reading
 * as a disc at all, which is the whole reason the second cut exists.
 *
 * There is no separate night cut here and none is needed: the fills are token
 * variables, so `colorDark` swaps them automatically under
 * `prefers-color-scheme: dark`. `assets/brand/mark-night.svg` is the reference
 * for what that should look like, not a third thing to wire.
 *
 * Pure per ADR-0002 — string in, string out.
 */

/**
 * The figure: head, shoulders, body. Shared by BOTH cuts deliberately, so a
 * change to the drawing cannot land in one and miss the other.
 */
const FIGURE =
  '<circle cx="50" cy="19" r="7.5"/>' +
  '<path d="M50 20 C68 20 77 36 77 53 C77 62 75 68 72 72 C71 66 70 60 70 53 C70 38 62 30 50 30 C38 30 30 38 30 53 C30 60 29 66 28 72 C25 68 23 62 23 53 C23 36 32 20 50 20 Z"/>' +
  '<path d="M50 75 C58 75 64 72 67 69 C68 74 69 78 71 80 C81 84 88 91 90 100 L10 100 C12 91 19 84 29 80 C31 78 32 74 33 69 C36 72 42 75 50 75 Z"/>';

/** Exported for the source-parity test, not for drawing with. */
export const MARK_FIGURE = FIGURE;

const svg = (size: number, disc: string, figure: string, label: string | null): string =>
  `<svg class="mark" viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" ` +
  (label === null ? 'aria-hidden="true" focusable="false"' : `role="img" aria-label="${label}"`) +
  `><circle cx="50" cy="50" r="50" fill="${disc}"/><g fill="${figure}">${FIGURE}</g></svg>`;

/**
 * The detail cut — 40px and up. Pass `label: null` where adjacent text already
 * names the thing, so a screen reader does not read "Nomi" twice.
 */
export const markDetail = (size = 40, label: string | null = 'Nomi'): string =>
  svg(size, 'var(--color-jade-wash)', 'var(--color-jade)', label);

/** The small cut — below 40px. Reversed out of a solid disc. */
export const markSmall = (size = 30, label: string | null = 'Nomi'): string =>
  svg(size, 'var(--color-jade)', 'var(--color-paper)', label);

/**
 * The favicon, as a `data:` URI so no static route is added.
 *
 * This is the ONE place the mark cannot use `var(--…)`: a data-URI SVG is its
 * own document and cannot see the page's custom properties, so the colours must
 * be literal. They are therefore READ FROM the tokens rather than typed in —
 * change the palette and the favicon follows. `design-system.test.ts` asserts
 * every hex in this URI is a token value, so it can never quietly diverge.
 *
 * The small cut, because a favicon is 16px.
 *
 * BASE64, not percent-encoding, and deliberately so. `encodeURIComponent` would
 * put dozens of `%` characters into the page — and this product bans `%` in
 * owner-facing copy, enforced by string checks across several surfaces. Those
 * checks read page bodies rather than the head, so percent-encoding would pass
 * today; it would also be a trap primed for whoever tightens the rule to cover
 * the whole document. Base64 has no `%` and the question never arises.
 */
export function faviconDataUri(tokens: typeof DESIGN_TOKENS = DESIGN_TOKENS): string {
  const { jade, paper } = tokens.color;
  const doc =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<circle cx="50" cy="50" r="50" fill="${jade}"/>` +
    `<g fill="${paper}">${FIGURE}</g></svg>`;
  return `data:image/svg+xml;base64,${btoa(doc)}`;
}
