#!/usr/bin/env node
/**
 * The public site's pictures of the app (F45), taken from the LOCAL site demo workspace and written to
 * assets/site/<name>.<locale>.<wide|phone>.webp.
 *
 *   MIGRATE_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/nomi node tools/seed-site-demo.mjs
 *   # start the server with PILOT_BUSINESS_ID set to the id it prints, OWNER_ACCESS_CODE=smoke-code
 *   node tools/site-shots.mjs [http://127.0.0.1:8787]
 *
 * Refuses any address that is not this machine. Wide: 1440 × 900 at 2×; phone: 390 × 844 at 2×.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const host = new URL(base).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`refusing: the site's pictures come from a local instance only (host is '${host}')`);
  process.exit(2);
}
const code = process.env.OWNER_ACCESS_CODE ?? 'smoke-code';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'site');
mkdirSync(out, { recursive: true });

const NS = '5d0e0000-0000-4000-8000-';
/** Each picture: where it is taken and what is shown. */
const SHOTS = [
  { name: 'answer', path: `/app/inbox/${NS}e00000000001`, phonePath: `/app/inbox/${NS}e00000000001` },
];
const LOCALES = ['en', 'zh', 'ar', 'es', 'fr'];
const SIZES = { wide: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };

const browser = await chromium.launch();
try {
  for (const [size, viewport] of Object.entries(SIZES)) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: size === 'phone', hasTouch: size === 'phone' });
    const page = await ctx.newPage();
    await page.goto(`${base}/login?with=code`);
    await page.fill('input[name=code], input[type=password]', code);
    await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
    for (const locale of LOCALES) {
      await page.goto(`${base}/locale?set=${locale}&next=/app`);
      for (const s of SHOTS) {
        await page.goto(base + (size === 'phone' ? s.phonePath : s.path));
        await page.evaluate(() => document.fonts.ready);
        const png = await page.screenshot({ type: 'png' });
        const webp = await page.evaluate(async (b64) => {
          const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
          const c = new OffscreenCanvas(img.width, img.height);
          c.getContext('2d').drawImage(img, 0, 0);
          const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.82 });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(bin);
        }, png.toString('base64'));
        const file = join(out, `${s.name}.${locale}.${size}.webp`);
        writeFileSync(file, Buffer.from(webp, 'base64'));
        console.log(file);
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
