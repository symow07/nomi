#!/usr/bin/env node
/**
 * THE AD HOOKS — three 9:16 clips, each under ten seconds, cut from the site's reel (Phase 3b, the owner's
 * decision at the stop-gate, 2026-10-13). Each is one beat of the reel, as the reel plays it on /site/next, under
 * its hook line:
 *
 *   1 · "Answered at three a.m."               — the late question, the disclosure, the answer
 *   2 · "A better price, inside your limits"   — the example's price coming down, waiting for the owner's tap
 *   3 · "Yes, confirmed, proforma ready"       — the owner confirms; the proforma is ready to send
 *
 * Drawn from the built reel (`dist/api/web/siteReel.js`), never redrawn: the phone, its made-up shop and its
 * "Example" mark are the page's own. Frame by frame — every animation is paused and set to the frame's moment
 * before its picture is taken — so a clip is exact whatever the machine's speed. English only: the reel's other
 * four languages wait on their native read (REEL_NATIVE_REVIEW).
 *
 *   npm run build && node tools/record-hooks.mjs [--browser <path to a Chromium>]
 *
 * Writes docs/marketing/hooks/hook-<n>-<name>.mp4 (H.264, 1080×1920, 30 fps, no sound) and a still of each.
 * Needs ffmpeg on PATH.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const BROWSER = opt('browser') ?? process.env.GUIDE_BROWSER;
const OUT = path.join(ROOT, 'docs', 'marketing', 'hooks');
const TMP = path.join(ROOT, '.hook-frames');

const { renderSiteReel } = await import('../dist/api/web/siteReel.js');
const { t } = await import('../dist/core/owner/i18n/messages.js');

/** The reel's own clock (siteReel.ts): a scene is five seconds; scene n starts at 5n; it is fully in from 0.3 to 4.7 s. */
const SCENE = 5;
const IN = 4.7;
const HOLD = 2.5;
const FPS = 30;
const HOOKS = [
  { n: 1, name: 'answered', scene: 0, line: 'Answered at three a.m.' },
  { n: 2, name: 'better-price', scene: 1, line: 'A better price, inside your limits' },
  { n: 3, name: 'confirmed', scene: 2, line: 'Yes, confirmed, proforma ready' },
];

const page = renderSiteReel({ locale: 'en', path: '/site/next', noindex: true, contact: null, signIn: '/login', signUp: null });
const styles = [...page.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const phone = /<figure class="rl-phone"[\s\S]*?<\/figure>/.exec(page)?.[0];
if (!phone) throw new Error('the reel has no phone: is dist/ built from this checkout?');

/**
 * One 9:16 frame: the hook line, the reel's phone, the product's name and its sentence. The phone shows only this
 * hook's scene, and is as tall as that scene's words (the owner's note, 2026-10-14: no dead gap between the last
 * bubble and the caption) — the reel's stage keeps one height for all four scenes; a hook has one.
 */
const frame = (line, scene) => `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><style>${styles}
  html, body { margin:0; block-size:100%; background:var(--color-paper); }
  /* One column, top to bottom. The site's own rules place the phone in a named grid area and keep it narrow and
     sticky: here it is the frame's full width, in the flow. */
  .hook { box-sizing:border-box; block-size:100vh; display:grid; grid-template-columns:minmax(0, 1fr);
    grid-template-rows:auto 1fr auto; gap:24px; padding:48px 32px 40px; }
  .hook-line { margin:0; font-size:44px; line-height:1.12; font-weight:700; letter-spacing:-0.01em; color:var(--color-ink); text-wrap:balance; }
  .hook .rl-phone { grid-area:auto; position:static; inline-size:100%; max-width:none; justify-self:stretch; margin:0; align-self:center; }
  .hook .rl-chat { block-size:auto; }
  .hook .rl-scene { position:static; display:none; }
  .hook .rl-scene.rl-s${scene} { display:flex; }
  .hook-end { margin:0; display:flex; flex-direction:column; gap:6px; color:var(--color-ink-secondary); font-size:17px; }
  .hook-end b { color:var(--color-brand); font-size:24px; }
</style></head><body><div class="hook">
  <p class="hook-line">${line}</p>
  ${phone}
  <p class="hook-end"><b>Nomi</b><span>${t('en', 'site.reel.title')}</span></p>
</div></body></html>`;

const ffmpeg = spawnSync('sh', ['-c', 'command -v ffmpeg']).stdout?.toString().trim();
if (!ffmpeg) throw new Error('ffmpeg is not on PATH');

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(BROWSER ? { executablePath: BROWSER } : {});
for (const hook of HOOKS) {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, reducedMotion: 'no-preference' });
  const tab = await context.newPage();
  await tab.setContent(frame(hook.line, hook.scene), { waitUntil: 'load' });
  await tab.evaluate(() => document.fonts.ready);
  await tab.evaluate(() => { for (const a of document.getAnimations()) a.pause(); });
  const count = Math.round(IN * FPS);
  for (let i = 0; i < count; i++) {
    // Every animation at the same moment of the page's life: the reel's own phases do the rest.
    const at = (hook.scene * SCENE + i / FPS) * 1000;
    await tab.evaluate((ms) => { for (const a of document.getAnimations()) a.currentTime = ms; }, at);
    await tab.screenshot({ path: path.join(TMP, `${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  await context.close();
  const file = path.join(OUT, `hook-${hook.n}-${hook.name}.mp4`);
  // The scene, then its last frame held: the line and the outcome stay long enough to read.
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(TMP, '%04d.jpg'),
    '-vf', `scale=1080:1920,tpad=stop_mode=clone:stop_duration=${HOLD},format=yuv420p`,
    '-c:v', 'libx264', '-profile:v', 'high', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', '-an', file]);
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-sseof', '-0.5', '-i', file, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '5',
    path.join(OUT, `hook-${hook.n}-${hook.name}.jpg`)]);
  const seconds = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).stdout.toString().trim());
  if (!(seconds < 10)) throw new Error(`${file} runs ${seconds} s: a hook is under ten`);
  console.log(`hook-${hook.n}-${hook.name}.mp4: ${seconds.toFixed(1)} s`);
}
await browser.close();
await rm(TMP, { recursive: true, force: true });
