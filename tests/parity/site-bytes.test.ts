/**
 * 4.1 fix round, D1 — with no plan on offer the site is the page 03ba80db drew, byte for byte, in every language.
 * The fixtures were rendered by 03ba80db's `renderSite` with this input (the independent tester's, 2026-11-11). The
 * pricing slot added "\n  \n" to every render before the fix; a whitespace-blind comparison could not see it.
 * If the site's copy or style changes on purpose, re-render the fixtures from that commit's `renderSite` — never
 * from this branch's, or the test compares the page with itself.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderSite } from '../../src/api/web/site.js';

const BASE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'site-base');
describe('4.1 · no plan: the site is 03ba80db\'s, byte for byte', () => {
  for (const locale of ['en', 'zh', 'ar', 'es', 'fr'] as const) {
    it(locale, () => {
      const v = { locale, path: '/' as const, noindex: false, contact: 'hello@example.com', signIn: '/login', signUp: null };
      const base = readFileSync(join(BASE, `site-base-${locale}.html`), 'utf8');
      expect(renderSite({ ...v, pricing: null })).toBe(base);
      expect(renderSite(v)).toBe(base);
      expect(renderSite({ ...v, pricing: { plans: [], trialDays: null, cardFirst: false } })).toBe(base);
    });
  }
});
