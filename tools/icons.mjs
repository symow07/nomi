#!/usr/bin/env node
/**
 * THE ICONS THE PRODUCT DRAWS, TAKEN FROM SOLAR (the Solar run, 2026-10-05).
 *
 * The owner: "Move EVERY remaining icon in the app from Phosphor to Solar Linear, so the whole app speaks
 * one visual language — same family, same weight, same roundness as the nav … where Solar has no good
 * equivalent for a Phosphor icon, do NOT substitute something loosely related … Ship everything that
 * mapped cleanly; hold the gaps for me."
 *
 * Solar's Linear set (`@iconify-json/solar`, by 480 Design, CC BY 4.0, a development dependency pinned to
 * one version) is the family. Nothing of it is served as a font, fetched at run time or bundled whole:
 * this tool copies the drawing of each icon the product names into `src/api/web/solar.ts`, unchanged, and
 * writes the attribution the licence asks for into `assets/icons/SOLAR-LICENSE.txt` (NOTICE, at the root,
 * says it again). A drawing that is not the Linear set's shape — one group or one path, a 1.5-unit line
 * with round ends, nothing filled — is refused rather than guessed at. `tests/parity/icons.test.ts` reads
 * the package again and holds every copied drawing to it, so nothing can be redrawn here by hand.
 *
 * The seven meanings the owner was asked to choose for (the Solar run's gaps) were chosen on 2026-10-05;
 * with them the last Phosphor drawings, their licence file and the dependency went. Solar is the one family.
 *
 * Usage: node tools/icons.mjs   (after `npm ci`; it reads node_modules)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every Solar Linear drawing the product names (icons.ts and agentMark.ts say which meaning is which).
 * Add a name here and run the tool again.
 */
export const SOLAR_WANTED = [
  // the nav: Today, Inbox, Calendar, Settings, the heading "Customers", and the assistant's slot everywhere (the
  // advisor's entry draws 'chat-round', below, lit: icons.ts `advisorRailMark`, 2026-10-09)
  'home-2', 'inbox', 'calendar', 'settings', 'users-group-rounded', 'user-circle',
  // the menus: the assistant's, My business, Setup and Settings
  'chat-square-line', 'notebook-minimalistic', 'question-circle', 'forbidden-circle', 'user-id', 'tuning-2',
  'check-circle', 'play-circle', 'flag', 'history', 'shop', 'box', 'shield-check', 'case', 'dialog', 'chat-round', 'chat-round-line',
  'chat-square', 'letter', 'power', 'bell', 'file-text', 'gift', 'transfer-horizontal', 'video-frame-play-horizontal',
  'checklist', 'users-group-two-rounded', 'key', 'card', 'folder', 'logout',
  // Your data's download, the regular customer, an empty calendar, a customer with no name yet,
  // what a customer sent that is not words, a door, the way back, closing, a door to another site
  'download-minimalistic', 'repeat', 'calendar-minimalistic', 'user', 'paperclip', 'microphone', 'gallery',
  'alt-arrow-right', 'alt-arrow-left', 'close', 'arrow-right-up',
  // the calendar's kinds of date
  'tag', 'reply', 'restart', 'archive', 'pin', 'quote',
  // the owner's choices for the seven gaps (2026-10-05): each kind of reply, how it sells, the language, its
  // price limits, closed days and a closure, this month, an order on its way
  'list', 'hand-money', 'global', 'banknote', 'calendar-mark', 'chart-2', 'delivery',
];


const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOLAR_PKG = join(ROOT, 'node_modules', '@iconify-json', 'solar');
export const SOLAR_LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/';
export const SOLAR_AUTHOR_URL = 'https://www.figma.com/community/file/1166831539721848736';

/** The Linear set's shape: one group, or one path, drawn in a 1.5-unit round line, nothing filled. */
export const LINEAR_SHAPE = /^<(g|path) fill="none" stroke="currentColor" stroke-linecap="round"( stroke-linejoin="round")? stroke-width="1\.5"[^>]*>/;

/** One Linear drawing as the package ships it, or a refusal naming it. */
export function solarDrawingOf(icons, name) {
  const icon = icons.icons[`${name}-linear`];
  if (!icon) throw new Error(`solar ${name}-linear: not in the package`);
  if ((icon.width ?? icons.width) !== 24 || (icon.height ?? icons.height) !== 24) throw new Error(`solar ${name}-linear: not on the 24 grid`);
  if (!LINEAR_SHAPE.test(icon.body) || icon.body.includes("'") || /fill="(?!none")/.test(icon.body)) {
    throw new Error(`solar ${name}-linear: not one group or path of a 1.5-unit round line; this tool copies, it does not redraw`);
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

Nomi draws its icons (src/api/web/solar.ts) from Solar's Linear set, copied from the npm package
@iconify-json/solar ${version} (https://icon-sets.iconify.design/solar/), whose metadata names the author and
this licence: ${SOLAR_WANTED.map((n) => `${n}-linear`).join(', ')}.

Changes: none to the drawings. Each is copied as the package ships it; the app's stylesheet sets its size,
its colour, and the width its line is drawn at on screen (the nav's 1.75 px on the larger icons, a little
less on smaller ones, so every icon reads at the same weight).
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const solar = solarMeta();
  if (solar.license?.spdx !== 'CC-BY-4.0' || solar.author?.name !== '480 Design') {
    console.error(`@iconify-json/solar: licence ${solar.license?.spdx} by ${solar.author?.name}, not CC-BY-4.0 by 480 Design`); process.exit(1);
  }
  if (new Set(SOLAR_WANTED).size !== SOLAR_WANTED.length) { console.error('SOLAR_WANTED names a drawing twice'); process.exit(1); }
  const solarIconsJson = solarIcons();
  const solarLines = SOLAR_WANTED.map((n) => `  '${n}': '${solarDrawingOf(solarIconsJson, n)}',`);
  writeFileSync(join(ROOT, 'src', 'api', 'web', 'solar.ts'), `/**
 * WRITTEN BY tools/icons.mjs from @iconify-json/solar ${solar.version}: Solar by 480 Design, under
 * CC BY 4.0 (${SOLAR_LICENCE_URL}). The attribution is NOTICE and
 * assets/icons/SOLAR-LICENSE.txt. Do not edit by hand: add the icon to the tool's list and run it again.
 *
 * The product's icons: each one's Linear drawing as the package ships it — one group or one path on a
 * 24-unit square, a round line, in the colour of the words around it. Never a filled drawing.
 */
export const SOLAR = {
${solarLines.join('\n')}
} as const;
`);
  mkdirSync(join(ROOT, 'assets', 'icons'), { recursive: true });
  writeFileSync(join(ROOT, 'assets', 'icons', 'SOLAR-LICENSE.txt'), solarAttribution(solar.version));

  console.log(`${SOLAR_WANTED.length} Linear drawings from @iconify-json/solar ${solar.version} (CC BY 4.0, 480 Design)`);
}
