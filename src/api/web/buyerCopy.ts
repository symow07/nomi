import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import type { Cell } from '../../core/owner/csv.js';
import { EXPORT_MAX_ROWS, plainMoney, type ExportSheet } from './dataExport.js';

/**
 * D7 (the data-protection audit, 2026-10-12) — A COPY OF WHAT IS KEPT ABOUT ONE
 * CUSTOMER.
 *
 * The privacy page tells a customer they can ask the business for a copy of
 * what is kept about them. The business had nine files of everyone, the
 * messages naming a customer by display name alone — often blank on Instagram
 * and Messenger. This is the copy for one person: ONE file, a row per fact,
 * read the way a person reads it top to bottom — who they are, then every
 * message, then what was prepared, priced, ordered, sampled and noted, then
 * the records of what they asked.
 *
 * THE SAME PERSON (D3, 0139): every customer row of theirs here, found the way
 * the erasure finds them, each with its own id in the `customer` column — the
 * copy and the deletion cover the same rows.
 *
 * Inside `withTenantTx`: row security answers "whose". Nothing this product
 * works out about them (the model's analysis of a message) is in it — that is
 * not something they said or the business wrote. Their profile photo is named,
 * not attached: a spreadsheet cannot hold it.
 */

export const BUYER_COPY_HEADER = ['section', 'when', 'channel', 'customer', 'what', 'value'] as const;

type Line = readonly [section: string, when: Date | null, channel: string | null, customer: string, what: string, value: Cell];

export type BuyerCopy = { readonly name: string | null; readonly sheet: ExportSheet };

export async function loadBuyerCopy(db: Db, businessIdRaw: string, conversationId: string): Promise<BuyerCopy | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok || !/^[0-9a-f-]{36}$/i.test(conversationId)) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const head = (await sql<{ client: string; name: string | null }>`
      select c.id::text as client, c.display_name as name from conversations v join clients c on c.id = v.client_id
       where v.id = ${conversationId}::uuid`.execute(tx)).rows[0];
    if (!head) return null;
    const others = (await sql<{ id: string }>`select x::text as id from customer_same_person(${head.client}::uuid) as x`.execute(tx)).rows.map((r) => r.id);
    const ids = [head.client, ...others];
    const lines: Line[] = [];
    const add = (...l: Line) => { lines.push(l); };

    // ── Who they are, on every row of theirs ────────────────────────────────
    const people = (await sql<{
      id: string; display_name: string | null; phone: string | null; email: string | null; country: string | null;
      preferred_language: string | null; notes: string | null; is_vip: boolean | null; created_at: Date; last_seen_at: Date | null;
    }>`select id::text as id, display_name, phone, email, country, preferred_language, notes, is_vip, created_at, last_seen_at
         from clients where id = any(${ids}::uuid[]) order by array_position(${ids}::uuid[], id)`.execute(tx)).rows;
    for (const p of people) {
      add('who they are', p.created_at, null, p.id, 'first seen', p.created_at);
      if (p.display_name) add('who they are', null, null, p.id, 'name', p.display_name);
      if (p.phone) add('who they are', null, null, p.id, 'phone', p.phone);
      if (p.email) add('who they are', null, null, p.id, 'e-mail', p.email);
      if (p.country) add('who they are', null, null, p.id, 'country', p.country);
      if (p.preferred_language) add('who they are', null, null, p.id, 'language', p.preferred_language);
      if (p.is_vip) add('who they are', null, null, p.id, 'marked as a regular', 'yes');
      if (p.notes) add('who they are', null, null, p.id, 'notes', p.notes);
      if (p.last_seen_at) add('who they are', p.last_seen_at, null, p.id, 'last seen', p.last_seen_at);
    }
    for (const a of (await sql<{ client: string; channel: string; account: string; created_at: Date }>`
      select client_id::text as client, channel, channel_user_id as account, created_at from client_channels
       where client_id = any(${ids}::uuid[]) order by created_at, id`.execute(tx)).rows) {
      add('who they are', a.created_at, a.channel, a.client, 'account', a.account);
    }
    for (const f of (await sql<{ client: string; kept_at: Date | null }>`
      select client_id::text as client, kept_at from client_faces where client_id = any(${ids}::uuid[]) and state = 'kept'`.execute(tx)).rows) {
      add('who they are', f.kept_at, null, f.client, 'profile photo', 'kept (a picture; not in this file)');
    }

    // ── Their conversations ─────────────────────────────────────────────────
    const convs = (await sql<{ id: string; client: string; channel: string }>`
      select id::text as id, client_id::text as client, channel from conversations
       where client_id = any(${ids}::uuid[]) order by created_at, id`.execute(tx)).rows;
    const convIds = convs.map((c) => c.id);
    const of = new Map(convs.map((c) => [c.id, c]));
    const on = (conv: string) => of.get(conv) ?? { client: head.client, channel: null };

    for (const m of (await sql<{
      conv: string; sent_at: Date | null; direction: string; input_type: string | null; text_content: string | null;
      transcription: string | null; subject: string | null;
    }>`select conversation_id::text as conv, sent_at, direction, input_type, text_content, transcription, subject
         from messages where conversation_id = any(${convIds}::uuid[]) and not is_duplicate
        order by sent_at nulls last, id limit ${EXPORT_MAX_ROWS}`.execute(tx)).rows) {
      const c = on(m.conv);
      const said = m.text_content ?? m.transcription ?? (m.input_type ? `(${m.input_type})` : null);
      const value = m.subject ? `${m.subject} — ${said ?? ''}` : said;
      add('messages', m.sent_at, c.channel, c.client, m.direction === 'inbound' ? 'from them' : 'to them', value);
    }
    for (const d of (await sql<{ conv: string; created_at: Date; status: string; draft_text: string | null; sent_text: string | null }>`
      select conversation_id::text as conv, created_at, status, draft_text, sent_text from drafts
       where conversation_id = any(${convIds}::uuid[]) and status <> 'sent' order by created_at, id`.execute(tx)).rows) {
      const c = on(d.conv);
      add('replies prepared, not sent', d.created_at, c.channel, c.client, d.status, d.draft_text);
    }
    for (const q of (await sql<{ conv: string; created_at: Date; quantity: number; unit_price_usd: string | null; total_usd: string | null; currency: string; product: string | null }>`
      select q.conversation_id::text as conv, q.created_at, q.quantity, q.unit_price_usd, q.total_usd, q.currency, p.name as product
        from quotes q left join products p on p.id = q.product_id
       where q.conversation_id = any(${convIds}::uuid[]) order by q.created_at, q.id`.execute(tx)).rows) {
      const c = on(q.conv);
      add('prices given', q.created_at, c.channel, c.client, q.product ?? 'price',
        `${q.quantity} × ${plainMoney(q.unit_price_usd) ?? '?'} = ${plainMoney(q.total_usd) ?? '?'} ${q.currency}`);
    }
    for (const o of (await sql<{
      id: string; client: string | null; conv: string | null; created_at: Date; order_reference: string; status: string; quantity: number;
      unit: string | null; total_value_usd: string | null; currency: string; client_email: string | null; shipping_address: string | null;
      notes: string | null; tracking_reference: string | null; product: string | null;
    }>`select o.id::text as id, o.client_id::text as client, o.conversation_id::text as conv, o.created_at, o.order_reference, o.status,
              o.quantity, o.unit, o.total_value_usd, o.currency, o.client_email, o.shipping_address, o.notes, o.tracking_reference, p.name as product
         from orders o left join products p on p.id = o.product_id
        where o.client_id = any(${ids}::uuid[]) or o.conversation_id = any(${convIds}::uuid[])
        order by o.created_at, o.id`.execute(tx)).rows) {
      const client = o.client ?? (o.conv ? on(o.conv).client : head.client);
      const channel = o.conv ? on(o.conv).channel : null;
      const bits = [
        `${o.quantity}${o.unit ? ` ${o.unit}` : ''}${o.product ? ` ${o.product}` : ''}`,
        o.total_value_usd !== null ? `${plainMoney(o.total_value_usd)} ${o.currency}` : null,
        o.status, o.client_email, o.shipping_address, o.notes, o.tracking_reference,
      ].filter((b): b is string => b !== null && b !== '');
      add('orders', o.created_at, channel, client, `order ${o.order_reference}`, bits.join('; '));
      for (const u of (await sql<{ at: Date; state: string; note: string | null; tracking_reference: string | null }>`
        select at, state, note, tracking_reference from order_updates where order_id = ${o.id}::uuid order by at, id`.execute(tx)).rows) {
        add('orders', u.at, channel, client, `order ${o.order_reference}: ${u.state}`, [u.note, u.tracking_reference].filter(Boolean).join('; ') || null);
      }
    }
    for (const s of (await sql<{ conv: string; requested_at: Date; asked_text: string | null; address: string | null; handled_at: Date | null }>`
      select conversation_id::text as conv, requested_at, asked_text, address, handled_at from sample_requests
       where conversation_id = any(${convIds}::uuid[]) order by requested_at, id`.execute(tx)).rows) {
      const c = on(s.conv);
      add('sample requests', s.requested_at, c.channel, c.client, s.handled_at ? 'sample request (handled)' : 'sample request',
        [s.asked_text, s.address].filter(Boolean).join('; ') || null);
    }
    for (const n of (await sql<{ conv: string; created_at: Date; note: string }>`
      select conversation_id::text as conv, created_at, note from conversation_notes
       where conversation_id = any(${convIds}::uuid[]) order by created_at, id`.execute(tx)).rows) {
      const c = on(n.conv);
      add('notes the business wrote', n.created_at, c.channel, c.client, 'note', n.note);
    }

    // ── What they asked for ─────────────────────────────────────────────────
    const accounts = (await sql<{ channel: string; account: string }>`
      select channel, channel_user_id as account from client_channels where client_id = any(${ids}::uuid[])
      union select 'whatsapp', phone from clients where id = any(${ids}::uuid[]) and phone is not null
      union select 'email', lower(email) from clients where id = any(${ids}::uuid[]) and email is not null`.execute(tx)).rows;
    const chs = accounts.map((a) => a.channel);
    const vals = accounts.map((a) => a.account);
    for (const o of (await sql<{ channel: string; asked_at: Date; lifted_at: Date | null }>`
      select o.channel, o.asked_at, o.lifted_at from opt_outs o
       where exists (select 1 from unnest(${chs}::text[], ${vals}::text[]) as i(ch, v) where i.ch = o.channel and (o.identity = i.v or lower(o.identity) = i.v))
       order by o.asked_at, o.id`.execute(tx)).rows) {
      add('what they asked', o.asked_at, o.channel, head.client, 'not to be messaged on this channel', o.lifted_at ? 'lifted later' : 'standing');
    }
    for (const s of (await sql<{ channel: string; at: Date; reason: string }>`
      select s.channel, s.at, s.reason from suppressions s
       where exists (select 1 from unnest(${chs}::text[], ${vals}::text[]) as i(ch, v) where i.ch = s.channel and (s.identity = i.v or lower(s.identity) = i.v))
       order by s.at, s.id`.execute(tx)).rows) {
      add('what they asked', s.at, s.channel, head.client, 'do not contact', s.reason);
    }
    for (const r of (await sql<{ client: string; asked_at: Date; state: string }>`
      select client_id::text as client, asked_at, state from deletion_requests
       where client_id = any(${ids}::uuid[]) and scope = 'buyer' order by asked_at, id`.execute(tx)).rows) {
      add('what they asked', r.asked_at, null, r.client, 'deletion request', r.state);
    }
    for (const a of (await sql<{ client: string; asked_at: Date; state: string }>`
      select client_id::text as client, asked_at, state from deletion_asks
       where client_id = any(${ids}::uuid[]) order by asked_at, id`.execute(tx)).rows) {
      add('what they asked', a.asked_at, null, a.client, 'asked in a message for their data to be deleted', a.state);
    }

    return { name: head.name, sheet: { header: [...BUYER_COPY_HEADER], rows: lines.map((l) => [...l]) } };
  });
}
