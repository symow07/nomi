import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { formatUsdCompact } from '../../core/owner/format.js';
import { ORDER_STATUS_ZH } from './inbox.js';
import { esc } from './layout.js';

/**
 * M9.8 — Business Performance / 经营数据. A business review page, not a software
 * dashboard: plain counts over EXISTING business rows (clients, conversations,
 * messages, quotes, orders, drafts). No conversion rates, no invented revenue,
 * no scores — every number is a COUNT (or a real order-value SUM) the owner can
 * verify. When a range has nothing, it says so honestly.
 */

export type Range = 'today' | 'week' | 'month';
const RANGE_UNIT: Record<Range, 'day' | 'week' | 'month'> = { today: 'day', week: 'week', month: 'month' };
const RANGE_ZH: Record<Range, string> = { today: '今天', week: '本周', month: '本月' };
export const parseRange = (r: string | undefined): Range => (r === 'today' || r === 'month' ? r : 'week');

export type AnalyticsData = {
  readonly range: Range;
  readonly rangeZh: string;
  readonly hasActivity: boolean;
  readonly summary: { readonly newClients: number; readonly activeConvos: number; readonly quotes: number; readonly orders: number };
  readonly activity: { readonly inbound: number; readonly replied: number; readonly waiting: number };
  readonly commerce: {
    readonly quotes: number;
    readonly orders: number;
    readonly deals: readonly { readonly statusZh: string; readonly n: number }[];
    readonly totalValueUsd: number | null;
  };
  readonly employee: { readonly handled: number; readonly waiting: number; readonly edits: number };
};

export async function loadAnalytics(db: Db, businessIdRaw: string, range: Range): Promise<AnalyticsData> {
  const rangeZh = RANGE_ZH[range];
  const empty: AnalyticsData = {
    range, rangeZh, hasActivity: false,
    summary: { newClients: 0, activeConvos: 0, quotes: 0, orders: 0 },
    activity: { inbound: 0, replied: 0, waiting: 0 },
    commerce: { quotes: 0, orders: 0, deals: [], totalValueUsd: null },
    employee: { handled: 0, waiting: 0, edits: 0 },
  };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return empty;
  const unit = RANGE_UNIT[range];

  return withTenantTx(db, bid.value, async (tx) => {
    // Range boundary in the owner's one timezone (Beijing) — computed in SQL so
    // week/month starts are correct, then reused as a bound for every count.
    const cutoff = (await sql<{ c: Date }>`
      select (date_trunc(${unit}, now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai') as c
    `.execute(tx)).rows[0]!.c;

    // One round-trip; each figure is a plain COUNT over real rows. RLS (via the
    // tenant tx) scopes every subquery — messages join back through conversations.
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

    // 成交情况 — only when real orders exist; value is a genuine SUM, never invented.
    const dealsRows = c.orders > 0
      ? (await sql<{ status: string; n: number; val: string }>`
          select status, count(*)::int as n, coalesce(sum(total_value_usd), 0)::numeric as val
            from orders where created_at >= ${cutoff} group by status order by status`.execute(tx)).rows
      : [];
    const deals = dealsRows.map((r) => ({ statusZh: ORDER_STATUS_ZH[r.status] ?? r.status, n: r.n }));
    const totalValueUsd = dealsRows.length
      ? dealsRows.reduce((s, r) => s + Number(r.val), 0)
      : null;

    const hasActivity =
      c.new_clients + c.active_convos + c.quotes + c.orders + c.inbound + c.replied + c.handled > 0;

    return {
      range, rangeZh, hasActivity,
      summary: { newClients: c.new_clients, activeConvos: c.active_convos, quotes: c.quotes, orders: c.orders },
      activity: { inbound: c.inbound, replied: c.replied, waiting: c.waiting },
      commerce: { quotes: c.quotes, orders: c.orders, deals, totalValueUsd: totalValueUsd && totalValueUsd > 0 ? totalValueUsd : null },
      employee: { handled: c.handled, waiting: c.waiting, edits: c.edits },
    };
  });
}

/** ── Renderer (pure, mobile-first, owner language) ────────────────────────── */

const stat = (value: number | string, label: string): string =>
  `<div class="stat"><div class="v">${esc(String(value))}</div><div class="l">${esc(label)}</div></div>`;

export function renderAnalytics(d: AnalyticsData): string {
  const tab = (r: Range) =>
    `<a class="tab ${d.range === r ? 'on' : ''}" href="/app/analytics?range=${r}">${esc(RANGE_ZH[r])}</a>`;
  const tabs = `<div class="tabs">${tab('today')}${tab('week')}${tab('month')}</div>`;

  if (!d.hasActivity) {
    return `<h1 class="page">经营数据</h1>${tabs}
      <div class="card"><div class="empty"><div class="big">📈 数据积累中</div>
        <p class="muted">${esc(d.rangeZh)}还没有足够的记录。买家来问、小雅报价、你确认订单，这里就会慢慢长出来。</p></div></div>
      ${ANALYTICS_STYLE}`;
  }

  const summary = `<div class="card"><h2>${esc(d.rangeZh)}概况</h2>
    <div class="stats">
      ${stat(d.summary.newClients, '新增客户')}
      ${stat(d.summary.activeConvos, '客户沟通')}
      ${stat(d.summary.quotes, '报价')}
      ${stat(d.summary.orders, '订单')}
    </div></div>`;

  const activity = `<div class="card"><h2>沟通趋势</h2>
    <div class="stats">
      ${stat(d.activity.inbound, '买家咨询')}
      ${stat(d.activity.replied, '已回复')}
      ${stat(d.activity.waiting, '等待确认')}
    </div></div>`;

  const dealsHtml = d.commerce.orders > 0
    ? `<div class="deals">
        ${d.commerce.deals.map((x) => `<span class="pill ok">${esc(x.statusZh)} ${x.n}</span>`).join('')}
        ${d.commerce.totalValueUsd !== null ? `<div class="muted total">成交金额 ${esc(formatUsdCompact(d.commerce.totalValueUsd))}</div>` : ''}
      </div>`
    : `<div class="muted empty-line">暂无成交记录。</div>`;
  const commerce = `<div class="card"><h2>报价与订单</h2>
    <div class="stats two">
      ${stat(d.commerce.quotes, '报价数量')}
      ${stat(d.commerce.orders, '订单数量')}
    </div>
    <div class="sub">成交情况</div>${dealsHtml}</div>`;

  const employee = `<div class="card"><h2>小雅工作总结</h2>
    <div class="stats">
      ${stat(d.employee.handled, '已处理询盘')}
      ${stat(d.employee.waiting, '等待老板确认')}
      ${stat(d.employee.edits, '老板修改')}
    </div>
    <p class="muted foot">这些都是${esc(d.rangeZh)}的记录。改她的稿越少，说明她越懂你的生意。</p></div>`;

  return `<h1 class="page">经营数据</h1>${tabs}${summary}${activity}${commerce}${employee}${ANALYTICS_STYLE}`;
}

const ANALYTICS_STYLE = `<style>
  .tabs { display:flex; gap:8px; margin-bottom:16px; }
  .tab { padding:8px 16px; border-radius:999px; background:#14171c; border:1px solid #23272e; color:#b9c0c9; font-size:14px; }
  .tab.on { background:#1b2430; color:#fff; }
  .stats.two { grid-template-columns:repeat(2,1fr); }
  .sub { margin:16px 0 10px; font-size:13px; color:#8b929c; }
  .deals { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
  .deals .pill { display:inline-block; padding:5px 12px; border-radius:999px; font-size:13px; font-weight:600; background:#0f2e1c; color:#4ade80; }
  .deals .total { width:100%; font-size:14px; margin-top:6px; }
  .empty { text-align:center; padding:28px 16px; } .big { font-size:19px; font-weight:700; margin-bottom:8px; }
  .empty-line { padding:6px 0; } .foot { margin:14px 0 0; font-size:12px; }
  a.tab:focus-visible { outline:2px solid #60a5fa; outline-offset:2px; }
</style>`;
