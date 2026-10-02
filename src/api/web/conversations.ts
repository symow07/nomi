import { sql } from 'kysely';
import { type Money, moneyFromRow } from '../../core/types/money.js';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { orderStatusName, capabilityName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';
import { formatList } from '../../core/owner/i18n/format.js';
import { buyerWho, channelName, productName, perPiece } from './inbox.js';
import { esc, deeper, back, conversationUrl, signalMark, type Signal } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import { buyerDeletionOf, BUYER_NOTE_MAX, type BuyerDeletionState } from './dataRights.js';
import { waitingAskOf, type WaitingAsk } from '../../db/deletionAsks.js';
import { deletionDueBy } from '../../core/ops/deletions.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';
import { ownSku } from '../../core/owner/sku.js';
import * as show from './values.js';

/**
 * M9.7 + ADR-0008 — the buyer's own page (`/app/conversations/:id`): what the
 * business knows about one buyer. NOT a chat viewer and NOT a second inbox. A
 * read model over existing activity; the read model is language-NEUTRAL
 * (status/phase codes, milestone kinds, capability codes, raw names); the
 * renderer localizes. Actions live on the conversation page.
 *
 * A (2026-09-28) — the LIST that lived here, Customers, is Buyers now: one
 * list, searched and paged (`inbox.ts`, `src/db/buyersList.ts`), and
 * `/app/conversations` answers with a redirect to it. The buyer's page stays
 * where it was — addresses of pages do not move — and is one door from the
 * conversation page.
 */

type Tone = 'ok' | 'warn' | 'muted';
type RelStatus =
  | { readonly t: 'awaiting' } | { readonly t: 'order'; readonly s: string } | { readonly t: 'closed' }
  | { readonly t: 'quoted' } | { readonly t: 'phase'; readonly s: string } | { readonly t: 'talking' };

/**
 * The first `n` characters — counted as characters, so an emoji is never cut
 * in half — and, Phase 9 (V1-274), cut where a word ends: "…the LED string li…"
 * stopped mid-word with half the row empty.
 */
const truncate = (s: string, n: number): string => {
  const chars = Array.from(s);
  if (chars.length <= n) return s;
  const head = chars.slice(0, n).join('');
  const space = head.lastIndexOf(' ');
  return `${(space > n * 0.6 ? head.slice(0, space) : head).trimEnd()}…`;
};
/** How much of a message a history line shows. */
const HISTORY_CHARS = 140;
/** D3 — the channel's name, read in one place (`inbox.ts`); named here too, where it was first. */
export { channelName };

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
  /** Phase 9 (V1-272) — their number or e-mail on this channel, where it is one a person reads. Optional for fixtures. */
  readonly address?: string | null;
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
  /**
   * CC-02a — this buyer's latest deletion request, if any. Optional so a
   * fixture without one reads as a buyer who never asked.
   */
  readonly deletion?: BuyerDeletionState | null;
  /**
   * 0076 — a request noted from this buyer's message, waiting for the owner.
   * Optional so a fixture without one reads as nothing waiting.
   */
  readonly deletionAsk?: WaitingAsk | null;
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
      pending: number; quote_count: number; order_count: number; order_status: string | null; address: string | null;
    }>`
      select c.id, cl.display_name as buyer, cl.country, c.channel, c.phase,
             (select cc.channel_user_id from client_channels cc
               where cc.client_id = c.client_id and cc.channel = c.channel
                 and cc.channel in ('whatsapp', 'email') limit 1) as address,
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

    const deletion = await buyerDeletionOf(tx, conversationId);
    const deletionAsk = await waitingAskOf(tx, conversationId);

    // Relationship timeline — neutral milestone kinds; renderer localizes.
    const timeline: Milestone[] = [];

    // CC-25 — the NEWEST sixty. This read the oldest sixty, so past sixty
    // messages "recent" was months-old words beside this week's quotes, and
    // the newest words were missing. Put back in time order before the
    // (stable) sort below, so two lines in one millisecond keep theirs. The
    // whole transcript, paged, is the conversation page, one door away below.
    (await sql<{ direction: string; input_type: string; text_content: string | null; sent_at: Date | null }>`
      select direction, input_type, text_content, sent_at from messages
       where conversation_id = ${conversationId} order by sent_at desc, id desc limit 60`.execute(tx)).rows.reverse().forEach((m) => {
      if (m.direction === 'inbound') {
        const isImg = m.input_type === 'image' || m.input_type === 'image_text';
        timeline.push(isImg ? mile('buyer_image', m.sent_at) : mile('buyer_text', m.sent_at, { text: truncate(m.text_content ?? '', HISTORY_CHARS) }));
      } else if (m.text_content) {
        timeline.push(mile('reply', m.sent_at, { text: truncate(m.text_content, HISTORY_CHARS) }));
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
      conversationId: head.id, buyer: head.buyer, country: head.country, channel: head.channel, address: head.address,
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
      deletion,
      deletionAsk,
    };
  });
}

/** ── Renderers (pure, mobile-first, localized, escaped) ───────────────────── */

/**
 * Phase 4 — the timeline's marks are the product's own, not pictures in their
 * own colours: ✦ the assistant did it, ● you did, ✓ it is done (an order),
 * ○ it waits for you (a hand-off), and a plain • for what the customer did.
 * The words of each line say it; the mark only lets the eye run down them.
 */
const TL_MARK: Record<MilestoneKind, Signal | 'you' | 'them'> = {
  buyer_text: 'them', buyer_image: 'them', reply: 'assistant', quote: 'assistant', order: 'ok',
  owner_approved: 'you', owner_edited: 'you', owner_skipped: 'you', lead_hot: 'them', handoff: 'waiting',
};
const tlMark = (k: MilestoneKind): string => {
  const m = TL_MARK[k];
  return m === 'you' ? '<span aria-hidden="true">●</span>' : m === 'them' ? '<span aria-hidden="true">•</span>' : signalMark(m);
};
const TL_CLASS: Record<MilestoneKind, string> = {
  buyer_text: 'buyer', buyer_image: 'buyer', reply: 'reply', quote: 'quote', order: 'order',
  owner_approved: 'owner', owner_edited: 'owner', owner_skipped: 'owner', lead_hot: 'event', handoff: 'event',
};

const statusPill = (label: string, tone: Tone): string =>
  `<span class="pill ${tone}">${esc(label)}</span>`;

/**
 * One history line, as markup: the sentence in the page's language, and what
 * it quotes — the buyer's words, a reply, the figures — isolated, so an
 * English sentence or a price inside an Arabic line keeps its own order (the
 * sentence and the words ran together, and an ellipsis landed at the wrong end).
 */
function milestoneHtml(locale: Locale, m: Milestone, buyer: string | null): string {
  const name = assistantName(locale);
  const pcs = t(locale, 'product.unit.pcs');
  const iso = (x: string): string => `<bdi>${esc(x)}</bdi>`;
  const fig = (x: string): string => `<bdi class="fig">${esc(x)}</bdi>`;
  // Phase 9 (V1-276) — what someone said, on its own line in its own direction:
  // an English message in an Arabic sentence ran "…5,000 :Aisha Bello".
  const words = (x: string): string => `<bdi class="said" dir="auto">${esc(x)}</bdi>`;
  /** The sentence escaped, with the quoted part put in — isolated — where its blank was. */
  const said = (key: MessageKey, params: Record<string, string>, blank: string, part: string): string =>
    esc(t(locale, key, { ...params, [blank]: '\u0000' })).replace('\u0000', part);
  switch (m.kind) {
    // The design pass (UI-PASS 5): the customer by name, never the lone role word.
    case 'buyer_text': return esc(t(locale, 'conv.tl.buyer_text', { who: '\u0001', text: '\u0000' }))
      .replace('\u0001', iso(buyer ?? t(locale, 'common.buyer'))).replace('\u0000', words(m.text ?? ''));
    case 'buyer_image': return esc(t(locale, 'conv.tl.buyer_image'));
    case 'reply': return said('conv.tl.reply', { name }, 'text', words(m.text ?? ''));
    // Phase 9 (V1-278) — per piece, as the reply says it.
    case 'quote': return said('conv.tl.quote', { name }, 'detail',
      [fig(show.quantityOf(locale, m.qty ?? 0, pcs)), fig(m.unitPrice ? perPiece(locale, m.unitPrice) : '—')].join(' · '));
    case 'order': return said('conv.tl.order', { status: orderStatusName(locale, m.orderStatus ?? '') }, 'qty',
      iso(show.quantityOf(locale, m.qty ?? 0, pcs)));
    default: return esc(t(locale, `conv.tl.${m.kind}` as MessageKey));
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

/**
 * CC-02a — the buyer asked to be deleted: where the owner records it, and
 * where anyone looking after this buyer sees that it was asked, by when it is
 * carried out, and when it was done.
 *
 * The control is the OWNER's (`data_rights`): a sales assistant sees the state
 * and whose decision it is, never a form that would only refuse them. It sits
 * behind a disclosure, last on the page, and says what goes and what stays
 * before it asks for anything — the same words the public page gives the buyer.
 * The note is required: it is the record of the asking, and the buyer's own
 * message may be among what is deleted.
 *
 * 0076 — UNLESS IT WAS NOTED FROM THEIR MESSAGE. Then the section says when
 * they asked and what they wrote, and asks the owner only for the decision:
 * record it (no note — the message is the record of how and when), or mark it
 * as not a deletion request. It is never offered as something to create.
 */
function deletionSection(f: CustomerFile, locale: Locale, viewer: Viewer): string {
  const d = f.deletion ?? null;
  const date = (x: Date) => show.date(locale, x);
  const state = (tone: string, key: MessageKey) =>
    `<span class="pill ${tone}">${esc(t(locale, key))}</span>`;
  const head = `<h2>${esc(t(locale, 'conv.deletion.title'))}</h2>`;
  const here = `/app/conversations/${encodeURIComponent(f.conversationId)}`;

  const ask = f.deletionAsk ?? null;
  if (ask && d?.state !== 'open') {
    const decide = viewer.isOwner
      ? `<p class="muted">${esc(t(locale, 'conv.deletion.erased'))}</p>
        <p class="muted">${esc(t(locale, 'conv.deletion.kept'))}</p>
        <p class="muted">${esc(t(locale, 'conv.deletion.tell'))}</p>
        ${deeper('/app/settings/data', t(locale, 'data.title'))}
        <form method="post" action="${here}/deletion" class="pform">
          <button class="btn danger" type="submit">${esc(t(locale, 'conv.deletion.record'))}</button>
        </form>
        <form method="post" action="${here}/deletion/dismiss" class="pform">
          <p class="muted">${esc(t(locale, 'conv.deletion.dismissHint'))}</p>
          <button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)"
            data-confirm="${esc(t(locale, 'conv.deletion.dismissConfirm'))}">${esc(t(locale, 'conv.deletion.dismiss'))}</button>
        </form>`
      : `<p class="muted">${esc(t(locale, 'staff.ownerDecides'))}</p>`;
    return `<div class="block" id="deletion">${head}
      <p>${state('warn', 'data.ask.state.waiting')}${esc(t(locale, 'conv.deletion.waiting', { date: date(ask.askedAt) }))}</p>
      ${ask.words ? `<p class="voice"><bdi dir="auto">${esc(ask.words)}</bdi></p>` : ''}
      ${decide}
    </div>`;
  }

  if (d?.state === 'open') {
    return `<div class="block" id="deletion">${head}
      <p>${state('warn', 'data.deletion.state.open')}${esc(t(locale, 'conv.deletion.open', {
        asked: date(d.askedAt), due: date(deletionDueBy(d.askedAt)) }))}</p>
      ${viewer.isOwner
        ? `<p class="muted">${esc(t(locale, 'conv.deletion.takeBack'))}</p>${deeper('/app/settings/data', t(locale, 'data.title'))}`
        : ''}
    </div>`;
  }
  if (d?.state === 'done') {
    return `<div class="block" id="deletion">${head}
      <p>${state('ok', 'data.deletion.state.done')}${esc(t(locale, 'conv.deletion.done', {
        date: date(d.closedAt ?? d.askedAt) }))}</p>
    </div>`;
  }
  // Never asked, taken back, or not carried out: it may be asked (again).
  const refused = d?.state === 'refused'
    ? `<p>${state('bad', 'data.deletion.state.refused')}${esc(t(locale, 'conv.deletion.refused', { date: date(d.askedAt) }))}</p>
       ${d.closedNote ? `<p class="muted"><bdi>${esc(d.closedNote)}</bdi></p>` : ''}`
    : '';
  const control = viewer.isOwner
    ? `<details>
        <summary>${esc(t(locale, 'conv.deletion.ask'))}</summary>
        <p class="muted">${esc(t(locale, 'conv.deletion.erased'))}</p>
        <p class="muted">${esc(t(locale, 'conv.deletion.kept'))}</p>
        <p class="muted">${esc(t(locale, 'conv.deletion.tell'))}</p>
        ${/* Phase 9 (conversation-missed-09) — the page the sentence names, one door away. */ ''}${deeper('/app/settings/data', t(locale, 'data.title'))}
        <form method="post" action="/app/conversations/${encodeURIComponent(f.conversationId)}/deletion" class="pform">
          <div class="fld"><label for="deletion-note">${esc(t(locale, 'conv.deletion.note'))}</label>
            <textarea id="deletion-note" name="note" rows="2" required maxlength="${BUYER_NOTE_MAX}"></textarea>
            <span class="muted">${esc(t(locale, 'conv.deletion.noteHint'))}</span></div>
          <button class="btn danger" type="submit">${esc(t(locale, 'conv.deletion.submit'))}</button>
        </form>
      </details>`
    : `<p class="muted">${esc(t(locale, 'staff.ownerDecides'))}</p>`;
  return `<div class="block" id="deletion">${head}
    ${refused}
    <p class="muted">${esc(t(locale, 'conv.deletion.lead'))}</p>
    ${control}
  </div>`;
}

/** Phase 9 (V1-284) — the tab says which of the customer's two pages this is: it read "Aisha Bello", as the conversation's did. */
export const customerFileTitle = (locale: Locale, f: Pick<CustomerFile, 'buyer'>): string =>
  `${f.buyer ?? t(locale, 'common.buyer')} · ${t(locale, 'conv.file.title')}`;

export function renderCustomerFile(
  f: CustomerFile, locale: Locale, now: Date, flash: Flash | null = null, viewer: Viewer = OWNER_VIEW,
): string {
  const p = f.profile;
  const pcs = t(locale, 'product.unit.pcs');
  // CC-13 — each locale's own list, not the Chinese enumeration comma in every language.
  const productsLabel = formatList(locale, p.products.map((pr) => productName(locale, pr)).filter((x): x is string => Boolean(x)));
  const profileRows = [
    p.firstContact ? `<div class="prow"><span class="muted">${esc(t(locale, 'conv.file.firstContact'))}</span><b>${esc(show.day(locale, p.firstContact, now))}</b></div>` : '',
    productsLabel ? `<div class="prow"><span class="muted">${esc(t(locale, 'conv.file.products'))}</span><b><bdi>${esc(productsLabel)}</bdi></b></div>` : '',
    p.quoteCount > 0 ? `<div class="prow"><span class="muted">${esc(t(locale, 'conv.file.quoteCount'))}</span><b>${esc(show.count(locale, p.quoteCount))}</b></div>` : '',
    p.orderCount > 0 ? `<div class="prow"><span class="muted">${esc(t(locale, 'conv.file.orderCount'))}</span><b>${esc(show.count(locale, p.orderCount))}</b></div>` : '',
  ].filter(Boolean).join('');
  const nameForm = `<form method="post" action="/app/conversations/${encodeURIComponent(f.conversationId)}/name" class="name-form">
      <label for="buyer-name">${esc(t(locale, 'conv.file.name'))}</label>
      <div class="name-row">
        <input id="buyer-name" name="name" maxlength="80" value="${esc(f.buyer ?? '')}" placeholder="${esc(t(locale, 'common.buyer'))}">
        <button class="btn" type="submit">${esc(t(locale, 'conv.file.nameSave'))}</button>
      </div>
      <div class="muted hint">${esc(t(locale, 'conv.file.nameHint', { buyer: '\u0000' })).replace('\u0000', `<bdi class="fig">${esc(t(locale, 'common.buyer'))}</bdi>`)}</div>
    </form>`;
  const profile = `<div class="block"><h2>${esc(t(locale, 'conv.file.title'))}</h2>
    ${nameForm}
    ${profileRows || `<div class="empty muted">${esc(t(locale, 'conv.file.noMore'))}</div>`}</div>`;

  const timeline = `<div class="block"><h2>${esc(t(locale, 'conv.tl.title'))}</h2>
    ${f.timeline.length
      ? `<ul class="tl">${f.timeline.map((m) => `<li class="tl-${TL_CLASS[m.kind]}"><span class="ic">${tlMark(m.kind)}</span>
          <div><div class="tx">${milestoneHtml(locale, m, f.buyer)}</div>${m.at ? `<div class="muted ts">${esc(show.when(locale, m.at, now))}</div>` : ''}</div></li>`).join('')}</ul>
        ${/* CC-25 — this is the recent part; every word, paged, is the conversation. */ ''}${deeper(conversationUrl(f.conversationId), t(locale, 'conv.tl.whole'))}`
      : `<div class="empty muted">${esc(t(locale, 'conv.tl.empty'))}</div>`}</div>`;

  const ctx = f.context;
  const ctxParts = [
    ctx.products.length ? `<div class="cx"><div class="cx-l">${esc(t(locale, 'conv.ctx.products'))}</div><div>${ctx.products.map((pr) =>
      // CC-31 — her own article number only; one the import made up is not hers to read.
      `<bdi>${esc(productName(locale, pr) ?? t(locale, 'conv.unnamed'))}</bdi>${ownSku(pr.sku) ? `<span class="muted"> · <bdi>${esc(ownSku(pr.sku)!)}</bdi></span>` : ''}`).join('<br>')}</div></div>` : '',
    // Each figure isolated, so Arabic keeps quantity, price and total apart and in order.
    ctx.latestQuote ? `<div class="cx"><div class="cx-l">${esc(t(locale, 'conv.ctx.quote'))}</div><div>${[
      show.quantityOf(locale, ctx.latestQuote.qty, pcs),
      perPiece(locale, ctx.latestQuote.unitPrice),
      `${t(locale, 'product.detail.total')} ${show.money(locale, ctx.latestQuote.total)}`,
    ].map((x) => `<bdi class="fig">${esc(x)}</bdi>`).join(' · ')}</div></div>` : '',
    ctx.order ? `<div class="cx"><div class="cx-l">${esc(t(locale, 'conv.ctx.order'))}</div><div>${
      // G4 — the reference opens the order, so what she tells a buyer who asks
      // after it is one tap away.
      ctx.order.id ? `<a href="/app/orders/${encodeURIComponent(ctx.order.id)}">${esc(show.orderNumber(locale, ctx.order.reference))}</a>` : esc(show.orderNumber(locale, ctx.order.reference))
    } · ${esc(orderStatusName(locale, ctx.order.status))}${ctx.order.total !== null ? ` · ${esc(show.money(locale, ctx.order.total))}` : ''}</div></div>` : '',
    ctx.corrections.length ? `<div class="cx"><div class="cx-l">${esc(t(locale, 'conv.ctx.corrections'))}</div><div>${esc(formatList(locale, ctx.corrections.map((c) => capabilityName(locale, c))))}</div></div>` : '',
  ].filter(Boolean).join('');
  const context = ctxParts ? `<div class="block"><h2>${esc(t(locale, 'conv.ctx.title'))}</h2>${ctxParts}</div>` : '';

  // Decision 4 — it goes somewhere, so it is a door, not a button.
  const actLink = f.needsOwner
    ? `<div class="card need-card"><span>${esc(t(locale, 'conv.needCard'))}</span>
        ${deeper(conversationUrl(f.conversationId), t(locale, 'conv.needCardCta'), 'next')}</div>`
    : '';

  // A — back to Buyers, where every buyer is listed now (Customers was the same list).
  return `
    <div class="dhead">
      ${back('/app/inbox', t(locale, 'inbox.detail.back'))}
      ${/* CC-20 — the buyer is what this page is about: its one heading. */ ''}<h1 class="who">${buyerWho(locale, f.buyer, f.country)}</h1>
      ${statusPill(relLabel(locale, f.status), f.statusTone)}
    </div>
    <div class="muted subline">${esc(channelName(locale, f.channel))}${f.address
      ? ` <bdi dir="ltr">${esc(f.channel === 'whatsapp' && /^\d+$/.test(f.address) ? `+${f.address}` : f.address)}</bdi>` : ''}</div>
    ${flashBanner(flash)}
    ${actLink}
    ${profile}
    ${timeline}
    ${context}
    ${deletionSection(f, locale, viewer)}`;
}
