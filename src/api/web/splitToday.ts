import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { moneyFromRow } from '../../core/types/money.js';
import { dayKey } from '../../core/owner/i18n/format.js';
import { sellsByQuantity } from '../../core/owner/sellingStyle.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { zoneOf } from '../../db/zone.js';
import { RECENT_CUSTOMERS, decisionExtras, loadSplitBooks, loadSplitSales, type DecisionExtras, type BooksEntry, type RecentCustomer, type SplitBooks, type SplitSales } from '../../db/splitToday.js';
import { markSmall } from '../../core/owner/brand.js';
import { esc, deeper, conversationUrl, LIVE_SLOT, signalMark } from './layout.js';
import { t, tn, assistantName, businessName, outreachShown } from './say.js';
import { GO, solarSvg } from './icons.js';
import { face, faceLink } from './faces.js';
import { approvalChecks, channelName, loadConversationDetail, replyRows, productName, type ConversationDetail } from './inbox.js';
import { homeParts, type OperationsSnapshot } from './operations.js';
import { renderSending, renderWaitingPeople, shortName, type TodayData } from './today.js';
import { workspaceZone } from './zone.js';
import * as show from './values.js';

/**
 * THE SPLIT TODAY PREVIEW (2026-11-04, the owner's locked design; behind `SPLIT_TODAY=on`, on its branch, not merged).
 * Today as two panels: Sales (the decision in front of the owner, the stage strip, the recent customers) and Books (money
 * this month, what is owed, payments matched, the year). docs/DESIGN-SYSTEM.md is its design system.
 *
 * NOTHING HERE DECIDES OR SENDS. Send and Hand to me post to the conversation's own routes (`/act`, `/takeover`), the
 * same approval path as the conversation page; every check on the card is `approvalChecks`, the card's own; every
 * notice and door is `homeParts`, Today's own. With the flag off this module is not reached.
 */

export type SplitData = {
  /** The first reply waiting for the owner. A conversation whose order waits for the owner's tap is not offered: its reply is held. */
  readonly decision: { readonly detail: ConversationDetail; readonly extras: DecisionExtras } | null;
  readonly sales: SplitSales;
  /** Null where the books are off, or this person may not see them. */
  readonly books: SplitBooks | null;
};

export async function loadSplitData(db: Db, businessId: string, opts: { readonly showBooks: boolean; readonly needs: readonly { readonly conversationId: string; readonly awaitingReview: boolean; readonly orderWaiting?: boolean }[] }, now: Date): Promise<SplitData> {
  const bid = parseBusinessId(businessId);
  if (!bid.ok) throw new Error('splitToday: no business');
  const B = bid.value;
  const first = opts.needs.find((c) => c.awaitingReview && !c.orderWaiting);
  const detail = first ? await loadConversationDetail(db, businessId, first.conversationId, now) : null;
  return withTenantTx(db, B, async (tx) => {
    const zone = await zoneOf(tx, B);
    return {
      decision: detail?.pendingDraft ? { detail, extras: await decisionExtras(tx, detail.conversationId) } : null,
      sales: await loadSplitSales(tx, B, zone, now),
      books: opts.showBooks ? await loadSplitBooks(tx, businessId, dayKey(now, zone)) : null,
    };
  });
}

/** Money in the books' currency; a currency the product cannot format is written as it stands. */
const booksMoney = (locale: Locale, amount: string, currency: string): string => {
  const m = moneyFromRow(amount, currency);
  return m ? whole(show.money(locale, m)) : `${amount} ${currency}`;
};

/** "$7,250", not "$7,250.00": a summary drops cents that say nothing. "$1.45" and "Rp 150.000" stay exactly as they are. */
export function whole(money: string): string {
  return money.replace(/[.,]00(?=\D*$)/u, '');
}

/** A first name only where the name begins with a letter: "+34 612…" and "@shop" are not names to address. */
const addressable = (name: string | null): string | null => (name && /^\p{L}/u.test(name.trim()) ? shortName(name) : null);

const thumbOf = (src: string | null, small = false): string =>
  src ? `<img class="sp-thumb${small ? ' sp-thumb-s' : ''}" src="${esc(src)}" alt="" width="${small ? 28 : 36}" height="${small ? 28 : 36}" loading="lazy" decoding="async">`
    : small ? '<span class="sp-thumb sp-thumb-s sp-thumb-none" aria-hidden="true"></span>' : '';

// ── Sales ────────────────────────────────────────────────────────────────────

function decisionCard(d: ConversationDetail, extras: DecisionExtras, locale: Locale, now: Date): string {
  const { thumb } = extras;
  const p = d.pendingDraft!;
  const cid = encodeURIComponent(d.conversationId);
  const to = { act: `/app/inbox/${cid}/act`, handTo: `/app/inbox/${cid}/takeover`, translate: `/app/inbox/${cid}/translate` };
  const { closing, state, foreign, how, window, statesPrice } = approvalChecks(d, p, locale, now, to);
  const name = d.buyer ?? t(locale, 'common.buyer');
  const first = addressable(d.buyer);
  const question = statesPrice
    ? first ? t(locale, 'split.q.price', { name: first }) : t(locale, 'split.q.price.anon')
    : first ? t(locale, 'split.q.reply', { name: first }) : t(locale, 'split.q.reply.anon');
  const product = productName(locale, d.product);
  const unit = d.reading?.quantity?.unit || t(locale, 'product.unit.pcs');
  const deal = d.quote && statesPrice
    ? [d.quote.quantity > 1 ? show.quantityOf(locale, d.quote.quantity, unit) : null, whole(show.money(locale, d.quote.total))].filter(Boolean).join(' · ')
    : product ?? '';
  const channel = d.channel ? channelName(locale, d.channel) : null;
  const who = extras.clientId ? { clientId: extras.clientId, name: d.buyer, photo: extras.photo } : null;
  return `<article class="sp-card sp-decide" id="approve" aria-labelledby="sp-q">
    <div class="sp-who">
      ${who ? faceLink(who, { size: 'xl', label: name }) : face({ clientId: d.conversationId, name: d.buyer }, 'xl')}
      <div class="sp-who-t">
        <a class="sp-name" href="${conversationUrl(d.conversationId)}"><bdi>${esc(name)}</bdi></a>
        ${deal || thumb ? `<p class="sp-deal">${thumbOf(thumb)}<span><bdi>${esc(deal)}</bdi></span></p>` : ''}
        <p class="sp-from">${esc(t(locale, 'card.drafted', { name: assistantName(locale) }))}${channel ? ` · ${esc(t(locale, 'card.goes', { channel }))}` : ''}</p>
      </div>
    </div>
    <h3 class="sp-q" id="sp-q">${esc(question)}</h3>
    ${closing}${state}${foreign}
    <form method="post" action="${esc(to.act)}" class="sp-form">
      <input type="hidden" name="draftId" value="${esc(p.draftId)}" />
      <label for="reply" class="sr">${esc(t(locale, 'card.reply'))}</label>
      ${p.ownerEdit ? `<p class="muted" role="note">${esc(t(locale, 'inbox.edit.kept'))}</p>` : ''}
      <textarea id="reply" class="sp-reply" name="edit" rows="${replyRows(p.ownerEdit ?? p.draftText)}" dir="auto" data-keep="${esc(`${d.conversationId}:edit`)}">${esc(p.ownerEdit ?? p.draftText)}</textarea>
      <div class="sp-acts">
        <button class="sp-btn sp-send" type="submit" name="command" value="send">${esc(t(locale, 'inbox.action.send'))}</button>
        <label class="sp-btn" for="reply">${esc(t(locale, 'split.edit'))}</label>
        <button class="sp-btn" type="submit" formaction="${esc(to.handTo)}">${esc(t(locale, 'card.handToMe'))}</button>
      </div>
      ${window ? `<p class="sp-window">${window}</p>` : ''}
    </form>
    ${how}
  </article>`;
}

/** A stage's state, in shape as well as colour: filled when there is any, a ring when it waits or has none. */
const stageRow = (cls: string, label: string, n: number, value: string | null, locale: Locale): string =>
  `<li class="${cls}"><span class="sp-dot" aria-hidden="true"></span><span class="sp-stage">${esc(label)}</span>`
  + `<span class="sp-fig">${esc(show.count(locale, n))}</span>${value ? `<span class="sp-val">${esc(value)}</span>` : ''}</li>`;

function stageStrip(sales: SplitSales, ordersWaiting: number, locale: Locale): string {
  const done = (n: number): string => (n > 0 ? 'is-done' : '');
  const money = (m: SplitSales['price']['value']): string | null => (m ? whole(show.money(locale, m)) : null);
  // A sample is a stage of a business that sells by quantity, or of one whose customers asked for one (docs/DESIGN-SYSTEM.md).
  const sampled = sellsByQuantity(sales.kind) || sales.sample.count > 0;
  return `<section class="sp-card" aria-labelledby="sp-month">
    <h3 class="sp-cap" id="sp-month">${esc(t(locale, 'split.month'))}</h3>
    <ol class="sp-stages">
      ${stageRow(done(sales.asked), t(locale, 'split.stage.asked'), sales.asked, null, locale)}
      ${stageRow(done(sales.price.count), t(locale, 'split.stage.price'), sales.price.count, money(sales.price.value), locale)}
      ${sampled ? stageRow(sales.sample.open > 0 ? 'is-waiting' : done(sales.sample.count), t(locale, 'split.stage.sample'), sales.sample.count, null, locale) : ''}
      ${stageRow(ordersWaiting > 0 ? 'is-waiting' : done(sales.order.count), t(locale, 'split.stage.order'), sales.order.count, money(sales.order.value), locale)}
    </ol>
  </section>`;
}

/** How long since the last word, either way: "Today", or the days in the workspace's own calendar. */
export function quietWords(locale: Locale, lastAt: Date | null, now: Date, zone: string): string {
  if (!lastAt) return '';
  const days = Math.round((Date.parse(dayKey(now, zone)) - Date.parse(dayKey(lastAt, zone))) / 86_400_000);
  return days <= 0 ? t(locale, 'split.title') : tn(locale, 'split.days', days);
}

function recentRow(r: RecentCustomer, waiting: ReadonlySet<string>, locale: Locale, now: Date, zone: string): string {
  const name = r.name ?? t(locale, 'common.buyer');
  const isWaiting = waiting.has(r.conversationId);
  const chip = isWaiting
    ? `<span class="sp-chip is-waiting">${esc(t(locale, 'split.chip.waiting'))}</span>`
    : `<span class="sp-chip${r.stage === 'order' ? ' is-order' : ''}">${esc(t(locale, `split.stage.${r.stage}`))}</span>`;
  const when = quietWords(locale, r.lastAt, now, zone);
  return `<li><a class="sp-row" href="${conversationUrl(r.conversationId)}">
    ${face({ clientId: r.clientId, name: r.name, photo: r.photo }, 's')}
    <bdi class="sp-rname">${esc(name)}</bdi>
    ${thumbOf(r.thumb, true)}
    ${chip}
    <span class="sp-rval">${r.value ? esc(whole(show.money(locale, r.value))) : ''}</span>
    <span class="sp-rday">${esc(when)}</span>
    ${GO}
  </a></li>`;
}

// ── Books ────────────────────────────────────────────────────────────────────

/** The year's profit, month by month: one line, in jade, the last month marked. Time runs left to right on every page: a time chart never flips right to left. */
function trendChart(b: SplitBooks, locale: Locale): string {
  if (b.trend.length < 2) return '';
  const W = 160, H = 76, PAD = 5;
  const values = b.trend.map((p) => p.value);
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const x = (i: number): number => PAD + (i * (W - 2 * PAD)) / (b.trend.length - 1);
  const y = (v: number): number => H - PAD - ((v - lo) * (H - 2 * PAD)) / span;
  const pts = b.trend.map((p, i) => `${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`);
  const line = `M${pts.join('L')}`;
  const area = `${line}L${x(b.trend.length - 1).toFixed(1)} ${y(lo).toFixed(1)}L${x(0).toFixed(1)} ${y(lo).toFixed(1)}Z`;
  const tell = (p: SplitBooks['trend'][number]): string => t(locale, 'split.trend.point', { month: show.month(locale, p.month), money: booksMoney(locale, p.value.toFixed(2), b.currency) });
  const last = b.trend[b.trend.length - 1]!;
  const hits = b.trend.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="7" fill="transparent"><title>${esc(tell(p))}</title></circle>`).join('');
  return `<figure class="sp-trend" dir="ltr"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`${t(locale, 'split.trend.label')}. ${tell(last)}`)}">
    <path class="sp-tarea" d="${area}"/>
    <path class="sp-tline" d="${line}"/>
    <circle cx="${x(b.trend.length - 1).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="3.5" class="sp-tdot"/>
    ${hits}
  </svg></figure>`;
}

/** One invoice, or money the bank received for no invoice yet, in the row Recent customers uses. Green is settled, ochre is late, the rest plain. */
function entryRow(e: BooksEntry, locale: Locale): string {
  const mood = e.status === null || e.status === 'paid' ? ' is-done' : e.status === 'overdue' ? ' is-waiting' : '';
  const word = e.status === null ? t(locale, 'split.entry.payment') : t(locale, `books.invoice.status.${e.status}` as MessageKey);
  const who = e.party ?? t(locale, 'split.entry.fromBank');
  const door = e.kind === 'invoice' ? `/app/books/invoices/${esc(e.id)}` : '/app/books/bank';
  return `<li><a class="sp-row sp-entry" href="${door}">
    ${face({ clientId: e.clientId ?? e.id, name: who, photo: e.photo }, 's')}
    <bdi class="sp-rname">${esc(who)}</bdi>
    <span class="sp-chip${mood}">${esc(word)}</span>
    <span class="sp-rval">${esc(booksMoney(locale, e.amount, e.currency))}</span>
    <span class="sp-rday">${esc(show.dayMonth(locale, e.on))}</span>
    ${GO}
  </a></li>`;
}

function booksPanel(b: SplitBooks, locale: Locale): string {
  const money = (amount: string): string => booksMoney(locale, amount, b.currency);
  const down = b.profit.startsWith('-');
  const w = b.owed.worst;
  const remind = w
    ? `<form class="sp-remind" method="get" action="${w.conversationId ? conversationUrl(w.conversationId) : `/app/books/invoices/${esc(w.invoiceId)}`}"><button class="sp-btn sp-quiet" type="submit">${esc(t(locale, 'split.remind'))}</button></form>`
    : '';
  const late = w ? `<div class="sp-late">
      ${w.clientId ? face({ clientId: w.clientId, name: w.party, photo: w.photo }, 's') : face({ clientId: w.invoiceId, name: w.party }, 's')}
      <span class="sp-late-n"><bdi>${esc(w.party)}</bdi></span>
      <span>${esc(booksMoney(locale, w.owed, w.currency))}</span>
      <span class="sp-late-d">${esc(tn(locale, 'split.owed.late', w.daysLate))}</span>
      ${remind}
    </div>` : '';
  const owed = b.owed.count === 0 && b.owed.otherCurrency === 0
    ? `<p class="sp-owed">${esc(t(locale, 'split.owed.none'))}</p>`
    : `<p class="sp-owed">${esc(tn(locale, 'split.owed.invoices', b.owed.count))} · ${esc(money(b.owed.total))}</p>
       ${b.owed.otherCurrency > 0 ? `<p class="sp-note">${esc(tn(locale, 'split.owed.other', b.owed.otherCurrency))}</p>` : ''}
       ${b.owed.overdue > 0 ? `<p class="sp-over">${esc(tn(locale, 'split.owed.overdue', b.owed.overdue))}</p>` : ''}
       ${late}`;
  const year = b.year
    ? b.year.state === 'open'
      ? t(locale, 'split.year.open', { year: b.year.startsOn.slice(0, 4), month: show.month(locale, b.year.endsOn) })
      : t(locale, 'split.year.closed', { year: b.year.startsOn.slice(0, 4) })
    : t(locale, 'split.year.none');
  return `<section class="sp-panel sp-books" aria-labelledby="sp-books">
    <div class="sp-phead"><h2 id="sp-books">${solarSvg('ni', 'notebook-minimalistic', 22)}${esc(t(locale, 'nav.books'))}</h2>${deeper('/app/books', t(locale, 'split.viewAll'))}</div>
    <div class="sp-sheet">
    <section class="sp-card sp-money" aria-labelledby="sp-mt">
      <h3 id="sp-mt">${esc(t(locale, 'split.money.title'))}</h3>
      <div>
        <p class="sp-inout">${esc(t(locale, 'split.money.in', { money: money(b.moneyIn) }))} · ${esc(t(locale, 'split.money.out', { money: money(b.moneyOut) }))}</p>
        <p class="sp-profit${down ? ' is-down' : ''}"><span>${esc(t(locale, 'split.money.profit'))}</span> <span class="sp-big">${esc(money(b.profit))}</span></p>
      </div>
      ${trendChart(b, locale)}
    </section>
    <section class="sp-card" aria-labelledby="sp-ot">
      <h3 id="sp-ot">${esc(t(locale, 'split.owed.title'))}</h3>
      ${owed}
    </section>
    ${b.matched > 0 ? `<a class="sp-card sp-door" href="/app/books/bank">${signalMark('ok')}<span>${esc(tn(locale, 'split.matched', b.matched))}</span>${GO}</a>` : ''}
    <a class="sp-card sp-door" href="/app/books/closing">${solarSvg('ni', 'calendar', 22)}<span>${esc(year)}</span>${GO}</a>
    ${b.entries.length ? `<section class="sp-card sp-entries" aria-labelledby="sp-et">
      <div class="sp-phead"><h3 class="sp-cap" id="sp-et">${esc(t(locale, 'split.entries'))}</h3>${deeper('/app/books/invoices', t(locale, 'split.viewAll'))}</div>
      <ul class="sp-rows">${b.entries.map((e) => entryRow(e, locale)).join('')}</ul>
    </section>` : ''}
    </div>
  </section>`;
}

// ── The page ─────────────────────────────────────────────────────────────────

export function renderSplitToday(s: OperationsSnapshot, locale: Locale, today: TodayData, lead: string, data: SplitData, now: Date): string {
  const parts = homeParts(s, locale, today, lead);
  const decidedId = data.decision?.detail.conversationId ?? null;
  const others = { ...today, needs: { ...today.needs, rows: today.needs.rows.filter((c) => c.conversationId !== decidedId) } };
  const people = renderWaitingPeople(others, locale);
  const waiting = new Set(today.needs.rows.filter((c) => c.needsAction || c.awaitingReview).map((c) => c.conversationId));
  const ordersWaiting = today.needs.rows.filter((c) => c.orderWaiting).length;
  const zone = workspaceZone();
  const business = businessName();
  // Every word of what is held, in Today's own sentences, first.
  const notices = `<div class="sp-notices">${parts.refusing}${parts.silenced}${parts.stopped}${parts.budget}${parts.notLive}</div>`;
  const alsoHead = data.decision
    ? people ? `<h3 class="sp-cap">${esc(t(locale, 'split.alsoWaiting'))}</h3>` : ''
    : parts.head;
  const also = alsoHead || parts.more || people
    ? `<div class="sp-also">${alsoHead}${people}${parts.more ? `<div class="doors">${parts.more}</div>` : ''}</div>` : '';
  const showBooks = data.books !== null;
  // The customer on the decision card is not listed under it as well.
  const recent = data.sales.recent.filter((r) => r.conversationId !== decidedId).slice(0, RECENT_CUSTOMERS);
  const newMessage = outreachShown()
    ? `<form class="sp-new" method="get" action="/app/contacts/write"><button class="sp-btn" type="submit">${esc(t(locale, 'split.new'))}</button></form>`
    : `<form class="sp-new" method="get" action="/app/inbox"><input type="hidden" name="filter" value="all" /><button class="sp-btn" type="submit">${esc(t(locale, 'split.new'))}</button></form>`;
  const sub = [business ? `<bdi>${esc(business)}</bdi>` : '', esc(show.dayLong(locale, today.now))].filter(Boolean).join(' · ');
  return `<div class="sp">
  <header class="sp-head">
    <span class="sp-headmark">${markSmall(32, null)}</span>
    <div class="sp-headt"><h1 class="page">${esc(t(locale, 'split.title'))}</h1><p class="sp-sub">${sub}</p>${LIVE_SLOT}</div>
    ${newMessage}
  </header>
  ${parts.startCard ? `<div class="sp-start">${parts.startCard}</div>` : ''}
  <div class="sp-panels${showBooks ? '' : ' is-one'}">
    <section class="sp-panel sp-sales" aria-labelledby="sp-sales">
      <div class="sp-phead"><h2 id="sp-sales">${solarSvg('ni', 'chat-round', 22)}${esc(t(locale, 'split.sales'))}</h2>${deeper('/app/inbox', t(locale, 'split.viewAll'))}</div>
      ${notices}
      <div class="sp-sheet">
      ${data.decision ? decisionCard(data.decision.detail, data.decision.extras, locale, now) : ''}
      ${also ? `<div class="sp-card">${also}</div>` : ''}
      ${stageStrip(data.sales, ordersWaiting, locale)}
      ${recent.length ? `<section class="sp-card" aria-labelledby="sp-recent">
        <div class="sp-phead"><h3 class="sp-cap" id="sp-recent">${esc(t(locale, 'split.recent'))}</h3>${deeper('/app/inbox?filter=all', t(locale, 'split.viewAll'))}</div>
        <ul class="sp-rows">${recent.map((r) => recentRow(r, waiting, locale, now, zone)).join('')}</ul>
      </section>` : ''}
      ${lead ? `<div class="sp-card today-worth">${lead}</div>` : ''}
      ${parts.finishSetup ? `<div class="sp-card">${parts.finishSetup}</div>` : ''}
      ${parts.live ? `<div class="sp-card">${renderSending(today, locale, Boolean(s.assistantStoppedAt || s.opsSilenced))}</div>` : ''}
      </div>
    </section>
    ${data.books ? booksPanel(data.books, locale) : ''}
  </div>
  ${showBooks ? `<div class="sp-phonedoor">${deeper('/app/advisor', t(locale, 'nav.advisor'))}</div>` : ''}
</div>`;
}
