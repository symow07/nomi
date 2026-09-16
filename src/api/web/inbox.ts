import { sql } from 'kysely';
import { type Money, moneyFromRow } from '../../core/types/money.js';
import { withTenantTx, type Db, type Tx } from '../../db/client.js';
import { parseBusinessId, type BusinessId } from '../../core/types/ids.js';
import { loadProofLinkState } from './proof.js';
import { loadCurrentRate } from './settings.js';
import { type Person, type Viewer, OWNER_VIEW, heldByName, actorName } from '../../core/conversation/people.js';
import { tenantRepos } from '../../db/repos.js';
import { type OwnerRate, convertMoney } from '../../core/commerce/exchange.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, countryName, orderStatusName, capabilityName, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatMoney, formatQty, formatRelative, formatDate } from '../../core/owner/i18n/format.js';
import { ownershipOf, WAITING_HUMAN_AGENT, type ConversationOwnership } from '../../core/conversation/ownership.js';
import { loadRefusals, loadUncertainSends, type Refusal, type UncertainSend } from './refusals.js';
import { esc, deeper, back } from './layout.js';
import { PROBLEM_SIGNAL_KINDS } from '../../core/scoring/signals.js';
import { UNREADABLE_KINDS, RECEIVED_KINDS, type UnreadableKind, type ReceivedKind } from '../../core/conversation/inbound.js';
import { isHoldReason, type HoldReason } from '../../core/conversation/hold.js';

/**
 * The stored problem-signal kinds shown as a takeover reason (no classifier).
 * G2c — read from core rather than copied here: the copy on Today had never
 * learned 'audio_unheard', and a third copy is how that happens again.
 */
const PROBLEM_KINDS: ReadonlySet<string> = new Set(PROBLEM_SIGNAL_KINDS);

/** G2c — a stored `received` value, as one of the kinds the owner surface names. */
const unreadableOf = (v: string | null | undefined): UnreadableKind | null =>
  typeof v === 'string' && (UNREADABLE_KINDS as readonly string[]).includes(v) ? v as UnreadableKind : null;

/** G10c — on the timeline, also a photo or voice note she was not allowed to open. */
const receivedOf = (v: string | null | undefined): ReceivedKind | null =>
  typeof v === 'string' && (RECEIVED_KINDS as readonly string[]).includes(v) ? v as ReceivedKind : null;

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
export type InboxFilter = 'pending' | 'all' | 'blocked' | 'mine';
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
  /**
   * M47 — the raw `assigned_to`, so the renderer can name WHICH human holds
   * it. The ownership model is unchanged and still decides whether she may
   * speak; this is only the label beside it.
   */
  readonly heldBy: string | null;
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
  /** G12 — how many this reader is holding. Absent viewer = 0. */
  readonly mineCount?: number;
  /** M22 — conversations holding a message that never reached the buyer. */
  readonly blockedCount: number;
  readonly waitingCount: number;
  readonly conversations: readonly ConversationSummary[];
};

function statusOf(row: { pending: number; assigned_to: string | null; closed_at: Date | null }): { status: InboxStatus; needs: boolean } {
  if (row.pending > 0) return { status: 'awaiting', needs: true };
  // M47 — the ownership module is "the ONLY place its string sentinels are
  // interpreted", and this line was interpreting them.
  if (ownershipOf(row.assigned_to) !== 'AI') return { status: 'paused', needs: false };
  if (row.closed_at !== null) return { status: 'done', needs: false };
  return { status: 'handled', needs: false };
}

export async function loadInboxList(
  db: Db, businessIdRaw: string, filter: InboxFilter,
  /** G12 — who is looking, so 'mine' means the conversations THEY hold. */
  viewerId?: string,
): Promise<InboxList> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { filter, waitingCount: 0, blockedCount: 0, conversations: [] };

  return withTenantTx(db, bid.value, async (tx) => {
    const rows = (await sql<{
      id: string; buyer: string | null; country: string | null;
      name_zh: string | null; name: string | null; qty: number | null;
      assigned_to: string | null; closed_at: Date | null;
      last_text: string | null; last_dir: string | null; last_at: Date | null;
      is_active: boolean; pending: number; unit_price: string | null; quote_currency: string | null; handoff_reason: string | null;
    }>`
      select c.id, cl.display_name as buyer, cl.country,
             p.name_zh, p.name, cs.inquiry_quantity as qty,
             c.assigned_to, c.closed_at, c.is_active,
             lm.text_content as last_text, lm.direction as last_dir, lm.sent_at as last_at,
             (select count(*)::int from drafts d where d.conversation_id = c.id and d.status = 'pending') as pending,
             q.unit_price_usd as unit_price, q.currency as quote_currency,
             sig.kind as handoff_reason
        from conversations c
        left join clients cl on cl.id = c.client_id
        left join conversation_state cs on cs.conversation_id = c.id
        left join products p on p.id = cs.identified_product_id
        left join lateral (select text_content, direction, sent_at from messages m
                            where m.conversation_id = c.id order by m.sent_at desc limit 1) lm on true
        left join lateral (select unit_price_usd, currency from quotes qq
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
        heldBy: r.assigned_to,
        awaitingReview: r.pending > 0,
        handoffReason: r.handoff_reason,
        latestMessage: r.last_text, latestAt: r.last_at,
        product: { name: r.name, nameZh: r.name_zh }, quantity: r.qty ?? null,
        // G18 — in the currency the quote was made in. Rebuilding it as dollars
        // put a "$" in front of a number that was never dollars.
        unitPrice: r.unit_price !== null ? moneyFromRow(Number(r.unit_price), r.quote_currency ?? 'USD') : null,
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

    // G12 — 'mine' is held BY ME: the conversations someone handed to this
    // person, and the ones they took themselves. A staff member has no phone,
    // so this list is the only way a hand-off reaches them.
    const mine = viewerId ? all.filter((c) => c.heldBy === viewerId) : [];
    const conversations = filter === 'pending' ? all.filter(needsOwner)
      : filter === 'blocked' ? blocked
      : filter === 'mine' ? mine
      : all;
    return { filter, waitingCount, blockedCount: blocked.length, mineCount: mine.length, conversations };
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
/**
 * G2c — something the buyer sent that she cannot read, shown as what it is.
 *
 * The label is product voice (sans); his caption, when he wrote one, is his
 * words (the voice serif, like any other thing a person said). A caption
 * shown as a plain bubble would read as a line he typed, with the file it
 * described silently missing.
 */
function receivedBubble(locale: Locale, m: TimelineMessage): string {
  return `<div class="bubble voiced">`
    + `<div class="heard-label muted">📎 ${esc(t(locale, `received.${m.received ?? 'other'}` as MessageKey))}</div>`
    + (m.text.trim() ? `<div class="said"><bdi>${esc(m.text)}</bdi></div>` : '')
    + `</div>`;
}

/** G7b — the price a buyer already has, and the one a held draft would give him. */
export type DraftContradiction = {
  readonly before: { readonly price: Money; readonly quantity: number; readonly at: Date };
  readonly now: { readonly price: Money; readonly quantity: number };
  /** More pieces at a higher price each — the worse of M36's two cases. */
  readonly largerQuantity: boolean;
};

/**
 * Read back from the event payload the turn wrote. Anything malformed, or in
 * a currency this build cannot price, is dropped rather than shown half-right:
 * a wrong "before" price on this card is exactly the error it exists to catch.
 */
function contradictionOf(raw: unknown): DraftContradiction | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as {
    prior?: { quantity?: unknown; unitPrice?: { amount?: unknown; currency?: unknown }; at?: unknown };
    proposedUnitPrice?: { amount?: unknown; currency?: unknown };
    proposedQuantity?: unknown; how?: unknown;
  };
  const money = (m?: { amount?: unknown; currency?: unknown }) =>
    m && typeof m.amount === 'number' && typeof m.currency === 'string' ? moneyFromRow(m.amount, m.currency) : null;
  const before = money(c.prior?.unitPrice);
  const now = money(c.proposedUnitPrice);
  const at = typeof c.prior?.at === 'string' ? new Date(c.prior.at) : null;
  const bq = c.prior?.quantity; const nq = c.proposedQuantity;
  if (!before || !now || !at || Number.isNaN(at.getTime()) || typeof bq !== 'number' || typeof nq !== 'number') return null;
  return {
    before: { price: before, quantity: bq, at }, now: { price: now, quantity: nq },
    largerQuantity: c.how === 'higher_at_larger_quantity',
  };
}

const stringsOf = (raw: unknown): readonly string[] =>
  Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

/**
 * G8 — the hits from her LATEST turn only. The event and the turn row are
 * written in one transaction, so they share its timestamp; once a later turn
 * runs clean, the card is gone rather than lingering after she fixed it.
 */
async function herWordsOf(tx: Tx, conversationId: string): Promise<NonNullable<ConversationDetail['herWords']>> {
  const row = (await sql<{ hits: unknown }>`
    select e.payload->'hits' as hits from conversation_events e
     where e.conversation_id = ${conversationId} and e.type = 'forbidden_in_her_text'
       and e.created_at >= coalesce((select max(t.created_at) from turns t
                                      where t.conversation_id = ${conversationId}), '-infinity'::timestamptz)
     order by e.id desc limit 1`.execute(tx)).rows[0];
  const hits = Array.isArray(row?.hits) ? row.hits as { term?: unknown; path?: unknown }[] : [];
  return (['taught_answer', 'order_status'] as const).flatMap((path) => {
    const terms = [...new Set(hits.filter((h) => h.path === path && typeof h.term === 'string').map((h) => h.term as string))];
    return terms.length ? [{ path, terms }] : [];
  });
}

/** Her words, quoted the way each locale quotes. */
const quoted = (locale: Locale, terms: readonly string[]): string =>
  locale === 'zh' ? terms.map((x) => `「${x}」`).join('')
    : locale === 'ar' ? terms.map((x) => `«${x}»`).join('، ')
      : terms.map((x) => `“${x}”`).join(', ');

function contradictionBlock(c: DraftContradiction, locale: Locale): string {
  const line = (label: string, price: Money, quantity: number) =>
    `<div><span class="muted">${esc(label)}</span> <b><bdi>${esc(formatMoney(price))}</bdi></b> <span class="muted">${
      esc(t(locale, 'inbox.draft.contradicts.for', { qty: formatQty(locale, quantity) }))}</span></div>`;
  return `<div class="held-then">
      ${line(t(locale, 'inbox.draft.contradicts.before', { date: formatDate(locale, c.before.at) }), c.before.price, c.before.quantity)}
      ${line(t(locale, 'inbox.draft.contradicts.now'), c.now.price, c.now.quantity)}
      ${c.largerQuantity ? `<div class="muted">${esc(t(locale, 'inbox.draft.contradicts.larger'))}</div>` : ''}
    </div>`;
}

function voiceBubble(locale: Locale, m: TimelineMessage, conversationId: string): string {
  const heardNothing = m.text.trim() === '';
  /**
   * G13 — THE RECORDING ITSELF. M34 asks her to type what the buyer said about
   * a note she had no way to hear: the provider's handle for the audio lived
   * only in the job that processed it. `preload="none"` so a conversation of
   * twenty notes does not fetch twenty files from WhatsApp to render a page.
   */
  const player = m.id && m.playable
    ? `<audio class="voiceplay" controls preload="none" src="/app/inbox/${encodeURIComponent(conversationId)}/voice/${encodeURIComponent(m.id)}"></audio>`
    : m.id ? `<div class="muted heard-label">${esc(t(locale, 'voice.noRecording'))}</div>` : '';
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
    + player
    + body
    + (m.originalTranscript ? `<div class="orig muted"><bdi>${esc(m.originalTranscript)}</bdi></div>` : '')
    + (m.id ? `<details class="fixheard"><summary>${esc(t(locale, 'voice.correct'))}</summary>`
        + `<form method="post" action="/app/inbox/${encodeURIComponent(conversationId)}/heard">`
        + `<input type="hidden" name="messageId" value="${esc(m.id)}" />`
        + `<textarea name="heard" rows="2" placeholder="${esc(t(locale, 'voice.correctPlaceholder'))}">${esc(heardNothing ? '' : m.text)}</textarea>`
        + `<button class="btn" type="submit">${esc(t(locale, 'voice.correctSave'))}</button>`
        + `</form>`
        // G13 — her words are words she wants answered. This runs the ordinary
        // turn on them; nothing about it skips a guard or a price rule.
        + (m.heard === 'voice_corrected'
          ? `<form method="post" action="/app/inbox/${encodeURIComponent(conversationId)}/answer-now" class="answernow">`
            + `<input type="hidden" name="messageId" value="${esc(m.id)}" />`
            + `<button class="btn send" type="submit">${esc(t(locale, 'voice.answerNow'))}</button>`
            + `</form>`
          : '')
        + `</details>` : '')
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
  /**
   * G2c — something she cannot read arrived: a document, a video, a location.
   * The bubble names it, and shows his caption when he wrote one, so a file
   * never reads as a line he typed.
   */
  received?: ReceivedKind | undefined;
  /** G13 — the provider still has a handle for this audio, so it can be played. */
  playable?: boolean | undefined;
};

/** M16.2c — the human control-plane event kinds, in conversation_events. */
export type HumanActionType = 'takeover' | 'owner_reply' | 'resume_ai' | 'draft_resolved' | 'handed_to';
const HUMAN_ACTION_TYPES = ['takeover', 'owner_reply', 'resume_ai', 'draft_resolved', 'handed_to'] as const;

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
  /** G12 — for a hand-off, the colleague it went TO. */
  readonly to?: string | null;
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
  readonly proof: {
    readonly quoteId: string | null; readonly token: string | null;
    /** G11 — the link as a BUYER would open it. Null when no public address is set. */
    readonly url?: string | null;
  };
  readonly order: { status: string; reference: string; total: Money | null; id: string } | null;
  readonly messages: readonly TimelineMessage[];
  readonly pendingDraft: {
    draftId: string; draftText: string; capability: string;
    /**
     * G7a — why her own rules held it, when they did. Read from the
     * `draft_pending` event the turn wrote beside the draft; absent for a
     * draft that waited only because the capability is in draft.
     */
    heldBecause?: HoldReason | null;
    /** G7b — the price he already has, beside the one this draft states. */
    contradicts?: DraftContradiction | null;
    /** G8 — the owner's words that kept stopping a reply she could not write. */
    forbidden?: readonly string[];
  } | null;
  readonly ownership: ConversationOwnership;
  /** M47/G12 — WHICH human holds it, raw. The ownership model reads it; this names it. */
  readonly heldBy?: string | null;
  /**
   * M22 — messages in THIS conversation that never reached the buyer. The
   * evidence is `outbound_messages.cancel_reason`, written by the worker when
   * `gateOutbound` refused; nothing here re-decides anything.
   */
  readonly refusals: readonly Refusal[];
  /**
   * 0052 — messages the provider was asked to send and never answered about.
   * Nobody can say whether the buyer has them, so they wait here for a person:
   * the one decision this product will not make on her behalf, because both
   * answers can reach him.
   */
  readonly uncertainSends: readonly UncertainSend[];
  readonly handoffReasons: readonly string[];   // unresolved problem-signal kinds
  /** M34 — why a voice note could not be heard, when one could not. */
  readonly unheardReason: string | null;
  /**
   * G2c — what arrived that she could not read, when something did. Optional
   * so a detail built before G2c (a test fixture, the sandbox) still types.
   */
  readonly unreadable?: UnreadableKind | null;
  readonly lastHumanAction: LastHumanAction | null;
  /**
   * G9b — who works here, so an actor id is read as a NAME. Actor columns
   * hold person ids since G9b; a raw uuid on her screen is not a name.
   */
  readonly people?: readonly Person[];
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
  /**
   * M44 — why the most recent quote promised no delivery date.
   *
   * The BUYER is told nothing about her calendar; this is the owner's own
   * explanation, on the screen where she would otherwise wonder why a lead time
   * she has always quoted went missing.
   */
  readonly leadTimeBlocked: { readonly label: string; readonly from: Date; readonly to: Date } | null;
  /**
   * G8 — on her latest turn, a word the owner forbade was found in the owner's
   * OWN text (her taught answer, or the order-status line), so that text was
   * not sent. Not the employee's failure, and not counted as one; shown so she
   * can fix the answer.
   */
  readonly herWords?: readonly { readonly path: 'order_status' | 'taught_answer'; readonly terms: readonly string[] }[];
  /**
   * M45 — this buyer asked for a sample, and whether she has stated a policy.
   *
   * `policyStated: false` is the case worth showing: Nomi said nothing about
   * samples because there was nothing of hers to say, and the buyer is
   * waiting. The card names the next thing to tap.
   */
  readonly sampleAsked: { readonly policyStated: boolean } | null;
};

export async function loadConversationDetail(
  db: Db, businessIdRaw: string, conversationId: string,
  /**
   * Injected, like every other clock on this surface. It was `new Date()`
   * inside the loader, which is the shape that produces a test passing all day
   * and failing once at a boundary — and the shape this repo already avoids
   * everywhere else: the ROUTE reads the clock, the loader is given it.
   */
  now: Date = new Date(),
): Promise<ConversationDetail | null> {
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
      input_type: string; transcription: string | null; received: string | null;
      media: string | null;
    }>`
      select id, direction, text_content, sent_at, input_type, transcription,
             ai_analysis->>'received' as received, provider_media_id as media
        from messages
       where conversation_id = ${conversationId} order by sent_at asc limit 200
    `.execute(tx)).rows
      // G2c — something she could not read is SHOWN, named, even with no
      // caption: a file the buyer sent must not be invisible to the owner. A
      // reaction or a sticker is recorded and left out — nothing was asked.
      .filter((m) => m.text_content !== null || m.input_type === 'voice' || receivedOf(m.received) !== null)
      .map((m): TimelineMessage => {
        const spoken = m.input_type === 'voice' || m.input_type === 'voice_transcribed';
        const corrected = spoken && m.transcription !== null && m.transcription !== m.text_content;
        const received = m.input_type === 'unknown' ? receivedOf(m.received) : null;
        return {
          direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
          text: m.text_content ?? '',
          at: m.sent_at,
          ...(spoken ? { heard: corrected ? 'voice_corrected' as const : 'voice' as const, id: m.id } : {}),
          ...(corrected ? { originalTranscript: m.transcription } : {}),
          ...(received ? { received } : {}),
          // G13 — a note recorded before 0043 has no handle, and says so.
          ...(spoken && m.media ? { playable: true } : {}),
        };
      });

    const q = (await sql<{
      unit_price_usd: string; total_usd: string; quantity: number; product_id: string; currency: string;
      lead_time_withheld: { label?: unknown; from?: unknown; to?: unknown } | null;
    }>`
      select unit_price_usd, total_usd, quantity, product_id, currency, lead_time_withheld from quotes
       where conversation_id = ${conversationId} order by created_at desc limit 1
    `.execute(tx)).rows[0];

    // G4 — the BUYER's latest order, not only one confirmed in this
    // conversation. Confirming closes the conversation; when he writes again
    // weeks later it is a new one, and the owner reading his "where is my
    // order?" must see — and reach — the order he is asking about.
    const o = (await sql<{ id: string; status: string; order_reference: string; total_value_usd: string | null; currency: string }>`
      select o.id::text as id, o.status, o.order_reference, o.total_value_usd, o.currency from orders o
       where o.client_id = (select client_id from conversations where id = ${conversationId})
       order by o.created_at desc limit 1
    `.execute(tx)).rows[0];

    // G7a/G7b — why her rules held it, and the prices behind that, from the
    // `draft_pending` event the turn wrote beside THIS draft.
    const draft = (await sql<{ id: string; draft_text: string; capability: string; pending: Record<string, unknown> | null }>`
      select d.id, d.draft_text, d.capability,
             (select e.payload from conversation_events e
               where e.conversation_id = d.conversation_id and e.type = 'draft_pending'
                 and e.payload->>'draftId' = d.id::text
               order by e.id desc limit 1) as pending
        from drafts d where d.conversation_id = ${conversationId} and d.status = 'pending'
       order by d.created_at desc limit 1
    `.execute(tx)).rows[0];

    // M22 — what did not reach this buyer. Read through the shared loader, so
    // the conversation, the inbox tab and Today can never disagree. Its own
    // tenant transaction (it is a read model, not a fragment of this query).
    const refusals = await loadRefusals(db, businessIdRaw, { conversationId });
    const uncertainSends = await loadUncertainSends(db, businessIdRaw, { conversationId });

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
    // G2c — and WHAT arrived that she could not read, so the owner knows what
    // to go and look at rather than only that something went wrong.
    const unreadableRow = signalRows.find((r) => r.kind === 'media_unreadable');
    const unreadable = unreadableRow
      ? (unreadableOf(String((unreadableRow.payload ?? {})['received'] ?? 'other')) ?? 'other')
      : null;

    // M16.2c "what happened last?": the latest human action — kind + actor + time
    // only. payload->>'actor' is a human/agent id, never buyer data; no body read.
    const lastAct = (await sql<{ type: string; actor: string | null; to: string | null; at: Date | null }>`
      select type, payload->>'actor' as actor, payload->>'to' as to, created_at as at
        from conversation_events
       where conversation_id = ${conversationId}
         and type in ('takeover', 'owner_reply', 'resume_ai', 'draft_resolved', 'handed_to')
       order by created_at desc, id desc limit 1
    `.execute(tx)).rows[0];
    const lastHumanAction: LastHumanAction | null =
      lastAct && (HUMAN_ACTION_TYPES as readonly string[]).includes(lastAct.type)
        ? { type: lastAct.type as HumanActionType, actor: lastAct.actor, to: lastAct.to, at: lastAct.at }
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

    const quoteUnit = q ? moneyFromRow(Number(q.unit_price_usd), q.currency) : null;
    const quoteTotal = q ? moneyFromRow(Number(q.total_usd), q.currency) : null;

    const st = statusOf({ pending: head.pending, assigned_to: head.assigned_to, closed_at: head.closed_at });
    return {
      conversationId: head.id, buyer: head.buyer, country: head.country, status: st.status,
      product: { name: head.name, nameZh: head.name_zh }, quantity: head.qty ?? null,
      // G18 — both halves in the quote's OWN currency, and no dollar fallback:
      // a row whose currency this build cannot price is a row it must not put a
      // "$" in front of, so the context line is left off instead.
      quote: quoteUnit && quoteTotal && q ? { unitPrice: quoteUnit, total: quoteTotal, quantity: q.quantity } : null,
      proof: await loadProofLinkState(tx, conversationId),
      order: o ? {
        id: o.id, status: o.status, reference: o.order_reference,
        total: o.total_value_usd !== null ? moneyFromRow(Number(o.total_value_usd), o.currency) : null,
      } : null,
      messages,
      pendingDraft: draft
        ? { draftId: draft.id, draftText: draft.draft_text, capability: draft.capability,
            heldBecause: isHoldReason(draft.pending?.['heldBecause']) ? draft.pending['heldBecause'] : null,
            contradicts: contradictionOf(draft.pending?.['contradicts']),
            forbidden: stringsOf(draft.pending?.['forbidden']) }
        : null,
      ownership: ownershipOf(head.assigned_to),
      heldBy: head.assigned_to,
      refusals,
      uncertainSends,
      handoffReasons,
      unheardReason,
      unreadable,
      rate: await loadCurrentRate(tx, bid.value),
      leadTimeBlocked: withheldFrom(q?.lead_time_withheld ?? null),
      herWords: await herWordsOf(tx, conversationId),
      sampleAsked: await sampleAsk(tx, bid.value, conversationId),
      lastHumanAction,
      people: (await sql<{ id: string; name: string; is_owner: boolean }>`
        select id::text as id, name, is_owner from people
         where business_id = ${bid.value}::uuid and archived_at is null`.execute(tx))
        .rows.map((p) => ({ id: p.id, name: p.name, isOwner: p.is_owner })),
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

export function renderInboxList(
  data: InboxList, locale: Locale, now: Date,
  /**
   * M47 — the people who can hold a conversation, for naming WHO holds each
   * one. Absent (the default) reads exactly as it did before this milestone:
   * "yours". A single-owner installation sees no change at all.
   */
  people: readonly Person[] = [],
): string {
  const name = EMPLOYEE_NAME[locale];
  const pcs = t(locale, 'product.unit.pcs');
  const tab = (f: InboxFilter) =>
    `<a class="tab ${data.filter === f ? 'on' : ''}" href="/app/inbox?filter=${f}">${esc(t(locale, `inbox.filter.${f}` as MessageKey))}${f === 'pending' && data.waitingCount > 0 ? ` (${data.waitingCount})` : ''}${f === 'mine' && (data.mineCount ?? 0) > 0 ? ` (${data.mineCount})` : ''}${f === 'blocked' && data.blockedCount > 0 ? ` (${data.blockedCount})` : ''}</a>`;
  // M22 — `blocked` is not a permanent tab. It appears when something did not
  // reach a buyer, or when the owner arrived here from Today's link, and
  // disappears again once there is nothing to show. An always-present tab that
  // is almost always empty trains the owner to ignore it.
  const showBlocked = data.blockedCount > 0 || data.filter === 'blocked';
  // G12 — 'Mine' appears once there is more than one person here. With a
  // single owner every conversation is hers, and a tab that filters nothing
  // is a tab that teaches her to ignore tabs.
  const showMine = people.length > 1;
  const tabs = `<div class="tabs">${tab('pending')}${tab('all')}${showMine ? tab('mine') : ''}${showBlocked ? tab('blocked') : ''}</div>`;
  const title = `<h1 class="page">${esc(t(locale, 'nav.inbox'))}</h1>`;

  if (data.conversations.length === 0) {
    const body = data.filter === 'pending'
      ? `<div class="empty"><div class="ok">✓ ${esc(t(locale, 'buyers.empty.calm'))}</div>
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
    if (c.ownership === 'OWNER_CONTROLLED') {
      // WHICH human. With nobody added, `heldByName` resolves the old sentinel
      // and the label is the one this page always showed.
      const who = people.length === 0 ? null : heldByName(c.heldBy, people, {
        ai: EMPLOYEE_NAME[locale], waiting: t(locale, 'people.held.waiting'),
        owner: t(locale, 'people.held.owner'), gone: t(locale, 'people.held.gone'),
      });
      return `<span class="tag you">${esc(who ? t(locale, 'people.holding', { who }) : t(locale, 'buyers.badge.yours'))}</span>`;
    }
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
function lastActionLine(a: LastHumanAction, locale: Locale, now: Date, people: readonly Person[], viewer: Viewer): string {
  // G9b — a name, never an id: "Xiao Chen replied", or "you" for the reader.
  // G12 — and for a hand-off, the name that matters is who it went TO.
  const who = actorName(a.type === 'handed_to' ? a.to ?? null : a.actor, people, viewer, {
    you: t(locale, 'takeover.actor.you'), owner: t(locale, 'people.held.owner'), gone: t(locale, 'people.held.gone'),
  });
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
/**
 * 0052 — "we do not know whether this went." Her words are shown back, because
 * what she is judging is whether a second copy would embarrass her, and the two
 * buttons are the whole decision. No default, no countdown: nothing happens
 * until a person chooses.
 */
function uncertainCard(us: readonly UncertainSend[], locale: Locale, now: Date): string {
  if (us.length === 0) return '';
  return `<div class="card unsure">
    <h3 class="rf-h">${esc(t(locale, 'unsure.title'))}</h3>
    ${us.map((u) => `<div class="rf">
      <div class="rf-w">${esc(t(locale, 'unsure.what'))}</div>
      <blockquote class="unsure-q" dir="auto">${esc(u.body)}</blockquote>
      <div class="rf-y muted">${esc(t(locale, 'unsure.why'))}</div>
      <div class="rf-t muted">${esc(formatRelative(locale, u.at, now))}</div>
      <div class="unsure-a">
        <form method="post" action="/app/outbound/${esc(u.outboundId)}/send-again" class="inline">
          <button class="btn send" type="submit">${esc(t(locale, 'unsure.again'))}</button></form>
        <form method="post" action="/app/outbound/${esc(u.outboundId)}/leave" class="inline">
          <button class="btn" type="submit">${esc(t(locale, 'unsure.leave'))}</button></form>
      </div>
    </div>`).join('')}
  </div>`;
}

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
function takeoverCard(d: ConversationDetail, locale: Locale, now: Date, viewer: Viewer): string {
  const cid = encodeURIComponent(d.conversationId);
  const reasons = d.handoffReasons.length
    ? `<div class="why muted">${esc(t(locale, 'takeover.why'))}: ${d.handoffReasons.map((k) => esc(t(locale, `takeover.reason.${k}` as MessageKey))).join('、')}</div>`
    : '';
  const last = d.lastHumanAction ? lastActionLine(d.lastHumanAction, locale, now, d.people ?? [], viewer) : '';
  const takeBtn = `<form method="post" action="/app/inbox/${cid}/takeover" class="inline"><button class="btn ${d.ownership === 'WAITING_HUMAN' ? 'send' : ''}" type="submit">${esc(t(locale, 'takeover.action.take'))}</button></form>`;

  /**
   * G12 — pass it to the colleague who can answer it. Offered once there is
   * more than one person here, and never back to whoever already holds it.
   * A staff member has no phone number, so this list is how they learn a
   * conversation is theirs.
   */
  const others = (d.people ?? []).filter((p) => p.id !== d.heldBy);
  const handToForm = others.length === 0 ? '' : `
    <form method="post" action="/app/inbox/${cid}/handto" class="handto">
      <label class="muted" for="handto">${esc(t(locale, 'handto.label'))}</label>
      <select id="handto" name="personId" required>
        ${others.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
      </select>
      <button class="btn" type="submit">${esc(t(locale, 'handto.button'))}</button>
    </form>`;

  // G12 — whose it is, by name. "You're handling this" is only true for the
  // person holding it; to anyone else it is a colleague's conversation.
  const mine = d.heldBy === undefined || d.heldBy === null
    || (viewer.id !== undefined && d.heldBy === viewer.id)
    || (d.heldBy === 'owner' && viewer.isOwner);
  const ownerPill = mine
    ? esc(t(locale, 'takeover.status.owner'))
    : esc(t(locale, 'people.holding', {
        who: actorName(d.heldBy ?? null, d.people ?? [], viewer, {
          you: t(locale, 'takeover.actor.you'), owner: t(locale, 'people.held.owner'), gone: t(locale, 'people.held.gone'),
        }),
      }));

  switch (d.ownership) {
    case 'AI':
      return `<div class="card takeover"><span class="pill ok">${esc(t(locale, 'takeover.status.ai'))}</span>${last}${takeBtn}${handToForm}</div>`;
    case 'WAITING_HUMAN':
      return `<div class="card takeover warn"><span class="pill warn">${esc(t(locale, 'takeover.status.waiting'))}</span>${reasons}${last}${takeBtn}${handToForm}</div>`;
    case 'OWNER_CONTROLLED':
      return `<div class="card takeover owner">
        <span class="pill owner">${ownerPill}</span>
        ${last}
        ${handToForm}
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
  // G11 — the whole link, or the plain reason it cannot be sent. A relative
  // path was never something she could paste to a buyer.
  return `<div class="proofrow">
    <span class="muted">${esc(t(locale, d.proof.url ? 'proof.owner.live' : 'proof.owner.noAddress'))}</span>
    ${d.proof.url ? `<code class="prooflink"><bdi>${esc(d.proof.url)}</bdi></code>` : ''}
    <form method="post" action="/app/inbox/${cid}/proof/revoke" class="inline">
      <button class="btn danger" type="submit"
        onclick="return confirm(this.dataset.confirm)"
        data-confirm="${esc(t(locale, 'proof.owner.revokeConfirm'))}"
      >${esc(t(locale, 'proof.owner.revoke'))}</button>
    </form>
  </div>`;
}

/**
 * M44 — did a closure she stated withhold the date this quote would have
 * promised?
 *
 * G5 — READ FROM THE QUOTE, no longer re-derived. This used to re-run the
 * closure check against TODAY's closures, on the view that the calendar is hers
 * and may change. But the card says "no delivery date was promised", which is a
 * statement about what the QUOTE said — and a closure added after a date was
 * promised made the card state the opposite of what the buyer was told. The
 * quote now records what it said (0040); the buyer's proof page and this card
 * read the same record, so they cannot disagree.
 */
function withheldFrom(
  stored: { label?: unknown; from?: unknown; to?: unknown } | null,
): { label: string; from: Date; to: Date } | null {
  if (!stored || typeof stored.label !== 'string') return null;
  const from = new Date(String(stored.from ?? ''));
  const to = new Date(String(stored.to ?? ''));
  return Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())
    ? null : { label: stored.label, from, to };
}

/**
 * M45 — did this buyer ask for a sample, and could she be answered?
 *
 * Two rows, no inference: the request exists because the buyer's own words
 * matched, and the policy exists because the owner wrote it.
 */
async function sampleAsk(
  tx: Tx, businessId: BusinessId, conversationId: string,
): Promise<{ policyStated: boolean } | null> {
  const asked = (await sql<{ id: string }>`
    select id from sample_requests
     where business_id = ${businessId} and conversation_id = ${conversationId}
       and handled_at is null limit 1`.execute(tx)).rows[0];
  if (!asked) return null;
  return { policyStated: (await tenantRepos(tx, businessId).catalog.samplePolicy()) !== null };
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

export function renderConversationDetail(
  d: ConversationDetail, locale: Locale, now: Date, flash: string | null, viewer: Viewer = OWNER_VIEW,
): string {
  const pcs = t(locale, 'product.unit.pcs');
  const prod = productName(locale, d.product);
  const context = (d.quote || d.order) ? `<div class="ctx">
      ${d.quote ? `<div><span class="muted">${esc(t(locale, 'inbox.ctx.quote'))}</span> ${esc(formatQty(locale, d.quote.quantity))}${esc(pcs)} · ${esc(formatMoney(d.quote.unitPrice))}/${esc(pcs)} · ${esc(t(locale, 'product.detail.total'))} ${esc(formatMoney(d.quote.total))}${inHerMoney(d.quote.total, d.rate, locale)}</div>` : ''}
      ${d.order ? `<div><span class="muted">${esc(t(locale, 'inbox.ctx.order'))}</span> ${esc(d.order.reference)} · ${esc(orderStatusName(locale, d.order.status))}${d.order.total !== null ? ` · ${esc(formatMoney(d.order.total))}${inHerMoney(d.order.total, d.rate, locale)}` : ''}
        <a class="deeper" href="/app/orders/${esc(d.order.id)}">${esc(t(locale, 'order.open'))}<span class="go" aria-hidden="true">›</span></a></div>` : ''}
      ${proofRow(d, locale)}
    </div>` : '';

  const timeline = d.messages.length
    ? `<div class="timeline">${d.messages.map((m) => `
        <div class="msg ${m.direction}">
          ${m.heard ? voiceBubble(locale, m, d.conversationId)
            : m.received ? receivedBubble(locale, m)
            : `<div class="bubble"><bdi>${esc(m.text)}</bdi></div>`}
          <div class="ts muted">${m.at ? esc(formatRelative(locale, m.at, now)) : ''} · ${m.direction === 'inbound' ? esc(t(locale, 'common.buyer')) : esc(EMPLOYEE_NAME[locale])}</div>
        </div>`).join('')}</div>`
    : `<div class="empty muted">${esc(t(locale, 'inbox.detail.noMessages'))}</div>`;

  const draftCard = d.pendingDraft
    ? `<div class="card draft" role="region">
        <h2>${esc(t(locale, 'buyers.review.title'))}</h2>
        <p class="muted review-intro">${esc(t(locale, 'buyers.review.intro', { buyer: d.buyer ?? t(locale, 'common.buyer') }))}</p>
        ${d.pendingDraft.heldBecause
          ? `<p class="held-why" role="note">${esc(t(locale, `inbox.draft.held.${d.pendingDraft.heldBecause}` as MessageKey, { name: EMPLOYEE_NAME[locale] }))}</p>`
          : ''}
        ${d.pendingDraft.contradicts ? contradictionBlock(d.pendingDraft.contradicts, locale) : ''}
        ${d.pendingDraft.forbidden?.length
          ? `<p class="held-why muted"><bdi>${esc(t(locale, 'inbox.draft.held.words', { terms: quoted(locale, d.pendingDraft.forbidden) }))}</bdi></p>`
          : ''}
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

  /**
   * G2c — the same three parts for something she could not open: what
   * arrived, why she did not answer, what the owner does about it.
   */
  const unreadableCard = d.unreadable
    ? `<div class="card refused">
        <h3 class="rf-h">${esc(t(locale, 'unreadable.title'))}</h3>
        <div class="rf">
          <div class="rf-w">${esc(t(locale, 'unreadable.what', {
            name: EMPLOYEE_NAME[locale],
            what: t(locale, `received.${d.unreadable}` as MessageKey),
          }))}</div>
          <div class="rf-y muted">${esc(t(locale, 'unreadable.why'))}</div>
          <div class="rf-d">${esc(t(locale, 'unreadable.do'))}</div>
        </div>
      </div>`
    : '';

  /**
   * G10c — someone not on her pilot list wrote. Same three parts: what came,
   * why she did not answer, and the two things the owner can do about it.
   */
  const unlistedCard = d.handoffReasons.includes('unlisted_number')
    ? `<div class="card refused">
        <h3 class="rf-h">${esc(t(locale, 'unlisted.title'))}</h3>
        <div class="rf">
          <div class="rf-w">${esc(t(locale, 'unlisted.what', { name: EMPLOYEE_NAME[locale] }))}</div>
          <div class="rf-y muted">${esc(t(locale, 'unlisted.why', { name: EMPLOYEE_NAME[locale] }))}</div>
          <div class="rf-d"><a href="/app/factory">${esc(t(locale, 'unlisted.do'))}</a></div>
        </div>
      </div>`
    : '';

  /**
   * M44 — she promised no date, and this says which of her own closures is the
   * reason. Same three-part shape as the refusal and unheard cards: what
   * happened, why, and what she can go and do about it.
   */
  const closedCard = d.leadTimeBlocked
    ? `<div class="card refused">
        <h3 class="rf-h">${esc(t(locale, 'closures.blocked.title'))}</h3>
        <div class="rf">
          <div class="rf-y muted">${esc(t(locale, 'closures.blocked.body', {
            label: d.leadTimeBlocked.label,
            from: formatDate(locale, d.leadTimeBlocked.from),
            to: formatDate(locale, d.leadTimeBlocked.to),
          }))}</div>
          <div class="rf-d"><a href="/app/settings/closures">${
            esc(t(locale, 'closures.blocked.action'))}</a></div>
        </div>
      </div>`
    : '';

  /**
   * G8 — her own text carried a word she forbade. Same three-part shape: what
   * happened, why, and where she fixes it.
   */
  const herWordsCard = d.herWords?.length
    ? `<div class="card refused">
        <h3 class="rf-h">${esc(t(locale, 'herwords.title'))}</h3>
        ${d.herWords.map((w) => `<div class="rf">
          <div class="rf-y muted"><bdi>${esc(t(locale, `herwords.${w.path}` as MessageKey, { terms: quoted(locale, w.terms), name: EMPLOYEE_NAME[locale] }))}</bdi></div>
          <div class="rf-d"><a href="${w.path === 'taught_answer' ? '/app/knowledge' : '/app/settings/forbidden'}">${
            esc(t(locale, `herwords.action.${w.path}` as MessageKey))}</a></div>
        </div>`).join('')}
      </div>`
    : '';

  /**
   * M45 — she is told that a sample was asked for, and when she has stated
   * nothing, that THAT is why Nomi did not answer. Same three-part shape as
   * every other card here: what happened, why, what to do about it.
   */
  const sampleCard = d.sampleAsked
    ? `<div class="card${d.sampleAsked.policyStated ? '' : ' refused'}">
        <h3 class="rf-h">${esc(t(locale, 'samples.asked.title'))}</h3>
        ${d.sampleAsked.policyStated ? '' : `<div class="rf">
          <div class="rf-y muted">${esc(t(locale, 'samples.asked.unstated', { name: EMPLOYEE_NAME[locale] }))}</div>
          <div class="rf-d"><a href="/app/settings/samples">${esc(t(locale, 'samples.asked.action'))}</a></div>
        </div>`}
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
    ${unreadableCard}
    ${unlistedCard}
    ${closedCard}
    ${herWordsCard}
    ${sampleCard}
    ${uncertainCard(d.uncertainSends, locale, now)}
    ${refusalCard(d.refusals, locale, now)}
    ${takeoverCard(d, locale, now, viewer)}
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
  .rf-h { font-size:var(--font-size-small); font-weight:600; color:var(--color-ink); margin:0 0 var(--space-12); }
  .rf { padding:10px 0; border-top:1px solid var(--color-waiting-wash); }
  .rf:first-of-type { border-top:0; padding-top:0; }
  .rf-w { font-size:var(--font-size-note); color:var(--color-highlight); }
  .rf-y { font-size:var(--font-size-caption); margin-top:var(--space-4); line-height:1.55; max-width:var(--measure-prose); }
  .rf-d { font-size:var(--font-size-note); color:var(--color-ink); margin-top:var(--space-8); }
  .rf-t { font-size:var(--font-size-micro); margin-top:var(--space-4); }
  /* 0052 — a question, not a refusal: the same amber, plus her own words and
     the two answers. Nothing is pre-selected, because nothing may happen by
     itself here. */
  .card.unsure { border-color:var(--color-highlight); background:var(--color-highlight-wash); }
  .unsure-q { margin:var(--space-8) 0 0; padding:var(--space-8) var(--space-12);
    border-inline-start:2px solid var(--color-highlight); background:var(--color-paper);
    font-size:var(--font-size-note); color:var(--color-ink); max-width:var(--measure-prose);
    white-space:pre-wrap; }
  .unsure-a { display:flex; gap:var(--space-8); margin-top:var(--space-12); flex-wrap:wrap; }
  /* Phase D — buyers grouped by who is speaking; rows are large touch targets. */
  .bgroup { margin-bottom:var(--space-24); }
  .bgroup-h { font-size:var(--font-size-caption); letter-spacing:0; color:var(--color-ink-secondary);
              margin:0 0 var(--space-12); font-weight:600; }
  a.buyer { display:block; background:var(--color-surface); border:1px solid var(--color-border); border-radius:14px; padding:16px 18px; }
  a.buyer:hover, a.buyer:focus-visible { border-color:var(--color-jade-line); }
  .buyer-top { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); flex-wrap:wrap; }
  .buyer-d { font-size:var(--font-size-caption); margin-top:var(--space-8); }
  .buyer-m { margin-top:var(--space-8); font-size:var(--font-size-note); color:var(--color-ink-secondary); }
  .buyer-t { font-size:var(--font-size-micro); margin-top:var(--space-12); }
  .tag { font-size:var(--font-size-micro); font-weight:600; padding:5px 11px; border-radius:999px; white-space:nowrap; }
  .tag.now { background:var(--color-waiting-wash); color:var(--color-waiting); }
  .tag.you { background:var(--color-highlight-wash); color:var(--color-highlight); }
  .review-intro { margin:0 0 var(--space-12); }
  .draft .held-why { margin:0 0 var(--space-12); font-size:var(--font-size-note); color:var(--color-waiting); }
  .draft .held-then { display:flex; flex-direction:column; gap:var(--space-4); margin:0 0 var(--space-12); font-size:var(--font-size-note); }
  .draft .held-then b { font-weight:600; }
  .voiceplay { display:block; margin:var(--space-8) 0; }
  .answernow { margin-top:var(--space-8); }
  .handto { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-8);
            margin-top:var(--space-12); font-size:var(--font-size-note); }
  .proofrow { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-8);
              margin-top:var(--space-12); font-size:var(--font-size-note); }
  .prooflink { overflow-wrap:anywhere; color:var(--color-ink-secondary); }
  .revoke-note { margin:var(--space-8) 0 0; }
  /* M34 — a heard message says so. The label and the superseded reading are the
     product speaking ABOUT the speech, so they stay sans while the words
     themselves keep the voice serif they inherit from .bubble. */
  /* The bubble is pre-wrap so a buyer's own line breaks survive; a voiced
     bubble holds several elements, so the wrapper opts out and the spoken
     words opt back in. Without this the markup's indentation renders as
     blank lines — invisible in tests, obvious in a screenshot. */
  .bubble.voiced { white-space:normal; }
  .bubble.voiced .said { white-space:pre-wrap; }
  .heard-label { font-family:var(--font-family); font-size:var(--font-size-micro); margin-bottom:var(--space-8); }
  .unheard-line { font-family:var(--font-family); font-size:var(--font-size-note); }
  .orig { font-size:var(--font-size-caption); margin-top:var(--space-8);
          border-inline-start:2px solid var(--color-border); padding-inline-start:10px; }
  .fixheard { margin-top:var(--space-12); font-family:var(--font-family); }
  .fixheard summary { font-size:var(--font-size-caption); color:var(--color-ink-secondary); cursor:pointer; }
  .fixheard form { display:flex; flex-direction:column; gap:var(--space-8); margin-top:var(--space-8); }
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
  .conv-h { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); }
  .need { color:var(--color-waiting); font-size:var(--font-size-caption); font-weight:600; margin-top:var(--space-8); }
  .conv-b { font-size:var(--font-size-caption); margin-top:var(--space-8); } .conv-m { margin-top:var(--space-8); font-size:var(--font-size-note); color:var(--color-ink-secondary); }
  .conv-t { font-size:var(--font-size-micro); margin-top:var(--space-8); }
  .ok { color:var(--color-ok); font-size:var(--font-size-base); font-weight:700; }
  .dhead { display:flex; align-items:center; gap:var(--space-12); flex-wrap:wrap; margin-bottom:var(--space-8); }
  .dhead .who { font-size:var(--font-size-small); }
  .subline { font-size:var(--font-size-caption); margin-bottom:var(--space-12); }
  .ctx { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:12px; padding:12px 16px; margin-bottom:var(--space-16); font-size:var(--font-size-note); display:flex; flex-direction:column; gap:var(--space-4); }
  .card.draft { border-color:var(--color-waiting-line); }
  .acts { display:flex; gap:var(--space-8); flex-wrap:wrap; margin-bottom:var(--space-16); }
  .editform { display:flex; flex-direction:column; gap:var(--space-8); }
  textarea { width:100%; background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:10px; font:inherit; resize:vertical; }
  /* .timeline/.msg/.bubble/.ts/.proposed are the shell's — the speech
     components live in one place so the two voices cannot fork per page. */
  .takeover { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; }
  .takeover.warn { border-color:var(--color-waiting-line); } .takeover.owner { border-color:var(--color-highlight-line); flex-direction:column; align-items:stretch; }
  .why { flex-basis:100%; font-size:var(--font-size-caption); }
  .lastact { flex-basis:100%; font-size:var(--font-size-micro); }
  .replyform { display:flex; flex-direction:column; gap:var(--space-8); }
  @media (max-width:560px) { .conv, .card { border-radius:12px; } }
</style>`;
