import { DESIGN_TOKENS } from './tokens.js';

/**
 * M30 — the Nomi mark, inlined.
 *
 * THE SEAL (the owner, 2026-10-31): a square chop reading "nomi" in two rows,
 * n o over m i, its "o" an old Chinese cash coin — a disc with a square hole and
 * the two rims a coin has, round its edge and round its hole. It replaced the
 * figure (head, shoulders, body), which is kept as a record in
 * `assets/brand/retired-figure/`.
 *
 * SOURCE OF RECORD is `assets/brand/`. These are the cuts of it the product
 * ships: inline SVG, so the mark inherits the design tokens through `var(--…)`
 * and costs no request. `brand.test.ts` reads `assets/brand/*.svg` and asserts
 * the geometry below is byte-identical to it, so the copy cannot drift from the
 * source silently. If you change one, change both.
 *
 * TWO CUTS, NOT ONE SCALED.
 *   detail  ≥40px — the drawing on a 400 grid: the frame 23 units, every stroke
 *                   35, the coin's two rims cut 9.5 and 7.5 units wide so they
 *                   still read at 48 px (a pixel each).
 *   small   <40px — drawn on the 32-pixel grid itself, every edge on a whole
 *                   pixel. Its coin is a disc and a hole and no rims: at 32 px
 *                   the coin is ten pixels across and any rim is a pink haze.
 * Draw the small cut at 32 (or 16) so its edges stay on pixels.
 *
 * Colours: the frame and the letters are the BRAND magenta — the same value as
 * the one main button's fill, so the seal and the button share one magenta
 * (the owner, 2026-10-31: the seal was re-inked in the brand rather than the
 * button moved to the photo's raspberry, which sat 5 L* from the assistant's
 * shade). The coin is `coin`, a dark wine, decorative and the mark's alone
 * (`palette.test.ts`). Never the deep or the light shade — those are meanings.
 *
 * Pure per ADR-0002 — string in, string out.
 */

/** The detail cut, 400 grid: the frame and the four letters' strokes (even-odd). */
const DETAIL_SEAL =
  'M12 12h376v376H12zM35 35v330h330V35zM58 60H196V192H161V95H93V192H58zM58 213H257V345H222V248H175V345H140V248H93V345H58zM299 213h35v35h-35zM299 263h35v82h-35z';
/** The detail cut's coin: the disc, the paper ring, the rim round the hole, the hole (even-odd). */
const DETAIL_COIN =
  'M217 126a66 66 0 1 0 132 0a66 66 0 1 0-132 0zM227 126a56 56 0 1 0 112 0a56 56 0 1 0-112 0zM236.5 126a46.5 46.5 0 1 0 93 0a46.5 46.5 0 1 0-93 0zM251.5 94.5h63v63h-63zM259 102h48v48h-48zM264 107h38v38h-38z';
/** The small cut, 32 grid, every edge on a pixel. */
const SMALL_SEAL =
  'M1 1h30v30H1zM3 3v26h26V3zM5 5h11v10h-3V8H8v7H5zM5 17h17v10h-3V20h-4v7h-3V20H8v7H5zM24 17h3v3h-3zM24 22h3v5h-3z';
const SMALL_COIN = 'M17 10a5 5 0 1 0 10 0a5 5 0 1 0-10 0zM20 8h4v4h-4z';
/**
 * The favicon: the coin alone, on a 16 grid — the disc, one paper ring, the
 * hole. Crisp at 16 px and, doubled, at 32 (a tab on a sharp screen). The coin's
 * square rim is in the 32 px entry of `/favicon.ico` only.
 */
const FAVICON_COIN = 'M0 8a8 8 0 1 0 16 0a8 8 0 1 0-16 0zM1.5 8a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0zM2.5 8a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0zM5 5h6v6h-6z';

/** Exported for the source-parity test, not for drawing with. */
export const MARK_GEOMETRY = {
  detail: { seal: DETAIL_SEAL, coin: DETAIL_COIN },
  small: { seal: SMALL_SEAL, coin: SMALL_COIN },
  favicon: { coin: FAVICON_COIN },
} as const;

const svg = (grid: number, size: number, seal: string, coin: string, label: string | null): string =>
  `<svg class="mark" viewBox="0 0 ${grid} ${grid}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" ` +
  (label === null ? 'aria-hidden="true" focusable="false"' : `role="img" aria-label="${label}"`) +
  `><path fill="var(--color-brand)" fill-rule="evenodd" d="${seal}"/>` +
  `<path fill="var(--color-coin)" fill-rule="evenodd" d="${coin}"/></svg>`;

/**
 * The detail cut — 40px and up. Pass `label: null` where adjacent text already
 * names the thing, so a screen reader does not read "Nomi" twice.
 */
export const markDetail = (size = 40, label: string | null = 'Nomi'): string =>
  svg(400, size, DETAIL_SEAL, DETAIL_COIN, label);

/** The small cut — below 40px; 32 keeps every edge on a pixel. */
export const markSmall = (size = 32, label: string | null = 'Nomi'): string =>
  svg(32, size, SMALL_SEAL, SMALL_COIN, label);

/**
 * The favicon, as a `data:` URI so no static route is added (`/favicon.ico`
 * exists for the browsers that ask for it by name; this is what a page names).
 *
 * This is the ONE place the mark cannot use `var(--…)`: a data-URI SVG is its
 * own document and cannot see the page's custom properties, so the colour must
 * be literal. It is therefore READ FROM the tokens rather than typed in —
 * `brand.test.ts` asserts every hex in this URI is a token value.
 *
 * BASE64, not percent-encoding: this product bans `%` in owner-facing copy, and
 * base64 has none.
 */
export function faviconDataUri(tokens: typeof DESIGN_TOKENS = DESIGN_TOKENS): string {
  const doc =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">` +
    `<path fill="${tokens.color.coin}" fill-rule="evenodd" d="${FAVICON_COIN}"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(doc)}`;
}
