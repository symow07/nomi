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
        expect(destinations(page(path, {}, split))).toEqual(['home', 'inbox', 'customers', 'products', 'books', 'assistant', 'settings', 'more']);
      }
    }
  });
  it('selects the correct area from nested and transitional routes', () => {
    for (const [path, area] of Object.entries({ '/app/calendar?day=2026-11-05': 'home', '/app/results': 'home', '/app/get-started': 'home', '/app/customers/c1': 'customers', '/app/products/p1': 'products', '/app/books/invoices/i1': 'books', '/app/advisor': 'assistant', '/app/knowledge': 'assistant' })) {
      expect(hubFor(path, 'settings'), path).toBe(area);
    }
  });
  it('offers working Today sections and a phone section chooser with current state', () => {
    const html = page('/app/calendar');
    expect(html).toContain('class="area-nav"');
    expect(html).toContain('class="area-chooser"');
    for (const href of ['/app', '/app/calendar', '/app/results', '/app/get-started']) expect(html).toContain(`href="${href}"`);
    expect(html).toMatch(/href="\/app\/calendar"[^>]*aria-current="page"/);
  });
  it('keeps daily reply checks and activity in Assistant while configuration stays in Settings', () => {
    for (const path of ['/app/settings/assistant/checks', '/app/settings/assistant/history']) {
      expect(hubFor(path, 'settings')).toBe('assistant');
    }
    expect(hubFor('/app/settings/assistant/alone', 'settings')).toBe('settings');
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
  it('marks Results, rather than Today, on every permitted staff Results view in both directions', () => {
    for (const locale of ['en', 'ar'] as const) {
      for (const path of ['/app/results', '/app/results?view=assistant', '/app/results?view=setup', '/app/results/month', '/app/analytics']) {
        const html = withWorkspace({ ...scope, viewerRole: 'team' }, () => shell({
          title: 'Results', locale, active: 'analytics', path, bodyHtml: '<h1 class="page">Results</h1>',
        }));
        const area = html.split('<nav class="area-nav"')[1]?.split('</nav>')[0] ?? '';
        expect(area, `${locale} ${path}`).toMatch(/href="\/app\/results" aria-current="page"/);
        expect(area).not.toMatch(/href="\/app" aria-current="page"/);
        expect(area.match(/aria-current="page"/g)).toHaveLength(2); // Desktop and phone menu.
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
