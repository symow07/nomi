import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, countryName, orderStatusName, capabilityName, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatUsd, formatQty, formatRelative, formatDate } from '../../core/owner/i18n/format.js';
import { flag } from './inbox.js';
import { esc, deeper, back } from './layout.js';

/**
 * M9.7 + ADR-0008 — Conversations / customer memory. NOT a chat viewer and NOT a
 * second inbox. A read model over existing activity; the read model is
 * language-NEUTRAL (status/phase codes, milestone kinds, capability codes, raw
 * names); the renderer localizes. Actions live in the Inbox.
 */

type Tone = 'ok' | 'warn' | 'muted';
type RelStatus =
  | { readonly t: 'awaiting' } | { readonly t: 'order'; readonly s: string } | { readonly t: 'closed' }
  | { readonly t: 'quoted' } | { readonly t: 'phase'; readonly s: string } | { readonly t: 'talking' };

const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const productName = (locale: Locale, p: { name: string | null; nameZh: string | null }): string | null =>
  locale === 'zh' ? (p.nameZh ?? p.name) : (p.name ?? p.nameZh);
const channelName = (locale: Locale, c: string): string =>
  c === 'whatsapp' ? 'WhatsApp' : c === 'instagram' ? 'Instagram' : t(locale, `conv.channel.${c}` as MessageKey);

function relationshipOf(row: {
  pending: number; order_status: string | null; quote_count: number;
  is_active: boolean; closed_at: Date | null; phase: string;
}): { status: RelStatus; tone: Tone; needsOwner: boolean } {
  if (row.pending > 0) return { status: { t: 'awaiting' }, tone: 'warn', needsOwner: true };
  if (row.order_status) return { status: { t: 'order', s: row.order_status }, tone: row.order_status === 'cancelled' ? 'muted' : 'ok', needsOwner: false };
  if (row.closed_at !== null) return { status: { t: 'closed' }, tone: 'muted', needsOwner: false };
  if (row.quote_count > 0) return { status: { t: 'quoted' }, tone: 'ok', needsOwner: false };
  if (row.is_active) return { status: { t: 'phase', s: row.phase }, tone: 'ok', needsOwner: false };
  return { status: { t: 'closed' }, tone: 'muted', needsOwner: false };
}

function relLabel(locale: Locale, s: RelStatus): string {
  switch (s.t) {
    case 'awaiting': return t(locale, 'conv.status.awaiting');
    case 'order': return orderStatusName(locale, s.s);
    case 'closed': return t(locale, 'conv.status.closed');
    case 'quoted': return t(locale, 'conv.status.quoted');
    case 'talking': return t(locale, 'conv.status.talking');
    case 'phase': return t(locale, `conv.phase.${s.s}` as MessageKey);
  }
}

/** ── Section 1: customer list ─────────────────────────────────────────────── */

export type CustomerCard = {
  readonly conversationId: string;
  readonly buyer: string | null;
  readonly country: string | null;
  readonly channel: string;
  readonly status: RelStatus;
  readonly statusTone: Tone;
  readonly needsOwner: boolean;
  readonly product: { readonly name: string | null; readonly nameZh: string | null } | null;
  readonly lastActivity: Date | null;
};

export type CustomerList = { readonly query: string; readonly customers: readonly CustomerCard[] };

export async function loadCustomerList(db: Db, businessIdRaw: string, query: string): Promise<CustomerList> {
  const q = query.trim();
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { query: q, customers: [] };
  const like = q ? `%${q}%` : null;

  return withTenantTx(db, bid.value, async (tx) => {
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
      return {
        conversationId: r.id, buyer: r.buyer, country: r.country, channel: r.channel,
        status: rel.status, statusTone: rel.tone, needsOwner: rel.needsOwner,
        product: (r.name || r.name_zh) ? { name: r.name, nameZh: r.name_zh } : null,
        lastActivity: r.last_activity,
      };
    });
    return { query: q, customers };
  });
}

/** ── Sections 2–4: the customer file ──────────────────────────────────────── */

type MilestoneKind =
  | 'buyer_text' | 'buyer_image' | 'reply' | 'quote' | 'order'
  | 'owner_approved' | 'owner_edited' | 'owner_skipped' | 'lead_hot' | 'handoff';

export type Milestone = {
  readonly kind: MilestoneKind;
  readonly at: Date | null;
  readonly text: string | null;
  readonly qty: number | null;
  readonly unitUsd: number | null;
  readonly orderStatus: string | null;
};

export type CustomerFile = {
  readonly conversationId: string;
  readonly buyer: string | null;
  readonly country: string | null;
  readonly channel: string;
  readonly status: RelStatus;
  readonly statusTone: Tone;
  readonly needsOwner: boolean;
  readonly profile: {
    readonly firstContact: Date | null;
    readonly products: readonly { readonly name: string | null; readonly nameZh: string | null }[];
    readonly quoteCount: number;
    readonly orderCount: number;
  };
  readonly timeline: readonly Milestone[];
  readonly context: {
    readonly products: readonly { readonly sku: string | null; readonly name: string | null; readonly nameZh: string | null }[];
    readonly latestQuote: { readonly qty: number; readonly unitUsd: number; readonly totalUsd: number } | null;
    readonly order: { readonly status: string; readonly reference: string; readonly qty: number; readonly totalUsd: number | null } | null;
    readonly corrections: readonly string[];   // capability codes
  };
};

const mile = (kind: MilestoneKind, at: Date | null, extra: Partial<Milestone> = {}): Milestone =>
  ({ kind, at, text: null, qty: null, unitUsd: null, orderStatus: null, ...extra });

export async function loadCustomerFile(db: Db, businessIdRaw: string, conversationId: string): Promise<CustomerFile | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;

  return withTenantTx(db, bid.value, async (tx) => {
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

    const products = (await sql<{ sku: string | null; name_zh: string | null; name: string | null }>`
      select distinct p.sku, p.name_zh, p.name
        from products p
       where p.id in (
         select cs.identified_product_id from conversation_state cs where cs.conversation_id = ${conversationId} and cs.identified_product_id is not null
         union select q.product_id from quotes q where q.conversation_id = ${conversationId}
         union select o.product_id from orders o where o.conversation_id = ${conversationId})
    `.execute(tx)).rows.map((r) => ({ sku: r.sku, name: r.name, nameZh: r.name_zh }));

    const latestQuoteRow = (await sql<{ quantity: number; unit_price_usd: string; total_usd: string }>`
      select quantity, unit_price_usd, total_usd from quotes
       where conversation_id = ${conversationId} order by created_at desc limit 1`.execute(tx)).rows[0];

    const orderRow = (await sql<{ status: string; order_reference: string; quantity: number; total_value_usd: string | null }>`
      select status, order_reference, quantity, total_value_usd from orders
       where conversation_id = ${conversationId} order by created_at desc limit 1`.execute(tx)).rows[0];

    const corrections = (await sql<{ capability: string }>`
      select distinct capability from drafts
       where conversation_id = ${conversationId} and status = 'edited'`.execute(tx)).rows.map((r) => r.capability);

    // Relationship timeline — neutral milestone kinds; renderer localizes.
    const timeline: Milestone[] = [];

    (await sql<{ direction: string; input_type: string; text_content: string | null; sent_at: Date | null }>`
      select direction, input_type, text_content, sent_at from messages
       where conversation_id = ${conversationId} order by sent_at asc limit 60`.execute(tx)).rows.forEach((m) => {
      if (m.direction === 'inbound') {
        const isImg = m.input_type === 'image' || m.input_type === 'image_text';
        timeline.push(isImg ? mile('buyer_image', m.sent_at) : mile('buyer_text', m.sent_at, { text: truncate(m.text_content ?? '', 60) }));
      } else if (m.text_content) {
        timeline.push(mile('reply', m.sent_at, { text: truncate(m.text_content, 60) }));
      }
    });

    (await sql<{ quantity: number; unit_price_usd: string; created_at: Date }>`
      select quantity, unit_price_usd, created_at from quotes where conversation_id = ${conversationId}`.execute(tx)).rows
      .forEach((q) => timeline.push(mile('quote', q.created_at, { qty: q.quantity, unitUsd: Number(q.unit_price_usd) })));

    (await sql<{ status: string; quantity: number; created_at: Date; confirmed_at: Date | null }>`
      select status, quantity, created_at, confirmed_at from orders where conversation_id = ${conversationId}`.execute(tx)).rows
      .forEach((o) => timeline.push(mile('order', o.confirmed_at ?? o.created_at, { orderStatus: o.status, qty: o.quantity })));

    (await sql<{ status: string; decided_at: Date | null }>`
      select status, decided_at from drafts
       where conversation_id = ${conversationId} and status in ('approved','edited','rejected') and decided_at is not null`.execute(tx)).rows
      .forEach((d) => timeline.push(mile(d.status === 'approved' ? 'owner_approved' : d.status === 'edited' ? 'owner_edited' : 'owner_skipped', d.decided_at)));

    (await sql<{ type: string; created_at: Date }>`
      select type, created_at from conversation_events
       where conversation_id = ${conversationId} and type in ('lead_hot','handoff')`.execute(tx)).rows
      .forEach((e) => timeline.push(mile(e.type === 'lead_hot' ? 'lead_hot' : 'handoff', e.created_at)));

    timeline.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
    const recent = timeline.slice(-40);

    const rel = relationshipOf({
      pending: head.pending, order_status: head.order_status, quote_count: head.quote_count,
      is_active: head.is_active, closed_at: head.closed_at, phase: head.phase,
    });
    const identified = (head.name || head.name_zh) ? [{ name: head.name, nameZh: head.name_zh }] : [];
    const profileProducts = products.length ? products.map((p) => ({ name: p.name, nameZh: p.nameZh })) : identified;

    return {
      conversationId: head.id, buyer: head.buyer, country: head.country, channel: head.channel,
      status: rel.status, statusTone: rel.tone, needsOwner: rel.needsOwner,
      profile: { firstContact, products: profileProducts, quoteCount: head.quote_count, orderCount: head.order_count },
      timeline: recent,
      context: {
        products,
        latestQuote: latestQuoteRow
          ? { qty: latestQuoteRow.quantity, unitUsd: Number(latestQuoteRow.unit_price_usd), totalUsd: Number(latestQuoteRow.total_usd) }
          : null,
        order: orderRow
          ? { status: orderRow.status, reference: orderRow.order_reference, qty: orderRow.quantity, totalUsd: orderRow.total_value_usd !== null ? Number(orderRow.total_value_usd) : null }
          : null,
        corrections,
      },
    };
  });
}

/** ── Renderers (pure, mobile-first, localized, escaped) ───────────────────── */

const TL_ICON: Record<MilestoneKind, string> = {
  buyer_text: '💬', buyer_image: '💬', reply: '💠', quote: '💰', order: '✅',
  owner_approved: '👤', owner_edited: '👤', owner_skipped: '👤', lead_hot: '⭐', handoff: '🙋',
};
const TL_CLASS: Record<MilestoneKind, string> = {
  buyer_text: 'buyer', buyer_image: 'buyer', reply: 'reply', quote: 'quote', order: 'order',
  owner_approved: 'owner', owner_edited: 'owner', owner_skipped: 'owner', lead_hot: 'event', handoff: 'event',
};

const statusPill = (label: string, tone: Tone): string =>
  `<span class="pill ${tone}">${tone === 'warn' ? '● ' : ''}${esc(label)}</span>`;

const who = (locale: Locale, buyer: string | null, country: string | null): string => {
  const name = buyer ?? t(locale, 'common.buyer');
  const cn = countryName(locale, country);
  return `${flag(country)} <b>${esc(name)}</b>${cn ? `<span class="muted"> · ${esc(cn)}</span>` : ''}`;
};

export function renderCustomerList(list: CustomerList, locale: Locale, now: Date): string {
  const title = `<h1 class="page">${esc(t(locale, 'conv.title'))}</h1>`;
  const search = `<form class="search" method="get" action="/app/conversations" role="search">
      <input type="search" name="q" value="${esc(list.query)}" placeholder="${esc(t(locale, 'conv.search.placeholder'))}" aria-label="${esc(t(locale, 'conv.title'))}" />
      <button class="btn">${esc(t(locale, 'conv.search.go'))}</button>${list.query ? `<a class="clear muted" href="/app/conversations">${esc(t(locale, 'conv.search.clear'))}</a>` : ''}
    </form>`;

  if (list.customers.length === 0) {
    const body = list.query
      ? `<div class="empty">${esc(t(locale, 'conv.empty.noMatch', { q: list.query }))}<br><span class="muted">${esc(t(locale, 'conv.empty.noMatchBody'))}</span></div>`
      // Phase F: no ✓ here — zero customers is not an achievement. State it
      //          plainly and offer the one thing that changes it.
      : `<div class="empty"><div class="big">${esc(t(locale, 'conv.empty.noneTitle'))}</div>
         <p class="muted">${esc(t(locale, 'conv.empty.noneBody'))}</p>
         ${deeper('/app/factory', t(locale, 'inbox.empty.setup'))}</div>`;
    return `${title}${search}<div class="card">${body}</div>${CONV_STYLE}`;
  }

  const cards = list.customers.map((c) => {
    const prod = c.product ? productName(locale, c.product) : null;
    return `
    <a class="cust ${c.needsOwner ? 'needs' : ''}" href="/app/conversations/${encodeURIComponent(c.conversationId)}">
      <div class="cust-h"><span class="who">${who(locale, c.buyer, c.country)}</span>${statusPill(relLabel(locale, c.status), c.statusTone)}</div>
      <div class="cust-b muted">${esc(channelName(locale, c.channel))}${prod ? `　·　${esc(prod)}` : ''}</div>
      <div class="cust-t muted">${esc(t(locale, 'conv.lastContact'))}：${c.lastActivity ? esc(formatRelative(locale, c.lastActivity, now)) : '—'}</div>
    </a>`;
  }).join('');

  return `${title}${search}<div class="list">${cards}</div>${CONV_STYLE}`;
}

function milestoneText(locale: Locale, m: Milestone): string {
  const name = EMPLOYEE_NAME[locale];
  const pcs = t(locale, 'product.unit.pcs');
  switch (m.kind) {
    case 'buyer_text': return t(locale, 'conv.tl.buyer_text', { text: m.text ?? '' });
    case 'buyer_image': return t(locale, 'conv.tl.buyer_image');
    case 'reply': return t(locale, 'conv.tl.reply', { name, text: m.text ?? '' });
    case 'quote': return t(locale, 'conv.tl.quote', { name, detail: `${formatQty(locale, m.qty ?? 0)}${pcs} · ${formatUsd(m.unitUsd ?? 0)}/${pcs}` });
    case 'order': return t(locale, 'conv.tl.order', { status: orderStatusName(locale, m.orderStatus ?? ''), qty: `${formatQty(locale, m.qty ?? 0)}${pcs}` });
    default: return t(locale, `conv.tl.${m.kind}` as MessageKey);
  }
}

export function renderCustomerFile(f: CustomerFile, locale: Locale, now: Date): string {
  const p = f.profile;
  const pcs = t(locale, 'product.unit.pcs');
  const productsLabel = p.products.map((pr) => productName(locale, pr)).filter(Boolean).join('、');
  const profileRows = [
    p.firstContact ? `<div class="prow"><span class="muted">${esc(t(locale, 'conv.file.firstContact'))}</span><b>${esc(formatDate(locale, p.firstContact))}</b></div>` : '',
    productsLabel ? `<div class="prow"><span class="muted">${esc(t(locale, 'conv.file.products'))}</span><b>${esc(productsLabel)}</b></div>` : '',
    p.quoteCount > 0 ? `<div class="prow"><span class="muted">${esc(t(locale, 'conv.file.quoteCount'))}</span><b>${p.quoteCount}</b></div>` : '',
    p.orderCount > 0 ? `<div class="prow"><span class="muted">${esc(t(locale, 'conv.file.orderCount'))}</span><b>${p.orderCount}</b></div>` : '',
  ].filter(Boolean).join('');
  const profile = `<div class="card"><h2>${esc(t(locale, 'conv.file.title'))}</h2>
    ${profileRows || `<div class="empty muted">${esc(t(locale, 'conv.file.noMore'))}</div>`}</div>`;

  const timeline = `<div class="card"><h2>${esc(t(locale, 'conv.tl.title'))}</h2>
    ${f.timeline.length
      ? `<ul class="tl">${f.timeline.map((m) => `<li class="tl-${TL_CLASS[m.kind]}"><span class="ic">${TL_ICON[m.kind]}</span>
          <div><div class="tx">${esc(milestoneText(locale, m))}</div>${m.at ? `<div class="muted ts">${esc(formatRelative(locale, m.at, now))}</div>` : ''}</div></li>`).join('')}</ul>`
      : `<div class="empty muted">${esc(t(locale, 'conv.tl.empty'))}</div>`}</div>`;

  const ctx = f.context;
  const ctxParts = [
    ctx.products.length ? `<div class="cx"><div class="cx-l">${esc(t(locale, 'conv.ctx.products'))}</div><div>${ctx.products.map((pr) =>
      `${esc(productName(locale, pr) ?? t(locale, 'conv.unnamed'))}${pr.sku ? `<span class="muted"> · ${esc(pr.sku)}</span>` : ''}`).join('<br>')}</div></div>` : '',
    ctx.latestQuote ? `<div class="cx"><div class="cx-l">${esc(t(locale, 'conv.ctx.quote'))}</div><div>${esc(formatQty(locale, ctx.latestQuote.qty))}${esc(pcs)} · ${esc(formatUsd(ctx.latestQuote.unitUsd))}/${esc(pcs)} · ${esc(t(locale, 'product.detail.total'))} ${esc(formatUsd(ctx.latestQuote.totalUsd))}</div></div>` : '',
    ctx.order ? `<div class="cx"><div class="cx-l">${esc(t(locale, 'conv.ctx.order'))}</div><div>${esc(ctx.order.reference)} · ${esc(orderStatusName(locale, ctx.order.status))}${ctx.order.totalUsd !== null ? ` · ${esc(formatUsd(ctx.order.totalUsd))}` : ''}</div></div>` : '',
    ctx.corrections.length ? `<div class="cx"><div class="cx-l">${esc(t(locale, 'conv.ctx.corrections'))}</div><div>${ctx.corrections.map((c) => esc(capabilityName(locale, c))).join('、')}</div></div>` : '',
  ].filter(Boolean).join('');
  const context = ctxParts ? `<div class="card"><h2>${esc(t(locale, 'conv.ctx.title'))}</h2>${ctxParts}</div>` : '';

  const actLink = f.needsOwner
    ? `<div class="card need-card"><span>${esc(t(locale, 'conv.needCard'))}</span>
        <a class="btn send" href="/app/inbox/${encodeURIComponent(f.conversationId)}">${esc(t(locale, 'conv.needCardCta'))}</a></div>`
    : '';

  return `
    <div class="dhead">
      ${back('/app/conversations', t(locale, 'conv.back'))}
      <div class="who">${who(locale, f.buyer, f.country)}</div>
      ${statusPill(relLabel(locale, f.status), f.statusTone)}
    </div>
    <div class="muted subline">${esc(channelName(locale, f.channel))}</div>
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
  .cust { display:block; background:#14171c; border:1px solid #23272e; border-radius:14px; padding:16px; }
  .cust.needs { border-color:#5a4a1f; background:#181510; }
  .cust:hover { border-color:#3a4250; }
  .cust-h { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .cust-b { font-size:13px; margin-top:6px; } .cust-t { font-size:12px; margin-top:8px; }
  .pill.muted { background:#1b2027; color:#8b929c; }
  .ok { color:#4ade80; font-size:17px; font-weight:700; margin-bottom:6px; }
  .dhead { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:6px; }
  .dhead .who { font-size:15px; }
  .subline { font-size:13px; margin-bottom:12px; }
  .prow { display:flex; justify-content:space-between; gap:12px; padding:9px 0; border-bottom:1px solid #1c2026; font-size:14px; }
  .prow:last-child { border-bottom:none; }
  .tl { list-style:none; padding:0; margin:0; }
  .tl li { display:flex; gap:12px; padding:11px 0; border-inline-start:2px solid #23272e; margin-inline-start:8px; padding-inline-start:16px; position:relative; }
  .tl li .ic { position:absolute; inset-inline-start:-11px; top:9px; background:#14171c; font-size:15px; line-height:1; }
  .tl .tx { font-size:14px; } .tl .ts { font-size:12px; margin-top:3px; }
  .tl-owner .tx { color:#c9b884; } .tl-order .tx { color:#4ade80; } .tl-quote .tx { color:#93c5fd; }
  .cx { display:flex; gap:14px; padding:10px 0; border-bottom:1px solid #1c2026; font-size:14px; }
  .cx:last-child { border-bottom:none; } .cx-l { color:#8b929c; min-width:72px; }
  .need-card { display:flex; align-items:center; justify-content:space-between; gap:12px; border-color:#5a4a1f; font-size:14px; }
  @media (max-width:560px) { .cust, .card { border-radius:12px; } }
</style>`;
