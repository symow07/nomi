/**
 * The navigation block (2026-11-25, the owner's decision) — two layers everywhere, as Intercom has them: the rail names
 * the areas; inside each area a section sidebar lists ALL of it. This file holds the map (sections.ts) to what the owner
 * approved: one home per feature, the four moves, who sees what, and where the sidebar is drawn.
 *
 * THE SETTINGS OVERHAUL (2026-11-27, the owner's decision; rule 104) rewrote the tests here that pinned three menus of
 * settings (Settings, Assistant › Go live, Books › Setup): every setting is in the ONE Settings area now, in five
 * groups and 23 pages; the Assistant and Books areas keep one "Settings" shortcut each, and Products one to Shopify.
 * What each rewritten test guarded is kept: an item lights the area its page belongs to, an address has one home, and
 * nobody is shown a door they may not open.
 */
import { describe, expect, it } from 'vitest';
import { AREAS, currentItem, sectionSidebar, sectionChooser, hasSections, isSectionPage, type AreaId } from '../../src/api/web/sections.js';
import { SECTIONS_CSS } from '../../src/api/web/sectionsStyle.js';
import { NAV, hubFor, shell } from '../../src/api/web/layout.js';
import { withWorkspace, t, type RequestScope } from '../../src/api/web/say.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
import { NAVIGATION_EN } from '../../src/core/owner/i18n/navigation.js';
import { SETTINGS_OVERHAUL_EN } from '../../src/core/owner/i18n/settingsOverhaul.js';

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

  /** A shortcut is a second door to a page that belongs to another area (rule 104): never "here" where it is listed. */
  const SHORTCUTS: Readonly<Record<string, readonly string[]>> = {
    products: ['/app/settings/business/shopify'], assistant: ['/app/settings/assistant'], books: ['/app/settings/books/country'],
  };

  it('every item lights the area that lists it — except the books\' reports, shown in Reports too, and the three shortcuts into Settings', () => {
    for (const [area, groups] of Object.entries(AREAS) as [AreaId, (typeof AREAS)[AreaId]][]) {
      for (const g of groups) for (const item of g.items) {
        const lit = hubFor(item.href.split('#')[0]!, 'none');
        if (area === 'reports' && item.href === '/app/books/reports') expect(lit).toBe('books');
        else if (SHORTCUTS[area]?.includes(item.href)) { expect(lit, `${area} › ${item.href}`).toBe('settings'); expect(item.shortcut, item.href).toBe(true); }
        else { expect(lit, `${area} › ${item.href}`).toBe(area); expect(item.shortcut ?? false, item.href).toBe(false); }
      }
    }
  });

  it('no address is listed twice, but for the books\' reports in Reports and the three shortcuts', () => {
    const all = Object.values(AREAS).flatMap((gs) => gs.flatMap((g) => g.items.map((i) => i.href)));
    const twice = all.filter((h, i) => all.indexOf(h) !== i);
    expect(twice.sort()).toEqual(['/app/books/reports', '/app/settings/assistant', '/app/settings/books/country', '/app/settings/business/shopify']);
  });

  it('ONE Settings area: five groups, 23 pages, in the approved order', () => {
    const groups = (facts: Partial<RequestScope> = {}) => as(facts, () => sectionSidebar('en', 'settings', '/app/settings/business/profile'));
    expect([...groups().matchAll(/<p class="sect-head">([^<]+)<\/p>/g)].map((m) => m[1])).toEqual(['Workspace', 'Connections', 'Assistant', 'Books', 'You']);
    expect(hrefs(groups())).toEqual([
      '/app/settings/business/profile', '/app/settings/business/selling', '/app/settings/business/hours', '/app/settings/business/currency',
      '/app/settings/team', '/app/settings/billing', '/app/settings/business/data',
      '/app/settings/channels', '/app/settings/channels/whatsapp', '/app/settings/channels/meta', '/app/settings/channels/email', '/app/settings/business/shopify',
      '/app/settings/assistant', '/app/settings/assistant/name', '/app/settings/assistant/promises',
      '/app/settings/books/country', '/app/settings/books/starting-balances', '/app/settings/books/accounts', '/app/settings/books/invoices-out',
      '/app/settings/books/connections', '/app/settings/books/fields',
      '/app/settings/personal/account', '/app/settings/personal/notifications',
    ]);
    expect(hrefs(groups())).toHaveLength(23);
    // The renames, as the menu says them.
    const words = (html: string) => [...html.matchAll(/<span>([^<]+)<\/span><\/a>/g)].map((m) => m[1]);
    expect(words(groups())).toEqual(['Business profile', 'How you sell', 'Hours and closures', 'Currency', 'Team', 'Billing', 'Data and privacy',
      'Channels', 'WhatsApp', 'Instagram and Messenger', 'E-mail', 'Shopify', 'Reply permissions', 'Name and identity', 'Promises and words',
      'Country and tax', 'Starting balances', 'Accounts', 'Invoices', 'Accounting connections', 'Custom fields', 'Account', 'Notifications']);
    // What merged into another page is not an item, and its address lights the page that took it in.
    for (const [gone, home] of [['/app/settings/business/terms', '/app/settings/business/selling'], ['/app/settings/business/samples', '/app/settings/business/selling'],
      ['/app/settings/assistant/words', '/app/settings/assistant/promises'], ['/app/settings/assistant/alone', '/app/settings/assistant'],
      ['/app/settings/assistant/history-policy', '/app/settings/business/data'], ['/app/settings/books/tax', '/app/settings/books/country'],
      ['/app/settings/personal/language', '/app/settings/personal/account'], ['/app/settings/channels/technical', '/app/settings/channels']] as const) {
      expect(hrefs(groups()), gone).not.toContain(gone);
      expect(currentItem('settings', gone)?.href, gone).toBe(home);
    }
    // A person's Ask Nomi history and the books' checklist are not settings pages: nothing in the menu is "here".
    expect(currentItem('settings', '/app/settings/personal/advisor-history')).toBeNull();
    expect(currentItem('settings', '/app/settings/books')).toBeNull();
  });

  it('the Assistant and Books areas keep their work and ONE "Settings" shortcut each; Products one to Shopify', () => {
    const assistant = as({}, () => hrefs(sectionSidebar('en', 'assistant', '/app/assistant')));
    // Going live is a checklist, not a setting: it is the one address under /app/settings the assistant's area keeps.
    expect(assistant.filter((h) => h.startsWith('/app/settings'))).toEqual(['/app/settings/assistant/ready', '/app/settings/assistant']);
    const side = as({}, () => sectionSidebar('en', 'assistant', '/app/settings/assistant/ready'));
    expect(side).toContain('<p class="sect-head">Go live</p><a href="/app/settings/assistant/ready" aria-current="page">');
    expect(side).toMatch(/<div class="sect-group"><a href="\/app\/settings\/assistant">[\s\S]*?<span>Settings<\/span><\/a><\/div>/);
    const books = as({}, () => sectionSidebar('en', 'books', '/app/books'));
    expect(hrefs(books).filter((h) => h.startsWith('/app/settings'))).toEqual(['/app/settings/books/country']);
    // "Advanced" was a page of two links: they are items now, under "For your accountant".
    expect(books).toContain('<p class="sect-head">For your accountant</p><a href="/app/books/advanced/entries">');
    expect(hrefs(books)).toEqual(expect.arrayContaining(['/app/books/advanced/entries', '/app/books/advanced/trial-balance']));
    expect(hrefs(books)).not.toContain('/app/books/advanced');
    for (const [path, home] of [['/app/books/advanced', '/app/books/advanced/entries'], ['/app/books/entries', '/app/books/advanced/entries'],
      ['/app/books/advanced/entries/e-1', '/app/books/advanced/entries'], ['/app/books/trial-balance', '/app/books/advanced/trial-balance']] as const)
      expect(currentItem('books', path)?.href, path).toBe(home);
    // Reports is its own area, and the books' reports appear there too.
    const reports = as({}, () => hrefs(sectionSidebar('en', 'reports', '/app/results')));
    for (const h of ['/app/results', '/app/results?view=assistant', '/app/results/month', '/app/results#ad-spend', '/app/books/reports']) expect(reports).toContain(h);
    // Payment links sit under Products, with the shortcut to Shopify's page (Settings › Connections).
    const products = as({}, () => hrefs(sectionSidebar('en', 'products', '/app/products')));
    for (const h of ['/app/payments/stripe', '/app/settings/business/shopify', '/app/products/whatsapp']) expect(products).toContain(h);
    // A shortcut is never "here": on Shopify's page the Settings sidebar is drawn, and lights its own item.
    expect(currentItem('products', '/app/settings/business/shopify')).toBeNull();
    expect(currentItem('settings', '/app/settings/business/shopify')?.label).toBe('side.shopify');
  });

  it('web chat, Telegram and TikTok are items only where they can be connected; elsewhere their pages light Channels', () => {
    const three = ['/app/settings/channels/chat', '/app/settings/channels/telegram', '/app/settings/channels/tiktok'];
    const none = as({}, () => hrefs(sectionSidebar('en', 'settings', '/app/settings/channels')));
    for (const h of three) expect(none, h).not.toContain(h);
    as({}, () => { for (const h of three) expect(currentItem('settings', h)?.href, h).toBe('/app/settings/channels'); });
    const here = { channelsHere: { chat: true, telegram: true, tiktok: true } };
    expect(as(here, () => hrefs(sectionSidebar('en', 'settings', '/app/settings/channels'))).filter((h) => three.includes(h))).toEqual(three);
    as(here, () => { for (const h of three) expect(currentItem('settings', h)?.href, h).toBe(h); });
    const one = as({ channelsHere: { chat: false, telegram: true, tiktok: false } }, () => hrefs(sectionSidebar('en', 'settings', '/app/settings/channels')));
    expect(one.filter((h) => three.includes(h))).toEqual(['/app/settings/channels/telegram']);
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
    const settings = team('settings', '/app/settings/personal/account');
    for (const h of ['/app/settings/team', '/app/settings/billing', '/app/settings/business/data', '/app/settings/business/shopify']) expect(settings).not.toContain(h);
    // The Books group of Settings is the owner's, as Books › Setup was.
    expect(settings.filter((h) => h.startsWith('/app/settings/books'))).toEqual([]);
    // The assistant's settings are shown to a team member, as they were under Assistant.
    for (const h of ['/app/settings/assistant', '/app/settings/assistant/name', '/app/settings/assistant/promises']) expect(settings).toContain(h);
  });

  it('an accountant\'s Settings is only their own', () => {
    const acc = as({ viewerRole: 'accountant' }, () => hrefs(sectionSidebar('en', 'settings', '/app/settings/personal/account')));
    // Language is part of Account (rule 104); its address lights Account.
    expect(acc).toEqual(['/app/settings/personal/account']);
    expect(currentItem('settings', '/app/settings/personal/language')?.href).toBe('/app/settings/personal/account');
    // The assistant's area offers an accountant no shortcut into settings they may not see.
    expect(as({ viewerRole: 'accountant' }, () => hrefs(sectionSidebar('en', 'assistant', '/app/assistant')))).not.toContain('/app/settings/assistant');
  });

  it('the Books group of Settings exists only where the books are on', () => {
    expect(as({ books: false }, () => hrefs(sectionSidebar('en', 'settings', '/app/settings/team'))).filter((h) => h.startsWith('/app/settings/books'))).toEqual([]);
    expect(as({ books: true }, () => hrefs(sectionSidebar('en', 'settings', '/app/settings/team'))).filter((h) => h.startsWith('/app/settings/books'))).toHaveLength(6);
  });

  it('a feature that is off is not listed: follow-ups, the books\' reports, ad spend, the export trade\'s pages', () => {
    expect(as({ outreach: false }, () => hrefs(sectionSidebar('en', 'customers', '/app/customers')))).not.toContain('/app/customers/outreach');
    expect(as({ books: false }, () => hrefs(sectionSidebar('en', 'reports', '/app/results')))).not.toContain('/app/books/reports');
    expect(as({ ads: false }, () => hrefs(sectionSidebar('en', 'reports', '/app/results')))).not.toContain('/app/results#ad-spend');
    // Terms and samples are sections of How you sell now (rule 104): no item for anyone, export trade or not.
    for (const exportTrade of [false, true]) {
      const shop = as({ exportTrade }, () => hrefs(sectionSidebar('en', 'settings', '/app/settings/business/profile')));
      for (const h of ['/app/settings/business/terms', '/app/settings/business/samples']) expect(shop).not.toContain(h);
    }
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
    for (const [area, path] of [['settings', '/app/settings/business/hours'], ['settings', '/app/settings/books/tax'], ['settings', '/app/settings/assistant/words'], ['assistant', '/app/settings/assistant/ready'], ['books', '/app/books/advanced/entries'], ['inbox', '/app/inbox/replies']] as const) {
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
  it('beside the rail, inside the layout, the area\'s name over its first group; the chooser first in the content; the customer search only where a customer is looked for', () => {
    const html = page('/app/settings/business/hours');
    const layout = html.slice(html.indexOf('<div class="layout'));
    expect(layout.indexOf('<nav class="side"')).toBeLessThan(layout.indexOf('<aside class="sect"'));
    expect(layout.indexOf('<aside class="sect"')).toBeLessThan(layout.indexOf('class="content'));
    // The text pass (the owner, 2026-11-26): "Search customers" is not drawn on a page that is not about customers.
    expect(html).not.toContain('class="sect-search"');
    expect(html).toMatch(/<aside class="sect" aria-label="In this area"><nav aria-label="[^"]+"><div class="sect-group"><p class="sect-head">[^<]+<\/p>/);
    expect(page('/app/calendar')).toMatch(/<aside class="sect" aria-label="In this area"><form class="sect-search" method="get" action="\/app\/inbox" role="search">/);
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
      for (const k of ['nav.reports', 'side.label', 'side.goLive', 'side.workspace', 'side.connections', 'side.forAccountant', 'side.you', 'side.booksInvoices'] as const) expect(messages[l][k], `${l} ${k}`).not.toBe(messages.en[k]);
    }
    for (const k of Object.keys(SETTINGS_OVERHAUL_EN) as (keyof typeof SETTINGS_OVERHAUL_EN)[]) for (const l of LOCALES) expect(messages[l][k], `${l} ${k}`).toBeTruthy();
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
