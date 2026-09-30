import { workspaceZone } from './zone.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { countryName, orderStatusName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { dayStart } from '../../core/owner/i18n/format.js';
import { t, assistantName, tn } from './say.js';
import { esc, deeper, conversationUrl } from './layout.js';
import { buyersHref, channelName, productName, type InboxList, type ConversationSummary, type InboxFilter } from './inbox.js';
import { line as calendarLine } from './calendar.js';
import type { CalendarEntry } from '../../db/calendar.js';
import type { CustomerPanel, PanelActivity } from '../../db/customerPanel.js';
import type { Person } from '../../core/conversation/people.js';
import * as show from './values.js';

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

/** The list beside the conversation: the tabs, the rows by who needs whom, the search. */
export function renderListPane(
  data: InboxList, locale: Locale, now: Date, currentId: string, people: readonly Person[] = [],
): string {
  const name = assistantName(locale);
  const tab = (f: InboxFilter, n: number | undefined) => {
    const on = data.filter === f;
    return `<a class="tab${on ? ' on' : ''}"${on ? ' aria-current="page"' : ''} href="${esc(buyersHref({ filter: f }))}">${
      esc(t(locale, `inbox.filter.${f}` as MessageKey))}${(n ?? 0) > 0 ? `<span class="tab-n">${n}</span>` : ''}</a>`;
  };
  // An empty tab is not shown (the plan's §2): Mine only with colleagues, the
  // two that list a problem only while one exists.
  const tabs = `<nav class="tabs" aria-label="${esc(t(locale, 'buyers.tabs'))}">${tab('pending', data.waitingCount)}${tab('all', undefined)}${
    people.length > 1 ? tab('mine', data.mineCount) : ''}${
    data.blockedCount > 0 ? tab('blocked', data.blockedCount) : ''}${
    (data.deletionCount ?? 0) > 0 ? tab('deletion', data.deletionCount) : ''}</nav>`;

  const row = (c: ConversationSummary) => {
    const on = c.conversationId === currentId;
    // The one magenta in the list: the last message was the assistant's.
    const mine = c.lastFrom === 'assistant' ? '<span class="as" aria-hidden="true">✦</span> ' : '';
    return `<li><a class="lp-row${on ? ' on' : ''}" href="${conversationUrl(c.conversationId)}"${on ? ' aria-current="page"' : ''}>
        <span class="lp-top"><b><bdi>${esc(c.buyer ?? t(locale, 'common.buyer'))}</bdi></b>${
          c.latestAt ? `<span class="lp-when">${esc(show.shortWhen(locale, c.latestAt, now))}</span>` : ''}</span>
        ${c.latestMessage ? `<span class="lp-last">${mine}<bdi dir="auto">${esc(Array.from(c.latestMessage).slice(0, 60).join(''))}</bdi></span>` : ''}
      </a></li>`;
  };
  // The list page's groups, in its order (`buyersList.ts` ranks by them): a
  // row's state is the heading it sits under, said once, not a chip on each.
  const all = data.conversations;
  const orders = all.filter((c) => c.orderWaiting === true);
  const deletion = all.filter((c) => !orders.includes(c) && c.deletionWaiting === true);
  const rest = all.filter((c) => !orders.includes(c) && !deletion.includes(c));
  const needsYou = rest.filter((c) => c.ownership === 'WAITING_HUMAN' || c.awaitingReview);
  const yours = rest.filter((c) => c.ownership === 'OWNER_CONTROLLED' && !needsYou.includes(c));
  const hers = rest.filter((c) => !needsYou.includes(c) && !yours.includes(c));
  const group = (title: string, rows: readonly ConversationSummary[]) => rows.length === 0 ? ''
    : `<li class="lp-group" aria-hidden="true">${esc(title)}</li>${rows.map(row).join('')}`;
  const rows = all.length === 0
    ? `<p class="muted lp-empty">${esc(t(locale, data.filter === 'pending' ? 'buyers.empty.calm' : 'inbox.empty.none'))}</p>`
    : `<ul class="lp-rows">${group(t(locale, 'buyers.group.order'), orders)}${group(t(locale, 'buyers.group.deletion'), deletion)}${
        group(t(locale, 'buyers.group.needsYou'), needsYou)}${
        group(t(locale, people.length > 1 ? 'buyers.group.team' : 'buyers.group.yours'), yours)}${
        group(t(locale, 'buyers.group.hers', { name }), hers)}</ul>`;
  const more = data.page?.next ? deeper(esc(buyersHref({ filter: data.filter, after: data.page.next })), t(locale, 'buyers.page.next')) : '';
  const search = `<form class="search" method="get" action="/app/inbox" role="search">
      <input type="search" name="q" placeholder="${esc(t(locale, 'buyers.search.placeholder'))}" aria-label="${esc(t(locale, 'buyers.search.label'))}" />
      <button class="btn" type="submit">${esc(t(locale, 'buyers.search.go'))}</button>
    </form>`;
  return `<aside class="listpane" aria-label="${esc(t(locale, 'pane.label'))}">
      <h2 class="lp-h">${esc(t(locale, 'pane.label'))}</h2>
      ${tabs}${rows}${more}${search}
    </aside>`;
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
    // A WhatsApp number is stored as its digits; it is shown the way it is dialled.
    `${esc(channelName(locale, p.channel))}${p.address ? ` <bdi>${esc(p.channel === 'whatsapp' && /^\d+$/.test(p.address) ? `+${p.address}` : p.address)}</bdi>` : ''}`,
    language ? esc(t(locale, 'panel.writesIn', { language })) : '',
    p.country ? esc(countryName(locale, p.country) ?? p.country) : '',
  ].filter(Boolean).join(' · ');
  const since = [
    p.firstWrote ? esc(t(locale, 'panel.firstWrote', { date: show.date(locale, p.firstWrote) })) : '',
    p.conversations > 0 ? esc(tn(locale, 'panel.conversations', p.conversations)) : '',
  ].filter(Boolean).join(' · ');

  const asked = p.askedAbout.map((a) => li(`<bdi>${esc(productName(locale, a) ?? '')}</bdi>`,
    esc(`${tn(locale, 'panel.times', a.count)} · ${show.shortWhen(locale, a.lastAt, now)}`)));
  const prices = p.prices.map((q) => li(
    `<bdi>${esc(show.money(locale, q.unitPrice))}</bdi>${productName(locale, q) ? ` · <bdi>${esc(productName(locale, q)!)}</bdi>` : ''} · ${esc(show.shortWhen(locale, q.at, now))}`,
    `<a href="${conversationUrl(q.conversationId)}">${esc(t(locale, 'panel.priceDoor'))}<span class="go" aria-hidden="true">›</span></a>`));
  const record = [
    ...p.samples.map((s) => li(`${esc(t(locale, 'panel.sample'))} · ${esc(t(locale, 'panel.sampleAsked', { date: show.date(locale, s.askedAt) }))}${
      s.handledAt ? ` · ${esc(t(locale, 'panel.sampleHandled', { date: show.date(locale, s.handledAt) }))}` : ''}`)),
    ...p.orders.map((o) => li(`<bdi>${esc(t(locale, 'panel.order', { reference: o.reference }))}</bdi> · ${esc(orderStatusName(locale, o.status))}`,
      `<a href="/app/orders/${encodeURIComponent(o.id)}"><span class="go" aria-hidden="true">›</span><span class="sr">${esc(t(locale, 'panel.order', { reference: o.reference }))}</span></a>`)),
  ];
  const promises = p.promised.map((x) => li(
    `${x.byAssistant ? '<span class="as" aria-hidden="true">✦</span> ' : ''}<bdi dir="auto">${esc(t(locale, 'calendar.line.promise', { said: x.said }))}</bdi>`,
    `${esc(show.date(locale, dayStart(x.dueOn, workspaceZone())))} <a href="${conversationUrl(x.conversationId)}"><span class="go" aria-hidden="true">›</span><span class="sr">${esc(t(locale, 'panel.priceDoor'))}</span></a>`));
  const dated = calendar.map((e) => li(`${esc(show.date(locale, e.at))} · ${esc(calendarLine(locale, e))}`,
    e.conversationId ? `<a href="${conversationUrl(e.conversationId)}"><span class="go" aria-hidden="true">›</span><span class="sr">${esc(calendarLine(locale, e))}</span></a>` : ''));
  const act = p.activity.map((a) => {
    const mark = MARK[a.kind];
    const glyph = mark === 'as' ? '<span class="as" aria-hidden="true">✦</span>'
      : mark === 'you' ? '<span class="pn-you" aria-hidden="true">●</span>' : '<span class="pn-none" aria-hidden="true">○</span>';
    const said = a.kind === 'not_reached'
      ? `${esc(t(locale, a.by === 'person' ? 'panel.act.not_reached.person' : 'panel.act.not_reached.assistant', { name }))} <span class="dot bad" aria-hidden="true">●</span>`
      : esc(t(locale, `panel.act.${a.kind}` as MessageKey, { name }));
    return li(`${glyph} ${said}`, esc(a.kind === 'waiting' ? t(locale, 'panel.now') : show.shortWhen(locale, a.at, now)));
  });

  return `<aside class="panel" id="customer" aria-label="${esc(t(locale, 'panel.label'))}">
      <a class="panel-close" href="#latest">${esc(t(locale, 'panel.close'))}</a>
      <header class="pn-head">
        <h2><bdi>${esc(p.name ?? t(locale, 'common.buyer'))}</bdi></h2>
        ${facts ? `<p class="pn-facts">${facts}</p>` : ''}
        ${since ? `<p class="pn-facts">${since}</p>` : ''}
      </header>
      ${block('panel.askedAbout', asked)}
      ${block('panel.prices', prices)}
      ${block('panel.promised', promises)}
      ${block('panel.onRecord', record)}
      ${block('panel.onCalendar', dated)}
      ${block('panel.activity', act)}
      ${deeper(`/app/conversations/${encodeURIComponent(conversationId)}`, t(locale, 'panel.details'))}
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
