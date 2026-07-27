import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { formatUsd, formatQtyZh } from '../../core/owner/format.js';
import { withinWindow } from '../../core/conversation/autonomy.js';
import { esc } from './layout.js';

/**
 * M9.2 — Owner home dashboard. A VIEW over existing YiwuFlow data: every
 * number is a query over tables that already exist (conversations, messages,
 * drafts, quotes, orders, autonomy_policy, spot_checks, capability_events).
 * Nothing is invented; anything not derivable becomes an empty state.
 *
 * It reads only. Actions ("查看") link to the inbox (M9.3), which reuses the
 * existing approval flow — no second approval mechanism here.
 */

const TZ = 'Asia/Shanghai';

const COUNTRY_ZH: Record<string, string> = {
  AE: '阿联酋', SA: '沙特', RU: '俄罗斯', EG: '埃及', MA: '摩洛哥',
  NG: '尼日利亚', CN: '中国', US: '美国', TR: '土耳其', IN: '印度',
};

export type PendingItem = {
  readonly conversationId: string;
  readonly buyer: string;
  readonly countryZh: string | null;
  readonly productZh: string | null;
  readonly quantity: number | null;
  readonly unitPriceUsd: number | null;
};

export type HomeData = {
  readonly greetingZh: string;
  readonly employeeName: string;
  readonly today: { inquiries: number; replied: number; waiting: number; closed: number };
  readonly pending: readonly PendingItem[];
  readonly employee: {
    readonly statusZh: string;
    readonly weekHandled: number;
    readonly weekEdits: number;
    readonly learningUpdated: boolean;
  };
  readonly events: readonly { icon: string; textZh: string }[];
  readonly allNormal: boolean;
};

function greetingFor(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now));
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

const num = (v: unknown): number => Number(v ?? 0) || 0;

export async function loadHomeData(db: Db, businessIdRaw: string, now: Date): Promise<HomeData> {
  const bid = parseBusinessId(businessIdRaw);
  const employeeNameFallback = '小雅';
  if (!bid.ok) {
    return {
      greetingZh: greetingFor(now), employeeName: employeeNameFallback,
      today: { inquiries: 0, replied: 0, waiting: 0, closed: 0 },
      pending: [], employee: { statusZh: '学习中', weekHandled: 0, weekEdits: 0, learningUpdated: false },
      events: [], allNormal: true,
    };
  }

  return withTenantTx(db, bid.value, async (tx) => {
    // Each metric degrades to a safe default if its source can't be read —
    // an empty state, never a fabricated number.
    const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await fn(); } catch { return fallback; }
    };
    const today = `(now() at time zone '${TZ}')::date`;
    const cst = (col: string) => `(${col} at time zone '${TZ}')::date = ${today}`;

    const employeeName = await safe(async () => {
      const r = await sql<{ n: string | null }>`select employee_name as n from onboarding_state where business_id = ${bid.value}`.execute(tx);
      return r.rows[0]?.n ?? employeeNameFallback;
    }, employeeNameFallback);

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

    // Per-conversation, to agree with the inbox's "等你处理" count (M9.3 §12).
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
      buyer: r.buyer ?? '买家',
      countryZh: r.country ? (COUNTRY_ZH[r.country] ?? null) : null,
      productZh: r.name_zh ?? r.name ?? null,
      quantity: r.qty ?? null,
      unitPriceUsd: r.unit_price !== null ? Number(r.unit_price) : null,
    })), []);

    // Employee status from autonomy grants + the clock (night shift = an auto
    // capability whose local-time window is open right now).
    const statusZh = await safe(async () => {
      const rows = (await sql<{ mode: string; time_window: string | null }>`
        select mode, time_window from autonomy_policy where business_id = ${bid.value}`.execute(tx)).rows;
      const autos = rows.filter((r) => r.mode === 'auto');
      if (autos.length === 0) return '学习中';
      const onNight = autos.some((r) => r.time_window && withinWindow(now, TZ, r.time_window));
      return onNight ? '夜班中' : '已晋升';
    }, '学习中');

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

    // 重要动态 — concrete recent signals, mapped to owner language, max 5.
    const events = await safe(async () => {
      const rows = (await sql<{ icon: string; text_zh: string; at: Date }>`
        (select '✓' as icon, '报价已发送 · ' || coalesce(cl.display_name,'买家') as text_zh, q.created_at as at
           from quotes q join conversations c on c.id=q.conversation_id
           left join clients cl on cl.id=c.client_id
          where q.created_at >= now() - interval '2 days' order by q.created_at desc limit 5)
        union all
        (select '⭐', '买家发来产品图 · ' || coalesce(cl.display_name,'买家'), m.sent_at
           from messages m join conversations c on c.id=m.conversation_id
           left join clients cl on cl.id=c.client_id
          where (m.input_type in ('image','image_text') or m.image_url is not null)
            and m.direction='inbound' and m.sent_at >= now() - interval '2 days'
          order by m.sent_at desc limit 5)
        union all
        (select '⚠️', '客户在等回复 · ' || coalesce(cl.display_name,'买家'), d.created_at
           from drafts d join conversations c on c.id=d.conversation_id
           left join clients cl on cl.id=c.client_id
          where d.status='pending' and d.created_at < now() - interval '2 hours'
          order by d.created_at desc limit 5)
        order by at desc limit 5
      `.execute(tx)).rows;
      return rows.map((r) => ({ icon: r.icon, textZh: r.text_zh }));
    }, []);

    return {
      greetingZh: greetingFor(now), employeeName,
      today: { inquiries, replied, waiting, closed },
      pending,
      employee: { statusZh, weekHandled, weekEdits, learningUpdated },
      events,
      allNormal: pending.length === 0,
    };
  });
}

/** ── Pure renderer (mobile-first vertical cards, owner language) ─────────── */

const stat = (label: string, value: number): string =>
  `<div class="stat"><div class="v">${value}</div><div class="l">${esc(label)}</div></div>`;

export function renderHome(d: HomeData): string {
  const pendingCard = d.pending.length
    ? `<div class="card"><h2>⚠️ 等你处理</h2>
        ${d.pending.map((p) => `
          <div class="todo">
            <div class="todo-h"><b>${esc(p.buyer)}</b>${p.countryZh ? `<span class="muted"> · ${esc(p.countryZh)}</span>` : ''}</div>
            <div class="todo-b muted">
              ${p.productZh ? `产品：${esc(p.productZh)}　` : ''}
              ${p.quantity !== null ? `数量：${esc(formatQtyZh(p.quantity))}个　` : ''}
              ${p.unitPriceUsd !== null ? `报价：${esc(formatUsd(p.unitPriceUsd))}` : ''}
            </div>
            <a class="btn" href="/app/inbox/${esc(p.conversationId)}">查看</a>
          </div>`).join('')}
       </div>`
    : `<div class="card ok-card"><div class="ok">✓ 一切正常，不用管</div>
        <p class="muted">没有需要你处理的事。${esc(d.employeeName)}在正常接待。</p></div>`;

  const events = d.events.length
    ? `<div class="card"><h2>重要动态</h2>
        <ul class="events">${d.events.map((e) => `<li>${e.icon} ${esc(e.textZh)}</li>`).join('')}</ul></div>`
    : '';

  return `
  <div class="greet">${esc(d.greetingZh)}<span class="muted"> · ${esc(d.employeeName)}的今日总结</span></div>

  <div class="card">
    <div class="stats">
      ${stat('询盘', d.today.inquiries)}
      ${stat('已回复', d.today.replied)}
      ${stat('等你审批', d.today.waiting)}
      ${stat('成交', d.today.closed)}
    </div>
  </div>

  ${pendingCard}

  <div class="card">
    <h2>${esc(d.employeeName)}工作状态</h2>
    <div class="empstatus"><span class="badge">${esc(d.employee.statusZh)}</span></div>
    <div class="week">
      <div><span class="muted">本周已处理</span><b>${d.employee.weekHandled} 个询盘</b></div>
      <div><span class="muted">你修改过</span><b>${d.employee.weekEdits} 次</b></div>
      <div><span class="muted">学习</span><b>${d.employee.learningUpdated ? '已更新' : '无变化'}</b></div>
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
