import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { renderComponents } from '../../src/api/web/components.js';
import { shell, loginPage, errorPage, publicDocument, CONTEXTUAL_ROUTES_BY_HUB, stylesheetAt } from '../../src/api/web/layout.js';
import { registerWebApp, PUBLIC_ROUTES } from '../../src/api/web/app.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { sheetLinks, linkedCss } from './linked-css.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';

/**
 * V1 · decision 4 (Symow, 2026-09-24): "define what already exists, once, in
 * one stylesheet, and retire page-level style blocks as each page is
 * restyled". Two things are held here, by structure:
 *
 *   1. A class is DEFINED in one file. Before this, `.card`, `.chip`, `.dhead`,
 *      `.sub` and thirty-three others were declared in two or more pages with
 *      small differences, and names like `.acts` meant a button row on one
 *      page and a list on another. The shell now holds the one body; a second
 *      declaration anywhere fails here.
 *   2. The number of `<style>` blocks may only FALL. The baseline is a
 *      committed file, like the symbol ceiling: lower it on purpose when a
 *      page's block is retired; a new block anywhere fails the build.
 *
 * And the components page, which is how every state gets looked at, must show
 * every family and carry no stylesheet of its own.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WEB = 'src/api/web';
const files = readdirSync(join(ROOT, WEB)).filter((f) => f.endsWith('.ts')).sort();
const read = (f: string) => readFileSync(join(ROOT, WEB, f), 'utf8');

/** Bare single-class selectors (`.foo`) declared in a file's CSS, comments stripped. */
function bareClassesDefined(f: string): Set<string> {
  const src = read(f);
  // A page's CSS lives in <style> blocks; the shell's is the STYLE template — take the whole file.
  const css = f === 'layout.ts' ? [src] : [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!);
  const out = new Set<string>();
  for (const blk of css) {
    const clean = blk.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const part of m[1]!.split(',')) {
        const p = part.trim();
        const one = /^\.([a-zA-Z][a-zA-Z0-9_-]*)$/.exec(p);
        if (one) out.add(one[1]!);
      }
    }
  }
  return out;
}

describe('V1 · one stylesheet — decision 4', () => {
  it('no class is defined in two files (the shell counts as one)', () => {
    const where = new Map<string, string[]>();
    for (const f of files) for (const c of bareClassesDefined(f)) where.set(c, [...(where.get(c) ?? []), f]);
    const twice = [...where].filter(([, fs]) => fs.length > 1).map(([c, fs]) => `.${c}: ${fs.join(', ')}`);
    expect(twice, 'a class with two definitions — hoist it to the shell or rename the odd one').toEqual([]);
  });

  it('<style> blocks: at the baseline or below, never above', () => {
    const base = JSON.parse(readFileSync(join(ROOT, 'tools/style-baseline.json'), 'utf8')) as { styleBlocks: number };
    const count = files.reduce((n, f) => n + (read(f).match(/<style/g)?.length ?? 0), 0);
    expect(count, `page-level <style> blocks rose above ${base.styleBlocks}; a new page styles itself through the shell`)
      .toBeLessThanOrEqual(base.styleBlocks);
    if (count < base.styleBlocks) console.log(`  ✓ ${count} <style> blocks, below the ceiling of ${base.styleBlocks} — lower it in tools/style-baseline.json`);
  });

  it('the shell-defined states exist: hover and focus twins, disabled', () => {
    const shellCss = read('layout.ts');
    expect(shellCss).toMatch(/\.btn\.send\.is-hover \{/);
    expect(shellCss).toMatch(/\.is-focus \{ outline/);
    expect(shellCss).toMatch(/\.btn:disabled, \.btn\.is-disabled \{/);
    expect(shellCss).toMatch(/details > summary \{/);
    expect(shellCss).toMatch(/main select, main textarea, main input/);
  });
});

/**
 * V1 close-out (2026-09-28) — the stylesheets are FILES. The shell and the door
 * link one sheet each, at an address named by its rules; the route serves it
 * to anyone (the door is drawn before sign-in), kept for good at its exact
 * address and never at an old one. The public document is the one family that
 * still carries its rules inside itself, on purpose: a stranger's page arrives
 * complete, with nothing more to fetch (legal-pages.test.ts,
 * m40-unsubscribe.test.ts). So the one surviving block is in layout.ts, and it
 * is that one.
 */
describe('V1 close-out · the shell and the door link their stylesheets', () => {
  const app = () => {
    const a = Fastify({ logger: false });
    registerWebApp(a, {
      db: {} as never, sessionSecret: 'x'.repeat(64), accessCode: 'let-me-in',
      businessId: 'de300000-0000-4000-8000-0000000000b1', employeeName: 'Lily', avatar: '', provider: 'disabled',
      secureCookie: false, kickOutbound: async () => {}, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    });
    return a;
  };

  it('the one surviving block is the public document\'s, in layout.ts', () => {
    const where = files.filter((f) => read(f).includes('<style'));
    expect(where).toEqual(['layout.ts']);
    expect(read('layout.ts').match(/<style/g)?.length).toBe(1);
    const doc = publicDocument({ locale: 'en', title: 'T', body: '<p>x</p>' });
    expect(doc.match(/<style>/g)?.length).toBe(1);
    expect(doc).not.toContain('<link rel="stylesheet"');
  });

  it('the shell and every door page link exactly one sheet (and their type), and carry no rules', () => {
    const pages = [
      ['shell', shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '<p>x</p>' }), 'app'],
      ['login', loginPage({ locale: 'ar', path: '/login' }), 'door'],
      ['error', errorPage({ locale: 'zh', path: '/nope', kind: 'notfound' }), 'door'],
    ] as const;
    for (const [name, html, sheet] of pages) {
      expect(html, name).not.toContain('<style');
      const links = sheetLinks(html);
      expect(links, name).toHaveLength(2);
      expect(links[0], name).toMatch(new RegExp(`^/assets/${sheet}\\.[0-9a-f]{16}\\.css$`));
      expect(links[1], name).toMatch(/^\/assets\/type(zh)?\.[0-9a-f]{16}\.css$/);
      expect(linkedCss(html).length, name).toBeGreaterThan(5_000);
    }
    // the door never carries the pages' sections; the shell carries both
    const door = linkedCss(loginPage({ locale: 'en', path: '/login' }));
    const shellCss = linkedCss(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
    expect(door).toContain('.login .card');
    expect(door).not.toContain('.buyer-top');
    expect(shellCss).toContain('.buyer-top');
    expect(shellCss).not.toContain('.login .card');
  });

  it('the route serves them to anyone: kept for good at the exact address, not at an old one, nothing else', async () => {
    const a = app();
    const [href] = sheetLinks(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
    const exact = await a.inject({ method: 'GET', url: href! });
    expect(exact.statusCode).toBe(200);
    expect(exact.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(exact.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(exact.body).toBe(stylesheetAt(href!.slice('/assets/'.length))!.css);
    const old = await a.inject({ method: 'GET', url: '/assets/app.0123456789abcdef.css' });
    expect(old.statusCode).toBe(200);
    expect(old.headers['cache-control']).toBe('no-cache');
    expect(old.body).toBe(exact.body);
    for (const bad of ['/assets/app.css', '/assets/nope.0123456789abcdef.css', '/assets/..%2Fapp.ts', '/assets/app.0123456789abcdef.css.map']) {
      expect((await a.inject({ method: 'GET', url: bad })).statusCode, bad).toBe(404);
    }
    // declared public, with its reason — a stranger's first page is the door
    expect(PUBLIC_ROUTES.find((r) => r.url === '/assets/:file')?.why).toMatch(/before anyone signs in/);
    await a.close();
  });

  it('the rules a browser downloads say nothing the owner surface bans — selectors and comments included', () => {
    // A stylesheet in a file still ships: every rule and comment in it is in
    // the owner's browser, where the page's own words are held to this list.
    for (const html of [shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }), loginPage({ locale: 'en', path: '/login' })]) {
      const css = linkedCss(html).toLowerCase();
      for (const banned of [...BANNED_OWNER_TERMS, 'stack']) {
        const b = banned.toLowerCase();
        const hit = /^[a-z ]+$/.test(b) ? new RegExp(`(?<![a-z-])${b}(?![a-z-])`).test(css) : css.includes(b);
        expect(hit, `"${banned}" in ${sheetLinks(html)[0]}`).toBe(false);
      }
    }
  });

  it('a change to a rule is a new address', () => {
    const [href] = sheetLinks(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
    const hash = /\.([0-9a-f]{16})\.css$/.exec(href!)![1]!;
    expect(createHash('sha256').update(stylesheetAt(href!.slice('/assets/'.length))!.css).digest('hex').slice(0, 16)).toBe(hash);
  });
});

describe('V1 · the components page', () => {
  const FAMILIES = [
    'pill ok', 'pill warn', 'pill bad', 'pill owner', 'chips', 'chip',
    'btn send', 'btn ghost', 'btn danger', 'is-hover', 'is-focus', ' disabled>',
    'deeper', 'back', 'pform', 'fld', 'chkbox', '<select', '<textarea', '<details', '<summary', 'perr',
    'flash', 'flash bad', 'empty', 'ok-line', 'tabs', 'tab on',
    'timeline', 'msg inbound', 'msg outbound', 'bubble', 'proposed', 'ts muted',
    'stats', 'stat', 'stated-now', 'card', 'block', 'dhead', 'facts', 'frow', 'flabel',
    'sub', 'muted', 'note', 'subline',
  ];

  it('shows every family, in every locale, and carries no stylesheet of its own', () => {
    for (const locale of LOCALES) {
      const body = renderComponents(locale);
      expect(body, locale).not.toContain('<style');
      expect(body, locale).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(body, locale).not.toMatch(/font-size:\s*\d+px/);
      for (const fam of FAMILIES) expect(body, `${locale}: ${fam}`).toContain(fam);
      // Rendered by the shell: the lang and direction come from the locale.
      const page = shell({ title: 'T', active: 'settings', locale, path: '/app/settings/components', avatar: '', bodyHtml: body });
      expect(page).toContain(`<html lang="${locale}"`);
    }
  });

  it('is reached from Setup and lives in its hub group', () => {
    const settings = CONTEXTUAL_ROUTES_BY_HUB.find((g) => g.hub === '/app/settings');
    expect(settings?.routes).toContain('/app/settings/components');
    expect(read('settings.ts')).toContain("door('/app/settings/components'");
  });
});
