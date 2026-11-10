import { zoneOf } from '../../db/zone.js';
import { sql } from 'kysely';
import { summarizePaths, type AnswerPath } from '../../core/conversation/answerPath.js';
import { type Money, isPositive, moneyFromRow } from '../../core/types/money.js';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { PRICE_GIVEN } from '../../db/quotesGiven.js';
import { SPEND_STATUSES } from '../../db/customerValue.js';
import { handledCount, notOwnerTesting } from '../../db/handled.js';

import { type Locale } from '../../core/owner/i18n/locale.js';
import { orderStatusName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';
import { esc, back, wordsHtml } from './layout.js';
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
      .map((r) => moneyFromRow(r.val, r.currency))
      .filter((m): m is Money => m !== null && isPositive(m));

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
  const during = t(locale, `analytics.during.${d.range}` as MessageKey);
  const stat = (value: number, base: string): string =>
    `<div class="result-row"><dt>${esc(noun(locale, base, value))}</dt><dd>${esc(show.count(locale, value))}</dd></div>`;
  const tab = (r: Range) =>
    `<a class="tab ${d.range === r ? 'on' : ''}"${d.range === r ? ' aria-current="page"' : ''} href="/app/results?range=${r}">${esc(t(locale, `analytics.range.${r}` as MessageKey))}</a>`;
  const since = d.since ? `<p class="caption muted an-since">${esc(t(locale, 'analytics.since', { date: show.date(locale, d.since) }))}</p>` : '';
  const header = `<header class="results-header">${back('/app', t(locale, 'split.title'))}
    <h1 class="page">${wordsHtml(locale, 'area1.results.title')}</h1>
    <p class="muted">${wordsHtml(locale, 'area1.results.intro')}</p>
    <div class="tabs">${tab('today')}${tab('week')}${tab('month')}</div>${since}</header>`;
  if (!d.hasActivity) {
    return `<div class="results-page">${header}<section class="empty results-empty">
      <h2 class="stated-now">${esc(t(locale, 'analytics.empty.title'))}</h2>
      <p class="muted">${esc(t(locale, 'analytics.empty.body', { range: during, name }))}</p>
      </section></div>`;
  }

  const section = (id: string, title: string, body: string): string =>
    `<section class="results-section" aria-labelledby="${id}"><h2 id="${id}">${esc(title)}</h2>${body}</section>`;
  const summary = section('results-summary', t(locale, 'analytics.section.summary'),
    `<dl class="result-rows">${stat(d.summary.newClients, 'analytics.n.newClients')}${stat(d.summary.activeConvos, 'analytics.n.conversations')}</dl>`);
  const activity = section('results-activity', t(locale, 'analytics.section.activity'),
    `<dl class="result-rows">${stat(d.activity.inbound, 'analytics.n.inbound')}${stat(d.activity.replied, 'analytics.n.replied')}</dl>`);
  const commerce = section('results-commerce', t(locale, 'analytics.section.commerce'),
    `<dl class="result-rows">${stat(d.commerce.quotes, 'today.tally.quotes')}${stat(d.commerce.orders, 'today.tally.orders')}</dl>`);
  // Each total keeps its real currency. Pending draft reviews remain a current count, as the existing reader defines them.
  const deals = d.commerce.orders > 0
    ? `<div class="results-totals">${d.commerce.totals.map((m) => `<p class="an-total"><span class="v">${esc(show.money(locale, m))}</span> <span class="l">${esc(t(locale, 'analytics.commerce.value'))}</span></p>`).join('')}</div>
      <dl class="result-rows">${d.commerce.deals.map((x) => `<div class="result-row"><dt>${esc(noun(locale, 'analytics.n.order', x.n))} · ${esc(orderStatusName(locale, x.status))}</dt><dd>${esc(show.count(locale, x.n))}</dd></div>`).join('')}</dl>`
    : `<p class="muted">${esc(t(locale, 'analytics.commerce.noDeals'))}</p>`;
  const sales = section('results-sales', t(locale, 'analytics.commerce.deals'), deals);
  const employee = section('results-assistant', t(locale, 'analytics.section.employee', { name }),
    `<dl class="result-rows">${stat(d.employee.handled, 'analytics.n.handled')}${stat(d.employee.waiting, 'analytics.n.waiting')}${stat(d.employee.edits, 'analytics.n.edits')}</dl>
    ${d.employee.answered ? `<p class="note">${esc(t(locale, 'analytics.employee.own', { own: d.employee.answered.hers, replies: d.employee.answered.replies }))}</p>` : ''}
    <p class="sub">${esc(t(locale, 'analytics.employee.foot', { range: during }))}</p>`);
  return `<div class="results-page">${header}<div class="results-sections">${sales}${commerce}${summary}${activity}${employee}</div></div>`;
}
