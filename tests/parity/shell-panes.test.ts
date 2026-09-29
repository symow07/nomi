import { describe, it, expect } from 'vitest';
import { shell } from '../../src/api/web/layout.js';
import { withWorkspace } from '../../src/api/web/say.js';
import { renderListPane, renderCustomerPanel, renderPanes } from '../../src/api/web/panes.js';
import type { InboxList, ConversationSummary } from '../../src/api/web/inbox.js';
import type { CustomerPanel } from '../../src/db/customerPanel.js';
import { moneyFromRow } from '../../src/core/types/money.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { linkedCss } from './linked-css.js';
import { buttonsAndDoors } from './buttons-and-doors.js';

/**
 * THE SHELL (the design pass, 2026-09-29; the plan's §2 and §3): the rail in
 * groups with Setup and Log out at its foot and one number in it; a
 * conversation between the list it came from and the customer it is with.
 */

const NOW = new Date('2026-09-29T10:00:00Z');
const SCOPE = { name: 'Lily', several: false, outreach: false, setup: null, business: 'Hana Skincare', needsYou: 3 };
const page = (path: string, locale: 'en' | 'zh' | 'ar' = 'en') =>
  withWorkspace(SCOPE, () => shell({ title: 'Maya Rahman', active: 'inbox', locale, path, bodyHtml: '<p>x</p>' }));

describe('the rail', () => {
  it('in groups: Today and the customers; the assistant and the business; Setup and Log out at the foot', () => {
    const html = page('/app/inbox/c-1');
    const nav = html.slice(html.indexOf('<nav class="side">'), html.indexOf('</nav>'));
    const at = (s: string) => nav.indexOf(s);
    expect(at('href="/app"')).toBeLessThan(at('id="nav-customers"'));
    expect(at('id="nav-customers"')).toBeLessThan(at('href="/app/employee"'));
    expect(at('<div class="navfoot">')).toBeLessThan(at('href="/app/settings"'));
    expect(at('href="/app/settings"')).toBeLessThan(at('action="/logout"'));
    // still five entries — the phone's one row
    expect(nav.match(/class="navlink /g)).toHaveLength(5);
  });

  it('"Customers" heads its two pages; Conversations carries the one number, and is lit here', () => {
    const html = page('/app/inbox/c-1');
    expect(html).toMatch(/<span class="navhead" id="nav-customers">Customers<\/span>/);
    expect(html).toMatch(/<a href="\/app\/inbox" class="subnav active" aria-current="page" aria-label="Conversations, 3 customers need you">Conversations<span class="navcount" aria-hidden="true">3<\/span><\/a>/);
    expect(html).toMatch(/<a href="\/app\/calendar" class="subnav">Calendar<\/a>/);
    const cal = page('/app/calendar');
    expect(cal).toMatch(/<a href="\/app\/calendar" class="subnav active" aria-current="page">/);
    // nobody waiting: no number at all, not a zero
    const calm = withWorkspace({ ...SCOPE, needsYou: 0 }, () => shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
    expect(calm).toMatch(/<a href="\/app\/inbox" class="subnav">Conversations<\/a>/);
  });

  it('Log out is a button in a form — it changes something', () => {
    expect(page('/app')).toContain('<form method="post" action="/logout" class="navout"><button type="submit" class="subnav">Log out</button></form>');
    expect(buttonsAndDoors(page('/app'))).toEqual([]);
  });

  it('the tab names the page, then the business — never the assistant', () => {
    expect(page('/app/inbox/c-1')).toContain('<title>Maya Rahman · Hana Skincare</title>');
    expect(withWorkspace({ ...SCOPE, business: null }, () => shell({ title: 'Today', active: 'home', locale: 'en', path: '/app', bodyHtml: '' })))
      .toContain('<title>Today · Nomi</title>');
  });

  it('in Arabic the Customers head and its pages speak Arabic; on a phone the groups dissolve into the one row', () => {
    const ar = page('/app/inbox/c-1', 'ar');
    expect(ar).toContain(`>${t('ar', 'nav.customers')}</span>`);
    const css = linkedCss(ar);
    const phone = css.slice(css.indexOf('@media (max-width: 720px)'));
    expect(phone).toMatch(/\.navgroup, \.navfoot \{ display:contents; \}/);
    expect(phone).toMatch(/\.navhub, \.navout \{ display:none; \}/);
  });
});

const conv = (id: string, over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  conversationId: id, buyer: `B-${id}`, country: null, status: 'handled', needsAction: false, ownership: 'AI',
  heldBy: null, awaitingReview: false, handoffReason: null, latestMessage: `last from ${id}`, latestAt: NOW,
  product: { name: null, nameZh: null }, quantity: null, unitPrice: null, ...over,
});

describe('the list pane', () => {
  const list: InboxList = {
    filter: 'pending', waitingCount: 1, blockedCount: 0, deletionCount: 0, mineCount: 0,
    conversations: [conv('c-1', { awaitingReview: true, lastFrom: 'buyer' }), conv('c-2', { lastFrom: 'assistant' })],
  };

  it('the current conversation is marked; each row is name, last message, time; its state is the heading above it', () => {
    const html = renderListPane(list, 'en', NOW, 'c-1');
    expect(html).toMatch(/<a class="lp-row on" href="\/app\/inbox\/c-1#latest" aria-current="page">/);
    expect(html).toContain(`<li class="lp-group" aria-hidden="true">${t('en', 'buyers.group.needsYou')}</li>`);
    expect(html).not.toContain('class="tag');
    // the one magenta in the list: the assistant wrote last
    expect(html).toMatch(/href="\/app\/inbox\/c-2#latest">[\s\S]*?<span class="as" aria-hidden="true">✦<\/span> <bdi dir="auto">last from c-2/);
    const first = html.slice(html.indexOf('href="/app/inbox/c-1#latest"'));
    expect(first.slice(0, first.indexOf('</a>'))).not.toContain('✦');
  });

  it('an empty tab is not shown: Mine only with colleagues, the problem tabs only while one exists', () => {
    const html = renderListPane(list, 'en', NOW, 'c-1');
    expect(html).not.toContain('filter=mine');
    expect(html).not.toContain('filter=blocked');
    expect(html).not.toContain('filter=deletion');
    const busy = renderListPane({ ...list, blockedCount: 2, deletionCount: 1 }, 'en', NOW, 'c-1',
      [{ id: 'p1', name: 'Owner', isOwner: true }, { id: 'p2', name: 'Xiao', isOwner: false }]);
    for (const f of ['mine', 'blocked', 'deletion']) expect(busy).toContain(`filter=${f}`);
  });
});

describe('the customer panel', () => {
  const usd = (n: number) => moneyFromRow(n, 'USD')!;
  const panel: CustomerPanel = {
    clientId: 'cl-1', name: 'Maya Rahman', country: 'GB', channel: 'whatsapp', address: '447700900123', language: 'en',
    firstWrote: new Date('2026-09-02T10:00:00Z'), conversations: 2,
    askedAbout: [{ name: 'Rose Face Serum', nameZh: null, count: 3, lastAt: NOW }],
    prices: [{ unitPrice: usd(34.9), name: 'Rose Face Serum', nameZh: null, at: new Date('2026-09-02T10:00:00Z'), conversationId: 'c-9' }],
    samples: [{ askedAt: new Date('2026-09-12T10:00:00Z'), handledAt: new Date('2026-09-13T10:00:00Z') }],
    orders: [{ id: 'o-1', reference: 'W-1042', status: 'confirmed', at: new Date('2026-09-20T10:00:00Z') }],
    activity: [
      { kind: 'waiting', at: NOW },
      { kind: 'alone', at: NOW },
      { kind: 'draft_sent', at: new Date('2026-09-02T10:00:00Z') },
      { kind: 'not_reached', by: 'assistant', at: new Date('2026-08-28T10:00:00Z') },
    ],
  };

  it('who they are, then each block from what is on record, with the marks for who acted', () => {
    const html = withWorkspace(SCOPE, () => renderCustomerPanel(panel, [], 'en', NOW, 'c-1'));
    expect(html).toContain('<h2><bdi>Maya Rahman</bdi></h2>');
    expect(html).toContain('WhatsApp <bdi>+447700900123</bdi> · writes in English · ');
    expect(html).toContain('First wrote ');
    expect(html).toContain('2 conversations');
    expect(html).toContain('<bdi>Rose Face Serum</bdi></span><span class="pn-r">3 times · 18:00</span>');
    expect(html).toContain('<h3>Prices worked out</h3>');
    expect(html).toContain('href="/app/inbox/c-9#latest"');
    expect(html).toContain('Sample · asked ');
    expect(html).toContain('<bdi>Order W-1042</bdi>');
    expect(html).toContain('<span class="pn-none" aria-hidden="true">○</span> Waiting for you');
    expect(html).toContain('<span class="as" aria-hidden="true">✦</span> Lily replied');
    expect(html).toContain('<span class="pn-you" aria-hidden="true">●</span> You sent Lily’s draft');
    expect(html).toContain('Lily’s reply didn’t reach them <span class="dot bad" aria-hidden="true">●</span>');
    expect(html).toContain('href="/app/conversations/c-1"');
  });

  it('a block with nothing in it is not drawn — no zero, no empty heading', () => {
    const html = renderCustomerPanel({ ...panel, askedAbout: [], prices: [], samples: [], orders: [], activity: [] }, [], 'en', NOW, 'c-1');
    for (const h of ['Asked about', 'Prices worked out', 'On record', 'On the calendar', 'Activity']) expect(html).not.toContain(`<h3>${h}</h3>`);
  });

  it('the panes: drawn always, laid out by width — below 1100 px the conversation stands alone', () => {
    const html = renderPanes('<aside class="listpane"></aside>', '<h1>x</h1>', renderCustomerPanel(panel, [], 'en', NOW, 'c-1'));
    expect(html.startsWith('<div class="panes"><aside class="listpane">')).toBe(true);
    expect(buttonsAndDoors(html)).toEqual([]);
    const css = linkedCss(page('/app/inbox/c-1'));
    expect(css).toMatch(/\.panes > \.listpane, \.panes > \.panel, \.panel-open, \.panel-close \{ display:none; \}/);
    expect(css).toMatch(/@media \(min-width: 1100px\) \{[\s\S]*?\.panes \{ display:grid; grid-template-columns:300px minmax\(0, 1fr\);/);
    expect(css).toMatch(/@media \(min-width: 1440px\) \{[\s\S]*?\.panes \{ grid-template-columns:300px minmax\(560px, 1fr\) 300px; \}/);
  });
});
