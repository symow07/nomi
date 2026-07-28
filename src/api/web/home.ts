import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { withinWindow } from '../../core/conversation/autonomy.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, countryName, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatQty, formatUsd } from '../../core/owner/i18n/format.js';
import { esc } from './layout.js';

/**
 * M9.2 + ADR-0008 — Owner home dashboard. A VIEW over existing data. The read
 * model is language-NEUTRAL (tokens, codes, counts, raw names); renderHome takes
 * a locale and localizes. Nothing is invented; anything not derivable is empty.
 */

const TZ = 'Asia/Shanghai';

type Greeting = 'morning' | 'afternoon' | 'evening';
type EmpStatus = 'learning' | 'night' | 'promoted';
type HomeEventKind = 'quote_sent' | 'buyer_image' | 'waiting';

export type PendingItem = {
  readonly conversationId: string;
  readonly buyer: string | null;
  readonly countryCode: string | null;
  readonly product: { readonly name: string | null; readonly nameZh: string | null };
  readonly quantity: number | null;
  readonly unitPriceUsd: number | null;
};

export type HomeData = {
  readonly greeting: Greeting;
  readonly today: { inquiries: number; replied: number; waiting: number; closed: number };
  readonly pending: readonly PendingItem[];
  readonly employee: {
    readonly status: EmpStatus;
    readonly weekHandled: number;
    readonly weekEdits: number;
    readonly learningUpdated: boolean;
  };
  readonly events: readonly { readonly kind: HomeEventKind; readonly buyer: string }[];
  readonly allNormal: boolean;
};

function greetingFor(now: Date): Greeting {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now));
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

const num = (v: unknown): number => Number(v ?? 0) || 0;

export async function loadHomeData(db: Db, businessIdRaw: string, now: Date): Promise<HomeData> {
  const bid = parseBusinessId(businessIdRaw);
  const empty: HomeData = {
    greeting: greetingFor(now),
    today: { inquiries: 0, replied: 0, waiting: 0, closed: 0 },
    pending: [], employee: { status: 'learning', weekHandled: 0, weekEdits: 0, learningUpdated: false },
    events: [], allNormal: true,
  };
  if (!bid.ok) return empty;

  return withTenantTx(db, bid.value, async (tx) => {
    const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await fn(); } catch { return fallback; }
    };
    const today = `(now() at time zone '${TZ}')::date`;
    const cst = (col: string) => `(${col} at time zone '${TZ}')::date = ${today}`;

    const inquiries = await safe(async () => num((await sql<{ n: number }>`
      select count(distinct m.conversation_id)::int as n from messages m
       join conversations c on c.id = m.conversation_id
       where m.direction = 'inbound' and ${sql.raw(cst('m.sent_at'))}`.execute(tx)).rows[0]?.n), 0);

    const replied = await safe(async () => num((await sql<{ n: number }>`
      select count(distinct conv)::int as n from (
        select m.conversation_id as conv from messages m
          join conversations c on c.id = m.conversation_id
          where m.direction = 'outbound' and ${sql.raw(cst('m.sent_at'))}
        union
        select o.conversation_id from outbound_messages o
          where o.status in ('sent','delivered','read') and o.sent_at is not null and ${sql.raw(cst('o.sent_at'))}
      ) x`.execute(tx)).rows[0]?.n), 0);

    const waiting = await safe(async () => num((await sql<{ n: number }>`
      select count(distinct conversation_id)::int as n from drafts where status = 'pending'`.execute(tx)).rows[0]?.n), 0);

    const closed = await safe(async () => num((await sql<{ n: number }>`
      select count(*)::int as n from orders where ${sql.raw(cst('created_at'))}`.execute(tx)).rows[0]?.n), 0);

    const pending = await safe(async () => (await sql<{
      conversation_id: string; buyer: string | null; country: string | null;
      name_zh: string | null; name: string | null; qty: number | null; unit_price: string | null;
    }>`
      select d.conversation_id, cl.display_name as buyer, cl.country,
             p.name_zh, p.name, cs.inquiry_quantity as qty,
             (select unit_price_usd from quotes q where q.conversation_id = d.conversation_id
                order by q.created_at desc limit 1) as unit_price
        from drafts d
        join conversations c on c.id = d.conversation_id
        left join clients cl on cl.id = c.client_id
        left join conversation_state cs on cs.conversation_id = c.id
        left join products p on p.id = cs.identified_product_id
       where d.status = 'pending'
       order by d.created_at asc limit 6
    `.execute(tx)).rows.map((r): PendingItem => ({
      conversationId: r.conversation_id,
      buyer: r.buyer,
      countryCode: r.country,
      product: { name: r.name, nameZh: r.name_zh },
      quantity: r.qty ?? null,
      unitPriceUsd: r.unit_price !== null ? Number(r.unit_price) : null,
    })), []);

    const status = await safe<EmpStatus>(async () => {
      const rows = (await sql<{ mode: string; time_window: string | null }>`
        select mode, time_window from autonomy_policy where business_id = ${bid.value}`.execute(tx)).rows;
      const autos = rows.filter((r) => r.mode === 'auto');
      if (autos.length === 0) return 'learning';
      return autos.some((r) => r.time_window && withinWindow(now, TZ, r.time_window)) ? 'night' : 'promoted';
    }, 'learning');

    const weekHandled = await safe(async () => num((await sql<{ n: number }>`
      select count(distinct conv)::int as n from (
        select m.conversation_id as conv from messages m
          join conversations c on c.id = m.conversation_id
          where m.direction = 'outbound' and m.sent_at >= now() - interval '7 days'
        union
        select o.conversation_id from outbound_messages o
          where o.status in ('sent','delivered','read') and o.sent_at >= now() - interval '7 days'
      ) x`.execute(tx)).rows[0]?.n), 0);

    const weekEdits = await safe(async () => num((await sql<{ n: number }>`
      select count(*)::int as n from drafts
       where status = 'edited' and decided_at >= now() - interval '7 days'`.execute(tx)).rows[0]?.n), 0);

    const learningUpdated = await safe(async () => (await sql<{ ok: boolean }>`
      select (
        exists(select 1 from drafts where status = 'edited' and decided_at >= now() - interval '7 days')
        or exists(select 1 from spot_checks where answered_at >= now() - interval '7 days')
        or exists(select 1 from capability_events where at >= now() - interval '7 days')
      ) as ok`.execute(tx)).rows[0]?.ok ?? false, false);

    const events = await safe(async () => {
      const rows = (await sql<{ kind: string; buyer: string | null; at: Date }>`
        (select 'quote_sent' as kind, cl.display_name as buyer, q.created_at as at
           from quotes q join conversations c on c.id=q.conversation_id
           left join clients cl on cl.id=c.client_id
          where q.created_at >= now() - interval '2 days' order by q.created_at desc limit 5)
        union all
        (select 'buyer_image', cl.display_name, m.sent_at
           from messages m join conversations c on c.id=m.conversation_id
           left join clients cl on cl.id=c.client_id
          where (m.input_type in ('image','image_text') or m.image_url is not null)
            and m.direction='inbound' and m.sent_at >= now() - interval '2 days'
          order by m.sent_at desc limit 5)
        union all
        (select 'waiting', cl.display_name, d.created_at
           from drafts d join conversations c on c.id=d.conversation_id
           left join clients cl on cl.id=c.client_id
          where d.status='pending' and d.created_at < now() - interval '2 hours'
          order by d.created_at desc limit 5)
        order by at desc limit 5
      `.execute(tx)).rows;
      const kinds = new Set<HomeEventKind>(['quote_sent', 'buyer_image', 'waiting']);
      return rows.flatMap((r) => kinds.has(r.kind as HomeEventKind)
        ? [{ kind: r.kind as HomeEventKind, buyer: r.buyer ?? '' }] : []);
    }, [] as { kind: HomeEventKind; buyer: string }[]);

    return {
      greeting: greetingFor(now),
      today: { inquiries, replied, waiting, closed },
      pending,
      employee: { status, weekHandled, weekEdits, learningUpdated },
      events,
      allNormal: pending.length === 0,
    };
  });
}

/** ── Pure renderer (mobile-first vertical cards, localized) ──────────────── */

const EVENT_ICON: Record<HomeData['events'][number]['kind'], string> = {
  quote_sent: '✓', buyer_image: '⭐', waiting: '⚠️',
};

export function renderHome(d: HomeData, locale: Locale): string {
  const name = EMPLOYEE_NAME[locale];
  const productName = (p: PendingItem['product']): string | null =>
    locale === 'zh' ? (p.nameZh ?? p.name) : (p.name ?? p.nameZh);

  const stat = (key: MessageKey, value: number): string =>
    `<div class="stat"><div class="v">${value}</div><div class="l">${esc(t(locale, key))}</div></div>`;

  const pendingCard = d.pending.length
    ? `<div class="card"><h2>⚠️ ${esc(t(locale, 'home.pending.title'))}</h2>
        ${d.pending.map((p) => {
          const prod = productName(p.product);
          const country = countryName(locale, p.countryCode);
          return `<div class="todo">
            <div class="todo-h"><b>${esc(p.buyer ?? t(locale, 'common.buyer'))}</b>${country ? `<span class="muted"> · ${esc(country)}</span>` : ''}</div>
            <div class="todo-b muted">
              ${prod ? `${esc(t(locale, 'home.pending.product'))}: ${esc(prod)}　` : ''}
              ${p.quantity !== null ? `${esc(t(locale, 'home.pending.qty'))}: ${esc(formatQty(locale, p.quantity))} ${esc(t(locale, 'home.pending.qtyUnit'))}　` : ''}
              ${p.unitPriceUsd !== null ? `${esc(t(locale, 'home.pending.price'))}: ${esc(formatUsd(p.unitPriceUsd))}` : ''}
            </div>
            <a class="btn" href="/app/inbox/${esc(p.conversationId)}">${esc(t(locale, 'home.pending.view'))}</a>
          </div>`;
        }).join('')}
       </div>`
    : `<div class="card ok-card"><div class="ok">✓ ${esc(t(locale, 'home.allNormal.title'))}</div>
        <p class="muted">${esc(t(locale, 'home.allNormal.body', { name }))}</p></div>`;

  const events = d.events.length
    ? `<div class="card"><h2>${esc(t(locale, 'home.events.title'))}</h2>
        <ul class="events">${d.events.map((e) =>
          `<li>${EVENT_ICON[e.kind]} ${esc(t(locale, `home.event.${e.kind === 'quote_sent' ? 'quoteSent' : e.kind === 'buyer_image' ? 'buyerImage' : 'waiting'}` as MessageKey, { buyer: e.buyer || t(locale, 'common.buyer') }))}</li>`,
        ).join('')}</ul></div>`
    : '';

  return `
  <div class="greet">${esc(t(locale, `greeting.${d.greeting}` as MessageKey))}<span class="muted"> · ${esc(t(locale, 'home.summaryFor', { name }))}</span></div>

  <div class="card">
    <div class="stats">
      ${stat('home.stat.inquiries', d.today.inquiries)}
      ${stat('home.stat.replied', d.today.replied)}
      ${stat('home.stat.waiting', d.today.waiting)}
      ${stat('home.stat.closed', d.today.closed)}
    </div>
  </div>

  ${pendingCard}

  <div class="card">
    <h2>${esc(t(locale, 'home.status.title', { name }))}</h2>
    <div class="empstatus"><span class="badge">${esc(t(locale, `home.status.${d.employee.status}` as MessageKey))}</span></div>
    <div class="week">
      <div><span class="muted">${esc(t(locale, 'home.week.handled'))}</span><b>${d.employee.weekHandled} ${esc(t(locale, 'home.week.handledUnit'))}</b></div>
      <div><span class="muted">${esc(t(locale, 'home.week.edits'))}</span><b>${d.employee.weekEdits} ${esc(t(locale, 'home.week.editsUnit'))}</b></div>
      <div><span class="muted">${esc(t(locale, 'home.week.learning'))}</span><b>${esc(t(locale, d.employee.learningUpdated ? 'home.week.updated' : 'home.week.noChange'))}</b></div>
    </div>
  </div>

  ${events}

  <style>
    .greet { font-size:20px; font-weight:700; margin:2px 0 16px; }
    .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
    .stat { background:#0f1216; border:1px solid #23272e; border-radius:10px; padding:16px; text-align:center; }
    .stat .v { font-size:28px; font-weight:700; color:#fff; } .stat .l { font-size:12px; color:#8b929c; margin-top:4px; }
    .todo { border:1px solid #2b313a; border-radius:12px; padding:14px; margin-bottom:10px; }
    .todo-h { font-size:15px; margin-bottom:4px; } .todo-b { font-size:13px; margin-bottom:10px; }
    .btn { display:inline-block; background:#2563eb; color:#fff; padding:8px 18px; border-radius:8px; font-size:14px; font-weight:600; }
    .btn:hover { background:#1d4ed8; }
    .ok-card { background:#0f2419; border-color:#1c4a33; } .ok { color:#4ade80; font-size:17px; font-weight:700; }
    .badge { display:inline-block; background:#1b2430; color:#e6e8eb; padding:6px 14px; border-radius:999px; font-weight:600; }
    .empstatus { margin-bottom:14px; }
    .week { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
    .week > div { background:#0f1216; border:1px solid #23272e; border-radius:10px; padding:12px; }
    .week b { display:block; margin-top:4px; }
    .events { list-style:none; padding:0; margin:0; } .events li { padding:8px 0; border-bottom:1px solid #1c2026; font-size:14px; }
    .events li:last-child { border-bottom:none; }
    @media (max-width:560px) { .stats { grid-template-columns:repeat(2,1fr); } .week { grid-template-columns:1fr; } }
  </style>`;
}
