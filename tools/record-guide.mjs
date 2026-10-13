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
 * The browser: Playwright's Chromium, or any Chromium named with `--browser
 * <path>` (Brave, Chrome). The recording: Playwright's own when its ffmpeg is
 * installed; otherwise the browser's own screencast (CDP), its frames put
 * together by the system's `ffmpeg` at the moments they were drawn — nothing
 * to download.
 *
 * `KEEP_GUIDE_FRAMES=1` leaves the last video's pictures in `.guide-recording/` to look at.
 *
 * Each language's video shows the demo shop under a name in that language
 * (`NAMES`), saved through the profile form before that language records, so
 * an English video never shows a Chinese name (`--keep-name` leaves it).
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
const LOCALES = (opt('locales') ?? 'en,zh,ar,es,fr').split(',');
// Phase 9 (today-onboarding-new-09) — `--phone`: the same steps at a phone's width. The video is the
// screen at its own size: Playwright records CSS pixels, so a higher density only adds grey around it.
const PHONE = argv.includes('--phone');
const SIZE = PHONE ? { width: 390, height: 844 } : { width: 1024, height: 640 };
const FRAME = SIZE;
const SUFFIX = PHONE ? '.phone' : '';
const BROWSER = opt('browser') ?? process.env.GUIDE_BROWSER;
const KEEP_NAME = argv.includes('--keep-name');

const { messages, t } = await import('../dist/core/owner/i18n/messages.js');
/** The catalogue's own words, through `t` — so "your assistant" is capitalised where a sentence starts. */
const words = (locale, step, n) => {
  const key = `guide.${step}.cap.${n}`;
  if (!messages[locale][key]) throw new Error(`no caption ${key} in ${locale}`);
  return t(locale, key);
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
  await pause(1200);
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
  await el.fill('').catch(() => {});
  await page.keyboard.type(text, { delay: 35 });
  return true;
}

/** What the owner types in each language's video: a shop's own words, never a customer's real ones. */
const SAMPLE = {
  about: { en: 'Storage boxes, baskets and kitchenware, made in Yiwu.', zh: '收纳盒、篮子和厨房用品，义乌生产。', ar: 'صناديق تخزين وسلال وأدوات مطبخ، من صنع ييوو.', es: 'Cajas de almacenaje, cestas y menaje de cocina, hechos en Yiwu.', fr: 'Boîtes de rangement, paniers et articles de cuisine, fabriqués à Yiwu.' },
  list: { en: 'Storage box  2.40\nBamboo basket  3.10', zh: '收纳盒  2.40\n竹篮  3.10', ar: 'صندوق تخزين  2.40\nسلة خيزران  3.10', es: 'Caja de almacenaje  2.40\nCesta de bambú  3.10', fr: 'Boîte de rangement  2.40\nPanier en bambou  3.10' },
  ask: { en: 'Hi, do you have the storage box in blue?', zh: '你好，收纳盒有蓝色的吗？', ar: 'مرحبًا، هل يتوفر صندوق التخزين باللون الأزرق؟', es: 'Hola, ¿tienen la caja de almacenaje en azul?', fr: 'Bonjour, avez-vous la boîte de rangement en bleu ?' },
};
let LOCALE = 'en';

/** The demo shop's name in each language's video: a Yiwu housewares maker, as its own words say. */
const NAMES = { en: 'Hongfa Housewares', zh: '宏发日用品厂', ar: 'هونغفا للأدوات المنزلية', es: 'Hongfa Artículos para el Hogar', fr: 'Hongfa Articles Ménagers' };

/** Each step: what is shown under each caption. `cue(n)` marks the caption's start. */
const SCRIPTS = {
  // The warmth run (w4-whole-10) — each video walks the way its first caption names: Settings, then the
  // menu rows, tapped as an owner taps them; never an address typed in.
  async profile(page, cue) {
    await page.goto(`${BASE}/app/settings`); cue(1); await pause(2400);
    await press(page, 'main a[href="/app/business"]'); await pause(1400);
    await press(page, 'main a[href="/app/settings/profile"]'); cue(2); await pause(1600);
    await typeInto(page, 'main textarea[name="description"]', SAMPLE.about[LOCALE]);
    await pause(3000);
    cue(3); await point(page, 'main form:not([action="/logout"]) button[type="submit"]'); await pause(5000);
  },
  async products(page, cue) {
    await page.goto(`${BASE}/app/settings`); cue(1); await pause(2400);
    await press(page, 'main a[href="/app/business"]'); await pause(1400);
    await press(page, 'main a[href="/app/products"]'); await pause(1400);
    await press(page, 'main a[href="/app/products/add"]'); cue(2); await pause(1600);
    await typeInto(page, 'main textarea', SAMPLE.list[LOCALE]);
    await pause(1600);
    await point(page, 'main input[type="file"], main label[for*="photo"], main a[href*="import"]'); await pause(2400);
    cue(3);
    if (await press(page, 'main form:not([action="/logout"]) button.send, main form:not([action="/logout"]) button[type="submit"]')) {
      await pause(2400);
      await point(page, 'main input[type="checkbox"]'); await pause(3600);
    } else await pause(5000);
  },
  async name(page, cue) {
    await page.goto(`${BASE}/app/settings`); cue(1); await pause(2400);
    await press(page, 'main a[href="/app/settings/setup"]'); await pause(1400);
    await press(page, 'main a[href="/app/onboarding"]'); await pause(1600);
    // One selector each: a selector list matches in page order, so a list would point at the page's first box or button.
    cue(2); await point(page, 'main form[action="/app/onboarding/assistant-name"] input[name="name"]'); await pause(4000);
    cue(3); await point(page, 'main form[action="/app/onboarding/assistant-name"] button[type="submit"]'); await pause(5000);
  },
  async channels(page, cue) {
    await page.goto(`${BASE}/app/settings`); cue(1); await pause(2400);
    await press(page, 'main a[href="/app/business"]'); await pause(1400);
    await press(page, 'main a[href="/app/business/channels"]'); await pause(2400);
    cue(2);
    await press(page, 'main a[href="/app/channels/meta"]'); await pause(1600);
    await point(page, 'main a[href="/app/connect/meta/start"], main form[action*="/connect"] button, main a[href*="/connect"]');
    await pause(4400);
    cue(3); await pause(6000);
  },
  async first_success(page, cue) {
    // Practice starts over first, so each language's video shows only its own customer's words.
    await page.context().request.post(`${BASE}/app/sandbox/reset`, { maxRedirects: 0 });
    await page.goto(`${BASE}/app/sandbox`); cue(1); await pause(3000);
    await typeInto(page, 'main form[action="/app/sandbox/message"] textarea', SAMPLE.ask[LOCALE]);
    await pause(1200);
    await press(page, 'main form[action="/app/sandbox/message"] button[type="submit"]');
    cue(2); await pause(2000);
    // The reply is written by the worker: the page is read again until "writing a reply" has gone (up to 15 s),
    // then the reply itself is shown — the assistant's message, or the draft waiting for the owner.
    for (let i = 0; i < 10; i++) {
      await page.reload(); await page.waitForLoadState('networkidle').catch(() => {});
      if (await page.locator('main .block.working').count() === 0) break;
      await pause(1500);
    }
    if (!(await point(page, 'main .bubble.by-as'))) await point(page, 'main form[action="/app/sandbox/reply"] textarea, main .draft');
    await pause(4000);
    // The step is done in the Inbox: the video ends there, where the caption says.
    cue(3); await press(page, 'a[href="/app/inbox"]'); await pause(5000);
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

/** Without Playwright's ffmpeg, the browser's own screencast, put together by the system's ffmpeg. */
const SYSTEM_FFMPEG = (() => {
  const r = spawnSync('sh', ['-c', 'command -v ffmpeg']);
  return r.status === 0 ? r.stdout.toString().trim() : null;
})();
const SCREENCAST = !ffmpeg;
if (SCREENCAST && !SYSTEM_FFMPEG) throw new Error('no ffmpeg: install Playwright\'s (npx playwright install ffmpeg) or put ffmpeg on PATH');
const ENCODE = ['-an', '-c:v', 'libvpx', '-b:v', '350k', '-crf', '32'];

/** Every frame the page draws, with the moment it arrived (the same clock as the captions' cues). */
async function screencast(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    frames.push({ data, at: Date.now() });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 });
  return { frames, stop: () => cdp.send('Page.stopScreencast').catch(() => {}) };
}

/**
 * The frames as a video, on an exact 25-a-second clock: each tick is one picture, the newest frame drawn by then (a
 * still page draws none, so its last frame simply stays). Read back as a plain image sequence — ffmpeg's concat
 * reader stretches still images, so it is not used.
 */
async function assemble(frames, from, until, file) {
  const dir = path.join(tmp, 'frames');
  await mkdir(dir, { recursive: true });
  if (frames.length === 0) throw new Error(`no frame was drawn for ${file}`);
  const TICK = 40;
  let i = 0;
  let n = 0;
  let picture = null;
  for (let t = from; t < until; t += TICK, n++) {
    const before = i;
    while (i + 1 < frames.length && frames[i + 1].at <= t) i++;
    if (picture === null || i !== before) picture = Buffer.from(frames[i].data, 'base64');
    await writeFile(path.join(dir, `${String(n).padStart(5, '0')}.jpg`), picture);
  }
  const { width, height } = SIZE;
  const r = spawnSync(SYSTEM_FFMPEG, ['-y', '-loglevel', 'error', '-framerate', '25', '-i', path.join(dir, '%05d.jpg'),
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p`,
    ...ENCODE, file]);
  if (r.status !== 0) throw new Error(`ffmpeg could not put ${file} together: ${r.stderr}`);
}

/** Signed in with the access code, through the context, before any page is drawn. */
async function signedIn(context) {
  const login = await context.request.post(`${BASE}/login`, { form: { code: CODE }, maxRedirects: 0 });
  if (login.status() !== 302) throw new Error(`sign-in refused: ${login.status()}`);
}

/** The shop's name in this language, saved the way an owner saves it: the profile form, every other field as it is. */
async function nameTheShop(locale) {
  const context = await browser.newContext({ viewport: SIZE });
  await context.addCookies([{ name: 'yf_locale', value: locale, url: BASE }]);
  await signedIn(context);
  const page = await context.newPage();
  await page.goto(`${BASE}/app/settings/profile`);
  const field = page.locator('main form[action="/app/settings"] input[name="name"]');
  await field.fill(NAMES[locale]);
  // The page is already at the profile's address: wait for the form's own answer, not for an address.
  const [saved] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/app/settings'),
    field.evaluate((el) => el.form.requestSubmit()),
  ]);
  if (saved.status() !== 302) throw new Error(`the shop's name was not saved (${saved.status()})`);
  await page.waitForLoadState('load');
  await context.close();
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(BROWSER ? { executablePath: BROWSER } : {});
const tmp = path.join(ROOT, '.guide-recording');
for (const locale of LOCALES) {
  LOCALE = locale;
  if (!KEEP_NAME) await nameTheShop(locale);
  for (const step of STEPS) {
    await rm(tmp, { recursive: true, force: true });
    const context = await browser.newContext({ viewport: SIZE, ...(SCREENCAST ? {} : { recordVideo: { dir: tmp, size: FRAME } }), locale: locale === 'zh' ? 'zh-CN' : locale });
    await context.addCookies([{ name: 'yf_locale', value: locale, url: BASE }]);
    await context.addInitScript(POINTER);
    await signedIn(context);
    const page = await context.newPage();
    const cast = SCREENCAST ? await screencast(page) : null;
    const videoStart = Date.now();
    const t0 = Date.now();
    const cues = [];
    await SCRIPTS[step](page, (n) => cues.push({ n, at: Date.now() - t0 }));
    const end = Date.now() - t0 + 400;
    const file = path.join(OUT, `${step}.${locale}${SUFFIX}.webm`);
    let lead = 0;
    if (cast) {
      await pause(400);
      await cast.stop();
      await context.close();
      await assemble(cast.frames, t0, t0 + end, file);
    } else {
      const video = page.video();
      await context.close();
      const raw = await video.path();
      // The recording began before sign-in. With ffmpeg the sign-in is cut off and
      // the video starts with the step; without it, the captions start later instead.
      const signIn = t0 - videoStart;
      lead = signIn;
      const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', (signIn / 1000).toFixed(2), '-i', raw, ...ENCODE, file]);
      if (r.status === 0) lead = 0; else await rename(raw, file);
    }
    // Each caption runs until the next begins, the last until the video ends.
    const vtt = ['WEBVTT', ''];
    cues.forEach((c, i) => {
      const from = c.at + lead; const to = (cues[i + 1]?.at ?? end) + lead;
      vtt.push(`${i + 1}`, `${ts(from)} --> ${ts(to)}`, words(locale, step, c.n), '');
    });
    await writeFile(path.join(OUT, `${step}.${locale}${SUFFIX}.vtt`), vtt.join('\n'));
    console.log(`${step}.${locale}${SUFFIX}: ${cues.length} captions, ${((end) / 1000).toFixed(1)} s`);
  }
}
await browser.close();
if (!process.env.KEEP_GUIDE_FRAMES) await rm(tmp, { recursive: true, force: true });
console.log(`written to ${path.relative(ROOT, OUT)} — ${(await readdir(OUT)).length} files`);
