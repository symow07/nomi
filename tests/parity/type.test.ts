import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { cssVariables } from '../../src/core/owner/css.js';
import { shell, loginPage, stylesheetAt, publicDocument } from '../../src/api/web/layout.js';
import { renderPrivacy } from '../../src/api/web/legal.js';
import { renderUnsubscribed } from '../../src/api/web/unsubscribe.js';
import { DEFAULT_PROCESSOR, HOSTING } from '../../src/core/legal/processors.js';
import { registerWebApp } from '../../src/api/web/app.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { sheetLinks } from './linked-css.js';
// @ts-expect-error — a tool's own module, plain JavaScript
import { woff2Characters, parseUnicodeRange } from '../../tools/lib/woff2.mjs';

/**
 * THE TYPE (the design pass, decided 2026-09-29; the plan's §7; the type pass,
 * 2026-10-04).
 *
 *   · one font order per language, each led by its own Noto face, and every
 *     order naming all three scripts — no word falls to the device;
 *   · the faces are the product's own files, never Google's;
 *   · the Sans is variable: five weights, light 300 to bold 700, from one file
 *     per slice; the Serif voice 400;
 *   · every face promises only the characters its file draws;
 *   · a page fetches only the faces its characters need, and links the Chinese
 *     faces' rules only when its characters need them;
 *   · a public page carries its own faces' rules, so a stranger's first page is
 *     set in the product's type too, and still needs nothing fetched to read.
 */

const FONTS = new URL('../../assets/fonts/', import.meta.url);
type Face = { family: string; weight: number | [number, number]; set: 'base' | 'zh'; file: string; unicodeRange: string };
const manifest = async () => JSON.parse(await readFile(new URL('faces.json', FONTS), 'utf8')) as { faces: Face[]; versions: Record<string, string> };
const first = (stack: string) => /^"([^"]+)"/.exec(stack)?.[1];
const page = (locale: 'en' | 'zh' | 'ar' | 'es', body = '') => shell({ title: 'T', active: 'home', locale, path: '/app', bodyHtml: body });
const typeHref = (html: string) => sheetLinks(html).find((h) => /\/assets\/type(zh)?\./.test(h))!;
const typeSheet = (html: string) => stylesheetAt(typeHref(html).slice('/assets/'.length))!.css;
const SANS = ['Noto Sans', 'Noto Sans SC', 'Noto Sans Arabic'];

describe('one font order per language', () => {
  it('each language leads with its own face, for the product and for speech — and names the other two scripts after it', () => {
    const { family, voice } = DESIGN_TOKENS.font;
    expect([first(family.en), first(family.zh), first(family.ar)]).toEqual(['Noto Sans', 'Noto Sans SC', 'Noto Sans Arabic']);
    expect([first(voice.en), first(voice.zh), first(voice.ar)]).toEqual(['Noto Serif', 'Noto Serif SC', 'Noto Naskh Arabic']);
    for (const stack of [...Object.values(family), ...Object.values(voice)]) {
      expect(stack).not.toMatch(/apple-system|PingFang|Songti|ui-serif/);
    }
    // The type pass: العربية on a Chinese page was Geeza Pro, 陈莉 on an Arabic page PingFang.
    for (const stack of Object.values(family)) for (const f of SANS) expect(stack, f).toContain(`"${f}"`);
    for (const stack of Object.values(voice)) for (const f of ['Noto Serif', 'Noto Serif SC', 'Noto Naskh Arabic']) expect(stack, f).toContain(`"${f}"`);
  });

  it('the page wears its language\'s order, line heights and tracking: Latin in :root, Chinese and Arabic keyed on <html lang>', () => {
    const css = cssVariables();
    const f = DESIGN_TOKENS.font;
    expect(css).toContain(`--font-family: ${f.family.en};`);
    expect(css).toContain(`--line-height-tight: ${f.lineHeightTight.en};`);
    expect(css).toContain(`--tracking-tight: ${f.trackingTight.en};`);
    for (const l of ['zh', 'ar'] as const) {
      expect(css).toContain(`html[lang="${l}"] { --line-height: ${f.lineHeight[l]}; --font-family: ${f.family[l]}; --font-voice: ${f.voice[l]}; `
        + `--line-height-tight: ${f.lineHeightTight[l]}; --tracking-tight: ${f.trackingTight[l]}; }`);
      // Chinese and Arabic take no tracking: it opens gaps in joined letters and between characters
      expect(f.trackingTight[l]).toBe('0');
    }
  });
});

describe('the faces are the product\'s own', () => {
  it('each sheet declares the faces its page leads with: the Sans from 300 to 700, the voice at 400', () => {
    for (const [locale, families] of [
      ['en', ['Noto Sans', 'Noto Serif', 'Noto Sans Arabic', 'Noto Naskh Arabic']],
      ['ar', ['Noto Sans', 'Noto Serif', 'Noto Sans Arabic', 'Noto Naskh Arabic']],
      ['zh', ['Noto Sans SC', 'Noto Serif SC', 'Noto Sans', 'Noto Serif', 'Noto Sans Arabic']],
    ] as const) {
      const css = typeSheet(page(locale));
      for (const f of families) {
        const weight = /Serif|Naskh/.test(f) ? '400' : '300 700';
        expect(css, `${locale} ${f}`).toMatch(new RegExp(`font-family:"${f}"; font-style:normal; font-weight:${weight};`));
      }
      expect(css).toContain('font-display:swap');
      expect(css).not.toMatch(/font-weight:(600|500|700);/);
    }
  });

  it('a page links the Chinese faces only when its characters need them — a Chinese page, or a Chinese name on any other', () => {
    expect(typeHref(page('zh'))).toMatch(/\/typezh\./);
    expect(typeHref(page('en'))).toMatch(/\/type\./);
    expect(typeHref(page('ar', '<p>مرحبا Hello</p>'))).toMatch(/\/type\./);
    // the type pass: a customer or a business called 义乌宏发 on an English page is drawn by Noto, not the device
    expect(typeHref(page('en', '<p>义乌宏发日用品厂</p>'))).toMatch(/\/typezh\./);
    expect(typeHref(page('es', '<p>陈莉</p>'))).toMatch(/\/typezh\./);
    // the language switch's own names are in the first sheet: 中文 alone needs nothing more
    expect(typeHref(page('en', '<p>中文 · العربية</p>'))).toMatch(/\/type\./);
    expect(typeSheet(page('en'))).not.toContain('Noto Serif SC');
    expect(typeSheet(page('en')).length).toBeLessThan(20_000);
    // the door links the same sheets as the shell, by the same rule
    expect(typeHref(loginPage({ locale: 'zh', path: '/login' }))).toBe(typeHref(page('zh')));
    expect(typeHref(loginPage({ locale: 'en', path: '/login' }))).toBe(typeHref(page('en')));
  });

  it('the Sans is variable 300–700 and the voice 400; every face is a file that is really there, named by its content', async () => {
    const { faces, versions } = await manifest();
    expect(faces.length).toBeGreaterThan(200);
    for (const f of faces) {
      if (SANS.includes(f.family)) expect(f.weight, f.file).toEqual([300, 700]);
      else expect(f.weight, f.file).toBe(400);
      expect(f.file).toMatch(/^[a-z0-9-]+\.[0-9a-f]{16}\.woff2$/);
      expect(existsSync(new URL(f.file, FONTS)), f.file).toBe(true);
    }
    expect(Object.keys(versions).sort()).toEqual(['noto-naskh-arabic', 'noto-serif', 'noto-serif-sc', 'variable/noto-sans', 'variable/noto-sans-arabic', 'variable/noto-sans-sc']);
    // …and nothing in the folder that the manifest does not name, but the manifest and the licence
    const listed = new Set([...faces.map((f) => f.file), 'faces.json', 'OFL.txt']);
    expect((await readdir(FONTS)).filter((n) => !listed.has(n))).toEqual([]);
    const ofl = await readFile(new URL('OFL.txt', FONTS), 'utf8');
    expect(ofl).toMatch(/SIL Open Font License, Version 1\.1/);
    for (const pkg of ['@fontsource-variable/noto-sans ', '@fontsource-variable/noto-sans-sc ', '@fontsource-variable/noto-sans-arabic ',
      '@fontsource/noto-serif ', '@fontsource/noto-naskh-arabic ', '@fontsource/noto-serif-sc ']) expect(ofl, pkg).toContain(`── ${pkg}`);
  });

  it('every face promises only the characters its file draws (the symbols slice claimed ○ ✓ ✦ and drew none)', async () => {
    const { faces } = await manifest();
    const promisedNotDrawn: string[] = [];
    for (const f of faces) {
      const drawn: Set<number> = woff2Characters(readFileSync(new URL(f.file, FONTS)));
      for (const [a, b] of parseUnicodeRange(f.unicodeRange) as [number, number][]) {
        for (let c = a; c <= b; c++) if (!drawn.has(c)) { promisedNotDrawn.push(`${f.file} U+${c.toString(16)}`); break; }
      }
    }
    expect(promisedNotDrawn).toEqual([]);
    for (const mark of [0x25cb, 0x2713, 0x2715, 0x2726]) {
      expect(faces.filter((f) => (parseUnicodeRange(f.unicodeRange) as [number, number][]).some(([a, b]) => mark >= a && mark <= b))
        .map((f) => f.family), `U+${mark.toString(16)}`).toEqual(mark === 0x25cb || mark === 0x2713 ? ['Noto Sans SC', 'Noto Serif SC'] : []);
    }
  });

  it('nothing is fetched from Google — not a font, not a stylesheet', async () => {
    const hits: string[] = [];
    const walk = async (dir: URL): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isDirectory()) await walk(new URL(`${e.name}/`, dir));
        else if (e.name.endsWith('.ts') && /fonts\.googleapis|fonts\.gstatic/.test(await readFile(new URL(e.name, dir), 'utf8'))) hits.push(e.name);
      }
    };
    await walk(new URL('../../src/', import.meta.url));
    expect(hits).toEqual([]);
  });
});

describe('a public page is set in the product\'s type, and still needs nothing fetched to be read', () => {
  const FACTS = { processor: DEFAULT_PROCESSOR, hosting: HOSTING };
  const faces = (html: string) => [...html.matchAll(/@font-face \{ font-family:"([^"]+)"; [^}]*src:url\(\/assets\/([^)]+)\)/g)].map((m) => ({ family: m[1]!, file: m[2]! }));

  it('the rules for its own faces are in the page — no link, no script — for exactly its characters', () => {
    for (const l of LOCALES) {
      const html = renderPrivacy(l, null, FACTS);
      expect(html, l).not.toContain('<link');
      expect(html, l).not.toContain('<script');
      const fs = faces(html);
      expect(fs.length, l).toBeGreaterThan(0);
      expect(fs.map((f) => f.family), l).toContain(l === 'zh' ? 'Noto Sans SC' : l === 'ar' ? 'Noto Sans Arabic' : 'Noto Sans');
      // the Sans only: the privacy page sets nothing in the voice
      expect(fs.some((f) => /Serif|Naskh/.test(f.family)), l).toBe(false);
      for (const f of fs) expect(existsSync(new URL(f.file, FONTS)), f.file).toBe(true);
    }
    // an English page carries no Chinese slice beyond the two that draw the switch's 中文, and no Arabic beyond its العربية
    const en = faces(renderPrivacy('en', null, FACTS));
    expect(en.filter((f) => f.family === 'Noto Sans SC').length).toBeLessThanOrEqual(2);
    expect(en.filter((f) => f.family === 'Noto Sans Arabic').map((f) => f.file.split('.')[0])).toEqual(['noto-sans-arabic-arabic-wght-normal']);
    // a page with no Chinese character, no switch, carries no Chinese face at all
    expect(faces(renderUnsubscribed('en')).filter((f) => f.family === 'Noto Sans SC')).toEqual([]);
  });

  it('a page whose own rules set the voice carries the voice\'s faces too; one that does not, none', () => {
    const voiced = publicDocument({ locale: 'en', title: 'T', body: '<p class="voice">Hello</p>', extraCss: 'p.voice { font-family:var(--font-voice); }' });
    expect(faces(voiced).map((f) => f.family)).toContain('Noto Serif');
    expect(faces(publicDocument({ locale: 'en', title: 'T', body: '<p>Hello</p>' })).map((f) => f.family)).not.toContain('Noto Serif');
  });
});

describe('the route serves a face to anyone, kept for good; nothing else', () => {
  it('a listed file with its type; an unlisted or crafted name is 404', async () => {
    const app = Fastify({ logger: false });
    registerWebApp(app, {
      db: {} as never, sessionSecret: 'x'.repeat(64), accessCode: 'let-me-in',
      businessId: 'de300000-0000-4000-8000-0000000000b1', employeeName: 'Lily', avatar: '', provider: 'disabled',
      secureCookie: false, kickOutbound: async () => {}, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    });
    const { faces } = await manifest();
    const one = faces.find((f) => f.family === 'Noto Sans' && f.file.startsWith('noto-sans-latin-wght-'))!;
    const res = await app.inject({ method: 'GET', url: `/assets/${one.file}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('font/woff2');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.rawPayload.subarray(0, 4).toString('latin1')).toBe('wOF2');
    for (const bad of [
      `/assets/${one.file.replace(/\.[0-9a-f]{16}\./, '.0123456789abcdef.')}`,
      '/assets/faces.json', '/assets/OFL.txt', '/assets/..%2Ffonts%2Ffaces.json',
    ]) {
      expect((await app.inject({ method: 'GET', url: bad })).statusCode, bad).toBe(404);
    }
    await app.close();
  });
});
