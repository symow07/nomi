import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shell, loginPage } from '../../src/api/web/layout.js';
import { renderSetup } from '../../src/api/web/settings.js';
import { MARK_FIGURE } from '../../src/core/owner/brand.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { withSheets } from './linked-css.js';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';

/**
 * V1 step three — the shell (Symow, decisions 2 and 4; the owner's condition
 * of 2026-09-24: "the shell must be fully usable with the script absent or
 * failed — nav reachable, nothing stuck collapsed").
 *
 * The collapse is CSS: on a phone the nav is sticky and compacts over the
 * first 160px of scroll through a scroll-driven animation, and the name band
 * below it scrolls away like content. There is no script to be absent or to
 * fail, and the state is a pure function of scroll position, so nothing can
 * be stuck. Where the animation is unsupported the nav is sticky at full
 * size. Held here by structure; measured in a browser in the PR.
 */
const page = (locale: (typeof LOCALES)[number] = 'en', avatar = ''): string =>
  shell({ title: 'T', active: 'home', locale, path: '/app', avatar, bodyHtml: '<p>x</p>' });
/** The page with the rules it links (V1 close-out: the stylesheet is a file). */
const drawn = (locale: (typeof LOCALES)[number] = 'en'): string => withSheets(page(locale));
const phoneBlock = (): string => {
  const html = drawn();
  const i = html.indexOf('@media (max-width: 720px)');
  expect(i).toBeGreaterThan(0);
  return html.slice(i);
};

describe('V1 step three · the collapse is CSS, and cannot be stuck', () => {
  // CC-26 (2026-09-28) changed what this held. The shell used to ship no
  // script at all; it now links ONE — the live line (liveScript.ts) — and the
  // owner's condition still stands for the collapse: it is CSS, needs no
  // script, and the one script there is never touches the nav or the scroll.
  it('the collapse needs no script: the shell links one, the live line, deferred and never inline', () => {
    for (const l of LOCALES) {
      const scripts = [...page(l).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
      expect(scripts, l).toHaveLength(1);
      expect(scripts[0]![0], l).toMatch(/^<script src="\/assets\/live\.[0-9a-f]{16}\.js" defer><\/script>$/);
      expect(scripts[0]![1], l).toBe('');
    }
    // G5b — `navigator` (the browser's own object, for alerts on the phone) is not the shell's nav.
    // The warmth run, phase 8 — and the rail's one number and its marker, drawn in place on the
    // Inbox entry (`[data-nav="inbox"]`, its `.navcount`): the script touches nothing else of the nav.
    const script = LIVE_SCRIPT.replace(/\bnavigator\b/g, '').replace(/\[data-nav="inbox"\]|\.navcount|'navcount'/g, '');
    for (const touch of ['nav', 'scroll(', 'animation', 'navlink', 'classList']) expect(script, touch).not.toContain(touch);
  });

  it('on a phone the nav is sticky at full size, outside any @supports', () => {
    const block = phoneBlock();
    const sticky = block.indexOf('nav.side { position:sticky; top:0;');
    const supports = block.indexOf('@supports (animation-timeline: scroll())');
    expect(sticky).toBeGreaterThan(0);
    expect(supports).toBeGreaterThan(sticky);
  });

  it('the compaction lives inside @supports and respects reduced motion', () => {
    const block = phoneBlock();
    const inner = block.slice(block.indexOf('@supports (animation-timeline: scroll())'));
    expect(inner).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*nav\.side \{ animation: nav-compact/);
    expect(inner).toContain('animation-timeline: scroll(root)');
    // Nothing outside the @supports block animates the nav.
    expect(block.slice(0, block.indexOf('@supports'))).not.toContain('animation:');
  });

  it('the compacted nav is still a target: 44px, spacing from the scale', () => {
    const html = drawn();
    expect(html).toMatch(/@keyframes navlink-compact \{ to \{ min-height:44px; padding-top:var\(--space-4\); padding-bottom:var\(--space-4\); \} \}/);
    expect(html).toMatch(/@keyframes nav-compact \{ to \{ padding-top:var\(--space-4\); padding-bottom:var\(--space-4\); \} \}/);
  });

  it('there is no name band — option A: the nav row is the chrome', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html).not.toContain('<header');
      expect(html).not.toContain('header.top');
      expect(html).not.toContain('class="langsw"');
      // The design pass (2026-09-29): Log out is the rail's foot on a wide
      // screen — a button in a form, inside the nav, never a band of its own.
      const nav = html.slice(html.indexOf('<nav class="side">'), html.indexOf('</nav>'));
      expect(nav).toMatch(/<form method="post" action="\/logout" class="navout"><button type="submit" class="subnav">/);
      expect(html.split('/logout')).toHaveLength(2);
    }
  });
});

describe('V1 step three · the mark is the product\'s, the badge sits with its word', () => {
  it('no face anywhere; the avatar input is ignored', () => {
    const html = page('en', 'AVATARSENTINEL');
    expect(html).not.toContain('AVATARSENTINEL');
    expect(html).not.toContain('class="avatar"');
    expect(html).not.toContain('class="who"');
  });

  it('the language switch leads Setup, log out is its last thing — a button — and the login page keeps its switcher', () => {
    // V1 close-out: log out ends the session, so it is a button and the last
    // thing on the page, after every row. Phase 3 kept the order: the switch
    // first, the groups of rows, log out.
    const html = renderSetup({ kind: null, people: 1 }, 'en', null);
    const lang = html.indexOf('class="langsw"');
    const firstRow = html.indexOf('<a class="srow" href="/app/guide">');
    const lastRow = html.indexOf('<a class="srow" href="/app/settings/data">');
    const out = html.indexOf('<form method="post" action="/logout">');
    expect(lang).toBeGreaterThan(0);
    expect(firstRow).toBeGreaterThan(lang);
    expect(lastRow).toBeGreaterThan(firstRow);
    expect(out, 'log out comes after every row').toBeGreaterThan(lastRow);
    expect(html).not.toContain('href="/logout"');
    // Phase 9 (V1-154) — a button that looks like one: outlined, at the cards' edge, not ghost text.
    expect(html.slice(out, html.indexOf('</form>', out))).toMatch(/<button class="btn" type="submit">/);
    expect(loginPage({ locale: 'en', path: '/login' })).toContain('class="langsw"');
  });

  it('the mark lives in the brand block only — both cuts, one drawn per width', () => {
    for (const l of LOCALES) {
      const html = page(l);
      const [before, after = ''] = html.split('class="brand"');
      expect(before, l).not.toContain(MARK_FIGURE);                     // not in the header band, not anywhere else
      const brand = after.split('</div>')[0] ?? '';
      expect(brand.split(MARK_FIGURE).length - 1, l).toBe(2);            // the detail cut and the small cut
      expect(html.split(MARK_FIGURE).length - 1, l).toBe(2);
    }
    const html = drawn();
    expect(html).toContain('.brand .mark-small { display:none; }');      // desktop: the detail cut beside the word
    const block = phoneBlock();
    expect(block).toContain('nav.side .brand { display:flex;');
    expect(block).toContain('nav.side .brand .mark-detail { display:none; }');
    expect(block).toContain('nav.side .brand .mark-small { display:flex; }');
    expect(block).toContain('nav.side .brand .brandname { display:none; }');
  });

  it('the Setup count sits beside its word, not at the far end', () => {
    const rule = drawn().match(/nav\.side \.navcount \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('margin-inline-start:var(--space-8)');
    expect(rule).not.toContain('auto');
    // Phase 7 — and on a phone the entry never breaks in two: one line, the count beside the word.
    expect(phoneBlock()).toMatch(/nav\.side a\.navlink \{[^}]*flex-direction:row; flex-wrap:nowrap; white-space:nowrap/);
  });
});
