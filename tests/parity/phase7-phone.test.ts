import { describe, it, expect } from 'vitest';
import { shell } from '../../src/api/web/layout.js';
import { withAssistantName } from '../../src/api/web/say.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { linkedCss } from './linked-css.js';

/**
 * PHASE 7 OF THE UI REBUILD (2026-10-02) — THE PHONE. The top nav is one line:
 * no entry breaks in two. "Your assistant" (while it has no name) and "My
 * business" have a shorter phone form, shown only on a phone; on the narrowest
 * phones the five entries come before the small mark. Measured at 360 and 390
 * px in four languages (PROGRESS): every entry one line, nothing wider than
 * the screen. The calendar's half is in calendar-week.test.ts.
 */

const page = (l: (typeof LOCALES)[number]) => shell({ title: 'T', active: 'home', locale: l, path: '/app', bodyHtml: '' });
const nav = (html: string) => html.split('<nav class="side"')[1]?.split('</nav>')[0] ?? '';
const css = linkedCss(page('en')).replace(/\/\*[\s\S]*?\*\//g, '');
/** Every `@media (cond)` block's rules, joined (the phone width has more than one). */
const block = (cond: string): string => {
  const out: string[] = [];
  for (let i = css.indexOf(`@media (${cond})`); i >= 0; i = css.indexOf(`@media (${cond})`, i + 1)) {
    let depth = 0; let j = css.indexOf('{', i);
    const open = j;
    for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}' && --depth === 0) break; }
    out.push(css.slice(open + 1, j));
  }
  return out.join('\n');
};

describe('phase 7 · the phone nav is one line', () => {
  // THE WARMTH RUN (2026-10-03) — five tiles, icon over word, a fifth of the
  // phone each: Inbox has a phone form where its word does not fit a fifth
  // (ar, es, fr); the assistant's fallback keeps its phone form; nothing else has one.
  it('one name per entry at every width where it fits (phase 9, cross-new-02); Inbox and the unnamed assistant have phone forms where needed; a named assistant is short already', () => {
    for (const l of ['en', 'zh'] as const) {
      const html = nav(page(l));
      expect(html.match(/nl-short">(?!\d)/g) ?? [], l).toEqual([]);
      expect(html, l).toContain(`>${t(l, 'nav.settings')}<`);
    }
    for (const l of ['ar', 'es', 'fr'] as const) {
      const html = nav(page(l));
      expect(html, l).toContain(`<span class="nl-short">${t(l, 'nav.short.inbox')}</span>`);
      expect(html, l).toContain(`<span class="nl-long">${t(l, 'nav.inbox')}</span>`);
    }
    const fr = nav(page('fr'));
    expect(fr).toContain('<span class="nl-short">Assistant</span>');
    const named = withAssistantName('Lily', () => nav(page('fr')));
    expect(named).not.toContain('<span class="nl-short">Assistant</span>');
    expect(named).toContain('>Lily<');
  });

  it('wide: the long label; phone: the short one, every entry on one line; the narrowest: no mark before the entries', () => {
    expect(css).toMatch(/(?:^|\s)\.nl-short \{ display:none; \}/);
    const phone = block('max-width: 720px');
    expect(phone).toMatch(/\.nl-long \{ display:none; \}/);
    expect(phone).toMatch(/\.nl-short \{ display:inline; \}/);
    expect(phone).toMatch(/nav\.side a\.navlink, nav\.side a\.navlink\.sub \{[^}]*flex-wrap:nowrap; white-space:nowrap/);
    expect(block('max-width: 379px')).toMatch(/nav\.side \.brand \{ display:none; \}/);
  });
});

describe('Phase 9 (V1-195, inbox-calendar-new-09) · a week or month wider than the phone opens on today', () => {
  it('the one script brings today\'s column into view, and only inside the grid that scrolls', async () => {
    const { LIVE_SCRIPT } = await import('../../src/api/web/liveScript.js');
    expect(LIVE_SCRIPT).toContain("closest('.wk-scroll')");
    expect(LIVE_SCRIPT).toMatch(/box\.scrollWidth <= box\.clientWidth\) return;/);
    expect(LIVE_SCRIPT).toMatch(/toToday\(\);/);
  });
});
