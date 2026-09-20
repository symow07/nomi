import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import type { Cell } from '../../core/owner/csv.js';

/**
 * CC-12 — an owner can take their own data out.
 *
 * WHAT WAS WRONG. There was no export at all: no route, no CSV writer, no
 * `Content-Disposition` anywhere in `src/`. An owner who wanted to leave, or
 * to answer their own customer's question, or simply to hold a copy of what
 * they had typed in, had one option — ask us, and wait for somebody with
 * database access. A product that asks a business to put its buyers, its
 * prices and its orders in must be able to give them back.
 *
 * ONE FILE PER SUBJECT, not one archive. A zip needs a library this product
 * would otherwise never carry, and a single sheet of everything is not a thing
 * anybody can read: a buyer is not a product is not an order. Six links, six
 * files, each opening in the spreadsheet she already has.
 *
 * EVERY QUERY RUNS INSIDE `withTenantTx`, so row-level security answers the
 * "whose data" question rather than a `where` clause somebody can forget. The
 * definer functions used elsewhere for cross-tenant reads are deliberately NOT
 * used here: this is one business asking for its own, which is exactly the case
 * RLS exists for.
 *
 * NOTHING SECRET IS IN ANY OF THEM. No password hash, no access code, no API
 * key, no OAuth token, no signing secret — not because a row-level rule stops
 * them, but because no query here names those columns. A test walks the column
 * lists and holds that.
 */

/** The six things an owner would mean by "my data". */
export const EXPORT_SUBJECTS = ['buyers', 'messages', 'products', 'orders', 'quotes', 'contacts'] as const;
export type ExportSubject = (typeof EXPORT_SUBJECTS)[number];

export const isExportSubject = (v: string): v is ExportSubject =>
  (EXPORT_SUBJECTS as readonly string[]).includes(v);

export type ExportSheet = { readonly header: readonly string[]; readonly rows: readonly (readonly Cell[])[] };

/**
 * A ceiling, per subject. A workspace with two years of messages would
 * otherwise build a fifty-megabyte string in memory and hold the connection
 * while it did it. The page says the ceiling out loud, and says to ask if the
 * export is short — a truncated file that claims to be everything would be a
 * worse lie than no export at all.
 */
export const EXPORT_MAX_ROWS = 20000;

type Loader = (tx: Tx, businessId: string) => Promise<ExportSheet>;

/**
 * A buyer, and how to reach them. `client_channels` carries one row per
 * channel, so they are folded into one cell rather than multiplying the buyer.
 */
const buyers: Loader = async (tx, businessId) => {
  const r = await sql<{
    display_name: string | null; email: string | null; phone: string | null; country: string | null;
    preferred_language: string | null; total_orders: number | null; is_vip: boolean | null;
    notes: string | null; created_at: Date; last_seen_at: Date | null; reach: string | null;
  }>`
    select c.display_name, c.email, c.phone, c.country, c.preferred_language,
           c.total_orders, c.is_vip, c.notes, c.created_at, c.last_seen_at,
           (select string_agg(cc.channel || ': ' || cc.channel_user_id, ' | ' order by cc.channel)
              from client_channels cc where cc.client_id = c.id) as reach
      from clients c
     where c.business_id = ${businessId}
     order by c.created_at
     limit ${EXPORT_MAX_ROWS}`.execute(tx);
  return {
    header: ['name', 'email', 'phone', 'country', 'language', 'orders', 'vip', 'notes', 'first seen', 'last seen', 'reachable at'],
    rows: r.rows.map((x) => [
      x.display_name, x.email, x.phone, x.country, x.preferred_language,
      x.total_orders, x.is_vip, x.notes, x.created_at, x.last_seen_at, x.reach,
    ]),
  };
};

/**
 * The transcript. `messages` has no `business_id` of its own — it hangs off
 * the conversation — so the join is what scopes it, and RLS on `conversations`
 * is what makes the join safe.
 *
 * `ai_analysis` is left out on purpose: it is this product's working notes
 * about a buyer (intent, sentiment, a guessed language), not something the
 * buyer said or the owner wrote, and handing it over as "your data" would
 * invite it to be read as fact about a person.
 */
const messages: Loader = async (tx, businessId) => {
  const r = await sql<{
    sent_at: Date | null; channel: string; who: string; buyer: string | null;
    direction: string; input_type: string | null; text_content: string | null;
    transcription: string | null; detected_language: string | null; subject: string | null;
  }>`
    select m.sent_at, cv.channel, coalesce(cl.display_name, '') as who, cl.display_name as buyer,
           m.direction, m.input_type, m.text_content, m.transcription, m.detected_language, m.subject
      from messages m
      join conversations cv on cv.id = m.conversation_id
      left join clients cl on cl.id = cv.client_id
     where cv.business_id = ${businessId} and not m.is_duplicate
     order by m.sent_at nulls last
     limit ${EXPORT_MAX_ROWS}`.execute(tx);
  return {
    header: ['when', 'channel', 'buyer', 'direction', 'kind', 'subject', 'what was said', 'heard as', 'language'],
    rows: r.rows.map((x) => [
      x.sent_at, x.channel, x.buyer, x.direction, x.input_type, x.subject,
      x.text_content, x.transcription, x.detected_language,
    ]),
  };
};

/** Her catalogue, with its first price tier — the number a buyer is quoted. */
const products: Loader = async (tx, businessId) => {
  const r = await sql<{
    sku: string; name: string; name_zh: string | null; description: string | null; category: string | null;
    unit: string; moq: number; currency: string; price: string | null; lead_time_days: number | null;
    customizable: boolean; is_active: boolean; tiers: string | null; created_at: Date;
  }>`
    select p.sku, p.name, p.name_zh, p.description, p.category, p.unit, p.moq, p.currency,
           p.price_usd_per_unit as price, p.lead_time_days, p.customizable, p.is_active, p.created_at,
           (select string_agg(t.min_qty || '+: ' || t.unit_price_usd || ' ' || t.currency, ' | ' order by t.min_qty)
              from price_tiers t where t.product_id = p.id) as tiers
      from products p
     where p.business_id = ${businessId}
     order by p.created_at
     limit ${EXPORT_MAX_ROWS}`.execute(tx);
  return {
    header: ['sku', 'name', 'name (zh)', 'description', 'category', 'unit', 'moq', 'currency',
      'price', 'price breaks', 'lead time (days)', 'customizable', 'offered', 'added'],
    rows: r.rows.map((x) => [
      x.sku, x.name, x.name_zh, x.description, x.category, x.unit, x.moq, x.currency,
      x.price, x.tiers, x.lead_time_days, x.customizable, x.is_active, x.created_at,
    ]),
  };
};

/** Orders, with the buyer named rather than keyed, and the latest state. */
const orders: Loader = async (tx, businessId) => {
  const r = await sql<{
    order_reference: string; created_at: Date; confirmed_at: Date | null; buyer: string | null;
    product: string | null; quantity: number; unit: string | null; currency: string;
    agreed_unit_price_usd: string | null; total_value_usd: string | null; status: string;
    payment_terms: string | null; incoterm: string | null; tracking_reference: string | null;
    shipping_address: string | null; notes: string | null; latest_state: string | null;
  }>`
    select o.order_reference, o.created_at, o.confirmed_at,
           cl.display_name as buyer, p.name as product,
           o.quantity, o.unit, o.currency, o.agreed_unit_price_usd, o.total_value_usd, o.status,
           o.payment_terms, o.incoterm, o.tracking_reference, o.shipping_address, o.notes,
           (select u.state from order_updates u where u.order_id = o.id
             order by u.at desc limit 1) as latest_state
      from orders o
      left join clients cl on cl.id = o.client_id
      left join products p on p.id = o.product_id
     where o.business_id = ${businessId}
     order by o.created_at
     limit ${EXPORT_MAX_ROWS}`.execute(tx);
  return {
    header: ['reference', 'placed', 'confirmed', 'buyer', 'product', 'quantity', 'unit', 'currency',
      'unit price', 'total', 'status', 'where it is', 'payment terms', 'delivery term',
      'tracking', 'ship to', 'notes'],
    rows: r.rows.map((x) => [
      x.order_reference, x.created_at, x.confirmed_at, x.buyer, x.product, x.quantity, x.unit,
      x.currency, x.agreed_unit_price_usd, x.total_value_usd, x.status, x.latest_state,
      x.payment_terms, x.incoterm, x.tracking_reference, x.shipping_address, x.notes,
    ]),
  };
};

/** Every price she has quoted, and whether it waited for her. */
const quotes: Loader = async (tx, businessId) => {
  const r = await sql<{
    created_at: Date; buyer: string | null; product: string | null; quantity: number;
    currency: string; unit_price_usd: string; discount_pct: string | null; total_usd: string;
    requires_human: boolean; lead_time_days: number | null; lead_time_withheld: string | null;
  }>`
    select q.created_at, cl.display_name as buyer, p.name as product, q.quantity, q.currency,
           q.unit_price_usd, q.discount_pct, q.total_usd, q.requires_human,
           q.lead_time_days, q.lead_time_withheld
      from quotes q
      left join conversations cv on cv.id = q.conversation_id
      left join clients cl on cl.id = cv.client_id
      left join products p on p.id = q.product_id
     where q.business_id = ${businessId}
     order by q.created_at
     limit ${EXPORT_MAX_ROWS}`.execute(tx);
  return {
    header: ['when', 'buyer', 'product', 'quantity', 'currency', 'unit price', 'discount %',
      'total', 'waited for you', 'lead time (days)', 'date withheld by'],
    rows: r.rows.map((x) => [
      x.created_at, x.buyer, x.product, x.quantity, x.currency, x.unit_price_usd,
      x.discount_pct, x.total_usd, x.requires_human, x.lead_time_days, x.lead_time_withheld,
    ]),
  };
};

/**
 * The outreach list, with what is on file saying she may write to them. That
 * last part is the half that matters: a contact exported without its consent
 * evidence is a mailing list, and this product refuses to be one.
 */
const contacts: Loader = async (tx, businessId) => {
  const r = await sql<{
    channel: string; identity: string; display_name: string | null; company: string | null;
    title: string | null; source: string | null; source_detail: string | null;
    created_at: Date; created_by: string | null; archived_at: Date | null;
    consent: string | null; consent_at: Date | null; suppressed_at: Date | null;
  }>`
    select c.channel, c.identity, c.display_name, c.company, c.title, c.source, c.source_detail,
           c.created_at, c.created_by, c.archived_at,
           k.evidence as consent, k.obtained_at as consent_at,
           (select s.at from suppressions s
             where s.business_id = c.business_id and s.channel = c.channel and s.identity = c.identity
             order by s.at desc limit 1) as suppressed_at
      from contacts c
      left join lateral (select evidence, obtained_at from contact_consent cc
                          where cc.business_id = c.business_id and cc.channel = c.channel
                            and cc.identity = c.identity
                          order by cc.obtained_at desc limit 1) k on true
     where c.business_id = ${businessId}
     order by c.created_at
     limit ${EXPORT_MAX_ROWS}`.execute(tx);
  return {
    header: ['channel', 'address', 'name', 'company', 'title', 'how you got them', 'detail',
      'added', 'added by', 'taken off your list', 'may write because', 'said so on', 'asked you to stop on'],
    rows: r.rows.map((x) => [
      x.channel, x.identity, x.display_name, x.company, x.title, x.source, x.source_detail,
      x.created_at, x.created_by, x.archived_at, x.consent, x.consent_at, x.suppressed_at,
    ]),
  };
};

const LOADERS: Readonly<Record<ExportSubject, Loader>> = {
  buyers, messages, products, orders, quotes, contacts,
};

/**
 * One subject, as a sheet. An unknown business id is an empty sheet with its
 * header, never a throw: a caller that cannot parse the session has nothing to
 * export, and an error page would say more about the id than a blank file does.
 */
export async function loadExport(db: Db, businessIdRaw: string, subject: ExportSubject): Promise<ExportSheet> {
  const bid = parseBusinessId(businessIdRaw);
  const loader = LOADERS[subject];
  if (!bid.ok) return { header: [], rows: [] };
  return withTenantTx(db, bid.value, (tx) => loader(tx, bid.value));
}

/**
 * What she took, on the audit trail — the SUBJECT and how many rows, never a
 * value from any of them. An export is the first thing a stolen session would
 * do, and the trail is where that shows up.
 */
export async function recordExport(
  db: Db, businessIdRaw: string, subject: ExportSubject, rows: number, actor: string,
): Promise<void> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return;
  await withTenantTx(db, bid.value, async (tx) => {
    await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
              values (${bid.value}, null, 'export_data', ${actor},
                      ${JSON.stringify({ subject, rows })}::jsonb)`.execute(tx);
  });
}
