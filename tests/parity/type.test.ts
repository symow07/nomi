import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { cssVariables } from '../../src/core/owner/css.js';
import { shell, loginPage, stylesheetAt } from '../../src/api/web/layout.js';
import { registerWebApp } from '../../src/api/web/app.js';
import { sheetLinks } from './linked-css.js';

/**
 * THE TYPE (the design pass, decided 2026-09-29; the plan's §7).
 *
 *   · one font order per language, each led by its own Noto face — the old
 *     single stack began with `-apple-system`, which Chrome does not know,
 *     so English was drawn by the Chinese font;
 *   · the faces are the product's own files, never Google's;
 *   · weights 400 and 600 only (Chinese never below 400 at 15 px and under);
 *   · a page fetches only the faces its characters need, and only a Chinese
 *     page carries the Chinese faces' rules.
 */

const FONTS = new URL('../../assets/fonts/', import.meta.url);
type Face = { family: string; weight: number; set: 'base' | 'zh'; file: string; unicodeRange: string };
const manifest = async () => JSON.parse(await readFile(new URL('faces.json', FONTS), 'utf8')) as { faces: Face[] };
const first = (stack: string) => /^"([^"]+)"/.exec(stack)?.[1];
const page = (locale: 'en' | 'zh' | 'ar') => shell({ title: 'T', active: 'home', locale, path: '/app', bodyHtml: '' });
const typeSheet = (html: string) => stylesheetAt(sheetLinks(html)[1]!.slice('/assets/'.length))!.css;

describe('one font order per language', () => {
  it('each language leads with its own face, for the product and for speech', () => {
    const { family, voice } = DESIGN_TOKENS.font;
    expect([first(family.en), first(family.zh), first(family.ar)]).toEqual(['Noto Sans', 'Noto Sans SC', 'Noto Sans Arabic']);
    expect([first(voice.en), first(voice.zh), first(voice.ar)]).toEqual(['Noto Serif', 'Noto Serif SC', 'Noto Naskh Arabic']);
    for (const stack of [...Object.values(family), ...Object.values(voice)]) {
      expect(stack).not.toMatch(/apple-system|PingFang|Songti|ui-serif/);
    }
  });

  it('the page wears its language\'s order: Latin in :root, Chinese and Arabic keyed on <html lang>', () => {
    const css = cssVariables();
    expect(css).toContain(`--font-family: ${DESIGN_TOKENS.font.family.en};`);
    expect(css).toContain(`html[lang="zh"] { --line-height: 1.7; --font-family: ${DESIGN_TOKENS.font.family.zh}; --font-voice: ${DESIGN_TOKENS.font.voice.zh}; }`);
    expect(css).toContain(`html[lang="ar"] { --line-height: 1.75; --font-family: ${DESIGN_TOKENS.font.family.ar}; --font-voice: ${DESIGN_TOKENS.font.voice.ar}; }`);
  });
});

describe('the faces are the product\'s own', () => {
  it('each sheet declares the faces its page leads with, at 400 and 600 (speech at 400)', () => {
    for (const [locale, families] of [
      ['en', ['Noto Sans', 'Noto Serif', 'Noto Sans Arabic', 'Noto Naskh Arabic']],
      ['ar', ['Noto Sans', 'Noto Serif', 'Noto Sans Arabic', 'Noto Naskh Arabic']],
      ['zh', ['Noto Sans SC', 'Noto Serif SC', 'Noto Sans', 'Noto Serif']],
    ] as const) {
      const css = typeSheet(page(locale));
      for (const f of families) {
        expect(css, `${locale} ${f} 400`).toMatch(new RegExp(`font-family:"${f}"; font-style:normal; font-weight:400;`));
        if (!/Serif|Naskh/.test(f)) expect(css, `${locale} ${f} 600`).toMatch(new RegExp(`font-family:"${f}"; font-style:normal; font-weight:600;`));
      }
      expect(css).toContain('font-display:swap');
    }
  });

  it('only a Chinese page carries the Chinese faces', () => {
    expect(typeSheet(page('en'))).not.toContain('Noto Sans SC');
    expect(typeSheet(page('ar'))).not.toContain('Noto Serif SC');
    expect(typeSheet(page('zh'))).toContain('"Noto Sans SC"');
    expect(typeSheet(page('en')).length).toBeLessThan(40_000);
    // the door links the same sheet as the shell, per language
    expect(sheetLinks(loginPage({ locale: 'zh', path: '/login' }))[1]).toBe(sheetLinks(page('zh'))[1]);
  });

  it('weights 400 and 600 only; every face is a file that is really there, named by its content', async () => {
    const { faces } = await manifest();
    expect(faces.length).toBeGreaterThan(300);
    expect([...new Set(faces.map((f) => f.weight))].sort()).toEqual([400, 600]);
    for (const f of faces) {
      expect(f.file).toMatch(/^[a-z0-9-]+\.[0-9a-f]{16}\.woff2$/);
      expect(existsSync(new URL(f.file, FONTS)), f.file).toBe(true);
    }
    // …and nothing in the folder that the manifest does not name, but the manifest and the licence
    const listed = new Set([...faces.map((f) => f.file), 'faces.json', 'OFL.txt']);
    expect((await readdir(FONTS)).filter((n) => !listed.has(n))).toEqual([]);
    expect(await readFile(new URL('OFL.txt', FONTS), 'utf8')).toMatch(/SIL Open Font License, Version 1\.1/);
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

describe('the route serves a face to anyone, kept for good; nothing else', () => {
  it('a listed file with its type; an unlisted or crafted name is 404', async () => {
    const app = Fastify({ logger: false });
    registerWebApp(app, {
      db: {} as never, sessionSecret: 'x'.repeat(64), accessCode: 'let-me-in',
      businessId: 'de300000-0000-4000-8000-0000000000b1', employeeName: 'Lily', avatar: '', provider: 'disabled',
      secureCookie: false, kickOutbound: async () => {}, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    });
    const { faces } = await manifest();
    const one = faces.find((f) => f.family === 'Noto Sans' && f.weight === 400 && f.file.includes('-latin-400-'))!;
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
