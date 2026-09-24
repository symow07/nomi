import { sql } from 'kysely';
import { type Money, moneyFromRow } from '../../core/types/money.js';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { countryName, orderStatusName, capabilityName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName, outreachShown } from './say.js';
import { formatMoney, formatQty, formatRelative, formatDate } from '../../core/owner/i18n/format.js';
import { flag } from './inbox.js';
import { esc, deeper, back } from './layout.js';
import { flashBanner, type Flash } from './flash.js';

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
/**
 * D3 — every channel a conversation can be on has a name in the catalogue, and
 * this reads it. Two had none (`email`, `messenger`) and two were spelled out
 * here instead, so the page printed `conv.channel.email` at the owner as though
 * it were a word.
 */
export const channelName = (locale: Locale, c: string): string => t(locale, `conv.channel.${c}` as MessageKey);

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
  readonly unitPrice: Money | null;
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
    readonly latestQuote: { readonly qty: number; readonly unitPrice: Money; readonly total: Money } | null;
    /** G4 — `id` so the profile can open the order; optional for fixtures. */
    readonly order: { readonly id?: string; readonly status: string; readonly reference: string; readonly qty: number; readonly total: Money | null } | null;
    readonly corrections: readonly string[];   // capability codes
  };
};

const mile = (kind: MilestoneKind, at: Date | null, extra: Partial<Milestone> = {}): Milestone =>
  ({ kind, at, text: null, qty: null, unitPrice: null, orderStatus: null, ...extra });

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

    const latestQuoteRow = (await sql<{ quantity: number; unit_price_usd: string; total_usd: string; currency: string }>`
      select quantity, unit_price_usd, total_usd, currency from quotes
       where conversation_id = ${conversationId} order by created_at desc limit 1`.execute(tx)).rows[0];

    // G4 — the buyer's latest order, wherever it was confirmed: confirming
    // closes a conversation, so the order he asks about later lives in an
    // earlier one.
    const orderRow = (await sql<{ id: string; status: string; order_reference: string; quantity: number; total_value_usd: string | null; currency: string }>`
      select o.id::text as id, o.status, o.order_reference, o.quantity, o.total_value_usd, o.currency from orders o
       where o.client_id = (select client_id from conversations where id = ${conversationId})
       order by o.created_at desc limit 1`.execute(tx)).rows[0];

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

    (await sql<{ quantity: number; unit_price_usd: string; currency: string; created_at: Date }>`
      select quantity, unit_price_usd, currency, created_at from quotes where conversation_id = ${conversationId}`.execute(tx)).rows
      .forEach((q) => timeline.push(mile('quote', q.created_at, { qty: q.quantity, unitPrice: moneyFromRow(Number(q.unit_price_usd), q.currency) })));

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
    // G18 — the quote in its own currency; nothing shown if it is one this
    // build cannot price, rather than a dollar sign over a number that is not.
    const latestQuoteUnit = latestQuoteRow ? moneyFromRow(Number(latestQuoteRow.unit_price_usd), latestQuoteRow.currency) : null;
    const latestQuoteTotal = latestQuoteRow ? moneyFromRow(Number(latestQuoteRow.total_usd), latestQuoteRow.currency) : null;
    const identified = (head.name || head.name_zh) ? [{ name: head.name, nameZh: head.name_zh }] : [];
    const profileProducts = products.length ? products.map((p) => ({ name: p.name, nameZh: p.nameZh })) : identified;

    return {
      conversationId: head.id, buyer: head.buyer, country: head.country, channel: head.channel,
      status: rel.status, statusTone: rel.tone, needsOwner: rel.needsOwner,
      profile: { firstContact, products: profileProducts, quoteCount: head.quote_count, orderCount: head.order_count },
      timeline: recent,
      context: {
        products,
        latestQuote: latestQuoteUnit && latestQuoteTotal && latestQuoteRow
          ? { qty: latestQuoteRow.quantity, unitPrice: latestQuoteUnit, total: latestQuoteTotal }
          : null,
        order: orderRow
          ? { id: orderRow.id, status: orderRow.status, reference: orderRow.order_reference, qty: orderRow.quantity,
              // G18 — his order in the currency it was taken in.
              total: orderRow.total_value_usd !== null ? moneyFromRow(Number(orderRow.total_value_usd), orderRow.currency) : null }
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

  // M38 — the wider list: everyone the assistant may write to, not only who
  // wrote in. D — a door only where the outreach area exists.
  const toContacts = outreachShown() ? deeper('/app/contacts', t(locale, 'contacts.title')) : '';

  if (list.customers.length === 0) {
    const body = list.query
      ? `<div class="empty">${esc(t(locale, 'conv.empty.noMatch', { q: list.query }))}<br><span class="muted">${esc(t(locale, 'conv.empty.noMatchBody'))}</span></div>`
      // Phase F: no ✓ here — zero customers is not an achievement. State it
      //          plainly and offer the one thing that changes it.
      : `<div class="empty"><div class="big">${esc(t(locale, 'conv.empty.noneTitle'))}</div>
         <p class="muted">${esc(t(locale, 'conv.empty.noneBody'))}</p>
         ${deeper('/app/factory', t(locale, 'inbox.empty.setup'))}</div>`;
    return `${title}${search}<div class="block">${body}${toContacts}</div>${CONV_STYLE}`;
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

  return `${title}${search}<div class="list">${cards}</div>${toContacts}${CONV_STYLE}`;
}

function milestoneText(locale: Locale, m: Milestone): string {
  const name = assistantName(locale);
  const pcs = t(locale, 'product.unit.pcs');
  switch (m.kind) {
    case 'buyer_text': return t(locale, 'conv.tl.buyer_text', { text: m.text ?? '' });
    case 'buyer_image': return t(locale, 'conv.tl.buyer_image');
    case 'reply': return t(locale, 'conv.tl.reply', { name, text: m.text ?? '' });
    case 'quote': return t(locale, 'conv.tl.quote', { name, detail: `${formatQty(locale, m.qty ?? 0)}${pcs} · ${m.unitPrice ? formatMoney(m.unitPrice) : '—'}/${pcs}` });
    case 'order': return t(locale, 'conv.tl.order', { status: orderStatusName(locale, m.orderStatus ?? ''), qty: `${formatQty(locale, m.qty ?? 0)}${pcs}` });
    default: return t(locale, `conv.tl.${m.kind}` as MessageKey);
  }
}

/**
 * What she calls him. The channel's name fills the blank when a conversation
 * begins (WhatsApp sends one; Instagram and the Page are asked, see
 * `nameOf`); this is where she corrects it, or names a buyer no channel could.
 * Empty clears it, and he is "Buyer" again — an honest blank, never a
 * placeholder pretending to be a name. The change is on the conversation's
 * own record with who made it.
 */
export async function renameBuyer(
  db: Db, businessIdRaw: string, conversationId: string, rawName: string, by: string,
): Promise<'saved' | 'cleared' | 'invalid' | 'not_found'> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok || !/^[0-9a-f-]{36}$/i.test(conversationId)) return 'not_found';
  const name = rawName.replace(/\s+/g, ' ').trim();
  if (name.length > 80) return 'invalid';
  return withTenantTx(db, bid.value, async (tx) => {
    const row = (await sql<{ client_id: string; display_name: string | null }>`
      select c.client_id, cl.display_name from conversations c
        join clients cl on cl.id = c.client_id
       where c.id = ${conversationId} limit 1`.execute(tx)).rows[0];
    if (!row) return 'not_found';
    await sql`update clients set display_name = ${name || null} where id = ${row.client_id}`.execute(tx);
    await sql`
      insert into conversation_events (business_id, conversation_id, type, payload)
      values (${bid.value}, ${conversationId}, 'buyer_renamed',
              ${JSON.stringify({ from: row.display_name, to: name || null, by })}::jsonb)`.execute(tx);
    return name ? 'saved' : 'cleared';
  });
}

export function renderCustomerFile(f: CustomerFile, locale: Locale, now: Date, flash: Flash | null = null): string {
  const p = f.profile;
  const pcs = t(locale, 'product.unit.pcs');
  const productsLabel = p.products.map((pr) => productName(locale, pr)).filter(Boolean).join('、');
  const profileRows = [
    p.firstContact ? `<div class="prow"><span class="muted">${esc(t(locale, 'conv.file.firstContact'))}</span><b>${esc(formatDate(locale, p.firstContact))}</b></div>` : '',
    productsLabel ? `<div class="prow"><span class="muted">${esc(t(locale, 'conv.file.products'))}</span><b>${esc(productsLabel)}</b></div>` : '',
    p.quoteCount > 0 ? `<div class="prow"><span class="muted">${esc(t(locale, 'conv.file.quoteCount'))}</span><b>${p.quoteCount}</b></div>` : '',
    p.orderCount > 0 ? `<div class="prow"><span class="muted">${esc(t(locale, 'conv.file.orderCount'))}</span><b>${p.orderCount}</b></div>` : '',
  ].filter(Boolean).join('');
  const nameForm = `<form method="post" action="/app/conversations/${encodeURIComponent(f.conversationId)}/name" class="name-form">
      <label for="buyer-name">${esc(t(locale, 'conv.file.name'))}</label>
      <div class="name-row">
        <input id="buyer-name" name="name" maxlength="80" value="${esc(f.buyer ?? '')}" placeholder="${esc(t(locale, 'common.buyer'))}">
        <button class="btn" type="submit">${esc(t(locale, 'conv.file.nameSave'))}</button>
      </div>
      <div class="muted hint">${esc(t(locale, 'conv.file.nameHint', { buyer: t(locale, 'common.buyer') }))}</div>
    </form>`;
  const profile = `<div class="block"><h2>${esc(t(locale, 'conv.file.title'))}</h2>
    ${nameForm}
    ${profileRows || `<div class="empty muted">${esc(t(locale, 'conv.file.noMore'))}</div>`}</div>`;

  const timeline = `<div class="block"><h2>${esc(t(locale, 'conv.tl.title'))}</h2>
    ${f.timeline.length
      ? `<ul class="tl">${f.timeline.map((m) => `<li class="tl-${TL_CLASS[m.kind]}"><span class="ic">${TL_ICON[m.kind]}</span>
          <div><div class="tx">${esc(milestoneText(locale, m))}</div>${m.at ? `<div class="muted ts">${esc(formatRelative(locale, m.at, now))}</div>` : ''}</div></li>`).join('')}</ul>`
      : `<div class="empty muted">${esc(t(locale, 'conv.tl.empty'))}</div>`}</div>`;

  const ctx = f.context;
  const ctxParts = [
    ctx.products.length ? `<div class="cx"><div class="cx-l">${esc(t(locale, 'conv.ctx.products'))}</div><div>${ctx.products.map((pr) =>
      `${esc(productName(locale, pr) ?? t(locale, 'conv.unnamed'))}${pr.sku ? `<span class="muted"> · ${esc(pr.sku)}</span>` : ''}`).join('<br>')}</div></div>` : '',
    ctx.latestQuote ? `<div class="cx"><div class="cx-l">${esc(t(locale, 'conv.ctx.quote'))}</div><div>${esc(formatQty(locale, ctx.latestQuote.qty))}${esc(pcs)} · ${esc(formatMoney(ctx.latestQuote.unitPrice))}/${esc(pcs)} · ${esc(t(locale, 'product.detail.total'))} ${esc(formatMoney(ctx.latestQuote.total))}</div></div>` : '',
    ctx.order ? `<div class="cx"><div class="cx-l">${esc(t(locale, 'conv.ctx.order'))}</div><div>${
      // G4 — the reference opens the order, so what she tells a buyer who asks
      // after it is one tap away.
      ctx.order.id ? `<a href="/app/orders/${encodeURIComponent(ctx.order.id)}">${esc(ctx.order.reference)}</a>` : esc(ctx.order.reference)
    } · ${esc(orderStatusName(locale, ctx.order.status))}${ctx.order.total !== null ? ` · ${esc(formatMoney(ctx.order.total))}` : ''}</div></div>` : '',
    ctx.corrections.length ? `<div class="cx"><div class="cx-l">${esc(t(locale, 'conv.ctx.corrections'))}</div><div>${ctx.corrections.map((c) => esc(capabilityName(locale, c))).join('、')}</div></div>` : '',
  ].filter(Boolean).join('');
  const context = ctxParts ? `<div class="block"><h2>${esc(t(locale, 'conv.ctx.title'))}</h2>${ctxParts}</div>` : '';

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
    ${flashBanner(flash)}
    ${actLink}
    ${profile}
    ${timeline}
    ${context}
    ${CONV_STYLE}`;
}

const CONV_STYLE = `<style>
  .search { display:flex; gap:var(--space-8); align-items:center; margin-bottom:var(--space-16); }
  .search input { flex:1; background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:10px 14px; font:inherit; }
  .search .clear { font-size:var(--font-size-caption); }
  .cust { display:block; background:var(--color-surface); border:1px solid var(--color-border); border-radius:14px; padding:16px; }
  .cust.needs { border-color:var(--color-waiting-line); background:var(--color-highlight-wash); }
  .cust:hover { border-color:var(--color-border); }
  .cust-h { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); }
  .cust-b { font-size:var(--font-size-caption); margin-top:var(--space-8); } .cust-t { font-size:var(--font-size-caption); margin-top:var(--space-8); }
  .pill.muted { background:var(--color-paper-sunk); color:var(--color-ink-secondary); }


  .dhead .who { font-size:var(--font-size-small); }

  .name-form { margin-bottom:var(--space-12); padding-bottom:var(--space-12); border-bottom:1px solid var(--color-border); }
  .name-form label { display:block; font-size:var(--font-size-caption); color:var(--color-ink-secondary); margin-bottom:var(--space-4); }
  .name-row { display:flex; gap:var(--space-8); align-items:center; }
  .name-row input { flex:1; min-width:0; background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:10px 14px; font:inherit; }
  .name-form .hint { font-size:var(--font-size-caption); margin-top:var(--space-4); }
  .prow { display:flex; justify-content:space-between; gap:var(--space-12); padding:9px 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); }
  .prow:last-child { border-bottom:none; }
  .tl { list-style:none; padding:0; margin:0; }
  .tl li { display:flex; gap:var(--space-12); padding:11px 0; border-inline-start:2px solid var(--color-border); margin-inline-start:var(--space-8); padding-inline-start:16px; position:relative; }
  .tl li .ic { position:absolute; inset-inline-start:-11px; top:9px; background:var(--color-surface); font-size:var(--font-size-small); line-height:1; }
  .tl .tx { font-size:var(--font-size-small); } .tl .ts { font-size:var(--font-size-caption); margin-top:var(--space-4); }
  /* Event TYPES are told apart by their icons; colouring the text per type was
     colour carrying no state. The page's one state colour is the status pill. */
  .cx { display:flex; gap:var(--space-12); padding:10px 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); }
  .cx:last-child { border-bottom:none; } .cx-l { color:var(--color-ink-secondary); min-width:72px; }
  .need-card { display:flex; align-items:center; justify-content:space-between; gap:var(--space-12); border-color:var(--color-waiting-line); font-size:var(--font-size-small); }
  @media (max-width:560px) { .cust { border-radius:12px; } }
</style>`;
