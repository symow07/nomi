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
 * The `:root` block the shell embeds. One palette: the dark one was retired
 * with the design pass (2026-09-29, decision 3) — it had never been reviewed
 * by eye, and graphite and magenta would have to be worked out again for it.
 *
 * Emitted as a single string that the shell drops into its <style>. Everything
 * downstream references `var(--…)`; nothing downstream writes a literal.
 */
export function cssVariables(tokens: typeof DESIGN_TOKENS = DESIGN_TOKENS): string {
  const { font, color, colorRole, spacingPx, radiusPx, shadow, motionMs, motionEase, motionEaseIn, motionSpring, motionTravelPx, motionScale, measure, faceTint } = tokens;

  // Typed, not cast: a job that names no colour of the palette does not compile.
  const roles: Readonly<Record<string, keyof typeof color>> = colorRole;
  const lines: string[] = [
    // One scheme: form controls, scrollbars and the caret stay light even on
    // a device set to dark, so nothing is drawn against a palette we never made.
    '  color-scheme: light;',
    // The Latin order in :root; Chinese and Arabic override it below, keyed on
    // the `lang` the shell writes on <html> — as the line-height is.
    decl('font-family', font.family.en),
    decl('font-voice', font.voice.en),
    ...Object.entries(font.sizePx).map(([k, v]) => decl(`font-size-${kebab(k)}`, `${v}px`)),
    // V1 — the Latin value in :root; Chinese and Arabic override it below,
    // keyed on the `lang` the shell writes on <html>.
    decl('line-height', font.lineHeight.en),
    // The type pass — headings close up and track in, per script (zh and ar override below).
    decl('line-height-tight', font.lineHeightTight.en),
    decl('tracking-tight', font.trackingTight.en),
    ...colorVars(color),
    // A colour by its job (`colorRole`): the palette's own variable, so a job never carries a value of its own.
    ...Object.entries(roles).map(([k, v]) => decl(`color-${kebab(k)}`, `var(--color-${kebab(v)})`)),
    // Named by VALUE, not by index: `--space-24` stays correct when the scale
    // grows, where `--space-5` would silently shift under everything using it.
    ...spacingPx.map((v) => decl(`space-${v}`, `${v}px`)),
    ...Object.entries(radiusPx).map(([k, v]) => decl(`radius-${kebab(k)}`, `${v}px`)),
    // M49 — one column, one prose measure, one form measure. Every width in
    // the product derives from these three; nothing declares its own.
    ...Object.entries(measure).map(([k, v]) => decl(`measure-${kebab(k)}`, v)),
    ...Object.entries(shadow).map(([k, v]) => decl(`shadow-${kebab(k)}`, v)),
    ...Object.entries(motionMs).map(([k, v]) => decl(`motion-${kebab(k)}`, `${v}ms`)),
    decl('motion-ease', motionEase),
    decl('motion-ease-in', motionEaseIn),
    decl('motion-spring', motionSpring),
    // The motion pass — how far things travel, and how much they grow or settle.
    ...Object.entries(motionTravelPx).map(([k, v]) => decl(`travel-${kebab(k)}`, `${v}px`)),
    ...Object.entries(motionScale).map(([k, v]) => decl(`motion-scale-${kebab(k)}`, v)),
    ...faceTint.flatMap((f, i) => [decl(`face-${i + 1}-bg`, f.bg), decl(`face-${i + 1}-fg`, f.fg)]),
  ];

  const perScript = (['zh', 'ar'] as const)
    .map((lang) => `html[lang="${lang}"] { --line-height: ${font.lineHeight[lang]}; `
      + `--font-family: ${font.family[lang]}; --font-voice: ${font.voice[lang]}; `
      + `--line-height-tight: ${font.lineHeightTight[lang]}; --tracking-tight: ${font.trackingTight[lang]}; }`)
    .join('\n');
  return `:root {
${lines.join('\n')}
}
${perScript}`;
}

/**
 * The type sizes the product is allowed to use, as a set of `NNpx` strings.
 * The shell's own test derives its scale from here rather than restating it —
 * `shell.test.ts` used to carry `const SCALE = [12,13,14,15,17,19,22,26]`,
 * which is how 19px and 26px stayed "on the scale" while being in no token.
 */
export const TYPE_SCALE_PX: readonly string[] =
  Object.values(DESIGN_TOKENS.font.sizePx).map((v) => `${v}px`);
