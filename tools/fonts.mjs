#!/usr/bin/env node
/**
 * THE TYPE THE PRODUCT IS DRAWN IN, VENDORED (the design pass, decided
 * 2026-09-29: self-host Noto, never from Google — its font servers are
 * blocked or unreliable in mainland China, and every page load would hand the
 * owner's address to a new processor).
 *
 * THE TYPE PASS (2026-10-04) — the owner: "Only two weights render anywhere.
 * Load the full useful weight range." The three Sans families (what the
 * product says, in Latin, Chinese and Arabic) are now VARIABLE files: one
 * file per character slice carries every weight, so a page draws 300 to 700
 * from the same download it used to need twice for 400 and 600. The Serif
 * voice (what a person said) stays at 400, from the files already vendored.
 *
 * Reads `@fontsource-variable/{noto-sans,noto-sans-sc,noto-sans-arabic}` from
 * a directory holding them (installed OUTSIDE this checkout — the fonts are
 * data here, not a runtime dependency), keeps the Serif faces from the
 * folder given as `--keep`, and writes into `assets/fonts/`:
 *
 *   <file>.<sha256-16>.woff2  each face's file, named by its content, so the
 *                             route may let a browser keep it for good;
 *   faces.json                family, weight (a number, or [first, last] for
 *                             a variable file), which sheet it belongs to,
 *                             file, and the characters it draws;
 *   OFL.txt                   every family's licence, as it came.
 *
 * EVERY FACE PROMISES ONLY WHAT ITS FILE DRAWS. A package's `unicode-range`
 * is cut to the characters the file's own map holds (`tools/lib/woff2.mjs`):
 * the Arabic face's symbols slice claimed ○ ✓ ✦ without drawing them, so every
 * page fetched it for nothing. The invisible characters a browser needs no
 * glyph for (direction marks, isolates) stay where the package named them. A
 * slice left with no character is dropped.
 *
 * Usage:
 *   (cd <somewhere outside> && npm install @fontsource-variable/noto-sans@5.3.0 \
 *      @fontsource-variable/noto-sans-sc@5.3.0 @fontsource-variable/noto-sans-arabic@5.3.0)
 *   mv assets/fonts <somewhere outside>/fonts-before
 *   node tools/fonts.mjs <that>/node_modules --keep <somewhere outside>/fonts-before
 *
 * Refuses to write into a non-empty `assets/fonts/`: move the old one aside
 * first (nothing here deletes).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { woff2Characters, drawnWithin, formatUnicodeRange } from './lib/woff2.mjs';

/** The weights the product draws: light 300 to bold 700 (the type pass). A variable face is declared over exactly these. */
const WEIGHTS = [300, 700];
const VARIABLE = [
  { pkg: 'noto-sans', family: 'Noto Sans', set: 'base' },
  { pkg: 'noto-sans-arabic', family: 'Noto Sans Arabic', set: 'base' },
  { pkg: 'noto-sans-sc', family: 'Noto Sans SC', set: 'zh' },
];
/** Kept as vendored on 2026-09-29 (`@fontsource/*` 5.3.0, 400 only): the voice. */
const KEPT = ['Noto Serif', 'Noto Naskh Arabic', 'Noto Serif SC'];

const args = process.argv.slice(2);
const from = args[0];
const keep = args[args.indexOf('--keep') + 1];
if (!from || !args.includes('--keep') || !keep) {
  console.error('usage: node tools/fonts.mjs <node_modules holding @fontsource-variable/*> --keep <the folder the voice faces are in now>');
  process.exit(2);
}
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
if (existsSync(OUT) && readdirSync(OUT).length > 0) {
  console.error(`${OUT} is not empty. Move it aside first; this tool deletes nothing.`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const faces = [];
const versions = {};
const licences = [];
let dropped = 0;

/** Cut a face's range to what its file draws; write the file under its content's name. */
function vendor(bytes, src, face) {
  const drawn = drawnWithin(face.unicodeRange, woff2Characters(bytes));
  if (drawn.length === 0) { dropped += 1; return; }
  const file = `${src}.${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.woff2`;
  writeFileSync(join(OUT, file), bytes);
  faces.push({ ...face, file, unicodeRange: formatUnicodeRange(drawn) });
}

for (const { pkg, family, set } of VARIABLE) {
  const dir = join(from, '@fontsource-variable', pkg);
  const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (meta.license !== 'OFL-1.1') { console.error(`${pkg}: licence ${meta.license}, not OFL-1.1`); process.exit(1); }
  versions[`variable/${pkg}`] = meta.version;
  licences.push(`── @fontsource-variable/${pkg} ${meta.version} (${meta.license}) ──\n\n${readFileSync(join(dir, 'LICENSE'), 'utf8').trim()}\n`);
  const css = readFileSync(join(dir, 'wght.css'), 'utf8');
  for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = block[1];
    const said = /font-family:\s*'([^']+)'/.exec(body)?.[1];
    const range = /font-weight:\s*(\d+)\s+(\d+)/.exec(body);
    const src = /url\(\.\/files\/([a-z0-9-]+)\.woff2\)/.exec(body)?.[1];
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.replace(/\s+/g, '');
    if (said !== `${family} Variable` || !range || Number(range[1]) > WEIGHTS[0] || Number(range[2]) < WEIGHTS[1]
      || !src || !unicodeRange || !/^[U+0-9A-Fa-f?,-]+$/.test(unicodeRange) || /italic/.test(body)) {
      console.error(`${pkg}: a face this tool cannot read — ${body.replace(/\s+/g, ' ').slice(0, 160)}`);
      process.exit(1);
    }
    vendor(readFileSync(join(dir, 'files', `${src}.woff2`)), src, { family, weight: WEIGHTS, set, unicodeRange });
  }
}

const before = JSON.parse(readFileSync(join(keep, 'faces.json'), 'utf8'));
for (const f of before.faces.filter((x) => KEPT.includes(x.family))) {
  const src = f.file.replace(/\.[0-9a-f]{16}\.woff2$/, '');
  vendor(readFileSync(join(keep, f.file)), src, { family: f.family, weight: f.weight, set: f.set, unicodeRange: f.unicodeRange });
}
for (const [pkg, v] of Object.entries(before.versions)) if (/serif|naskh/.test(pkg)) versions[pkg] = v;
for (const section of readFileSync(join(keep, 'OFL.txt'), 'utf8').split(/(?=^── )/m)) {
  if (/^── @fontsource\/(noto-serif|noto-naskh-arabic|noto-serif-sc) /.test(section)) licences.push(section.trim() + '\n');
}

writeFileSync(join(OUT, 'faces.json'), `${JSON.stringify({ source: '@fontsource', versions, faces }, null, 1)}\n`);
writeFileSync(join(OUT, 'OFL.txt'), `${licences.join('\n')}`);
const bytes = faces.reduce((n, f) => n + readFileSync(join(OUT, f.file)).length, 0);
console.log(`${faces.length} faces (${dropped} slices dropped: they draw nothing their range named), ${(bytes / 1e6).toFixed(1)} MB, in ${OUT}`);
