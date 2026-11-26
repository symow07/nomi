import { describe, expect, it } from 'vitest';
import { shell, hubFor } from '../../src/api/web/layout.js';
import { withWorkspace, type RequestScope } from '../../src/api/web/say.js';
import { linkedCss } from './linked-css.js';
import { flashBanner, saidFlash } from '../../src/api/web/flash.js';

const scope: RequestScope = { name: 'Lily', several: false, outreach: false, setup: null, books: true, viewerRole: 'owner', needsYou: 12, needsYouAt: 7 };
const page = (path = '/app', facts: Partial<RequestScope> = {}, split = false) => withWorkspace({ ...scope, ...facts }, () => shell({
  title: 'Today', locale: 'en', active: 'home', path, bodyHtml: '<h1 class="page">Today</h1>', ...(split ? { split: { me: '' } } : {}),
}));
const rail = (html: string) => html.split('<nav class="side"')[1]?.split('</nav>')[0] ?? '';
const destinations = (html: string) => [...rail(html).matchAll(/data-nav="([^"]+)"/g)].map((m) => m[1]);

describe('approved owner navigation', () => {
  it('keeps the same labelled primary destinations on Today, legacy pages and Books', () => {
    for (const path of ['/app', '/app/books', '/app/products', '/app/settings']) {
      for (const split of [false, true]) {
        // The navigation block (2026-11-25): Reports is its own area, and Ask Nomi has its own slot at the foot.
        expect(destinations(page(path, {}, split))).toEqual(['home', 'inbox', 'customers', 'products', 'assistant', 'books', 'reports', 'ask', 'settings', 'more']);
      }
    }
  });
  it('selects the correct area from nested and transitional routes', () => {
    for (const [path, area] of Object.entries({ '/app/calendar?day=2026-11-05': 'home', '/app/results': 'reports', '/app/results/month': 'reports', '/app/settings/assistant/month': 'reports', '/app/get-started': 'home', '/app/customers/c1': 'customers', '/app/products/p1': 'products', '/app/books/invoices/i1': 'books', '/app/advisor': 'ask', '/app/assistant/ask': 'ask', '/app/knowledge': 'assistant', '/app/settings/books/tax': 'books', '/app/payments/stripe': 'products' })) {
      expect(hubFor(path, 'settings'), path).toBe(area);
    }
  });
  it('offers working Today sections and a phone section chooser with current state', () => {
    const html = page('/app/calendar');
    expect(html).toContain('class="area-nav"');
    expect(html).toContain('class="area-chooser"');
    for (const href of ['/app', '/app/calendar', '/app/get-started']) expect(html).toContain(`href="${href}"`);
    expect(html).toMatch(/href="\/app\/calendar"[^>]*aria-current="page"/);
  });
  it('keeps the assistant\'s daily work and its configuration in Assistant; Settings keeps only the workspace', () => {
    // The navigation block (2026-11-25, the owner's decision): the assistant's settings moved into its own area.
    for (const path of ['/app/settings/assistant/checks', '/app/settings/assistant/history', '/app/settings/assistant/alone', '/app/settings/assistant']) {
      expect(hubFor(path, 'settings'), path).toBe('assistant');
    }
    expect(hubFor('/app/settings/business/hours', 'assistant')).toBe('settings');
  });
  it('keeps Books hidden when off or the viewer is team; accountants get only their safe destinations', () => {
    expect(destinations(page('/app', { books: false }))).not.toContain('books');
    const team = page('/app', { viewerRole: 'team' });
    expect(destinations(team)).not.toContain('books');
    expect(team).toContain('href="/app/results"');
    const accountant = page('/app/books', { viewerRole: 'accountant' });
    expect(destinations(accountant)).toEqual(['books', 'account', 'logout']);
    expect(accountant).not.toContain('href="/app/inbox"');
    expect(accountant).not.toContain('href="/app/settings"');
  });
  it('marks Reports, rather than Today, on every permitted staff report in both directions: rail, sidebar and chooser', () => {
    const want: Record<string, string> = {
      '/app/results': '/app/results', '/app/results?view=assistant': '/app/results?view=assistant', '/app/results?view=setup': '/app/results?view=setup',
      '/app/results/month': '/app/results/month', '/app/analytics': '/app/results',
    };
    for (const locale of ['en', 'ar'] as const) {
      for (const [path, href] of Object.entries(want)) {
        const html = withWorkspace({ ...scope, viewerRole: 'team' }, () => shell({
          title: 'Results', locale, active: 'analytics', path, bodyHtml: '<h1 class="page">Results</h1>',
        }));
        expect(rail(html), `${locale} ${path}`).toMatch(/data-nav="reports" aria-current="page"/);
        const side = html.split('<aside class="sect"')[1]?.split('</aside>')[0] ?? '';
        const chooser = html.split('<nav class="area-nav"')[1]?.split('</nav>')[0] ?? '';
        for (const part of [side, chooser]) {
          expect(part, `${locale} ${path}`).toContain(`href="${href}" aria-current="page"`);
          expect(part).not.toMatch(/href="\/app" aria-current="page"/);
          expect(part.match(/aria-current="page"/g)).toHaveLength(1);
        }
      }
    }
  });
  it('keeps the shared notice surface and refusal tone inside the signed-in shell', () => {
    for (const key of ['monthMail.flash.minutesSaved', 'monthMail.flash.mailOn', 'monthMail.flash.mailOff', 'monthMail.flash.minutesInvalid'] as const) {
      const flash = saidFlash('en', key, { minutes: 5 });
      const html = withWorkspace(scope, () => shell({ title: 'Month', locale: 'en', active: 'analytics', path: '/app/results/month', bodyHtml: flashBanner(flash) }));
      const rules = [...linkedCss(html).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
      const declarations = (selector: string) => rules.filter(rule => rule[1]!.split(',').some(part => part.trim() === selector)).map(rule => rule[2]!).join(';');
      expect(declarations('.flash')).toContain('background:var(--color-surface)');
      expect(declarations('.flash.bad')).toContain('border-color:var(--color-warn-line)');
      expect(declarations('.owner-shell .flash')).not.toMatch(/background:transparent|border:0|border-radius:0/);
      expect(declarations('.owner-shell .flash.bad')).not.toContain('color:var(--color-ink)');
      expect(html).toContain(`class="flash${flash.bad ? ' bad' : ''}" role="${flash.bad ? 'alert' : 'status'}"`);
    }
  });
  it('preserves the true accessible count, visual cap and live change cursor', () => {
    const html = page();
    expect(html).toContain('aria-label="Inbox, 12 customers need you"');
    expect(html).toContain('class="navcount" aria-hidden="true">9+</span>');
    expect(html).toContain('data-rail="/app/live/rail?since=12.7"');
    expect(rail(page('/app', { needsYou: 0 }))).not.toContain('class="navcount"');
  });
});

// Block 5, found on the way (a Block 1-4 guarantee): the accountant's Log out is a button that posts, and every nav rule
// once named a.navlink, so it was drawn as the browser's own 29 px button on the phone bar and 36 px in the rail.
describe("the accountant's Log out takes the nav's own rules", () => {
  const html = page('/app/books', { viewerRole: 'accountant' });
  const css = linkedCss(html);
  it('is still a button posting /logout inside the nav', () => {
    expect(rail(html)).toMatch(/<form method="post" action="\/logout" class="navout"><button class="navlink" type="submit" data-nav="logout">/);
  });
  it('the form gives way and the button drops the browser face', () => {
    expect(css).toContain('nav.side .navout { display:contents; }');
    expect(css).toMatch(/nav\.side button\.navlink \{ appearance:none; background:none; border:0; font:inherit;/);
  });
  it('the size, hover and press rules of the rail and the phone bar name the button too', () => {
    for (const rule of [
      'nav.side :is(a,button).navlink { display: flex;',
      'nav.side :is(a,button).navlink:hover {',
      'nav.side :is(a,button).navlink { position:relative;',
      'nav.side :is(a,button).navlink:active { transform:scale(',
      '.owner-shell nav.side :is(a,button).navlink { min-height:48px;',
      '.owner-shell nav.side :is(a,button).navlink, .owner-shell nav.side .nav-more > summary { display:flex;',
    ]) expect(css, rule).toContain(rule);
    // What is left on a.navlink alone is a link's own: where you are, a fresh dot, the scroll compaction. The Split
    // Today preview's rules (.split) are left out: only the owner's Today draws it, never the accountant's shell.
    for (const m of css.matchAll(/(?<!\.split )nav\.side a\.navlink([^{,]*)\{([^}]*)\}/g)) {
      expect(m[1]!.trim() + ' { ' + m[2]!.trim(), 'a link-only nav rule').toMatch(/^(\.active|\[data-fresh\]|\.sp-notab|:hover \.ni|\.active \.ni|\.active\[data-fresh\]::after|\[data-fresh\]::after|\s*\{ animation)/);
    }
  });
});
