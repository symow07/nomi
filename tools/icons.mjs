#!/usr/bin/env node
/**
 * THE ICONS THE PRODUCT DRAWS, TAKEN FROM PHOSPHOR (the icons run, 2026-10-04).
 *
 * The owner: "Move the whole app to one crafted, consistent icon family."
 * Phosphor (`@phosphor-icons/core`, MIT, a development dependency pinned to
 * one version) is that family. Nothing of it is served as a font, fetched at
 * run time or bundled whole: this tool copies the drawing of each icon the
 * product names, in each weight it names, into `src/api/web/phosphor.ts`, and
 * the package's own licence into `assets/icons/PHOSPHOR-LICENSE.txt`.
 *
 * A drawing is copied as the package ships it — its path, unchanged — and a
 * file holding anything but one path is refused rather than guessed at.
 * `tests/parity/icons-phosphor.test.ts` reads the package again and holds
 * every copied drawing to it, so nothing can be redrawn here by hand.
 *
 * Usage: node tools/icons.mjs   (after `npm ci`; it reads node_modules)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Each icon the product draws, and the weights it is drawn in. The weight is
 * chosen where it is drawn, by the words beside it (icons.ts says how):
 * regular at the size that balances a 15 px label at 500, bold beside bold
 * words or 13 px ones, the FILL only where the rail says "you are here".
 * Every icon of the menus and the pages has both line weights, so a place may
 * take either. Add a name here and run the tool again.
 */
const BOTH = ['regular', 'bold'];
const LINES = [
  // the menus: the assistant's, My business, Setup and Settings
  'chat-text', 'book-open', 'question', 'prohibit', 'identification-badge', 'list-bullets', 'sliders-horizontal',
  'check-circle', 'play-circle', 'calendar-dots', 'flag', 'clock-counter-clockwise', 'storefront', 'handshake',
  'package', 'shield-check', 'briefcase', 'chats', 'power', 'coins', 'chat-circle', 'chat-teardrop',
  'envelope-simple', 'bell', 'file-text', 'gift', 'calendar-x', 'arrows-left-right', 'monitor-play',
  'list-checks', 'translate', 'users-three', 'key', 'credit-card', 'folder', 'sign-out',
  // Your data's download, the regular customer, the calendar's kinds of date
  'download-simple', 'repeat', 'truck', 'tag', 'arrow-bend-up-left', 'arrow-clockwise', 'archive', 'push-pin', 'quotes',
  // a customer with no name yet; what a customer sent that is not words
  'user', 'paperclip', 'microphone', 'image',
  // a door, the way back, closing
  'caret-right', 'caret-left', 'x',
  // a door that leaves Nomi for another site
  'arrow-up-right',
];
export const WANTED = {
  // the rail: an outline at rest, the fill where you are; the heading in bold at its small size
  sun: ['regular', 'fill'],
  tray: ['regular', 'fill'],
  'calendar-blank': ['regular', 'bold', 'fill'],
  'gear-six': ['regular', 'fill'],
  users: ['bold'],
  // the assistant's slot (agentMark.ts): both lines and the fill
  'user-circle': ['regular', 'bold', 'fill'],
  ...Object.fromEntries(LINES.map((n) => [n, BOTH])),
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(ROOT, 'node_modules', '@phosphor-icons', 'core');

/** The one path a Phosphor file draws, or a refusal naming the file. */
export function drawingOf(svg, file) {
  const m = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 256 256" fill="currentColor"><path d="([^"]+)"\/><\/svg>\s*$/.exec(svg);
  if (!m) throw new Error(`${file}: not one path on the 256 grid; this tool copies, it does not redraw`);
  return m[1];
}

export const fileOf = (name, weight) => join(PKG, 'assets', weight, `${name}${weight === 'regular' ? '' : `-${weight}`}.svg`);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const meta = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
  if (meta.license !== 'MIT') { console.error(`@phosphor-icons/core: licence ${meta.license}, not MIT`); process.exit(1); }
  const licence = readFileSync(join(PKG, 'LICENSE'), 'utf8');
  if (!/^MIT License/.test(licence)) { console.error('@phosphor-icons/core: its LICENSE file is not the MIT licence'); process.exit(1); }

  const lines = [];
  for (const [name, weights] of Object.entries(WANTED)) {
    const drawn = weights.map((w) => `${w}: '${drawingOf(readFileSync(fileOf(name, w), 'utf8'), `${name} ${w}`)}'`);
    lines.push(`  '${name}': {\n${drawn.map((d) => `    ${d},`).join('\n')}\n  },`);
  }
  writeFileSync(join(ROOT, 'src', 'api', 'web', 'phosphor.ts'), `/**
 * WRITTEN BY tools/icons.mjs from @phosphor-icons/core ${meta.version} (MIT;
 * the licence is assets/icons/PHOSPHOR-LICENSE.txt). Do not edit by hand: add
 * the icon to the tool's list and run it again.
 *
 * Each icon's drawing as the package ships it, one path on a 256-unit square,
 * filled in the colour of the words around it. The weights are Phosphor's own:
 * regular (a 16-unit line), bold (24) and fill.
 */
export const PHOSPHOR = {
${lines.join('\n')}
} as const;
`);
  mkdirSync(join(ROOT, 'assets', 'icons'), { recursive: true });
  writeFileSync(join(ROOT, 'assets', 'icons', 'PHOSPHOR-LICENSE.txt'),
    `The icons drawn by Nomi (src/api/web/phosphor.ts) are Phosphor Icons,\nfrom @phosphor-icons/core ${meta.version} (https://phosphoricons.com), under this licence:\n\n${licence}`);
  console.log(`${Object.values(WANTED).flat().length} drawings of ${Object.keys(WANTED).length} icons from @phosphor-icons/core ${meta.version}`);
}
