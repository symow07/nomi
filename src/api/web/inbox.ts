import { figuresIn } from '../../core/conversation/figures.js';
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
import { readReply, differsOn, type ReadingField, type ReadingLine, type ReadingQuote } from '../../core/owner/reading.js';
import { ownSku } from '../../core/owner/sku.js';
import { CHANNEL_REGISTRY, type OutreachChannel } from '../../core/channel/registry.js';
import { t, assistantName, outreachShown, tn } from './say.js';
import { formatList, labelled, dayKey } from '../../core/owner/i18n/format.js';
import { CLOSING_SOON_MS } from '../../core/channel/window.js';
import { ownershipOf, type ConversationOwnership } from '../../core/conversation/ownership.js';
import { loadRefusals, loadUncertainSends, type Refusal, type UncertainSend } from './refusals.js';
import { esc, deeper, back, byAssistant, conversationUrl, LIVE_SLOT, signalMark, atWork } from './layout.js';
import { face, faceLink } from './faces.js';
import { icon } from './icons.js';
import { flashBanner, type Flash } from './flash.js';
import { PROBLEM_SIGNAL_KINDS } from '../../core/scoring/signals.js';
import { UNREADABLE_KINDS, RECEIVED_KINDS, type UnreadableKind, type ReceivedKind } from '../../core/conversation/inbound.js';
import { isHoldReason, type HoldReason } from '../../core/conversation/hold.js';
import { loadTranscriptWindow } from '../../db/transcript.js';
import { detectClaims } from '../../core/safety/claims.js';
import { chosenName } from '../../db/assistants.js';
import { waitingAskOf } from '../../db/deletionAsks.js';
import { pendingProposalOf, type PendingProposal } from '../../db/orderProposals.js';
import { orderConfirmedReply } from '../../core/conversation/templates.js';
import { fixedLanguage } from '../../core/conversation/gateLanguage.js';
import { buyerDeletionOf } from './dataRights.js';
import { deletionDueBy } from '../../core/ops/deletions.js';
import { readBuyersPage, readBuyerCounts, searchOf, DELETION_WAITING, ORDER_WAITING, lensOf, type BuyersFilter, type BuyersLens } from '../../db/buyersList.js';
import { customerValues, REGULAR_ORDERS } from '../../db/customerValue.js';
import { faceVersions } from '../../db/faces.js';
import { readAttention, type AttentionItem } from '../../db/inboxAttention.js';
import * as show from './values.js';
import { isCountryCode } from '../../core/owner/business.js';
import { workspaceZone } from './zone.js';
import { stateOfPlay, type Speaker } from '../../core/conversation/stateOfPlay.js';
import type { CatchUp } from '../../db/catchUp.js';

/** A conversation id as Postgres stores one; anything else names no conversation. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The stored problem-signal kinds shown as a takeover reason (no classifier).
 * G2c — read from core rather than copied here: the copy on Today had never
 * learned 'audio_unheard', and a third copy is how that happens again.
 */
const PROBLEM_KINDS: ReadonlySet<string> = new Set(PROBLEM_SIGNAL_KINDS);

/** G2c — a stored `received` value, as one of the kinds the owner surface names. */
/** CH7a — a link a customer's message pointed at, made a door only on Meta's own hosts, over https. */
export const refOf = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length > 2000) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && /(^|\.)(instagram\.com|facebook\.com|fbcdn\.net|fbsbx\.com|cdninstagram\.com|fb\.com)$/.test(u.hostname) ? u.toString() : null;
  } catch { return null; }
};

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

// Flags are emoji, not localizable — shared with conversations and the calendar.
// Phase 9 (V1-265) — every country's, from its two letters: a list of ten gave
// Aisha in Nigeria a flag and Carlos in Brazil none.
export const flag = (c: string | null): string => {
  const code = (c ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && isCountryCode(code)
    ? String.fromCodePoint(...[...code].map((ch) => 0x1F1E6 + ch.charCodeAt(0) - 65)) : '';
};

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
  /** 0080 — a customer said yes to an order and it waits for the owner's tap. Absent = none. */
  readonly orderWaiting?: boolean;
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
  /**
   * Phase 9 (V1-173) — the conversation is open (`is_active`). The list ranks
   * an open one the customer wrote last before the rest of the assistant's
   * (`LIST_RANK` 6, then 7), and the page heads the two runs apart. Absent: open.
   */
  readonly live?: boolean;
  /** A — who wrote the newest message. Absent: no message yet, or a summary from before A. */
  readonly lastFrom?: LastFrom;
  /**
   * The warmth run, phase 4 — the CUSTOMER the row stands for (one customer,
   * one row), their photo's version (`faceVersions`; null draws the initial),
   * what they have spent and whether Nomi counts them a regular
   * (`customerValues`). Absent on a summary built without them: no face link,
   * nothing spent, no mark.
   */
  readonly clientId?: string;
  readonly photo?: string | null;
  readonly spent?: Money | null;
  readonly regular?: boolean;
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
  /** Phase 4 — the order the list is in: who is waiting now (the default), or who matters most. */
  readonly lens?: BuyersLens;
  /**
   * Phase 4 — the "needs attention" band: customers slipping away, never
   * anyone waiting for the owner (`src/db/inboxAttention.ts`). Absent or
   * empty: no band.
   */
  readonly attention?: readonly AttentionItem[];
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
  /** Phase 4 — `lens=value` orders by what each customer spent; anything else is "waiting now". */
  readonly lens?: unknown;
  /** Phase 4 — read the "needs attention" band too (the first page of the whole list only). */
  readonly attention?: boolean;
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
  const lens = lensOf(ask.lens);
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { filter, lens, waitingCount: 0, blockedCount: 0, conversations: [], query: q };

  return withTenantTx(db, bid.value, async (tx) => {
    const page = await readBuyersPage(tx, { filter, ...(viewerId ? { viewerId } : {}), q, lens, after: ask.after, before: ask.before });
    const rows = page.ids.length === 0 ? [] : (await sql<{
      id: string; client_id: string; buyer: string | null; country: string | null; channel: string;
      name_zh: string | null; name: string | null; qty: number | null;
      assigned_to: string | null; closed_at: Date | null;
      last_text: string | null; last_dir: string | null; last_at: Date | null; last_origin: string | null;
      pending: number; unit_price: string | null; quote_currency: string | null; handoff_reason: string | null;
      answered_by: string | null; assistants: number; deletion_waiting: boolean; order_waiting: boolean; live: boolean;
    }>`
      select c.id::text as id, c.client_id::text as client_id, cl.display_name as buyer, cl.country, c.channel, c.is_active as live,
             -- Phase 9 (V1-005) — the name only once chosen (rule 7, chosenName):
             -- the row's default name said "Lily drafted" before the owner had chosen it.
             coalesce(
               (select ${chosenName('a')} from assistants a where a.id = c.assistant_id),
               (select ${chosenName('a')} from assistants a
                 where a.business_id = c.business_id and a.is_default and a.archived_at is null)) as answered_by,
             (select count(*)::int from assistants a
               where a.business_id = c.business_id and a.archived_at is null) as assistants,
             p.name_zh, p.name, cs.inquiry_quantity as qty,
             c.assigned_to, c.closed_at,
             lm.text_content as last_text, lm.direction as last_dir, lm.sent_at as last_at,
             -- D4 — who wrote an outbound message: the sent row it was copied from.
             -- CH3 — a reply the owner typed in Meta's own app is the owner's.
             case when lm.direction = 'outbound' and lm.external_id like 'echo:%' then 'owner' else
             (select o.origin from outbound_messages o
               where o.id = (case when lm.direction = 'outbound' and lm.external_id ~ '^out:[0-9a-f-]{36}$'
                                  then substr(lm.external_id, 5)::uuid end)) end as last_origin,
             (select count(*)::int from drafts d where d.conversation_id = c.id and d.status = 'pending') as pending,
             q.unit_price_usd as unit_price, q.currency as quote_currency,
             sig.kind as handoff_reason,
             ${DELETION_WAITING} as deletion_waiting,
             ${ORDER_WAITING} as order_waiting
        from conversations c
        left join clients cl on cl.id = c.client_id
        left join conversation_state cs on cs.conversation_id = c.id
        left join products p on p.id = cs.identified_product_id
        -- Phase 4 — the CUSTOMER's last contact: their newest message on any of their conversations.
        left join lateral (select m.text_content, m.direction, m.sent_at, m.external_id
                             from messages m join conversations c2 on c2.id = m.conversation_id
                            where c2.client_id = c.client_id order by m.sent_at desc, m.id desc limit 1) lm on true
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
    // Phase 4 — what each customer spent, whether they are a regular, their photo: the shared readers.
    const clientIds = rows.map((r) => r.client_id);
    const [values, photos] = await Promise.all([customerValues(tx, clientIds), faceVersions(tx, clientIds)]);
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
        orderWaiting: r.order_waiting,
        latestMessage: r.last_text, latestAt: r.last_at,
        product: { name: r.name, nameZh: r.name_zh }, quantity: r.qty ?? null,
        // G18 — in the currency the quote was made in. Rebuilding it as dollars
        // put a "$" in front of a number that was never dollars.
        unitPrice: r.unit_price !== null ? moneyFromRow(Number(r.unit_price), r.quote_currency ?? 'USD') : null,
        channel: r.channel,
        unanswered: lastFrom === 'buyer',
        live: r.live,
        ...(lastFrom ? { lastFrom } : {}),
        clientId: r.client_id,
        photo: photos.get(r.client_id) ?? null,
        spent: values.get(r.client_id)?.spent ?? null,
        regular: values.get(r.client_id)?.regular === true,
      }];
    });

    // A9 — THE COUNTS ARE OF EVERYTHING, never of the page: `defaultFilter`
    // decides which tab opens from `waitingCount`.
    const counts = await readBuyerCounts(tx, viewerId);
    const attention = ask.attention === true ? await readAttention(tx, new Date()) : [];
    return {
      filter, lens, conversations, attention,
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
    // CH7 — matched to a product of hers: the turn answered about it, and she sees which.
    + (m.about ? `<div class="muted small">${esc(t(locale, 'received.about', { name: m.about }))}</div>` : '')
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
                                      where t.conversation_id = ${conversationId}
                                        and t.decision->'action'->>'kind' is distinct from 'held'), '-infinity'::timestamptz)
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

/**
 * The fix wave (w4-conversation-09) — one name or claim the reply wrote, in the
 * locale's own quotation marks, as the rest of each catalogue writes them:
 * “…” in English and Chinese, «…» in Arabic and Spanish, « … » in French.
 */
const inQuotes = (locale: Locale, x: string): string =>
  locale === 'ar' || locale === 'es' ? `«${x}»` : locale === 'fr' ? `«\u00a0${x}\u00a0»` : `“${x}”`;

/** The fold's mark for "check this": a question, in the locale's own question mark. */
const UNSURE: Readonly<Record<Locale, string>> = { en: '?', zh: '？', ar: '؟', es: '?', fr: '?' };

function contradictionBlock(c: DraftContradiction, locale: Locale): string {
  const line = (label: string, price: Money, quantity: number) =>
    `<div><span class="muted">${esc(label)}</span> <b><bdi>${esc(show.money(locale, price))}</bdi></b> <span class="muted">${
      esc(t(locale, 'inbox.draft.contradicts.for', { qty: show.quantity(locale, quantity) }))}</span></div>`;
  return `<div class="held-then">
      ${line(t(locale, 'inbox.draft.contradicts.before', { date: show.date(locale, c.before.at) }), c.before.price, c.before.quantity)}
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
  /** CH7 — the catalogue product a shared post or story was matched to. */
  about?: string | undefined;
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
  /** The fix wave (V1-220) — `sku`: the product's own code, so the card reads "ZX-300" as the code. Optional for fixtures. */
  readonly product: { readonly name: string | null; readonly nameZh: string | null; readonly sku?: string | null };
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
    /**
     * 2026-09-30 — it would have gone alone, but the customer's language has
     * no signed-off sentence saying who is answering: unread (es, fr) or none
     * at all. The card names the language and why.
     */
    withheld?: { readonly reason: 'disclosure_not_reviewed' | 'language_without_disclosure' | 'language_new'; readonly language: string }
      // G4 — a workspace that signed itself up has not earned sending alone yet.
      // LG — nobody can tell which language the customer writes in.
      | { readonly reason: 'not_earned' | 'first_quote' | 'language_unknown' } | null;
    /** CC-24 — the owner's edit of this draft, kept when its send was refused. */
    ownerEdit?: string | null;
    /** G10 — the language the reply is in (two letters), when the turn knew it. */
    language?: string | null;
    /** G10 — the owner's translation of it, kept on the draft; never sent. */
    translation?: { readonly text: string; readonly locale: string } | null;
  } | null;
  /** CC-24 — the owner's own reply, kept when it was refused before it could be queued. */
  readonly ownerUnsentReply?: string | null;
  readonly ownership: ConversationOwnership;
  /** R2 (0106) — the owner marked this conversation "this is me testing": it counts toward nothing. */
  readonly ownerTesting?: boolean;
  /** Phase 5 — the assistant is at work on the customer's newest message (`assistantWorking`, live.ts). */
  readonly working?: boolean;
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
  /**
   * 0080 — the order this customer said yes to, waiting for the owner's tap.
   * Optional so a detail built before 0080 (a fixture, the sandbox) still types.
   */
  readonly orderProposal?: PendingProposal | null;
  /** M34 — why a voice note could not be heard, when one could not. */
  readonly unheardReason: string | null;
  /**
   * G2c — what arrived that she could not read, when something did. Optional
   * so a detail built before G2c (a test fixture, the sandbox) still types.
   */
  readonly unreadable?: UnreadableKind | null;
  /** CH7a — the link of what arrived (a shared post, a story), when the provider gave one. */
  readonly unreadableRef?: string | null;
  /** CH7 — the caption of the shop's own post or story it was about, when one was read and named no product. */
  readonly unreadableCaption?: string | null;
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
   * Phase 9 (V1-221) — the claims this workspace confirmed ("certification:CE"),
   * so the card can say when a reply states one that was not. Absent reads as none.
   */
  readonly claimsAllowed?: readonly string[];
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
  /** The design pass — the conversation's channel, for the card's "goes on …". Optional so fixtures still type. */
  readonly channel?: string;
  /**
   * G5b — the newest reply, when it waited past the day its channel allows and
   * was marked expired: shown for what it was, never offered to send.
   */
  readonly expiredDraft?: { readonly text: string } | null;
  /**
   * The design pass — what the newest turn read, for the approval card's
   * "Understood" and "How … read this". Read from the turn's own replay row
   * (`turns.analysis`, `turns.own_understanding`) and the quote it priced.
   * Optional so a detail built before it (a fixture, the sandbox) still types.
   */
  readonly reading?: CardReading | null;
  /**
   * THE WARMTH RUN, phase 5 — the catch-up strip's rows (`loadCatchUp`): the
   * customer's face, where they write, what they bought and spent, and the
   * rows the state of play is decided from. Set by the route. Absent (a
   * fixture, a conversation with no customer on record) the strip is the name
   * and who holds the conversation, as the header always said.
   */
  readonly catchUp?: CatchUp | null;
};

export type CardReading = {
  /** The analysis's `primary_intent`; null on a turn no model read (fast path). */
  readonly intent: string | null;
  readonly quantity: { readonly value: number; readonly unit: string } | null;
  /** The language the customer wrote in, as the analysis detected it. */
  readonly language: string | null;
  /** The fields a second, separate reading differed on; null when there was none to compare. */
  readonly differsOn: readonly ReadingField[] | null;
  readonly quote: ReadingQuote | null;
};

/** The analysis fields the card reads, from a stored turn; nothing else is trusted. */
function cardReadingOf(
  analysis: Record<string, unknown> | null, own: unknown,
  q: { unit_price_usd: string; total_usd: string; quantity: number; discount_pct: string; lead_time_days: number | null; moq: number | null } | undefined,
): CardReading {
  const intent = analysis?.['intent'] as Record<string, unknown> | undefined;
  const language = analysis?.['language'] as Record<string, unknown> | undefined;
  const qty = intent?.['quantityMentioned'] as { value?: unknown; unit?: unknown } | null | undefined;
  return {
    intent: typeof intent?.['primary'] === 'string' ? intent['primary'] : null,
    quantity: qty && typeof qty.value === 'number' ? { value: qty.value, unit: typeof qty.unit === 'string' ? qty.unit : '' } : null,
    language: typeof language?.['detected'] === 'string' ? language['detected'] : null,
    differsOn: differsOn(own),
    quote: q ? {
      unitPrice: Number(q.unit_price_usd), total: Number(q.total_usd), quantity: q.quantity,
      discountPct: Number(q.discount_pct), leadTimeDays: q.lead_time_days, moq: q.moq,
    } : null,
  };
}

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
      name_zh: string | null; name: string | null; sku: string | null; qty: number | null;
      assigned_to: string | null; closed_at: Date | null; pending: number;
      answered_by: string | null; assistants: number; owner_unsent_reply: string | null; channel: string; owner_testing: boolean;
    }>`
      select c.id, c.channel, cl.display_name as buyer, cl.country, p.name_zh, p.name, p.sku,
             cs.inquiry_quantity as qty, c.assigned_to, c.closed_at, c.owner_unsent_reply, c.owner_testing,
             -- A5: the conversation's own assistant; one that started before
             -- there was a second belongs to the main one.
             -- Phase 9 (V1-005) — the name only once chosen (rule 7, chosenName):
             -- the row's default name said "Lily drafted" before the owner had chosen it.
             coalesce(
               (select ${chosenName('a')} from assistants a where a.id = c.assistant_id),
               (select ${chosenName('a')} from assistants a
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
          ...(received && m.about ? { about: m.about } : {}),
          // G13 — a note recorded before 0043 has no handle, and says so.
          ...(spoken && m.media ? { playable: true } : {}),
        };
      });

    const q = (await sql<{
      unit_price_usd: string; total_usd: string; quantity: number; product_id: string; currency: string;
      lead_time_withheld: { label?: unknown; from?: unknown; to?: unknown } | null;
      discount_pct: string; lead_time_days: number | null; moq: number | null;
    }>`
      select q.unit_price_usd, q.total_usd, q.quantity, q.product_id, q.currency, q.lead_time_withheld,
             q.discount_pct, q.lead_time_days, p.moq
        from quotes q left join products p on p.id = q.product_id
       where q.conversation_id = ${conversationId} order by q.created_at desc limit 1
    `.execute(tx)).rows[0];

    // The design pass — what the newest turn read, from its own replay row.
    const turn = (await sql<{ analysis: Record<string, unknown> | null; own_understanding: unknown }>`
      select analysis, own_understanding from turns
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
    const draft = (await sql<{
      id: string; draft_text: string; capability: string; owner_edit: string | null; pending: Record<string, unknown> | null;
      translation: string | null; translation_locale: string | null;
    }>`
      select d.id, d.draft_text, d.capability, d.owner_edit, d.translation, d.translation_locale,
             (select e.payload from conversation_events e
               where e.conversation_id = d.conversation_id and e.type = 'draft_pending'
                 and e.payload->>'draftId' = d.id::text
               order by e.id desc limit 1) as pending
        from drafts d where d.conversation_id = ${conversationId} and d.status = 'pending'
       order by d.created_at desc, d.id desc limit 1
    `.execute(tx)).rows[0];

    // G5b — the newest reply, if the day its channel allows ran out while it waited.
    const expired = (await sql<{ status: string; draft_text: string }>`
      select status, draft_text from drafts where conversation_id = ${conversationId}
       order by created_at desc, id desc limit 1`.execute(tx)).rows[0];

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
    // CH7a — the post's or story's own link, when the provider gave one: only
    // an https address on Meta's own hosts is ever made a door.
    const unreadableRef = refOf((unreadableRow?.payload ?? {})['ref']);
    // CH7 — and what the shop's own post says, when it was read and named no one product.
    const capRaw = (unreadableRow?.payload ?? {})['caption'];
    const unreadableCaption = typeof capRaw === 'string' && capRaw.trim() ? capRaw.slice(0, 600) : null;

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
      product: { name: head.name, nameZh: head.name_zh, sku: head.sku }, quantity: head.qty ?? null,
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
      expiredDraft: expired?.status === 'expired' ? { text: expired.draft_text } : null,
      pendingDraft: draft
        ? { draftId: draft.id, draftText: draft.draft_text, capability: draft.capability,
            heldBecause: isHoldReason(draft.pending?.['heldBecause']) ? draft.pending['heldBecause'] : null,
            contradicts: contradictionOf(draft.pending?.['contradicts']),
            forbidden: stringsOf(draft.pending?.['forbidden']),
            disclosureSent: draft.pending?.['disclosureSent'] === true,
            withheld: withheldOf(draft.pending?.['withheld']),
            ownerEdit: draft.owner_edit,
            language: typeof draft.pending?.['language'] === 'string' ? String(draft.pending['language']).slice(0, 8) : null,
            translation: draft.translation && draft.translation_locale ? { text: draft.translation, locale: draft.translation_locale } : null }
        : null,
      ownerUnsentReply: head.owner_unsent_reply,
      ownerTesting: head.owner_testing === true,
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
      orderProposal: await pendingProposalOf(tx, conversationId),
      unheardReason,
      unreadable,
      unreadableRef,
      unreadableCaption,
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
      claimsAllowed: (await tenantRepos(tx, bid.value).catalog.claimsPolicy()).filter((c) => c.allowed).map((c) => `${c.kind}:${c.claimKey}`),
      channel: head.channel,
      // The quote's figures are read with or without a turn on record.
      reading: cardReadingOf(turn?.analysis ?? null, turn?.own_understanding ?? null, q),
    };
  });
}

/** ── Renderers (pure, mobile-first, localized, escaped) ───────────────────── */

/**
 * Phase 5 — the assistant at work, in place: its ✦, what it is doing, and three
 * dots that breathe (still for a reader who asked for less motion). A polite
 * status, so a screen reader hears it once. Practice draws the same line.
 */
export const workingLine = (locale: Locale): string => atWork(t(locale, 'conv.working', { name: assistantName(locale) }), true);

// The conversation's own state — only meaningful while SHE holds it. Once a
// human is involved, `statusOf` calls every assigned conversation 'paused',
// which contradicts the ownership the page states; ownership is the truth.
// Phase 4 — waiting is ○ amber, done is ✓ green; paused is neither, and says so in grey.
const statusPill = (locale: Locale, status: InboxStatus, needs: boolean): string =>
  `<span class="pill ${needs ? 'warn' : status === 'paused' ? 'muted' : 'ok'}">${esc(t(locale, `inbox.status.${status}` as MessageKey))}</span>`;

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
 * Where the customer writes: the channel's word, and their address on it where
 * it is one a person reads (a number, an e-mail) — the customer panel's line
 * and the catch-up strip's, drawn once. A WhatsApp number is stored as its
 * digits and shown the way it is dialled. Phase 9 — an address reads left to
 * right in every language: a bare <bdi> has no letter to go by, and Arabic put
 * the + last.
 */
export const reachedOn = (locale: Locale, channel: string, address: string | null): string =>
  `${esc(channelName(locale, channel))}${address ? ` <bdi dir="ltr">${esc(channel === 'whatsapp' && /^\d+$/.test(address) ? `+${address}` : address)}</bdi>` : ''}`;

/**
 * THE WARMTH RUN, phase 5 — whose words a line of the transcript is: the
 * customer's, a person's here (the owner, or a colleague replying as the
 * business), or the assistant's. A sent row with no origin on record reads as
 * the assistant's, as the caption under it always said (D4). One answer for
 * the conversation and Practice, so the two cannot mark them differently.
 */
export const speakerOf = (m: { readonly direction: 'inbound' | 'outbound'; readonly by?: string | undefined }): Speaker =>
  m.direction === 'inbound' ? 'buyer' : m.by === 'owner' ? 'person' : 'assistant';

/**
 * The bubble a typed line sits in. What the assistant said is on its wash
 * (`by-as`), with "✦ {name}" in magenta in the caption under it; a person's
 * reply and the customer's words keep the plain bubble. A wash, never a frame.
 */
export const bubbleClass = (s: Speaker): string => (s === 'assistant' ? 'bubble by-as' : 'bubble');

/**
 * Why a customer needs the owner, in the Buyers row's own words (its badge):
 * an order waiting, a deletion asked, the stored reason they were handed over
 * (never inferred), a reply to review, or a conversation the owner holds.
 * Today's first block says the same words (`today.ts`).
 */
export function needsWhy(
  locale: Locale,
  c: Pick<ConversationSummary, 'orderWaiting' | 'deletionWaiting' | 'ownership' | 'handoffReason' | 'awaitingReview' | 'answeredBy'>,
): string {
  if (c.orderWaiting) return t(locale, 'buyers.badge.order');
  if (c.deletionWaiting) return t(locale, 'buyers.group.deletion');
  if (c.ownership === 'WAITING_HUMAN') {
    return c.handoffReason ? t(locale, `takeover.reason.${c.handoffReason}` as MessageKey) : t(locale, 'buyers.badge.waitingUnknown');
  }
  // Phase 9 (inbox-calendar-new-01) — the short form unless the name tells two
  // assistants apart: "Review your assistant's reply" ran to 412 px on a 390 px phone.
  if (c.awaitingReview) return c.answeredBy ? t(locale, 'buyers.badge.review', { name: c.answeredBy }) : t(locale, 'buyers.badge.reviewShort');
  return t(locale, 'buyers.badge.yours');
}

/**
 * Phase 9 (V1-228, V1-258, V1-278) — a unit price is per ONE piece: "$1.45/pc",
 * "$1.45/ud.", as the reply itself says it. It read "$1.45/pcs" beside a draft
 * saying "$1.45/pc".
 */
export const perPiece = (locale: Locale, m: Money): string => `${show.money(locale, m)}/${t(locale, 'product.unit.pc')}`;

/** The `withheld` a turn wrote beside a draft, checked; anything else is none. */
function withheldOf(v: unknown): { reason: 'disclosure_not_reviewed' | 'language_without_disclosure' | 'language_new'; language: string }
  | { reason: 'not_earned' | 'first_quote' | 'language_unknown' } | null {
  if (typeof v !== 'object' || v === null) return null;
  const { reason, language } = v as { reason?: unknown; language?: unknown };
  if (reason === 'not_earned' || reason === 'first_quote' || reason === 'language_unknown') return { reason };
  if ((reason !== 'disclosure_not_reviewed' && reason !== 'language_without_disclosure' && reason !== 'language_new') || typeof language !== 'string') return null;
  return { reason, language: language.slice(0, 8) };
}

/**
 * The row's glimpse of the last message: its first ninety characters, counted
 * as characters — cutting by UTF-16 units split an emoji into a broken glyph.
 */
// Phase 9 (V1-164) — cut where a word ends, and say it was cut: at 90 characters
// mid-word, "…lead time 25" read as a whole sentence on a laptop.
const PREVIEW_CHARS = 90;
const preview = (text: string): string => {
  const chars = Array.from(text);
  if (chars.length <= PREVIEW_CHARS) return text;
  const head = chars.slice(0, PREVIEW_CHARS).join('');
  const space = head.lastIndexOf(' ');
  return `${(space > PREVIEW_CHARS * 0.6 ? head.slice(0, space) : head).trimEnd()}…`;
};

/**
 * A — an address on the Buyers list that keeps what the owner is looking at:
 * the tab, the search, the page. The search is written as typed; only the five
 * characters that would change what the address means are escaped, so a name
 * in any script puts no `%` into the page (the owner surface's rule) and the
 * browser encodes the rest on the way out. A cursor is digits, hex, `-`, `_`,
 * a point and a `v` already (`src/db/buyersList.ts`).
 *
 * Phase 4 — and the lens: `lens=value` for "matters most"; "waiting now" is
 * the list's own address and writes nothing. `filter=all` is never written
 * any more: the whole list IS the list (an old address with it still answers).
 */
export const buyersHref = (o: {
  readonly filter?: InboxFilter | undefined; readonly lens?: BuyersLens | undefined; readonly q?: string;
  readonly after?: string | null; readonly before?: string | null;
}): string => {
  const typed = (v: string): string => v
    .replace(/[%&+#=]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\s/g, '+');
  const parts = [
    o.filter && o.filter !== 'all' ? `filter=${o.filter}` : '',
    o.lens === 'value' ? 'lens=value' : '',
    o.q ? `q=${typed(o.q)}` : '',
    o.after ? `after=${o.after}` : '',
    o.before ? `before=${o.before}` : '',
  ].filter(Boolean);
  return `/app/inbox${parts.length ? `?${parts.join('&')}` : ''}`;
};

/**
 * Phase 1 of the UI rebuild (the owner, 2026-10-02) — THE ROW. One
 * conversation in two lines, 56–72 px in every script, so a laptop shows ten
 * or more and a phone six or more. Line one: the state mark, who, what they
 * asked about where there is room, and the time, always in the same place at
 * the line's end. Line two: the last message, one line, cut where it runs out,
 * and why it needs the owner. Decision 5's row (name, last message, time) is
 * kept; its four stacked lines and the whole message are not.
 *
 * The mark is a shape as well as a colour, so it reads in greyscale: ○ needs
 * you, ● a person here has it, ✦ the assistant has it. A customer still
 * waiting for an answer is written in full ink and weight; an answered one in
 * grey. The message is the list's glimpse of it, drawn in the interface's face:
 * the speech face is for the transcript, where a message is read whole.
 *
 * Right to left: the grid follows the page's direction, so the mark and the
 * name sit on the right and the time on the left. The name and the message
 * each take their own direction from their own words (`dir="auto"`) and keep
 * the page's alignment while they fit (`match-parent`), so an English message
 * on an Arabic page is cut at its end, never at its start.
 */
export type RowState = 'needs' | 'yours' | 'hers';
export const rowState = (c: ConversationSummary): RowState =>
  c.orderWaiting === true || c.deletionWaiting === true || c.ownership === 'WAITING_HUMAN' || c.awaitingReview ? 'needs'
    : c.ownership === 'OWNER_CONTROLLED' ? 'yours' : 'hers';
export const ROW_MARK: Readonly<Record<RowState, string>> = { needs: '○', yours: '●', hers: '✦' };

export type RowOptions = {
  readonly now: Date;
  readonly people?: readonly Person[];
  readonly showChannel?: boolean;
  /** The list beside a conversation: no product line, and the open one marked as the current page. */
  readonly pane?: { readonly current: boolean };
  /** Phase 9 (V1-182) — what the owner searched for, marked where the row shows it. */
  readonly query?: string;
};

/**
 * Phase 9 (V1-182) — the searched words, marked in a name or a product as the
 * row shows it: matched without case, the way the search matched. Escaped
 * first, so the mark wraps only the owner's own text.
 */
export const markHit = (text: string, q: string | undefined): string => {
  const needle = (q ?? '').trim();
  if (!needle) return esc(text);
  const at = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (at < 0 || text.toLocaleLowerCase().length !== text.length) return esc(text);
  return `${esc(text.slice(0, at))}<mark class="hit">${esc(text.slice(at, at + needle.length))}</mark>${esc(text.slice(at + needle.length))}`;
};

export function customerRow(locale: Locale, c: ConversationSummary, o: RowOptions): string {
  const people = o.people ?? [];
  const name = assistantName(locale);
  const state = rowState(c);
  // Why it needs the owner (the reason that was stored, never inferred); who
  // holds it when that is somebody else; which assistant, when there are several.
  // Phase 9 (V1-174) — a customer the assistant holds who wrote last, in an open
  // conversation, has had no reply: said in words, not only by the text's weight.
  const noReply = state === 'hers' && c.unanswered === true && c.live !== false && !o.pane;
  const why = state === 'needs' ? needsWhy(locale, c)
    : state === 'yours' && people.length > 0 ? (() => {
        const who = heldByName(c.heldBy, people, {
          ai: name, waiting: t(locale, 'people.held.waiting'),
          owner: t(locale, 'people.held.owner'), gone: t(locale, 'people.held.gone'),
        });
        return who ? t(locale, 'people.holding', { who }) : '';
      })()
    : noReply ? t(locale, 'buyers.row.noReply')
    : state === 'hers' && c.answeredBy ? t(locale, 'buyers.group.hers', { name: c.answeredBy }) : '';
  // For a screen reader, what the mark says — unless the visible label already says it.
  const said = state === 'needs' ? t(locale, 'buyers.group.needsYou')
    : why && !noReply ? ''
    : state === 'yours' ? t(locale, people.length > 1 ? 'buyers.group.team' : 'buyers.group.yours')
    : t(locale, 'buyers.group.hers', { name: c.answeredBy ?? name });
  const prod = productName(locale, c.product);
  // Each part isolated on its own, so Arabic cannot run a Latin name, a
  // quantity and a price into one string. Phase 9 (inbox-calendar-new-02) — on
  // a phone the product still shows (cut at its end); the figures need the room.
  const figures = [
    c.quantity !== null ? show.quantityOf(locale, c.quantity, t(locale, 'product.unit.pcs')) : '',
    c.unitPrice !== null ? show.money(locale, c.unitPrice) : '',
  ].filter(Boolean).map((x) => `<bdi>${esc(x)}</bdi>`);
  const detail = o.pane ? '' : `${prod ? `<bdi class="cr-prod">${markHit(prod, o.query)}</bdi>` : ''}${
    figures.map((f, i) => `<span class="cr-fig">${prod || i > 0 ? ' · ' : ''}${f}</span>`).join('')}`;
  // Who wrote the newest message, when it was not the customer: you, in words;
  // the assistant, by its mark. Phase 9 (V1-174) — on every row, the
  // assistant's own too: an answered row read like an unanswered one in grey.
  const speaker = c.lastFrom === 'person' ? `<bdi>${esc(t(locale, 'conv.by.you'))}</bdi>${locale === 'zh' ? '：' : ': '}`
    : c.lastFrom === 'assistant' ? `<span class="as" aria-hidden="true">✦</span><span class="sr">${esc(name)}${locale === 'zh' ? '：' : ': '}</span> ` : '';
  const when = [
    o.showChannel && c.channel ? esc(channelName(locale, c.channel)) : '',
    c.latestAt ? esc(show.shortWhen(locale, c.latestAt, o.now)) : '',
  ].filter(Boolean).join(' · ');
  const current = o.pane?.current === true;
  // CC-25 — a customer opens on the newest message, the reply waiting under it.
  return `<a class="crow is-${state}${c.unanswered ? ' unanswered' : ''}${current ? ' on' : ''}" href="${conversationUrl(c.conversationId)}"${current ? ' aria-current="page"' : ''}>
      <span class="cr-mark" aria-hidden="true">${ROW_MARK[state]}</span>
      <span class="cr-l1"><span class="cr-name" dir="auto"><bdi>${markHit(c.buyer ?? t(locale, 'common.buyer'), o.query)}</bdi></span>${detail ? `<span class="cr-detail">${detail}</span>` : ''}</span>
      <span class="cr-when">${when}</span>
      <span class="cr-l2">${c.latestMessage ? `${speaker}<span class="cr-text" dir="auto">${esc(preview(c.latestMessage))}</span>` : ''}</span>
      <span class="cr-why">${why ? `<bdi>${esc(why)}</bdi>` : ''}</span>
      ${said ? `<span class="sr">${esc(said)}</span>` : ''}
    </a>`;
}

/**
 * THE WARMTH RUN, PHASE 4 (2026-10-03) — THE INBOX ROW. One customer, one row,
 * 64 px with a 40 px face (the owner's decision):
 *
 *   line one   their face (it opens their card), their name, the mark Nomi
 *              puts on a regular — and, at the line's end, what they have
 *              spent: the headline number, because this business has
 *              customers who buy big once and customers who buy small often,
 *              and spend is the only number comparable across both;
 *   line two   why they need the owner, when they do — the waiting signal,
 *              magenta ○ and its words (a deletion request its own words) —
 *              then the last message, cut where it runs out; at its end, the
 *              last contact.
 *
 * No order count: it lives in the profile card. Nothing spent shows nothing
 * (no "0", no dash to read past). The mark on a regular is ink-secondary with
 * a shape, never magenta: magenta is the assistant's, and "waiting".
 *
 * Right to left: the row follows the page's direction, the face on the right.
 * The name and the message each take their own direction (`dir="auto"`), and
 * every figure is isolated, so a Latin name or "US$" is never cut or turned
 * around in Arabic.
 */
export function inboxRow(locale: Locale, c: ConversationSummary, o: RowOptions): string {
  const people = o.people ?? [];
  const name = assistantName(locale);
  const state = rowState(c);
  const who = c.buyer ?? t(locale, 'common.buyer');
  const current = o.pane?.current === true;
  // Phase 9 (V1-174) — a customer the assistant holds who wrote last, in an open conversation, has had no reply.
  const noReply = state === 'hers' && c.unanswered === true && c.live !== false && !o.pane;
  // The deletion request in its own short words: the group's long sentence left no room on a phone.
  const reason = c.orderWaiting !== true && c.deletionWaiting === true ? t(locale, 'buyers.badge.deletion') : needsWhy(locale, c);
  // Who holds it, when that is somebody else; which assistant, when there are several (A5).
  const holder = state === 'yours' && people.length > 0 ? (() => {
      const by = heldByName(c.heldBy, people, {
        ai: name, waiting: t(locale, 'people.held.waiting'),
        owner: t(locale, 'people.held.owner'), gone: t(locale, 'people.held.gone'),
      });
      return by ? t(locale, 'people.holding', { who: by }) : '';
    })()
    : noReply ? t(locale, 'buyers.row.noReply')
    : state === 'hers' && c.answeredBy ? t(locale, 'buyers.group.hers', { name: c.answeredBy }) : '';
  const why = state === 'needs'
    ? `<span class="ir-wait">${signalMark('waiting')}<bdi>${esc(reason)}</bdi></span>`
    : holder ? `<span class="ir-hold"><bdi>${esc(holder)}</bdi></span>` : '';
  // Who wrote the newest message when it was not the customer: you, in words; the assistant, by its mark.
  const speaker = c.lastFrom === 'person' ? `<span class="ir-by"><bdi>${esc(t(locale, 'conv.by.you'))}</bdi>${locale === 'zh' ? '：' : ':'}</span>`
    : c.lastFrom === 'assistant' ? `<span class="ir-by"><span class="as" aria-hidden="true">✦</span><span class="sr">${esc(name)}${locale === 'zh' ? '：' : ': '}</span></span>` : '';
  // A search that found them by what they asked about says so where the message would be.
  const prod = productName(locale, c.product);
  const byProduct = !!o.query && !!prod && markHit(prod, o.query) !== esc(prod) && markHit(who, o.query) === esc(who);
  const glimpse = byProduct ? `<bdi class="ir-text">${markHit(prod!, o.query)}</bdi>`
    : c.latestMessage ? `${speaker}<span class="ir-text" dir="auto">${esc(preview(c.latestMessage))}</span>` : '';
  const regular = c.regular === true
    ? `<span class="ir-reg">${icon('regular')}<span class="ir-reg-w">${esc(t(locale, 'buyers.row.regular'))}</span></span>` : '';
  const amount = c.spent ? show.money(locale, c.spent) : '';
  const spent = `<span class="ir-spent">${amount
    ? `<bdi aria-hidden="true">${esc(amount)}</bdi><span class="sr">${esc(t(locale, 'buyers.row.spent', { amount }))}</span>` : ''}</span>`;
  // The channel, once there is more than one, is a wide screen's: a phone keeps the time.
  const channel = o.showChannel && c.channel ? esc(channelName(locale, c.channel)) : '';
  const time = c.latestAt ? esc(show.shortWhen(locale, c.latestAt, o.now)) : '';
  const when = channel && time ? `<span class="ir-chan">${channel} · </span>${time}` : channel ? `<span class="ir-chan">${channel}</span>` : time;
  // For a screen reader, the state the list's heading says for the eye — unless the row says it already.
  const said = state === 'needs' ? t(locale, 'buyers.group.needsYou')
    : holder && !noReply ? ''
    : state === 'yours' ? t(locale, people.length > 1 ? 'buyers.group.team' : 'buyers.group.yours')
    : t(locale, 'buyers.group.hers', { name: c.answeredBy ?? name });
  const theFace = c.clientId
    ? faceLink({ clientId: c.clientId, name: c.buyer, photo: c.photo ?? null }, { size: 'm', label: t(locale, 'buyers.row.card', { who }), className: 'ir-face' })
    : `<span class="ir-face">${face({ clientId: c.conversationId, name: c.buyer }, 'm')}</span>`;
  // CC-25 — a customer opens on the newest message, the reply waiting under it.
  return `<div class="irow is-${state}${c.unanswered ? ' unanswered' : ''}${current ? ' on' : ''}">${theFace}<a class="ir-main" href="${conversationUrl(c.conversationId)}"${current ? ' aria-current="page"' : ''}>
      <span class="ir-l1"><span class="ir-name" dir="auto"><bdi>${markHit(who, o.query)}</bdi></span>${regular}</span>
      ${spent}
      <span class="ir-l2">${why}${glimpse}</span>
      <span class="ir-when">${when}</span>${said ? `<span class="sr">${esc(said)}</span>` : ''}
    </a></div>`;
}

/**
 * The list's groups in "waiting now", by the same predicates the list is
 * ORDERED by (`src/db/buyersList.ts`), so a page is a run of whole groups:
 * an order waiting (0080), a deletion request (0076), needs you, a person
 * here holds it, then the assistant's — those the customer wrote last first.
 */
export function waitingGroups(all: readonly ConversationSummary[]): {
  readonly orders: readonly ConversationSummary[]; readonly deletion: readonly ConversationSummary[];
  readonly needsYou: readonly ConversationSummary[]; readonly yours: readonly ConversationSummary[];
  readonly hersWaiting: readonly ConversationSummary[]; readonly hersRest: readonly ConversationSummary[];
} {
  const orders = all.filter((c) => c.orderWaiting === true);
  const deletion = all.filter((c) => !orders.includes(c) && c.deletionWaiting === true);
  const rest = all.filter((c) => !orders.includes(c) && !deletion.includes(c));
  const needsYou = rest.filter((c) => c.ownership === 'WAITING_HUMAN' || c.awaitingReview);
  const yours = rest.filter((c) => c.ownership === 'OWNER_CONTROLLED' && !needsYou.includes(c));
  const hers = rest.filter((c) => !needsYou.includes(c) && !yours.includes(c));
  // Phase 9 (V1-173) — the assistant's open conversations a customer wrote last, headed apart.
  const hersWaiting = hers.filter((c) => c.unanswered === true && c.live !== false);
  return { orders, deletion, needsYou, yours, hersWaiting, hersRest: hers.filter((c) => !hersWaiting.includes(c)) };
}

/** How many of the "needs attention" band show before "N more". */
export const ATTENTION_SHOWN = 5;

/** A date in the band: the month and day, with the year once it is far enough back to need one. */
const sinceDate = (locale: Locale, d: Date, now: Date): string =>
  now.getTime() - d.getTime() > 330 * 86_400_000 ? show.dateYear(locale, d) : show.shortWhen(locale, d, now);

/**
 * Phase 4 — THE "NEEDS ATTENTION" BAND: relationships slipping, never today's
 * urgency (who it holds, and why: `src/db/inboxAttention.ts`). Each customer
 * with their face (it opens their card), their name and one line; the line
 * and the name open their newest conversation, where a word to them is
 * written. Five, then the rest folded under "N more". No band when nobody is
 * slipping.
 */
export function attentionBand(items: readonly AttentionItem[], locale: Locale, now: Date): string {
  if (items.length === 0) return '';
  const row = (a: AttentionItem): string => {
    const who = a.name ?? t(locale, 'common.buyer');
    return `<li class="arow">${faceLink({ clientId: a.clientId, name: a.name, photo: a.photo }, { size: 's', label: t(locale, 'buyers.row.card', { who }), className: 'ar-face' })}`
      + `<a class="ar-main" href="${conversationUrl(a.conversationId)}"><span class="ar-name" dir="auto"><bdi>${esc(who)}</bdi></span>`
      + `<span class="ar-line">${esc(t(locale, `buyers.attention.${a.kind}` as MessageKey, { date: sinceDate(locale, a.since, now) }))}</span></a></li>`;
  };
  const first = items.slice(0, ATTENTION_SHOWN);
  const more = items.slice(ATTENTION_SHOWN);
  return `<section class="attn" aria-labelledby="attn-h">
      <h2 class="attn-h" id="attn-h">${esc(t(locale, 'buyers.attention.title'))}</h2>
      <ul class="arows">${first.map(row).join('')}</ul>${more.length ? `
      <details class="attn-more"><summary>${esc(t(locale, 'buyers.attention.more', { n: show.quantity(locale, more.length) }))}</summary>
        <ul class="arows">${more.map(row).join('')}</ul></details>` : ''}
    </section>`;
}

/**
 * Phase 4 — the switch between the two lenses: two segments, the app's own
 * tabs, the lens in the address. Each keeps the search; neither keeps a
 * narrowing (the whole list, in the other order).
 */
export function lensSwitch(locale: Locale, lens: BuyersLens, q: string): string {
  const seg = (l: BuyersLens) => {
    const on = lens === l;
    return `<a class="tab${on ? ' on' : ''}"${on ? ' aria-current="true"' : ''} href="${esc(buyersHref({ lens: l, q }))}">${esc(t(locale, `buyers.lens.${l}` as MessageKey))}</a>`;
  };
  return `<nav class="tabs lens" aria-label="${esc(t(locale, 'buyers.lens.label'))}">${seg('waiting')}${seg('value')}</nav>`;
}

/**
 * THE INBOX (the warmth run, phase 4): the customer list and the inbox are one
 * page — one customer, one conversation, one row — searchable, in two lenses
 * the owner switches between:
 *
 *   WAITING NOW (the default) — everyone who needs the owner first, in the
 *   list's groups (an order, a deletion request, waiting for a person, a reply
 *   to review, held by a person here), then everyone else by newest contact;
 *   MATTERS MOST — by what each customer has spent, the most first, then by
 *   newest contact; the customers with nothing spent after, headed apart.
 *
 * Above both, the "needs attention" band (slipping relationships). Under the
 * switch, the narrowings that hold something to act on: "Did not send" and
 * "Deletion requests" while one exists (rule 18 — a deletion request is
 * always findable), "Needs you" while it is the one asked for (Today's doors
 * lead there). "All" is the list itself; "Mine" was team machinery and is
 * gone (its old address leads to the list).
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
  const q = data.query ?? '';
  const lens: BuyersLens = data.lens ?? 'waiting';
  // "Mine" is no longer drawn (phase 4): a list asked for it reads as the whole list.
  const filter: InboxFilter = data.filter === 'mine' ? 'all' : data.filter;
  const narrowed = filter === 'all' ? undefined : filter;
  const count = (n: number | undefined) => (n ?? 0) > 0 ? ` (${show.quantity(locale, n ?? 0)})` : '';
  const title = `<div class="dhead listhead"><h1 class="page">${esc(t(locale, 'nav.inbox'))}</h1>${LIVE_SLOT}</div>`;

  // A — the search. A find, not a view: it looks across every customer, in the
  // lens the owner is in (the lens rides along; a narrowing does not).
  const search = `<form class="search" method="get" action="/app/inbox" role="search">
      ${lens === 'value' ? '<input type="hidden" name="lens" value="value" />' : ''}<input type="search" name="q" value="${esc(q)}" placeholder="${esc(t(locale, 'buyers.search.placeholder'))}" aria-label="${esc(t(locale, 'buyers.search.label'))}" />
      <button class="btn" type="submit">${esc(t(locale, 'buyers.search.go'))}</button>
    </form>`;
  const page = data.page;
  const total = page?.total ?? data.conversations.length;
  // Phase 9 (V1-183) — one way back from a search: this link.
  const found = q
    ? `<p class="caption muted found" role="status">${esc(data.conversations.length > 0
        ? t(locale, 'buyers.search.found', { q, n: show.quantity(locale, total) })
        : t(locale, 'buyers.search.none', { q }))} · <a class="clear" href="${esc(buyersHref({ lens }))}">${esc(t(locale, 'buyers.search.clear'))}</a></p>` : '';
  const position = page ? t(locale, 'buyers.page.position', {
    from: show.quantity(locale, page.from), to: show.quantity(locale, page.to), total: show.quantity(locale, page.total),
  }) : '';

  // The narrowings: each while it holds something to act on, or while it is the one asked for.
  const chip = (f: Exclude<InboxFilter, 'all' | 'mine'>, n: number | undefined) => {
    const on = filter === f;
    return `<a class="tab${on ? ' on' : ''}"${on ? ' aria-current="true"' : ''} href="${esc(buyersHref({ filter: f, lens }))}">${
      esc(t(locale, `inbox.filter.${f}` as MessageKey))}${count(n)}</a>`;
  };
  const chips = [
    filter === 'pending' ? chip('pending', data.waitingCount) : '',
    data.blockedCount > 0 || filter === 'blocked' ? chip('blocked', data.blockedCount) : '',
    (data.deletionCount ?? 0) > 0 || filter === 'deletion' ? chip('deletion', data.deletionCount) : '',
  ].filter(Boolean);
  const filters = chips.length ? `<nav class="tabs filters" aria-label="${esc(t(locale, 'buyers.tabs'))}">${chips.join('')}${
    narrowed ? `<a class="clear" href="${esc(buyersHref({ lens }))}">${esc(t(locale, 'inbox.empty.seeAll'))}</a>` : ''}</nav>` : '';
  const lensBar = `<div class="lensbar">${lensSwitch(locale, lens, q)}${filters}</div>
    <p class="caption muted lens-says">${esc(t(locale, lens === 'value' ? 'buyers.lens.valueSays' : 'buyers.lens.waitingSays'))}</p>`;

  // The band: slipping relationships, on the first page of the whole list only (the route reads it there).
  const band = attentionBand(data.attention ?? [], locale, now);

  // M38 — the wider list: everyone the assistant may write to. D — a door only
  // where the outreach area exists. Phase 9 (V1-166) — the calendar's door is the phone's.
  const doors = `<div class="doors">${deeper('/app/calendar', t(locale, 'calendar.door'), 'on-phone')}${
    outreachShown() ? deeper('/app/contacts', t(locale, 'contacts.door')) : ''}</div>`;
  const head = `<div class="lhead">${title}${search}</div>${found}${band}${lensBar}`;

  if (data.conversations.length === 0) {
    const all = esc(buyersHref({ lens }));
    const body = q
      ? `<div class="empty">${esc(t(locale, 'buyers.search.noneBody'))}</div>`
      : filter === 'pending'
      ? `<div class="empty"><div class="ok-line">✓ ${esc(t(locale, 'buyers.empty.calm'))}</div>
          <p class="muted">${esc(t(locale, 'inbox.empty.allGoodBody'))} <a href="${all}">${esc(t(locale, 'inbox.empty.seeAll'))}</a></p></div>`
      // M22 — nothing was refused. Stated as the fact it is; not a ✓.
      : filter === 'deletion'
      ? `<div class="empty">${esc(t(locale, 'inbox.empty.deletion'))}
          <div>${deeper(all, t(locale, 'inbox.empty.seeAll'))}</div></div>`
      : filter === 'blocked'
      ? `<div class="empty">${esc(t(locale, 'refused.none'))}
          <div>${deeper(all, t(locale, 'inbox.empty.seeAll'))}</div></div>`
      : `<div class="empty">${esc(t(locale, 'inbox.empty.none'))}<br><span class="muted">${esc(t(locale, 'inbox.empty.noneBody'))}</span>
          <div>${deeper('/app/business', t(locale, 'inbox.empty.setup'))}</div></div>`;
    return `${head}${body}${doors}`;
  }

  // A5's rule, for the channel: named on every row only once there is more than one.
  const showChannel = (data.channels ?? 0) > 1;
  const row = (c: ConversationSummary) => `<li>${inboxRow(locale, c, { now, people, showChannel, ...(q ? { query: q } : {}) })}</li>`;
  const group = (label: string, items: readonly ConversationSummary[], headed: boolean) =>
    items.length ? `<section class="bgroup">
      ${headed ? `<h2 class="bgroup-h">${esc(label)}</h2>` : ''}
      <ul class="irows">${items.map(row).join('')}</ul></section>` : '';

  let rows: string;
  if (lens === 'value') {
    // Matters most: who has spent, the most first; then everyone with nothing spent yet, headed apart.
    const spent = data.conversations.filter((c) => c.spent);
    const none = data.conversations.filter((c) => !c.spent);
    rows = `${group('', spent, false)}${group(t(locale, 'buyers.lens.noSpend'), none, true)}`;
  } else {
    // Phase D — an owner thinks in people, and the question that orders them is
    // "who is speaking now?" — headed on the whole list; a narrowing's own chip
    // already says it, so there only an order and a deletion request are headed.
    const g = waitingGroups(data.conversations);
    const heads = filter === 'all';
    rows = `${group(t(locale, 'buyers.group.order'), g.orders, true)}
    ${group(t(locale, 'buyers.group.deletion'), g.deletion, true)}
    ${group(t(locale, 'buyers.group.needsYou'), g.needsYou, heads)}
    ${group(t(locale, people.length > 1 ? 'buyers.group.team' : 'buyers.group.yours'), g.yours, heads)}
    ${group(t(locale, 'buyers.group.hersWaiting', { name }), g.hersWaiting, heads)}
    ${group(t(locale, 'buyers.group.hers', { name }), g.hersRest, heads)}`;
  }

  // A — the doors either side of this page, and where it sits in the whole.
  // Phase 9 (V1-177) — above the rows as well as under them.
  const pager = page && (page.prev || page.next)
    ? `<nav class="pager" aria-label="${esc(t(locale, 'buyers.page.nav'))}">
        ${page.prev ? back(esc(buyersHref({ filter: narrowed, lens, q, before: page.prev.cursor })), t(locale, 'buyers.page.prev')) : ''}
        <span class="caption muted">${esc(position)}</span>
        ${page.next ? deeper(esc(buyersHref({ filter: narrowed, lens, q, after: page.next })), t(locale, 'buyers.page.next')) : ''}
      </nav>` : '';

  // What the marks on the rows mean, under them — only the marks this page shows.
  const keys = [
    data.conversations.some((c) => c.lastFrom === 'assistant')
      ? `<span class="ck-i"><span class="as" aria-hidden="true">✦</span> ${esc(t(locale, 'buyers.key.wrote', { name }))}</span>` : '',
    data.conversations.some((c) => c.regular === true)
      ? `<span class="ck-i ir-reg">${icon('regular')} ${esc(t(locale, 'buyers.key.regular', { n: show.quantity(locale, REGULAR_ORDERS) }))}</span>` : '',
  ].filter(Boolean);
  const key = keys.length ? `<p class="cr-key caption muted">${keys.join('')}</p>` : '';

  return `${head}
    ${pager}
    ${rows}
    ${key}
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
  const when = a.at ? ` · ${show.when(locale, a.at, now)}` : '';
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
    ${stateHead('warn', t(locale, 'unsure.title'))}
    ${us.map((u) => `<div class="rf">
      <div class="rf-w">${esc(t(locale, 'unsure.what'))}</div>
      <blockquote class="unsure-q" dir="auto">${esc(u.body)}</blockquote>
      <div class="rf-y muted">${esc(t(locale, 'unsure.why'))}</div>
      <div class="rf-t muted">${esc(show.when(locale, u.at, now))}</div>
      <div class="unsure-a">
        <form method="post" action="/app/outbound/${esc(u.outboundId)}/send-again" class="inline">
          <button class="btn send" type="submit">${esc(t(locale, 'unsure.again'))}</button></form>
        <form method="post" action="/app/outbound/${esc(u.outboundId)}/leave" class="inline">
          <button class="btn" type="submit">${esc(t(locale, 'unsure.leave'))}</button></form>
      </div>
    </div>`).join('')}
  </div>`;
}

function refusalCard(rs: readonly Refusal[], locale: Locale, now: Date, channel = 'whatsapp'): string {
  if (rs.length === 0) return '';
  // G5b — the window that closed is the conversation's own channel's, named.
  const name = assistantName(locale);
  const say = { name, channel: channelName(locale, channel) };
  return `<div class="card refused">
    ${stateHead('bad', t(locale, 'refused.title'))}
    ${rs.map((r) => `<div class="rf">
      <div class="rf-w">${esc(t(locale, `refused.what.${r.reason}` as MessageKey, say))}</div>
      <div class="rf-y muted">${esc(t(locale, `refused.why.${r.reason}` as MessageKey, say))}</div>
      <div class="rf-d">${esc(t(locale, `refused.do.${r.reason}` as MessageKey, say))}</div>
      <div class="rf-t muted">${esc(show.when(locale, r.at, now))}</div>
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
/**
 * 0080 — THE ORDER A CUSTOMER SAID YES TO, waiting for the owner's tap.
 *
 * First on the page's list of things to do, because nothing else is decided
 * until it is: exactly what they said yes to, that nothing has been confirmed
 * or sent, the sentence they will be sent when the owner confirms (the
 * reference is only known then), and the owner's two answers — confirm it, or
 * step into the conversation and answer them in their own words. Both are
 * buttons in forms that post: each changes something.
 */
/** Where the order card's two forms post: the conversation's own routes, or Practice's (P4). */
export type OrderTargets = { readonly confirm: string; readonly stepIn: string };

export function orderCard(d: ConversationDetail, locale: Locale, targets?: OrderTargets): string {
  const p = d.orderProposal;
  if (!p) return '';
  const cid = encodeURIComponent(d.conversationId);
  const to: OrderTargets = targets ?? { confirm: `/app/inbox/${cid}/order/confirm`, stepIn: `/app/inbox/${cid}/order/step-in` };
  const fields: readonly (readonly [MessageKey, string])[] = [
    ['order.field.product', p.productName],
    ['order.field.quantity', show.quantityOf(locale, p.quantity, p.unit)],
    ['order.field.total', show.money(locale, p.total)],
    ['order.card.email', p.email],
    ...(p.paymentTerms ? [['order.card.terms', p.paymentTerms] as const] : []),
  ];
  const willSend = orderConfirmedReply({
    orderReference: t(locale, 'order.card.reference'),
    productName: p.productName, quantity: p.quantity, unit: p.unit,
    // LG — the sentence the customer will read, in their language.
    language: fixedLanguage(p.customerLanguage),
  });
  return `<div class="card draft order" role="region" id="order">
      <h2>${esc(t(locale, 'order.card.title'))}</h2>
      <p class="muted review-intro">${esc(t(locale, 'order.card.intro'))}</p>
      <ul class="rows">${fields.map(([k, v]) => `<li class="row"><span class="muted">${esc(t(locale, k))}</span> <bdi>${esc(v)}</bdi></li>`).join('')}</ul>
      <p class="muted">${esc(t(locale, 'order.card.willSend'))}</p>
      <div dir="auto" class="proposed"><bdi>${esc(willSend)}</bdi></div>
      <div class="acts">
        <form method="post" action="${esc(to.confirm)}" class="inline">
          <input type="hidden" name="proposalId" value="${esc(p.id)}" />
          <button class="btn send" type="submit">${esc(t(locale, 'order.action.confirm'))}</button>
        </form>
        <form method="post" action="${esc(to.stepIn)}" class="inline">
          <input type="hidden" name="proposalId" value="${esc(p.id)}" />
          <button class="btn" type="submit">${esc(t(locale, 'order.action.stepIn'))}</button>
        </form>
      </div>
      <p class="muted revoke-note">${esc(t(locale, 'order.action.stepIn.note'))}</p>
    </div>`;
}

function takeoverCard(d: ConversationDetail, locale: Locale, now: Date, viewer: Viewer): string {
  const cid = encodeURIComponent(d.conversationId);
  const reasons = d.handoffReasons.length
    ? `<div class="why muted">${esc(labelled(locale, t(locale, 'takeover.why'),
        formatList(locale, d.handoffReasons.map((k) => t(locale, `takeover.reason.${k}` as MessageKey)))))}</div>`
    : '';
  const last = d.lastHumanAction ? lastActionLine(d.lastHumanAction, locale, now, d.people ?? [], viewer) : '';
  // One control per act: while the approval card is up, its "Hand to me" is the take-over.
  const takeBtn = d.pendingDraft ? '' : `<form method="post" action="/app/inbox/${cid}/takeover" class="inline"><button class="btn ${d.ownership === 'WAITING_HUMAN' ? 'send' : ''}" type="submit">${esc(t(locale, 'takeover.action.take'))}</button></form>`;

  /**
   * G12 — pass it to the colleague who can answer it. Offered once there is
   * more than one person here, and never back to whoever already holds it.
   * A staff member has no phone number, so this list is how they learn a
   * conversation is theirs.
   */
  // …and only where there are colleagues: a business of one has nobody to hand it to.
  // Phase 9 (V1-218, V1-251) — nor to yourself where taking it already has its
  // own control ("Take over", or the draft card's "Hand to me"): a second one
  // offering "Hand to [You]" did the same. Held by a colleague, it is the way.
  /*
   * The fix wave (w4-conversation-03, -04, -18) — Nomi has one owner and no
   * team machinery (UI-BENCHMARK §10). Handing on to a colleague stays only
   * where a PERSON must answer: the conversation waits for a person, or a
   * colleague holds it. On a conversation the assistant holds — answered, or
   * with a reply waiting under the draft card — it is gone. The reader is never
   * an option in the list: taking it yourself is its own button ("I'll reply"),
   * which for a conversation a colleague holds posts the same hand-to with your
   * own id ("Confier à [moi]" was not French).
   */
  const isViewer = (p: Person): boolean => (viewer.id ? p.id === viewer.id : p.isOwner);
  const me = (d.people ?? []).find(isViewer) ?? null;
  const personMustAnswer = d.ownership !== 'AI';
  const others = personMustAnswer && (d.people ?? []).length > 1
    ? (d.people ?? []).filter((p) => p.id !== d.heldBy && !isViewer(p)) : [];
  const handToForm = others.length === 0 ? '' : `
    <form method="post" action="/app/inbox/${cid}/handto" class="handto">
      <label class="muted" for="handto">${esc(t(locale, 'handto.label'))}</label>
      <select id="handto" name="personId" required>
        ${others.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
      </select>
      <button class="btn" type="submit">${esc(t(locale, 'handto.button'))}</button>
    </form>`;
  // Held by a colleague: taking it yourself is handing it to yourself.
  const heldByOther = d.ownership === 'OWNER_CONTROLLED' && me !== null && d.heldBy !== null && d.heldBy !== undefined
    && d.heldBy !== me.id && !(d.heldBy === 'owner' && viewer.isOwner);
  const takeFromColleague = heldByOther ? `
    <form method="post" action="/app/inbox/${cid}/handto" class="inline">
      <input type="hidden" name="personId" value="${esc(me!.id)}" />
      <button class="btn" type="submit">${esc(t(locale, 'takeover.action.take'))}</button>
    </form>` : '';

  const ownerPill = esc(holderLabel(d, locale, viewer));

  switch (d.ownership) {
    case 'AI':
      // The fix wave (w4-conversation-03) — with a reply waiting, the draft card above is the whole
      // story and its "I'll reply" the take-over: a second card under it repeated "it waits for your OK".
      if (d.pendingDraft) return '';
      // Phase 9 (conversation-new-06) — with nothing waiting, the card says so itself: in a dashed box
      // of its own the line read as an empty drop zone, narrower than the cards around it.
      return `<div class="card takeover"><span class="pill as">${esc(t(locale, 'takeover.status.ai'))}</span>${
        d.working === true ? '' : `<p class="muted takeover-note">${esc(t(locale, 'inbox.draft.none'))}</p>`}${last}${takeBtn}</div>`;
    case 'WAITING_HUMAN':
      return `<div class="card takeover warn"><span class="pill warn">${esc(t(locale, 'takeover.status.waiting'))}</span>${reasons}${last}${takeBtn}${handToForm}</div>`;
    case 'OWNER_CONTROLLED':
      return `<div class="card takeover owner">
        <span class="pill owner">${ownerPill}</span>
        ${last}
        ${takeFromColleague}
        ${handToForm}
        <form method="post" action="/app/inbox/${cid}/reply" class="replyform">
          ${d.ownerUnsentReply ? `<p class="muted" role="note">${esc(t(locale, 'takeover.reply.kept'))}</p>` : ''}
          <textarea name="text" rows="2" dir="auto" placeholder="${esc(t(locale, 'takeover.replyPlaceholder'))}" required data-keep="${esc(`${d.conversationId}:reply`)}">${esc(d.ownerUnsentReply ?? '')}</textarea>
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
  return ` · <span class="her-money">${esc(show.money(locale, c.value.money))} <span class="muted">${
    esc(t(locale, 'rate.at', { date: show.date(locale, rate.statedAt) }))}</span></span>`;
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

/**
 * The design pass (2026-09-29) — every other card on this page is drawn as a
 * state of the one card: a dot, the state's own words, then why and what to
 * do. `warn` waits for the owner; `bad` did not happen. The word carries the
 * state; the dot only marks it, so nothing rests on colour alone.
 */
const stateHead = (tone: 'warn' | 'bad', title: string): string =>
  `<p class="stateline rf-h">${signalMark(tone === 'warn' ? 'waiting' : 'failed')} <b>${esc(title)}</b></p>`;

/**
 * G5b — a reply that waited past the day its channel allows. It was never
 * sent and cannot be now: the card says so and where the owner can still
 * answer (the channel's own app), instead of a Send the channel would refuse.
 */
function expiredCard(d: ConversationDetail, locale: Locale): string {
  if (!d.expiredDraft || d.pendingDraft) return '';
  const say = { name: assistantName(locale), channel: channelName(locale, d.channel ?? 'whatsapp') };
  return `<div class="card refused">
    ${stateHead('bad', t(locale, 'expired.title'))}
    <blockquote class="unsure-q" dir="auto">${esc(d.expiredDraft.text)}</blockquote>
    <div class="rf-y muted">${esc(t(locale, 'expired.why', say))}</div>
    <div class="rf-d">${esc(t(locale, 'expired.do', say))}</div>
  </div>`;
}

/**
 * THE APPROVAL CARD (the design pass, 2026-09-29; rebuilt in phase 2 of the UI
 * rebuild, 2026-10-02). One card, one decision, drawn decision first: who
 * drafted it and where it goes; what made it wait, if anything; the reply ONCE,
 * in the only box on the page; the acts — Send (the one fill), then Hand to me
 * and No reply needed, both outlined; and last, one quiet line that opens to
 * what was understood and how the reply was read.
 *
 * Phase 2 took out what the page already shows or what did nothing: the
 * customer's message is directly above the card in the transcript, so the card
 * no longer repeats it, nor who asked and when; "Edit" only put the cursor in
 * a box that is always editable, so it went; and the card stays in the page's
 * own order on every width — it no longer docks over the transcript, so
 * opening "How … read this" pushes nothing over the customer's words.
 *
 * ONE FORM, ONE SEND. The box is the reply: Send posts what is in it, and the
 * route sends it as it was drafted or as the owner's edit, through the same
 * approval path as before (`command=send`). Hand to me posts the same form to
 * the take-over route. Nothing here needs the script.
 *
 * "No reply needed" is its own act, not a fourth button: the customer wrote
 * "thanks 👍", a reply was drafted, and the right answer is silence without
 * taking the conversation over (it was Skip). It changes something, so it is
 * a button; it is the quiet one, words at the far end, so the row still reads
 * as three choices about the reply.
 *
 * Moved off the card: "Stop doing this alone" lives on the assistant's page,
 * where how much it sends alone is set; the paragraphs that explained the
 * buttons are gone — the labels say what the buttons do. What made the draft
 * wait (its hold, the disclosure, a contradicted price, a forbidden word) is
 * the card's state line, drawn before anything else on it.
 */
/**
 * Where the card's two forms post. A conversation's own routes, unless the card
 * is drawn elsewhere: Practice (P4) draws this same card for the practice copy's
 * reply, posting to its own routes — one card, one approval path.
 */
export type ApprovalTargets = {
  readonly act: string; readonly handTo: string;
  /** G10 — where "translate it for me" posts; absent (Practice), no button. */
  readonly translate?: string;
};

export function approvalCard(d: ConversationDetail, locale: Locale, now: Date, targets?: ApprovalTargets): string {
  const p = d.pendingDraft;
  if (!p) return '';
  const cid = encodeURIComponent(d.conversationId);
  const to: ApprovalTargets = targets ?? { act: `/app/inbox/${cid}/act`, handTo: `/app/inbox/${cid}/takeover`, translate: `/app/inbox/${cid}/translate` };
  const name = assistantName(locale);
  const channel = d.channel ? channelName(locale, d.channel) : null;
  const lastIn = [...d.messages].reverse().find((m) => m.direction === 'inbound') ?? null;
  const r = d.reading ?? null;

  // Who drafted it, and where Send sends it. Who asked and when is the
  // transcript's caption directly above the card; it is not said twice.
  const top = `<div class="top"><span class="as"><span aria-hidden="true">✦</span> ${
    esc(t(locale, 'card.drafted', { name }))}</span>${channel ? `<span class="k">${esc(t(locale, 'card.goes', { channel }))}</span>` : ''}</div>`;

  // What made it wait: a dot, the state's word, then today's sentence for it.
  const waits = (sentence: string) => `<p class="stateline" role="note">${signalMark('waiting')} <b>${
    esc(t(locale, 'card.waiting'))}</b> ${esc(sentence)}</p>`;
  const state = [
    p.heldBecause ? waits(t(locale, `inbox.draft.held.${p.heldBecause}` as MessageKey, { name })) : '',
    p.disclosureSent ? waits(t(locale, 'inbox.draft.held.disclosure_sent', { name })) : '',
    p.withheld ? waits('language' in p.withheld
      ? t(locale, `inbox.draft.held.${p.withheld.reason}`, { name, language: languageName(locale, p.withheld.language) })
      : t(locale, `inbox.draft.held.${p.withheld.reason}`, { name })) : '',
    p.contradicts ? contradictionBlock(p.contradicts, locale) : '',
    p.forbidden?.length ? `<p class="held-why"><bdi>${esc(t(locale, 'inbox.draft.held.words', { terms: quoted(locale, p.forbidden) }))}</bdi></p>` : '',
  ].join('');

  // G10 (decision 38) — a reply in a language the owner may not read: said so,
  // its figures listed in Western digits from the reply itself, and a
  // translation into the owner's own language on request — never sent.
  const foreign = p.language && p.language !== locale ? (() => {
    const nums = figuresIn(p.draftText);
    const tr = p.translation && p.translation.locale === locale ? p.translation.text : null;
    return `<div class="foreign">
      ${waits(t(locale, 'card.foreign', { language: languageName(locale, p.language!) }))}
      ${nums.length ? `<p class="muted">${esc(t(locale, 'card.foreign.figures'))} ${nums.map((n) => `<bdi dir="ltr">${esc(n)}</bdi>`).join(', ')}</p>` : ''}
      ${tr ? `<p class="k">${esc(t(locale, 'card.foreign.translation', { language: languageName(locale, locale) }))}</p>
      <blockquote class="said" dir="auto"><bdi>${esc(tr)}</bdi></blockquote>`
        : to.translate ? `<form method="post" action="${esc(to.translate)}"><input type="hidden" name="draftId" value="${esc(p.draftId)}" />
      <button class="btn" type="submit">${esc(t(locale, 'card.foreign.translate', { language: languageName(locale, locale) }))}</button></form>` : ''}
    </div>`;
  })() : '';

  // Understood: what they want, the product, the quantity (only if they gave one), the language.
  const prod = productName(locale, d.product);
  const intentKey = r?.intent ? `card.intent.${r.intent}` as MessageKey : null;
  const understood = [
    intentKey && t(locale, intentKey) !== intentKey ? t(locale, intentKey) : null,
    prod,
    r?.quantity ? show.quantityOf(locale, r.quantity.value, r.quantity.unit || t(locale, 'product.unit.pcs')) : null,
    r?.language ? languageName(locale, r.language) : null,
  ].filter((x): x is string => !!x);
  const und = understood.length
    ? `<p class="und"><span class="k">${esc(labelled(locale, t(locale, 'card.understood'), '').trimEnd())}</span> <span>${understood.map((x) => `<bdi>${esc(x)}</bdi>`).join(' · ')}</span></p>`
    : '';

  // How it was read: one line per product name and figure in the reply, each with its source.
  const read = readReply({
    reply: p.draftText,
    productNames: [d.product.name, d.product.nameZh].filter((x): x is string => !!x),
    // The quote's figures always count: from the loader with the extras it read,
    // else the three the page already holds.
    quote: r?.quote ?? (d.quote ? {
      unitPrice: d.quote.unitPrice.amount, total: d.quote.total.amount, quantity: d.quote.quantity,
      discountPct: 0, leadTimeDays: null, moq: null,
    } : null),
    theirTexts: d.messages.filter((m) => m.direction === 'inbound').map((m) => m.text),
    heldQuantity: d.quantity,
    productCodes: [ownSku(d.product.sku)].filter((x): x is string => x !== null),
  });
  const figure = (l: Extract<ReadingLine, { kind: 'figure' }>): string =>
    l.source === 'price' && d.quote ? show.money(locale, d.quote.unitPrice)
    : l.source === 'total' && d.quote ? show.money(locale, d.quote.total)
    : l.value.toLocaleString('en-US', { maximumFractionDigits: 4 });
  // The fix wave (w4-conversation-01) — "check this" is not "waiting for you": ink, and a question
  // mark, never the magenta ○. (w4-conversation-07) — each part in a span of the page's direction,
  // so in Arabic the figure stands beside its mark, not at the far edge of the row.
  // (w4-conversation-08) — a code in the pointer never breaks at its hyphen.
  const line = (ok: boolean, said: string, source: string, where = '') =>
    `<li><span class="${ok ? 'mk' : 'mk check'}" aria-hidden="true">${ok ? '✓' : UNSURE[locale]}</span><span><bdi>${esc(said)}</bdi></span><span>${source}${
      where ? ` <bdi class="muted">${esc(where).replace(/[^\s]*[\p{L}\p{N}]-[\p{L}\p{N}][^\s]*/gu, (w) => `<span class="fig">${w}</span>`)}</bdi>` : ''}</span></li>`;
  // Phase 9 (V1-242) — the product's name kept whole where the line has room:
  // «سعر LED String Lights / 10m في قائمة أسعارك» broke the name in two.
  const priceSource = (product: string): string =>
    esc(t(locale, 'card.source.price', { product: '\u0000' })).replace('\u0000', `<bdi class="pname">${esc(product)}</bdi>`);
  // Phase 9 (V1-220) — where in the reply a figure stands: "300" alone was
  // unreadable; "…model ZX-300 has…" says it came from the model's name.
  const whereIn = (value: number): string => {
    const text = p.draftText;
    const forms = [String(value), value.toLocaleString('en-US')];
    const at = forms.map((f) => text.indexOf(f)).filter((i) => i >= 0).sort((x, y) => x - y)[0];
    if (at === undefined) return '';
    const from = Math.max(0, text.lastIndexOf(' ', Math.max(0, at - 14)) + 1);
    const toSpace = text.indexOf(' ', Math.min(text.length, at + String(value).length + 10));
    const to = toSpace < 0 ? text.length : toSpace;
    return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
  };
  const reasons = [
    ...read.lines.map((l) => l.kind === 'product'
      ? line(true, inQuotes(locale, l.name), esc(t(locale, 'card.source.product')))
      : l.kind === 'code' ? line(true, l.code, esc(t(locale, 'card.source.code')))
      : line(l.source !== 'unsourced', figure(l), l.source === 'price'
        ? (prod ? priceSource(prod) : esc(t(locale, 'card.source.priceAny')))
        : esc(t(locale, `card.source.${l.source}` as MessageKey)), l.source === 'unsourced' ? whereIn(l.value) : '')),
    ...d.knowledgeUsed.map((k) => line(true, k, esc(t(locale, 'card.source.taught')))),
    // Phase 9 (V1-221, V1-253) — a claim the reply makes (a certification, a
    // term, a guarantee), and whether you confirmed it: "CE certified" stood in
    // a draft with nothing on the card, while no certification was confirmed.
    ...detectClaims(p.draftText).map((c) => {
      const confirmed = (d.claimsAllowed ?? []).includes(`${c.kind}:${c.claimKey}`);
      return line(confirmed, inQuotes(locale, c.matchedText), esc(t(locale, confirmed ? 'card.source.claim' : 'card.source.claimUnconfirmed')));
    }),
    ...(r?.differsOn === null || r?.differsOn === undefined ? []
      : r.differsOn.length === 0 ? [line(true, t(locale, 'card.checked'), esc(t(locale, 'card.checked.same')))]
      : [line(false, t(locale, 'card.checked.differs'), esc(t(locale, 'card.checked.differsOn', {
          fields: formatList(locale, r.differsOn.map((f) => t(locale, `card.field.${f}` as MessageKey))),
        })))]),
  ];
  // One quiet line under the acts, opening downward: what was understood, and
  // how the reply was read. A figure nothing accounts for is said on the line
  // itself, with the ○ that marks it in the list it opens.
  // Phase 9 (V1-222) — which figure, and which claim: "Not every figure has a
  // source" sent the owner into the fold to find out. A count of reasons beside
  // it said nothing the owner acts on, so the line carries only what needs them.
  const unsourced = [...new Set(read.lines.flatMap((l) => (l.kind === 'figure' && l.source === 'unsourced' ? [figure(l)] : [])))];
  const unconfirmed = [...new Set(detectClaims(p.draftText)
    .filter((c) => !(d.claimsAllowed ?? []).includes(`${c.kind}:${c.claimKey}`)).map((c) => inQuotes(locale, c.matchedText)))];
  // The fix wave (w4-conversation-02) — both, when both: a claim you never confirmed was left
  // off the line whenever a figure had no source, and the owner had to open the fold to learn it.
  const check = (words: string) => `<span class="c check"><span aria-hidden="true">${UNSURE[locale]}</span> ${esc(words)}</span>`;
  const how = reasons.length || und
    ? `<details class="reading"><summary><span class="t">${esc(t(locale, 'card.reasons', { name }))}</span>${
        unsourced.length ? check(t(locale, 'card.unsourcedWhich', { figures: formatList(locale, unsourced) })) : ''}${
        unconfirmed.length ? check(t(locale, 'card.unconfirmedWhich', { claims: formatList(locale, unconfirmed) })) : ''}</summary>${
        und}${reasons.length ? `<ul class="reasons">${reasons.join('')}</ul>` : ''}</details>`
    : '';

  // The reply's window, where the channel has one: until when it can still go.
  const hours = d.channel ? CHANNEL_REGISTRY[d.channel as OutreachChannel]?.replyWindowHours ?? null : null;
  const until = hours !== null && lastIn?.at ? new Date(lastIn.at.getTime() + hours * 3_600_000) : null;
  const window = channel && until && until > now
    ? `<span>${esc(t(locale, 'card.window', { channel, time: show.until(locale, until, now) }))}</span>` : '';
  // CH5 — the window's clock: under two hours left, the card says so first, in words.
  const closing = channel && until && until > now && until.getTime() - now.getTime() <= CLOSING_SOON_MS
    ? `<p class="stateline" role="note">${signalMark('waiting')} <b>${esc(t(locale, 'card.closingSoon'))}</b> ${
        esc(t(locale, 'card.closingIn', { channel, left: show.timeLeft(locale, until.getTime() - now.getTime()) }))}</p>`
    : '';

  return `<section class="card draft" id="approve" aria-labelledby="approve-h">
      <h2 id="approve-h" class="sr">${esc(t(locale, 'buyers.review.title', { name }))}</h2>
      ${top}
      ${closing}
      ${state}
      ${foreign}
      <form method="post" action="${esc(to.act)}" class="approve">
        <input type="hidden" name="draftId" value="${esc(p.draftId)}" />
        <label for="reply" class="sr">${esc(t(locale, 'card.reply'))}</label>
        ${p.ownerEdit ? `<p class="muted" role="note">${esc(t(locale, 'inbox.edit.kept'))}</p>` : ''}
        ${/* CC-24 — the box opens with the owner's kept edit, else with the draft itself: an edit, not a retyping.
             CC-26 — and what is typed in it is kept by the page's script, by conversation and box, until it is sent. */ ''}<textarea id="reply" name="edit" rows="${replyRows(p.ownerEdit ?? p.draftText)}" dir="auto" data-keep="${esc(`${d.conversationId}:edit`)}">${esc(p.ownerEdit ?? p.draftText)}</textarea>
        <div class="acts">
          <button class="btn send" type="submit" name="command" value="send">${esc(t(locale, 'inbox.action.send'))}</button>
          <button class="btn" type="submit" formaction="${esc(to.handTo)}">${esc(t(locale, 'card.handToMe'))}</button>
        </div>
        ${/* Phase 9 (V1-237) — the owner's call (2026-10-03): "No reply needed" leaves the row of
             the two answers and sits on its own line under them, with the window; it puts
             the reply away for good, so it asks first. What it does when pressed is unchanged. */ ''}<div class="acts-more">
          <button class="btn" type="submit" name="command" value="不回"
            onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'card.noReply.confirm'))}">${esc(t(locale, 'card.noReply'))}</button>
          ${window ? `<p class="src">${window}</p>` : ''}
        </div>
      </form>
      ${how}
    </section>`;
}

/**
 * Phase 2 — the reply box shows the whole draft: where the browser can, it
 * grows to its text (`field-sizing: content`); elsewhere it opens with enough
 * rows for the draft at a phone's width (about 32 characters a line), never
 * fewer than three nor more than ten. A draft cut off just above Send was the
 * audit's complaint.
 */
export const replyRows = (text: string): number => {
  const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(Array.from(l).length / 32)), 0);
  return Math.min(10, Math.max(3, lines));
};

/** A language's name in the owner's language ("English", "英语", "الإنجليزية"); the code if unknown. */
export function languageName(locale: Locale, code: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The strip's separator: a line may break after it, never before it. */
const CU_SEP = '&nbsp;· ';

/** Items said one after another the way the language lists them, without an "and". */
const LIST_SEP: Readonly<Record<Locale, string>> = { en: ', ', zh: '、', ar: '، ', es: ', ', fr: ', ' };

/**
 * THE WARMTH RUN (2026-10-03), phase 5 — THE CATCH-UP STRIP. Whoever opens a
 * conversation may never have seen it: the owner, or whoever runs the
 * socials. Above the messages, in the first screen on a phone, it says who
 * this is, where they write, what they have bought and spent, and where things
 * stand now.
 *
 *   - Their face, which opens their card (`faceLink`), and their name — the
 *     page's one heading, drawn as the header always drew it (`buyerWho`).
 *   - Where they write (`reachedOn`, the panel's own line); what they bought —
 *     the products of their orders that stand, "Canvas tote ×2, Apron" — and
 *     what they spent (`customerValues`), or "Nothing bought yet"; what this
 *     conversation is about, when it is not something they bought: "Asked
 *     about LED String Lights 10m, 5,000 pcs" (the conversation's product and
 *     quantity, else the panel's reading or the newest price worked out for
 *     them); "Regular" when Nomi counts them one.
 *   - The fix wave (w4-conversation-05, -15): a customer who bought nothing
 *     had no line about buying at all, and the product under the strip was
 *     unlabelled — bought, or asked about? — and repeated what "Bought" named.
 *     It is the strip's own labelled line now, said once.
 *   - THE STATE OF PLAY (`stateOfPlay`, pure, its precedence in one place):
 *     the pill says who it waits for — "Needs you" whenever the Buyers list
 *     puts them under it, in its words; otherwise who holds the conversation,
 *     as the header said — and the line after it says why, or what happened
 *     last.
 *
 * The rest of the customer stays in the panel beside the conversation on a
 * wide screen; the strip does not repeat it on a phone. Right to left, the
 * face sits at the start (the right) and every name, figure and address is
 * isolated.
 */
function catchUpStrip(d: ConversationDetail, locale: Locale, now: Date, viewer: Viewer): string {
  const c = d.catchUp ?? null;
  const who = d.buyer ?? t(locale, 'common.buyer');
  const row = {
    orderWaiting: Boolean(d.orderProposal), deletionWaiting: Boolean(d.deletionAsk), ownership: d.ownership,
    handoffReason: d.handoffReasons[0] ?? null, awaitingReview: d.pendingDraft !== null && d.ownership === 'AI',
    answeredBy: d.answeredBy ?? null,
  };
  const play = stateOfPlay({
    orderWaiting: row.orderWaiting, deletionWaiting: row.deletionWaiting,
    handedOver: d.ownership === 'WAITING_HUMAN', handoffReason: row.handoffReason, replyToReview: row.awaitingReview,
    lastOrder: c?.lastOrder ?? null, quoteSentAt: c?.quoteSentAt ?? null,
    lastFromThemAt: c?.lastFromThemAt ?? null, lastMessage: c?.lastMessage ?? null,
  }, now);
  const pill = play.kind === 'needs'
    ? `<span class="pill warn">${esc(t(locale, 'inbox.filter.pending'))}</span>`
    : headerPill(d, locale, viewer);

  // A sentence around something already drawn (a list, a figure): the words escaped, then the piece put in.
  const around = (key: MessageKey, param: string, html: string): string =>
    esc(t(locale, key, { [param]: '\u0000' })).replace('\u0000', html);
  const speaker = (s: Speaker): string => s === 'buyer' ? `<bdi>${esc(who)}</bdi>`
    : s === 'person' ? esc(t(locale, 'conv.by.you')) : byAssistant(assistantName(locale));
  const head = (key: MessageKey): string => `<b>${esc(t(locale, key))}</b>`;
  // The fix wave (w4-conversation-14) — a line breaks only after a separator, never
  // before one, and never inside a time, a name or a reference: "Last message · ✦
  // Your assistant" over "· 16:31", and "USAB-de300000-" over "0001", read as broken.
  const when = (at: Date): string => `<span class="fig">${esc(show.shortWhen(locale, at, now))}</span>`;
  const story = !c ? '' : ((): string => {
    switch (play.kind) {
      case 'needs': return `<b><bdi>${esc(needsWhy(locale, row))}</bdi></b>`;
      case 'ordered': return [head('catchup.state.ordered'), `<bdi class="fig">${esc(play.reference)}</bdi>`, when(play.at)].join(CU_SEP);
      case 'quoted': return [head('catchup.state.quoted'), when(play.at)].join(CU_SEP);
      case 'quiet': return [head('catchup.state.quiet'), esc(t(locale, 'catchup.state.quietSince', { date: show.date(locale, play.since) }))].join(CU_SEP);
      case 'talking': return [head('catchup.state.talking'), `<span class="fig">${speaker(play.from)}</span>`, when(play.at)].join(CU_SEP);
      case 'last': return [head('catchup.state.last'), `<span class="fig">${speaker(play.from)}</span>`, when(play.at)].join(CU_SEP);
      case 'none': return head('catchup.state.none');
    }
  })();

  // What this conversation is about: its own product and quantity, else what they asked about last.
  const about = !c ? null
    : productName(locale, d.product) ? { name: productName(locale, d.product)!, qty: d.quantity }
    : c.askedAbout && productName(locale, c.askedAbout) ? { name: productName(locale, c.askedAbout)!, qty: null } : null;
  const boughtNames = new Set((c?.bought ?? []).map((b) => productName(locale, b)));
  const asked = !about || boughtNames.has(about.name) ? ''
    : about.qty !== null
      ? esc(t(locale, 'catchup.askedQty', { product: '\u0000', qty: '\u0001' }))
          .replace('\u0000', `<bdi>${esc(about.name)}</bdi>`)
          .replace('\u0001', `<bdi class="fig">${esc(show.quantityOf(locale, about.qty, t(locale, 'product.unit.pcs')))}</bdi>`)
      : around('catchup.asked', 'product', `<bdi>${esc(about.name)}</bdi>`);
  const facts = !c ? [] : c.bought.length > 0 ? [
    around('catchup.bought', 'items', `${c.bought.map((b) => `<bdi>${esc(productName(locale, b) ?? '')}</bdi>${
      b.orders > 1 ? `&nbsp;<bdi dir="ltr">×${esc(show.count(locale, b.orders))}</bdi>` : ''}`).join(LIST_SEP[locale])}${
      c.boughtMore > 0 ? ` ${esc(t(locale, 'catchup.more', { n: c.boughtMore }))}` : ''}`),
    asked,
    // The sum and its word never wrap apart (`.fig`): "$1,240.00" at a line's end and "spent" under it read as two facts.
    c.value.spent ? `<span class="fig">${around('catchup.spent', 'money', `<bdi>${esc(show.money(locale, c.value.spent))}</bdi>`)}</span>` : '',
  ].filter(Boolean) : [asked, esc(t(locale, 'catchup.none'))].filter(Boolean);
  const regular = c?.value.regular ? ` <span class="cu-regular">${esc(t(locale, 'catchup.regular'))}</span>` : '';

  // Beside the face: who and where. Under both, the width of the column: what they bought, and where things stand.
  return `<header class="catchup${c ? '' : ' bare'}">
      ${c ? faceLink({ clientId: c.clientId, name: d.buyer, photo: c.photo }, { size: 'l', label: t(locale, 'catchup.card', { who }) }) : ''}
      ${/* CC-20 — the buyer is what this page is about: its one heading. */ ''}<h1 class="who">${buyerWho(locale, d.buyer, d.country)}</h1>
      ${c ? `<p class="cu-where">${reachedOn(locale, c.channel, c.address)}</p>` : ''}
      ${facts.length || regular ? `<p class="cu-facts">${facts.join(CU_SEP)}${regular}</p>` : ''}
      <p class="cu-state">${pill}${story ? `<span class="cu-story">${story}</span>` : ''}</p>
    </header>`;
}

export function renderConversationDetail(
  d: ConversationDetail, locale: Locale, now: Date, flash: Flash | null, viewer: Viewer = OWNER_VIEW,
): string {
  const pcs = t(locale, 'product.unit.pcs');
  const prod = productName(locale, d.product);
  // Each figure isolated: in Arabic one run of quantity, unit, price and total
  // reordered itself ("1.45$/قطعة"). The separators keep the page's direction.
  const iso = (x: string): string => `<bdi>${esc(x)}</bdi>`;
  const fig = (x: string): string => `<bdi class="fig">${esc(x)}</bdi>`;
  const context = (d.quote || d.order) ? `<div class="ctx">
      ${d.quote ? `<div><span class="muted">${esc(t(locale, 'inbox.ctx.quote'))}</span> ${[
        fig(show.quantityOf(locale, d.quote.quantity, pcs)),
        fig(perPiece(locale, d.quote.unitPrice)),
        fig(`${t(locale, 'product.detail.total')} ${show.money(locale, d.quote.total)}`),
      ].join(' · ')}${inHerMoney(d.quote.total, d.rate, locale)}</div>` : ''}
      ${d.order ? `<div><span class="muted">${esc(t(locale, 'inbox.ctx.order'))}</span> ${[
        iso(d.order.reference), iso(orderStatusName(locale, d.order.status)),
        ...(d.order.total !== null ? [iso(show.money(locale, d.order.total))] : []),
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
  const dayOf = (m: TimelineMessage): string | null => (m.at ? dayKey(m.at, workspaceZone()) : null);
  const divider = (m: TimelineMessage, i: number): string => {
    const k = dayOf(m);
    return k !== null && (i === 0 || dayOf(d.messages[i - 1]!) !== k)
      ? `<p class="tday"><span>${esc(show.day(locale, m.at!, now))}</span></p>` : '';
  };
  const timeline = d.messages.length
    ? `<div class="timeline">${d.messages.map((m, i) => `${divider(m, i)}
        <div${i === last ? ' id="latest"' : ''} class="msg ${m.direction}">
          ${/* The fix wave (w4-conversation-17) — what the assistant said is marked BEFORE its words, as phase 5
               meant: under a long reply the mark came after it. The caption under keeps the time. */ ''}${
            m.direction === 'outbound' && m.by !== 'owner' ? `<div class="msg-by">${byAssistant(assistantName(locale))}</div>` : ''}
          ${m.heard ? voiceBubble(locale, m, d.conversationId)
            : m.received ? receivedBubble(locale, m)
            : `<div dir="auto" class="${bubbleClass(speakerOf(m))}"><bdi>${esc(m.text)}</bdi></div>`}
          <div class="ts muted">${[m.at ? esc(show.time(locale, m.at)) : '',
            // The design pass (UI-PASS 5): each speaker by their name — the
            // customer's, "You", the assistant's — never a role word; a
            // customer with no name yet is just their message.
            m.direction === 'inbound' ? (d.buyer ? `<bdi>${esc(d.buyer)}</bdi>` : '')
            : m.by === 'owner' ? esc(t(locale, 'conv.by.you')) : ''].filter(Boolean).join(' · ')}</div>
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

  const draftCard = approvalCard(d, locale, now);
  // Phase 5 — while the assistant is at work on the newest message, the place
  // its reply will take says so, directly under that message; the page's
  // script draws the reply in when it lands. "No reply" is not said meanwhile.
  const working = d.working === true && d.ownership === 'AI' ? workingLine(locale) : '';

  // Phase D — "why did she say that?", from the stored usage audit. Shown only
  // while SHE is speaking: once a human takes over it is no longer the question.
  const knew = d.ownership === 'AI' && d.knowledgeUsed.length > 0 && !d.pendingDraft
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
        ${stateHead('warn', t(locale, 'unheard.title'))}
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
        ${stateHead('warn', t(locale, 'unreadable.title'))}
        <div class="rf">
          <div class="rf-w">${esc(t(locale, 'unreadable.what', {
            name: assistantName(locale),
            what: t(locale, `received.${d.unreadable}` as MessageKey),
          }))}</div>
          <div class="rf-y muted">${esc(t(locale, 'unreadable.why'))}</div>
          <div class="rf-d">${esc(t(locale, 'unreadable.do'))}</div>
          ${d.unreadableCaption ? `<div class="rf-d muted" dir="auto">${esc(t(locale, 'unreadable.caption', { caption: d.unreadableCaption }))}</div>` : ''}
          ${d.unreadableRef ? deeper(esc(d.unreadableRef), t(locale, 'unreadable.open'), '', 'rel="noopener noreferrer" target="_blank"') : ''}
        </div>
      </div>`
    : '';

  /**
   * G10c — someone not on her pilot list wrote. Same three parts: what came,
   * why she did not answer, and the two things the owner can do about it.
   */
  const unlistedCard = d.handoffReasons.includes('unlisted_number')
    ? `<div class="card refused">
        ${stateHead('warn', t(locale, 'unlisted.title'))}
        <div class="rf">
          <div class="rf-w">${esc(t(locale, 'unlisted.what', { name: assistantName(locale) }))}</div>
          <div class="rf-y muted">${esc(t(locale, 'unlisted.why', { name: assistantName(locale) }))}</div>
          <div class="rf-d"><a href="/app/business">${esc(t(locale, 'unlisted.do'))}</a></div>
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
        ${stateHead('warn', t(locale, 'deletionAsked.title'))}
        <div class="rf">
          ${deletionAsked ? `<div class="rf-w">${esc(t(locale, 'deletionAsked.what', { name: assistantName(locale) }))}</div>` : ''}
          ${d.deletionAsk
            ? `<div class="rf-t">${esc(t(locale, 'deletionAsked.noted', { date: show.date(locale, d.deletionAsk.askedAt) }))}</div>`
            : d.deletionRecorded
              ? `<div class="rf-t">${esc(t(locale, 'deletionAsked.recorded', { due: show.date(locale, deletionDueBy(d.deletionRecorded.askedAt)) }))}</div>`
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
        ${stateHead('warn', t(locale, 'closures.blocked.title'))}
        <div class="rf">
          <div class="rf-y muted">${esc(t(locale, 'closures.blocked.body', {
            label: d.leadTimeBlocked.label,
            from: show.date(locale, d.leadTimeBlocked.from),
            to: show.date(locale, d.leadTimeBlocked.to),
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
        ${stateHead('bad', t(locale, 'herwords.title'))}
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
        ${stateHead('warn', t(locale, 'samples.asked.title'))}
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
    ${orderCard(d, locale)}
    ${working}
    ${d.ownership === 'OWNER_CONTROLLED' ? '' : draftCard}
    ${takeoverCard(d, locale, now, viewer)}
    ${deletionCard}
    ${unheardCard}
    ${unreadableCard}
    ${unlistedCard}
    ${closedCard}
    ${herWordsCard}
    ${sampleCard}
    ${uncertainCard(d.uncertainSends, locale, now)}
    ${refusalCard(d.refusals, locale, now, d.channel)}
    ${expiredCard(d, locale)}
    ${knew}
    ${context}`;

  return `
    <div class="dhead">
      ${back('/app/inbox', t(locale, 'inbox.detail.back'))}
      ${LIVE_SLOT}
    </div>
    ${catchUpStrip(d, locale, now, viewer)}
    ${d.answeredBy ? `<div class="muted subline"><bdi>${esc(t(locale, 'conv.answeredBy', { who: d.answeredBy }))}</bdi></div>` : ''}
    ${older ? '' : assistantControl(d, locale, viewer)}
    ${/* The fix wave (w4-conversation-05, -15) — the strip names it, labelled; this line stays only where the strip has no customer rows. */ ''}${
      !d.catchUp && (prod || d.quantity !== null) ? `<div class="muted subline">${[
      prod ? `<bdi>${esc(prod)}</bdi>` : '',
      d.quantity !== null ? `<bdi>${esc(show.quantityOf(locale, d.quantity, pcs))}</bdi>` : '',
    ].filter(Boolean).join(' · ')}</div>` : ''}
    ${/* A — the buyer's own page (name, history, the deletion control) was reached from Customers; it is one door from here now.
         The fix wave (w4-whole-13, w4-conversation-16) — ONE door to "About this customer", in one place, by one name:
         on a phone the page; where the panel is folded away (1100–1440 px) the panel, which ends with the
         door to the full page; from 1440 px the panel stands beside, and neither door is drawn. The face
         opens the card. The stylesheet chooses; nothing waits on a script. */ ''}${
      deeper(`/app/conversations/${encodeURIComponent(d.conversationId)}`, t(locale, 'conv.file.title'), 'file-door')}${
      deeper('#customer', t(locale, 'panel.open'), 'panel-open')}
    ${/* R2 — "this is me testing": the owner's own messages to the shop count toward nothing on the ramp. */ ''}${
      viewer.isOwner ? `<form method="post" action="/app/inbox/${esc(encodeURIComponent(d.conversationId))}/testing" class="inline testing">
      ${d.ownerTesting ? `<span class="muted small">${esc(t(locale, 'conv.testing.on'))}</span>` : ''}
      <input type="hidden" name="testing" value="${d.ownerTesting ? 'off' : 'on'}" />
      ${/* Phase 9 (V1-219, V1-255) — an act, said as one, and asked first when it takes a conversation out of the count. */ ''}<button class="btn ghost quiet" type="submit"${d.ownerTesting ? ''
        : ` onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'conv.testing.confirm'))}"`}>${esc(t(locale, d.ownerTesting ? 'conv.testing.unmark' : 'conv.testing.mark'))}</button></form>` : ''}
    ${log}
    ${flashHtml}
    ${acts}`;
}
