import { sql } from 'kysely';
import { type Money, usd } from '../../core/types/money.js';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { loadProofLinkState } from './proof.js';
import { loadCurrentRate } from './settings.js';
import { type OwnerRate, convertMoney } from '../../core/commerce/exchange.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, countryName, orderStatusName, capabilityName, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatMoney, formatQty, formatRelative, formatDate } from '../../core/owner/i18n/format.js';
import { ownershipOf, WAITING_HUMAN_AGENT, type ConversationOwnership } from '../../core/conversation/ownership.js';
import { loadRefusals, type Refusal } from './refusals.js';
import { esc, deeper, back } from './layout.js';

/** The stored problem-signal kinds shown as a takeover reason (no classifier). */
const PROBLEM_KINDS = new Set([
  'human_requested', 'complaint', 'repeated_ambiguity', 'low_confidence_image',
  // M34 — she could not hear the question, so she did not answer it.
  'audio_unheard',
]);

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
  readonly unitPrice: Money | null;
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
        unitPrice: r.unit_price !== null ? usd(Number(r.unit_price)) : null,
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

/**
 * M34 — a spoken message, shown as what it is.
 *
 * The buyer's words are in the voice serif like any other person's speech; what
 * distinguishes them is a label saying they were HEARD rather than read, and a
 * form to correct the hearing. The label is not decoration: a transcript the
 * owner believes is a quote is exactly the failure this milestone exists to
 * prevent.
 *
 * When she could not make out the words at all, there is no text to show — so
 * the bubble says so plainly, and the correction form is how the owner supplies
 * what was actually said.
 */
function voiceBubble(locale: Locale, m: TimelineMessage, conversationId: string): string {
  const heardNothing = m.text.trim() === '';
  const body = heardNothing
    ? `<div class="unheard-line muted">🎤 ${esc(t(locale, 'voice.notHeard'))}</div>`
    // The SPOKEN words keep pre-wrap — a buyer's line breaks are his. The
    // wrapper must not: `.bubble` is pre-wrap for exactly that reason, and a
    // multi-element bubble would render this file's own indentation as blank
    // lines inside it.
    : `<div class="said"><bdi>${esc(m.text)}</bdi></div>`;
  // "Heard as" over "She could not make out the words" contradicts itself, so
  // when there is nothing to label the line speaks for itself.
  const label = heardNothing ? null
    : m.heard === 'voice_corrected' ? t(locale, 'voice.corrected') : t(locale, 'voice.heardAs');
  return `<div class="bubble voiced">`
    + (label ? `<div class="heard-label muted">🎤 ${esc(label)}</div>` : '')
    + body
    + (m.originalTranscript ? `<div class="orig muted"><bdi>${esc(m.originalTranscript)}</bdi></div>` : '')
    + (m.id ? `<details class="fixheard"><summary>${esc(t(locale, 'voice.correct'))}</summary>`
        + `<form method="post" action="/app/inbox/${encodeURIComponent(conversationId)}/heard">`
        + `<input type="hidden" name="messageId" value="${esc(m.id)}" />`
        + `<textarea name="heard" rows="2" placeholder="${esc(t(locale, 'voice.correctPlaceholder'))}">${esc(heardNothing ? '' : m.text)}</textarea>`
        + `<button class="btn" type="submit">${esc(t(locale, 'voice.correctSave'))}</button>`
        + `</form></details>` : '')
    + `</div>`;
}

/** ── Conversation detail ─────────────────────────────────────────────────── */

export type TimelineMessage = {
  direction: 'inbound' | 'outbound';
  text: string;
  at: Date | null;
  /**
   * M34 — how these words reached us. 'voice' means the buyer spoke and this is
   * what was heard; 'voice_corrected' means the owner has since said what he
   * actually said, and HER words are the text above. A spoken message reads
   * differently from a typed one, and pretending otherwise is what let an
   * unheard question be answered confidently.
   */
  heard?: 'voice' | 'voice_corrected' | undefined;
  /** The unedited machine reading, kept when the owner has corrected it. */
  originalTranscript?: string | null | undefined;
  /** Message id, so the owner can correct what was heard. */
  id?: string | undefined;
};

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
  readonly quote: { unitPrice: Money; total: Money; quantity: number } | null;
  /**
   * M35.1 — the buyer proof link for this conversation's quote. `quoteId` is
   * null when there is nothing to prove yet; `token` is null until the owner
   * issues one. She is the only person who can create or revoke it.
   */
  readonly proof: { readonly quoteId: string | null; readonly token: string | null };
  readonly order: { status: string; reference: string; total: Money | null } | null;
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
  /** M34 — why a voice note could not be heard, when one could not. */
  readonly unheardReason: string | null;
  readonly lastHumanAction: LastHumanAction | null;
  /**
   * Phase D — which taught facts supported her most recent reply, by LABEL.
   * Answers "why did she say that?" from the M13 usage audit
   * (conversation_events 'knowledge_used' → product_knowledge). Read-only, and
   * empty when she answered without leaning on anything taught.
   */
  readonly knowledgeUsed: readonly string[];
  /**
   * M43b — the rate SHE stated, or null.
   *
   * Carried on the read model rather than fetched by the renderer, because the
   * DATE has to travel with the converted figure: a rate is only trustworthy
   * beside the day she set it, and a renderer that had to look it up would
   * eventually show one without the other.
   */
  readonly rate: OwnerRate | null;
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

    // M34 — `transcription` holds the ORIGINAL machine reading and is never
    // overwritten (archive, never erase); `text_content` holds the words in
    // force. They differ exactly when the owner has corrected a transcript,
    // which is how the surface can show both.
    const messages = (await sql<{
      id: string; direction: string; text_content: string | null; sent_at: Date | null;
      input_type: string; transcription: string | null;
    }>`
      select id, direction, text_content, sent_at, input_type, transcription from messages
       where conversation_id = ${conversationId} order by sent_at asc limit 200
    `.execute(tx)).rows
      .filter((m) => m.text_content !== null || m.input_type === 'voice')
      .map((m): TimelineMessage => {
        const spoken = m.input_type === 'voice' || m.input_type === 'voice_transcribed';
        const corrected = spoken && m.transcription !== null && m.transcription !== m.text_content;
        return {
          direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
          text: m.text_content ?? '',
          at: m.sent_at,
          ...(spoken ? { heard: corrected ? 'voice_corrected' as const : 'voice' as const, id: m.id } : {}),
          ...(corrected ? { originalTranscript: m.transcription } : {}),
        };
      });

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
    const signalRows = (await sql<{ kind: string; payload: Record<string, unknown> | null }>`
      select kind, payload from conversation_signals
       where conversation_id = ${conversationId} and resolved_at is null
    `.execute(tx)).rows;
    const handoffReasons = signalRows.map((r) => r.kind).filter((k) => PROBLEM_KINDS.has(k));
    // M34 — WHY she could not hear it decides what the owner should do about
    // it, so the reason travels to the surface rather than collapsing into
    // "something went wrong".
    const unheardReason = signalRows.find((r) => r.kind === 'audio_unheard')
      ? String((signalRows.find((r) => r.kind === 'audio_unheard')!.payload ?? {})['reason'] ?? 'transcription_failed')
      : null;

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
      quote: q ? { unitPrice: usd(Number(q.unit_price_usd)), total: usd(Number(q.total_usd)), quantity: q.quantity } : null,
      proof: await loadProofLinkState(tx, conversationId),
      order: o ? { status: o.status, reference: o.order_reference, total: o.total_value_usd !== null ? usd(Number(o.total_value_usd)) : null } : null,
      messages,
      pendingDraft: draft
        ? { draftId: draft.id, draftText: draft.draft_text, capability: draft.capability }
        : null,
      ownership: ownershipOf(head.assigned_to),
      refusals,
      handoffReasons,
      unheardReason,
      rate: await loadCurrentRate(tx, bid.value),
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
    return `${title}${tabs}<div class="block">${body}</div>
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
      c.unitPrice !== null ? formatMoney(c.unitPrice) : '',
    ].filter(Boolean).join(' · ');
    return `<a class="buyer" href="/app/inbox/${encodeURIComponent(c.conversationId)}">
      <div class="buyer-top"><span class="who">${who(locale, c.buyer, c.country)}</span>${badge(c)}</div>
      ${detail ? `<div class="buyer-d muted"><bdi>${esc(detail)}</bdi></div>` : ''}
      ${c.latestMessage ? `<div class="buyer-m voice"><bdi>${esc(c.latestMessage.slice(0, 90))}</bdi></div>` : ''}
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

/**
 * M35.1 — the owner's control over the buyer-facing link.
 *
 * It lives beside the quote, because that is the thing being proved. Issuing is
 * one tap; the URL is shown so she can paste it anywhere; revoking is one tap
 * and makes the page a 404 — indistinguishable from a link that never existed.
 */
function proofRow(d: ConversationDetail, locale: Locale): string {
  if (!d.proof.quoteId) return '';
  const cid = encodeURIComponent(d.conversationId);
  if (!d.proof.token) {
    return `<form method="post" action="/app/inbox/${cid}/proof" class="proofrow">
      <span class="muted">${esc(t(locale, 'proof.owner.none'))}</span>
      <button class="btn" type="submit">${esc(t(locale, 'proof.owner.issue'))}</button>
    </form>`;
  }
  return `<div class="proofrow">
    <span class="muted">${esc(t(locale, 'proof.owner.live'))}</span>
    <code class="prooflink">/p/${esc(d.proof.token)}</code>
    <form method="post" action="/app/inbox/${cid}/proof/revoke" class="inline">
      <button class="btn danger" type="submit"
        onclick="return confirm(this.dataset.confirm)"
        data-confirm="${esc(t(locale, 'proof.owner.revokeConfirm'))}"
      >${esc(t(locale, 'proof.owner.revoke'))}</button>
    </form>
  </div>`;
}

/**
 * M43b — the same total, in the money she thinks in. Or nothing at all.
 *
 * ABSENT WHEN SHE HAS NOT STATED A RATE. Not "approximately", not a live rate,
 * not last month's: a figure in ￥ that she did not authorise the arithmetic
 * for is a number from outside her rules, which is the one thing this product
 * refuses everywhere else. She sets a rate on the settings page and it appears.
 *
 * When it does appear, the DATE appears with it, because a rate she set in
 * January is her decision to keep or change and she cannot make that decision
 * without seeing it.
 */
function inHerMoney(total: Money, rate: OwnerRate | null, locale: Locale): string {
  if (!rate) return '';
  const c = convertMoney(total, rate.to, [rate]);
  if (!c.ok) return '';
  return ` · <span class="her-money">${esc(formatMoney(c.value.money))} <span class="muted">${
    esc(t(locale, 'rate.at', { date: formatDate(locale, rate.statedAt) }))}</span></span>`;
}

export function renderConversationDetail(d: ConversationDetail, locale: Locale, now: Date, flash: string | null): string {
  const pcs = t(locale, 'product.unit.pcs');
  const prod = productName(locale, d.product);
  const context = (d.quote || d.order) ? `<div class="ctx">
      ${d.quote ? `<div><span class="muted">${esc(t(locale, 'inbox.ctx.quote'))}</span> ${esc(formatQty(locale, d.quote.quantity))}${esc(pcs)} · ${esc(formatMoney(d.quote.unitPrice))}/${esc(pcs)} · ${esc(t(locale, 'product.detail.total'))} ${esc(formatMoney(d.quote.total))}${inHerMoney(d.quote.total, d.rate, locale)}</div>` : ''}
      ${d.order ? `<div><span class="muted">${esc(t(locale, 'inbox.ctx.order'))}</span> ${esc(d.order.reference)} · ${esc(orderStatusName(locale, d.order.status))}${d.order.total !== null ? ` · ${esc(formatMoney(d.order.total))}` : ''}</div>` : ''}
      ${proofRow(d, locale)}
    </div>` : '';

  const timeline = d.messages.length
    ? `<div class="timeline">${d.messages.map((m) => `
        <div class="msg ${m.direction}">
          ${m.heard ? voiceBubble(locale, m, d.conversationId) : `<div class="bubble"><bdi>${esc(m.text)}</bdi></div>`}
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
    : `<div class="block"><div class="empty muted">${esc(t(locale, 'inbox.draft.none'))}</div></div>`;

  // Phase D — "why did she say that?", from the stored usage audit. Shown only
  // while SHE is speaking: once a human takes over it is no longer the question.
  const knew = d.ownership === 'AI' && d.knowledgeUsed.length > 0
    ? `<div class="block knew"><h2>${esc(t(locale, 'buyers.knew.title'))}</h2>
        <ul class="knewlist">${d.knowledgeUsed.map((k) => `<li>${esc(k)}</li>`).join('')}</ul></div>`
    : '';

  /**
   * M34 — the unheard card. Same three-part shape as a refusal (M22): what
   * happened, why, what you do about it. It sits above the timeline because it
   * explains the silence the owner is about to notice there.
   */
  const unheardCard = d.unheardReason
    ? `<div class="card refused">
        <h3 class="rf-h">${esc(t(locale, 'unheard.title'))}</h3>
        <div class="rf">
          <div class="rf-w">${esc(t(locale, 'unheard.what', { name: EMPLOYEE_NAME[locale] }))}</div>
          <div class="rf-y muted">${esc(t(locale, `unheard.why.${d.unheardReason}` as MessageKey))}</div>
          <div class="rf-d">${esc(t(locale, `unheard.do.${d.unheardReason}` as MessageKey))}</div>
        </div>
      </div>`
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
    ${unheardCard}
    ${refusalCard(d.refusals, locale, now)}
    ${takeoverCard(d, locale, now)}
    ${d.ownership === 'OWNER_CONTROLLED' ? '' : draftCard}
    ${knew}
    ${context}
    <div class="block"><h2>${esc(t(locale, 'inbox.detail.log'))}</h2>${timeline}</div>
    ${INBOX_STYLE}`;
}

const INBOX_STYLE = `<style>
  /* M22 — a refusal is information, not an alarm. Amber, like the disconnected
     channel: something needs the owner, and nothing is broken. */
  .card.refused { border-color:var(--color-highlight); background:var(--color-highlight-wash); }
  .rf-h { font-size:var(--font-size-small); font-weight:600; color:var(--color-ink); margin:0 0 10px; }
  .rf { padding:10px 0; border-top:1px solid var(--color-waiting-wash); }
  .rf:first-of-type { border-top:0; padding-top:0; }
  .rf-w { font-size:var(--font-size-note); color:var(--color-highlight); }
  .rf-y { font-size:var(--font-size-caption); margin-top:3px; line-height:1.55; max-width:62ch; }
  .rf-d { font-size:var(--font-size-note); color:var(--color-ink); margin-top:6px; }
  .rf-t { font-size:var(--font-size-micro); margin-top:4px; }
  /* Phase D — buyers grouped by who is speaking; rows are large touch targets. */
  .bgroup { margin-bottom:26px; }
  .bgroup-h { font-size:var(--font-size-caption); letter-spacing:0; color:var(--color-ink-secondary);
              margin:0 0 12px; font-weight:600; }
  a.buyer { display:block; background:var(--color-surface); border:1px solid var(--color-border); border-radius:14px; padding:16px 18px; }
  a.buyer:hover, a.buyer:focus-visible { border-color:var(--color-jade-line); }
  .buyer-top { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .buyer-d { font-size:var(--font-size-caption); margin-top:6px; }
  .buyer-m { margin-top:8px; font-size:var(--font-size-note); color:var(--color-ink-secondary); }
  .buyer-t { font-size:var(--font-size-micro); margin-top:10px; }
  .tag { font-size:var(--font-size-micro); font-weight:600; padding:5px 11px; border-radius:999px; white-space:nowrap; }
  .tag.now { background:var(--color-waiting-wash); color:var(--color-waiting); }
  .tag.you { background:var(--color-highlight-wash); color:var(--color-highlight); }
  .review-intro { margin:0 0 12px; }
  .revoke-note { margin:8px 0 0; }
  /* M34 — a heard message says so. The label and the superseded reading are the
     product speaking ABOUT the speech, so they stay sans while the words
     themselves keep the voice serif they inherit from .bubble. */
  /* The bubble is pre-wrap so a buyer's own line breaks survive; a voiced
     bubble holds several elements, so the wrapper opts out and the spoken
     words opt back in. Without this the markup's indentation renders as
     blank lines — invisible in tests, obvious in a screenshot. */
  .bubble.voiced { white-space:normal; }
  .bubble.voiced .said { white-space:pre-wrap; }
  .heard-label { font-family:var(--font-family); font-size:var(--font-size-micro); margin-bottom:6px; }
  .unheard-line { font-family:var(--font-family); font-size:var(--font-size-note); }
  .orig { font-size:var(--font-size-caption); margin-top:8px;
          border-inline-start:2px solid var(--color-border); padding-inline-start:10px; }
  .fixheard { margin-top:10px; font-family:var(--font-family); }
  .fixheard summary { font-size:var(--font-size-caption); color:var(--color-ink-secondary); cursor:pointer; }
  .fixheard form { display:flex; flex-direction:column; gap:8px; margin-top:8px; }
  .knew { /* provenance panel, not a state boundary — no card, no tinted border */ }
  .knewlist { list-style:none; margin:0; padding:0; }
  .knewlist li { padding:8px 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-note); color:var(--color-ink-secondary); }
  .knewlist li:last-child { border-bottom:0; }
  @media (max-width:560px) {
    a.buyer { padding:15px 16px; }
    /* Three actions must stay on one row: the destructive one belongs beside
       its alternatives, not alone under Send where it reads as a primary. */
    .acts .btn { padding-inline:12px; }
  }
  .conv { display:block; background:var(--color-surface); border:1px solid var(--color-border); border-radius:14px; padding:16px; }
  .conv.needs { border-color:var(--color-waiting-line); background:var(--color-highlight-wash); }
  .conv:hover { border-color:var(--color-border); }
  .conv-h { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .need { color:var(--color-waiting); font-size:var(--font-size-caption); font-weight:600; margin-top:6px; }
  .conv-b { font-size:var(--font-size-caption); margin-top:6px; } .conv-m { margin-top:6px; font-size:var(--font-size-note); color:var(--color-ink-secondary); }
  .conv-t { font-size:var(--font-size-micro); margin-top:8px; }
  .ok-card { text-align:center; padding:12px; } .ok { color:var(--color-ok); font-size:var(--font-size-base); font-weight:700; }
  .dhead { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:6px; }
  .dhead .who { font-size:var(--font-size-small); }
  .subline { font-size:var(--font-size-caption); margin-bottom:12px; }
  .ctx { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:12px; padding:12px 16px; margin-bottom:16px; font-size:var(--font-size-note); display:flex; flex-direction:column; gap:6px; }
  .card.draft { border-color:var(--color-waiting-line); }
  .acts { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  .editform { display:flex; flex-direction:column; gap:8px; }
  textarea { width:100%; background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:10px; font:inherit; resize:vertical; }
  /* .timeline/.msg/.bubble/.ts/.proposed are the shell's — the speech
     components live in one place so the two voices cannot fork per page. */
  .takeover { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .takeover.warn { border-color:var(--color-waiting-line); } .takeover.owner { border-color:var(--color-highlight-line); flex-direction:column; align-items:stretch; }
  .why { flex-basis:100%; font-size:var(--font-size-caption); }
  .lastact { flex-basis:100%; font-size:var(--font-size-micro); }
  .replyform { display:flex; flex-direction:column; gap:8px; }
  @media (max-width:560px) { .conv, .card { border-radius:12px; } }
</style>`;
