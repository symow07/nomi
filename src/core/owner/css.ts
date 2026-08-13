import { DESIGN_TOKENS } from './tokens.js';

/**
 * M30 — the design system, rendered.
 *
 * `tokens.ts` described a surface that did not consume it: the shell carried a
 * hand-written stylesheet with every hex and size typed in by hand, so the
 * tokens said 17px/1.6 and warm paper while the product shipped 15px/1.5 and
 * blue-grey. This file is the join. It is the sixth time this repo has found a
 * value describing the system transcribed into a second place instead of
 * derived from the first, so the one rule here is:
 *
 *   THIS FUNCTION WALKS THE TOKEN OBJECT. It does not list variables.
 *
 * Add a colour to `DESIGN_TOKENS.color` and `--color-…` appears in the page
 * with no edit here. That property is asserted by design-system.test.ts, which
 * adds a token that does not exist and checks the CSS grew — because a
 * hand-maintained mapping is exactly the transcription this replaces.
 *
 * Pure per ADR-0002: string in, string out, no I/O and no clock.
 */

/** `inkSecondary` → `ink-secondary`. Token keys are camelCase; CSS is not. */
const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const decl = (name: string, value: string | number): string => `  --${name}: ${value};`;

/** Every `--color-*` line, from whichever palette is passed. */
function colorVars(palette: Readonly<Record<string, string>>): readonly string[] {
  return Object.entries(palette).map(([k, v]) => decl(`color-${kebab(k)}`, v));
}

/**
 * The `:root` block the shell embeds, plus the dark-mode override built from
 * `colorDark` — which has the same semantic keys, so it is the same walk.
 *
 * Emitted as a single string that the shell drops into its <style>. Everything
 * downstream references `var(--…)`; nothing downstream writes a literal.
 */
export function cssVariables(tokens: typeof DESIGN_TOKENS = DESIGN_TOKENS): string {
  const { font, color, colorDark, spacingPx, radiusPx, shadow, motionMs, measure } = tokens;

  const lines: string[] = [
    // `light dark` lets form controls, scrollbars and the caret follow the
    // palette instead of staying in whatever the UA guessed.
    '  color-scheme: light dark;',
    decl('font-family', font.family),
    decl('font-voice', font.voice),
    ...Object.entries(font.sizePx).map(([k, v]) => decl(`font-size-${kebab(k)}`, `${v}px`)),
    decl('line-height', font.lineHeight),
    ...colorVars(color),
    // Named by VALUE, not by index: `--space-24` stays correct when the scale
    // grows, where `--space-5` would silently shift under everything using it.
    ...spacingPx.map((v) => decl(`space-${v}`, `${v}px`)),
    ...Object.entries(radiusPx).map(([k, v]) => decl(`radius-${kebab(k)}`, `${v}px`)),
    // M49 — one column, one prose measure, one form measure. Every width in
    // the product derives from these three; nothing declares its own.
    ...Object.entries(measure).map(([k, v]) => decl(`measure-${kebab(k)}`, v)),
    ...Object.entries(shadow).map(([k, v]) => decl(`shadow-${kebab(k)}`, v)),
    ...Object.entries(motionMs).map(([k, v]) => decl(`motion-${kebab(k)}`, `${v}ms`)),
  ];

  return `:root {
${lines.join('\n')}
}
@media (prefers-color-scheme: dark) {
  :root {
${colorVars(colorDark).join('\n')}
  }
}`;
}

/**
 * The type sizes the product is allowed to use, as a set of `NNpx` strings.
 * The shell's own test derives its scale from here rather than restating it —
 * `shell.test.ts` used to carry `const SCALE = [12,13,14,15,17,19,22,26]`,
 * which is how 19px and 26px stayed "on the scale" while being in no token.
 */
export const TYPE_SCALE_PX: readonly string[] =
  Object.values(DESIGN_TOKENS.font.sizePx).map((v) => `${v}px`);
