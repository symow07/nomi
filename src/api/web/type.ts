import { readFileSync } from 'node:fs';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { LOCALE_LABEL } from '../../core/owner/i18n/locale.js';

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
 * Each face draws only its own characters (`unicode-range`, cut by the tool to
 * what the file really holds), so a page fetches the files for the characters
 * on it and nothing else.
 *
 * THE TYPE PASS (2026-10-04). The three Sans faces are variable: one file per
 * slice draws every weight from light 300 to bold 700, declared as that range.
 * The Serif voice stays at 400.
 *
 * TWO SHEETS, CHOSEN BY THE PAGE'S CHARACTERS. The Chinese faces' rules alone
 * are most of the weight (about 185 KB of rules), so only a page that needs
 * them carries them: a Chinese page, and any page whose words hold a Chinese
 * character the first sheet does not draw — a customer's name, a business
 * called 义乌宏发 on an English page. Before, those were drawn by the device's
 * own font, the one silent fallback left in the app (TYPE-ICONS-TRUTH §1.3).
 * The first sheet also draws the language switch's own names (中文 is in its
 * Chinese slices), so a door page in English needs nothing more.
 *
 * A PUBLIC PAGE carries its rules inside itself (`facesFor`): exactly the faces
 * its characters need, so a stranger's first page is set in the product's type
 * too, with nothing to fetch before it can be read.
 *
 * `dist/` mirrors `src/`, so `../../../assets/` is the repository root from
 * both `src/api/web/` and `dist/api/web/`.
 */

const DIR = new URL('../../../assets/fonts/', import.meta.url);

type Face = {
  readonly family: string;
  /** A number for a file drawn at one weight; [first, last] for a variable file. */
  readonly weight: number | readonly [number, number];
  readonly set: 'base' | 'zh';
  readonly file: string; readonly unicodeRange: string;
};

const FACES: readonly Face[] = (JSON.parse(readFileSync(new URL('faces.json', DIR), 'utf8')) as { faces: Face[] }).faces;
const NAMED = new Set(FACES.map((f) => f.file));

/** `U+0041-005A,U+00E9` → its spans of code points. */
const spans = (range: string): (readonly [number, number])[] => range.split(',').map((part) => {
  const [a, b] = part.replace(/^U\+/, '').split('-');
  return [parseInt(a!, 16), parseInt(b ?? a!, 16)] as const;
});
const SPANS = new Map(FACES.map((f) => [f, spans(f.unicodeRange)] as const));
const draws = (f: Face, cp: number): boolean => SPANS.get(f)!.some(([a, b]) => cp >= a && cp <= b);

const weightOf = (f: Face): string => (typeof f.weight === 'number' ? String(f.weight) : f.weight.join(' '));
const face = (f: Face): string =>
  `@font-face { font-family:"${f.family}"; font-style:normal; font-weight:${weightOf(f)}; font-display:swap; `
  + `src:url(/assets/${f.file}) format("woff2"); unicode-range:${f.unicodeRange}; }`;

/** The characters of the language switch's own names: every page may show them. */
const SWITCH = new Set([...Object.values(LOCALE_LABEL).join('')].map((c) => c.codePointAt(0)!));
/** The Chinese Sans slices that draw the switch's names (中, 文). */
const SWITCH_HAN = FACES.filter((f) => f.set === 'zh' && f.family === 'Noto Sans SC' && [...SWITCH].some((cp) => cp > 0x2e7f && draws(f, cp)));
const BASE = [...FACES.filter((f) => f.set === 'base'), ...SWITCH_HAN];

/** The Latin and Arabic faces, and the switch's Chinese: every page's. */
export const TYPE_CSS = BASE.map(face).join('\n');
/** …and every Chinese face with them: a page with Chinese words. */
export const TYPE_ZH_CSS = FACES.map(face).join('\n');

/** Every code point a Chinese face draws that the first sheet does not. */
const ZH_ONLY = (() => {
  const base = new Set<number>();
  for (const f of BASE) for (const [a, b] of SPANS.get(f)!) for (let c = a; c <= b; c++) base.add(c);
  const only = new Set<number>();
  for (const f of FACES) if (f.set === 'zh') for (const [a, b] of SPANS.get(f)!) for (let c = a; c <= b; c++) if (!base.has(c)) only.add(c);
  return only;
})();

/**
 * Which of the two a page links: a Chinese page the second, and any other page
 * the second only when its words hold a character only a Chinese face draws.
 */
export const typeSetFor = (locale: Locale, html = ''): 'base' | 'zh' => {
  if (locale === 'zh') return 'zh';
  for (const ch of html) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0x2e7f && ZH_ONLY.has(cp)) return 'zh';
  }
  return 'base';
};

/**
 * A public page's own faces: the rules for exactly the faces its characters
 * need (the Sans; the Serif too when the page sets anything in the voice). The
 * page stays complete without them — every stack ends in the device's fonts,
 * and `swap` draws the words at once — so they are an enhancement, never a
 * thing to wait for.
 */
export function facesFor(text: string, voice: boolean): string {
  const index = drawnBy();
  const used = new Set<Face>();
  for (const ch of text) for (const f of index.get(ch.codePointAt(0)!) ?? []) used.add(f);
  return FACES.filter((f) => used.has(f) && (voice || !/Serif|Naskh/.test(f.family))).map(face).join('\n');
}

/** Code point → the faces that draw it; made once, on the first public page. */
let INDEX: Map<number, Face[]> | null = null;
function drawnBy(): Map<number, Face[]> {
  if (INDEX) return INDEX;
  const made = new Map<number, Face[]>();
  for (const f of FACES) for (const [a, b] of SPANS.get(f)!) for (let c = a; c <= b; c++) {
    const at = made.get(c);
    if (at) at.push(f); else made.set(c, [f]);
  }
  INDEX = made;
  return made;
}

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
