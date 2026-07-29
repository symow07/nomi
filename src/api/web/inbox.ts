import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, countryName, orderStatusName, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatUsd, formatQty, formatRelative } from '../../core/owner/i18n/format.js';
import { esc } from './layout.js';

/**
 * M9.3 + ADR-0008 — the owner's decision desk. A VIEW over existing data;
 * actions POST to applyOwnerCommand (the one approval path). The read model is
 * language-NEUTRAL (status codes, product names as data); the renderer localizes.
 * The draft-action button VALUES stay the wire commands (发送/改/不回/收回) that
 * parseOwnerReply expects — only the labels localize.
 */

// Flags are emoji, not localizable — shared with conversations.
export const FLAG: Record<string, string> = {
  AE: '🇦🇪', SA: '🇸🇦', RU: '🇷🇺', EG: '🇪🇬', MA: '🇲🇦', NG: '🇳🇬', CN: '🇨🇳', US: '🇺🇸', TR: '🇹🇷', IN: '🇮🇳',
};
export const flag = (c: string | null): string => (c ? (FLAG[c] ?? '') : '');

const productName = (locale: Locale, p: { name: string | null; nameZh: string | null }): string | null =>
  locale === 'zh' ? (p.nameZh ?? p.name) : (p.name ?? p.nameZh);

export type InboxFilter = 'pending' | 'all';
type InboxStatus = 'awaiting' | 'paused' | 'done' | 'handled';

export type ConversationSummary = {
  readonly conversationId: string;
  readonly buyer: string | null;
  readonly country: string | null;
  readonly status: InboxStatus;
  readonly needsAction: boolean;
  readonly latestMessage: string | null;
  readonly latestAt: Date | null;
  readonly product: { readonly name: string | null; readonly nameZh: string | null };
  readonly quantity: number | null;
  readonly unitPriceUsd: number | null;
};

export type InboxList = {
  readonly filter: InboxFilter;
  readonly waitingCount: number;
  readonly conversations: readonly ConversationSummary[];
};

function statusOf(row: { pending: number; assigned_to: string | null; closed_at: Date | null }): { status: InboxStatus; needs: boolean } {
  if (row.pending > 0) return { status: 'awaiting', needs: true };
  if (row.assigned_to !== null) return { status: 'paused', needs: false };
  if (row.closed_at !== null) return { status: 'done', needs: false };
  return { status: 'handled', needs: false };
}

export async function loadInboxList(db: Db, businessIdRaw: string, filter: InboxFilter): Promise<InboxList> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { filter, waitingCount: 0, conversations: [] };

  return withTenantTx(db, bid.value, async (tx) => {
    const rows = (await sql<{
      id: string; buyer: string | null; country: string | null;
      name_zh: string | null; name: string | null; qty: number | null;
      assigned_to: string | null; closed_at: Date | null;
      last_text: string | null; last_dir: string | null; last_at: Date | null;
      is_active: boolean; pending: number; unit_price: string | null;
    }>`
      select c.id, cl.display_name as buyer, cl.country,
             p.name_zh, p.name, cs.inquiry_quantity as qty,
             c.assigned_to, c.closed_at, c.is_active,
             lm.text_content as last_text, lm.direction as last_dir, lm.sent_at as last_at,
             (select count(*)::int from drafts d where d.conversation_id = c.id and d.status = 'pending') as pending,
             q.unit_price_usd as unit_price
        from conversations c
        left join clients cl on cl.id = c.client_id
        left join conversation_state cs on cs.conversation_id = c.id
        left join products p on p.id = cs.identified_product_id
        left join lateral (select text_content, direction, sent_at from messages m
                            where m.conversation_id = c.id order by m.sent_at desc limit 1) lm on true
        left join lateral (select unit_price_usd from quotes qq
                            where qq.conversation_id = c.id order by qq.created_at desc limit 1) q on true
       order by
         (case when (select count(*) from drafts d where d.conversation_id = c.id and d.status = 'pending') > 0 then 0
               when lm.direction = 'inbound' and c.is_active then 1
               else 2 end),
         lm.sent_at desc nulls last
       limit 50
    `.execute(tx)).rows;

    const all = rows.map((r): ConversationSummary => {
      const st = statusOf({ pending: r.pending, assigned_to: r.assigned_to, closed_at: r.closed_at });
      return {
        conversationId: r.id, buyer: r.buyer, country: r.country,
        status: st.status, needsAction: st.needs,
        latestMessage: r.last_text, latestAt: r.last_at,
        product: { name: r.name, nameZh: r.name_zh }, quantity: r.qty ?? null,
        unitPriceUsd: r.unit_price !== null ? Number(r.unit_price) : null,
      };
    });
    const waitingCount = all.filter((c) => c.needsAction).length;
    const conversations = filter === 'pending' ? all.filter((c) => c.needsAction) : all;
    return { filter, waitingCount, conversations };
  });
}

/** Default filter: open on pending when there's work, else all. */
export function defaultFilter(waitingCount: number): InboxFilter {
  return waitingCount > 0 ? 'pending' : 'all';
}

/** ── Conversation detail ─────────────────────────────────────────────────── */

export type TimelineMessage = { direction: 'inbound' | 'outbound'; text: string; at: Date | null };

export type ConversationDetail = {
  readonly conversationId: string;
  readonly buyer: string | null;
  readonly country: string | null;
  readonly status: InboxStatus;
  readonly product: { readonly name: string | null; readonly nameZh: string | null };
  readonly quantity: number | null;
  readonly quote: { unitPriceUsd: number; totalUsd: number; quantity: number } | null;
  readonly order: { status: string; reference: string; totalUsd: number | null } | null;
  readonly messages: readonly TimelineMessage[];
  readonly pendingDraft: { draftId: string; draftText: string } | null;
};

export async function loadConversationDetail(db: Db, businessIdRaw: string, conversationId: string): Promise<ConversationDetail | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;

  return withTenantTx(db, bid.value, async (tx) => {
    const head = (await sql<{
      id: string; buyer: string | null; country: string | null;
      name_zh: string | null; name: string | null; qty: number | null;
      assigned_to: string | null; closed_at: Date | null; pending: number;
    }>`
      select c.id, cl.display_name as buyer, cl.country, p.name_zh, p.name,
             cs.inquiry_quantity as qty, c.assigned_to, c.closed_at,
             (select count(*)::int from drafts d where d.conversation_id = c.id and d.status = 'pending') as pending
        from conversations c
        left join clients cl on cl.id = c.client_id
        left join conversation_state cs on cs.conversation_id = c.id
        left join products p on p.id = cs.identified_product_id
       where c.id = ${conversationId} limit 1
    `.execute(tx)).rows[0];
    if (!head) return null;

    const messages = (await sql<{ direction: string; text_content: string | null; sent_at: Date | null }>`
      select direction, text_content, sent_at from messages
       where conversation_id = ${conversationId} order by sent_at asc limit 200
    `.execute(tx)).rows
      .filter((m) => m.text_content !== null)
      .map((m): TimelineMessage => ({ direction: m.direction === 'inbound' ? 'inbound' : 'outbound', text: m.text_content!, at: m.sent_at }));

    const q = (await sql<{ unit_price_usd: string; total_usd: string; quantity: number }>`
      select unit_price_usd, total_usd, quantity from quotes
       where conversation_id = ${conversationId} order by created_at desc limit 1
    `.execute(tx)).rows[0];

    const o = (await sql<{ status: string; order_reference: string; total_value_usd: string | null }>`
      select status, order_reference, total_value_usd from orders
       where conversation_id = ${conversationId} order by created_at desc limit 1
    `.execute(tx)).rows[0];

    const draft = (await sql<{ id: string; draft_text: string }>`
      select id, draft_text from drafts where conversation_id = ${conversationId} and status = 'pending'
       order by created_at desc limit 1
    `.execute(tx)).rows[0];

    const st = statusOf({ pending: head.pending, assigned_to: head.assigned_to, closed_at: head.closed_at });
    return {
      conversationId: head.id, buyer: head.buyer, country: head.country, status: st.status,
      product: { name: head.name, nameZh: head.name_zh }, quantity: head.qty ?? null,
      quote: q ? { unitPriceUsd: Number(q.unit_price_usd), totalUsd: Number(q.total_usd), quantity: q.quantity } : null,
      order: o ? { status: o.status, reference: o.order_reference, totalUsd: o.total_value_usd !== null ? Number(o.total_value_usd) : null } : null,
      messages,
      pendingDraft: draft ? { draftId: draft.id, draftText: draft.draft_text } : null,
    };
  });
}

/** ── Renderers (pure, mobile-first, localized, escaped) ───────────────────── */

const statusPill = (locale: Locale, status: InboxStatus, needs: boolean): string =>
  `<span class="pill ${needs ? 'warn' : 'ok'}">${needs ? '● ' : ''}${esc(t(locale, `inbox.status.${status}` as MessageKey))}</span>`;

const who = (locale: Locale, buyer: string | null, country: string | null): string => {
  const name = buyer ?? t(locale, 'common.buyer');
  const cn = countryName(locale, country);
  return `${flag(country)} <b>${esc(name)}</b>${cn ? `<span class="muted"> · ${esc(cn)}</span>` : ''}`;
};

export function renderInboxList(data: InboxList, locale: Locale, now: Date): string {
  const pcs = t(locale, 'product.unit.pcs');
  const tab = (f: InboxFilter) =>
    `<a class="tab ${data.filter === f ? 'on' : ''}" href="/app/inbox?filter=${f}">${esc(t(locale, `inbox.filter.${f}` as MessageKey))}${f === 'pending' && data.waitingCount > 0 ? ` (${data.waitingCount})` : ''}</a>`;
  const tabs = `<div class="tabs">${tab('pending')}${tab('all')}</div>`;
  const title = `<h1 class="page">${esc(t(locale, 'nav.inbox'))}</h1>`;

  if (data.conversations.length === 0) {
    const body = data.filter === 'pending'
      ? `<div class="ok-card"><div class="ok">✓ ${esc(t(locale, 'inbox.empty.allGood'))}</div>
          <p class="muted">${esc(t(locale, 'inbox.empty.allGoodBody'))} <a href="/app/inbox?filter=all">${esc(t(locale, 'inbox.empty.seeAll'))}</a></p></div>`
      : `<div class="empty">${esc(t(locale, 'inbox.empty.none'))}<br><span class="muted">${esc(t(locale, 'inbox.empty.noneBody'))}</span></div>`;
    return `${title}${tabs}<div class="card">${body}</div>${INBOX_STYLE}`;
  }

  const cards = data.conversations.map((c) => {
    const prod = productName(locale, c.product);
    return `
    <a class="conv ${c.needsAction ? 'needs' : ''}" href="/app/inbox/${encodeURIComponent(c.conversationId)}">
      <div class="conv-h">
        <span class="who">${who(locale, c.buyer, c.country)}</span>
        ${statusPill(locale, c.status, c.needsAction)}
      </div>
      ${c.needsAction ? `<div class="need">${esc(t(locale, 'inbox.needsAction'))}</div>` : ''}
      <div class="conv-b muted">
        ${prod ? `${esc(prod)}　` : ''}${c.quantity !== null ? `${esc(formatQty(locale, c.quantity))}${esc(pcs)}　` : ''}${c.unitPriceUsd !== null ? esc(formatUsd(c.unitPriceUsd)) : ''}
      </div>
      ${c.latestMessage ? `<div class="conv-m">${esc(c.latestMessage.slice(0, 80))}</div>` : ''}
      <div class="conv-t muted">${c.latestAt ? esc(formatRelative(locale, c.latestAt, now)) : ''}</div>
    </a>`;
  }).join('');

  return `${title}${tabs}<div class="list">${cards}</div>${INBOX_STYLE}`;
}

export function renderConversationDetail(d: ConversationDetail, locale: Locale, now: Date, flash: string | null): string {
  const pcs = t(locale, 'product.unit.pcs');
  const prod = productName(locale, d.product);
  const context = (d.quote || d.order) ? `<div class="ctx">
      ${d.quote ? `<div><span class="muted">${esc(t(locale, 'inbox.ctx.quote'))}</span> ${esc(formatQty(locale, d.quote.quantity))}${esc(pcs)} · ${esc(formatUsd(d.quote.unitPriceUsd))}/${esc(pcs)} · ${esc(t(locale, 'product.detail.total'))} ${esc(formatUsd(d.quote.totalUsd))}</div>` : ''}
      ${d.order ? `<div><span class="muted">${esc(t(locale, 'inbox.ctx.order'))}</span> ${esc(d.order.reference)} · ${esc(orderStatusName(locale, d.order.status))}${d.order.totalUsd !== null ? ` · ${esc(formatUsd(d.order.totalUsd))}` : ''}</div>` : ''}
    </div>` : '';

  const timeline = d.messages.length
    ? `<div class="timeline">${d.messages.map((m) => `
        <div class="msg ${m.direction}">
          <div class="bubble">${esc(m.text)}</div>
          <div class="ts muted">${m.at ? esc(formatRelative(locale, m.at, now)) : ''} · ${m.direction === 'inbound' ? esc(t(locale, 'common.buyer')) : esc(EMPLOYEE_NAME[locale])}</div>
        </div>`).join('')}</div>`
    : `<div class="empty muted">${esc(t(locale, 'inbox.detail.noMessages'))}</div>`;

  const draftCard = d.pendingDraft
    ? `<div class="card draft" role="region">
        <h2>⚠️ ${esc(t(locale, 'inbox.draft.title', { name: EMPLOYEE_NAME[locale] }))}</h2>
        <div class="proposed">${esc(d.pendingDraft.draftText)}</div>
        <form method="post" action="/app/inbox/${encodeURIComponent(d.conversationId)}/act" class="acts">
          <input type="hidden" name="draftId" value="${esc(d.pendingDraft.draftId)}" />
          <button class="btn send" name="command" value="发送">${esc(t(locale, 'inbox.action.send'))}</button>
          <button class="btn" name="command" value="不回">${esc(t(locale, 'inbox.action.skip'))}</button>
          <button class="btn danger" name="command" value="收回">${esc(t(locale, 'inbox.action.revoke'))}</button>
        </form>
        <form method="post" action="/app/inbox/${encodeURIComponent(d.conversationId)}/act" class="editform">
          <input type="hidden" name="draftId" value="${esc(d.pendingDraft.draftId)}" />
          <label class="muted" for="edit">${esc(t(locale, 'inbox.action.editLabel'))}</label>
          <textarea id="edit" name="edit" rows="2" placeholder="${esc(t(locale, 'inbox.action.editPlaceholder'))}"></textarea>
          <button class="btn" name="command" value="改">${esc(t(locale, 'inbox.action.editSend'))}</button>
        </form>
      </div>`
    : `<div class="card"><div class="empty muted">${esc(t(locale, 'inbox.draft.none'))}</div></div>`;

  const flashHtml = flash ? `<div class="flash" role="status">${esc(flash)}</div>` : '';

  return `
    <div class="dhead">
      <a class="back" href="/app/inbox">${esc(t(locale, 'inbox.detail.back'))}</a>
      <div class="who">${who(locale, d.buyer, d.country)}</div>
      ${statusPill(locale, d.status, d.pendingDraft !== null)}
    </div>
    ${prod || d.quantity !== null ? `<div class="muted subline">${prod ? esc(prod) : ''}${d.quantity !== null ? ` · ${esc(formatQty(locale, d.quantity))}${esc(pcs)}` : ''}</div>` : ''}
    ${context}
    ${flashHtml}
    ${draftCard}
    <div class="card"><h2>${esc(t(locale, 'inbox.detail.log'))}</h2>${timeline}</div>
    ${INBOX_STYLE}`;
}

const INBOX_STYLE = `<style>
  .tabs { display:flex; gap:8px; margin-bottom:16px; }
  .tab { padding:8px 16px; border-radius:999px; background:#14171c; border:1px solid #23272e; color:#b9c0c9; font-size:14px; }
  .tab.on { background:#1b2430; color:#fff; }
  .list { display:flex; flex-direction:column; gap:10px; }
  .conv { display:block; background:#14171c; border:1px solid #23272e; border-radius:14px; padding:16px; }
  .conv.needs { border-color:#5a4a1f; background:#181510; }
  .conv:hover { border-color:#3a4250; }
  .conv-h { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .need { color:#fbbf24; font-size:13px; font-weight:600; margin-top:6px; }
  .conv-b { font-size:13px; margin-top:6px; } .conv-m { margin-top:6px; font-size:14px; color:#c8ccd2; }
  .conv-t { font-size:12px; margin-top:8px; }
  .pill { display:inline-block; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:600; white-space:nowrap; }
  .pill.ok { background:#0f2e1c; color:#4ade80; } .pill.warn { background:#2e2413; color:#fbbf24; }
  .ok-card { text-align:center; padding:12px; } .ok { color:#4ade80; font-size:17px; font-weight:700; }
  .empty { text-align:center; padding:32px 16px; }
  .dhead { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:6px; }
  .back { color:#60a5fa; font-size:14px; } .dhead .who { font-size:16px; }
  .subline { font-size:13px; margin-bottom:12px; }
  .ctx { background:#0f1216; border:1px solid #23272e; border-radius:12px; padding:12px 16px; margin-bottom:16px; font-size:14px; display:flex; flex-direction:column; gap:6px; }
  .flash { background:#0f2e1c; color:#4ade80; border-radius:10px; padding:10px 14px; margin-bottom:14px; font-size:14px; }
  .card.draft { border-color:#5a4a1f; }
  .proposed { background:#0f1216; border:1px solid #23272e; border-radius:10px; padding:14px; margin-bottom:12px; font-size:15px; white-space:pre-wrap; }
  .acts { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  .btn { padding:10px 18px; border:0; border-radius:9px; background:#2a313c; color:#fff; font-size:14px; font-weight:600; cursor:pointer; }
  .btn.send { background:#2563eb; } .btn.send:hover { background:#1d4ed8; } .btn.danger { background:#3a2020; color:#f8b4b4; }
  .editform { display:flex; flex-direction:column; gap:8px; }
  textarea { width:100%; background:#0f1216; border:1px solid #2b313a; border-radius:10px; color:#fff; padding:10px; font:inherit; resize:vertical; }
  .timeline { display:flex; flex-direction:column; gap:12px; }
  .msg { max-width:82%; } .msg.inbound { align-self:flex-start; } .msg.outbound { align-self:flex-end; }
  .bubble { padding:10px 14px; border-radius:14px; font-size:15px; white-space:pre-wrap; word-break:break-word; }
  .msg.inbound .bubble { background:#1b2027; border-top-left-radius:4px; }
  .msg.outbound .bubble { background:#1b3050; border-top-right-radius:4px; }
  .ts { font-size:11px; margin-top:4px; }
  button:focus-visible, a:focus-visible, textarea:focus-visible { outline:2px solid #60a5fa; outline-offset:2px; }
  @media (max-width:560px) { .conv, .card { border-radius:12px; } .msg { max-width:92%; } }
</style>`;
