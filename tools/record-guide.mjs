#!/usr/bin/env node
/**
 * THE GUIDE'S VIDEOS — recorded from the finished pages, never drawn.
 *
 * For each setup step and each owner language, this drives a real, local,
 * seeded Nomi (the run-nomi smoke instance) through the pages that step uses,
 * in a real browser, and records it: `assets/guide/<step>.<locale>.webm`, with
 * its captions `<step>.<locale>.vtt`. The captions are the catalogue's own
 * words (`guide.<step>.cap.N`), timed to the moment each part of the step is
 * shown — the same words the guide page prints under the video.
 *
 * Nothing here reaches Meta or any customer: the instance runs with messaging
 * disabled, and Meta's own window is never opened (the channels video stops at
 * Nomi's button, and its caption says what Meta's window asks).
 *
 *   SK=<scratch dir> bash .claude/skills/run-nomi/smoke.sh   # once: the seeded app on :8787
 *   node tools/record-guide.mjs                              # every step, every language
 *   node tools/record-guide.mjs --steps products --locales es
 *
 * Needs Playwright's Chromium (`npx playwright install chromium`). The webm is
 * re-encoded smaller with Playwright's own ffmpeg when it is there.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, rm, readdir, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const BASE = (opt('base') ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const CODE = opt('code') ?? process.env.OWNER_ACCESS_CODE ?? 'smoke-code';
const OUT = path.join(ROOT, 'assets', 'guide');
const STEPS = (opt('steps') ?? 'profile,products,name,channels,first_success').split(',');
const LOCALES = (opt('locales') ?? 'en,zh,ar,es').split(',');
const SIZE = { width: 1024, height: 640 };

const { messages } = await import('../dist/core/owner/i18n/messages.js');
const NAME_FALLBACK = { en: 'your assistant', zh: '你的助手', ar: 'مساعدك', es: 'tu asistente' };
const words = (locale, step, n, name) => {
  const s = messages[locale][`guide.${step}.cap.${n}`];
  if (!s) throw new Error(`no caption guide.${step}.cap.${n} in ${locale}`);
  const filled = s.split('{name}').join(name);
  return filled.charAt(0).toLocaleUpperCase() + filled.slice(1);
};

/** A visible pointer, so a viewer can follow what is pressed. Not part of the product. */
const POINTER = `
  window.addEventListener('DOMContentLoaded', () => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;z-index:2147483647;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;'
      + 'background:rgba(28,27,31,.35);border:2px solid #1C1B1F;pointer-events:none;left:-40px;top:-40px;transition:transform .12s';
    document.body.appendChild(d);
    addEventListener('mousemove', (e) => { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { d.style.transform = 'scale(.7)'; }, true);
    addEventListener('mouseup', () => { d.style.transform = 'scale(1)'; }, true);
  });`;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function point(page, selector) {
  const el = page.locator(selector).first();
  if (!(await el.count())) return null;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const box = await el.boundingBox();
  if (!box) return null;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await pause(300);
  return el;
}
async function press(page, selector) {
  const el = await point(page, selector);
  if (!el) return false;
  await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), el.click()]);
  await page.waitForLoadState('networkidle').catch(() => {});
  return true;
}
async function typeInto(page, selector, text) {
  const el = await point(page, selector);
  if (!el) return false;
  await el.click();
  await page.keyboard.type(text, { delay: 35 });
  return true;
}

/** Each step: what is shown under each caption. `cue(n)` marks the caption's start. */
const SCRIPTS = {
  async profile(page, cue) {
    await page.goto(`${BASE}/app/settings`); cue(1); await pause(1500);
    await press(page, 'a[href="/app/settings/profile"]'); cue(2); await pause(800);
    await typeInto(page, 'textarea[name="description"]', ' ');
    await pause(1500);
    cue(3); await point(page, 'form button[type="submit"]'); await pause(2500);
  },
  async products(page, cue) {
    await page.goto(`${BASE}/app/products`); cue(1); await pause(1500);
    await press(page, 'a[href="/app/products/add"]'); cue(2); await pause(800);
    await typeInto(page, 'textarea', 'Canvas tote  18.00\nWool scarf  24.00');
    await pause(800);
    await point(page, 'input[type="file"], label[for*="photo"], a[href*="import"]'); await pause(1200);
    cue(3);
    if (await press(page, 'form button.send, form button[type="submit"]')) {
      await pause(1200);
      await point(page, 'input[type="checkbox"]'); await pause(1800);
    } else await pause(2500);
  },
  async name(page, cue) {
    await page.goto(`${BASE}/app/onboarding`); cue(1); await pause(1800);
    cue(2); await point(page, 'input[name="name"], input[name="assistant_name"], #name'); await pause(2000);
    cue(3); await point(page, 'form button[type="submit"]'); await pause(2500);
  },
  async channels(page, cue) {
    await page.goto(`${BASE}/app/channels`); cue(1); await pause(1800);
    cue(2); await point(page, 'a[href="/app/connect/meta/start"], a[href="/app/connect/whatsapp/start"], form[action="/app/channels/whatsapp/connect"] button, a[href="/app/channels/whatsapp/connect"]');
    await pause(2200);
    cue(3); await pause(3000);
  },
  async first_success(page, cue) {
    await page.goto(`${BASE}/app/sandbox`); cue(1); await pause(1500);
    await typeInto(page, 'textarea[name="text"], textarea', 'Hi, do you have the canvas tote in green?');
    await pause(600);
    await press(page, 'form button.send, form button[type="submit"]');
    cue(2); await pause(3500);
    await point(page, '.draft, .bubble:last-of-type, textarea'); await pause(1500);
    cue(3); await pause(2500);
  },
};

const ts = (ms) => {
  const h = Math.floor(ms / 3_600_000); const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000); const f = Math.floor(ms % 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
};

const ffmpeg = (() => {
  const base = path.join(homedir(), 'Library', 'Caches', 'ms-playwright');
  for (const d of ['ffmpeg-1011', 'ffmpeg-1010']) {
    for (const f of ['ffmpeg-mac', 'ffmpeg-linux', 'ffmpeg']) {
      const p = path.join(base, d, f);
      if (spawnSync('test', ['-x', p]).status === 0) return p;
    }
  }
  return null;
})();

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const tmp = path.join(ROOT, '.guide-recording');
for (const locale of LOCALES) {
  for (const step of STEPS) {
    await rm(tmp, { recursive: true, force: true });
    const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: tmp, size: SIZE }, locale: locale === 'zh' ? 'zh-CN' : locale });
    await context.addCookies([{ name: 'yf_locale', value: locale, url: BASE }]);
    await context.addInitScript(POINTER);
    const page = await context.newPage();
    const videoStart = Date.now();
    // Sign in before the clock that matters: the first caption is set by the step itself.
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="code"]', CODE).catch(() => {});
    await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), page.locator('form[action="/login"] button[type="submit"], form button[type="submit"]').first().click()]);
    // The captions serve every business: they say "your assistant", whatever this demo calls its own.
    const name = NAME_FALLBACK[locale];
    const t0 = Date.now();
    const cues = [];
    await SCRIPTS[step](page, (n) => cues.push({ n, at: Date.now() - t0 }));
    const end = Date.now() - t0 + 400;
    const video = page.video();
    await context.close();
    const raw = await video.path();
    // The recording began before sign-in. With ffmpeg the sign-in is cut off and
    // the video starts with the step; without it, the captions start later instead.
    const signIn = t0 - videoStart;
    const file = path.join(OUT, `${step}.${locale}.webm`);
    let lead = signIn;
    if (ffmpeg) {
      const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', (signIn / 1000).toFixed(2), '-i', raw, '-an',
        '-c:v', 'libvpx', '-b:v', '350k', '-crf', '32', file]);
      if (r.status === 0) lead = 0; else await rename(raw, file);
    } else await rename(raw, file);
    // Each caption runs until the next begins, the last until the video ends.
    const vtt = ['WEBVTT', ''];
    cues.forEach((c, i) => {
      const from = c.at + lead; const to = (cues[i + 1]?.at ?? end) + lead;
      vtt.push(`${i + 1}`, `${ts(from)} --> ${ts(to)}`, words(locale, step, c.n, name), '');
    });
    await writeFile(path.join(OUT, `${step}.${locale}.vtt`), vtt.join('\n'));
    console.log(`${step}.${locale}: ${cues.length} captions, ${((end) / 1000).toFixed(1)} s`);
  }
}
await browser.close();
await rm(tmp, { recursive: true, force: true });
console.log(`written to ${path.relative(ROOT, OUT)} — ${(await readdir(OUT)).length} files`);
