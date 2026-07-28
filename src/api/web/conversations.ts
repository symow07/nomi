import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { CAPABILITY_ZH } from '../../core/owner/vocabulary.js';
import { formatUsd, formatQtyZh, formatWhenZh, formatDateZh } from '../../core/owner/format.js';
import { countryZh, flag, ORDER_STATUS_ZH } from './inbox.js';
import { esc } from './layout.js';

/**
 * M9.7 — Conversations / 客户档案. Customer memory, NOT a chat viewer and NOT a
 * second inbox. A read model over EXISTING business activity: conversations,
 * clients, messages, quotes, orders, drafts (owner corrections), conversation
 * events. Actions live in the Inbox (the one approval path) — this page only
 * remembers the relationship. No new storage, no new approval flow.
 */

const CHANNEL_ZH: Record<string, string> = {
  whatsapp: 'WhatsApp', wechat: '微信', instagram: 'Instagram', rednote: '小红书', webhook_test: '测试渠道',
};
const channelZh = (c: string): string => CHANNEL_ZH[c] ?? c;

const PHASE_ZH: Record<string, string> = {
  warm_intake: '刚开始', clarification: '了解需求', qualification: '确认意向',
  commercial_discussion: '商谈报价', confirmation: '准备成交', escalated: '需要你', closed: '已结束',
};

const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Relationship status from real signals — decision-neutral, owner language. */
function relationshipOf(row: {
  pending: number; order_status: string | null; quote_count: number;
  is_active: boolean; closed_at: Date | null; phase: string;
}): { zh: string; tone: 'ok' | 'warn' | 'muted'; needsOwner: boolean } {
  if (row.pending > 0) return { zh: '等待确认', tone: 'warn', needsOwner: true };
  if (row.order_status) {
    const zh = ORDER_STATUS_ZH[row.order_status] ?? row.order_status;
    return { zh, tone: row.order_status === 'cancelled' ? 'muted' : 'ok', needsOwner: false };
  }
  if (row.closed_at !== null) return { zh: '已结束', tone: 'muted', needsOwner: false };
  if (row.quote_count > 0) return { zh: '已报价', tone: 'ok', needsOwner: false };
  if (row.is_active) return { zh: PHASE_ZH[row.phase] ?? '沟通中', tone: 'ok', needsOwner: false };
  return { zh: '已结束', tone: 'muted', needsOwner: false };
}

/** ── Section 1: customer list ─────────────────────────────────────────────── */

export type CustomerCard = {
  readonly conversationId: string;
  readonly buyer: string;
  readonly country: string | null;
  readonly channelZh: string;
  readonly statusZh: string;
  readonly statusTone: 'ok' | 'warn' | 'muted';
  readonly needsOwner: boolean;
  readonly productsZh: readonly string[];
  readonly lastActivity: Date | null;
};

export type CustomerList = {
  readonly query: string;
  readonly customers: readonly CustomerCard[];
};

export async function loadCustomerList(db: Db, businessIdRaw: string, query: string): Promise<CustomerList> {
  const q = query.trim();
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { query: q, customers: [] };
  const like = q ? `%${q}%` : null;

  return withTenantTx(db, bid.value, async (tx) => {
    // ONE query; laterals bound each per-row lookup. Ordering is NOT "latest
    // message": important (VIP) + active relationships surface first, then
    // recency. Simple ILIKE filter (buyer name / product) — no CRM search.
    const rows = (await sql<{
      id: string; buyer: string | null; country: string | null; is_vip: boolean;
      channel: string; phase: string; is_active: boolean; closed_at: Date | null;
      name_zh: string | null; name: string | null; last_activity: Date | null;
      pending: number; quote_count: number; order_status: string | null;
    }>`
      select c.id, cl.display_name as buyer, cl.country, cl.is_vip,
             c.channel, c.phase, c.is_active, c.closed_at,
             p.name_zh, p.name,
             greatest(coalesce(lm.sent_at, c.updated_at), c.updated_at) as last_activity,
             (select count(*)::int from drafts d where d.conversation_id = c.id and d.status = 'pending') as pending,
             (select count(*)::int from quotes q where q.conversation_id = c.id) as quote_count,
             ord.status as order_status
        from conversations c
        left join clients cl on cl.id = c.client_id
        left join conversation_state cs on cs.conversation_id = c.id
        left join products p on p.id = cs.identified_product_id
        left join lateral (select sent_at from messages m
                            where m.conversation_id = c.id order by m.sent_at desc limit 1) lm on true
        left join lateral (select status from orders o
                            where o.conversation_id = c.id order by o.created_at desc limit 1) ord on true
       where ${like}::text is null
          or cl.display_name ilike ${like}
          or p.name_zh ilike ${like}
          or p.name ilike ${like}
       order by cl.is_vip desc nulls last,
                (c.is_active and c.closed_at is null) desc,
                greatest(coalesce(lm.sent_at, c.updated_at), c.updated_at) desc nulls last
       limit 100
    `.execute(tx)).rows;

    const customers = rows.map((r): CustomerCard => {
      const rel = relationshipOf({
        pending: r.pending, order_status: r.order_status, quote_count: r.quote_count,
        is_active: r.is_active, closed_at: r.closed_at, phase: r.phase,
      });
      const product = r.name_zh ?? r.name;
      return {
        conversationId: r.id, buyer: r.buyer ?? '买家', country: r.country,
        channelZh: channelZh(r.channel), statusZh: rel.zh, statusTone: rel.tone,
        needsOwner: rel.needsOwner, productsZh: product ? [product] : [],
        lastActivity: r.last_activity,
      };
    });
    return { query: q, customers };
  });
}

/** ── Sections 2–4: the customer file ──────────────────────────────────────── */

export type Milestone = { readonly icon: string; readonly kind: string; readonly textZh: string; readonly at: Date | null };

export type CustomerFile = {
  readonly conversationId: string;
  readonly buyer: string;
  readonly country: string | null;
  readonly channelZh: string;
  readonly statusZh: string;
  readonly statusTone: 'ok' | 'warn' | 'muted';
  readonly needsOwner: boolean;
  readonly profile: {
    readonly firstContact: Date | null;
    readonly productsZh: readonly string[];
    readonly quoteCount: number;
    readonly orderCount: number;
  };
  readonly timeline: readonly Milestone[];
  readonly context: {
    readonly products: readonly { readonly sku: string | null; readonly nameZh: string }[];
    readonly latestQuote: { readonly qty: number; readonly unitUsd: number; readonly totalUsd: number } | null;
    readonly order: { readonly statusZh: string; readonly reference: string; readonly qty: number; readonly totalUsd: number | null } | null;
    readonly corrections: readonly string[];
  };
};

export async function loadCustomerFile(db: Db, businessIdRaw: string, conversationId: string): Promise<CustomerFile | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;

  return withTenantTx(db, bid.value, async (tx) => {
    // RLS scopes to the business; a foreign/unknown id simply returns none —
    // existence in another tenant is never revealed.
    const head = (await sql<{
      id: string; buyer: string | null; country: string | null; channel: string;
      phase: string; is_active: boolean; closed_at: Date | null; client_created: Date | null;
      name_zh: string | null; name: string | null;
      pending: number; quote_count: number; order_count: number; order_status: string | null;
    }>`
      select c.id, cl.display_name as buyer, cl.country, c.channel, c.phase,
             c.is_active, c.closed_at, cl.created_at as client_created,
             p.name_zh, p.name,
             (select count(*)::int from drafts d where d.conversation_id = c.id and d.status = 'pending') as pending,
             (select count(*)::int from quotes q where q.conversation_id = c.id) as quote_count,
             (select count(*)::int from orders o where o.conversation_id = c.id) as order_count,
             (select status from orders o where o.conversation_id = c.id order by o.created_at desc limit 1) as order_status
        from conversations c
        left join clients cl on cl.id = c.client_id
        left join conversation_state cs on cs.conversation_id = c.id
        left join products p on p.id = cs.identified_product_id
       where c.id = ${conversationId} limit 1
    `.execute(tx)).rows[0];
    if (!head) return null;

    const firstContact = (await sql<{ at: Date | null }>`
      select min(sent_at) as at from messages where conversation_id = ${conversationId}`.execute(tx)).rows[0]?.at
      ?? head.client_created;

    // Products discussed: identified + everything quoted or ordered here.
    const products = (await sql<{ sku: string | null; name_zh: string | null; name: string | null }>`
      select distinct p.sku, p.name_zh, p.name
        from products p
       where p.id in (
         select cs.identified_product_id from conversation_state cs where cs.conversation_id = ${conversationId} and cs.identified_product_id is not null
         union select q.product_id from quotes q where q.conversation_id = ${conversationId}
         union select o.product_id from orders o where o.conversation_id = ${conversationId})
    `.execute(tx)).rows.map((r) => ({ sku: r.sku, nameZh: r.name_zh ?? r.name ?? '未命名产品' }));

    const latestQuoteRow = (await sql<{ quantity: number; unit_price_usd: string; total_usd: string }>`
      select quantity, unit_price_usd, total_usd from quotes
       where conversation_id = ${conversationId} order by created_at desc limit 1`.execute(tx)).rows[0];

    const orderRow = (await sql<{ status: string; order_reference: string; quantity: number; total_value_usd: string | null }>`
      select status, order_reference, quantity, total_value_usd from orders
       where conversation_id = ${conversationId} order by created_at desc limit 1`.execute(tx)).rows[0];

    // 老板曾修改 — reuse the learning signal: capabilities the owner edited here.
    const corrections = (await sql<{ capability: string }>`
      select distinct capability from drafts
       where conversation_id = ${conversationId} and status = 'edited'`.execute(tx)).rows
      .map((r) => CAPABILITY_ZH[r.capability] ?? r.capability);

    // ── Relationship timeline: a curated union of the real artifacts, in owner
    // language, most recent 40, shown oldest→newest. Technical events hidden.
    const timeline: Milestone[] = [];

    (await sql<{ direction: string; input_type: string; text_content: string | null; sent_at: Date | null }>`
      select direction, input_type, text_content, sent_at from messages
       where conversation_id = ${conversationId} order by sent_at asc limit 60`.execute(tx)).rows.forEach((m) => {
      const at = m.sent_at;
      if (m.direction === 'inbound') {
        const isImg = m.input_type === 'image' || m.input_type === 'image_text';
        timeline.push({ icon: '💬', kind: 'buyer',
          textZh: isImg ? '买家发来产品图片' : `买家：${truncate(m.text_content ?? '', 60)}`, at });
      } else if (m.text_content) {
        timeline.push({ icon: '💠', kind: 'reply', textZh: `小雅回复：${truncate(m.text_content, 60)}`, at });
      }
    });

    (await sql<{ quantity: number; unit_price_usd: string; created_at: Date }>`
      select quantity, unit_price_usd, created_at from quotes where conversation_id = ${conversationId}`.execute(tx)).rows
      .forEach((q) => timeline.push({ icon: '💰', kind: 'quote',
        textZh: `小雅报价：${formatQtyZh(q.quantity)}个 · ${formatUsd(Number(q.unit_price_usd))}/个`, at: q.created_at }));

    (await sql<{ status: string; quantity: number; created_at: Date; confirmed_at: Date | null }>`
      select status, quantity, created_at, confirmed_at from orders where conversation_id = ${conversationId}`.execute(tx)).rows
      .forEach((o) => timeline.push({ icon: '✅', kind: 'order',
        textZh: `订单${ORDER_STATUS_ZH[o.status] ?? o.status}：${formatQtyZh(o.quantity)}个`, at: o.confirmed_at ?? o.created_at }));

    (await sql<{ status: string; decided_at: Date | null }>`
      select status, decided_at from drafts
       where conversation_id = ${conversationId} and status in ('approved','edited','rejected') and decided_at is not null`.execute(tx)).rows
      .forEach((d) => timeline.push({ icon: '👤', kind: 'owner',
        textZh: d.status === 'approved' ? '老板确认发送' : d.status === 'edited' ? '老板修改后发送' : '老板选择这条不回',
        at: d.decided_at }));

    // Only genuinely meaningful events; draft_* internals stay hidden.
    (await sql<{ type: string; created_at: Date }>`
      select type, created_at from conversation_events
       where conversation_id = ${conversationId} and type in ('lead_hot','handoff')`.execute(tx)).rows
      .forEach((e) => timeline.push({ icon: e.type === 'lead_hot' ? '⭐' : '🙋', kind: 'event',
        textZh: e.type === 'lead_hot' ? '买家很有意向' : '转给你亲自处理', at: e.created_at }));

    timeline.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
    const recent = timeline.slice(-40);

    const rel = relationshipOf({
      pending: head.pending, order_status: head.order_status, quote_count: head.quote_count,
      is_active: head.is_active, closed_at: head.closed_at, phase: head.phase,
    });
    const identified = head.name_zh ?? head.name;
    const productsZh = products.length ? products.map((p) => p.nameZh) : identified ? [identified] : [];

    return {
      conversationId: head.id, buyer: head.buyer ?? '买家', country: head.country,
      channelZh: channelZh(head.channel), statusZh: rel.zh, statusTone: rel.tone, needsOwner: rel.needsOwner,
      profile: { firstContact, productsZh, quoteCount: head.quote_count, orderCount: head.order_count },
      timeline: recent,
      context: {
        products,
        latestQuote: latestQuoteRow
          ? { qty: latestQuoteRow.quantity, unitUsd: Number(latestQuoteRow.unit_price_usd), totalUsd: Number(latestQuoteRow.total_usd) }
          : null,
        order: orderRow
          ? { statusZh: ORDER_STATUS_ZH[orderRow.status] ?? orderRow.status, reference: orderRow.order_reference,
              qty: orderRow.quantity, totalUsd: orderRow.total_value_usd !== null ? Number(orderRow.total_value_usd) : null }
          : null,
        corrections,
      },
    };
  });
}

/** ── Renderers (pure, mobile-first, owner language, escaped) ──────────────── */

const statusPill = (zh: string, tone: 'ok' | 'warn' | 'muted'): string =>
  `<span class="pill ${tone}">${tone === 'warn' ? '● ' : ''}${esc(zh)}</span>`;

const who = (buyer: string, country: string | null): string =>
  `${flag(country)} <b>${esc(buyer)}</b>${countryZh(country) ? `<span class="muted"> · ${esc(countryZh(country)!)}</span>` : ''}`;

export function renderCustomerList(list: CustomerList, now: Date): string {
  const search = `<form class="search" method="get" action="/app/conversations" role="search">
      <input type="search" name="q" value="${esc(list.query)}" placeholder="找买家 或 产品…" aria-label="搜索客户" />
      <button class="btn">找</button>${list.query ? `<a class="clear muted" href="/app/conversations">清除</a>` : ''}
    </form>`;

  if (list.customers.length === 0) {
    const body = list.query
      ? `<div class="empty">没找到「${esc(list.query)}」相关的客户。<br><span class="muted">换个名字或产品再试试。</span></div>`
      : `<div class="empty"><div class="ok">✓ 暂无客户记录</div><p class="muted">买家从 WhatsApp 联系后，会自动出现在这里，帮你记住每一位客户。</p></div>`;
    return `<h1 class="page">客户</h1>${search}<div class="card">${body}</div>${CONV_STYLE}`;
  }

  const cards = list.customers.map((c) => `
    <a class="cust ${c.needsOwner ? 'needs' : ''}" href="/app/conversations/${encodeURIComponent(c.conversationId)}">
      <div class="cust-h"><span class="who">${who(c.buyer, c.country)}</span>${statusPill(c.statusZh, c.statusTone)}</div>
      <div class="cust-b muted">${esc(c.channelZh)}${c.productsZh.length ? `　·　${esc(c.productsZh.join('、'))}` : ''}</div>
      <div class="cust-t muted">最后联系：${c.lastActivity ? esc(formatWhenZh(c.lastActivity, now)) : '—'}</div>
    </a>`).join('');

  return `<h1 class="page">客户</h1>${search}<div class="list">${cards}</div>${CONV_STYLE}`;
}

export function renderCustomerFile(f: CustomerFile, now: Date): string {
  const p = f.profile;
  const profileRows = [
    p.firstContact ? `<div class="prow"><span class="muted">首次联系</span><b>${esc(formatDateZh(p.firstContact))}</b></div>` : '',
    p.productsZh.length ? `<div class="prow"><span class="muted">关注产品</span><b>${esc(p.productsZh.join('、'))}</b></div>` : '',
    p.quoteCount > 0 ? `<div class="prow"><span class="muted">报价次数</span><b>${p.quoteCount}</b></div>` : '',
    p.orderCount > 0 ? `<div class="prow"><span class="muted">订单</span><b>${p.orderCount}</b></div>` : '',
  ].filter(Boolean).join('');
  const profile = `<div class="card"><h2>客户档案</h2>
    ${profileRows || `<div class="empty muted">还没有更多资料。</div>`}</div>`;

  const timeline = `<div class="card"><h2>沟通记录</h2>
    ${f.timeline.length
      ? `<ul class="tl">${f.timeline.map((m) => `<li class="tl-${m.kind}"><span class="ic">${m.icon}</span>
          <div><div class="tx">${esc(m.textZh)}</div>${m.at ? `<div class="muted ts">${esc(formatWhenZh(m.at, now))}</div>` : ''}</div></li>`).join('')}</ul>`
      : `<div class="empty muted">还没有沟通记录。</div>`}</div>`;

  const ctx = f.context;
  const ctxParts = [
    ctx.products.length ? `<div class="cx"><div class="cx-l">产品</div><div>${ctx.products.map((pr) =>
      `${esc(pr.nameZh)}${pr.sku ? `<span class="muted"> · ${esc(pr.sku)}</span>` : ''}`).join('<br>')}</div></div>` : '',
    ctx.latestQuote ? `<div class="cx"><div class="cx-l">报价</div><div>${esc(formatQtyZh(ctx.latestQuote.qty))}个 · ${esc(formatUsd(ctx.latestQuote.unitUsd))}/个 · 共 ${esc(formatUsd(ctx.latestQuote.totalUsd))}</div></div>` : '',
    ctx.order ? `<div class="cx"><div class="cx-l">订单</div><div>${esc(ctx.order.reference)} · ${esc(ctx.order.statusZh)}${ctx.order.totalUsd !== null ? ` · ${esc(formatUsd(ctx.order.totalUsd))}` : ''}</div></div>` : '',
    ctx.corrections.length ? `<div class="cx"><div class="cx-l">老板曾修改</div><div>${ctx.corrections.map((c) => esc(c)).join('、')}</div></div>` : '',
  ].filter(Boolean).join('');
  const context = ctxParts ? `<div class="card"><h2>业务往来</h2>${ctxParts}</div>` : '';

  const actLink = f.needsOwner
    ? `<div class="card need-card"><span>这位买家有一条回复等你确认。</span>
        <a class="btn send" href="/app/inbox/${encodeURIComponent(f.conversationId)}">去处理</a></div>`
    : '';

  return `
    <div class="dhead">
      <a class="back" href="/app/conversations" aria-label="返回客户列表">← 客户</a>
      <div class="who">${who(f.buyer, f.country)}</div>
      ${statusPill(f.statusZh, f.statusTone)}
    </div>
    <div class="muted subline">${esc(f.channelZh)}</div>
    ${actLink}
    ${profile}
    ${timeline}
    ${context}
    ${CONV_STYLE}`;
}

const CONV_STYLE = `<style>
  .search { display:flex; gap:8px; align-items:center; margin-bottom:16px; }
  .search input { flex:1; background:#0f1216; border:1px solid #2b313a; border-radius:10px; color:#fff; padding:10px 14px; font:inherit; }
  .search .clear { font-size:13px; }
  .list { display:flex; flex-direction:column; gap:10px; }
  .cust { display:block; background:#14171c; border:1px solid #23272e; border-radius:14px; padding:16px; }
  .cust.needs { border-color:#5a4a1f; background:#181510; }
  .cust:hover { border-color:#3a4250; }
  .cust-h { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .cust-b { font-size:13px; margin-top:6px; } .cust-t { font-size:12px; margin-top:8px; }
  .pill { display:inline-block; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:600; white-space:nowrap; }
  .pill.ok { background:#0f2e1c; color:#4ade80; } .pill.warn { background:#2e2413; color:#fbbf24; } .pill.muted { background:#1b2027; color:#8b929c; }
  .empty { text-align:center; padding:28px 16px; } .ok { color:#4ade80; font-size:17px; font-weight:700; margin-bottom:6px; }
  .dhead { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:6px; }
  .back { color:#60a5fa; font-size:14px; } .dhead .who { font-size:16px; }
  .subline { font-size:13px; margin-bottom:12px; }
  .prow { display:flex; justify-content:space-between; gap:12px; padding:9px 0; border-bottom:1px solid #1c2026; font-size:14px; }
  .prow:last-child { border-bottom:none; }
  .tl { list-style:none; padding:0; margin:0; }
  .tl li { display:flex; gap:12px; padding:11px 0; border-left:2px solid #23272e; margin-left:8px; padding-left:16px; position:relative; }
  .tl li .ic { position:absolute; left:-11px; top:9px; background:#14171c; font-size:15px; line-height:1; }
  .tl .tx { font-size:14px; } .tl .ts { font-size:12px; margin-top:3px; }
  .tl-owner .tx { color:#c9b884; } .tl-order .tx { color:#4ade80; } .tl-quote .tx { color:#93c5fd; }
  .cx { display:flex; gap:14px; padding:10px 0; border-bottom:1px solid #1c2026; font-size:14px; }
  .cx:last-child { border-bottom:none; } .cx-l { color:#8b929c; min-width:72px; }
  .need-card { display:flex; align-items:center; justify-content:space-between; gap:12px; border-color:#5a4a1f; font-size:14px; }
  .btn { padding:8px 16px; border:0; border-radius:9px; background:#2a313c; color:#fff; font-size:14px; font-weight:600; cursor:pointer; }
  .btn.send { background:#2563eb; }
  a:focus-visible, button:focus-visible, input:focus-visible { outline:2px solid #60a5fa; outline-offset:2px; }
  @media (max-width:560px) { .cust, .card { border-radius:12px; } }
</style>`;
