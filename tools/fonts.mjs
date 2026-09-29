#!/usr/bin/env node
/**
 * THE TYPE THE PRODUCT IS DRAWN IN, VENDORED (the design pass, decided
 * 2026-09-29: self-host Noto, never from Google — its font servers are
 * blocked or unreliable in mainland China, and every page load would hand the
 * owner's address to a new processor).
 *
 * Reads the Noto families from a directory holding `@fontsource/*` packages
 * (installed OUTSIDE this checkout — the fonts are data here, not a runtime
 * dependency), and writes into `assets/fonts/`:
 *
 *   <file>.<sha256-16>.woff2  each face's file, named by its content, so the
 *                             route may let a browser keep it for good;
 *   faces.json                family, weight, which sheet it belongs to, file,
 *                             and the characters it draws (unicode-range);
 *   OFL.txt                   every family's licence, as it came.
 *
 * Sans 400 and 600 (what the product says), Serif 400 (what a person said),
 * in the three scripts. Only woff2: every browser the product supports reads
 * it. The Chinese faces go in their own sheet (`set: "zh"`) — their rules
 * alone are most of the weight, and only a Chinese page carries them.
 *
 * Usage:
 *   (cd <somewhere outside> && npm install @fontsource/noto-sans@5.3.0 …)
 *   node tools/fonts.mjs <that>/node_modules
 *
 * Refuses to write into a non-empty `assets/fonts/`: move the old one aside
 * first (nothing here deletes).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FAMILIES = [
  { pkg: 'noto-sans', family: 'Noto Sans', weights: [400, 600], set: 'base' },
  { pkg: 'noto-serif', family: 'Noto Serif', weights: [400], set: 'base' },
  { pkg: 'noto-sans-arabic', family: 'Noto Sans Arabic', weights: [400, 600], set: 'base' },
  { pkg: 'noto-naskh-arabic', family: 'Noto Naskh Arabic', weights: [400], set: 'base' },
  { pkg: 'noto-sans-sc', family: 'Noto Sans SC', weights: [400, 600], set: 'zh' },
  { pkg: 'noto-serif-sc', family: 'Noto Serif SC', weights: [400], set: 'zh' },
];

const from = process.argv[2];
if (!from) {
  console.error('usage: node tools/fonts.mjs <node_modules directory holding @fontsource/*>');
  process.exit(2);
}
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
if (existsSync(OUT) && readdirSync(OUT).length > 0) {
  console.error(`${OUT} is not empty. Move it aside first; this tool deletes nothing.`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const faces = [];
const licences = [];
const versions = {};
for (const { pkg, family, weights, set } of FAMILIES) {
  const dir = join(from, '@fontsource', pkg);
  const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  versions[pkg] = meta.version;
  licences.push(`── @fontsource/${pkg} ${meta.version} (${meta.license}) ──\n\n${readFileSync(join(dir, 'LICENSE'), 'utf8').trim()}\n`);
  for (const weight of weights) {
    const css = readFileSync(join(dir, `${weight}.css`), 'utf8');
    for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const body = block[1];
      const said = /font-family:\s*'([^']+)'/.exec(body)?.[1];
      const w = Number(/font-weight:\s*(\d+)/.exec(body)?.[1]);
      const src = /url\(\.\/files\/([a-z0-9-]+)\.woff2\)/.exec(body)?.[1];
      const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim();
      if (said !== family || w !== weight || !src || !range || !/^[U+0-9A-Fa-f?,\s-]+$/.test(range)) {
        console.error(`${pkg} ${weight}: a face this tool cannot read — ${body.replace(/\s+/g, ' ').slice(0, 160)}`);
        process.exit(1);
      }
      const bytes = readFileSync(join(dir, 'files', `${src}.woff2`));
      const file = `${src}.${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.woff2`;
      writeFileSync(join(OUT, file), bytes);
      faces.push({ family, weight, set, file, unicodeRange: range.replace(/\s+/g, '') });
    }
  }
}

writeFileSync(join(OUT, 'faces.json'), `${JSON.stringify({ source: '@fontsource', versions, faces }, null, 1)}\n`);
writeFileSync(join(OUT, 'OFL.txt'), `${licences.join('\n')}`);
const bytes = faces.reduce((n, f) => n + readFileSync(join(OUT, f.file)).length, 0);
console.log(`${faces.length} faces, ${(bytes / 1e6).toFixed(1)} MB, in ${OUT}`);
