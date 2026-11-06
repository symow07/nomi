import { workspaceZone } from './zone.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { countryName, orderStatusName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { dayStart, labelled } from '../../core/owner/i18n/format.js';
import { t, assistantName, tn } from './say.js';
import { esc, deeper, conversationUrl, signalMark } from './layout.js';
import { shape } from './marks.js';
import { buyersHref, reachedOn, channelName, productName, type InboxList, type ConversationSummary, type InboxFilter, type ConversationDetail } from './inbox.js';
import { line as calendarLine } from './calendar.js';
import type { CalendarEntry } from '../../db/calendar.js';
import type { CustomerPanel, PanelActivity } from '../../db/customerPanel.js';
import { face } from './faces.js';
import type { Person } from '../../core/conversation/people.js';
import * as show from './values.js';
import { GO } from './icons.js';
import { agentMark } from './agentMark.js';
import { renderConversationTools } from './copilotPanel.js';
import { renderInboxViews, renderInboxRows, inboxReturnHref } from './splitInbox.js';

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
  const currentClient = current?.clientId;
  const isCurrent = (c: ConversationSummary): boolean => c.conversationId === currentId
    || (currentClient !== undefined && c.clientId === currentClient);
  const at = data.conversations.findIndex(isCurrent);
  const pinCurrent = current && (at < 0 || at >= PANE_ROWS_IN_VIEW);
  const shown = pinCurrent ? { ...data, conversations: data.conversations.filter((c) => !isCurrent(c)) } : data;
  const here = pinCurrent
    ? `<section class="lp-current"><h3 class="lp-group">${esc(t(locale, 'pane.current'))}</h3>${renderInboxRows({ ...data, conversations: [current] }, locale, now, people, { selectedId: currentId })}</section>` : '';
  const empty = data.conversations.length ? '' : `<p class="muted lp-empty">${esc(data.query ? t(locale, 'buyers.search.none', { q: data.query }) : t(locale, data.filter === 'pending' ? 'buyers.empty.calm' : data.filter === 'mine' ? 'inbox.empty.mine' : data.filter === 'deletion' ? 'inbox.empty.deletion' : data.filter === 'blocked' ? 'refused.none' : 'inbox.empty.none'))}</p>`;
  const more = data.page?.next ? deeper(esc(buyersHref({ filter: data.filter, lens: data.lens, q: data.query ?? '', label: data.label?.id, stage: data.stage, after: data.page.next })), t(locale, 'buyers.page.next')) : '';
  return `<aside class="listpane il-compact-list" aria-label="${esc(t(locale, 'nav.inbox'))}">
      <h2 class="lp-h"><a href="${esc(inboxReturnHref(data))}">${esc(t(locale, 'nav.inbox'))}</a></h2>
      ${renderInboxViews(data, locale, { compact: true })}
      <form class="search" method="get" action="/app/inbox" role="search">
        <input type="hidden" name="filter" value="all" />
        <input type="search" name="q" value="${esc(data.query ?? '')}" placeholder="${esc(t(locale, 'buyers.search.placeholder'))}" aria-label="${esc(t(locale, 'buyers.search.label'))}" />
        <button class="btn" type="submit">${esc(t(locale, 'buyers.search.go'))}</button>
      </form>
      ${here}${empty}${renderInboxRows(shown, locale, now, people, { selectedId: data.conversations.find(isCurrent)?.conversationId ?? currentId })}${more}
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
    // 0224 — a figure that reached the customer says so, with when it did; one only worked out keeps its time.
    `<bdi>${esc(show.money(locale, q.unitPrice))}</bdi>${productName(locale, q) ? ` · <bdi>${esc(productName(locale, q)!)}</bdi>` : ''}<br><span class="muted small">${
      q.toldAt ? esc(t(locale, 'panel.toldOn', { when: show.shortWhen(locale, q.toldAt, now) })) : esc(show.shortWhen(locale, q.at, now))}</span>`,
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
      ${labelsBlock(p, locale, conversationId)}
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

/**
 * S2 (Phase 5, item 19) — the labels on this buyer: each taken off by its own button; a label put on by its name (the
 * ones in use offered as the box is typed in; a new name makes a new label). Owner and staff; the buyer's, erased with
 * them.
 */
function labelsBlock(p: CustomerPanel, locale: Locale, conversationId: string): string {
  const client = encodeURIComponent(p.clientId);
  const back = `<input type="hidden" name="back" value="${esc(conversationId)}" />`;
  const on = (p.labels ?? []).map((l) => `<li class="label-on"><bdi>${esc(l.name)}</bdi>
      <form method="post" action="/app/buyers/${client}/labels/${encodeURIComponent(l.id)}/off" class="inline">${back}
        <button class="btn ghost small" type="submit" aria-label="${esc(t(locale, 'labels.takeOff', { name: l.name }))}">×</button></form></li>`).join('');
  const list = `labels-${client}`;
  return `<section class="pn-block" id="labels"><h3>${esc(t(locale, 'labels.title'))}</h3>
      ${on ? `<ul class="chips">${on}</ul>` : `<p class="muted small">${esc(t(locale, 'labels.none'))}</p>`}
      <form method="post" action="/app/buyers/${client}/labels" class="inline label-add">${back}
        <input name="name" maxlength="40" required list="${list}" aria-label="${esc(t(locale, 'labels.add'))}" placeholder="${esc(t(locale, 'labels.placeholder'))}" dir="auto" />
        <datalist id="${list}">${(p.allLabels ?? []).map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
        <button class="btn ghost" type="submit">${esc(t(locale, 'labels.add'))}</button>
      </form></section>`;
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
export const renderPanes = (list: string, conversation: string, panel: string, tools?: { readonly conversationId: string; readonly locale: Locale }): string =>
  `<div class="panes${tools ? ' conversation-workspace' : ''}"${tools ? ` data-conversation="${esc(tools.conversationId)}"` : ''}>${list}<div class="conv">${conversation}</div>${tools ? renderConversationTools(panel, tools.conversationId, tools.locale) : panel}</div>`;
