import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { esc, wordsHtml } from './layout.js';
import { GO, solarSvg } from './icons.js';
import { t, booksShown, viewerRole, outreachShown, exportSettingsShown, adsShown } from './say.js';
import { settingsHref } from './settingsNavigation.js';

/**
 * THE NAVIGATION BLOCK (2026-11-25, the owner's decision) — two layers everywhere, as Intercom has them: the rail
 * names the areas, and inside each area a section sidebar lists ALL of it, in named groups, so no feature hides in a
 * tab, in Settings or behind one link. This file is that map: each area's groups and items, who sees each one, and
 * which addresses light it. The URLs of pages did not move; an item names the pages it owns.
 *
 * The owner's choices, recorded: Reports is its own area and the books' reports appear there too; the assistant's
 * settings live under Assistant and the books' settings under Books, so Settings keeps only the workspace; payment
 * links sit under Products.
 */
export type AreaId = 'home' | 'inbox' | 'customers' | 'products' | 'assistant' | 'books' | 'reports' | 'ask' | 'settings';

type Item = {
  readonly label: MessageKey;
  readonly href: string;
  /** Other addresses this item owns (an older address, a page reached only from it). */
  readonly also?: readonly string[];
  /** Lit only on its own address, never on the pages under it. */
  readonly exact?: boolean;
  readonly show?: () => boolean;
};
type Group = { readonly label?: MessageKey; readonly items: readonly Item[]; readonly show?: () => boolean };

const owner = (): boolean => viewerRole() === 'owner';
const notAccountant = (): boolean => viewerRole() !== 'accountant';

const ASSISTANT_SETTINGS = '/app/settings/assistant';
const BOOKS_SETTINGS = '/app/settings/books';

export const AREAS: Readonly<Record<AreaId, readonly Group[]>> = {
  home: [{ items: [
    { label: 'split.title', href: '/app', exact: true },
    { label: 'nav.calendar', href: '/app/calendar' },
    { label: 'nav.getStarted', href: '/app/get-started', also: ['/app/guide', '/app/onboarding', '/app/ready'] },
  ] }],
  inbox: [
    { label: 'side.views', items: [
      { label: 'inbox.filter.pending', href: '/app/inbox?filter=pending' },
      { label: 'inbox.view.quiet', href: '/app/inbox?filter=quiet' },
      { label: 'inbox.view.assistant', href: '/app/inbox?filter=assistant' },
      { label: 'inbox.view.all', href: '/app/inbox?filter=all' },
    ] },
    { label: 'side.tools', items: [
      { label: 'igComments.title', href: '/app/channels/instagram/comments' },
      { label: 'savedReplies.title', href: '/app/inbox/replies', also: ['/app/replies'] },
    ] },
  ],
  customers: [{ items: [
    { label: 'customers.all', href: '/app/customers', also: ['/app/conversations'] },
    { label: 'customers.orders', href: '/app/customers/orders', also: ['/app/orders'] },
    { label: 'settingsArea.sampleRequests', href: '/app/customers/samples', show: exportSettingsShown },
    { label: 'customers.followups', href: '/app/customers/outreach', also: ['/app/contacts', '/app/prospects', '/app/sequences'], show: outreachShown },
    { label: 'customers.labels', href: '/app/customers/labels', also: ['/app/labels'] },
    { label: 'customers.feedback', href: '/app/customers/feedback', also: ['/app/surveys'] },
    { label: 'side.import', href: '/app/customers/import', show: owner },
  ] }],
  products: [
    { label: 'side.catalogue', items: [
      { label: 'products.all', href: '/app/products' },
      { label: 'products.add', href: '/app/products/add', also: ['/app/products/import'], show: owner },
      { label: 'products.limits', href: '/app/products/price-limits', also: ['/app/business/prices'], show: owner },
    ] },
    { label: 'side.sell', items: [
      { label: 'waCatalog.title', href: '/app/products/whatsapp' },
      { label: 'shopifyOrders.nav', href: '/app/settings/business/shopify', show: owner },
      { label: 'paymentLinks.title', href: '/app/payments/stripe', show: owner },
    ] },
  ],
  assistant: [
    { items: [{ label: 'assistantArea.overview', href: '/app/assistant', exact: true }] },
    { label: 'side.teach', items: [
      { label: 'assistantArea.knowledge', href: '/app/assistant/knowledge', also: ['/app/knowledge'] },
      { label: 'procedures.title', href: '/app/assistant/knowledge/procedures' },
    ] },
    { label: 'side.test', items: [
      { label: 'assistantArea.practice', href: '/app/assistant/practice', also: ['/app/sandbox'] },
      { label: 'assistantArea.review', href: '/app/assistant/review', also: [`${ASSISTANT_SETTINGS}/checks`] },
    ] },
    { label: 'side.goLive', items: [
      { label: 'settingsArea.permissions', href: ASSISTANT_SETTINGS, also: [`${ASSISTANT_SETTINGS}/alone`] },
      { label: 'settingsArea.identity', href: `${ASSISTANT_SETTINGS}/name` },
      { label: 'settingsArea.promises', href: `${ASSISTANT_SETTINGS}/promises` },
      { label: 'settingsArea.ready', href: `${ASSISTANT_SETTINGS}/ready` },
      { label: 'settingsArea.words', href: `${ASSISTANT_SETTINGS}/words` },
      { label: 'settingsArea.historyPolicy', href: `${ASSISTANT_SETTINGS}/history-policy`, show: owner },
    ] },
    { label: 'side.watch', items: [
      { label: 'assistantArea.activity', href: '/app/assistant/activity', also: [`${ASSISTANT_SETTINGS}/history`] },
    ] },
  ],
  books: [
    { items: [
      { label: 'booksArea.overview', href: '/app/books', exact: true },
      { label: 'booksArea.getPaid', href: '/app/books/invoices', also: ['/app/books/credit-notes', '/app/books/orders'] },
      { label: 'booksArea.spending', href: '/app/books/spending', also: ['/app/books/papers'] },
      { label: 'booksArea.bank', href: '/app/books/bank' },
      { label: 'booksArea.reports', href: '/app/books/reports', also: ['/app/books/fec'] },
      { label: 'booksArea.yearEnd', href: '/app/books/year-end', also: ['/app/books/closing'] },
      { label: 'booksArea.advanced', href: '/app/books/advanced', also: ['/app/books/entries', '/app/books/trial-balance'] },
    ] },
    { label: 'side.setup', show: owner, items: [
      { label: 'booksArea.setup', href: BOOKS_SETTINGS },
      { label: 'books.country.nav', href: `${BOOKS_SETTINGS}/country` },
      { label: 'booksArea.opening', href: `${BOOKS_SETTINGS}/starting-balances` },
      { label: 'booksArea.accounts', href: `${BOOKS_SETTINGS}/accounts` },
      { label: 'booksArea.taxDetails', href: `${BOOKS_SETTINGS}/tax` },
      { label: 'invoice.settings.title', href: `${BOOKS_SETTINGS}/invoices-out` },
      { label: 'booksArea.connections', href: `${BOOKS_SETTINGS}/connections` },
      { label: 'booksArea.fields', href: `${BOOKS_SETTINGS}/fields` },
    ] },
  ],
  reports: [
    { items: [
      { label: 'area1.results.sales', href: '/app/results', also: ['/app/analytics'] },
      { label: 'area1.results.assistant', href: '/app/results?view=assistant', also: [`${ASSISTANT_SETTINGS}/month`] },
      { label: 'area1.results.setup', href: '/app/results?view=setup', also: ['/app/onboarding/activity'] },
      { label: 'monthMail.tab', href: '/app/results/month' },
      { label: 'adSpend.title', href: '/app/results#ad-spend', show: adsShown },
    ] },
    // The owner's choice: the books' reports appear here too. They open in Books, where they live.
    { label: 'side.reportsBooks', show: () => owner() && booksShown(), items: [
      { label: 'side.booksReports', href: '/app/books/reports' },
    ] },
  ],
  ask: [],
  settings: [
    { label: 'side.workspace', show: notAccountant, items: [
      { label: 'settingsArea.profile', href: '/app/settings/business/profile', also: ['/app/settings/business'] },
      { label: 'settingsArea.selling', href: '/app/settings/business/selling' },
      { label: 'settingsArea.hours', href: '/app/settings/business/hours' },
      { label: 'settingsArea.currency', href: '/app/settings/business/currency' },
      { label: 'settingsArea.terms', href: '/app/settings/business/terms', show: exportSettingsShown },
      { label: 'settingsArea.samples', href: '/app/settings/business/samples', show: exportSettingsShown },
    ] },
    { label: 'settingsArea.channels', show: notAccountant, items: [
      { label: 'side.channelsAll', href: '/app/settings/channels', exact: true, also: ['/app/settings/channels/technical'] },
      { label: 'side.ch.whatsapp', href: '/app/settings/channels/whatsapp' },
      { label: 'side.ch.meta', href: '/app/settings/channels/meta' },
      { label: 'side.ch.email', href: '/app/settings/channels/email' },
      { label: 'side.ch.chat', href: '/app/settings/channels/chat' },
      { label: 'reach.channel.telegram', href: '/app/settings/channels/telegram' },
      { label: 'reach.channel.tiktok', href: '/app/settings/channels/tiktok' },
    ] },
    { label: 'side.teamBilling', show: owner, items: [
      { label: 'settingsArea.team', href: '/app/settings/team' },
      { label: 'settingsArea.billing', href: '/app/settings/billing' },
    ] },
    { label: 'side.you', items: [
      { label: 'settingsArea.data', href: '/app/settings/business/data', show: owner },
      { label: 'settingsArea.account', href: '/app/settings/personal/account', also: ['/app/settings/personal'] },
      { label: 'settingsArea.notifications', href: '/app/settings/personal/notifications', show: notAccountant },
      { label: 'settingsArea.language', href: '/app/settings/personal/language' },
      { label: 'settingsArea.history', href: '/app/settings/personal/advisor-history', show: notAccountant },
    ] },
  ],
};

/** The rail's label for each area that has a sidebar: the sidebar's heading. */
const AREA_TITLE: Readonly<Record<AreaId, MessageKey>> = {
  home: 'split.title', inbox: 'nav.inbox', customers: 'nav.customers', products: 'nav.products', assistant: 'nav.assistant',
  books: 'nav.books', reports: 'nav.reports', ask: 'assistantArea.ask', settings: 'nav.settings',
};

const visible = (area: AreaId): readonly Group[] =>
  AREAS[area].filter((g) => g.show?.() ?? true)
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show?.() ?? true) }))
    .filter((g) => g.items.length > 0);

const base = (href: string): string => (href.split(/[?#]/)[0] ?? href).replace(/\/+$/, '') || '/app';
const params = (href: string): URLSearchParams => new URLSearchParams(/\?([^#]*)/.exec(href)?.[1] ?? '');

/**
 * The item a page belongs to: the longest address that owns it. An item that names a query (a Reports view) wins over
 * its bare address when the page carries that query. An anchor (Ad spend) is never "here": it is a place on a page.
 */
export function currentItem(area: AreaId, path: string): Item | null {
  const url = base(settingsHref(path));
  const query = params(path);
  let best: { score: number; item: Item } | null = null;
  for (const g of AREAS[area]) for (const item of g.items) {
    if (item.href.includes('#')) continue;
    const want = params(item.href);
    if ([...want].some(([k, v]) => query.get(k) !== v)) continue;
    const bonus = [...want].length ? 1000 : 0;
    for (const route of [base(item.href), ...(item.also ?? [])]) {
      const hit = url === route || (!item.exact && url.startsWith(`${route}/`));
      if (hit && (best === null || route.length + bonus > best.score)) best = { score: route.length + bonus, item };
    }
  }
  return best?.item ?? null;
}

/**
 * Pages that draw their own second column, which IS the area's sidebar there: the Inbox list and a conversation
 * (their views carry live counts). The shell draws none beside them.
 */
const ownColumn = (area: AreaId, path: string): boolean => {
  const url = base(path);
  return area === 'inbox' && (url === '/app/inbox' || (/^\/app\/inbox\/[^/]+$/.test(url) && url !== '/app/inbox/replies'));
};

type Shape = Parameters<typeof solarSvg>[1];
/**
 * The sidebar's look (2026-11-26, the owner's reference): every item carries its own line icon. One shape per meaning,
 * the same shapes the rest of the app already uses for that thing (a channel, billing, the calendar).
 */
const ITEM_ICON: Readonly<Record<string, Shape>> = {
  '/app': 'home-2', '/app/calendar': 'calendar', '/app/get-started': 'checklist',
  '/app/inbox?filter=pending': 'bell', '/app/inbox?filter=quiet': 'history', '/app/inbox?filter=assistant': 'chat-round-dots',
  '/app/inbox?filter=all': 'inbox', '/app/channels/instagram/comments': 'chat-square', '/app/inbox/replies': 'copy',
  '/app/customers': 'users-group-rounded', '/app/customers/orders': 'delivery', '/app/customers/samples': 'gift',
  '/app/customers/outreach': 'restart', '/app/customers/labels': 'tag', '/app/customers/feedback': 'quote',
  '/app/customers/import': 'download-minimalistic',
  '/app/products': 'box', '/app/products/add': 'download-minimalistic', '/app/products/price-limits': 'banknote',
  '/app/products/whatsapp': 'chat-round-line', '/app/settings/business/shopify': 'shop', '/app/payments/stripe': 'card',
  '/app/assistant': 'widget-2', '/app/assistant/knowledge': 'notebook-minimalistic', '/app/assistant/knowledge/procedures': 'checklist',
  '/app/assistant/practice': 'play-circle', '/app/assistant/review': 'check-circle', [ASSISTANT_SETTINGS]: 'tuning-2',
  [`${ASSISTANT_SETTINGS}/name`]: 'user-id', [`${ASSISTANT_SETTINGS}/promises`]: 'shield-check', [`${ASSISTANT_SETTINGS}/ready`]: 'power',
  [`${ASSISTANT_SETTINGS}/words`]: 'forbidden-circle', [`${ASSISTANT_SETTINGS}/history-policy`]: 'history', '/app/assistant/activity': 'flag',
  '/app/books': 'widget-2', '/app/books/invoices': 'hand-money', '/app/books/spending': 'banknote', '/app/books/bank': 'transfer-horizontal',
  '/app/books/reports': 'chart-2', '/app/books/year-end': 'calendar-mark', '/app/books/advanced': 'settings',
  [BOOKS_SETTINGS]: 'checklist', [`${BOOKS_SETTINGS}/country`]: 'global', [`${BOOKS_SETTINGS}/starting-balances`]: 'flag',
  [`${BOOKS_SETTINGS}/accounts`]: 'folder', [`${BOOKS_SETTINGS}/tax`]: 'file-text', [`${BOOKS_SETTINGS}/invoices-out`]: 'letter',
  [`${BOOKS_SETTINGS}/connections`]: 'transfer-horizontal', [`${BOOKS_SETTINGS}/fields`]: 'tuning-2',
  '/app/results': 'chart-2', '/app/results?view=assistant': 'chat-round-dots', '/app/results?view=setup': 'checklist',
  '/app/results/month': 'letter', '/app/results#ad-spend': 'banknote',
  '/app/settings/business/profile': 'shop', '/app/settings/business/selling': 'hand-money', '/app/settings/business/hours': 'calendar-mark',
  '/app/settings/business/currency': 'transfer-horizontal', '/app/settings/business/terms': 'file-text', '/app/settings/business/samples': 'gift',
  '/app/settings/channels': 'dialog', '/app/settings/channels/whatsapp': 'chat-round-line', '/app/settings/channels/meta': 'chat-square',
  '/app/settings/channels/email': 'letter', '/app/settings/channels/chat': 'chat-round-dots', '/app/settings/channels/telegram': 'send-square',
  '/app/settings/channels/tiktok': 'music-note', '/app/settings/team': 'users-group-two-rounded', '/app/settings/billing': 'card',
  '/app/settings/business/data': 'folder', '/app/settings/personal/account': 'key', '/app/settings/personal/notifications': 'bell',
  '/app/settings/personal/language': 'global', '/app/settings/personal/advisor-history': 'history',
};
/** The books' reports, listed under Reports too: the same chart as under Books would read as a second copy. */
const iconOf = (area: AreaId, item: Item): Shape =>
  area === 'reports' && item.href === '/app/books/reports' ? 'notebook-minimalistic' : ITEM_ICON[item.href] ?? 'list';

const link = (locale: Locale, area: AreaId, item: Item, here: Item | null): string =>
  `<a href="${esc(item.href)}"${item === here ? ' aria-current="page"' : ''}>${solarSvg('sect-ic', iconOf(area, item), 20)}<span>${wordsHtml(locale, item.label)}</span></a>`;

/** The search at the top of the sidebar: customers, by name, e-mail or phone — the Inbox's own search. */
const search = (locale: Locale): string => notAccountant()
  ? `<form class="sect-search" method="get" action="/app/inbox" role="search"><input type="hidden" name="filter" value="all" />`
    + `<label>${solarSvg('sect-ic', 'magnifier', 20)}<span class="sr">${esc(t(locale, 'buyers.search.label'))}</span>`
    + `<input type="search" name="q" placeholder="${esc(t(locale, 'buyers.search.placeholder'))}" /></label></form>`
  : '';

/** True when this page has a section sidebar to draw. */
export const hasSections = (area: AreaId, path: string): boolean => !ownColumn(area, path) && visible(area).length > 0;

/**
 * The section sidebar, desktop: the business's name, the area's name, then each group under its own small heading.
 * One "you are here" style, the rail's own.
 */
export function sectionSidebar(locale: Locale, area: AreaId, path: string): string {
  if (!hasSections(area, path)) return '';
  const here = currentItem(area, path);
  // A group with no name of its own (an area's first, its overview) is headed by the area's name: the rail's icons
  // carry no words, so the sidebar says where you are.
  const groups = visible(area).map((g) =>
    `<div class="sect-group"><p class="sect-head">${wordsHtml(locale, g.label ?? AREA_TITLE[area])}</p>${g.items.map((i) => link(locale, area, i, here)).join('')}</div>`).join('');
  return `<aside class="sect" aria-label="${esc(t(locale, 'side.label'))}">${search(locale)}`
    + `<nav aria-label="${esc(t(locale, AREA_TITLE[area]))}">${groups}</nav></aside>`;
}

/**
 * The same list on a phone, where there is no room for a second column: a chooser at the top of the page, named by
 * the page you are on. Where that name is the page's own title, the chooser IS the title (audit F04, kept).
 */
export function sectionChooser(locale: Locale, area: AreaId, path: string, bodyHtml: string): string {
  if (!hasSections(area, path)) return '';
  const here = currentItem(area, path);
  const name = t(locale, here?.label ?? AREA_TITLE[area]);
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(bodyHtml)?.[1]?.replace(/<[^>]+>/g, '').trim();
  const titled = h1 !== undefined && h1 === esc(name) ? ' data-titled' : '';
  const groups = visible(area).map((g) =>
    `${g.label ? `<p class="sect-head">${wordsHtml(locale, g.label)}</p>` : ''}${g.items.map((i) => link(locale, area, i, here)).join('')}`).join('');
  return `<nav class="area-nav" aria-label="${esc(t(locale, 'nav.sections'))}"><details class="area-chooser"${titled}><summary><span class="ac-name"><span class="ac-area">${wordsHtml(locale, AREA_TITLE[area])}</span>${here ? `<span class="ac-page">${wordsHtml(locale, here.label)}</span>` : ''}</span>${GO}</summary><div>${groups}</div></details></nav>`;
}

/** Is this address one of the area's own entries (so it needs no "‹ back" link: the sidebar is the way)? */
export const isSectionPage = (area: AreaId, path: string): boolean => {
  const item = currentItem(area, path);
  // Its own address only: a page an item merely owns (a sub-page, an older address) keeps the way back it is given.
  return item !== null && base(item.href) === base(settingsHref(path));
};
