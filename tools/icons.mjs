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
 * `tests/parity/icons.test.ts` reads the package again and holds
 * every copied drawing to it, so nothing can be redrawn here by hand.
 *
 * THE RAIL'S ICONS ARE SOLAR'S (the Solar nav, 2026-10-05). The owner chose
 * Solar's Linear set (`@iconify-json/solar`, by 480 Design, CC BY 4.0, a
 * development dependency pinned to one version) for the nav, after two
 * trials: an even, rounded line, never filled. The same tool copies the
 * rail's drawings, unchanged, into `src/api/web/solar.ts`, and writes the
 * attribution the licence asks for into `assets/icons/SOLAR-LICENSE.txt`
 * (NOTICE, at the root, says it again). A drawing that is not the Linear
 * set's shape — one group, a 1.5-unit line with round ends — is refused.
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
  // an empty calendar (the calendar's page)
  'calendar-blank': BOTH,
  // the assistant's slot (agentMark.ts) away from the rail: both lines and the fill
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

/**
 * The rail's icons, from Solar's Linear set: Today (a rounded house), Inbox, Calendar, Settings, the
 * heading "Customers", and the assistant's slot where the rail draws it (agentMark.ts).
 */
export const SOLAR_WANTED = ['home-2', 'inbox', 'calendar', 'settings', 'users-group-rounded', 'user-circle'];
const SOLAR_PKG = join(ROOT, 'node_modules', '@iconify-json', 'solar');
export const SOLAR_LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/';
export const SOLAR_AUTHOR_URL = 'https://www.figma.com/community/file/1166831539721848736';

/** One Linear drawing as the package ships it, or a refusal naming it. */
export function solarDrawingOf(icons, name) {
  const icon = icons.icons[`${name}-linear`];
  if (!icon) throw new Error(`solar ${name}-linear: not in the package`);
  if ((icon.width ?? icons.width) !== 24 || (icon.height ?? icons.height) !== 24) throw new Error(`solar ${name}-linear: not on the 24 grid`);
  if (!/^<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1\.5">[^']*<\/g>$/.test(icon.body)) {
    throw new Error(`solar ${name}-linear: not one group of a 1.5-unit round line; this tool copies, it does not redraw`);
  }
  return icon.body;
}
export const solarIcons = () => JSON.parse(readFileSync(join(SOLAR_PKG, 'icons.json'), 'utf8'));
export const solarMeta = () => ({
  ...JSON.parse(readFileSync(join(SOLAR_PKG, 'info.json'), 'utf8')),
  version: JSON.parse(readFileSync(join(SOLAR_PKG, 'package.json'), 'utf8')).version,
});

/** The attribution CC BY 4.0 asks for: who made it, the licence, where it came from, and what was changed. */
export const solarAttribution = (version) => `Solar by 480 Design
${SOLAR_AUTHOR_URL}

Licensed under the Creative Commons Attribution 4.0 International License (CC BY 4.0):
${SOLAR_LICENCE_URL}

Nomi draws the icons of its navigation (src/api/web/solar.ts) from Solar's Linear set, copied from the
npm package @iconify-json/solar ${version} (https://icon-sets.iconify.design/solar/), whose metadata names
the author and this licence: ${SOLAR_WANTED.map((n) => `${n}-linear`).join(', ')}.

Changes: none to the drawings. Each is copied as the package ships it; the app's stylesheet sets its size
(28 px; the heading's 20 px), its colour, and, at the heading's smaller size, a wider line so it reads as
the same 1.75 px line as the others.
`;

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
  const solar = solarMeta();
  if (solar.license?.spdx !== 'CC-BY-4.0' || solar.author?.name !== '480 Design') {
    console.error(`@iconify-json/solar: licence ${solar.license?.spdx} by ${solar.author?.name}, not CC-BY-4.0 by 480 Design`); process.exit(1);
  }
  const solarIconsJson = solarIcons();
  const solarLines = SOLAR_WANTED.map((n) => `  '${n}': '${solarDrawingOf(solarIconsJson, n)}',`);
  writeFileSync(join(ROOT, 'src', 'api', 'web', 'solar.ts'), `/**
 * WRITTEN BY tools/icons.mjs from @iconify-json/solar ${solar.version}: Solar by 480 Design, under
 * CC BY 4.0 (${SOLAR_LICENCE_URL}). The attribution is NOTICE and
 * assets/icons/SOLAR-LICENSE.txt. Do not edit by hand: add the icon to the tool's list and run it again.
 *
 * The rail's icons: each one's Linear drawing as the package ships it — one group on a 24-unit square, a
 * 1.5-unit line with round ends, in the colour of the words around it. Never a filled drawing.
 */
export const SOLAR = {
${solarLines.join('\n')}
} as const;
`);
  mkdirSync(join(ROOT, 'assets', 'icons'), { recursive: true });
  writeFileSync(join(ROOT, 'assets', 'icons', 'SOLAR-LICENSE.txt'), solarAttribution(solar.version));
  writeFileSync(join(ROOT, 'assets', 'icons', 'PHOSPHOR-LICENSE.txt'),
    `The icons drawn by Nomi (src/api/web/phosphor.ts) are Phosphor Icons,\nfrom @phosphor-icons/core ${meta.version} (https://phosphoricons.com), under this licence:\n\n${licence}`);
  console.log(`${Object.values(WANTED).flat().length} drawings of ${Object.keys(WANTED).length} icons from @phosphor-icons/core ${meta.version}`);
  console.log(`${SOLAR_WANTED.length} Linear drawings from @iconify-json/solar ${solar.version} (CC BY 4.0, 480 Design)`);
}
