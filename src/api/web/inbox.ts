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
import { countryName, orderStatusName, capabilityName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName, outreachShown } from './say.js';
import { formatMoney, formatQty, formatRelative, formatDate, formatList, labelled } from '../../core/owner/i18n/format.js';
import { ownershipOf, type ConversationOwnership } from '../../core/conversation/ownership.js';
import { loadRefusals, loadUncertainSends, type Refusal, type UncertainSend } from './refusals.js';
import { esc, deeper, back, conversationUrl } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import { PROBLEM_SIGNAL_KINDS } from '../../core/scoring/signals.js';
import { UNREADABLE_KINDS, RECEIVED_KINDS, type UnreadableKind, type ReceivedKind } from '../../core/conversation/inbound.js';
import { isHoldReason, type HoldReason } from '../../core/conversation/hold.js';
import { loadTranscriptWindow } from '../../db/transcript.js';
import { waitingAskOf } from '../../db/deletionAsks.js';
import { buyerDeletionOf } from './dataRights.js';
import { deletionDueBy } from '../../core/ops/deletions.js';
import { readBuyersPage, readBuyerCounts, searchOf, DELETION_WAITING, type BuyersFilter } from '../../db/buyersList.js';

/** A conversation id as Postgres stores one; anything else names no conversation. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
export type InboxFilter = BuyersFilter;
type InboxStatus = 'awaiting' | 'paused' | 'done' | 'handled';

/**
 * A — who wrote a conversation's newest message: the buyer, a person here
 * (the owner or a colleague), or the assistant.
 */
export type LastFrom = 'buyer' | 'person' | 'assistant';

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
  /** A5 — which assistant answers it. Set only when the business has more than one. */
  readonly answeredBy?: string | null;
  /** Phase D — her reply is written and waiting for you to review it. */
  readonly awaitingReview: boolean;
  /** The stored problem-signal that caused the handoff. Never inferred. */
  readonly handoffReason: string | null;
  /**
   * 0076 — a deletion request noted from this conversation waits for the
   * owner. It leads the list as its own group, whoever holds the conversation.
   * Optional so a summary built before 0076 still types.
   */
  readonly deletionWaiting?: boolean;
  readonly latestMessage: string | null;
  /** A — the last contact: when the newest message was written, either way. */
  readonly latestAt: Date | null;
  readonly product: { readonly name: string | null; readonly nameZh: string | null };
  readonly quantity: number | null;
  readonly unitPrice: Money | null;
  /**
   * A — what Customers carried and Buyers did not. The channel the
   * conversation is on; optional so a summary built before A still types.
   */
  readonly channel?: string;
  /**
   * A — "unread", as the stored messages can say it: the buyer's message is
   * the newest, and nothing has answered it. (Nothing records who has READ
   * a conversation; the buyer still waiting is the fact that exists.)
   */
  readonly unanswered?: boolean;
  /** A — who wrote the newest message. Absent: no message yet, or a summary from before A. */
  readonly lastFrom?: LastFrom;
};

export type InboxList = {
  readonly filter: InboxFilter;
  /** G12 — how many this reader is holding. Absent viewer = 0. */
  readonly mineCount?: number;
  /** M22 — conversations holding a message that never reached the buyer. */
  readonly blockedCount: number;
  /** 0076 — conversations with a deletion request waiting for the owner. Absent = none. */
  readonly deletionCount?: number;
  readonly waitingCount: number;
  readonly conversations: readonly ConversationSummary[];
  /** A — the search, as it was matched (trimmed); absent or '' when there is none. */
  readonly query?: string;
  /**
   * A — where this page sits in the whole list the tab and the search hold.
   * Absent on a list built before A: one page, nothing either side.
   */
  readonly page?: {
    readonly from: number; readonly to: number; readonly total: number;
    readonly next: string | null;
    readonly prev: { readonly cursor: string | null } | null;
  };
  /** A — how many channels the workspace's conversations are on; a row names its channel only past one. */
  readonly channels?: number;
};

function statusOf(row: { pending: number; assigned_to: string | null; closed_at: Date | null }): { status: InboxStatus; needs: boolean } {
  if (row.pending > 0) return { status: 'awaiting', needs: true };
  // M47 — the ownership module is "the ONLY place its string sentinels are
  // interpreted", and this line was interpreting them.
  if (ownershipOf(row.assigned_to) !== 'AI') return { status: 'paused', needs: false };
  if (row.closed_at !== null) return { status: 'done', needs: false };
  return { status: 'handled', needs: false };
}

/** The request's own words for the list: which tab, the search, and which page. */
export type InboxAsk = {
  /** The search box, as typed; anything that is not text is no search. */
  readonly q?: unknown;
  /** A cursor from a "Next page" door. */
  readonly after?: unknown;
  /** A cursor from a "Previous page" door. */
  readonly before?: unknown;
};

/**
 * A — the Buyers list: one page of the tab (and the search), in the order
 * the page groups it, with the counts of everything.
 *
 * The page, its place in the list and the tab counts are `src/db/buyersList.ts`;
 * this reads what each row shows, for the page's conversations only.
 */
export async function loadInboxList(
  db: Db, businessIdRaw: string, filter: InboxFilter,
  /** G12 — who is looking, so 'mine' means the conversations THEY hold. */
  viewerId?: string,
  ask: InboxAsk = {},
): Promise<InboxList> {
  const q = searchOf(ask.q);
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { filter, waitingCount: 0, blockedCount: 0, conversations: [], query: q };

  return withTenantTx(db, bid.value, async (tx) => {
    const page = await readBuyersPage(tx, { filter, ...(viewerId ? { viewerId } : {}), q, after: ask.after, before: ask.before });
    const rows = page.ids.length === 0 ? [] : (await sql<{
      id: string; buyer: string | null; country: string | null; channel: string;
      name_zh: string | null; name: string | null; qty: number | null;
      assigned_to: string | null; closed_at: Date | null;
      last_text: string | null; last_dir: string | null; last_at: Date | null; last_origin: string | null;
      pending: number; unit_price: string | null; quote_currency: string | null; handoff_reason: string | null;
      answered_by: string | null; assistants: number; deletion_waiting: boolean;
    }>`
      select c.id::text as id, cl.display_name as buyer, cl.country, c.channel,
             coalesce(
               (select a.name from assistants a where a.id = c.assistant_id),
               (select a.name from assistants a
                 where a.business_id = c.business_id and a.is_default and a.archived_at is null)) as answered_by,
             (select count(*)::int from assistants a
               where a.business_id = c.business_id and a.archived_at is null) as assistants,
             p.name_zh, p.name, cs.inquiry_quantity as qty,
             c.assigned_to, c.closed_at,
             lm.text_content as last_text, lm.direction as last_dir, lm.sent_at as last_at,
             -- D4 — who wrote an outbound message: the sent row it was copied from.
             (select o.origin from outbound_messages o
               where o.id = (case when lm.direction = 'outbound' and lm.external_id ~ '^out:[0-9a-f-]{36}$'
                                  then substr(lm.external_id, 5)::uuid end)) as last_origin,
             (select count(*)::int from drafts d where d.conversation_id = c.id and d.status = 'pending') as pending,
             q.unit_price_usd as unit_price, q.currency as quote_currency,
             sig.kind as handoff_reason,
             ${DELETION_WAITING} as deletion_waiting
        from conversations c
        left join clients cl on cl.id = c.client_id
        left join conversation_state cs on cs.conversation_id = c.id
        left join products p on p.id = cs.identified_product_id
        left join lateral (select text_content, direction, sent_at, external_id from messages m
                            where m.conversation_id = c.id order by m.sent_at desc, m.id desc limit 1) lm on true
        left join lateral (select unit_price_usd, currency from quotes qq
                            where qq.conversation_id = c.id order by qq.created_at desc limit 1) q on true
        left join lateral (select kind from conversation_signals cs
                            where cs.conversation_id = c.id and cs.resolved_at is null
                              and cs.kind = any(${sql.raw(`array[${[...PROBLEM_KINDS].map((k) => `'${k}'`).join(',')}]`)})
                            -- 0075: a deletion request is the reason to show whatever else
                            -- came with it ("delete my data, and get me a person").
                            order by (cs.kind = 'deletion_requested') desc, cs.created_at desc limit 1) sig on true
       where c.id = any(${[...page.ids]}::uuid[])
    `.execute(tx)).rows;

    // The page's order is the list's (`readBuyersPage`); the details come back in any order.
    const byId = new Map(rows.map((r) => [r.id, r]));
    const conversations = page.ids.flatMap((id): ConversationSummary[] => {
      const r = byId.get(id);
      if (!r) return [];
      const st = statusOf({ pending: r.pending, assigned_to: r.assigned_to, closed_at: r.closed_at });
      const lastFrom: LastFrom | undefined = r.last_dir === 'inbound' ? 'buyer'
        : r.last_dir === 'outbound' ? (r.last_origin === 'owner' ? 'person' : 'assistant') : undefined;
      return [{
        conversationId: r.id, buyer: r.buyer, country: r.country,
        status: st.status, needsAction: st.needs,
        ownership: ownershipOf(r.assigned_to),
        heldBy: r.assigned_to,
        answeredBy: r.assistants > 1 ? r.answered_by : null,
        awaitingReview: r.pending > 0,
        handoffReason: r.handoff_reason,
        deletionWaiting: r.deletion_waiting,
        latestMessage: r.last_text, latestAt: r.last_at,
        product: { name: r.name, nameZh: r.name_zh }, quantity: r.qty ?? null,
        // G18 — in the currency the quote was made in. Rebuilding it as dollars
        // put a "$" in front of a number that was never dollars.
        unitPrice: r.unit_price !== null ? moneyFromRow(Number(r.unit_price), r.quote_currency ?? 'USD') : null,
        channel: r.channel,
        unanswered: lastFrom === 'buyer',
        ...(lastFrom ? { lastFrom } : {}),
      }];
    });

    // A9 — THE COUNTS ARE OF EVERYTHING, never of the page: `defaultFilter`
    // decides which tab opens from `waitingCount`.
    const counts = await readBuyerCounts(tx, viewerId);
    return {
      filter, conversations,
      waitingCount: counts.waiting,
      blockedCount: counts.blocked,
      mineCount: counts.mine,
      deletionCount: counts.deletion,
      channels: counts.channels,
      query: q,
      page: { from: page.from, to: page.to, total: page.total, next: page.next, prev: page.prev },
    };
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
  return `<div dir="auto" class="bubble voiced">`
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
  return `<div dir="auto" class="bubble voiced">`
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
  /**
   * D4 — WHO wrote this. An outbound message the OWNER typed was signed with
   * her employee's name, so a conversation she had taken over read as though
   * the employee had said it. Read from the outbound row's own `origin`; absent
   * on a message from before outbound rows carried one, which reads as hers.
   */
  by?: 'owner' | 'employee' | 'outreach' | undefined;
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
  /**
   * A5 — which assistant answers this conversation. Named only when the
   * business has more than one: with one, saying so tells her nothing.
   */
  readonly answeredBy?: string | null;
  /**
   * A5.2 — the name every sentence on THIS page says: the conversation's own
   * assistant, else the main one. Null when the business has no row yet.
   */
  readonly assistantName?: string | null;
  /**
   * A5.4 — who she could hand this buyer to: every live assistant, with the one
   * answering now marked. Present only when there is more than one.
   */
  readonly assistantChoices?: readonly { readonly id: string; readonly name: string; readonly current: boolean }[];
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
  /** CC-25 — one window of the transcript (the newest, unless `transcript.older`), oldest first. */
  readonly messages: readonly TimelineMessage[];
  /**
   * CC-25 — which window `messages` is. `earlier` is the cursor for the
   * messages before it (null when it starts the conversation); `older` marks a
   * window further back than the newest. Absent reads as the newest window with
   * nothing before it, which is what a fixture built before CC-25 describes.
   */
  readonly transcript?: { readonly earlier: string | null; readonly older: boolean };
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
    /**
     * The buyer has already had the AI disclosure, sent in place of this text
     * because he asked what he was talking to and this did not say. The card
     * says so, and the approval path refuses to send this wording unchanged.
     */
    disclosureSent?: boolean;
    /** CC-24 — the owner's edit of this draft, kept when its send was refused. */
    ownerEdit?: string | null;
  } | null;
  /** CC-24 — the owner's own reply, kept when it was refused before it could be queued. */
  readonly ownerUnsentReply?: string | null;
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
  /**
   * 0076 — the deletion request noted from this buyer's message, while it waits
   * for the owner; and one the owner already recorded. They outlive the
   * hand-off's reason, which handing the conversation back clears. Optional so
   * a detail built before 0076 (a fixture, the sandbox) still types.
   */
  readonly deletionAsk?: { readonly askedAt: Date } | null;
  readonly deletionRecorded?: { readonly askedAt: Date } | null;
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
  /**
   * CC-25 — the request's `before`, as it arrived: the cursor for an older
   * window of the transcript. Anything that is not one is the newest window.
   */
  before: unknown = null,
): Promise<ConversationDetail | null> {
  const bid = parseBusinessId(businessIdRaw);
  // An address that cannot name a conversation is not found — it used to reach
  // Postgres as a uuid it could not parse, and came back as the crash page.
  if (!bid.ok || !UUID.test(conversationId)) return null;

  return withTenantTx(db, bid.value, async (tx) => {
    const head = (await sql<{
      id: string; buyer: string | null; country: string | null;
      name_zh: string | null; name: string | null; qty: number | null;
      assigned_to: string | null; closed_at: Date | null; pending: number;
      answered_by: string | null; assistants: number; owner_unsent_reply: string | null;
    }>`
      select c.id, cl.display_name as buyer, cl.country, p.name_zh, p.name,
             cs.inquiry_quantity as qty, c.assigned_to, c.closed_at, c.owner_unsent_reply,
             -- A5: the conversation's own assistant; one that started before
             -- there was a second belongs to the main one.
             coalesce(
               (select a.name from assistants a where a.id = c.assistant_id),
               (select a.name from assistants a
                 where a.business_id = c.business_id and a.is_default and a.archived_at is null)) as answered_by,
             (select count(*)::int from assistants a
               where a.business_id = c.business_id and a.archived_at is null) as assistants,
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
    //
    // CC-25 — the NEWEST window, not the oldest two hundred: on a long thread
    // the question she was about to answer was not on the page at all.
    const transcript = await loadTranscriptWindow(tx, head.id, before);
    const messages = transcript.rows
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
          ...(m.origin === 'owner' || m.origin === 'outreach' ? { by: m.origin } : {}),
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
    const draft = (await sql<{ id: string; draft_text: string; capability: string; owner_edit: string | null; pending: Record<string, unknown> | null }>`
      select d.id, d.draft_text, d.capability, d.owner_edit,
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
      transcript: { earlier: transcript.earlier, older: transcript.older },
      pendingDraft: draft
        ? { draftId: draft.id, draftText: draft.draft_text, capability: draft.capability,
            heldBecause: isHoldReason(draft.pending?.['heldBecause']) ? draft.pending['heldBecause'] : null,
            contradicts: contradictionOf(draft.pending?.['contradicts']),
            forbidden: stringsOf(draft.pending?.['forbidden']),
            disclosureSent: draft.pending?.['disclosureSent'] === true,
            ownerEdit: draft.owner_edit }
        : null,
      ownerUnsentReply: head.owner_unsent_reply,
      ownership: ownershipOf(head.assigned_to),
      heldBy: head.assigned_to,
      answeredBy: head.assistants > 1 ? head.answered_by : null,
      assistantName: head.answered_by,
      ...(head.assistants > 1 ? { assistantChoices: (await sql<{ id: string; name: string; current: boolean }>`
        select a.id::text as id, a.name,
               a.id = coalesce((select c.assistant_id from conversations c where c.id = ${conversationId}),
                               (select d.id from assistants d
                                 where d.business_id = a.business_id and d.is_default and d.archived_at is null)) as current
          from assistants a
         where a.business_id = ${bid.value}::uuid and a.archived_at is null
         order by a.is_default desc, a.created_at`.execute(tx)).rows } : {}),
      refusals,
      uncertainSends,
      handoffReasons,
      deletionAsk: await waitingAskOf(tx, conversationId).then((a) => (a ? { askedAt: a.askedAt } : null)),
      deletionRecorded: await buyerDeletionOf(tx, conversationId)
        .then((r) => (r?.state === 'open' ? { askedAt: r.askedAt } : null)),
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
// which contradicts the ownership the page states; ownership is the truth.
const statusPill = (locale: Locale, status: InboxStatus, needs: boolean): string =>
  `<span class="pill ${needs ? 'warn' : 'ok'}">${needs ? '● ' : ''}${esc(t(locale, `inbox.status.${status}` as MessageKey))}</span>`;

/**
 * The buyer, in one inline run: flag, name, country. The name is isolated, so
 * a Latin name inside an Arabic line keeps its own order and the separator
 * stays between the two (the conversation page's header and the buyer's page
 * draw the same run).
 */
export const buyerWho = (locale: Locale, buyer: string | null, country: string | null): string => {
  const name = buyer ?? t(locale, 'common.buyer');
  const cn = countryName(locale, country);
  const f = flag(country);
  return `${f ? `${f} ` : ''}<b><bdi>${esc(name)}</bdi></b>${cn ? `<span class="muted"> · ${esc(cn)}</span>` : ''}`;
};

/**
 * D3 — every channel a conversation can be on has a name in the catalogue, and
 * this reads it. Two had none (`email`, `messenger`) and two were spelled out
 * here instead, so the page printed `conv.channel.email` at the owner as though
 * it were a word.
 */
export const channelName = (locale: Locale, c: string): string => t(locale, `conv.channel.${c}` as MessageKey);

/**
 * The row's glimpse of the last message: its first ninety characters, counted
 * as characters — cutting by UTF-16 units split an emoji into a broken glyph.
 */
const preview = (text: string): string => Array.from(text).slice(0, 90).join('');

/**
 * A — an address on the Buyers list that keeps what the owner is looking at:
 * the tab, the search, the page. The search is written as typed; only the five
 * characters that would change what the address means are escaped, so a name
 * in any script puts no `%` into the page (the owner surface's rule) and the
 * browser encodes the rest on the way out. A cursor is digits, hex, `-` and
 * `_` already (`src/db/buyersList.ts`).
 */
const buyersHref = (o: {
  readonly filter?: InboxFilter; readonly q?: string;
  readonly after?: string | null; readonly before?: string | null;
}): string => {
  const typed = (v: string): string => v
    .replace(/[%&+#=]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\s/g, '+');
  const parts = [
    o.filter ? `filter=${o.filter}` : '',
    o.q ? `q=${typed(o.q)}` : '',
    o.after ? `after=${o.after}` : '',
    o.before ? `before=${o.before}` : '',
  ].filter(Boolean);
  return `/app/inbox${parts.length ? `?${parts.join('&')}` : ''}`;
};

/**
 * A — Buyers: every conversation the business has, one list (Customers was
 * the same people a second time). A search box over it; the tabs; the groups
 * by who is speaking; one page at a time, with doors to the pages either side
 * and where this one sits in the whole — the counts are of everything.
 *
 * The row is decision 5's: it stays as it is (2026-09-28). What Customers
 * carried that the row did not is said in the row's own time line: who wrote
 * the last message — the transcript's idiom, so a reply never reads as the
 * buyer's words — and the channel, once there is more than one.
 */
export function renderInboxList(
  data: InboxList, locale: Locale, now: Date,
  /**
   * M47 — the people who can hold a conversation, for naming WHO holds each
   * one. Absent (the default) reads exactly as it did before this milestone:
   * "yours". A single-owner installation sees no change at all.
   */
  people: readonly Person[] = [],
): string {
  const name = assistantName(locale);
  const pcs = t(locale, 'product.unit.pcs');
  const q = data.query ?? '';
  const count = (n: number | undefined) => (n ?? 0) > 0 ? ` (${formatQty(locale, n ?? 0)})` : '';
  const tab = (f: InboxFilter) => {
    const on = data.filter === f;
    const n = f === 'pending' ? count(data.waitingCount) : f === 'mine' ? count(data.mineCount)
      : f === 'blocked' ? count(data.blockedCount) : f === 'deletion' ? count(data.deletionCount) : '';
    return `<a class="tab${on ? ' on' : ''}"${on ? ' aria-current="page"' : ''} href="${esc(buyersHref({ filter: f }))}">${
      esc(t(locale, `inbox.filter.${f}` as MessageKey))}${n}</a>`;
  };
  // M22 — `blocked` is not a permanent tab. It appears when something did not
  // reach a buyer, or when the owner arrived here from Today's link, and
  // disappears again once there is nothing to show. An always-present tab that
  // is almost always empty trains the owner to ignore it.
  const showBlocked = data.blockedCount > 0 || data.filter === 'blocked';
  // G12 — 'Mine' appears once there is more than one person here. With a
  // single owner every conversation is hers, and a tab that filters nothing
  // is a tab that teaches her to ignore tabs.
  const showMine = people.length > 1;
  // 0076 — like `blocked`: there while a deletion request waits for the
  // owner, or when Today's row brought her here, and gone again after.
  const showDeletion = (data.deletionCount ?? 0) > 0 || data.filter === 'deletion';
  const tabs = `<nav class="tabs" aria-label="${esc(t(locale, 'buyers.tabs'))}">${tab('pending')}${tab('all')}${
    showMine ? tab('mine') : ''}${showBlocked ? tab('blocked') : ''}${showDeletion ? tab('deletion') : ''}</nav>`;
  const title = `<h1 class="page">${esc(t(locale, 'nav.inbox'))}</h1>`;

  // A — the search. A find, not a view: it looks across every buyer (the
  // route reads a search with no tab as All), and the tabs leave it behind.
  const search = `<form class="search" method="get" action="/app/inbox" role="search">
      <input type="search" name="q" value="${esc(q)}" placeholder="${esc(t(locale, 'buyers.search.placeholder'))}" aria-label="${esc(t(locale, 'buyers.search.label'))}" />
      <button class="btn" type="submit">${esc(t(locale, 'buyers.search.go'))}</button>
      ${q ? `<a class="clear" href="/app/inbox">${esc(t(locale, 'buyers.search.clear'))}</a>` : ''}
    </form>`;
  const page = data.page;
  const total = page?.total ?? data.conversations.length;
  const found = q && data.conversations.length > 0
    ? `<p class="caption muted" role="status">${esc(t(locale, 'buyers.search.found', { q, n: formatQty(locale, total) }))}</p>` : '';
  const position = page ? t(locale, 'buyers.page.position', {
    from: formatQty(locale, page.from), to: formatQty(locale, page.to), total: formatQty(locale, page.total),
  }) : '';
  // Not the first page: say where this is before the rows start.
  const where = page && page.prev ? `<p class="caption muted">${esc(position)}</p>` : '';

  // M38 — the wider list: everyone the assistant may write to, not only who
  // wrote in. D — a door only where the outreach area exists. A — Customers
  // carried it; it moved here with the list.
  const doors = `<div class="doors">${deeper('/app/calendar', t(locale, 'calendar.door'))}${
    outreachShown() ? deeper('/app/contacts', t(locale, 'contacts.title')) : ''}</div>`;
  const head = `${title}${search}${tabs}${found}${where}`;

  if (data.conversations.length === 0) {
    const body = q
      ? `<div class="empty">${esc(t(locale, 'buyers.search.none', { q }))}<br><span class="muted">${esc(t(locale, 'buyers.search.noneBody'))}</span>
          <div>${deeper(esc(buyersHref({ filter: 'all' })), t(locale, 'inbox.empty.seeAll'))}</div></div>`
      : data.filter === 'pending'
      ? `<div class="empty"><div class="ok-line">✓ ${esc(t(locale, 'buyers.empty.calm'))}</div>
          <p class="muted">${esc(t(locale, 'inbox.empty.allGoodBody'))} <a href="${esc(buyersHref({ filter: 'all' }))}">${esc(t(locale, 'inbox.empty.seeAll'))}</a></p></div>`
      // M22 — nothing was refused. Stated as the fact it is; not a ✓, because
      // "no message failed" is the normal state and not an achievement.
      : data.filter === 'deletion'
      ? `<div class="empty">${esc(t(locale, 'inbox.empty.deletion'))}
          <div>${deeper(esc(buyersHref({ filter: 'all' })), t(locale, 'inbox.empty.seeAll'))}</div></div>`
      : data.filter === 'blocked'
      ? `<div class="empty">${esc(t(locale, 'refused.none'))}
          <div>${deeper(esc(buyersHref({ filter: 'all' })), t(locale, 'inbox.empty.seeAll'))}</div></div>`
      : `<div class="empty">${esc(t(locale, 'inbox.empty.none'))}<br><span class="muted">${esc(t(locale, 'inbox.empty.noneBody'))}</span>
          <div>${deeper('/app/factory', t(locale, 'inbox.empty.setup'))}</div></div>`;
    return `${head}<div class="block">${body}</div>${doors}`;
  }

  // Phase D — an owner thinks in people, and the question that orders them is
  // "who is speaking now?". Grouped through the ONE ownership model, never by an
  // internal status code — and by the same four predicates the list is ORDERED
  // by (`src/db/buyersList.ts`), so a page is a run of whole groups.
  //
  // 0076 — a buyer who asked for their data to be deleted is not one more
  // hand-off in the pile: their own group, first and always headed, whoever
  // holds the conversation, until the owner decides on the buyer's page.
  const deletion = data.conversations.filter((c) => c.deletionWaiting === true);
  const rest     = data.conversations.filter((c) => !deletion.includes(c));
  const needsYou = rest.filter((c) => c.ownership === 'WAITING_HUMAN' || c.awaitingReview);
  const yours    = rest.filter((c) => c.ownership === 'OWNER_CONTROLLED' && !needsYou.includes(c));
  const hers     = rest.filter((c) => !needsYou.includes(c) && !yours.includes(c));

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
        ai: assistantName(locale), waiting: t(locale, 'people.held.waiting'),
        owner: t(locale, 'people.held.owner'), gone: t(locale, 'people.held.gone'),
      });
      return `<span class="tag you">${esc(who ? t(locale, 'people.holding', { who }) : t(locale, 'buyers.badge.yours'))}</span>`;
    }
    return '';
  };

  // A5's rule, for the channel: named on every row only once there is more than one.
  const showChannel = (data.channels ?? 0) > 1;
  const row = (c: ConversationSummary) => {
    const prod = productName(locale, c.product);
    // Each part isolated on its own: one isolate around the whole line let
    // Arabic reorder a Latin product name, a quantity and a price into one
    // run ("5,0001.45$"). The separators sit between them, in the page's direction.
    const detail = [
      prod ?? '',
      c.quantity !== null ? `${formatQty(locale, c.quantity)}${pcs}` : '',
      c.unitPrice !== null ? formatMoney(c.unitPrice) : '',
    ].filter(Boolean).map((x) => `<bdi>${esc(x)}</bdi>`).join(' · ');
    // Who wrote the newest message — the transcript's words for each speaker.
    const speaker = c.lastFrom === 'buyer' ? t(locale, 'common.buyer')
      : c.lastFrom === 'person' ? t(locale, 'conv.by.you')
      : c.lastFrom === 'assistant' ? (c.answeredBy ?? name) : null;
    const meta = [
      c.latestAt ? esc(formatRelative(locale, c.latestAt, now)) : '',
      speaker ? `<bdi>${esc(speaker)}</bdi>` : '',
      showChannel && c.channel ? esc(channelName(locale, c.channel)) : '',
      c.answeredBy && speaker !== c.answeredBy ? `<bdi>${esc(t(locale, 'conv.answeredBy', { who: c.answeredBy }))}</bdi>` : '',
    ].filter(Boolean).join(' · ');
    // CC-25 — a buyer opens on the newest message, the reply waiting under it.
    return `<a class="buyer${c.unanswered ? ' unanswered' : ''}" href="${conversationUrl(c.conversationId)}">
      <div class="buyer-top"><span class="who">${buyerWho(locale, c.buyer, c.country)}</span>${badge(c)}</div>
      ${detail ? `<div class="buyer-d muted">${detail}</div>` : ''}
      ${c.latestMessage ? `<div class="buyer-m voice" dir="auto"><bdi>${esc(preview(c.latestMessage))}</bdi></div>` : ''}
      ${meta ? `<div class="buyer-t muted">${meta}</div>` : ''}
    </a>`;
  };

  const heads = data.filter === 'all';
  const group = (label: string, items: readonly ConversationSummary[], always = false) =>
    items.length ? `<section class="bgroup">
      ${heads || always ? `<h2 class="bgroup-h">${esc(label)}</h2>` : ''}
      <div class="list">${items.map(row).join('')}</div></section>` : '';

  // A — the doors either side of this page, and where it sits in the whole.
  const pager = page && (page.prev || page.next)
    ? `<nav class="pager" aria-label="${esc(t(locale, 'buyers.page.nav'))}">
        ${page.prev ? back(esc(buyersHref({ filter: data.filter, q, before: page.prev.cursor })), t(locale, 'buyers.page.prev')) : ''}
        <span class="caption muted">${esc(position)}</span>
        ${page.next ? deeper(esc(buyersHref({ filter: data.filter, q, after: page.next })), t(locale, 'buyers.page.next')) : ''}
      </nav>` : '';

  return `${head}
    ${group(t(locale, 'buyers.group.deletion'), deletion, true)}
    ${group(t(locale, 'buyers.group.needsYou'), needsYou)}
    ${group(t(locale, people.length > 1 ? 'buyers.group.team' : 'buyers.group.yours'), yours)}
    ${group(t(locale, 'buyers.group.hers', { name }), hers)}
    ${pager}
    ${doors}`;
}

/** "What happened last?" — a localized one-liner: kind + who + when. No body. */
function lastActionLine(a: LastHumanAction, locale: Locale, now: Date, people: readonly Person[], viewer: Viewer): string {
  // G9b — a name, never an id: "Xiao Chen replied", or "you" for the reader.
  // G12 — and for a hand-off, the name that matters is who it went TO.
  const who = actorName(a.type === 'handed_to' ? a.to ?? null : a.actor, people, viewer, {
    you: t(locale, 'takeover.actor.you'), owner: t(locale, 'people.held.owner'), gone: t(locale, 'people.held.gone'),
  });
  const phrase = t(locale, `takeover.last.${a.type}` as MessageKey, { who, name: assistantName(locale) });
  const when = a.at ? ` · ${formatRelative(locale, a.at, now)}` : '';
  return `<div class="lastact muted">${esc(labelled(locale, t(locale, 'takeover.lastLabel'), phrase + when))}</div>`;
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
  const name = assistantName(locale);
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

/**
 * G12 — whose it is, by name. "You're handling this" is only true for the
 * person holding it; to anyone else it is a colleague's conversation.
 */
function holderLabel(d: ConversationDetail, locale: Locale, viewer: Viewer): string {
  const mine = d.heldBy === undefined || d.heldBy === null
    || (viewer.id !== undefined && d.heldBy === viewer.id)
    || (d.heldBy === 'owner' && viewer.isOwner);
  return mine
    ? t(locale, 'takeover.status.owner')
    : t(locale, 'people.holding', {
        who: actorName(d.heldBy ?? null, d.people ?? [], viewer, {
          you: t(locale, 'takeover.actor.you'), owner: t(locale, 'people.held.owner'), gone: t(locale, 'people.held.gone'),
        }),
      });
}

/**
 * CC-25 — who speaks, in the header. The ownership card now sits under the
 * transcript, beside what the owner does about it; the header still says whose
 * conversation this is, so nobody scrolls to find out. While the assistant
 * holds it, the conversation's own state says it, as it always has.
 */
function headerPill(d: ConversationDetail, locale: Locale, viewer: Viewer): string {
  switch (d.ownership) {
    case 'AI': return statusPill(locale, d.status, d.pendingDraft !== null);
    case 'WAITING_HUMAN': return `<span class="pill warn">${esc(t(locale, 'takeover.status.waiting'))}</span>`;
    case 'OWNER_CONTROLLED': return `<span class="pill owner">${esc(holderLabel(d, locale, viewer))}</span>`;
  }
}

/** M16.1/M16.2c — the human control surface, driven purely by ownership. */
function takeoverCard(d: ConversationDetail, locale: Locale, now: Date, viewer: Viewer): string {
  const cid = encodeURIComponent(d.conversationId);
  const reasons = d.handoffReasons.length
    ? `<div class="why muted">${esc(labelled(locale, t(locale, 'takeover.why'),
        formatList(locale, d.handoffReasons.map((k) => t(locale, `takeover.reason.${k}` as MessageKey)))))}</div>`
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

  const ownerPill = esc(holderLabel(d, locale, viewer));

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
          ${d.ownerUnsentReply ? `<p class="muted" role="note">${esc(t(locale, 'takeover.reply.kept'))}</p>` : ''}
          <textarea name="text" rows="2" dir="auto" placeholder="${esc(t(locale, 'takeover.replyPlaceholder'))}" required>${esc(d.ownerUnsentReply ?? '')}</textarea>
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

/**
 * A5.4 — hand this buyer to another assistant. Only the owner decides who
 * answers, so only she is shown it; and with one assistant there is no choice
 * to offer. A closed conversation has nobody answering it.
 */
function assistantControl(d: ConversationDetail, locale: Locale, viewer: Viewer): string {
  const choices = d.assistantChoices ?? [];
  if (!viewer.isOwner || choices.length < 2 || d.status === 'done') return '';
  return `<form method="post" action="/app/inbox/${encodeURIComponent(d.conversationId)}/assistant" class="as-hand">
      <label class="muted" for="as-hand">${esc(t(locale, 'conv.assistant.label'))}</label>
      <select id="as-hand" name="assistant">${choices.map((c) =>
        `<option value="${esc(c.id)}"${c.current ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <button class="btn" type="submit">${esc(t(locale, 'conv.assistant.button'))}</button>
    </form>`;
}

export function renderConversationDetail(
  d: ConversationDetail, locale: Locale, now: Date, flash: Flash | null, viewer: Viewer = OWNER_VIEW,
): string {
  const pcs = t(locale, 'product.unit.pcs');
  const prod = productName(locale, d.product);
  // Each figure isolated: in Arabic one run of quantity, unit, price and total
  // reordered itself ("1.45$/قطعة"). The separators keep the page's direction.
  const iso = (x: string): string => `<bdi>${esc(x)}</bdi>`;
  const context = (d.quote || d.order) ? `<div class="ctx">
      ${d.quote ? `<div><span class="muted">${esc(t(locale, 'inbox.ctx.quote'))}</span> ${[
        iso(`${formatQty(locale, d.quote.quantity)}${pcs}`),
        iso(`${formatMoney(d.quote.unitPrice)}/${pcs}`),
        iso(`${t(locale, 'product.detail.total')} ${formatMoney(d.quote.total)}`),
      ].join(' · ')}${inHerMoney(d.quote.total, d.rate, locale)}</div>` : ''}
      ${d.order ? `<div><span class="muted">${esc(t(locale, 'inbox.ctx.order'))}</span> ${[
        iso(d.order.reference), iso(orderStatusName(locale, d.order.status)),
        ...(d.order.total !== null ? [iso(formatMoney(d.order.total))] : []),
      ].join(' · ')}${d.order.total !== null ? inHerMoney(d.order.total, d.rate, locale) : ''}
        <a class="deeper" href="/app/orders/${esc(d.order.id)}">${esc(t(locale, 'order.open'))}<span class="go" aria-hidden="true">›</span></a></div>` : ''}
      ${proofRow(d, locale)}
    </div>` : '';

  /**
   * CC-25 — one window of the transcript, oldest at the top, newest at the
   * bottom, the newest marked `latest` so a link can land on it: the page
   * opens there from Buyers, with the reply waiting directly underneath.
   *
   * "Earlier messages" is a door to the window before this one; a window
   * further back has "Latest messages" to come home. Both land on the newest
   * message the page they open shows — both are `conversationUrl`, like every
   * other way into this page.
   *
   * After an action the page lands on the NOTICE instead, which sits right
   * under the newest message (below): landing on the message put the notice
   * off the screen whenever that message was long — an e-mail, a list of
   * questions — and the notice is the one thing she came back to read.
   */
  const older = d.transcript?.older === true;
  const earlier = d.transcript?.earlier ?? null;
  const last = flash === null ? d.messages.length - 1 : -1;
  const timeline = d.messages.length
    ? `<div class="timeline">${d.messages.map((m, i) => `
        <div${i === last ? ' id="latest"' : ''} class="msg ${m.direction}">
          ${m.heard ? voiceBubble(locale, m, d.conversationId)
            : m.received ? receivedBubble(locale, m)
            : `<div dir="auto" class="bubble"><bdi>${esc(m.text)}</bdi></div>`}
          <div class="ts muted">${m.at ? esc(formatRelative(locale, m.at, now)) : ''} · ${
            m.direction === 'inbound' ? esc(t(locale, 'common.buyer'))
            : m.by === 'owner' ? esc(t(locale, 'conv.by.you'))
            : esc(assistantName(locale))}</div>
        </div>`).join('')}</div>`
    // "No messages yet" only where it is true: not on a window further back,
    // and not on one whose every message was a reaction left out (G2c).
    : older || earlier ? ''
    : `<div class="empty muted">${esc(t(locale, 'inbox.detail.noMessages'))}</div>`;
  const log = `<div class="block"><h2>${esc(t(locale, 'inbox.detail.log'))}</h2>
      ${earlier ? back(conversationUrl(d.conversationId, earlier), t(locale, 'inbox.log.earlier')) : ''}
      ${timeline}
      ${older ? deeper(conversationUrl(d.conversationId), t(locale, 'inbox.log.latest')) : ''}
    </div>`;

  const draftCard = d.pendingDraft
    ? `<div class="card draft" role="region">
        <h2>${esc(t(locale, 'buyers.review.title'))}</h2>
        <p class="muted review-intro">${esc(t(locale, 'buyers.review.intro', { buyer: d.buyer ?? t(locale, 'common.buyer') }))}</p>
        ${d.pendingDraft.heldBecause
          ? `<p class="held-why" role="note">${esc(t(locale, `inbox.draft.held.${d.pendingDraft.heldBecause}` as MessageKey, { name: assistantName(locale) }))}</p>`
          : ''}
        ${d.pendingDraft.disclosureSent
          ? `<p class="held-why rf" role="note">${esc(t(locale, 'inbox.draft.held.disclosure_sent', { name: assistantName(locale) }))}</p>`
          : ''}
        ${d.pendingDraft.contradicts ? contradictionBlock(d.pendingDraft.contradicts, locale) : ''}
        ${d.pendingDraft.forbidden?.length
          ? `<p class="held-why muted"><bdi>${esc(t(locale, 'inbox.draft.held.words', { terms: quoted(locale, d.pendingDraft.forbidden) }))}</bdi></p>`
          : ''}
        <div dir="auto" class="proposed"><bdi>${esc(d.pendingDraft.draftText)}</bdi></div>
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
        ${viewer.isOwner ? `<p class="muted revoke-note"><a href="/app/employee#on-her-own">${esc(t(locale, 'autonomy.hint'))}</a></p>` : ''}
        <form method="post" action="/app/inbox/${encodeURIComponent(d.conversationId)}/act" class="editform">
          <input type="hidden" name="draftId" value="${esc(d.pendingDraft.draftId)}" />
          <label class="muted" for="edit">${esc(t(locale, 'inbox.action.editLabel'))}</label>
          ${d.pendingDraft.ownerEdit ? `<p class="muted" role="note">${esc(t(locale, 'inbox.edit.kept'))}</p>` : ''}
          ${/* CC-24 — the box opens with the owner's kept edit, else with the draft itself: an edit, not a retyping. */ ''}<textarea id="edit" name="edit" rows="4" dir="auto" placeholder="${esc(t(locale, 'inbox.action.editPlaceholder'))}">${esc(d.pendingDraft.ownerEdit ?? d.pendingDraft.draftText)}</textarea>
          <button class="btn" name="command" value="改">${esc(t(locale, 'inbox.action.editSend'))}</button>
        </form>
      </div>`
    : '';
  const noDraft = `<div class="block"><div class="empty muted">${esc(t(locale, 'inbox.draft.none'))}</div></div>`;

  // Phase D — "why did she say that?", from the stored usage audit. Shown only
  // while SHE is speaking: once a human takes over it is no longer the question.
  const knew = d.ownership === 'AI' && d.knowledgeUsed.length > 0
    ? `<div class="block knew"><h2>${esc(t(locale, 'buyers.knew.title'))}</h2>
        <ul class="knewlist">${d.knowledgeUsed.map((k) => `<li>${esc(k)}</li>`).join('')}</ul></div>`
    : '';

  /**
   * M34 — the unheard card. Same three-part shape as a refusal (M22): what
   * happened, why, what you do about it. CC-25: it follows the transcript now,
   * because the silence it explains is the newest thing in it.
   */
  const unheardCard = d.unheardReason
    ? `<div class="card refused">
        <h3 class="rf-h">${esc(t(locale, 'unheard.title'))}</h3>
        <div class="rf">
          <div class="rf-w">${esc(t(locale, 'unheard.what', { name: assistantName(locale) }))}</div>
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
            name: assistantName(locale),
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
          <div class="rf-w">${esc(t(locale, 'unlisted.what', { name: assistantName(locale) }))}</div>
          <div class="rf-y muted">${esc(t(locale, 'unlisted.why', { name: assistantName(locale) }))}</div>
          <div class="rf-d"><a href="/app/factory">${esc(t(locale, 'unlisted.do'))}</a></div>
        </div>
      </div>`
    : '';

  /**
   * 0075 — the buyer asked for their data to be deleted. The same three parts:
   * nothing went and a person answers; why nothing about it may be promised in
   * the chat; what to do — decide in the deletion section of the buyer's page
   * (CC-02, `#deletion`), then reply in person. Deciding is the owner's; staff
   * are told so, where the page itself would tell them.
   *
   * 0076 — the card outlives the hand-off. Handing the conversation back
   * clears the hand-off's reason, not the request: while one noted from this
   * buyer's message waits, the card stays and says when it was noted; once the
   * owner recorded one, a new ask says it is already recorded, and by when.
   */
  const deletionAsked = d.handoffReasons.includes('deletion_requested');
  const deletionCard = deletionAsked || d.deletionAsk
    ? `<div class="card refused">
        <h3 class="rf-h">${esc(t(locale, 'deletionAsked.title'))}</h3>
        <div class="rf">
          ${deletionAsked ? `<div class="rf-w">${esc(t(locale, 'deletionAsked.what', { name: assistantName(locale) }))}</div>` : ''}
          ${d.deletionAsk
            ? `<div class="rf-t">${esc(t(locale, 'deletionAsked.noted', { date: formatDate(locale, d.deletionAsk.askedAt) }))}</div>`
            : d.deletionRecorded
              ? `<div class="rf-t">${esc(t(locale, 'deletionAsked.recorded', { due: formatDate(locale, deletionDueBy(d.deletionRecorded.askedAt)) }))}</div>`
              : ''}
          <div class="rf-y muted">${esc(t(locale, 'deletionAsked.why'))}</div>
          <div class="rf-d">${viewer.isOwner
            ? `<a href="/app/conversations/${encodeURIComponent(d.conversationId)}#deletion">${esc(t(locale, 'deletionAsked.do'))}</a>`
            : esc(t(locale, 'staff.deletionAsked'))}</div>
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
          <div class="rf-y muted"><bdi>${esc(t(locale, `herwords.${w.path}` as MessageKey, { terms: quoted(locale, w.terms), name: assistantName(locale) }))}</bdi></div>
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
          <div class="rf-y muted">${esc(t(locale, 'samples.asked.unstated', { name: assistantName(locale) }))}</div>
          <div class="rf-d"><a href="/app/settings/samples">${esc(t(locale, 'samples.asked.action'))}</a></div>
        </div>`}
      </div>`
    : '';

  /**
   * CC-25 — THE NOTICE IS WHERE SHE LANDS. Every action on this page sends her
   * back to `#latest`, and what the action said is drawn there: under the
   * newest message, above what she does next, and carrying the mark itself so
   * the page opens on it however long that message is. At the top of the page
   * it was a screen or a whole transcript away from where she had been, and
   * she scrolled up to learn whether it went. `flashBanner` still paints it;
   * this only decides where.
   */
  const flashHtml = flashBanner(flash, 'latest');

  /**
   * CC-25 — THE ORDER OF THE PAGE. The transcript first; then what the owner
   * does about its newest message: her reply for approval, directly under the
   * question it answers, and the ownership card (take over, hand to, the
   * owner's own reply box); then what went wrong and why; then her sources and
   * the deal. It was the other way round, and she approved replies with the
   * buyer's question off the screen.
   *
   * A window further back is for reading: it shows the transcript and the way
   * home, and nothing to act on — an approval under a message from last week
   * would sit directly under the wrong question.
   */
  const acts = older ? '' : `
    ${d.ownership === 'OWNER_CONTROLLED' ? '' : draftCard}
    ${takeoverCard(d, locale, now, viewer)}
    ${d.ownership === 'OWNER_CONTROLLED' || d.pendingDraft ? '' : noDraft}
    ${deletionCard}
    ${unheardCard}
    ${unreadableCard}
    ${unlistedCard}
    ${closedCard}
    ${herWordsCard}
    ${sampleCard}
    ${uncertainCard(d.uncertainSends, locale, now)}
    ${refusalCard(d.refusals, locale, now)}
    ${knew}
    ${context}`;

  return `
    <div class="dhead">
      ${back('/app/inbox', t(locale, 'inbox.detail.back'))}
      <div class="who">${buyerWho(locale, d.buyer, d.country)}</div>
      ${headerPill(d, locale, viewer)}
    </div>
    ${d.answeredBy ? `<div class="muted subline"><bdi>${esc(t(locale, 'conv.answeredBy', { who: d.answeredBy }))}</bdi></div>` : ''}
    ${older ? '' : assistantControl(d, locale, viewer)}
    ${prod || d.quantity !== null ? `<div class="muted subline">${[
      prod ? `<bdi>${esc(prod)}</bdi>` : '',
      d.quantity !== null ? `<bdi>${esc(formatQty(locale, d.quantity))}${esc(pcs)}</bdi>` : '',
    ].filter(Boolean).join(' · ')}</div>` : ''}
    ${/* A — the buyer's own page (name, history, the deletion control) was reached from Customers; it is one door from here now. */ ''}${
      deeper(`/app/conversations/${encodeURIComponent(d.conversationId)}`, t(locale, 'conv.file.title'))}
    ${log}
    ${flashHtml}
    ${acts}`;
}
