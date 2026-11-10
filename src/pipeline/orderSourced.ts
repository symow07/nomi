import { sql } from 'kysely';
import { withTenantTx, type Db } from '../db/client.js';
import type { BusinessId } from '../core/types/ids.js';
import { asciiDigits, extractNumerals, near } from '../core/safety/numerals.js';
import { type OrderContext } from '../core/commerce/shopifyOrders.js';
import { tokenAround, type KindedOrderFigure, type OrderFigure, type OrderFigureKind } from '../core/owner/reading.js';
import type { OrderLookup } from './orderLookup.js';

/**
 * BLOCK 5.5 — WHERE AN ORDER REPLY'S FIGURES CAME FROM, FOR THE OWNER'S CARD (t1r's ruling A, 2026-11-10).
 *
 * A reply built on a verified Shopify order is always a draft (`order_facts`), and the turn's numeral guard accepted
 * its dates because the order holds them. The card is drawn later, from the database, and nothing of the order is
 * kept (the storage ruling of 2026-11-09), so "How {name} read this" said "No source" for every one of them.
 *
 * After the turn COMMITS, in a transaction of its own, the worker writes ONE `order_sourced` event beside such a draft:
 *
 *   { draftId, order, figures }
 *
 * `order` is the order's name as the lookup row already keeps it; `figures` are the order's facts INTERSECTED with
 * the draft's own text — values the reply already writes, and nothing else: never the e-mail, a tracking number not
 * in the reply, a link, an id, or a date the reply does not state. Each figure says what it is in the order
 * (`{ value, kind, written? }`, `orderSourcedFigures`), so the card draws a code as the reply wrote it. It is provenance for figures already in the reply,
 * erased with the customer and the workspace like every conversation event.
 *
 * Written only when the lookup verified an order AND the turn's draft waits as `order_facts`. A failure to write it
 * changes nothing the turn did: the card then says "No source", as before.
 */

/** A code compared without its case and separators ("T55-4401" is "t554401"). */
const bare = (s: string): string => asciiDigits(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The figures the reply writes that the verified order holds, each with WHAT it is in the order (t1r's ruling,
 * 2026-11-10); in the reply's order, each once.
 *
 * - `identifier`: the token the figure sits in (letters, digits and separators, as the reply wrote it) IS the order's
 *   name or a tracking number, whole or one of its separated parts. The token is kept, so the card shows it as written
 *   on one line. A figure that merely shares digits with a code ("1" beside "1Z999AA10123456784") is not the order's.
 * - `date`: a year, month or day of one of the order's dates.
 *
 * The order holds no amount or quantity today; the record's kinds name them for the reader all the same.
 */
export function orderSourcedFigures(order: OrderContext, replyText: string): KindedOrderFigure[] {
  const codes = [order.name, ...order.shipments.flatMap((s) => (s.tracking ?? []).map((t) => t.number))]
    .flatMap((c) => [bare(c), ...asciiDigits(c).split(/[^A-Za-z0-9]+/).map(bare)])
    .filter((c) => /\d/.test(c));
  const dateParts: number[] = [];
  for (const d of [order.placed_on, order.cancelled_on, ...order.shipments.flatMap((s) => [s.delivered_on, s.expected_on])]) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? '');
    if (m) dateParts.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  const text = asciiDigits(replyText);
  const out: KindedOrderFigure[] = [];
  // One entry per code (its first figure stands for it) and per date figure.
  const add = (f: KindedOrderFigure) => {
    if (!out.some((o) => o.kind === f.kind && (f.kind === 'identifier' ? o.written === f.written : near(o.value, f.value)))) out.push(f);
  };
  for (const n of extractNumerals(replyText)) {
    if (!Number.isFinite(n.value)) continue;
    if (n.at) {
      const [from, to] = tokenAround(text, n.at);
      if (codes.includes(bare(text.slice(from, to)))) { add({ value: n.value, kind: 'identifier', written: replyText.slice(from, to) }); continue; }
    }
    if (dateParts.some((p) => near(p, n.value))) add({ value: n.value, kind: 'date' });
  }
  return out;
}

/**
 * The record as the card reads it back: anything malformed is no record. A record written before the kinds holds
 * bare numbers; they are kept as numbers and read as they were then.
 */
export type OrderSourced = { readonly order: string; readonly figures: readonly OrderFigure[] };
const KINDS: readonly OrderFigureKind[] = ['amount', 'quantity', 'date', 'identifier'];
function figureOf(f: unknown): OrderFigure | null {
  if (typeof f === 'number') return Number.isFinite(f) ? f : null;
  if (typeof f !== 'object' || f === null) return null;
  const { value, kind, written } = f as { value?: unknown; kind?: unknown; written?: unknown };
  if (typeof value !== 'number' || !Number.isFinite(value) || !KINDS.includes(kind as OrderFigureKind)) return null;
  if (kind === 'identifier') {
    return typeof written === 'string' && written !== '' && written.length <= 64 ? { value, kind, written } : null;
  }
  return written === undefined ? { value, kind: kind as OrderFigureKind } : null;
}
export function orderSourcedOf(v: unknown): OrderSourced | null {
  if (typeof v !== 'object' || v === null) return null;
  const { order, figures } = v as { order?: unknown; figures?: unknown };
  if (typeof order !== 'string' || order.trim() === '' || order.length > 64 || !Array.isArray(figures) || figures.length > 40) return null;
  const read = figures.map(figureOf);
  return read.every((f) => f !== null) ? { order, figures: read as OrderFigure[] } : null;
}

/**
 * A lookup port that remembers the order it verified for this one turn, so the worker can write the record after the
 * turn commits. Nothing leaves this object but through `recordOrderSourced`, and it lives as long as the turn's job.
 */
export function rememberingOrderLookup(inner: OrderLookup): { readonly port: OrderLookup; readonly verified: () => OrderContext | null } {
  let verified: OrderContext | null = null;
  return {
    port: {
      async look(input) {
        const r = await inner.look(input);
        verified = r.kind === 'verified' ? r.order : null;
        return r;
      },
    },
    verified: () => verified,
  };
}

/**
 * Writes the record for `draftId` when that draft is still pending and its `draft_pending` says `order_facts`.
 * Its own transaction. Returns whether a record was written; throws only what the database threw.
 */
export async function recordOrderSourced(db: Db, businessId: BusinessId, input: {
  readonly conversationId: string; readonly draftId: string; readonly order: OrderContext;
}): Promise<boolean> {
  return withTenantTx(db, businessId, async (tx) => {
    const row = (await sql<{ text: string; reason: string | null }>`
      select d.draft_text as text,
             (select e.payload->'withheld'->>'reason' from conversation_events e
               where e.conversation_id = d.conversation_id and e.type = 'draft_pending' and e.payload->>'draftId' = d.id::text
               order by e.id desc limit 1) as reason
        from drafts d
       where d.id = ${input.draftId}::uuid and d.conversation_id = ${input.conversationId}::uuid and d.status = 'pending'
    `.execute(tx)).rows[0];
    if (!row || row.reason !== 'order_facts') return false;
    await sql`insert into conversation_events (business_id, conversation_id, type, payload)
      values (${businessId}::uuid, ${input.conversationId}::uuid, 'order_sourced',
              ${JSON.stringify({ draftId: input.draftId, order: input.order.name, figures: orderSourcedFigures(input.order, row.text) })}::jsonb)`.execute(tx);
    return true;
  });
}
