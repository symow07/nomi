import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { heldByName, type Person } from '../../core/conversation/people.js';
import { STAGES, type Stage } from '../../db/customerStage.js';
import { esc, deeper, back, conversationUrl, LIVE_SLOT } from './layout.js';
import { t, assistantName, businessName, outreachShown } from './say.js';
import { GO } from './icons.js';
import { face, faceLink } from './faces.js';
import { asksSomething, buyersHref, isNew, markHit, needsWhy, preview, productName, rowState, sinceDate, waitingGroups, type ConversationSummary, type InboxFilter, type InboxList } from './inbox.js';
import { quietWords, whole } from './splitToday.js';
import { workspaceZone } from './zone.js';
import * as show from './values.js';
import type { AttentionItem } from '../../db/inboxAttention.js';
import type { BuyersLens } from '../../db/buyersList.js';
import { safeInboxReturn } from './inboxNavigation.js';

/**
 * The approved Inbox: scoped views, search and filters over one flat list, with a native view chooser on a phone.
 * Existing readers and counts remain the source of truth; selecting a row is presentation only. Each row carries:
 * photo or initial, name, product photo, stage, value, days quiet. The rows that need the owner carry the dot, say why,
 * and lead the list; their name is bold until opened.
 *
 * NOTHING HERE DECIDES. The list and its order are `readBuyersPage`'s, the same as the plain page; a row is a door to the
 * conversation, whose own routes and cards hold every safety. What the plain page offers stays: the search, the labels,
 * "Matters most", paging, a customer's card from their face, "Did not send" and "Deletion requests" while they hold
 * someone (rule 18), and the doors at its foot.
 */

/** The five views, in the owner's order. */
const VIEWS: readonly InboxFilter[] = ['pending', 'quiet', 'assistant', 'team', 'all'];
const VIEW_WORD: Readonly<Record<string, MessageKey>> = {
  mine: 'inbox.filter.mine', blocked: 'inbox.filter.blocked', deletion: 'inbox.filter.deletion', pending: 'inbox.filter.pending', quiet: 'inbox.view.quiet', assistant: 'inbox.view.assistant', team: 'inbox.view.team', all: 'inbox.view.all',
};

type View = { readonly filter: InboxFilter; readonly stage: Stage | null; readonly lens: BuyersLens; readonly q: string; readonly label: string | null };

const hrefOf = (v: View, change: Partial<View> & { readonly after?: string | null; readonly before?: string | null } = {}): string =>
  buyersHref({ ...v, ...change, explicit: true });

/** What the second line of a row says: why it needs the owner, why it was listed as quiet, who holds it, and what was searched. */
function whyOf(locale: Locale, c: ConversationSummary, o: { readonly people: readonly Person[]; readonly quiet: AttentionItem | undefined; readonly now: Date; readonly q: string }): string {
  const state = rowState(c);
  const parts: string[] = [];
  if (state === 'needs') {
    parts.push(esc(c.orderWaiting !== true && c.deletionWaiting === true ? t(locale, 'buyers.badge.deletion') : needsWhy(locale, c)));
  } else if (o.quiet) {
    parts.push(esc(t(locale, `buyers.attention.${o.quiet.kind}` as MessageKey, { date: sinceDate(locale, o.quiet.since, o.now) })));
  } else if (state === 'yours' && o.people.length > 0) {
    const who = heldByName(c.heldBy, o.people, {
      ai: assistantName(locale), waiting: t(locale, 'people.held.waiting'),
      owner: t(locale, 'people.held.owner'), gone: t(locale, 'people.held.gone'),
    });
    if (who) parts.push(esc(t(locale, 'people.holding', { who })));
  } else if (state === 'hers' && c.unanswered === true && c.live !== false && asksSomething(c.latestMessage)) {
    parts.push(esc(t(locale, 'buyers.row.noReply')));
  } else if (state === 'hers' && c.answeredBy && c.lastFrom !== 'assistant') {
    parts.push(esc(t(locale, 'buyers.group.hers', { name: c.answeredBy })));
  }
  if (c.regular === true) parts.push(esc(t(locale, 'buyers.row.regular')));
  // A search that found them by what they asked about says so: the photo alone cannot.
  const prod = productName(locale, c.product);
  if (o.q && prod && markHit(prod, o.q) !== esc(prod)) parts.push(markHit(prod, o.q));
  return parts.map((p) => `<bdi>${p}</bdi>`).join(' · ');
}

/**
 * The last message, one faded line. The element that cuts it is the isolate, so Latin and Arabic each run their own way
 * and are cut at their own end. Words the seller's side wrote say who wrote them: they are not the customer's.
 */
function lastSaid(locale: Locale, c: ConversationSummary): string {
  if (!c.latestMessage) return '';
  const by = c.lastFrom === 'person' ? t(locale, 'conv.by.you')
    : c.lastFrom === 'assistant' ? (c.answeredBy ?? assistantName(locale)) : null;
  const speaker = by ? `<span class="si-by"><bdi>${esc(by)}</bdi>${locale === 'zh' ? '：' : ':'}</span>` : '';
  return `<span class="si-said">${speaker}<bdi class="si-last">${esc(preview(c.latestMessage))}</bdi></span>`;
}

function row(locale: Locale, c: ConversationSummary, o: { readonly people: readonly Person[]; readonly attention: readonly AttentionItem[]; readonly now: Date; readonly q: string; readonly lens: BuyersLens; readonly zone: string; readonly returnHref: string; readonly selectedId?: string }): string {
  const who = c.buyer ?? t(locale, 'common.buyer');
  const needs = rowState(c) === 'needs';
  const why = whyOf(locale, c, { people: o.people, quiet: o.attention.find((a) => a.clientId === c.clientId), now: o.now, q: o.q });
  // "Matters most" is ordered by what they spent, so the row says that; otherwise the stage's own figure, as on Today.
  const value = o.lens === 'value' ? (c.spent ?? c.quoted ?? null) : (c.value ?? null);
  const stage: Stage = c.stage ?? 'asked';
  const prod = productName(locale, c.product);
  const said = lastSaid(locale, c);
  const returnToRow = `${o.returnHref.split('#')[0]}#inbox-${c.conversationId}`;
  const door = `${conversationUrl(c.conversationId).split('#')[0]}?from=${encodeURIComponent(returnToRow)}#latest`;
  const theFace = c.clientId
    ? faceLink({ clientId: c.clientId, name: c.buyer, photo: c.photo ?? null }, { size: 's', label: t(locale, 'buyers.row.card', { who }), className: 'si-face' })
    : `<span class="si-face">${face({ clientId: c.conversationId, name: c.buyer }, 's')}</span>`;
  const thumb = c.thumb
    ? `<img class="sp-thumb sp-thumb-s" src="${esc(c.thumb)}" alt="${esc(prod ?? '')}" width="28" height="28" loading="lazy" decoding="async">`
    : '<span class="sp-thumb sp-thumb-s sp-thumb-none" aria-hidden="true"></span>';
  // CC-25 — a customer opens on the newest message, the reply waiting under it. The name is the row's door; its reach is the row's.
  return `<li id="inbox-${esc(c.conversationId)}"><div class="sp-row si-row${needs ? ' is-needs' : ''}${isNew(c) ? ' is-new' : ''}${o.selectedId === c.conversationId ? ' is-selected' : ''}">
    <span class="si-dot" aria-hidden="true">${needs ? '<span class="row-dot"></span>' : ''}</span>
    ${theFace}
    <div class="si-who"><a class="si-door" href="${esc(door)}"${o.selectedId === c.conversationId ? ' aria-current="page"' : ''}><bdi class="sp-rname">${markHit(who, o.q)}</bdi></a>${
      needs ? `<span class="sr">${esc(t(locale, 'buyers.group.needsYou'))}</span>` : ''}${isNew(c) ? `<span class="sr">${esc(t(locale, 'buyers.row.unopened'))}</span>` : ''}${
      why || said ? `<div class="si-line">${why ? `<span class="si-why">${why}</span>` : ''}${said}</div>` : ''}</div>
    ${thumb}
    <span class="sp-chip${stage === 'order' ? ' is-order' : ''}">${esc(t(locale, `split.stage.${stage}`))}</span>
    <span class="sp-rval">${value ? esc(whole(show.money(locale, value))) : ''}</span>
    <span class="sp-rday">${esc(quietWords(locale, c.latestAt, o.now, o.zone))}</span>
    ${GO}
  </div></li>`;
}

const viewOf = (data: InboxList): View => ({
  filter: data.filter, stage: data.stage ?? null, lens: data.lens ?? 'waiting', q: data.query ?? '', label: data.label?.id ?? null,
});
/** Prefer validated presentation context so the original cursor survives; otherwise rebuild the current view scope. */
export const inboxReturnHref = (data: InboxList): string => safeInboxReturn(data.returnHref) ?? hrefOf(viewOf(data));

const hidden = (name: string, value: string | null): string => value ? `<input type="hidden" name="${name}" value="${esc(value)}" />` : '';
const viewCount = (data: InboxList, f: InboxFilter): number | null => f === 'pending' ? data.waitingCount
  : f === 'blocked' ? data.blockedCount : f === 'deletion' ? data.deletionCount ?? null
  : f === 'mine' ? data.mineCount ?? null : f === 'quiet' ? data.views?.quiet ?? null
  : f === 'assistant' ? data.views?.assistant ?? null : f === 'team' ? data.views?.team ?? null : data.views?.everyone ?? null;
const viewWord = (locale: Locale, filter: InboxFilter): string => t(locale, VIEW_WORD[filter] ?? 'inbox.view.all');

/** The same scoped views on the full Inbox and above the conversation's combined views/list pane. */
export function renderInboxViews(data: InboxList, locale: Locale, options: { readonly compact?: boolean } = {}): string {
  const view = viewOf(data);
  const choices = [
    ...VIEWS.filter((f) => f !== 'team' || (viewCount(data, 'team') ?? 0) > 0 || data.filter === 'team'),
    ...(data.filter === 'mine' ? ['mine' as const] : []),
    ...(['blocked', 'deletion'] as const).filter((f) => (viewCount(data, f) ?? 0) > 0 || data.filter === f),
  ];
  const tabs = `<nav class="si-tabs" aria-label="${esc(t(locale, 'buyers.tabs'))}">${choices.map((f) =>
    `<a class="si-tab${data.filter === f ? ' on' : ''}"${data.filter === f ? ' aria-current="true"' : ''} href="${esc(hrefOf(view, { filter: f }))}">${esc(viewWord(locale, f))}${viewCount(data, f) === null ? '' : `<span class="si-tabn">${esc(show.count(locale, viewCount(data, f)!))}</span>`}</a>`).join('')}</nav>`;
  const chooser = `<form class="il-view-form" method="get" action="/app/inbox">
      ${hidden('q', view.q)}${hidden('stage', view.stage)}${hidden('lens', view.lens === 'value' ? 'value' : null)}${hidden('label', view.label)}
      <label><span>${esc(t(locale, 'area2.inbox.views'))}</span><select name="filter">${choices.map((f) =>
        `<option value="${f}"${data.filter === f ? ' selected' : ''}>${esc(viewWord(locale, f))}${viewCount(data, f) === null ? '' : ` · ${esc(show.count(locale, viewCount(data, f)!))}`}</option>`).join('')}</select></label>
      <button class="sp-btn" type="submit">${esc(t(locale, 'area2.inbox.show'))}</button>
    </form>`;
  return options.compact ? `<div class="il-views is-compact">${chooser}</div>` : `<div class="il-views">${tabs}${chooser}</div>`;
}

/** Existing tools remain doors, and the outreach feature remains workspace-gated. */
export function renderInboxTools(locale: Locale): string {
  return `<nav class="si-doors" aria-label="${esc(t(locale, 'area2.inbox.tools'))}">${deeper('/app/inbox/replies', t(locale, 'savedReplies.title'))}${outreachShown() ? deeper('/app/contacts', t(locale, 'contacts.title')) : ''}${deeper('/app/labels', t(locale, 'labels.pageTitle'))}${deeper('/app/surveys', t(locale, 'surveys.title'))}</nav>`;
}

/** Existing order/deletion priority, values and opened-state semantics, with optional visual selection only. */
export function renderInboxRows(data: InboxList, locale: Locale, now: Date, people: readonly Person[], options: { readonly selectedId?: string } = {}): string {
  const view = viewOf(data);
  const context = { people, attention: data.attention ?? [], now, q: view.q, lens: view.lens, zone: workspaceZone(), returnHref: inboxReturnHref(data), ...options };
  const list = (items: readonly ConversationSummary[], head?: string): string => items.length ? `<section class="si-group">${head ? `<h2 class="sp-cap">${esc(head)}</h2>` : ''}
      <ul class="sp-rows">${items.map((c) => row(locale, c, context)).join('')}</ul></section>` : '';
  const g = waitingGroups(data.conversations);
  return view.lens === 'value' ? list(data.conversations)
    : `${list(g.orders, t(locale, 'buyers.group.order'))}${list(g.deletion, t(locale, 'buyers.group.deletion'))}${list(data.conversations.filter((c) => !g.orders.includes(c) && !g.deletion.includes(c)))}`;
}

function emptyWords(locale: Locale, data: InboxList, view: View): string {
  const all = deeper(esc(hrefOf(view, { filter: 'all', stage: null, label: null, q: '' })), t(locale, 'area2.inbox.everyone'));
  const recovery = view.q ? deeper(esc(hrefOf({ ...view, q: '' }, { filter: 'all' })), t(locale, 'buyers.search.clear'))
    : view.stage || view.label ? deeper(esc(hrefOf(view, { stage: null, label: null })), t(locale, 'area2.inbox.clearFilters')) : all;
  const key: MessageKey = view.q ? 'buyers.search.noneBody' : view.stage ? 'inbox.empty.stage'
    : data.filter === 'pending' ? 'inbox.empty.allGoodBody'
    : data.filter === 'quiet' ? 'inbox.empty.quiet' : data.filter === 'assistant' ? 'inbox.empty.assistant'
    : data.filter === 'team' ? 'inbox.empty.team' : data.filter === 'mine' ? 'inbox.empty.mine'
    : data.filter === 'deletion' ? 'inbox.empty.deletion' : data.filter === 'blocked' ? 'refused.none' : 'inbox.empty.noneBody';
  const unfiltered = !view.q && !view.stage && !view.label && data.filter === 'all';
  return `<div class="il-empty">${data.filter === 'pending' && !view.q && !view.stage ? `<h3>${esc(t(locale, 'buyers.empty.calm'))}</h3>` : unfiltered ? `<h3>${esc(t(locale, 'inbox.empty.none'))}</h3>` : ''}
    <p>${esc(t(locale, key))}</p>${unfiltered ? deeper('/app/get-started', t(locale, 'inbox.empty.setup')) : recovery}</div>`;
}

export function renderSplitInbox(data: InboxList, locale: Locale, now: Date, people: readonly Person[] = []): string {
  const view = viewOf(data);
  const { q, lens } = view;
  // Search deliberately expands to everyone, preserving the selected stage, ranking and label.
  const search = `<form class="si-search" method="get" action="/app/inbox" role="search">
      <input type="hidden" name="filter" value="all" />${hidden('stage', view.stage)}${hidden('lens', lens === 'value' ? 'value' : null)}${hidden('label', view.label)}
      <input type="search" name="q" value="${esc(q)}" placeholder="${esc(t(locale, 'buyers.search.placeholder'))}" aria-label="${esc(t(locale, 'buyers.search.label'))}" />
      <button class="sp-btn" type="submit">${esc(t(locale, 'buyers.search.go'))}</button>
    </form>`;
  const fil = (on: boolean, href: string, words: string): string =>
    `<a class="si-fil${on ? ' on' : ''}"${on ? ' aria-current="true"' : ''} href="${esc(href)}">${words}</a>`;
  const stages = STAGES.filter((s) => s !== 'sample' || data.sampled === true || view.stage === 'sample');
  const stageFilter = `<nav class="si-fils" aria-label="${esc(t(locale, 'inbox.stage.label'))}">${fil(view.stage === null, hrefOf(view, { stage: null }), esc(t(locale, 'inbox.stage.all')))}${stages.map((s) => fil(view.stage === s, hrefOf(view, { stage: s }), esc(t(locale, `split.stage.${s}`)))).join('')}</nav>`;
  const order = `<nav class="si-fils si-order" aria-label="${esc(t(locale, 'buyers.lens.label'))}">${(['waiting', 'value'] as const).map((l) => fil(lens === l, hrefOf(view, { lens: l }), esc(t(locale, `buyers.lens.${l}`)))).join('')}</nav>`;
  const labels = (data.labels ?? []).filter((l) => l.buyers > 0 || l.id === view.label);
  const labelFilter = labels.length ? `<nav class="si-fils" aria-label="${esc(t(locale, 'labels.filterLabel'))}">${labels.map((l) => fil(l.id === view.label, hrefOf(view, { label: l.id === view.label ? null : l.id }), `<bdi>${esc(l.name)}</bdi><span class="si-tabn">${esc(show.count(locale, l.buyers))}</span>`)).join('')}</nav>` : '';
  const found = q ? `<p class="si-found" role="status">${esc(data.conversations.length > 0 ? t(locale, 'buyers.search.found', { q, n: show.quantity(locale, data.page?.total ?? data.conversations.length) }) : t(locale, 'buyers.search.none', { q }))}${data.conversations.length ? ` · <a class="clear" href="${esc(hrefOf({ ...view, q: '' }, { filter: 'all' }))}">${esc(t(locale, 'buyers.search.clear'))}</a>` : ''}</p>` : '';
  const says = lens === 'value' ? `<p class="si-found">${esc(t(locale, 'buyers.lens.valueSays'))}</p>` : '';
  const page = data.page;
  const pager = page && (page.prev || page.next) ? `<nav class="pager si-pager" aria-label="${esc(t(locale, 'buyers.page.nav'))}">
      ${page.prev ? back(esc(hrefOf(view, { before: page.prev.cursor })), t(locale, 'buyers.page.prev')) : ''}
      <span class="sp-rday">${esc(t(locale, 'buyers.page.position', { from: show.quantity(locale, page.from), to: show.quantity(locale, page.to), total: show.quantity(locale, page.total) }))}</span>
      ${page.next ? deeper(esc(hrefOf(view, { after: page.next })), t(locale, 'buyers.page.next')) : ''}</nav>` : '';
  const selected = [view.stage ? t(locale, `split.stage.${view.stage}`) : '', lens === 'value' ? t(locale, 'buyers.lens.value') : '', data.label?.name ?? ''].filter(Boolean);
  const newMessage = outreachShown() ? `<form class="sp-new" method="get" action="/app/contacts/write"><button class="sp-btn" type="submit">${esc(t(locale, 'split.new'))}</button></form>` : '';
  const business = businessName();
  return `<div class="si il-page">
    <header class="il-header"><h1 class="page">${esc(t(locale, 'nav.inbox'))}</h1>${newMessage}${business ? `<p class="il-business"><bdi>${esc(business)}</bdi></p>` : ''}${LIVE_SLOT}</header>
    <div class="il-workspace">
      <aside class="il-menu">${renderInboxViews(data, locale)}${renderInboxTools(locale)}</aside>
      <div class="il-main sp-sheet">
        <div class="si-tools">${search}
          <details class="il-filter"${selected.length ? ' open' : ''}><summary>${esc(t(locale, 'area2.inbox.filters'))}${selected.length ? ` · <bdi>${esc(selected.join(' · '))}</bdi>` : ''}</summary>
            <div class="si-filters">${stageFilter}${order}</div>${labelFilter}</details>${found}${says}</div>
        ${pager}<div class="si-list">${data.conversations.length ? renderInboxRows(data, locale, now, people) : emptyWords(locale, data, view)}</div>${pager}
      </div>
    </div>
  </div>`;
}
