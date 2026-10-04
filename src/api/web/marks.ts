/**
 * THE MARKS, DRAWN (the type pass, 2026-10-04).
 *
 * The signals' shapes — ✓ it went, ○ it waits, ✕ it did not happen, ✦ the
 * assistant did this, ● you — were typed as characters. No Noto face the
 * product serves draws any of them, so the browser borrowed whatever the
 * device had: ○ and ✓ came out of SF Pro Bold on an English or Arabic page and
 * out of the Chinese face, larger and thinner, on a Chinese one; ✦ out of Zapf
 * Dingbats, an ornament font, on every page (docs/TYPE-ICONS-TRUTH.md §1.3).
 * The waiting mark changed shape with the language.
 *
 * Now each is DRAWN: one small figure on a 16-unit square, painted in the
 * colour of the words around it (the stylesheet's mask), the same in every
 * language and on every device, at any size the text is. A renderer writes
 * `shape('ok')` where it wrote ✓; the stylesheet draws a state's shape before
 * its words the same way (`markBefore`, layout.ts). The characters stay the
 * shapes' NAMES (`DESIGN_TOKENS.signal`) — what a test, a comment or a plain
 * text message says — and are never drawn as text on a page.
 */

/** The five shapes: the four signals and "you" (the owner's own act, in a timeline). */
export type Shape = 'ok' | 'waiting' | 'failed' | 'assistant' | 'you';

/**
 * Each figure on a 16-unit square, in one colour (the mask's alpha is all that
 * counts). Strokes are 2 units with round ends, like the line icons; the
 * assistant's four-pointed star and "you" are filled.
 */
const FIGURE: Readonly<Record<Shape, string>> = {
  ok: `<path d='M3.2 8.6l3.1 3.1 6.5-7' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/>`,
  waiting: `<circle cx='8' cy='8' r='5.4' fill='none' stroke='black' stroke-width='2'/>`,
  failed: `<path d='M4.3 4.3l7.4 7.4M11.7 4.3l-7.4 7.4' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round'/>`,
  assistant: `<path d='M8 1.2C8.6 5.5 10.5 7.4 14.8 8 10.5 8.6 8.6 10.5 8 14.8 7.4 10.5 5.5 8.6 1.2 8 5.5 7.4 7.4 5.5 8 1.2Z' fill='black'/>`,
  you: `<circle cx='8' cy='8' r='4.4' fill='black'/>`,
};

/**
 * The figure as a stylesheet image. Written out, not percent-encoded: the
 * owner surface bans the percent sign, and a quoted data address may carry
 * the angle brackets and single quotes as they are.
 */
export const shapeUrl = (s: Shape): string =>
  `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>${FIGURE[s]}</svg>")`;

/**
 * How a shape is drawn, element or `::before`: a box three quarters of the
 * text's size, sitting on the baseline (so it centres on the capitals; in a
 * flex row, centred), filled with the text's own colour through the figure.
 * `forced-color-adjust` keeps it in the text's colour when the system forces
 * its own. The figure itself is `shapeMask`.
 */
export const SHAPE_BOX = 'display:inline-block; flex:none; align-self:center; inline-size:0.75em; block-size:0.75em; vertical-align:-0.04em; '
  + 'background-color:currentColor; -webkit-mask-position:center; mask-position:center; -webkit-mask-size:contain; mask-size:contain; '
  + '-webkit-mask-repeat:no-repeat; mask-repeat:no-repeat; forced-color-adjust:none;';

/** The figure a box is cut to (both spellings: the prefixed one for browsers before 2024). */
export const shapeMask = (s: Shape): string => `-webkit-mask-image:${shapeUrl(s)}; mask-image:${shapeUrl(s)};`;

const SHAPES: readonly Shape[] = ['ok', 'waiting', 'failed', 'assistant', 'you'];

/** The shell's rules for a shape drawn as an element: `.shape.s-ok` and its four siblings. */
export const SHAPE_CSS = `  .shape { ${SHAPE_BOX} }
${SHAPES.map((s) => `  .s-${s} { ${shapeMask(s)} }`).join('\n')}
`;

/** A shape where a character used to be: in the colour of the text around it, silent to a screen reader. */
export const shape = (s: Shape, cls = ''): string =>
  `<span class="shape s-${s}${cls ? ` ${cls}` : ''}" aria-hidden="true"></span>`;
