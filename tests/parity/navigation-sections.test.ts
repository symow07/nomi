/**
 * The navigation block (2026-11-25, the owner's decision) — two layers everywhere, as Intercom has them: the rail names
 * the areas; inside each area a section sidebar lists ALL of it. This file holds the map (sections.ts) to what the owner
 * approved: one home per feature, the four moves, who sees what, and where the sidebar is drawn.
 */
import { describe, expect, it } from 'vitest';
import { AREAS, currentItem, sectionSidebar, sectionChooser, hasSections, isSectionPage, type AreaId } from '../../src/api/web/sections.js';
import { SECTIONS_CSS } from '../../src/api/web/sectionsStyle.js';
import { NAV, hubFor, shell } from '../../src/api/web/layout.js';
import { withWorkspace, t, type RequestScope } from '../../src/api/web/say.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
import { NAVIGATION_EN } from '../../src/core/owner/i18n/navigation.js';

const OWNER: RequestScope = { name: 'Lily', several: false, outreach: true, setup: null, books: true, viewerRole: 'owner', ads: true, business: 'Atlas Studio' };
const as = <T>(facts: Partial<RequestScope>, fn: () => T): T => withWorkspace({ ...OWNER, ...facts }, fn);
const hrefs = (html: string): string[] => [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]!);
const page = (path: string, facts: Partial<RequestScope> = {}, body = '<h1 class="page">x</h1>') =>
  as(facts, () => shell({ title: 'x', active: 'x', locale: 'en', path, bodyHtml: body }));

describe('the map: every area of the rail has its sidebar, and each feature one home', () => {
  it('the rail is the areas, Reports and Ask Nomi included, in the approved order', () => {
    expect(NAV.map((n) => n.id)).toEqual(['home', 'inbox', 'customers', 'products', 'assistant', 'books', 'reports', 'ask', 'settings']);
    for (const n of NAV) expect(Object.keys(AREAS), n.id).toContain(n.id);
    // Ask Nomi is one page: nothing to list beside it.
    expect(AREAS.ask).toEqual([]);
    for (const id of Object.keys(AREAS) as AreaId[]) if (id !== 'ask') expect(AREAS[id].length, id).toBeGreaterThan(0);
  });

  it('every item lights the area that lists it — except the books\' reports, which the owner asked to see in Reports too', () => {
    for (const [area, groups] of Object.entries(AREAS) as [AreaId, (typeof AREAS)[AreaId]][]) {
      for (const g of groups) for (const item of g.items) {
        const lit = hubFor(item.href.split('#')[0]!, 'none');
        if (area === 'reports' && item.href === '/app/books/reports') expect(lit).toBe('books');
        else expect(lit, `${area} › ${item.href}`).toBe(area);
      }
    }
  });

  it('no address is listed twice, but for that one deliberate second door', () => {
    const all = Object.values(AREAS).flatMap((gs) => gs.flatMap((g) => g.items.map((i) => i.href)));
    const twice = all.filter((h, i) => all.indexOf(h) !== i);
    expect(twice).toEqual(['/app/books/reports']);
  });

  it('the owner\'s four choices, as drawn', () => {
    const settings = as({}, () => hrefs(sectionSidebar('en', 'settings', '/app/settings/business/profile')));
    // Settings keeps only the workspace: nothing of the assistant's or the books' settings is listed there.
    expect(settings.filter((h) => h.startsWith('/app/settings/assistant') || h.startsWith('/app/settings/books'))).toEqual([]);
    const assistant = as({}, () => hrefs(sectionSidebar('en', 'assistant', '/app/assistant')));
    for (const h of ['/app/settings/assistant', '/app/settings/assistant/name', '/app/settings/assistant/promises', '/app/settings/assistant/words']) expect(assistant).toContain(h);
    const books = as({}, () => hrefs(sectionSidebar('en', 'books', '/app/books')));
    for (const h of ['/app/settings/books', '/app/settings/books/tax', '/app/settings/books/connections']) expect(books).toContain(h);
    // Reports is its own area, and the books' reports appear there too.
    const reports = as({}, () => hrefs(sectionSidebar('en', 'reports', '/app/results')));
    for (const h of ['/app/results', '/app/results?view=assistant', '/app/results/month', '/app/results#ad-spend', '/app/books/reports']) expect(reports).toContain(h);
    // Payment links (and Shopify orders) sit under Products.
    const products = as({}, () => hrefs(sectionSidebar('en', 'products', '/app/products')));
    for (const h of ['/app/payments/stripe', '/app/settings/business/shopify', '/app/products/whatsapp']) expect(products).toContain(h);
  });

  it('the features that were hidden are one click from their area', () => {
    const inbox = as({}, () => hrefs(sectionSidebar('en', 'inbox', '/app/inbox/replies')));
    expect(inbox).toContain('/app/channels/instagram/comments');
    // Follow-ups, labels and feedback have one home: Customers, not the Inbox.
    for (const h of ['/app/customers/outreach', '/app/customers/labels', '/app/customers/feedback']) expect(inbox).not.toContain(h);
    const customers = as({}, () => hrefs(sectionSidebar('en', 'customers', '/app/customers')));
    for (const h of ['/app/customers/outreach', '/app/customers/labels', '/app/customers/feedback', '/app/customers/orders', '/app/customers/import']) expect(customers).toContain(h);
  });
});

describe('who sees what', () => {
  it('a team member sees no owner-only door', () => {
    const team = (area: AreaId, path: string) => as({ viewerRole: 'team' }, () => hrefs(sectionSidebar('en', area, path)));
    for (const h of ['/app/products/add', '/app/products/price-limits', '/app/payments/stripe', '/app/settings/business/shopify']) expect(team('products', '/app/products')).not.toContain(h);
    expect(team('customers', '/app/customers')).not.toContain('/app/customers/import');
    expect(team('books', '/app/books').filter((h) => h.startsWith('/app/settings/books'))).toEqual([]);
    expect(team('reports', '/app/results')).not.toContain('/app/books/reports');
    for (const h of ['/app/settings/team', '/app/settings/billing', '/app/settings/business/data']) expect(team('settings', '/app/settings/personal/account')).not.toContain(h);
  });

  it('an accountant\'s Settings is only their own', () => {
    const acc = as({ viewerRole: 'accountant' }, () => hrefs(sectionSidebar('en', 'settings', '/app/settings/personal/account')));
    expect(acc).toEqual(['/app/settings/personal/account', '/app/settings/personal/language']);
  });

  it('a feature that is off is not listed: follow-ups, the books\' reports, ad spend, the export trade\'s pages', () => {
    expect(as({ outreach: false }, () => hrefs(sectionSidebar('en', 'customers', '/app/customers')))).not.toContain('/app/customers/outreach');
    expect(as({ books: false }, () => hrefs(sectionSidebar('en', 'reports', '/app/results')))).not.toContain('/app/books/reports');
    expect(as({ ads: false }, () => hrefs(sectionSidebar('en', 'reports', '/app/results')))).not.toContain('/app/results#ad-spend');
    const shop = as({ exportTrade: false }, () => hrefs(sectionSidebar('en', 'settings', '/app/settings/business/profile')));
    for (const h of ['/app/settings/business/terms', '/app/settings/business/samples']) expect(shop).not.toContain(h);
    expect(as({ exportTrade: false }, () => hrefs(sectionSidebar('en', 'customers', '/app/customers')))).not.toContain('/app/customers/samples');
  });
});

describe('you are here', () => {
  it('the longest address wins; a view named by a query wins where the page carries it; an anchor never', () => {
    expect(currentItem('reports', '/app/results')?.href).toBe('/app/results');
    expect(currentItem('reports', '/app/results?view=assistant')?.href).toBe('/app/results?view=assistant');
    expect(currentItem('reports', '/app/results?view=setup')?.href).toBe('/app/results?view=setup');
    expect(currentItem('reports', '/app/results?view=other')?.href).toBe('/app/results');
    expect(currentItem('settings', '/app/settings/channels/technical')?.href).toBe('/app/settings/channels');
    expect(currentItem('reports', '/app/analytics')?.href).toBe('/app/results');
    expect(currentItem('assistant', '/app/assistant/knowledge/procedures')?.href).toBe('/app/assistant/knowledge/procedures');
    expect(currentItem('assistant', '/app/assistant/knowledge/abc')?.href).toBe('/app/assistant/knowledge');
    // an exact item is not lit by the pages under it
    expect(currentItem('assistant', '/app/assistant/zzz')).toBeNull();
    expect(currentItem('home', '/app/calendar?day=2026-11-05')?.href).toBe('/app/calendar');
  });

  it('one aria-current in the sidebar and one in the chooser', () => {
    for (const [area, path] of [['settings', '/app/settings/business/hours'], ['books', '/app/settings/books/tax'], ['assistant', '/app/settings/assistant/words'], ['inbox', '/app/inbox/replies']] as const) {
      const side = as({}, () => sectionSidebar('en', area, path));
      const chooser = as({}, () => sectionChooser('en', area, path, ''));
      for (const part of [side, chooser]) expect(part.match(/aria-current="page"/g), `${area} ${path}`).toHaveLength(1);
    }
  });

  it('an entry of the sidebar draws no "‹ back"; a page under one keeps the way back the shell gives it', () => {
    expect(isSectionPage('settings', '/app/settings/business/hours')).toBe(true);
    expect(isSectionPage('settings', '/app/settings/channels/technical')).toBe(false);
    const main = (h: string) => h.slice(h.indexOf('<main'), h.indexOf('</main>'));
    expect(main(page('/app/settings/business/hours'))).not.toContain('class="back"');
    expect(main(page('/app/settings/channels/technical'))).toContain('<a class="back" href="/app/settings/channels">');
  });
});

describe('where it is drawn', () => {
  it('beside the rail, inside the layout, with search on top and the area\'s name over its first group; the chooser first in the content', () => {
    const html = page('/app/settings/business/hours');
    const layout = html.slice(html.indexOf('<div class="layout'));
    expect(layout.indexOf('<nav class="side"')).toBeLessThan(layout.indexOf('<aside class="sect"'));
    expect(layout.indexOf('<aside class="sect"')).toBeLessThan(layout.indexOf('class="content'));
    expect(html).toMatch(/<aside class="sect" aria-label="In this area"><form class="sect-search" method="get" action="\/app\/inbox" role="search">/);
    expect(html).toMatch(/<\/form><nav aria-label="[^"]+"><div class="sect-group"><p class="sect-head">[^<]+<\/p>/);
    expect(html).toMatch(/class="content[^"]*"[^>]*>(?:<a class="help-door[\s\S]*?<\/a>)?\s*<nav class="area-nav"/);
  });

  it('the Inbox list and a conversation draw none: their own column is the sidebar there', () => {
    for (const path of ['/app/inbox', '/app/inbox?filter=pending', '/app/inbox/c-1']) {
      expect(hasSections('inbox', path), path).toBe(false);
      expect(page(path), path).not.toContain('<aside class="sect"');
    }
    expect(hasSections('inbox', '/app/inbox/replies')).toBe(true);
    expect(page('/app/assistant/ask')).not.toContain('<aside class="sect"');
  });

  it('desktop: a narrow rail, then the sidebar from 961 px; between, the chooser, clear of the "?"; never printed', () => {
    expect(SECTIONS_CSS).toContain('.owner-shell .layout:has(> .sect) { grid-template-columns:72px 264px minmax(0, 1fr); }');
    expect(SECTIONS_CSS).toMatch(/@media \(min-width:961px\) \{\n {2}\.sect \{ display:block;/);
    expect(SECTIONS_CSS).toContain('margin-inline-end:calc(44px + var(--space-16) + var(--space-8))');
    expect(SECTIONS_CSS).toContain('@media print { .sect, .owner-shell .content > .area-nav { display:none; } }');
  });
});

describe('its words', () => {
  it('every word of the sidebar is written in all five languages, none falling back to English', () => {
    for (const k of Object.keys(NAVIGATION_EN) as (keyof typeof NAVIGATION_EN)[]) {
      for (const l of LOCALES) expect(messages[l][k], `${l} ${k}`).toBeTruthy();
    }
    for (const l of LOCALES.filter((x) => x !== 'en')) {
      for (const k of ['nav.reports', 'side.label', 'side.goLive', 'side.workspace', 'side.settingsMoved'] as const) expect(messages[l][k], `${l} ${k}`).not.toBe(messages.en[k]);
    }
  });

  it('the books\' reports group in Reports says Books as the rail does', () => {
    for (const l of LOCALES) expect(t(l, 'side.reportsBooks'), l).toBe(t(l, 'nav.books'));
  });

  it('owner words only: the sidebar never says AI, robot, system or model', () => {
    for (const l of LOCALES) for (const k of Object.keys(NAVIGATION_EN) as (keyof typeof NAVIGATION_EN)[]) {
      expect(messages[l][k], `${l} ${k}`).not.toMatch(/\bAI\b|机器人|系统|模型|\bbot\b/i);
    }
  });
});
