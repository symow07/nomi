import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderComponents } from '../../src/api/web/components.js';
import { shell, CONTEXTUAL_ROUTES_BY_HUB } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

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
    expect(read('settings.ts')).toContain("deeper('/app/settings/components'");
  });
});
