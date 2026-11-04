import { DESIGN_TOKENS, SPLIT_TOKENS } from './tokens.js';

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
 * The favicon: the coin alone, on a 16 grid — the disc, one ring, the hole —
 * on a cream disc a pixel wider all round (the owner, 2026-11-04): wine alone
 * is lost on a dark tab bar, and the cream's rim is what gives it an edge there.
 * Crisp at 16 px and, doubled, at 32 (a tab on a sharp screen). The coin's
 * square rim is in the 32 px entry of `/favicon.ico` only.
 */
const FAVICON_GROUND = 'M0 8a8 8 0 1 0 16 0a8 8 0 1 0-16 0z';
const FAVICON_COIN = 'M1 8a7 7 0 1 0 14 0a7 7 0 1 0-14 0zM2.25 8a5.75 5.75 0 1 0 11.5 0a5.75 5.75 0 1 0-11.5 0zM3.25 8a4.75 4.75 0 1 0 9.5 0a4.75 4.75 0 1 0-9.5 0zM5 5h6v6h-6z';

/** Exported for the source-parity test, not for drawing with. */
export const MARK_GEOMETRY = {
  detail: { seal: DETAIL_SEAL, coin: DETAIL_COIN },
  small: { seal: SMALL_SEAL, coin: SMALL_COIN },
  favicon: { ground: FAVICON_GROUND, coin: FAVICON_COIN },
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
 * own document and cannot see the page's custom properties, so the colours must
 * be literal. They are therefore READ FROM the tokens rather than typed in —
 * `brand.test.ts` asserts every hex in this URI is a token value.
 *
 * BASE64, not percent-encoding: this product bans `%` in owner-facing copy, and
 * base64 has none.
 */
export function faviconDataUri(tokens: typeof DESIGN_TOKENS = DESIGN_TOKENS): string {
  const doc =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">` +
    `<path fill="${tokens.color.coinGround}" d="${FAVICON_GROUND}"/>` +
    `<path fill="${tokens.color.coin}" fill-rule="evenodd" d="${FAVICON_COIN}"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(doc)}`;
}

/**
 * The wash behind the Split Today header (docs/DESIGN-SYSTEM.md; the owner's reference, 2026-11-04): rose ink brushed on rice
 * paper, hanging from the top edge with a torn, watery foot, fading to nothing downward and away to the far side. A pale halo
 * first, the ink over it. Base64, as the favicon's: the served sheet stays free of drawing words.
 */
export function inkWashDataUri(): string {
  const { washInk: ink, washHalo: halo } = SPLIT_TOKENS.color;
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="220" viewBox="0 0 1400 220" preserveAspectRatio="none">
<defs>
<linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ink}" stop-opacity="0.36"/><stop offset="0.3" stop-color="${ink}" stop-opacity="0.26"/><stop offset="0.5" stop-color="${ink}" stop-opacity="0.11"/><stop offset="0.62" stop-color="${ink}" stop-opacity="0"/></linearGradient>
<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${halo}" stop-opacity="0.22"/><stop offset="0.58" stop-color="${halo}" stop-opacity="0.13"/><stop offset="0.78" stop-color="${halo}" stop-opacity="0"/></linearGradient>
<linearGradient id="c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e6e6e6"/><stop offset="0.3" stop-color="white"/><stop offset="0.62" stop-color="#b0b0b0"/><stop offset="0.86" stop-color="#2a2a2a"/><stop offset="1" stop-color="black"/></linearGradient>
<linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="white"/><stop offset="0.55" stop-color="white"/><stop offset="0.94" stop-color="black"/></linearGradient>
<mask id="e"><rect x="-200" y="-100" width="1800" height="420" fill="url(#c)"/></mask>
<mask id="f"><rect width="1400" height="220" fill="url(#d)"/></mask>
<filter id="g" x="-10%" y="-40%" width="120%" height="180%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.0042 0.011" numOctaves="5" seed="34" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="210" xChannelSelector="R" yChannelSelector="G" result="s"/>
<feComponentTransfer in="s" result="t"><feFuncA type="linear" slope="1.9" intercept="-0.05"/></feComponentTransfer>
<feGaussianBlur in="t" stdDeviation="0.8" result="u"/>
<feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="4" seed="39"/>
<feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 1 0 0 0 0.3" result="v"/>
<feComposite in="u" in2="v" operator="in"/>
</filter>
<filter id="h" x="-10%" y="-40%" width="120%" height="180%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.0028 0.012" numOctaves="4" seed="45" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="190" xChannelSelector="R" yChannelSelector="G"/>
<feGaussianBlur stdDeviation="3"/>
</filter>
</defs>
<g mask="url(#f)"><g mask="url(#e)">
<rect x="-100" y="-60" width="1600" height="340" fill="url(#b)" filter="url(#h)"/>
<rect x="-100" y="-60" width="1600" height="340" fill="url(#a)" filter="url(#g)"/>
</g></g>
</svg>`;
  return `data:image/svg+xml;base64,${btoa(doc)}`;
}
