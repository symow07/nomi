#!/usr/bin/env node
/**
 * THE MARK'S PICTURES — the home-screen icons and `/favicon.ico`, rendered from
 * the seal's source drawings in `assets/brand/` and written into
 * `src/api/web/appIcons.ts` (the app serves them from memory; no file is read
 * at run time).
 *
 *   node tools/brand-icons.mjs
 *
 * What it makes:
 *   icon-192, icon-512        the detail cut on the paper token, 14 units of a
 *                             hundred clear on every side (inside a phone's
 *                             rounded corner)
 *   icon-maskable-512         the same with 22 clear, so the seal sits inside
 *                             the 80-wide safe circle a launcher's mask keeps
 *   apple-touch-icon (180)    as icon-192, at the size an iPhone asks for
 *   favicon.ico               16 (the coin on its 16 grid), 32 (the coin with
 *                             both rims, its 32 grid), 48 (the 32 grid drawn
 *                             larger) — PNG entries, transparent
 *
 * Colours come from the tokens (`--color-brand`, `--color-coin`, the paper),
 * so a palette change is one run of this away. The browser is Playwright's
 * Chromium.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { DESIGN_TOKENS } from '../dist/core/owner/tokens.js';

const C = DESIGN_TOKENS.color;
const brandDir = new URL('../assets/brand/', import.meta.url);
const read = (f) => readFileSync(new URL(f, brandDir), 'utf8')
  .replaceAll('#9A0F5E', C.brand).replaceAll('#5A0A2E', C.coin);

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(svg, size, { clear = 0, ground = C.paper } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - 2 * clear));
  await page.setContent(`<style>html,body{margin:0;background:${ground ?? 'transparent'}}` +
    `div{width:${size}px;height:${size}px;display:grid;place-items:center}svg{display:block;width:${inner}px;height:${inner}px}</style><div>${svg}</div>`);
  return page.screenshot({ omitBackground: ground === null });
}

const detail = read('mark-detail.svg');
const icons = {
  '192': await render(detail, 192, { clear: 0.14 }),
  '512': await render(detail, 512, { clear: 0.14 }),
  'maskable-512': await render(detail, 512, { clear: 0.22 }),
  'apple-touch': await render(detail, 180, { clear: 0.14 }),
};
const favicon = [
  [16, await render(read('favicon.svg'), 16, { ground: null })],
  [32, await render(read('favicon-32.svg'), 32, { ground: null })],
  [48, await render(read('favicon-32.svg'), 48, { ground: null })],
];
await browser.close();

/** An ICO of PNG entries: a 6-byte header, a 16-byte entry each, then the PNGs. */
function ico(entries) {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach(([size, png], i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, at); head.writeUInt8(size >= 256 ? 0 : size, at + 1);
    head.writeUInt8(0, at + 2); head.writeUInt8(0, at + 3);
    head.writeUInt16LE(1, at + 4); head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(png.length, at + 8); head.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...entries.map(([, png]) => png)]);
}

const b64 = (buf) => buf.toString('base64');
const out = `/**
 * The mark's pictures (the seal, 2026-10-31): the home-screen icons — the
 * detail cut on the paper, clear of a phone's rounded corner, and a maskable
 * one inside the launcher's safe circle — the iPhone's 180, and \`/favicon.ico\`
 * (the coin alone: 16, 32, 48). Rendered from \`assets/brand/\` by
 * \`tools/brand-icons.mjs\`; do not edit by hand, run it again.
 */
export const APP_ICONS: Readonly<Record<'192' | '512' | 'maskable-512' | 'apple-touch', Buffer>> = {
${Object.entries(icons).map(([k, v]) => `  '${k}': Buffer.from('${b64(v)}', 'base64'),`).join('\n')}
};

export const FAVICON_ICO: Buffer = Buffer.from('${b64(ico(favicon))}', 'base64');
`;
writeFileSync(new URL('../src/api/web/appIcons.ts', import.meta.url), out);
console.log(`appIcons.ts: ${Object.entries(icons).map(([k, v]) => `${k} ${v.length} B`).join(', ')}, favicon.ico ${ico(favicon).length} B`);
