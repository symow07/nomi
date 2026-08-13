import { sql } from 'kysely';
import { type Money, usd } from '../../core/types/money.js';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { formatMoneyCompact } from '../../core/owner/format.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, orderStatusName, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
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
    readonly totalValue: Money | null;
  };
  readonly employee: { readonly handled: number; readonly waiting: number; readonly edits: number };
};

export async function loadAnalytics(db: Db, businessIdRaw: string, range: Range): Promise<AnalyticsData> {
  const empty: AnalyticsData = {
    range, hasActivity: false,
    summary: { newClients: 0, activeConvos: 0, quotes: 0, orders: 0 },
    activity: { inbound: 0, replied: 0, waiting: 0 },
    commerce: { quotes: 0, orders: 0, deals: [], totalValue: null },
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
      ? (await sql<{ status: string; n: number; val: string }>`
          select status, count(*)::int as n, coalesce(sum(total_value_usd), 0)::numeric as val
            from orders where created_at >= ${cutoff} group by status order by status`.execute(tx)).rows
      : [];
    const deals = dealsRows.map((r) => ({ status: r.status, n: r.n }));
    const totalValue = dealsRows.length ? dealsRows.reduce((s, r) => s + Number(r.val), 0) : null;

    const hasActivity =
      c.new_clients + c.active_convos + c.quotes + c.orders + c.inbound + c.replied + c.handled > 0;

    return {
      range, hasActivity,
      summary: { newClients: c.new_clients, activeConvos: c.active_convos, quotes: c.quotes, orders: c.orders },
      activity: { inbound: c.inbound, replied: c.replied, waiting: c.waiting },
      commerce: { quotes: c.quotes, orders: c.orders, deals, totalValue: totalValue !== null && totalValue > 0 ? usd(totalValue) : null },
      employee: { handled: c.handled, waiting: c.waiting, edits: c.edits },
    };
  });
}

/** ── Renderer (pure, mobile-first, localized) ─────────────────────────────── */

export function renderAnalytics(d: AnalyticsData, locale: Locale): string {
  const name = EMPLOYEE_NAME[locale];
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
        ${d.commerce.totalValue !== null ? `<div class="muted total">${esc(t(locale, 'analytics.commerce.totalValue', { value: formatMoneyCompact(d.commerce.totalValue) }))}</div>` : ''}
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
    <p class="muted foot">${esc(t(locale, 'analytics.employee.foot', { range: rangeLabel }))}</p></div>`;

  return `${title}${tabs}${summary}${activity}${commerce}${employee}${ANALYTICS_STYLE}`;
}

const ANALYTICS_STYLE = `<style>
  .sub { margin:16px 0 10px; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .deals { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
  .deals 
  .deals .total { width:100%; font-size:var(--font-size-note); margin-top:6px; }
  .big { font-size:var(--font-size-title); font-weight:700; margin-bottom:8px; }
  .empty-line { padding:6px 0; } .foot { margin:14px 0 0; font-size:var(--font-size-micro); }
</style>`;
