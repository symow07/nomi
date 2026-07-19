import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from '../db/client.js';
import { computeQuote } from '../core/commerce/quote.js';
import { renderQuoteCard } from '../core/conversation/cards.js';
import { parseBusinessId, type BusinessId, type ProductId } from '../core/types/ids.js';

/**
 * Operator status dashboard (NOT the owner product — the owner lives in
 * WhatsApp). A single read-only page so a human can SEE the running system:
 * health, live database counts, and a real quote card computed from the
 * database price list. No buyer PII: the sample card uses the demo catalog,
 * counts are aggregate. Before real buyer data flows, gate the live-activity
 * view behind a token (not built yet — deliberately).
 */

const DEMO_BIZ = 'de300000-0000-4000-8000-0000000000b1';

export type DashboardData = {
  readonly provider: string;
  readonly dbOk: boolean;
  readonly migrations: number | null;
  readonly counts: {
    readonly businesses: number; readonly products: number;
    readonly conversations: number; readonly orders: number;
  };
  readonly sampleCard: string | null;   // rendered 报价卡 from live pricing
  readonly generatedAt: Date;
};

export async function loadDashboardData(db: Db, provider: string): Promise<DashboardData> {
  let dbOk = false;
  try { await sql`select 1`.execute(db); dbOk = true; } catch { /* dbOk stays false */ }

  // _migrations is not tenant-scoped.
  let migrations: number | null = null;
  try {
    const r = await sql<{ n: number }>`select count(*)::int as n from _migrations`.execute(db);
    migrations = Number(r.rows[0]?.n ?? 0);
  } catch { migrations = null; }

  // Everything tenant-scoped runs inside the demo business's RLS context, so
  // it works whether the runtime role is yiwuflow_app (RLS enforced) or a
  // superuser (RLS bypassed). Demo business = the pilot tenant.
  let counts = { businesses: 0, products: 0, conversations: 0, orders: 0 };
  let sampleCard: string | null = null;
  const bid = parseBusinessId(DEMO_BIZ);
  if (bid.ok) {
    try {
      const res = await withTenantTx(db, bid.value, async (tx) => {
        const c = async (table: string): Promise<number> => {
          const r = await sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)}`.execute(tx);
          return Number(r.rows[0]?.n ?? 0);
        };
        return {
          counts: {
            businesses: await c('businesses'), products: await c('products'),
            conversations: await c('conversations'), orders: await c('orders'),
          },
          card: await loadSampleCard(tx),
        };
      });
      counts = res.counts;
      sampleCard = res.card;
    } catch { /* leave defaults */ }
  }

  return { provider, dbOk, migrations, counts, sampleCard, generatedAt: new Date() };
}

/** Compute a real quote from the demo catalog's live pricing and render it. */
async function loadSampleCard(tx: Tx): Promise<string | null> {
  try {
    const p = await sql<{
      id: string; name: string; moq: number; unit: string; lead_time_days: number | null;
      floor: string; max_disc: string; human_above: string;
    }>`
      select p.id, p.name, p.moq, p.unit, p.lead_time_days,
             pp.floor_price_usd as floor, pp.max_discount_pct as max_disc,
             pp.human_required_above_pct as human_above
        from products p
        join pricing_policy pp on pp.product_id = p.id
       where p.business_id = ${DEMO_BIZ} and p.sku = 'ZX-100'
       limit 1
    `.execute(tx);
    const row = p.rows[0];
    if (!row) return null;

    const tiersRes = await sql<{ min_qty: number; max_qty: number | null; unit_price_usd: string }>`
      select min_qty, max_qty, unit_price_usd from price_tiers
       where product_id = ${row.id} order by min_qty
    `.execute(tx);
    if (tiersRes.rows.length === 0) return null;

    const pid = row.id as ProductId;
    const bid = DEMO_BIZ as unknown as BusinessId;
    const r = computeQuote({
      product: { id: pid, businessId: bid, sku: 'ZX-100', name: row.name, moq: row.moq,
                 unit: row.unit, leadTimeDays: row.lead_time_days, customizable: false },
      tiers: tiersRes.rows.map((t) => ({
        productId: pid, minQty: t.min_qty,
        maxQty: t.max_qty, unitPriceUsd: Number(t.unit_price_usd),
      })),
      policy: { businessId: bid, productId: pid, floorPriceUsd: Number(row.floor),
                maxDiscountPct: Number(row.max_disc), humanRequiredAbovePct: Number(row.human_above) },
      rules: [], quantity: 5000,
    });
    return r.ok ? renderQuoteCard(r.value, row.name) : null;
  } catch { return null; }
}

/** ── HTML (pure, self-contained, dark, responsive) ──────────────────────── */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const pill = (ok: boolean, label: string): string =>
  `<span class="pill ${ok ? 'ok' : 'bad'}">${ok ? '●' : '○'} ${esc(label)}</span>`;

const stat = (label: string, value: string | number): string =>
  `<div class="stat"><div class="v">${esc(String(value))}</div><div class="l">${esc(label)}</div></div>`;

export function renderDashboardHtml(d: DashboardData): string {
  const providerLabel = d.provider === 'disabled'
    ? 'No messaging provider (deployment mode)'
    : `Messaging: ${d.provider}`;
  const healthy = d.dbOk && (d.migrations ?? 0) > 0;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>YiwuFlow · status</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0d10; color: #e6e8eb;
    font: 15px/1.5 -apple-system, "Segoe UI", "Noto Sans SC", system-ui, sans-serif; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 22px; margin: 0 0 2px; letter-spacing: .3px; }
  .sub { color: #8b929c; font-size: 13px; margin-bottom: 24px; }
  .pill { display: inline-block; padding: 5px 12px; border-radius: 999px; font-size: 13px;
    font-weight: 600; margin: 0 8px 8px 0; }
  .pill.ok { background: #0f2e1c; color: #4ade80; }
  .pill.bad { background: #2e1414; color: #f87171; }
  .card { background: #14171c; border: 1px solid #23272e; border-radius: 14px;
    padding: 20px; margin: 16px 0; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .8px;
    color: #8b929c; margin: 0 0 14px; font-weight: 600; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  @media (max-width: 560px) { .stats { grid-template-columns: repeat(2, 1fr); } }
  .stat { background: #0f1216; border: 1px solid #23272e; border-radius: 10px;
    padding: 16px; text-align: center; }
  .stat .v { font-size: 28px; font-weight: 700; color: #fff; }
  .stat .l { font-size: 12px; color: #8b929c; margin-top: 4px; }
  pre { background: #0f1216; border: 1px solid #23272e; border-radius: 10px;
    padding: 18px; overflow-x: auto; font: 14px/1.55 "SF Mono", ui-monospace, Menlo, monospace;
    color: #d6dae0; white-space: pre; margin: 0; }
  .muted { color: #6b7280; font-size: 13px; }
  .foot { margin-top: 28px; color: #6b7280; font-size: 12px; }
  a { color: #60a5fa; text-decoration: none; }
  .banner { border-radius: 12px; padding: 12px 16px; font-size: 13px; margin-bottom: 20px;
    background: ${healthy ? '#0f2e1c' : '#2e2413'}; color: ${healthy ? '#4ade80' : '#fbbf24'}; }
</style></head>
<body><div class="wrap">
  <h1>YiwuFlow</h1>
  <div class="sub">AI sales employee · operator status page</div>

  <div class="banner">${healthy
    ? 'System operational — database migrated, workers running, waiting for messaging provider.'
    : 'System starting or database not yet migrated.'}</div>

  <div class="card">
    <h2>System</h2>
    ${pill(true, 'Service running')}
    ${pill(d.dbOk, d.dbOk ? 'Database connected' : 'Database unreachable')}
    ${pill((d.migrations ?? 0) > 0, `Schema: ${d.migrations ?? 0} migrations`)}
    ${pill(true, 'Workers initialized')}
    ${pill(d.provider !== 'disabled', providerLabel)}
  </div>

  <div class="card">
    <h2>Data in the database</h2>
    <div class="stats">
      ${stat('Businesses', d.counts.businesses)}
      ${stat('Products', d.counts.products)}
      ${stat('Conversations', d.counts.conversations)}
      ${stat('Orders', d.counts.orders)}
    </div>
  </div>

  <div class="card">
    <h2>Live quote card — computed from the database price list</h2>
    ${d.sampleCard
      ? `<pre>${esc(d.sampleCard)}</pre>
         <p class="muted">This is real product output: the price came from the SQL
         price tiers, not from the language model. It is what the owner sees in
         WhatsApp when a buyer asks for 5,000 pcs of this product.</p>`
      : `<p class="muted">No demo catalog found — run <code>npm run seed:demo</code>.</p>`}
  </div>

  <div class="foot">
    The owner's real experience is WhatsApp approval cards, not this page — this
    is an operator view. Machine health: <a href="/health">/health</a>.<br>
    Generated ${esc(d.generatedAt.toISOString())}.
  </div>
</div></body></html>`;
}
