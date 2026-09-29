import { readFileSync } from 'node:fs';
import type { Locale } from '../../core/owner/i18n/locale.js';

/**
 * THE TYPE, SERVED BY THE PRODUCT ITSELF (the design pass, 2026-09-29).
 *
 * Noto, one family drawn across scripts: Sans for what the product says, Serif
 * for what a person said, in Latin, Chinese and Arabic. The files are vendored
 * in `assets/fonts/` by `tools/fonts.mjs`, each named by its content, so the
 * route can let a browser keep it for good. Never from Google: its font
 * servers are blocked or unreliable in mainland China, and every page would
 * hand the owner's address to a processor /privacy does not name.
 *
 * Each face draws only its own characters (`unicode-range`), so a page
 * fetches the files for the characters on it and nothing else.
 *
 * TWO SHEETS. The Chinese faces' rules alone are most of the weight (about
 * 95 KB compressed of the whole), so only a Chinese page carries them. On an
 * English or Arabic page, Chinese words a customer wrote are drawn by the
 * device's own Chinese font, after the stack's Noto families.
 *
 * `dist/` mirrors `src/`, so `../../../assets/` is the repository root from
 * both `src/api/web/` and `dist/api/web/`.
 */

const DIR = new URL('../../../assets/fonts/', import.meta.url);

type Face = {
  readonly family: string; readonly weight: number; readonly set: 'base' | 'zh';
  readonly file: string; readonly unicodeRange: string;
};

const FACES: readonly Face[] = (JSON.parse(readFileSync(new URL('faces.json', DIR), 'utf8')) as { faces: Face[] }).faces;
const NAMED = new Set(FACES.map((f) => f.file));

const face = (f: Face): string =>
  `@font-face { font-family:"${f.family}"; font-style:normal; font-weight:${f.weight}; font-display:swap; `
  + `src:url(/assets/${f.file}) format("woff2"); unicode-range:${f.unicodeRange}; }`;

/** The Latin and Arabic faces: every page's. */
export const TYPE_CSS = FACES.filter((f) => f.set === 'base').map(face).join('\n');
/** …and the Chinese ones with them: a Chinese page's. */
export const TYPE_ZH_CSS = FACES.map(face).join('\n');

/** Which of the two a page in this language links. */
export const typeSetFor = (locale: Locale): 'base' | 'zh' => (locale === 'zh' ? 'zh' : 'base');

const read = new Map<string, Buffer>();

/**
 * The font file an address under `/assets/` names, or null. Only a name the
 * manifest lists is ever read — never a path built from the request.
 */
export function fontAt(file: string): Buffer | null {
  if (!NAMED.has(file)) return null;
  let bytes = read.get(file);
  if (!bytes) {
    bytes = readFileSync(new URL(file, DIR));
    read.set(file, bytes);
  }
  return bytes;
}
