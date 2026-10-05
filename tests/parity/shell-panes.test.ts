import { describe, it, expect } from 'vitest';
import { shell } from '../../src/api/web/layout.js';
import { withWorkspace } from '../../src/api/web/say.js';
import { renderSettingsHome } from '../../src/api/web/settings.js';
import { renderListPane, renderCustomerPanel, renderPanes } from '../../src/api/web/panes.js';
import type { InboxList, ConversationSummary } from '../../src/api/web/inbox.js';
import type { CustomerPanel } from '../../src/db/customerPanel.js';
import { moneyFromRow } from '../../src/core/types/money.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { linkedCss } from './linked-css.js';
import { buttonsAndDoors } from './buttons-and-doors.js';
import { agentMark } from '../../src/api/web/agentMark.js';

/**
 * THE SHELL (the design pass, 2026-09-29; the plan's §2 and §3): the rail in
 * groups with Setup and Log out at its foot and one number in it; a
 * conversation between the list it came from and the customer it is with.
 */

const NOW = new Date('2026-09-29T10:00:00Z');
// TZ — the fixtures' times are written in Shanghai time: the workspace's zone, stated.
const SCOPE = { name: 'Lily', several: false, outreach: false, setup: null, business: 'Hana Skincare', needsYou: 3, zone: 'Asia/Shanghai' };
const page = (path: string, locale: 'en' | 'zh' | 'ar' | 'es' | 'fr' = 'en') =>
  withWorkspace(SCOPE, () => shell({ title: 'Maya Rahman', active: 'inbox', locale, path, bodyHtml: '<p>x</p>' }));

describe('the rail', () => {
  // THE WARMTH RUN (2026-10-03), phase 1 — daily work at the top, management at the foot.
  it('in groups: Today; the customers (Inbox, Calendar); the assistant; Settings at the foot — and no Log out', () => {
    const html = page('/app/inbox/c-1');
    const nav = html.slice(html.indexOf('<nav class="side">'), html.indexOf('</nav>'));
    const at = (s: string) => nav.indexOf(s);
    expect(at('href="/app"')).toBeLessThan(at('id="nav-customers"'));
    expect(at('id="nav-customers"')).toBeLessThan(at('href="/app/inbox"'));
    expect(at('href="/app/inbox"')).toBeLessThan(at('href="/app/calendar"'));
    expect(at('href="/app/calendar"')).toBeLessThan(at('href="/app/employee"'));
    expect(at('<div class="navfoot">')).toBeLessThan(at('href="/app/settings"'));
    expect(nav).not.toContain('/logout');
    expect(nav).not.toContain('href="/app/business"');
    // five entries — the phone's one row — each with its shape
    expect(nav.match(/class="navlink[ "]/g)).toHaveLength(5);
    expect(nav.match(/<a [^>]*class="navlink[\s\S]*?<\/a>/g)?.every((a) => a.includes('<svg class="ni sl"'))).toBe(true);
  });

  it('"Customers" heads its two pages; the customer list carries the one number (phase 9: one name for the area, V1-002), and is lit here', () => {
    const html = page('/app/inbox/c-1');
    expect(html).toMatch(/<span class="navhead" id="nav-customers"><svg[^>]*>[\s\S]*?<\/svg><span>Customers<\/span><\/span>/);
    expect(html).toMatch(/<a href="\/app\/inbox" class="navlink sub active" data-nav="inbox" aria-current="page" aria-label="Inbox, 3 customers need you"\s*><svg[^>]*>[\s\S]*?<\/svg><span class="nl-body"><span class="nl-text">Inbox<\/span><span class="navcount" aria-hidden="true"><span class="nl-long">3 waiting<\/span><span class="nl-short">3<\/span><\/span><\/span><\/a>/);
    expect(html).toMatch(/<a href="\/app\/calendar" class="navlink sub" data-nav="calendar"\s*><svg/);
    const cal = page('/app/calendar');
    expect(cal).toMatch(/<a href="\/app\/calendar" class="navlink sub active" data-nav="calendar" aria-current="page"/);
    // nobody waiting: no number at all, not a zero
    const calm = withWorkspace({ ...SCOPE, needsYou: 0 }, () => shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
    expect(calm).toMatch(/<a href="\/app\/inbox" class="navlink sub" data-nav="inbox"\s*><svg[^>]*>[\s\S]*?<\/svg><span class="nl-body"><span class="nl-text">Inbox<\/span><\/span><\/a>/);
  });

  // The warmth run: "Log out leaves the rail entirely" — it is the foot of Settings.
  it('Log out is a button in a form — it changes something — at the foot of Settings, not in the rail', () => {
    expect(page('/app')).not.toContain('action="/logout"');
    const home = withWorkspace(SCOPE, () => renderSettingsHome('en', null));
    expect(home).toMatch(/<form class="scard sr-foot" method="post" action="\/logout">\s*<button class="srow sr-menu sr-out" type="submit">/);
    expect(buttonsAndDoors(page('/app'))).toEqual([]);
    expect(buttonsAndDoors(home)).toEqual([]);
  });

  it('the tab names the page, then the business — never the assistant', () => {
    expect(page('/app/inbox/c-1')).toContain('<title>Maya Rahman · Hana Skincare</title>');
    expect(withWorkspace({ ...SCOPE, business: null }, () => shell({ title: 'Today', active: 'home', locale: 'en', path: '/app', bodyHtml: '' })))
      .toContain('<title>Today · Nomi</title>');
  });

  it('phase 9 (V1-003) · a page with its own heading names itself in the tab, not its area', () => {
    const body = '<h1 class="page">Days you are <bdi>closed</bdi> &amp; away</h1><p>…</p>';
    const html = withWorkspace({ ...SCOPE, business: null }, () => shell({ title: 'Setup', active: 'settings', locale: 'en', path: '/app/settings/closures', bodyHtml: body }));
    expect(html).toContain('<title>Days you are closed &amp; away · Nomi</title>');
    expect(html).not.toContain('<title>Setup ·');
  });

  it('in Arabic the Customers head and its pages speak Arabic; on a phone the groups dissolve into the one row', () => {
    const ar = page('/app/inbox/c-1', 'ar');
    expect(ar).toContain(`>${t('ar', 'nav.customers')}</span>`);
    const css = linkedCss(ar);
    const phone = css.slice(css.indexOf('@media (max-width: 720px)'));
    expect(phone).toMatch(/\.navgroup, \.navfoot, \.navhub \{ display:contents; \}/);
    expect(phone).toMatch(/\.navhead \{ display:none; \}/);
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

  // The warmth run, phase 4 — the pane draws the Inbox's own row (face, name, spent, last contact):
  // `irow`, its conversation link `ir-main`; the ○ ● ✦ column gave its place to the face.
  it('the current conversation is marked; each row is name, last message, time; its state is the heading above it', () => {
    const html = renderListPane(list, 'en', NOW, 'c-1');
    expect(html).toMatch(/<div class="irow is-\w+[^"]* on">(?:(?!<div class="irow)[\s\S])*?<a class="ir-main" href="\/app\/inbox\/c-1#latest" aria-current="page">/);
    // Phase 9 (V1-233) — headed as the list page heads them: under the Needs-you tab the tab is the heading.
    expect(html).not.toContain('class="lp-group"');
    expect(renderListPane({ ...list, filter: 'all' }, 'en', NOW, 'c-1')).toContain(`<li class="lp-group" aria-hidden="true">${t('en', 'buyers.group.needsYou')}</li>`);
    expect(html).not.toContain('class="tag');
    // the list page's own row: the assistant wrote c-2's last message, so the one magenta ✦ leads it
    expect(html).toMatch(/<div class="irow is-hers[^"]*">/);
    expect(html).toMatch(/href="\/app\/inbox\/c-2#latest">[\s\S]*?<svg class="am as sl" data-mark="agent"[^>]*>[\s\S]*?<\/svg>[\s\S]*?<span class="ir-text" dir="auto">last from c-2/);
    const first = html.slice(html.indexOf('href="/app/inbox/c-1#latest"'));
    expect(first.slice(0, first.indexOf('</a>'))).not.toContain('✦');
    // no product line anywhere on the row
    expect(html).not.toContain('class="cr-detail"');
  });

  // phase 4 — the pane's tabs are the Inbox's two lenses; the problem narrowings only while one
  // exists; "Mine" never (team machinery the owner ruled out).
  it('an empty tab is not shown: never Mine, the problem tabs only while one exists', () => {
    const html = renderListPane(list, 'en', NOW, 'c-1');
    expect(html).toContain('<nav class="tabs lens"');
    expect(html).toContain('href="/app/inbox?lens=value"');
    expect(html).not.toContain('filter=mine');
    expect(html).not.toContain('filter=blocked');
    expect(html).not.toContain('filter=deletion');
    const busy = renderListPane({ ...list, blockedCount: 2, deletionCount: 1 }, 'en', NOW, 'c-1',
      [{ id: 'p1', name: 'Owner', isOwner: true }, { id: 'p2', name: 'Xiao', isOwner: false }]);
    for (const f of ['blocked', 'deletion']) expect(busy).toContain(`filter=${f}`);
    expect(busy).not.toContain('filter=mine');
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
    promised: [{ said: 'I\'ll check the 100 ml and write by Friday.', dueOn: '2026-10-02', byAssistant: true, conversationId: 'c-1' }],
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
    expect(html).toContain('WhatsApp <bdi dir="ltr">+447700900123</bdi> · writes in English · ');
    expect(html).toContain('First wrote: ');   // the fix wave (w4-conversation-06): the file's words, the day's own form
    expect(html).toContain('2 conversations');
    expect(html).toContain('<bdi>Rose Face Serum</bdi></span><span class="pn-r">3 times · 18:00</span>');
    expect(html).toContain('<h3>Prices worked out</h3>');
    expect(html).toContain('href="/app/inbox/c-9#latest"');
    expect(html).toContain('Sample · asked ');
    // 0083 — what was promised them, in the words that reached them, with the assistant's mark
    expect(html).toContain('<h3>Promised</h3>');
    expect(html).toContain('' + agentMark(16, 'am as') + ' <bdi dir="auto">“I\'ll check the 100 ml and write by Friday.”</bdi>');
    expect(html).toContain('<bdi>Order W-1042</bdi>');
    expect(html).toContain('<span class="dot warn shape s-waiting" aria-hidden="true"></span> Needs you');
    expect(html).toContain('' + agentMark(16, 'am as') + ' Lily replied');
    expect(html).toContain('<span class="shape s-you pn-you" aria-hidden="true"></span> You sent Lily’s draft');
    expect(html).toContain('Lily’s reply didn’t reach them <span class="dot bad shape s-failed" aria-hidden="true"></span>');
    expect(html).toContain('href="/app/conversations/c-1"');
  });

  it('a block with nothing in it is not drawn — no zero, no empty heading', () => {
    const html = renderCustomerPanel({ ...panel, askedAbout: [], prices: [], samples: [], promised: [], orders: [], activity: [] }, [], 'en', NOW, 'c-1');
    for (const h of ['Asked about', 'Prices worked out', 'Promised', 'On record', 'On the calendar', 'Activity']) expect(html).not.toContain(`<h3>${h}</h3>`);
  });

  it('phase 9 · a price row: the price and its product on one line, the time on the next, no stray separator (V1-226)', () => {
    const html = renderCustomerPanel(panel, [], 'en', NOW, 'c-1');
    const row = html.slice(html.indexOf('$34.90'), html.indexOf('</li>', html.indexOf('$34.90')));
    expect(row).toMatch(/Rose Face Serum<\/bdi><br><span class="muted small">/);
    expect(row).not.toMatch(/ · [^<]*\d{1,2}:\d{2}/);
  });

  it('phase 9 · a phone number reads left to right in Arabic too (conversation-missed-01)', () => {
    const html = renderCustomerPanel({ ...panel, channel: 'whatsapp', address: '2345000000261' }, [], 'ar', NOW, 'c-1');
    expect(html).toContain('<bdi dir="ltr">+2345000000261</bdi>');
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

describe('Phase 9 · an empty filter beside a conversation says what it is, never "No conversations yet"', () => {
  it('mine, deletion, blocked and a search each say their own thing', async () => {
    const { renderListPane } = await import('../../src/api/web/panes.js');
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const base: InboxList = { filter: 'all', blockedCount: 0, waitingCount: 0, conversations: [] };
    const said = (over: Partial<InboxList>) => renderListPane({ ...base, ...over }, 'en', new Date(), 'c-1');
    expect(said({ filter: 'mine' })).toContain(t('en', 'inbox.empty.mine'));
    expect(said({ filter: 'deletion' })).toContain(t('en', 'inbox.empty.deletion'));
    expect(said({ filter: 'blocked' })).toContain(t('en', 'refused.none'));
    expect(said({ query: 'zz' })).toContain(t('en', 'buyers.search.none', { q: 'zz' }));
    const others: Partial<InboxList>[] = [{ filter: 'mine' }, { filter: 'deletion' }, { filter: 'blocked' }, { query: 'zz' }];
    for (const over of others) {
      expect(said(over)).not.toContain(t('en', 'inbox.empty.none'));
    }
    expect(said({})).toContain(t('en', 'inbox.empty.none'));   // only a truly empty list says it
  });
});
