#!/usr/bin/env node
/**
 * THE SPLIT TODAY PREVIEW'S TWO SERIF FACES, VENDORED (2026-11-04). Newsreader (Latin headings and big money, with its
 * optical-size axis) and Noto Naskh Arabic drawn at every weight (the Arabic that matches it). Both SIL OFL 1.1.
 *
 * They are added to `assets/fonts/` beside the product's own faces, marked `set: 'split'`: the shell's two type sheets
 * do not carry them; only `/assets/split.<hash>.css` does (`SPLIT_FACES_CSS`, type.ts), and only Today links that while
 * `SPLIT_TODAY=on`. Run again, it replaces its own entries and nothing else.
 *
 *   (cd <somewhere outside> && npm install @fontsource-variable/newsreader @fontsource-variable/noto-naskh-arabic)
 *   node tools/fonts-split.mjs <that>/node_modules
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { woff2Characters, drawnWithin, formatUnicodeRange } from './lib/woff2.mjs';

const FACES = [
  { pkg: 'newsreader', family: 'Newsreader Variable', css: 'opsz.css', slices: ['latin-opsz-normal', 'latin-ext-opsz-normal'], weight: [200, 800] },
  { pkg: 'noto-naskh-arabic', family: 'Noto Naskh Arabic Variable', css: 'wght.css', slices: ['arabic-wght-normal'], weight: [400, 700] },
];

const from = process.argv[2];
if (!from) { console.error('usage: node tools/fonts-split.mjs <node_modules holding @fontsource-variable/*>'); process.exit(2); }
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
const manifest = JSON.parse(readFileSync(join(OUT, 'faces.json'), 'utf8'));
manifest.faces = manifest.faces.filter((f) => f.set !== 'split');
let licences = readFileSync(join(OUT, 'OFL.txt'), 'utf8');

for (const { pkg, family, css, slices, weight } of FACES) {
  const dir = join(from, '@fontsource-variable', pkg);
  const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (meta.license !== 'OFL-1.1') { console.error(`${pkg}: licence ${meta.license}, not OFL-1.1`); process.exit(1); }
  manifest.versions[`variable/${pkg}`] = meta.version;
  if (!licences.includes(`@fontsource-variable/${pkg} `)) {
    licences = `${licences.trimEnd()}\n\n── @fontsource-variable/${pkg} ${meta.version} (${meta.license}) ──\n\n${readFileSync(join(dir, 'LICENSE'), 'utf8').trim()}\n`;
  }
  const rules = readFileSync(join(dir, css), 'utf8');
  for (const slice of slices) {
    const name = `${pkg}-${slice}`;
    const block = [...rules.matchAll(/@font-face\s*\{([^}]*)\}/g)].find((m) => m[1].includes(`/${name}.woff2`));
    const range = block && /unicode-range:\s*([^;]+);/.exec(block[1])?.[1]?.replace(/\s+/g, '');
    if (!range) { console.error(`${name}: not in ${css}`); process.exit(1); }
    const bytes = readFileSync(join(dir, 'files', `${name}.woff2`));
    const drawn = drawnWithin(range, woff2Characters(bytes));
    const file = `${name}.${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.woff2`;
    writeFileSync(join(OUT, file), bytes);
    manifest.faces.push({ family, weight, set: 'split', file, unicodeRange: formatUnicodeRange(drawn) });
    console.log(`${file}  ${(bytes.length / 1024).toFixed(0)} KB`);
  }
}
writeFileSync(join(OUT, 'faces.json'), `${JSON.stringify(manifest, null, 1)}\n`);
writeFileSync(join(OUT, 'OFL.txt'), licences);
