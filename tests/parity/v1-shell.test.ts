import { describe, it, expect } from 'vitest';
import { shell } from '../../src/api/web/layout.js';
import { MARK_FIGURE } from '../../src/core/owner/brand.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

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
const phoneBlock = (): string => {
  const html = page();
  const i = html.indexOf('@media (max-width: 720px)');
  expect(i).toBeGreaterThan(0);
  return html.slice(i);
};

describe('V1 step three · the collapse is CSS, and cannot be stuck', () => {
  it('the shell ships no script', () => {
    for (const l of LOCALES) expect(page(l)).not.toContain('<script');
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
    const html = page();
    expect(html).toMatch(/@keyframes navlink-compact \{ to \{ min-height:44px; padding-top:var\(--space-4\); padding-bottom:var\(--space-4\); \} \}/);
    expect(html).toMatch(/@keyframes nav-compact \{ to \{ padding-top:var\(--space-4\); padding-bottom:var\(--space-4\); \} \}/);
  });

  it('the name band is not sticky — it scrolls away', () => {
    expect(page()).not.toMatch(/header\.top \{[^}]*position:\s*sticky/);
  });
});

describe('V1 step three · the mark is the product\'s, the badge sits with its word', () => {
  it('the header band shows a name and no face; the avatar input is ignored', () => {
    const html = page('en', 'AVATARSENTINEL');
    expect(html).not.toContain('AVATARSENTINEL');
    expect(html).not.toContain('class="avatar"');
    expect(html).toMatch(/<div class="who"><div><div class="whoname">/);
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
    const html = page();
    expect(html).toContain('.brand .mark-small { display:none; }');      // desktop: the detail cut beside the word
    const block = phoneBlock();
    expect(block).toContain('nav.side .brand { display:flex;');
    expect(block).toContain('nav.side .brand .mark-detail { display:none; }');
    expect(block).toContain('nav.side .brand .mark-small { display:flex; }');
    expect(block).toContain('nav.side .brand .brandname { display:none; }');
  });

  it('the Setup count sits beside its word, not at the far end', () => {
    const rule = page().match(/nav\.side \.navcount \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('margin-inline-start:var(--space-8)');
    expect(rule).not.toContain('auto');
    expect(phoneBlock()).toMatch(/nav\.side a\.navlink \{[^}]*flex-direction:row; flex-wrap:wrap/);
  });
});
