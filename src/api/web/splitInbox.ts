import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { heldByName, type Person } from '../../core/conversation/people.js';
import { STAGES, type Stage } from '../../db/customerStage.js';
import { markSmall } from '../../core/owner/brand.js';
import { esc, deeper, back, conversationUrl, LIVE_SLOT } from './layout.js';
import { t, assistantName, businessName, outreachShown } from './say.js';
import { GO } from './icons.js';
import { face, faceLink } from './faces.js';
import { asksSomething, buyersHref, isNew, markHit, needsWhy, productName, rowState, sinceDate, waitingGroups, type ConversationSummary, type InboxFilter, type InboxList } from './inbox.js';
import { quietWords, whole } from './splitToday.js';
import { workspaceZone } from './zone.js';
import * as show from './values.js';
import type { AttentionItem } from '../../db/inboxAttention.js';
import type { BuyersLens } from '../../db/buyersList.js';

/**
 * THE INBOX, IN THE SPLIT LOOK (the owner, 2026-11-05; docs/DESIGN-SYSTEM.md). Behind `SPLIT_TODAY=on`, with Today. Five views
 * with their counts, a search and a stage filter over one flat sheet of rows, each row Today's Recent customers row:
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
  pending: 'inbox.filter.pending', quiet: 'inbox.view.quiet', assistant: 'inbox.view.assistant', team: 'inbox.view.team', all: 'inbox.view.all',
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
  } else if (state === 'hers' && c.answeredBy) {
    parts.push(esc(t(locale, 'buyers.group.hers', { name: c.answeredBy })));
  }
  if (c.regular === true) parts.push(esc(t(locale, 'buyers.row.regular')));
  // A search that found them by what they asked about says so: the photo alone cannot.
  const prod = productName(locale, c.product);
  if (o.q && prod && markHit(prod, o.q) !== esc(prod)) parts.push(markHit(prod, o.q));
  return parts.map((p) => `<bdi>${p}</bdi>`).join(' · ');
}

function row(locale: Locale, c: ConversationSummary, o: { readonly people: readonly Person[]; readonly attention: readonly AttentionItem[]; readonly now: Date; readonly q: string; readonly lens: BuyersLens; readonly zone: string }): string {
  const who = c.buyer ?? t(locale, 'common.buyer');
  const needs = rowState(c) === 'needs';
  const why = whyOf(locale, c, { people: o.people, quiet: o.attention.find((a) => a.clientId === c.clientId), now: o.now, q: o.q });
  // "Matters most" is ordered by what they spent, so the row says that; otherwise the stage's own figure, as on Today.
  const value = o.lens === 'value' ? (c.spent ?? c.quoted ?? null) : (c.value ?? null);
  const stage: Stage = c.stage ?? 'asked';
  const prod = productName(locale, c.product);
  const theFace = c.clientId
    ? faceLink({ clientId: c.clientId, name: c.buyer, photo: c.photo ?? null }, { size: 's', label: t(locale, 'buyers.row.card', { who }), className: 'si-face' })
    : `<span class="si-face">${face({ clientId: c.conversationId, name: c.buyer }, 's')}</span>`;
  const thumb = c.thumb
    ? `<img class="sp-thumb sp-thumb-s" src="${esc(c.thumb)}" alt="${esc(prod ?? '')}" width="28" height="28" loading="lazy" decoding="async">`
    : '<span class="sp-thumb sp-thumb-s sp-thumb-none" aria-hidden="true"></span>';
  // CC-25 — a customer opens on the newest message, the reply waiting under it. The name is the row's door; its reach is the row's.
  return `<li><div class="sp-row si-row${needs ? ' is-needs' : ''}${isNew(c) ? ' is-new' : ''}">
    <span class="si-dot" aria-hidden="true">${needs ? '<span class="row-dot"></span>' : ''}</span>
    ${theFace}
    <div class="si-who"><a class="si-door" href="${conversationUrl(c.conversationId)}"><bdi class="sp-rname">${markHit(who, o.q)}</bdi></a>${
      needs ? `<span class="sr">${esc(t(locale, 'buyers.group.needsYou'))}</span>` : ''}${isNew(c) ? `<span class="sr">${esc(t(locale, 'buyers.row.unopened'))}</span>` : ''}${
      why ? `<span class="si-why">${why}</span>` : ''}</div>
    ${thumb}
    <span class="sp-chip${stage === 'order' ? ' is-order' : ''}">${esc(t(locale, `split.stage.${stage}`))}</span>
    <span class="sp-rval">${value ? esc(whole(show.money(locale, value))) : ''}</span>
    <span class="sp-rday">${esc(quietWords(locale, c.latestAt, o.now, o.zone))}</span>
    ${GO}
  </div></li>`;
}

function emptyWords(locale: Locale, data: InboxList, view: View): string {
  if (view.q) return `<p class="si-empty">${esc(t(locale, 'buyers.search.noneBody'))}</p>`;
  if (view.stage) return `<p class="si-empty">${esc(t(locale, 'inbox.empty.stage'))}</p>`;
  switch (data.filter) {
    case 'pending': return `<p class="si-empty"><strong>${esc(t(locale, 'buyers.empty.calm'))}</strong> ${esc(t(locale, 'inbox.empty.allGoodBody'))}</p>`;
    case 'quiet': return `<p class="si-empty">${esc(t(locale, 'inbox.empty.quiet'))}</p>`;
    case 'assistant': return `<p class="si-empty">${esc(t(locale, 'inbox.empty.assistant'))}</p>`;
    case 'team': return `<p class="si-empty">${esc(t(locale, 'inbox.empty.team'))}</p>`;
    case 'deletion': return `<p class="si-empty">${esc(t(locale, 'inbox.empty.deletion'))}</p>`;
    case 'blocked': return `<p class="si-empty">${esc(t(locale, 'refused.none'))}</p>`;
    default: return `<p class="si-empty">${esc(t(locale, 'inbox.empty.none'))} ${esc(t(locale, 'inbox.empty.noneBody'))}</p><div class="si-emptydoor">${deeper('/app/business', t(locale, 'inbox.empty.setup'))}</div>`;
  }
}

export function renderSplitInbox(data: InboxList, locale: Locale, now: Date, people: readonly Person[]): string {
  const q = data.query ?? '';
  const lens: BuyersLens = data.lens ?? 'waiting';
  const view: View = { filter: data.filter, stage: data.stage ?? null, lens, q, label: data.label?.id ?? null };
  const zone = workspaceZone();

  const tabCount = (f: InboxFilter): number => f === 'pending' ? data.waitingCount
    : f === 'blocked' ? data.blockedCount
    : f === 'deletion' ? data.deletionCount ?? 0
    : f === 'quiet' ? data.views?.quiet ?? 0
    : f === 'assistant' ? data.views?.assistant ?? 0
    : f === 'team' ? data.views?.team ?? 0
    : data.views?.everyone ?? 0;
  const tab = (f: InboxFilter, word: string): string => {
    const on = data.filter === f;
    return `<a class="si-tab${on ? ' on' : ''}"${on ? ' aria-current="true"' : ''} href="${esc(hrefOf(view, { filter: f }))}">${esc(word)}<span class="si-tabn">${esc(show.count(locale, tabCount(f)))}</span></a>`;
  };
  // "Did not send" and "Deletion requests" stand beside the views while they hold someone, or while they are the one asked for (rule 18).
  const narrowings = (['blocked', 'deletion'] as const)
    .filter((f) => tabCount(f) > 0 || data.filter === f)
    .map((f) => tab(f, t(locale, `inbox.filter.${f}`))).join('');
  const tabs = `<nav class="si-tabs" aria-label="${esc(t(locale, 'buyers.tabs'))}">${VIEWS.map((f) => tab(f, t(locale, VIEW_WORD[f]!))).join('')}${narrowings}</nav>`;

  const hidden = (name: string, value: string | null): string => value ? `<input type="hidden" name="${name}" value="${esc(value)}" />` : '';
  // A find looks across every customer, whichever view it starts from; the stage, the order and the label ride along.
  const search = `<form class="si-search" method="get" action="/app/inbox" role="search">
      <input type="hidden" name="filter" value="all" />${hidden('stage', view.stage)}${hidden('lens', lens === 'value' ? 'value' : null)}${hidden('label', view.label)}
      <input type="search" name="q" value="${esc(q)}" placeholder="${esc(t(locale, 'buyers.search.placeholder'))}" aria-label="${esc(t(locale, 'buyers.search.label'))}" />
      <button class="sp-btn" type="submit">${esc(t(locale, 'buyers.search.go'))}</button>
    </form>`;
  const fil = (on: boolean, href: string, words: string): string =>
    `<a class="si-fil${on ? ' on' : ''}"${on ? ' aria-current="true"' : ''} href="${esc(href)}">${words}</a>`;
  // A sample is a stage only where it is one (docs/DESIGN-SYSTEM.md), or where the address already asks for it.
  const stages = STAGES.filter((s) => s !== 'sample' || data.sampled === true || view.stage === 'sample');
  const stageFilter = `<nav class="si-fils" aria-label="${esc(t(locale, 'inbox.stage.label'))}">${
    fil(view.stage === null, hrefOf(view, { stage: null }), esc(t(locale, 'inbox.stage.all')))}${
    stages.map((s) => fil(view.stage === s, hrefOf(view, { stage: s }), esc(t(locale, `split.stage.${s}`)))).join('')}</nav>`;
  const order = `<nav class="si-fils si-order" aria-label="${esc(t(locale, 'buyers.lens.label'))}">${
    (['waiting', 'value'] as const).map((l) => fil(lens === l, hrefOf(view, { lens: l }), esc(t(locale, `buyers.lens.${l}`)))).join('')}</nav>`;
  const labels = (data.labels ?? []).filter((l) => l.buyers > 0 || l.id === view.label);
  const labelFilter = labels.length ? `<nav class="si-fils" aria-label="${esc(t(locale, 'labels.filterLabel'))}">${labels.map((l) =>
    fil(l.id === view.label, hrefOf(view, { label: l.id === view.label ? null : l.id }), `<bdi>${esc(l.name)}</bdi>`)).join('')}</nav>` : '';
  const found = q ? `<p class="si-found" role="status">${esc(data.conversations.length > 0
      ? t(locale, 'buyers.search.found', { q, n: show.quantity(locale, data.page?.total ?? data.conversations.length) })
      : t(locale, 'buyers.search.none', { q }))} · <a class="clear" href="${esc(hrefOf({ ...view, q: '' }, { filter: 'all' }))}">${esc(t(locale, 'buyers.search.clear'))}</a></p>` : '';
  const says = lens === 'value' ? `<p class="si-found">${esc(t(locale, 'buyers.lens.valueSays'))}</p>` : '';

  const page = data.page;
  const pager = page && (page.prev || page.next)
    ? `<nav class="pager si-pager" aria-label="${esc(t(locale, 'buyers.page.nav'))}">
        ${page.prev ? back(esc(hrefOf(view, { before: page.prev.cursor })), t(locale, 'buyers.page.prev')) : ''}
        <span class="sp-rday">${esc(t(locale, 'buyers.page.position', { from: show.quantity(locale, page.from), to: show.quantity(locale, page.to), total: show.quantity(locale, page.total) }))}</span>
        ${page.next ? deeper(esc(hrefOf(view, { after: page.next })), t(locale, 'buyers.page.next')) : ''}
      </nav>` : '';

  const context = { people, attention: data.attention ?? [], now, q, lens, zone };
  const list = (items: readonly ConversationSummary[], head?: string): string => items.length ? `<section class="si-group">${head ? `<h2 class="sp-cap">${esc(head)}</h2>` : ''}
      <ul class="sp-rows">${items.map((c) => row(locale, c, context)).join('')}</ul></section>` : '';
  const g = waitingGroups(data.conversations);
  // An order and a deletion request lead, headed apart, whoever holds them (rules 18 and 23); the rest stay in the list's order.
  const rows = lens === 'value' ? list(data.conversations)
    : `${list(g.orders, t(locale, 'buyers.group.order'))}${list(g.deletion, t(locale, 'buyers.group.deletion'))}${
      list(data.conversations.filter((c) => !g.orders.includes(c) && !g.deletion.includes(c)))}`;

  const doors = `<div class="si-doors">${outreachShown() ? deeper('/app/contacts', t(locale, 'contacts.title')) : ''}${deeper('/app/replies', t(locale, 'savedReplies.title'))}${deeper('/app/labels', t(locale, 'labels.pageTitle'))}${deeper('/app/surveys', t(locale, 'surveys.title'))}</div>`;
  const newMessage = outreachShown()
    ? `<form class="sp-new" method="get" action="/app/contacts/write"><button class="sp-btn" type="submit">${esc(t(locale, 'split.new'))}</button></form>` : '';
  const business = businessName();
  const sub = [business ? `<bdi>${esc(business)}</bdi>` : '', esc(show.dayLong(locale, now))].filter(Boolean).join(' · ');

  return `<div class="sp si">
  <header class="sp-head">
    <span class="sp-headmark">${markSmall(32, null)}</span>
    <div class="sp-headt"><h1 class="page">${esc(t(locale, 'nav.inbox'))}</h1><p class="sp-sub">${sub}</p>${LIVE_SLOT}</div>
    ${newMessage}
  </header>
  <div class="si-body">
    ${tabs}
    <div class="sp-sheet">
      <div class="si-tools">${search}<div class="si-filters">${stageFilter}${order}</div>${labelFilter}${found}${says}</div>
      ${pager}
      <div class="si-list">${data.conversations.length ? rows : emptyWords(locale, data, view)}</div>
      ${pager}
    </div>
    ${doors}
  </div>
</div>`;
}
