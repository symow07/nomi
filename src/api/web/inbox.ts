import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, countryName, orderStatusName, capabilityName, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatUsd, formatQty, formatRelative } from '../../core/owner/i18n/format.js';
import { ownershipOf, WAITING_HUMAN_AGENT, type ConversationOwnership } from '../../core/conversation/ownership.js';
import { loadRefusals, type Refusal } from './refusals.js';
import { esc, deeper, back } from './layout.js';

/** The stored problem-signal kinds shown as a takeover reason (no classifier). */
const PROBLEM_KINDS = new Set(['human_requested', 'complaint', 'repeated_ambiguity', 'low_confidence_image']);

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

/** The catalogue name in the owner's own language. Shared — the factory page
 *  used to print the English name to a Chinese owner. */
export const productName = (locale: Locale, p: { name: string | null; nameZh: string | null }): string | null =>
  locale === 'zh' ? (p.nameZh ?? p.name) : (p.name ?? p.nameZh);

/**
 * M22 — `blocked` is reached from Today, not from a permanent tab: it is a
 * consequence of something going wrong, so it appears only when it has
 * something to show. Same rule the shell applies to contextual destinations.
 */
export type InboxFilter = 'pending' | 'all' | 'blocked';
type InboxStatus = 'awaiting' | 'paused' | 'done' | 'handled';

export type ConversationSummary = {
  readonly conversationId: string;
  readonly buyer: string | null;
  readonly country: string | null;
  readonly status: InboxStatus;
  readonly needsAction: boolean;
  /** Phase D — who is speaking, via the ONE ownership model (M16.1). assigned_to
   *  was already selected; this stops the list collapsing "a human is waited on"
   *  and "you are handling it" into one grey status. */
  readonly ownership: ConversationOwnership;
  /** Phase D — her reply is written and waiting for you to review it. */
  readonly awaitingReview: boolean;
  /** The stored problem-signal that caused the handoff. Never inferred. */
  readonly handoffReason: string | null;
  readonly latestMessage: string | null;
  readonly latestAt: Date | null;
  readonly product: { readonly name: string | null; readonly nameZh: string | null };
  readonly quantity: number | null;
  readonly unitPriceUsd: number | null;
};

export type InboxList = {
  readonly filter: InboxFilter;
  /** M22 — conversations holding a message that never reached the buyer. */
  readonly blockedCount: number;
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
  if (!bid.ok) return { filter, waitingCount: 0, blockedCount: 0, conversations: [] };

  return withTenantTx(db, bid.value, async (tx) => {
    const rows = (await sql<{
      id: string; buyer: string | null; country: string | null;
      name_zh: string | null; name: string | null; qty: number | null;
      assigned_to: string | null; closed_at: Date | null;
      last_text: string | null; last_dir: string | null; last_at: Date | null;
      is_active: boolean; pending: number; unit_price: string | null; handoff_reason: string | null;
    }>`
      select c.id, cl.display_name as buyer, cl.country,
             p.name_zh, p.name, cs.inquiry_quantity as qty,
             c.assigned_to, c.closed_at, c.is_active,
             lm.text_content as last_text, lm.direction as last_dir, lm.sent_at as last_at,
             (select count(*)::int from drafts d where d.conversation_id = c.id and d.status = 'pending') as pending,
             q.unit_price_usd as unit_price,
             sig.kind as handoff_reason
        from conversations c
        left join clients cl on cl.id = c.client_id
        left join conversation_state cs on cs.conversation_id = c.id
        left join products p on p.id = cs.identified_product_id
        left join lateral (select text_content, direction, sent_at from messages m
                            where m.conversation_id = c.id order by m.sent_at desc limit 1) lm on true
        left join lateral (select unit_price_usd from quotes qq
                            where qq.conversation_id = c.id order by qq.created_at desc limit 1) q on true
        left join lateral (select kind from conversation_signals cs
                            where cs.conversation_id = c.id and cs.resolved_at is null
                              and cs.kind = any(${sql.raw(`array[${[...PROBLEM_KINDS].map((k) => `'${k}'`).join(',')}]`)})
                            order by cs.created_at desc limit 1) sig on true
       order by
         -- Phase D: a waiting HUMAN outranks everything, so a handoff can never
         -- fall out of the 50-row window. The sentinel comes from the ownership
         -- module, never a literal — one source of truth for what it means.
         (case when c.assigned_to = ${WAITING_HUMAN_AGENT} and c.is_active then 0
               when (select count(*) from drafts d where d.conversation_id = c.id and d.status = 'pending') > 0 then 1
               when lm.direction = 'inbound' and c.is_active then 2
               else 3 end),
         lm.sent_at desc nulls last
       limit 50
    `.execute(tx)).rows;

    const all = rows.map((r): ConversationSummary => {
      const st = statusOf({ pending: r.pending, assigned_to: r.assigned_to, closed_at: r.closed_at });
      return {
        conversationId: r.id, buyer: r.buyer, country: r.country,
        status: st.status, needsAction: st.needs,
        ownership: ownershipOf(r.assigned_to),
        awaitingReview: r.pending > 0,
        handoffReason: r.handoff_reason,
        latestMessage: r.last_text, latestAt: r.last_at,
        product: { name: r.name, nameZh: r.name_zh }, quantity: r.qty ?? null,
        unitPriceUsd: r.unit_price !== null ? Number(r.unit_price) : null,
      };
    });
    // Phase D — "needs you" is an ownership question, not a drafts count. A buyer
    // who asked for a person has no draft by design; excluding them hid the most
    // urgent conversation in the business from the tab meant to surface it.
    const needsOwner = (c: ConversationSummary) =>
      c.needsAction || c.ownership === 'WAITING_HUMAN' || c.ownership === 'OWNER_CONTROLLED';
    const waitingCount = all.filter(needsOwner).length;

    // M22 — which of these conversations is holding a refused message. Read
    // through the SAME loader the conversation and Today use, so three
    // surfaces cannot report three different answers.
    const refused = await sql<{ conversation_id: string }>`
      select distinct conversation_id from outbound_messages
       where business_id = ${bid.value} and status = 'canceled'
         and cancel_reason is not null
         and created_at > now() - make_interval(days => 7)
    `.execute(tx).then((r) => new Set(r.rows.map((x) => x.conversation_id)));
    const blocked = all.filter((c) => refused.has(c.conversationId));

    const conversations = filter === 'pending' ? all.filter(needsOwner)
      : filter === 'blocked' ? blocked
      : all;
    return { filter, waitingCount, blockedCount: blocked.length, conversations };
  });
}

/** Default filter: open on pending when there's work, else all. */
export function defaultFilter(waitingCount: number): InboxFilter {
  return waitingCount > 0 ? 'pending' : 'all';
}

/** ── Conversation detail ─────────────────────────────────────────────────── */

export type TimelineMessage = { direction: 'inbound' | 'outbound'; text: string; at: Date | null };

/** M16.2c — the human control-plane event kinds, in conversation_events. */
export type HumanActionType = 'takeover' | 'owner_reply' | 'resume_ai' | 'draft_resolved';
const HUMAN_ACTION_TYPES = ['takeover', 'owner_reply', 'resume_ai', 'draft_resolved'] as const;

/**
 * "What happened last?" — the latest human action on this conversation, from
 * conversation_events. Read-only, and deliberately NARROW: actor + kind + time
 * only. No message body, no buyer PII — just enough to answer "who touched this
 * and when".
 */
export type LastHumanAction = {
  readonly type: HumanActionType;
  readonly actor: string | null;
  readonly at: Date | null;
};

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
  readonly pendingDraft: { draftId: string; draftText: string; capability: string } | null;
  readonly ownership: ConversationOwnership;
  /**
   * M22 — messages in THIS conversation that never reached the buyer. The
   * evidence is `outbound_messages.cancel_reason`, written by the worker when
   * `gateOutbound` refused; nothing here re-decides anything.
   */
  readonly refusals: readonly Refusal[];
  readonly handoffReasons: readonly string[];   // unresolved problem-signal kinds
  readonly lastHumanAction: LastHumanAction | null;
  /**
   * Phase D — which taught facts supported her most recent reply, by LABEL.
   * Answers "why did she say that?" from the M13 usage audit
   * (conversation_events 'knowledge_used' → product_knowledge). Read-only, and
   * empty when she answered without leaning on anything taught.
   */
  readonly knowledgeUsed: readonly string[];
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

    const draft = (await sql<{ id: string; draft_text: string; capability: string }>`
      select id, draft_text, capability from drafts where conversation_id = ${conversationId} and status = 'pending'
       order by created_at desc limit 1
    `.execute(tx)).rows[0];

    // M22 — what did not reach this buyer. Read through the shared loader, so
    // the conversation, the inbox tab and Today can never disagree. Its own
    // tenant transaction (it is a read model, not a fragment of this query).
    const refusals = await loadRefusals(db, businessIdRaw, { conversationId });

    // Takeover reason (M16.1): unresolved PROBLEM signals — stored data, no classifier.
    const handoffReasons = (await sql<{ kind: string }>`
      select kind from conversation_signals where conversation_id = ${conversationId} and resolved_at is null
    `.execute(tx)).rows.map((r) => r.kind).filter((k) => PROBLEM_KINDS.has(k));

    // M16.2c "what happened last?": the latest human action — kind + actor + time
    // only. payload->>'actor' is a human/agent id, never buyer data; no body read.
    const lastAct = (await sql<{ type: string; actor: string | null; at: Date | null }>`
      select type, payload->>'actor' as actor, created_at as at
        from conversation_events
       where conversation_id = ${conversationId}
         and type in ('takeover', 'owner_reply', 'resume_ai', 'draft_resolved')
       order by created_at desc, id desc limit 1
    `.execute(tx)).rows[0];
    const lastHumanAction: LastHumanAction | null =
      lastAct && (HUMAN_ACTION_TYPES as readonly string[]).includes(lastAct.type)
        ? { type: lastAct.type as HumanActionType, actor: lastAct.actor, at: lastAct.at }
        : null;

    // Phase D: the taught facts behind her latest reply — the M13 usage audit,
    // joined to its labels. No new storage; both tables already exist.
    const knowledgeUsed = (await sql<{ label: string }>`
      select k.label
        from conversation_events e
        join lateral jsonb_array_elements_text(e.payload->'ids') as kid(id) on true
        join product_knowledge k on k.id = kid.id::uuid
       where e.conversation_id = ${conversationId} and e.type = 'knowledge_used'
         and e.id = (select max(id) from conversation_events
                      where conversation_id = ${conversationId} and type = 'knowledge_used')
       limit 6
    `.execute(tx)).rows.map((r) => r.label);

    const st = statusOf({ pending: head.pending, assigned_to: head.assigned_to, closed_at: head.closed_at });
    return {
      conversationId: head.id, buyer: head.buyer, country: head.country, status: st.status,
      product: { name: head.name, nameZh: head.name_zh }, quantity: head.qty ?? null,
      quote: q ? { unitPriceUsd: Number(q.unit_price_usd), totalUsd: Number(q.total_usd), quantity: q.quantity } : null,
      order: o ? { status: o.status, reference: o.order_reference, totalUsd: o.total_value_usd !== null ? Number(o.total_value_usd) : null } : null,
      messages,
      pendingDraft: draft
        ? { draftId: draft.id, draftText: draft.draft_text, capability: draft.capability }
        : null,
      ownership: ownershipOf(head.assigned_to),
      refusals,
      handoffReasons,
      lastHumanAction,
      knowledgeUsed,
    };
  });
}

/** ── Renderers (pure, mobile-first, localized, escaped) ───────────────────── */

// The conversation's own state — only meaningful while SHE holds it. Once a
// human is involved, `statusOf` calls every assigned conversation 'paused',
// which contradicts the ownership card right below it; the card is the truth.
const statusPill = (locale: Locale, status: InboxStatus, needs: boolean): string =>
  `<span class="pill ${needs ? 'warn' : 'ok'}">${needs ? '● ' : ''}${esc(t(locale, `inbox.status.${status}` as MessageKey))}</span>`;

const who = (locale: Locale, buyer: string | null, country: string | null): string => {
  const name = buyer ?? t(locale, 'common.buyer');
  const cn = countryName(locale, country);
  return `${flag(country)} <b>${esc(name)}</b>${cn ? `<span class="muted"> · ${esc(cn)}</span>` : ''}`;
};

export function renderInboxList(data: InboxList, locale: Locale, now: Date): string {
  const name = EMPLOYEE_NAME[locale];
  const pcs = t(locale, 'product.unit.pcs');
  const tab = (f: InboxFilter) =>
    `<a class="tab ${data.filter === f ? 'on' : ''}" href="/app/inbox?filter=${f}">${esc(t(locale, `inbox.filter.${f}` as MessageKey))}${f === 'pending' && data.waitingCount > 0 ? ` (${data.waitingCount})` : ''}${f === 'blocked' && data.blockedCount > 0 ? ` (${data.blockedCount})` : ''}</a>`;
  // M22 — `blocked` is not a permanent tab. It appears when something did not
  // reach a buyer, or when the owner arrived here from Today's link, and
  // disappears again once there is nothing to show. An always-present tab that
  // is almost always empty trains the owner to ignore it.
  const showBlocked = data.blockedCount > 0 || data.filter === 'blocked';
  const tabs = `<div class="tabs">${tab('pending')}${tab('all')}${showBlocked ? tab('blocked') : ''}</div>`;
  const title = `<h1 class="page">${esc(t(locale, 'nav.inbox'))}</h1>`;

  if (data.conversations.length === 0) {
    const body = data.filter === 'pending'
      ? `<div class="ok-card"><div class="ok">✓ ${esc(t(locale, 'buyers.empty.calm'))}</div>
          <p class="muted">${esc(t(locale, 'inbox.empty.allGoodBody'))} <a href="/app/inbox?filter=all">${esc(t(locale, 'inbox.empty.seeAll'))}</a></p></div>`
      // M22 — nothing was refused. Stated as the fact it is; not a ✓, because
      // "no message failed" is the normal state and not an achievement.
      : data.filter === 'blocked'
      ? `<div class="empty">${esc(t(locale, 'refused.none'))}
          <div>${deeper('/app/inbox?filter=all', t(locale, 'inbox.empty.seeAll'))}</div></div>`
      : `<div class="empty">${esc(t(locale, 'inbox.empty.none'))}<br><span class="muted">${esc(t(locale, 'inbox.empty.noneBody'))}</span>
          <div>${deeper('/app/factory', t(locale, 'inbox.empty.setup'))}</div></div>`;
    return `${title}${tabs}<div class="card">${body}</div>
      ${data.filter === 'pending' ? deeper('/app/conversations', t(locale, 'buyers.all.link')) : ''}${INBOX_STYLE}`;
  }

  // Phase D — an owner thinks in people, and the question that orders them is
  // "who is speaking now?". Grouped through the ONE ownership model, never by an
  // internal status code.
  const needsYou = data.conversations.filter((c) => c.ownership === 'WAITING_HUMAN' || c.awaitingReview);
  const yours    = data.conversations.filter((c) => c.ownership === 'OWNER_CONTROLLED' && !needsYou.includes(c));
  const hers     = data.conversations.filter((c) => !needsYou.includes(c) && !yours.includes(c));

  const badge = (c: ConversationSummary): string => {
    if (c.ownership === 'WAITING_HUMAN') {
      // Say the reason that was STORED. Asserting "asked for a person" for a
      // complaint or an unclear photo invents a fact about the buyer — on the
      // one product whose promise is that she never does that.
      const label = c.handoffReason
        ? t(locale, `takeover.reason.${c.handoffReason}` as MessageKey)
        : t(locale, 'buyers.badge.waitingUnknown');
      return `<span class="tag now">${esc(label)}</span>`;
    }
    if (c.awaitingReview) return `<span class="tag now">${esc(t(locale, 'buyers.badge.review'))}</span>`;
    if (c.ownership === 'OWNER_CONTROLLED') return `<span class="tag you">${esc(t(locale, 'buyers.badge.yours'))}</span>`;
    return '';
  };

  const row = (c: ConversationSummary) => {
    const prod = productName(locale, c.product);
    const detail = [
      prod ?? '',
      c.quantity !== null ? `${formatQty(locale, c.quantity)}${pcs}` : '',
      c.unitPriceUsd !== null ? formatUsd(c.unitPriceUsd) : '',
    ].filter(Boolean).join(' · ');
    return `<a class="buyer" href="/app/inbox/${encodeURIComponent(c.conversationId)}">
      <div class="buyer-top"><span class="who">${who(locale, c.buyer, c.country)}</span>${badge(c)}</div>
      ${detail ? `<div class="buyer-d muted"><bdi>${esc(detail)}</bdi></div>` : ''}
      ${c.latestMessage ? `<div class="buyer-m"><bdi>${esc(c.latestMessage.slice(0, 90))}</bdi></div>` : ''}
      <div class="buyer-t muted">${c.latestAt ? esc(formatRelative(locale, c.latestAt, now)) : ''}</div>
    </a>`;
  };

  const heads = data.filter === 'all';
  const group = (label: string, items: readonly ConversationSummary[]) =>
    items.length ? `<section class="bgroup">
      ${heads ? `<h2 class="bgroup-h">${esc(label)}</h2>` : ''}
      <div class="list">${items.map(row).join('')}</div></section>` : '';

  return `${title}${tabs}
    ${group(t(locale, 'buyers.group.needsYou'), needsYou)}
    ${group(t(locale, 'buyers.group.yours'), yours)}
    ${group(t(locale, 'buyers.group.hers', { name }), hers)}
    ${deeper('/app/conversations', t(locale, 'buyers.all.link'))}
    ${INBOX_STYLE}`;
}

/** "What happened last?" — a localized one-liner: kind + who + when. No body. */
function lastActionLine(a: LastHumanAction, locale: Locale, now: Date): string {
  const who = a.actor && a.actor !== 'owner' ? a.actor : t(locale, 'takeover.actor.you');
  const phrase = t(locale, `takeover.last.${a.type}` as MessageKey, { who, name: EMPLOYEE_NAME[locale] });
  const when = a.at ? ` · ${formatRelative(locale, a.at, now)}` : '';
  return `<div class="lastact muted">${esc(t(locale, 'takeover.lastLabel'))}: ${esc(phrase + when)}</div>`;
}

/**
 * M22 — a message that did not reach this buyer, in three sentences: what
 * happened, why, and what the owner can do about it.
 *
 * The tone is deliberate. Nothing here blames her employee: every one of these
 * is a rule the OWNER set or a rule WhatsApp sets, working exactly as intended.
 * The failure being reported is that nobody said so — not that the gate refused.
 *
 * Read-only. It renders `outbound_messages.cancel_reason` and can change nothing.
 */
function refusalCard(rs: readonly Refusal[], locale: Locale, now: Date): string {
  if (rs.length === 0) return '';
  const name = EMPLOYEE_NAME[locale];
  return `<div class="card refused">
    <h3 class="rf-h">${esc(t(locale, 'refused.title'))}</h3>
    ${rs.map((r) => `<div class="rf">
      <div class="rf-w">${esc(t(locale, `refused.what.${r.reason}` as MessageKey, { name }))}</div>
      <div class="rf-y muted">${esc(t(locale, `refused.why.${r.reason}` as MessageKey, { name }))}</div>
      <div class="rf-d">${esc(t(locale, `refused.do.${r.reason}` as MessageKey, { name }))}</div>
      <div class="rf-t muted">${esc(formatRelative(locale, r.at, now))}</div>
    </div>`).join('')}
  </div>`;
}

/** M16.1/M16.2c — the human control surface, driven purely by ownership. */
function takeoverCard(d: ConversationDetail, locale: Locale, now: Date): string {
  const cid = encodeURIComponent(d.conversationId);
  const reasons = d.handoffReasons.length
    ? `<div class="why muted">${esc(t(locale, 'takeover.why'))}: ${d.handoffReasons.map((k) => esc(t(locale, `takeover.reason.${k}` as MessageKey))).join('、')}</div>`
    : '';
  const last = d.lastHumanAction ? lastActionLine(d.lastHumanAction, locale, now) : '';
  const takeBtn = `<form method="post" action="/app/inbox/${cid}/takeover" class="inline"><button class="btn ${d.ownership === 'WAITING_HUMAN' ? 'send' : ''}" type="submit">${esc(t(locale, 'takeover.action.take'))}</button></form>`;

  switch (d.ownership) {
    case 'AI':
      return `<div class="card takeover"><span class="pill ok">${esc(t(locale, 'takeover.status.ai'))}</span>${last}${takeBtn}</div>`;
    case 'WAITING_HUMAN':
      return `<div class="card takeover warn"><span class="pill warn">${esc(t(locale, 'takeover.status.waiting'))}</span>${reasons}${last}${takeBtn}</div>`;
    case 'OWNER_CONTROLLED':
      return `<div class="card takeover owner">
        <span class="pill owner">${esc(t(locale, 'takeover.status.owner'))}</span>
        ${last}
        <form method="post" action="/app/inbox/${cid}/reply" class="replyform">
          <textarea name="text" rows="2" placeholder="${esc(t(locale, 'takeover.replyPlaceholder'))}" required></textarea>
          <button class="btn send" type="submit">${esc(t(locale, 'takeover.action.reply'))}</button>
        </form>
        <form method="post" action="/app/inbox/${cid}/resume" class="inline"><button class="btn ghost" type="submit">${esc(t(locale, 'takeover.action.resume'))}</button></form>
      </div>`;
  }
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
          <div class="bubble"><bdi>${esc(m.text)}</bdi></div>
          <div class="ts muted">${m.at ? esc(formatRelative(locale, m.at, now)) : ''} · ${m.direction === 'inbound' ? esc(t(locale, 'common.buyer')) : esc(EMPLOYEE_NAME[locale])}</div>
        </div>`).join('')}</div>`
    : `<div class="empty muted">${esc(t(locale, 'inbox.detail.noMessages'))}</div>`;

  const draftCard = d.pendingDraft
    ? `<div class="card draft" role="region">
        <h2>${esc(t(locale, 'buyers.review.title'))}</h2>
        <p class="muted review-intro">${esc(t(locale, 'buyers.review.intro', { buyer: d.buyer ?? t(locale, 'common.buyer') }))}</p>
        <div class="proposed"><bdi>${esc(d.pendingDraft.draftText)}</bdi></div>
        <form method="post" action="/app/inbox/${encodeURIComponent(d.conversationId)}/act" class="acts">
          <input type="hidden" name="draftId" value="${esc(d.pendingDraft.draftId)}" />
          <button class="btn send" name="command" value="发送">${esc(t(locale, 'inbox.action.send'))}</button>
          <button class="btn" name="command" value="不回">${esc(t(locale, 'inbox.action.skip'))}</button>
          <button class="btn danger" name="command" value="收回"
                  onclick="return confirm(this.dataset.confirm)"
                  data-confirm="${esc(t(locale, 'inbox.action.revoke.confirm', { cap: capabilityName(locale, d.pendingDraft.capability) }))}"
          >${esc(t(locale, 'inbox.action.revoke'))}</button>
        </form>
        <p class="muted revoke-note">${esc(t(locale, 'inbox.action.revoke.note'))}</p>
        <form method="post" action="/app/inbox/${encodeURIComponent(d.conversationId)}/act" class="editform">
          <input type="hidden" name="draftId" value="${esc(d.pendingDraft.draftId)}" />
          <label class="muted" for="edit">${esc(t(locale, 'inbox.action.editLabel'))}</label>
          <textarea id="edit" name="edit" rows="2" placeholder="${esc(t(locale, 'inbox.action.editPlaceholder'))}"></textarea>
          <button class="btn" name="command" value="改">${esc(t(locale, 'inbox.action.editSend'))}</button>
        </form>
      </div>`
    : `<div class="card"><div class="empty muted">${esc(t(locale, 'inbox.draft.none'))}</div></div>`;

  // Phase D — "why did she say that?", from the stored usage audit. Shown only
  // while SHE is speaking: once a human takes over it is no longer the question.
  const knew = d.ownership === 'AI' && d.knowledgeUsed.length > 0
    ? `<div class="card knew"><h2>${esc(t(locale, 'buyers.knew.title'))}</h2>
        <ul class="knewlist">${d.knowledgeUsed.map((k) => `<li>${esc(k)}</li>`).join('')}</ul></div>`
    : '';

  const flashHtml = flash ? `<div class="flash" role="status">${esc(flash)}</div>` : '';

  return `
    <div class="dhead">
      ${back('/app/inbox', t(locale, 'inbox.detail.back'))}
      <div class="who">${who(locale, d.buyer, d.country)}</div>
      ${d.ownership === 'AI' ? statusPill(locale, d.status, d.pendingDraft !== null) : ''}
    </div>
    ${prod || d.quantity !== null ? `<div class="muted subline">${prod ? `<bdi>${esc(prod)}</bdi>` : ''}${d.quantity !== null ? ` · ${esc(formatQty(locale, d.quantity))}${esc(pcs)}` : ''}</div>` : ''}
    ${flashHtml}
    ${refusalCard(d.refusals, locale, now)}
    ${takeoverCard(d, locale, now)}
    ${d.ownership === 'OWNER_CONTROLLED' ? '' : draftCard}
    ${knew}
    ${context}
    <div class="card"><h2>${esc(t(locale, 'inbox.detail.log'))}</h2>${timeline}</div>
    ${INBOX_STYLE}`;
}

const INBOX_STYLE = `<style>
  /* M22 — a refusal is information, not an alarm. Amber, like the disconnected
     channel: something needs the owner, and nothing is broken. */
  .card.refused { border-color:#8a7330; background:#181510; }
  .rf-h { font-size:15px; font-weight:600; color:#e7eaee; margin:0 0 10px; }
  .rf { padding:10px 0; border-top:1px solid #2a2419; }
  .rf:first-of-type { border-top:0; padding-top:0; }
  .rf-w { font-size:14px; color:#e0b551; }
  .rf-y { font-size:13px; margin-top:3px; line-height:1.55; max-width:62ch; }
  .rf-d { font-size:14px; color:#d6dae0; margin-top:6px; }
  .rf-t { font-size:12px; margin-top:4px; }
  /* Phase D — buyers grouped by who is speaking; rows are large touch targets. */
  .bgroup { margin-bottom:26px; }
  .bgroup-h { font-size:13px; letter-spacing:0; color:#8b929c;
              margin:0 0 12px; font-weight:600; }
  a.buyer { display:block; background:#14171c; border:1px solid #2b313a; border-radius:14px; padding:16px 18px; }
  a.buyer:hover, a.buyer:focus-visible { border-color:#3d7a63; }
  .buyer-top { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .buyer-d { font-size:13px; margin-top:6px; }
  .buyer-m { margin-top:8px; font-size:14px; color:#c8ccd2; }
  .buyer-t { font-size:12px; margin-top:10px; }
  .tag { font-size:12px; font-weight:600; padding:5px 11px; border-radius:999px; white-space:nowrap; }
  .tag.now { background:#2e2413; color:#fbbf24; }
  .tag.you { background:#13233a; color:#93c5fd; }
  .review-intro { margin:0 0 12px; }
  .revoke-note { margin:8px 0 0; }
  .knew { border-color:#23424a; }
  .knewlist { list-style:none; margin:0; padding:0; }
  .knewlist li { padding:8px 0; border-bottom:1px solid #1c2026; font-size:14px; color:#c8ccd2; }
  .knewlist li:last-child { border-bottom:0; }
  @media (max-width:560px) {
    a.buyer { padding:15px 16px; }
    /* Three actions must stay on one row: the destructive one belongs beside
       its alternatives, not alone under Send where it reads as a primary. */
    .acts .btn { padding-inline:12px; }
  }
  .conv { display:block; background:#14171c; border:1px solid #23272e; border-radius:14px; padding:16px; }
  .conv.needs { border-color:#5a4a1f; background:#181510; }
  .conv:hover { border-color:#3a4250; }
  .conv-h { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .need { color:#fbbf24; font-size:13px; font-weight:600; margin-top:6px; }
  .conv-b { font-size:13px; margin-top:6px; } .conv-m { margin-top:6px; font-size:14px; color:#c8ccd2; }
  .conv-t { font-size:12px; margin-top:8px; }
  .ok-card { text-align:center; padding:12px; } .ok { color:#4ade80; font-size:17px; font-weight:700; }
  .dhead { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:6px; }
  .dhead .who { font-size:15px; }
  .subline { font-size:13px; margin-bottom:12px; }
  .ctx { background:#0f1216; border:1px solid #23272e; border-radius:12px; padding:12px 16px; margin-bottom:16px; font-size:14px; display:flex; flex-direction:column; gap:6px; }
  .card.draft { border-color:#5a4a1f; }
  .proposed { background:#0f1216; border:1px solid #23272e; border-radius:10px; padding:14px; margin-bottom:12px; font-size:15px; white-space:pre-wrap; }
  .acts { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  .editform { display:flex; flex-direction:column; gap:8px; }
  textarea { width:100%; background:#0f1216; border:1px solid #2b313a; border-radius:10px; color:#fff; padding:10px; font:inherit; resize:vertical; }
  .timeline { display:flex; flex-direction:column; gap:12px; }
  .msg { max-width:82%; } .msg.inbound { align-self:flex-start; } .msg.outbound { align-self:flex-end; }
  .bubble { padding:10px 14px; border-radius:14px; font-size:15px; white-space:pre-wrap; word-break:break-word; }
  .msg.inbound .bubble { background:#1b2027; border-start-start-radius:4px; }
  .msg.outbound .bubble { background:#1b3050; border-start-end-radius:4px; }
  .ts { font-size:12px; margin-top:4px; }
  .takeover { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .takeover.warn { border-color:#5a4a1f; } .takeover.owner { border-color:#23424a; flex-direction:column; align-items:stretch; }
  .why { flex-basis:100%; font-size:13px; }
  .lastact { flex-basis:100%; font-size:12px; }
  .replyform { display:flex; flex-direction:column; gap:8px; }
  @media (max-width:560px) { .conv, .card { border-radius:12px; } .msg { max-width:92%; } }
</style>`;
