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

/**
 * What an owner would mean by "my data" — in two halves.
 *
 * The first six are the RECORD: who wrote, what was said, what was sold. The
 * last three are her WORK — the floors and discounts she decided, the terms
 * she sells on, the facts she taught and the words she forbade. That half is
 * the switching cost, and it was missing from the first version of this
 * export: a business could take away the history of its trade but not the
 * configuration that made it, which is the part nobody wants to type twice.
 *
 * NINE FILES, NOT FOURTEEN. Her configuration lives in ten tables of four
 * different shapes. One file per table would be a page of links nobody reads
 * on a phone, so they are grouped by the question they answer — how a price is
 * decided, how she sells, what she taught — and each group is flattened into
 * one readable shape with a column saying which kind of rule a row is.
 */
export const EXPORT_SUBJECTS = [
  'buyers', 'messages', 'products', 'orders', 'quotes', 'contacts',
  'price-rules', 'selling-terms', 'teaching',
] as const;
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

/**
 * How a price is decided: her floor and discount authority, her volume breaks,
 * and the three rule tables that shape an offer.
 *
 * FLATTENED TO ONE SHAPE, with a `rule` column saying which kind each row is.
 * Five tables of five shapes in five files would be five links on a phone and
 * nothing gained — what she needs back is the numbers and what they apply to.
 *
 * `negotiation_rules` and `bundle_rules` keep their condition and action as
 * JSON, which is not pretty and is honest: they are machine rules, no owner
 * surface writes `negotiation_rules` at all (the known gap the roadmap names),
 * and rendering them as prose would invent an interface that does not exist.
 */
const priceRules: Loader = async (tx, businessId) => {
  const rows: Cell[][] = [];

  const floors = await sql<{
    product: string | null; floor: string; max_discount_pct: string; human_required_above_pct: string;
  }>`
    select p.name as product, pp.floor_price_usd as floor,
           pp.max_discount_pct, pp.human_required_above_pct
      from pricing_policy pp
      left join products p on p.id = pp.product_id
     where pp.business_id = ${businessId}
     order by p.name nulls first`.execute(tx);
  for (const x of floors.rows) {
    rows.push(['Least you accept', x.product ?? 'everything', '', x.floor,
      `most you will come down: ${x.max_discount_pct}% · ask you above: ${x.human_required_above_pct}%`]);
  }

  const tiers = await sql<{ product: string; min_qty: number; max_qty: number | null; price: string; currency: string }>`
    select p.name as product, t.min_qty, t.max_qty, t.unit_price_usd as price, t.currency
      from price_tiers t join products p on p.id = t.product_id
     where p.business_id = ${businessId}
     order by p.name, t.min_qty`.execute(tx);
  for (const x of tiers.rows) {
    rows.push(['Volume price', x.product,
      x.max_qty === null ? `${x.min_qty}+` : `${x.min_qty}–${x.max_qty}`,
      `${x.price} ${x.currency}`, '']);
  }

  const negotiation = await sql<{ priority: number; condition: unknown; action: unknown; is_active: boolean }>`
    select priority, condition, action, is_active from negotiation_rules
     where business_id = ${businessId} order by priority`.execute(tx);
  for (const x of negotiation.rows) {
    rows.push(['When you discount', '', JSON.stringify(x.condition), JSON.stringify(x.action),
      x.is_active ? '' : 'switched off']);
  }

  const bundles = await sql<{ name: string; grants: unknown; is_active: boolean }>`
    select name, grants, is_active from bundle_rules
     where business_id = ${businessId} order by name`.execute(tx);
  for (const x of bundles.rows) {
    rows.push(['Bundle', x.name, '', JSON.stringify(x.grants), x.is_active ? '' : 'switched off']);
  }

  const subs = await sql<{ product: string | null; instead: string | null; reason: string; rank: number }>`
    select p.name as product, s2.name as instead, r.reason, r.rank
      from substitution_rules r
      left join products p on p.id = r.product_id
      left join products s2 on s2.id = r.substitute_id
     where r.business_id = ${businessId} order by p.name, r.rank`.execute(tx);
  for (const x of subs.rows) {
    rows.push(['Offer instead', x.product, x.reason, x.instead, `order: ${x.rank}`]);
  }

  return {
    header: ['rule', 'applies to', 'when', 'what', 'note'],
    rows: rows.slice(0, EXPORT_MAX_ROWS),
  };
};

/**
 * How she sells: the terms on a proforma, what a sample costs, the days the
 * business is shut, and the exchange rate she will honour.
 *
 * Three of these four are INSERT-ONLY — the newest row is the one in force and
 * the older ones are the record of what was true before. They are all exported,
 * newest first, with the date she said it: "what did we promise in March" is a
 * question an owner gets asked, and the answer is in here.
 */
const sellingTerms: Loader = async (tx, businessId) => {
  const rows: Cell[][] = [];

  const terms = await sql<{ payment_terms: string; incoterm: string; stated_at: Date; stated_by: string }>`
    select payment_terms, incoterm, stated_at, stated_by from trade_terms
     where business_id = ${businessId} order by stated_at desc`.execute(tx);
  for (const x of terms.rows) {
    rows.push(['Payment terms', x.payment_terms, '', x.stated_at, x.stated_by]);
    rows.push(['Delivery term', x.incoterm, '', x.stated_at, x.stated_by]);
  }

  const samples = await sql<{
    price_amount: string; currency: string; credited_on_first_order: boolean; stated_at: Date; stated_by: string;
  }>`
    select price_amount, currency, credited_on_first_order, stated_at, stated_by from sample_policy
     where business_id = ${businessId} order by stated_at desc`.execute(tx);
  for (const x of samples.rows) {
    rows.push(['Sample price', `${x.price_amount} ${x.currency}`,
      x.credited_on_first_order ? 'taken off the first order' : 'not credited',
      x.stated_at, x.stated_by]);
  }

  const closures = await sql<{ label: string; starts_on: Date; ends_on: Date; archived_at: Date | null; created_at: Date }>`
    select label, starts_on, ends_on, archived_at, created_at from factory_closures
     where business_id = ${businessId} order by starts_on desc`.execute(tx);
  for (const x of closures.rows) {
    rows.push(['Closed', x.label, `${String(x.starts_on).slice(0, 10)} → ${String(x.ends_on).slice(0, 10)}`,
      x.created_at, x.archived_at ? 'removed' : '']);
  }

  const rates = await sql<{ from_currency: string; to_currency: string; rate: string; stated_at: Date; stated_by: string }>`
    select from_currency, to_currency, rate, stated_at, stated_by from owner_rates
     where business_id = ${businessId} order by stated_at desc`.execute(tx);
  for (const x of rates.rows) {
    rows.push(['Exchange rate', `1 ${x.from_currency} = ${x.rate} ${x.to_currency}`, '', x.stated_at, x.stated_by]);
  }

  return {
    header: ['what', 'value', 'detail', 'set on', 'set by'],
    rows: rows.slice(0, EXPORT_MAX_ROWS),
  };
};

/**
 * What she taught her, and what she forbade her to say. The asset: everything
 * here was typed by a person who knows the business, and none of it can be
 * reconstructed from anywhere else.
 *
 * Archived rows are included and marked. A fact she corrected and a word she
 * stopped forbidding are both part of the record — `archive, never erase` is
 * the schema's rule, and an export that quietly dropped them would be telling
 * her less than her own database holds.
 */
const teaching: Loader = async (tx, businessId) => {
  const rows: Cell[][] = [];

  const facts = await sql<{
    product: string | null; kind: string; label: string; content: string;
    source_language: string; source: string; status: string; created_at: Date;
  }>`
    select p.name as product, k.kind, k.label, k.content, k.source_language, k.source, k.status, k.created_at
      from product_knowledge k
      left join products p on p.id = k.product_id
     where k.business_id = ${businessId}
     order by k.created_at
     limit ${EXPORT_MAX_ROWS}`.execute(tx);
  for (const x of facts.rows) {
    rows.push(['Taught', x.product ?? 'the business', x.kind, x.label, x.content,
      x.source_language, x.source, x.created_at, x.status === 'archived' ? 'archived' : '']);
  }

  const forbidden = await sql<{ term: string; note: string | null; created_at: Date; archived_at: Date | null }>`
    select term, note, created_at, archived_at from forbidden_terms
     where business_id = ${businessId} order by created_at`.execute(tx);
  for (const x of forbidden.rows) {
    rows.push(['Never say', '', '', x.term, x.note ?? '', '', '', x.created_at,
      x.archived_at ? 'no longer forbidden' : '']);
  }

  return {
    header: ['kind', 'about', 'sort', 'label', 'what you said', 'language', 'source', 'added', 'state'],
    rows: rows.slice(0, EXPORT_MAX_ROWS),
  };
};

const LOADERS: Readonly<Record<ExportSubject, Loader>> = {
  buyers, messages, products, orders, quotes, contacts,
  'price-rules': priceRules, 'selling-terms': sellingTerms, teaching,
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
