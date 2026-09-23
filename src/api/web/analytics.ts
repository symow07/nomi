import { sql } from 'kysely';
import { summarizePaths, type AnswerPath } from '../../core/conversation/answerPath.js';
import { type Money, moneyFromRow } from '../../core/types/money.js';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { formatMoneyCompact } from '../../core/owner/format.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { orderStatusName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';
import { esc } from './layout.js';

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
    const cutoff = (await sql<{ c: Date }>`
      select (date_trunc(${unit}, now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai') as c
    `.execute(tx)).rows[0]!.c;

    const c = (await sql<{
      new_clients: number; active_convos: number; quotes: number; orders: number;
      inbound: number; replied: number; waiting: number; handled: number; edits: number;
    }>`
      select
        (select count(*)::int from clients where created_at >= ${cutoff}) as new_clients,
        (select count(distinct conversation_id)::int from messages where sent_at >= ${cutoff}) as active_convos,
        (select count(*)::int from quotes where created_at >= ${cutoff}) as quotes,
        (select count(*)::int from orders where created_at >= ${cutoff}) as orders,
        (select count(*)::int from messages where direction = 'inbound'  and sent_at >= ${cutoff}) as inbound,
        (select count(*)::int from messages where direction = 'outbound' and sent_at >= ${cutoff}) as replied,
        (select count(*)::int from drafts where status = 'pending') as waiting,
        (select count(*)::int from drafts where status in ('approved','edited') and decided_at >= ${cutoff}) as handled,
        (select count(*)::int from drafts where status = 'edited' and decided_at >= ${cutoff}) as edits
    `.execute(tx)).rows[0]!;

    // Deals — only when real orders exist; value is a genuine SUM, never invented.
    const dealsRows = c.orders > 0
      ? (await sql<{ status: string; n: number }>`
          select status, count(*)::int as n
            from orders where created_at >= ${cutoff} group by status order by status`.execute(tx)).rows
      : [];
    const deals = dealsRows.map((r) => ({ status: r.status, n: r.n }));
    const totalRows = c.orders > 0
      ? (await sql<{ currency: string; val: string }>`
          select currency, coalesce(sum(total_value_usd), 0)::numeric as val
            from orders where created_at >= ${cutoff} group by currency order by 2 desc`.execute(tx)).rows
      : [];
    // A row in a currency this build does not know is dropped, not defaulted:
    // `moneyFromRow` returns null rather than calling it dollars.
    const totals = totalRows
      .map((r) => moneyFromRow(Number(r.val), r.currency))
      .filter((m): m is Money => m !== null && m.amount > 0);

    const hasActivity =
      c.new_clients + c.active_convos + c.quotes + c.orders + c.inbound + c.replied + c.handled > 0;

    // N1 — the same sum the operator's report uses, so the two cannot disagree.
    const measured = (await sql<{ path: AnswerPath; n: number }>`
      select answer_path as path, count(*)::int as n from turns
       where created_at >= ${cutoff} and answer_path is not null group by answer_path`.execute(tx)).rows;
    const paths = summarizePaths(measured.flatMap((m) => Array.from({ length: m.n }, () => ({
      path: m.path, modelId: null, llmCalls: 0, inputTokens: 0, outputTokens: 0, analyserAvoidable: false,
    }))));

    return {
      range, hasActivity,
      summary: { newClients: c.new_clients, activeConvos: c.active_convos, quotes: c.quotes, orders: c.orders },
      activity: { inbound: c.inbound, replied: c.replied, waiting: c.waiting },
      commerce: { quotes: c.quotes, orders: c.orders, deals, totals },
      employee: {
        handled: c.handled, waiting: c.waiting, edits: c.edits,
        ...(paths.replies > 0 ? { answered: { replies: paths.replies, hers: paths.repliesWordedByHer } } : {}),
      },
    };
  });
}

/** ── Renderer (pure, mobile-first, localized) ─────────────────────────────── */

export function renderAnalytics(d: AnalyticsData, locale: Locale): string {
  const name = assistantName(locale);
  const rangeLabel = t(locale, `analytics.range.${d.range}` as MessageKey);
  const stat = (value: number, key: MessageKey): string =>
    `<div class="stat"><div class="v">${value}</div><div class="l">${esc(t(locale, key))}</div></div>`;

  const tab = (r: Range) =>
    `<a class="tab ${d.range === r ? 'on' : ''}" href="/app/analytics?range=${r}">${esc(t(locale, `analytics.range.${r}` as MessageKey))}</a>`;
  const tabs = `<div class="tabs">${tab('today')}${tab('week')}${tab('month')}</div>`;
  const title = `<h1 class="page">${esc(t(locale, 'analytics.title'))}</h1>`;

  if (!d.hasActivity) {
    return `${title}${tabs}
      <div class="block"><div class="empty"><div class="big">📈 ${esc(t(locale, 'analytics.empty.title'))}</div>
        <p class="muted">${esc(t(locale, 'analytics.empty.body', { range: rangeLabel, name }))}</p></div></div>
      ${ANALYTICS_STYLE}`;
  }

  const summary = `<div class="block"><h2>${esc(t(locale, 'analytics.section.summary'))}</h2>
    <div class="stats">
      ${stat(d.summary.newClients, 'analytics.summary.newClients')}
      ${stat(d.summary.activeConvos, 'analytics.summary.conversations')}
      ${stat(d.summary.quotes, 'analytics.summary.quotes')}
      ${stat(d.summary.orders, 'analytics.summary.orders')}
    </div></div>`;

  const activity = `<div class="block"><h2>${esc(t(locale, 'analytics.section.activity'))}</h2>
    <div class="stats">
      ${stat(d.activity.inbound, 'analytics.activity.inbound')}
      ${stat(d.activity.replied, 'analytics.activity.replied')}
      ${stat(d.activity.waiting, 'analytics.activity.waiting')}
    </div></div>`;

  const dealsHtml = d.commerce.orders > 0
    ? `<div class="deals">
        ${d.commerce.deals.map((x) => `<span class="pill ok">${esc(orderStatusName(locale, x.status))} ${x.n}</span>`).join('')}
        ${d.commerce.totals.length ? `<div class="muted total">${esc(t(locale, 'analytics.commerce.totalValue', {
          value: d.commerce.totals.map((m) => formatMoneyCompact(m)).join(' · '),
        }))}</div>` : ''}
      </div>`
    : `<div class="muted empty-line">${esc(t(locale, 'analytics.commerce.noDeals'))}</div>`;
  const commerce = `<div class="block"><h2>${esc(t(locale, 'analytics.section.commerce'))}</h2>
    <div class="stats two">
      ${stat(d.commerce.quotes, 'analytics.commerce.quoteCount')}
      ${stat(d.commerce.orders, 'analytics.commerce.orderCount')}
    </div>
    <div class="sub">${esc(t(locale, 'analytics.commerce.deals'))}</div>${dealsHtml}</div>`;

  const employee = `<div class="block"><h2>${esc(t(locale, 'analytics.section.employee', { name }))}</h2>
    <div class="stats">
      ${stat(d.employee.handled, 'analytics.employee.handled')}
      ${stat(d.employee.waiting, 'analytics.employee.waiting')}
      ${stat(d.employee.edits, 'analytics.employee.edits')}
    </div>
    ${d.employee.answered ? `<p class="own-line">${esc(t(locale, 'analytics.employee.own', {
      own: d.employee.answered.hers, replies: d.employee.answered.replies }))}</p>` : ''}
    <p class="muted foot">${esc(t(locale, 'analytics.employee.foot', { range: rangeLabel }))}</p></div>`;

  return `${title}${tabs}${summary}${activity}${commerce}${employee}${ANALYTICS_STYLE}`;
}

const ANALYTICS_STYLE = `<style>
  .sub { margin:var(--space-16) 0 var(--space-12); font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .deals { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-8); }
  .deals 
  .deals .total { width:100%; font-size:var(--font-size-note); margin-top:var(--space-8); }
  .big { font-size:var(--font-size-title); font-weight:700; margin-bottom:var(--space-8); }
  .own-line { margin:var(--space-12) 0 0; font-size:var(--font-size-note); }
  .empty-line { padding:6px 0; } .foot { margin:var(--space-16) 0 0; font-size:var(--font-size-micro); }
</style>`;
