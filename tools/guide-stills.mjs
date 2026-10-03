#!/usr/bin/env node
/**
 * PHASE 6 OF THE UI REBUILD (2026-10-02) — each guide video's still frame and
 * length, so the page shows a picture of the step and how long it takes
 * instead of a black box with a loading ring (the audit's guide finding).
 *
 *   node tools/guide-stills.mjs          (needs ffmpeg and ffprobe on PATH)
 *
 * For every `assets/guide/<step>.<locale>.webm` it writes `<step>.<locale>.jpg`
 * (a frame two seconds in, 960 px wide) and `lengths.json` (seconds, by name).
 * Run it after `tools/record-guide.mjs` records the videos again.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'guide');
const lengths = {};
for (const f of readdirSync(DIR).filter((x) => /^[a-z_]+\.[a-z]{2}(\.phone)?\.webm$/.test(x)).sort()) {
  const name = f.replace(/\.webm$/, '');
  const at = path.join(DIR, f);
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', at]).toString().trim());
  lengths[name] = Math.round(seconds);
  // A phone recording keeps its own width (the 390 px screen), so its words stay readable.
  const width = name.endsWith('.phone') ? 390 : 960;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '2', '-i', at, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '7', path.join(DIR, `${name}.jpg`)]);
  console.log(`${name}: ${lengths[name]} s`);
}
writeFileSync(path.join(DIR, 'lengths.json'), `${JSON.stringify(lengths, null, 2)}\n`);
