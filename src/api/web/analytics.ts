import { zoneOf } from '../../db/zone.js';
import { sql } from 'kysely';
import { summarizePaths, type AnswerPath } from '../../core/conversation/answerPath.js';
import { type Money, moneyFromRow } from '../../core/types/money.js';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { PRICE_GIVEN } from '../../db/quotesGiven.js';
import { SPEND_STATUSES } from '../../db/customerValue.js';
import { handledCount, notOwnerTesting } from '../../db/handled.js';

import { type Locale } from '../../core/owner/i18n/locale.js';
import { orderStatusName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';
import { esc, back } from './layout.js';
import * as show from './values.js';

/**
 * M9.8 + ADR-0008 — Business Performance. A business review page, not a software
 * dashboard: plain COUNTs over existing rows (+ a real order-value SUM). The read
 * model is language-NEUTRAL (a range code, order-status codes); renderAnalytics
 * localizes. No conversion rates, no invented revenue, no scores.
 */

export type Range = 'today' | 'week' | 'month';
const RANGE_UNIT: Record<Range, 'day' | 'week' | 'month'> = { today: 'day', week: 'week', month: 'month' };
export const parseRange = (r: string | undefined): Range => (r === 'today' || r === 'month' ? r : 'week');

export type AnalyticsData = {
  readonly range: Range;
  /** Phase 9 (w4-customers-21) — where the period starts, in the workspace's zone: "This month" since Oct 1 is shorter than "This week". */
  readonly since?: Date;
  readonly hasActivity: boolean;
  readonly summary: { readonly newClients: number; readonly activeConvos: number; readonly quotes: number; readonly orders: number };
  readonly activity: { readonly inbound: number; readonly replied: number; readonly waiting: number };
  readonly commerce: {
    readonly quotes: number;
    readonly orders: number;
    readonly deals: readonly { readonly status: string; readonly n: number }[];
    /**
     * G18 — ONE TOTAL PER CURRENCY, never one number made of two.
     *
     * This summed `total_value_usd` across every order and labelled the result
     * "$", so the day a second currency exists her month's figure would be
     * dollars and yuan added together — the exact arithmetic `sameCurrency`
     * throws on everywhere else. Empty when there is nothing to total.
     */
    readonly totals: readonly Money[];
  };
  readonly employee: {
    readonly handled: number; readonly waiting: number; readonly edits: number;
    /**
     * N1 — of the replies in this range, how many she worded from the owner's
     * own rules and teaching rather than writing fresh. Absent when no turn in
     * the range was measured (everything before migration 0060).
     */
    readonly answered?: { readonly replies: number; readonly hers: number };
  };
};

export async function loadAnalytics(db: Db, businessIdRaw: string, range: Range): Promise<AnalyticsData> {
  const empty: AnalyticsData = {
    range, hasActivity: false,
    summary: { newClients: 0, activeConvos: 0, quotes: 0, orders: 0 },
    activity: { inbound: 0, replied: 0, waiting: 0 },
    commerce: { quotes: 0, orders: 0, deals: [], totals: [] },
    employee: { handled: 0, waiting: 0, edits: 0 },
  };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return empty;
  const unit = RANGE_UNIT[range];

  return withTenantTx(db, bid.value, async (tx) => {
    // TZ — the period starts in the workspace's own zone.
    const zone = await zoneOf(tx, bid.value);
    const cutoff = (await sql<{ c: Date }>`
      select (date_trunc(${unit}, now() at time zone ${zone}) at time zone ${zone}) as c
    `.execute(tx)).rows[0]!.c;

    // Phase 9 of the warmth run:
    //   - w4-customers-19 — counted by CUSTOMER, the Inbox's rule (one
    //     customer, one conversation): those who wrote or were written to in
    //     the period, and the new ones among them. "40 new customers" stood
    //     over "39 conversations".
    //   - w4-customers-20 — the prices and the orders are Today's figures, by
    //     Today's rules and in Today's words: a quote counts once it was GIVEN
    //     (`PRICE_GIVEN`), an order once it stands and was confirmed in the
    //     period (`SPEND_STATUSES`). One tap apart, the two pages said
    //     "0 quotes sent" and "3 prices worked out" of the same day.
    const spend = [...SPEND_STATUSES];
    // THE ADVISOR BATCH (2026-10-06) — the owner: "Home and Results disagreeing in production is a bug, not a
    // later change. One definition, both pages." "Handled" is Home's (`handledCount`, src/db/handled.ts): the
    // conversations in which a reply the assistant wrote went out. It was drafts approved or edited here.
    // And nothing that is not business counts: the owner's own test conversations are left out of every
    // figure below (`notOwnerTesting`); a practice copy is another business row, kept out by row security.
    const testing = notOwnerTesting;
    const handled = await handledCount(tx, bid.value, cutoff);
    const c = (await sql<{
      new_clients: number; active_convos: number; quotes: number; orders: number;
      inbound: number; replied: number; waiting: number; edits: number;
    }>`
      with talked as (
        select distinct cv.client_id from messages m join conversations cv on cv.id = m.conversation_id
         where m.sent_at >= ${cutoff} and cv.client_id is not null and not cv.owner_testing
      )
      select
        (select count(*)::int from talked t join clients cl on cl.id = t.client_id where cl.created_at >= ${cutoff}) as new_clients,
        (select count(*)::int from talked) as active_convos,
        (select count(*)::int from quotes q where q.created_at >= ${cutoff} and ${PRICE_GIVEN} and ${testing('q.conversation_id')}) as quotes,
        (select count(*)::int from orders o where o.status = any(${spend}::text[])
            and coalesce(o.confirmed_at, o.created_at) >= ${cutoff} and ${testing('o.conversation_id')}) as orders,
        (select count(*)::int from messages m where m.direction = 'inbound'  and m.sent_at >= ${cutoff} and ${testing('m.conversation_id')}) as inbound,
        (select count(*)::int from messages m where m.direction = 'outbound' and m.sent_at >= ${cutoff} and ${testing('m.conversation_id')}) as replied,
        (select count(*)::int from drafts d where d.status = 'pending' and ${testing('d.conversation_id')}) as waiting,
        (select count(*)::int from drafts d where d.status = 'edited' and d.decided_at >= ${cutoff} and ${testing('d.conversation_id')}) as edits
    `.execute(tx)).rows[0]!;

    // Deals — only when real orders exist; value is a genuine SUM, never invented.
    const dealsRows = c.orders > 0
      ? (await sql<{ status: string; n: number }>`
          select status, count(*)::int as n
            from orders o where o.status = any(${spend}::text[]) and coalesce(o.confirmed_at, o.created_at) >= ${cutoff}
              and ${testing('o.conversation_id')}
           group by status order by status`.execute(tx)).rows
      : [];
    const deals = dealsRows.map((r) => ({ status: r.status, n: r.n }));
    const totalRows = c.orders > 0
      ? (await sql<{ currency: string; val: string }>`
          select currency, coalesce(sum(total_value_usd), 0)::numeric as val
            from orders o where o.status = any(${spend}::text[]) and coalesce(o.confirmed_at, o.created_at) >= ${cutoff}
              and ${testing('o.conversation_id')}
           group by currency order by 2 desc`.execute(tx)).rows
      : [];
    // A row in a currency this build does not know is dropped, not defaulted:
    // `moneyFromRow` returns null rather than calling it dollars.
    const totals = totalRows
      .map((r) => moneyFromRow(Number(r.val), r.currency))
      .filter((m): m is Money => m !== null && m.amount > 0);

    const hasActivity =
      c.new_clients + c.active_convos + c.quotes + c.orders + c.inbound + c.replied + handled > 0;

    // N1 — the same sum the operator's report uses, so the two cannot disagree.
    const measured = (await sql<{ path: AnswerPath; n: number }>`
      select answer_path as path, count(*)::int as n from turns t
       where t.created_at >= ${cutoff} and t.answer_path is not null and ${testing('t.conversation_id')}
       group by answer_path`.execute(tx)).rows;
    const paths = summarizePaths(measured.flatMap((m) => Array.from({ length: m.n }, () => ({
      path: m.path, modelId: null, llmCalls: 0, inputTokens: 0, outputTokens: 0, analyserAvoidable: false,
    }))));

    return {
      range, hasActivity, since: cutoff,
      summary: { newClients: c.new_clients, activeConvos: c.active_convos, quotes: c.quotes, orders: c.orders },
      activity: { inbound: c.inbound, replied: c.replied, waiting: c.waiting },
      commerce: { quotes: c.quotes, orders: c.orders, deals, totals },
      employee: {
        handled, waiting: c.waiting, edits: c.edits,
        ...(paths.replies > 0 ? { answered: { replies: paths.replies, hers: paths.repliesWordedByHer } } : {}),
      },
    };
  });
}

/** ── Renderer (pure, mobile-first, localized) ─────────────────────────────── */

/**
 * Phase 9 (V1-209) — a count's words in the form its language gives that count
 * ("1 order placed", "12 طلبًا"): the figure stands first, as on every stat row,
 * and the words after it agree with it.
 */
const noun = (locale: Locale, base: string, n: number): string =>
  t(locale, `${base}.${new Intl.PluralRules(locale).select(n)}` as MessageKey);

export function renderAnalytics(d: AnalyticsData, locale: Locale): string {
  const name = assistantName(locale);
  // Phase 9 (V1-206) — the period inside a sentence is lower case: "This covers this week."
  const during = t(locale, `analytics.during.${d.range}` as MessageKey);
  const stat = (value: number, base: string): string =>
    `<div class="stat"><div class="v">${esc(show.count(locale, value))}</div><div class="l">${esc(noun(locale, base, value))}</div></div>`;

  const tab = (r: Range) =>
    `<a class="tab ${d.range === r ? 'on' : ''}"${d.range === r ? ' aria-current="page"' : ''} href="/app/analytics?range=${r}">${esc(t(locale, `analytics.range.${r}` as MessageKey))}</a>`;
  // Phase 9 (w4-customers-21) — the period says where it starts: "This month" since Oct 1 read as smaller than "This week".
  const since = d.since ? `<p class="caption muted an-since">${esc(t(locale, 'analytics.since', { date: show.date(locale, d.since) }))}</p>` : '';
  const tabs = `<div class="tabs">${tab('today')}${tab('week')}${tab('month')}</div>${since}`;
  // Phase 9 (V1-207) — Results is Today's page, and says so: the way back is
  // to Today, the period's chip is "Today so far", not a second "Today".
  const title = `${back('/app', t(locale, 'nav.home'))}<h1 class="page">${esc(t(locale, 'analytics.title'))}</h1>`;

  if (!d.hasActivity) {
    return `<div class="measure-prose">${title}${tabs}
      ${/* Phase 9 of the warmth run (w4-customers-24) — the words alone: the emoji was the one picture of a chart on a page that has none. */ ''}<div class="block"><div class="empty"><div class="stated-now">${esc(t(locale, 'analytics.empty.title'))}</div>
        <p class="muted">${esc(t(locale, 'analytics.empty.body', { range: during, name }))}</p></div></div></div>`;
  }

  // Phase 9 (V1-208) — each count once: the prices and orders are under their
  // own heading, not a second time in the overview.
  const summary = `<div class="block"><h2>${esc(t(locale, 'analytics.section.summary'))}</h2>
    <div class="stats">
      ${stat(d.summary.newClients, 'analytics.n.newClients')}
      ${stat(d.summary.activeConvos, 'analytics.n.conversations')}
    </div></div>`;

  const activity = `<div class="block"><h2>${esc(t(locale, 'analytics.section.activity'))}</h2>
    <div class="stats">
      ${stat(d.activity.inbound, 'analytics.n.inbound')}
      ${stat(d.activity.replied, 'analytics.n.replied')}
    </div></div>`;
  // Phase 9 (V1-205) — "Awaiting you" counted only the drafts waiting for review
  // and disagreed with the rail's "Needs you"; the same count stands, named for
  // what it is, under the assistant's work ("Replies waiting for your OK").

  // Phase 9 (V1-210) — the sales in the page's one pattern, a figure and its
  // words: how many orders are in each state, then what they come to, to the
  // cent as the order page says it. A pill there read as a filter.
  // Phase 9 of the warmth run — w4-customers-22: Sales is a section with its
  // heading, as every other is, and what the orders come to is its headline
  // line, above the counts: as a row its wide figure pushed its words out of
  // the column every other row keeps. w4-customers-20: the prices and the
  // orders in Today's own words (`today.tally.*`), counted by Today's rules.
  const deals = d.commerce.orders > 0
    ? `${d.commerce.totals.map((m) => `<p class="an-total"><span class="v">${esc(show.money(locale, m))}</span> <span class="l">${esc(t(locale, 'analytics.commerce.value'))}</span></p>`).join('')}
      <div class="stats">
        ${d.commerce.deals.map((x) => `<div class="stat"><div class="v">${esc(show.count(locale, x.n))}</div><div class="l">${
          esc(noun(locale, 'analytics.n.order', x.n))} · ${esc(orderStatusName(locale, x.status))}</div></div>`).join('')}
      </div>`
    : `<div class="muted">${esc(t(locale, 'analytics.commerce.noDeals'))}</div>`;
  const commerce = `<div class="block"><h2>${esc(t(locale, 'analytics.section.commerce'))}</h2>
    <div class="stats">
      ${stat(d.commerce.quotes, 'today.tally.quotes')}
      ${stat(d.commerce.orders, 'today.tally.orders')}
    </div></div>
    <div class="block"><h2>${esc(t(locale, 'analytics.commerce.deals'))}</h2>${deals}</div>`;

  const employee = `<div class="block"><h2>${esc(t(locale, 'analytics.section.employee', { name }))}</h2>
    <div class="stats">
      ${stat(d.employee.handled, 'analytics.n.handled')}
      ${stat(d.employee.waiting, 'analytics.n.waiting')}
      ${stat(d.employee.edits, 'analytics.n.edits')}
    </div>
    ${d.employee.answered ? `<p class="note">${esc(t(locale, 'analytics.employee.own', {
      own: d.employee.answered.hers, replies: d.employee.answered.replies }))}</p>` : ''}
    <p class="sub">${esc(t(locale, 'analytics.employee.foot', { range: during }))}</p></div>`;

  // Phase 9 (V1-211) — the page keeps the prose measure, so a section's rule
  // ends where its rows do.
  return `<div class="measure-prose">${title}${tabs}${summary}${activity}${commerce}${employee}</div>`;
}
