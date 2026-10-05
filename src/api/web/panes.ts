import { workspaceZone } from './zone.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { countryName, orderStatusName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { dayStart, labelled } from '../../core/owner/i18n/format.js';
import { t, assistantName, tn } from './say.js';
import { esc, deeper, conversationUrl, signalMark } from './layout.js';
import { shape } from './marks.js';
import { buyersHref, reachedOn, channelName, productName, customerRow, inboxRow, waitingGroups, lensSwitch, type InboxList, type ConversationSummary, type InboxFilter, type ConversationDetail } from './inbox.js';
import { line as calendarLine } from './calendar.js';
import type { CalendarEntry } from '../../db/calendar.js';
import type { CustomerPanel, PanelActivity } from '../../db/customerPanel.js';
import { face } from './faces.js';
import type { Person } from '../../core/conversation/people.js';
import * as show from './values.js';
import { GO } from './icons.js';
import { agentMark } from './agentMark.js';

/**
 * THE THREE PANES (the design pass, 2026-09-29; the plan's §2 and §3): on a
 * wide screen a conversation sits between the list it came from and the
 * customer it is with. The list is Buyers' own (the same tab, the same order,
 * the same groups); the customer panel is `src/db/customerPanel.ts`.
 *
 * From 1100 px the list stands beside the conversation; from 1440 px the
 * customer panel too. Between them the panel folds away, and a door in the
 * conversation's header opens it over the page. Below 1100 px the list and
 * the conversation are separate pages, as they always were: the panes are
 * drawn and the stylesheet leaves them out, so nothing depends on a script.
 */

/**
 * The list beside the conversation: the Inbox's own rows (phase 4 — face,
 * name, spent, last contact), in its "waiting now" order and groups, the
 * switch to "matters most", and the search. The open customer is marked as the
 * current page — by the customer, so a customer with two conversations is lit
 * whichever of them is open.
 */
/** How many of the list's rows a 900 px window shows under the pane's heading and switch. */
export const PANE_ROWS_IN_VIEW = 6;

export function renderListPane(
  data: InboxList, locale: Locale, now: Date, currentId: string, people: readonly Person[] = [],
  /**
   * Phase 9 (V1-257) — the open conversation, as a row. Shown first, under its
   * own heading, when the list beside it does not hold its customer: Carlos's
   * conversation was open beside a "Needs you" list that did not hold him, and
   * nothing said where the owner was.
   */
  current: ConversationSummary | null = null,
): string {
  const name = assistantName(locale);
  const all = data.conversations;
  const currentClient = current?.clientId;
  const isCurrent = (c: ConversationSummary): boolean =>
    c.conversationId === currentId || (currentClient !== undefined && c.clientId === currentClient);
  // The switch, and — the plan's §2: an empty narrowing is not shown — the two that list a problem while one exists.
  const chip = (f: 'blocked' | 'deletion', n: number | undefined) => (n ?? 0) > 0
    ? `<a class="tab" href="${esc(buyersHref({ filter: f }))}">${esc(t(locale, `inbox.filter.${f}` as MessageKey))}<span class="tab-n">${n}</span></a>` : '';
  const problems = `${chip('blocked', data.blockedCount)}${chip('deletion', data.deletionCount)}`;
  const tabs = `${lensSwitch(locale, data.lens ?? 'waiting', '')}${problems ? `<nav class="tabs filters" aria-label="${esc(t(locale, 'buyers.tabs'))}">${problems}</nav>` : ''}`;

  // The list page's own row, so the two lists cannot drift apart.
  const row = (c: ConversationSummary) =>
    `<li>${inboxRow(locale, c, { now, people, pane: { current: isCurrent(c) } })}</li>`;
  // The list page's groups, in its order (`buyersList.ts` ranks by them): a
  // row's state is the heading it sits under, said once, not a chip on each.
  const g = waitingGroups(all);
  // Phase 9 (V1-233) — headed as the list page heads them: every group on the
  // whole list, only an order and a deletion elsewhere.
  const heads = data.filter === 'all';
  const group = (title: string, rows: readonly ConversationSummary[], always = false) => rows.length === 0 ? ''
    : `${heads || always ? `<li class="lp-group" aria-hidden="true">${esc(title)}</li>` : ''}${rows.map(row).join('')}`;
  // The fix wave (V1-257) — and when the list holds it far down: Carlos's row was 2,616 px down a pane
  // that opens at its top, so nothing in view said where the owner was. Pinned first unless it is
  // among the first rows the pane shows.
  const drawn = [...g.orders, ...g.deletion, ...g.needsYou, ...g.yours, ...g.hersWaiting, ...g.hersRest];
  const at = drawn.findIndex(isCurrent);
  const here = current && (at < 0 || at >= PANE_ROWS_IN_VIEW)
    ? `<ul class="irows lp-rows lp-current"><li class="lp-group" aria-hidden="true">${esc(t(locale, 'pane.current'))}</li>${row(current)}</ul>` : '';
  const rows = all.length === 0
    // Phase 9 — an empty FILTER is not an empty business: each says what it is.
    ? `<p class="muted lp-empty">${esc(data.query ? t(locale, 'buyers.search.none', { q: data.query })
        : t(locale, data.filter === 'pending' ? 'buyers.empty.calm' : data.filter === 'mine' ? 'inbox.empty.mine'
          : data.filter === 'deletion' ? 'inbox.empty.deletion' : data.filter === 'blocked' ? 'refused.none' : 'inbox.empty.none'))}</p>`
    : `<ul class="irows lp-rows">${group(t(locale, 'buyers.group.order'), g.orders, true)}${group(t(locale, 'buyers.group.deletion'), g.deletion, true)}${
        group(t(locale, 'buyers.group.needsYou'), g.needsYou)}${
        group(t(locale, people.length > 1 ? 'buyers.group.team' : 'buyers.group.yours'), g.yours)}${
        group(t(locale, 'buyers.group.hers', { name }), [...g.hersWaiting, ...g.hersRest])}</ul>`;
  const more = data.page?.next ? deeper(esc(buyersHref({ filter: data.filter, lens: data.lens, after: data.page.next })), t(locale, 'buyers.page.next')) : '';
  const search = `<form class="search" method="get" action="/app/inbox" role="search">
      <input type="search" name="q" placeholder="${esc(t(locale, 'buyers.search.placeholder'))}" aria-label="${esc(t(locale, 'buyers.search.label'))}" />
      <button class="btn" type="submit">${esc(t(locale, 'buyers.search.go'))}</button>
    </form>`;
  // Phase 9 (conversation-missed-02) — the list's own name, as its page and the back link say it.
  return `<aside class="listpane" aria-label="${esc(t(locale, 'nav.inbox'))}">
      <h2 class="lp-h">${esc(t(locale, 'nav.inbox'))}</h2>
      ${here}${tabs}${rows}${more}${search}
    </aside>`;
}

/**
 * Phase 9 (V1-257) — the open conversation as the list would draw it, from the
 * page's own reading of it, for when the list's first page does not hold it.
 */
export function paneRowOf(d: ConversationDetail): ConversationSummary {
  const last = d.messages.at(-1) ?? null;
  return {
    conversationId: d.conversationId, buyer: d.buyer, country: d.country, status: d.status,
    needsAction: d.pendingDraft !== null, ownership: d.ownership, heldBy: d.heldBy ?? null,
    answeredBy: d.answeredBy ?? null, awaitingReview: d.pendingDraft !== null && d.ownership === 'AI',
    handoffReason: d.handoffReasons[0] ?? null, deletionWaiting: Boolean(d.deletionAsk), orderWaiting: Boolean(d.orderProposal),
    latestMessage: last?.text ?? null, latestAt: last?.at ?? null, product: d.product, quantity: d.quantity,
    unitPrice: d.quote?.unitPrice ?? null, ...(d.channel ? { channel: d.channel } : {}),
    unanswered: last?.direction === 'inbound',
    ...(last ? { lastFrom: last.direction === 'inbound' ? 'buyer' as const : last.by === 'owner' ? 'person' as const : 'assistant' as const } : {}),
  };
}

const MARK: Record<PanelActivity['kind'], 'as' | 'you' | 'none'> = {
  alone: 'as', not_reached: 'as', draft_sent: 'you', edit_sent: 'you', owner: 'you', waiting: 'none',
};

/** The customer beside their conversation: who they are, and what is on record — nothing inferred. */
export function renderCustomerPanel(
  p: CustomerPanel, calendar: readonly CalendarEntry[], locale: Locale, now: Date, conversationId: string,
): string {
  const name = assistantName(locale);
  const block = (title: MessageKey, rows: readonly string[]) => rows.length === 0 ? ''
    : `<section class="pn-block"><h3>${esc(t(locale, title))}</h3><ul class="pn-rows">${rows.join('')}</ul></section>`;
  const li = (left: string, right = '') => `<li><span>${left}</span>${right ? `<span class="pn-r">${right}</span>` : ''}</li>`;

  const language = p.language ? languageName(locale, p.language) : null;
  const facts = [
    // Where they write — the catch-up strip draws the same line (`reachedOn`).
    reachedOn(locale, p.channel, p.address),
    language ? esc(t(locale, 'panel.writesIn', { language })) : '',
    p.country ? esc(countryName(locale, p.country) ?? p.country) : '',
  ].filter(Boolean).join(' · ');
  // The fix wave (w4-conversation-06, -16) — the file's own words and the page's own form for the day:
  // "First wrote: Today", as the file says it, not "First wrote Sat, Oct 3" beside a "Today" divider.
  const since = [
    p.firstWrote ? esc(labelled(locale, t(locale, 'conv.file.firstContact'), show.day(locale, p.firstWrote, now))) : '',
    p.conversations > 0 ? esc(tn(locale, 'panel.conversations', p.conversations)) : '',
  ].filter(Boolean).join(' · ');

  const asked = p.askedAbout.map((a) => li(`<bdi>${esc(productName(locale, a) ?? '')}</bdi>`,
    esc(`${tn(locale, 'panel.times', a.count)} · ${show.shortWhen(locale, a.lastAt, now)}`)));
  // Phase 9 (V1-234, V1-266) — a door to another conversation only: the one open
  // beside the panel is the page already on the screen.
  const elsewhere = (id: string): boolean => id !== conversationId;
  const prices = p.prices.map((q) => li(
    // Phase 9 (V1-226) — the price and what it is for on one line, when on the next:
    // run together, a narrow panel broke "LED String Lights 10m · 17:20" at random.
    `<bdi>${esc(show.money(locale, q.unitPrice))}</bdi>${productName(locale, q) ? ` · <bdi>${esc(productName(locale, q)!)}</bdi>` : ''}<br><span class="muted small">${esc(show.shortWhen(locale, q.at, now))}</span>`,
    // conversation-missed-05 — a door like every other, its chevron set off from its words.
    elsewhere(q.conversationId) ? `<a class="pn-door" href="${conversationUrl(q.conversationId)}">${esc(t(locale, 'panel.priceDoor'))}${GO}</a>` : ''));
  const record = [
    ...p.samples.map((s) => li(`${esc(t(locale, 'panel.sample'))} · ${esc(t(locale, 'panel.sampleAsked', { date: show.date(locale, s.askedAt) }))}${
      s.handledAt ? ` · ${esc(t(locale, 'panel.sampleHandled', { date: show.date(locale, s.handledAt) }))}` : ''}`)),
    ...p.orders.map((o) => li(`<bdi>${esc(t(locale, 'panel.order', { reference: o.reference }))}</bdi> · ${esc(orderStatusName(locale, o.status))}`,
      `<a href="/app/orders/${encodeURIComponent(o.id)}">${GO}<span class="sr">${esc(t(locale, 'panel.order', { reference: o.reference }))}</span></a>`)),
  ];
  const promises = p.promised.map((x) => li(
    `${x.byAssistant ? `${agentMark(16, 'am as')} ` : ''}<bdi dir="auto">${esc(t(locale, 'calendar.line.promise', { said: x.said }))}</bdi>`,
    `${esc(show.date(locale, dayStart(x.dueOn, workspaceZone())))}${elsewhere(x.conversationId) ? ` <a class="pn-door" href="${conversationUrl(x.conversationId)}">${GO}<span class="sr">${esc(t(locale, 'panel.priceDoor'))}</span></a>` : ''}`));
  const dated = calendar.map((e) => li(`${esc(show.date(locale, e.at))} · ${esc(calendarLine(locale, e))}`,
    e.conversationId && elsewhere(e.conversationId) ? `<a class="pn-door" href="${conversationUrl(e.conversationId)}">${GO}<span class="sr">${esc(calendarLine(locale, e))}</span></a>` : ''));
  const act = p.activity.map((a) => {
    const mark = MARK[a.kind];
    const glyph = mark === 'as' ? agentMark(16, 'am as')
      : mark === 'you' ? shape('you', 'pn-you') : signalMark('waiting');
    const said = a.kind === 'not_reached'
      ? `${esc(t(locale, a.by === 'person' ? 'panel.act.not_reached.person' : 'panel.act.not_reached.assistant', { name }))} ${signalMark('failed')}`
      : esc(t(locale, `panel.act.${a.kind}` as MessageKey, { name }));
    return li(`${glyph} ${said}`, esc(a.kind === 'waiting' ? t(locale, 'panel.now') : show.shortWhen(locale, a.at, now)));
  });

  return `<aside class="panel" id="customer" aria-label="${esc(t(locale, 'panel.label'))}">
      <a class="panel-close" href="#latest">${esc(t(locale, 'panel.close'))}</a>
      <header class="pn-head">
        ${/* The warmth pass — the customer's face beside their name, as everywhere they are named; the panel is already about them, so it opens nothing. */ ''}<div class="pn-who">${face({ clientId: p.clientId, name: p.name, photo: p.photo ?? null }, 'm')}<h2><bdi>${esc(p.name ?? t(locale, 'common.buyer'))}</bdi></h2></div>
        ${facts ? `<p class="pn-facts">${facts}</p>` : ''}
        ${since ? `<p class="pn-facts">${since}</p>` : ''}
      </header>
      ${block('panel.askedAbout', asked)}
      ${block('panel.prices', prices)}
      ${block('panel.promised', promises)}
      ${block('panel.onRecord', record)}
      ${block('panel.onCalendar', dated)}
      ${block('panel.activity', act)}
      ${/* The fix wave (w4-whole-13) — the panel IS "About this customer" (its door's words); its door onward is the full page. */ ''}${
        deeper(`/app/conversations/${encodeURIComponent(conversationId)}`, t(locale, 'panel.fileDoor'))}
    </aside>`;
}

/** A language's name in the owner's language; the code if unknown. */
function languageName(locale: Locale, code: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The panes: the list, the conversation, the customer. */
export const renderPanes = (list: string, conversation: string, panel: string): string =>
  `<div class="panes">${list}<div class="conv">${conversation}</div>${panel}</div>`;
