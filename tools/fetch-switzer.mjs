#!/usr/bin/env node
/**
 * THE FONT-AND-ICONS TRIAL (branch trial/font-and-icons, never merged) — your own copy of Switzer.
 *
 * Switzer is Fontshare's (Indian Type Foundry), under the ITF Free Font License v2.0: free for
 * commercial use and for self-hosting, but the files may not be passed on "through a repository … or
 * on publicly accessible servers", and may not be changed (no subsetting, no conversion). This
 * repository is public, so the font is not in it: each person who runs the trial fetches their own
 * copy from Fontshare with this tool, and git ignores where it lands.
 *
 * It writes two files, unchanged from Fontshare's archive, into assets/trial/:
 *   Switzer-Variable.woff2   the variable web font (the trial declares weights 300 to 700)
 *   FFL.txt                  the licence it comes under
 *
 *   node tools/fetch-switzer.mjs                  download Switzer_Complete.zip from Fontshare
 *   node tools/fetch-switzer.mjs --zip <file>     use a Switzer_Complete.zip you already downloaded
 *
 * Needs `unzip` (on every Mac).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SOURCE = 'https://api.fontshare.com/v2/fonts/download/switzer';
const INSIDE = {
  'Switzer-Variable.woff2': 'Switzer_Complete/Fonts/WEB/fonts/Switzer-Variable.woff2',
  'FFL.txt': 'Switzer_Complete/License/FFL.txt',
};
const DEST = new URL('../assets/trial/', import.meta.url);

const args = process.argv.slice(2);
const at = args.indexOf('--zip');
let zip = at >= 0 ? args[at + 1] : null;
if (at >= 0 && !zip) { console.error('--zip needs a file'); process.exit(2); }

if (!zip) {
  console.log(`Fetching Switzer from ${SOURCE} …`);
  const res = await fetch(SOURCE, { redirect: 'follow' });
  if (!res.ok) { console.error(`Fontshare answered ${res.status}. Nothing was written.`); process.exit(1); }
  const body = Buffer.from(await res.arrayBuffer());
  zip = join(mkdtempSync(join(tmpdir(), 'switzer-')), 'Switzer_Complete.zip');
  writeFileSync(zip, body);
  console.log(`  ${body.length.toLocaleString('en')} bytes`);
}

mkdirSync(DEST, { recursive: true });
for (const [name, path] of Object.entries(INSIDE)) {
  const bytes = execFileSync('unzip', ['-p', zip, path], { maxBuffer: 16 * 1024 * 1024 });
  if (bytes.length === 0) { console.error(`${path} is not in ${zip}. Nothing more was written.`); process.exit(1); }
  writeFileSync(new URL(name, DEST), bytes);
  const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  console.log(`  assets/trial/${name}  ${bytes.length.toLocaleString('en')} bytes  sha256 ${sha}…`);
}
const licence = readFileSync(new URL('FFL.txt', DEST), 'utf8');
if (!/ITF Free Font License/i.test(licence)) console.warn('  The licence file does not name the ITF Free Font License — read it before using the font.');
console.log('Done. git ignores assets/trial/: never commit these files (the licence forbids passing them on).');
