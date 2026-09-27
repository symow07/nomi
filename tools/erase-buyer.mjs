#!/usr/bin/env node
/**
 * CC-02 — carry out ONE BUYER's deletion request, by hand, on purpose.
 *
 * The sibling of `tools/erase-workspace.mjs`, and built the same way for the
 * same reasons: the app role holds no DELETE grant anywhere
 * (`tests/integration/grants.test.ts`), so erasure is done here, as the
 * MIGRATION role, by a person who has decided to do it. Read that file's
 * header first; everything it says about why this is a tool and not a route
 * holds here too.
 *
 * WHAT IS DIFFERENT ABOUT ONE BUYER. A workspace goes whole. A buyer goes from
 * inside a business that stays, and some of what they left behind is the
 * business's record rather than theirs — an order they placed is an invoice.
 * So this tool does not delete "everything with their id on it". It carries
 * out THE CONTRACT below, which the public /data-deletion page states in
 * words, and nothing more or less:
 *
 *   ERASED — their identity on every channel; every message to or from them
 *     (with the raw webhook receipts and the queued or finished jobs that
 *     carry it); drafts, quotes, sample requests, conversation signals /
 *     events / escalations / notes, handoffs, proof links, outbound rows,
 *     message fragments, conversation state; outreach contacts, consent and
 *     sequence rows for their identities, and their number on the pilot
 *     allowlist; their conversations — EXCEPT one an order points at.
 *   KEPT — the orders they placed with items, prices and status history,
 *     detached from contact details and messages: the conversation an order
 *     points at stays as an empty, closed shell, and their `clients` row stays
 *     with every personal field cleared, so the order and this request still
 *     point at someone who is nobody. Suppressions for their identities stay,
 *     so they are never written to again. This request stays, closed as done.
 *     Anything a kept row points at by foreign key stays (an order made from a
 *     quote keeps that quote).
 *   CHANGED IN PLACE — rows that are not theirs but quoted them: the owner's
 *     spot-check verdict loses its link and correction, an audit entry loses
 *     its detail, another buyer's batched webhook receipt loses their part.
 *
 * HOW THE ROWS ARE FOUND — from the live schema, not a list. It starts at the
 * `clients` row and walks every foreign key down from it (pg_constraint), so a
 * table added next month with a key to `conversations` is found the day it
 * exists. Then it subtracts what a kept row needs, and deletes deepest first.
 * Links that are NOT foreign keys — an identity typed as text, a webhook's raw
 * JSON, the audit trail's detail, a queued job — cannot be found that way, so
 * each is written out below with the reason.
 *
 * AND IT REFUSES RATHER THAN GUESSES. Every table reachable from a buyer, and
 * every table with a column that looks like a buyer (`client_id`,
 * `conversation_id`, `identity`, `phone`, `email`…), must be named in RULES. A
 * table it cannot classify stops the run, by name, before anything changes: a
 * wrong guess here is either somebody's data kept after they were told it was
 * gone, or a business's invoice deleted.
 *
 * WHAT IT REFUSES TO DO:
 *   · run without an OPEN `deletion_requests` row with scope 'buyer' — the
 *     request is the authorisation, and the owner makes it in the product;
 *   · run without `--yes`, the first 8 characters of the request id as
 *     `--confirm`, and `--by` naming who carried it out. The default is a dry
 *     run that prints what would be erased and kept, and changes nothing;
 *   · run while a worker is busy with this buyer, or with any table it cannot
 *     classify;
 *   · run as a role that row security filters — it would see nothing to erase
 *     and close the request as done.
 *
 * One transaction. It locks the buyer's rows, plans, carries the plan out
 * checking every statement's row count against the plan, closes the request,
 * then plans AGAIN inside the same transaction and commits only if nothing is
 * left to erase and every kept row is still there. A second run refuses: the
 * request is no longer open.
 *
 * Not reachable from `npm` scripts and not imported by any source file. Usage:
 *
 *   MIGRATE_DATABASE_URL=… node tools/erase-buyer.mjs --request <uuid>
 *   MIGRATE_DATABASE_URL=… node tools/erase-buyer.mjs --request <uuid> \
 *     --yes --confirm <first 8 characters of the id> --by "<your name>"
 *
 * Exit 0 all done · 1 a real refusal or failure · 2 bad usage.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toolClient } from './lib/db.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// THE CONTRACT, table by table.
//
//   erase              every row reached from the buyer goes.
//   erase-unless-kept  goes, unless a kept row points at it — then it stays
//                      exactly as it is (a quote an order was made from).
//   shell              goes, unless a kept row points at it — then it stays,
//                      emptied: `clear` nulled, closed and inactive.
//   keep               stays; `clear` columns nulled, `blank` columns ''.
//   anonymise          the buyer's own row: stays, `clear` nulled.
//   detach             stays; the key to the buyer (`detach`) and `clear` nulled.
//   receipts / redact  no key at all; written out in `textLinks` below.
//   unrelated          looks like buyer data by a column name, and is not.
//
// `match` is how a table with no key to the buyer is found: 'identity' is
// (channel, identity) as M38 stores it, 'phone' is the pilot allowlist's
// digits. `says` is what the dry run prints beside a table that is not simply
// erased.
// ─────────────────────────────────────────────────────────────────────────────
export const RULES = Object.freeze({
  // ── The buyer ─────────────────────────────────────────────────────────────
  clients: {
    do: 'anonymise',
    clear: ['display_name', 'email', 'phone', 'country', 'preferred_language', 'notes'],
    says: 'stays so their orders and this request point at someone who is nobody; every personal field cleared',
  },
  client_channels: { do: 'erase' },

  // ── Their conversations, and everything said or worked out in them ─────────
  conversations: {
    do: 'shell',
    // Who holds it (a held conversation shows under "Needs you"), when the
    // disclosure went, and words the owner had not yet sent them.
    clear: ['assigned_to', 'assigned_at', 'ai_disclosed_at', 'owner_unsent_reply', 'owner_unsent_reply_at'],
    says: 'an order points at it: kept empty, closed and inactive',
  },
  messages: { do: 'erase' },
  message_fragments: { do: 'erase' },
  turns: { do: 'erase' },
  drafts: { do: 'erase' },
  conversation_state: { do: 'erase' },
  conversation_signals: { do: 'erase' },
  conversation_events: { do: 'erase' },
  conversation_notes: { do: 'erase' },
  escalation_events: { do: 'erase' },
  handoffs: { do: 'erase' },
  sample_requests: { do: 'erase' },
  quotes: { do: 'erase-unless-kept', says: 'an order was made from it; a price snapshot, nothing personal' },
  quote_proofs: { do: 'erase' },
  outbound_messages: { do: 'erase' },
  outbound_transitions: { do: 'erase' },
  // No writer today (deliveries: 0003; repairs: core/trust/repair.ts is gone).
  // Their payloads are messages to or about the buyer, and their key to the
  // conversation is ON DELETE SET NULL — left alone, they would outlive it
  // holding exactly what was meant to go.
  deliveries: { do: 'erase' },
  repairs: { do: 'erase' },
  // 0005's shadow of each turn: what the service would have said, beside what
  // n8n did. Its writer is a route main.ts no longer mounts, but its rows are
  // still there, keyed by conversation — so theirs go with their turns.
  'shadow.turn_decisions': { do: 'erase' },
  // The owner's verdict on the assistant's work is evidence about the
  // ASSISTANT: promotion and demotion count it (pipeline/capability.ts), and
  // erasing a 'serious' verdict because a buyer left would make her look
  // better than she was. So the verdict stays; what ties it to this buyer
  // goes — the key, and the owner's correction, which is a reply to them.
  spot_checks: {
    do: 'detach', detach: ['conversation_id'], clear: ['correction'],
    says: "the owner's verdict on the assistant's work stays; the link to them and the correction go",
  },

  // ── What they bought ──────────────────────────────────────────────────────
  orders: {
    do: 'keep', clear: ['client_email', 'shipping_address', 'notes'],
    says: 'items, prices and status stay; e-mail, shipping address and notes cleared',
  },
  order_updates: { do: 'keep', says: "the order's status history" },
  email_confirmations: {
    do: 'keep', blank: ['to_email'], clear: ['subject', 'body_html'],
    says: 'when it was sent and whether it arrived; the address and the mail itself cleared',
  },

  // ── Outreach: who may be written to ───────────────────────────────────────
  // Consent and suppression are keyed on (channel, identity), never on a row
  // (0036 explains why), so they are found by the buyer's identities.
  sequence_enrollments: { do: 'erase', match: 'identity' },
  sequence_sends: { do: 'erase' },
  contacts: { do: 'erase', match: 'identity' },
  contact_consent: { do: 'erase', match: 'identity' },
  // Permission to write to their number during the pilot. Permissions to write
  // go with them; the prohibition below stays.
  pilot_allowlist: { do: 'erase', match: 'phone' },
  suppressions: { do: 'keep', match: 'identity', says: 'so they are never written to again' },

  // ── The request itself ────────────────────────────────────────────────────
  deletion_requests: { do: 'keep', says: 'the request, closed as done (and any earlier one naming them)' },

  // ── Records that can quote them with no key at all (see textLinks) ────────
  channel_events: {
    do: 'receipts',
    says: "another buyer's webhook receipt that also carried theirs: their part taken out",
  },
  channel_audit: { do: 'redact', says: 'the entry stays; what it said about them goes' },

  // ── A buyer-like column name, and not a buyer ─────────────────────────────
  logins: { do: 'unrelated' },       // the business's own team signing in
  login_codes: { do: 'unrelated' },  // codes e-mailed to that team
});

/**
 * Links that are columns but not foreign keys. `conversation_events` and
 * `shadow.turn_decisions` were both created in 0005 with a bare
 * `conversation_id` and no constraint, so the walk over pg_constraint cannot
 * see them; these are the constraints they do not have.
 */
export const VIRTUAL_EDGES = Object.freeze([
  { child: 'conversation_events', column: 'conversation_id', parent: 'conversations', parentColumn: 'id' },
  { child: 'shadow.turn_decisions', column: 'conversation_id', parent: 'conversations', parentColumn: 'id' },
]);

/**
 * A column with one of these names makes a table a SUSPECT: it must be named
 * in RULES whether or not a foreign key reaches it. And a `client_id` or
 * `conversation_id` that is not a foreign key (or a VIRTUAL_EDGE) stops the
 * run — rows linked by it would be missed.
 */
export const SUSPECT_COLUMNS = Object.freeze([
  'client_id', 'conversation_id', 'identity', 'channel_user_id', 'wa_id', 'to_wa_id',
  'phone', 'email', 'client_email', 'to_email',
]);
const KEY_COLUMNS = ['client_id', 'conversation_id'];

const ACTIONS = new Set(['erase', 'erase-unless-kept', 'shell', 'keep', 'anonymise', 'detach', 'receipts', 'redact', 'unrelated']);
/** Actions the foreign-key walk knows how to carry out. */
const FK_ACTIONS = new Set(['erase', 'erase-unless-kept', 'shell', 'keep', 'anonymise', 'detach']);
/** Columns a shell is judged by. */
const SHELL_COLUMNS = ['is_active', 'phase', 'closed_at'];
/** Channels whose webhooks land in channel_events. */
const WEBHOOK_CHANNELS = ['whatsapp', 'instagram', 'messenger'];

const q = (id) => `"${String(id).replace(/"/g, '""')}"`;
/** A table as RULES names it: 'messages', or 'shadow.turn_decisions' outside public. */
const qt = (t) => String(t).split('.').map(q).join('.');

/**
 * Every schema that holds product rows. Not only `public`: 0005 put the
 * service's shadow of each turn in `shadow`, keyed by conversation, and a
 * walk that looked only at `public` would never see it. `pgboss` is the
 * queue's own, and its jobs are handled by a rule written out below.
 */
const USER_SCHEMAS = (n) => `${n}.nspname not in ('pg_catalog', 'information_schema', 'pgboss') and ${n}.nspname not like 'pg\\_%'`;
const NAME = (c, n) => `(case when ${n}.nspname = 'public' then ${c}.relname::text else ${n}.nspname || '.' || ${c}.relname end)`;

// ─────────────────────────────────────────────────────────────────────────────
// The schema, as the database in front of us has it.
// ─────────────────────────────────────────────────────────────────────────────

/** @returns {Promise<{tables:Set<string>, columns:Map<string,Map<string,{type:string,notnull:boolean}>>, pks:Map<string,string[]>, fks:Array<{child:string,cols:string[],parent:string,pcols:string[],name:string}>}>} */
export async function readSchema(client) {
  const tables = new Set((await client.query(`
    select ${NAME('c', 'n')} as t
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where ${USER_SCHEMAS('n')} and c.relkind in ('r', 'p') and not c.relispartition`)).rows.map((r) => r.t));

  const columns = new Map();
  for (const r of (await client.query(`
    select ${NAME('c', 'n')} as t, a.attname as col, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as notnull
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where ${USER_SCHEMAS('n')} and c.relkind in ('r', 'p') and not c.relispartition
       and a.attnum > 0 and not a.attisdropped`)).rows) {
    if (!columns.has(r.t)) columns.set(r.t, new Map());
    columns.get(r.t).set(r.col, { type: r.type, notnull: r.notnull });
  }

  const keyCols = (rel, keys) => `array(select a.attname::text from unnest(${keys}) with ordinality k(n, i)
      join pg_attribute a on a.attrelid = ${rel} and a.attnum = k.n order by k.i)`;
  const pks = new Map((await client.query(`
    select ${NAME('c', 'n')} as t, ${keyCols('con.conrelid', 'con.conkey')} as cols
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where con.contype = 'p' and ${USER_SCHEMAS('n')}`)).rows.map((r) => [r.t, r.cols]));

  const fks = (await client.query(`
    select ${NAME('c', 'n')} as child, ${NAME('p', 'pn')} as parent, con.conname as name,
           ${keyCols('con.conrelid', 'con.conkey')} as cols,
           ${keyCols('con.confrelid', 'con.confkey')} as pcols
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_class p on p.oid = con.confrelid join pg_namespace pn on pn.oid = p.relnamespace
     where con.contype = 'f' and ${USER_SCHEMAS('n')} and ${USER_SCHEMAS('pn')}
     order by 1, 3`)).rows;

  return { tables, columns, pks, fks };
}

/**
 * Which tables can hold a buyer, and whether RULES covers every one of them.
 * Pure: schema and rules in, a verdict out — the structural test runs it on
 * the real schema with a table taken away and expects the tool to name it.
 */
export function coverage(schema, rules = RULES, virtual = VIRTUAL_EDGES) {
  const problems = [];
  const has = (t, c) => schema.columns.get(t)?.has(c) === true;

  const edges = [
    ...schema.fks.map((f) => ({ child: f.child, cols: f.cols, parent: f.parent, pcols: f.pcols, name: f.name })),
    ...virtual.map((v) => ({ child: v.child, cols: [v.column], parent: v.parent, pcols: [v.parentColumn], name: `(no constraint) ${v.child}.${v.column}` })),
  ];
  for (const v of virtual) {
    if (!has(v.child, v.column) || !has(v.parent, v.parentColumn)) {
      problems.push(`the link ${v.child}.${v.column} → ${v.parent}.${v.parentColumn} is written into this tool, and this database does not have it`);
    }
  }

  // Everything below `clients`, by foreign key.
  const reach = new Set(['clients']);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) if (reach.has(e.parent) && !reach.has(e.child)) { reach.add(e.child); grew = true; }
  }
  const inReach = edges.filter((e) => reach.has(e.child) && reach.has(e.parent));

  const suspects = [...schema.tables].filter((t) => SUSPECT_COLUMNS.some((c) => has(t, c)));
  const declared = Object.entries(rules).filter(([, r]) => r.match || r.do === 'receipts' || r.do === 'redact').map(([t]) => t);
  const inScope = new Set([...reach, ...suspects, ...declared].filter((t) => schema.tables.has(t)));

  const unclassified = [...inScope].filter((t) => !rules[t]).sort();
  const stale = Object.keys(rules).filter((t) => !schema.tables.has(t)).sort();

  for (const [t, r] of Object.entries(rules)) {
    if (!ACTIONS.has(r.do)) { problems.push(`${t}: '${r.do}' is not something this tool knows how to do`); continue; }
    if (!schema.tables.has(t)) continue;
    if (reach.has(t) && !FK_ACTIONS.has(r.do)) {
      problems.push(`${t} now has a foreign key into a buyer's rows, and its rule ('${r.do}') was written for a table with none — decide what it means first`);
    }
    for (const c of r.clear ?? []) {
      if (!has(t, c)) problems.push(`${t}.${c} is to be cleared, and this database has no such column`);
      else if (schema.columns.get(t).get(c).notnull) problems.push(`${t}.${c} is to be cleared, and it is NOT NULL`);
    }
    for (const c of r.blank ?? []) {
      if (!has(t, c)) problems.push(`${t}.${c} is to be blanked, and this database has no such column`);
    }
    for (const c of r.detach ?? []) {
      if (!edges.some((e) => e.child === t && e.cols.length === 1 && e.cols[0] === c)) problems.push(`${t}.${c} is to be detached, and it is not a link`);
      else if (has(t, c) && schema.columns.get(t).get(c).notnull) problems.push(`${t}.${c} is to be detached, and it is NOT NULL`);
    }
    if (r.do === 'shell') for (const c of SHELL_COLUMNS) if (!has(t, c)) problems.push(`${t}.${c}: a shell is closed by it, and this database has no such column`);
    if (r.match === 'identity' && !(has(t, 'channel') && has(t, 'identity') && has(t, 'business_id'))) problems.push(`${t} is matched by (channel, identity) and lacks one of them`);
    if (r.match === 'phone' && !(has(t, 'phone') && has(t, 'business_id'))) problems.push(`${t} is matched by phone and lacks it`);
  }

  // A key column that no constraint and no rule accounts for: its rows would
  // be silently missed.
  for (const t of inScope) {
    for (const c of KEY_COLUMNS) {
      if (!has(t, c)) continue;
      if (!edges.some((e) => e.child === t && e.cols.length === 1 && e.cols[0] === c)) {
        problems.push(`${t}.${c} links to a buyer with no foreign key and no rule in this tool`);
      }
    }
  }

  for (const e of inReach) {
    if (e.cols.length !== 1) problems.push(`${e.child} → ${e.parent} is a key over ${e.cols.length} columns; this tool follows single-column keys only`);
    if (e.child === e.parent) problems.push(`${e.child} points at itself (${e.name}); the order of deletes cannot be derived`);
  }
  for (const t of reach) if (!(schema.pks.get(t)?.length)) problems.push(`${t} has no primary key, so its rows cannot be named one by one`);

  // Parents before children (Kahn), and how deep each table sits.
  const order = [];
  const depth = new Map([['clients', 0]]);
  const indeg = new Map([...reach].map((t) => [t, 0]));
  for (const e of inReach) if (e.child !== e.parent) indeg.set(e.child, indeg.get(e.child) + 1);
  const ready = [...reach].filter((t) => indeg.get(t) === 0).sort();
  while (ready.length) {
    const t = ready.shift();
    order.push(t);
    for (const e of inReach) {
      if (e.parent !== t || e.child === t) continue;
      depth.set(e.child, Math.max(depth.get(e.child) ?? 0, (depth.get(t) ?? 0) + 1));
      indeg.set(e.child, indeg.get(e.child) - 1);
      if (indeg.get(e.child) === 0) { ready.push(e.child); ready.sort(); }
    }
  }
  if (order.length !== reach.size) {
    problems.push(`the keys between ${[...reach].filter((t) => !order.includes(t)).sort().join(', ')} form a cycle; the order of deletes cannot be derived`);
  }

  return { reach, inScope, unclassified, stale, problems, order, depth, edges: inReach, suspects };
}

// ─────────────────────────────────────────────────────────────────────────────
// Who they are, on every channel.
// ─────────────────────────────────────────────────────────────────────────────

/** The same canonical shapes M18.2 / M38 store: a wa_id is digits, an address is lower-case. */
export function normalizeIdentity(channel, raw) {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  if (channel === 'email') return v.toLowerCase();
  if (channel === 'whatsapp') {
    // src/core/channel/phone.ts's normalizePhone, less its length check.
    let s = v.replace(/[\s\-().\u00a0\u2010-\u2015]/g, '');
    if (s.startsWith('+')) s = s.slice(1);
    else if (s.startsWith('00')) s = s.slice(2);
    return s || null;
  }
  return v;
}

/**
 * Every identity this business holds for them. Four places, because one is not
 * enough: `client_channels` is unique ACROSS businesses (src/db/contacts.ts
 * explains), so a buyer who wrote to another business first has no row there
 * and `clients.phone` / `clients.email` are the only record; and an address
 * given for an order, or used to send, is theirs too.
 */
export async function identitiesOf(client, businessId, clientId) {
  const rows = (await client.query(`
    select cc.channel, cc.channel_user_id as identity
      from client_channels cc join clients cl on cl.id = cc.client_id
     where cc.client_id = $2 and cl.business_id = $1
    union select 'whatsapp', phone from clients where id = $2 and business_id = $1 and phone is not null
    union select 'email', email from clients where id = $2 and business_id = $1 and email is not null
    union select 'email', client_email from orders where client_id = $2 and business_id = $1 and client_email is not null
    union select v.channel, o.to_wa_id
            from outbound_messages o join conversations v on v.id = o.conversation_id
           where v.client_id = $2 and v.business_id = $1 and o.to_wa_id is not null`, [businessId, clientId])).rows;
  const seen = new Map();
  for (const r of rows) {
    for (const value of [normalizeIdentity(r.channel, r.identity), String(r.identity ?? '').trim()]) {
      if (value) seen.set(`${r.channel}\u0001${value}`, { channel: r.channel, identity: value });
    }
  }
  return [...seen.values()].sort((a, b) => a.channel.localeCompare(b.channel) || a.identity.localeCompare(b.identity));
}

/** For the screen and the log: never the whole identity of someone being erased. */
export function mask({ channel, identity }) {
  if (channel === 'email') {
    const at = identity.lastIndexOf('@');
    return at > 0 ? `${identity[0]}…${identity.slice(at)}` : '…';
  }
  return `…${identity.slice(-4)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON that can carry them: webhook receipts and the audit trail.
// ─────────────────────────────────────────────────────────────────────────────

/** Does any string anywhere in this JSON equal one of `values`? Exact, not a substring. */
export function mentions(doc, values) {
  if (typeof doc === 'string') return values.has(doc);
  if (Array.isArray(doc)) return doc.some((x) => mentions(x, values));
  if (doc && typeof doc === 'object') return Object.values(doc).some((x) => mentions(x, values));
  return false;
}

/**
 * One webhook can batch several buyers (parse.ts: "one webhook may batch
 * multiple messages AND statuses"), and every event it produced keeps the
 * WHOLE body. So another buyer's receipt can hold this buyer's message. Meta
 * puts each buyer's message, status and profile in its own array element with
 * their id inside it, so those elements are taken out and the rest — the
 * other buyer's own record — stays.
 *
 * Innermost first: the webhook's own `entry` array holds everybody, so an
 * element is dropped only if it still names them after everything inside it
 * has been pruned. If they are still named anywhere after that (outside any
 * array), the whole document is replaced — returned as null.
 */
export function pruneMentions(doc, values) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk).filter((x) => !mentions(x, values));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(doc);
  return mentions(out, values) ? null : out;
}

const likeAny = (values) => [...values].map((v) => `%"${v}"%`);

// ─────────────────────────────────────────────────────────────────────────────
// The plan.
// ─────────────────────────────────────────────────────────────────────────────

const distinct = (xs) => [...new Set(xs.filter((x) => x !== null && x !== undefined).map(String))];

/**
 * Everything the erasure would do, computed from the live schema and the
 * buyer's rows, and changing nothing. Run inside the caller's transaction so a
 * dry run and a real run read the same way.
 *
 * `options.identities` is for the check AFTER the erasure, when the rows they
 * were read from have gone.
 */
export async function planErasure(client, subject, options = {}) {
  const rules = options.rules ?? RULES;
  const schema = options.schema ?? await readSchema(client);
  const cov = coverage(schema, rules);
  const refusals = [...cov.problems];
  if (cov.unclassified.length) {
    refusals.push(`this tool does not know what these tables mean for a buyer, so it will not guess: ${cov.unclassified.join(', ')} — add them to RULES in tools/erase-buyer.mjs`);
  }
  if (cov.stale.length) refusals.push(`RULES names tables this database does not have: ${cov.stale.join(', ')}`);
  if (refusals.length) return { refusals, coverage: cov };

  const { businessId, clientId, requestId } = subject;
  const identities = options.identities ?? await identitiesOf(client, businessId, clientId);
  const identityValues = new Set(identities.map((i) => i.identity));

  const colType = (t, c) => schema.columns.get(t).get(c).type;
  const pk = (t) => schema.pks.get(t);
  const keyOf = (t, row) => pk(t).map((c) => row[c]).join('\u0001');
  const has = (t, c) => schema.columns.get(t)?.has(c) === true;

  const wanted = (t) => {
    const cols = new Set(pk(t) ?? []);
    for (const e of cov.edges) { if (e.child === t) cols.add(e.cols[0]); if (e.parent === t) cols.add(e.pcols[0]); }
    for (const c of ['business_id', 'client_id']) if (has(t, c)) cols.add(c);
    const r = rules[t];
    for (const c of [...(r?.clear ?? []), ...(r?.blank ?? []), ...(r?.detach ?? [])]) cols.add(c);
    if (r?.do === 'shell') for (const c of SHELL_COLUMNS) cols.add(c);
    return [...cols];
  };
  const sel = (t) => wanted(t).map((c) => `${q(c)}::text as ${q(c)}`).join(', ');

  // Identity matches, business-scoped — the same person in another business
  // is that business's buyer, and is left exactly as they are.
  const byIdentity = identities.filter((i) => i.channel === 'email' || i.channel === 'whatsapp');
  const matched = async (t) => {
    const r = rules[t];
    if (r.match === 'identity') {
      if (!byIdentity.length) return [];
      return (await client.query(`
        select ${sel(t)} from ${qt(t)} x
         where x.business_id = $1
           and exists (select 1 from unnest($2::text[], $3::text[]) as i(ch, v)
                        where i.ch = x.channel and (x.identity = i.v or (i.ch = 'email' and lower(x.identity) = i.v)))`,
        [businessId, byIdentity.map((i) => i.channel), byIdentity.map((i) => i.identity)])).rows;
    }
    if (r.match === 'phone') {
      const phones = distinct(identities.filter((i) => i.channel === 'whatsapp').map((i) => i.identity));
      if (!phones.length) return [];
      return (await client.query(`select ${sel(t)} from ${qt(t)} where business_id = $1 and phone = any($2::text[])`,
        [businessId, phones])).rows;
    }
    return [];
  };

  // 1 · Every row reached from the buyer: parents first, down every key.
  const scoped = new Map();
  const byKey = new Map();       // table -> keys reached down a key (not only by identity)
  for (const t of cov.order) {
    const rows = new Map();
    const keyed = new Set();
    const add = (list, viaKey) => {
      for (const r of list) { const k = keyOf(t, r); rows.set(k, r); if (viaKey) keyed.add(k); }
    };
    if (t === 'clients') add((await client.query(`select ${sel(t)} from clients where id = $1`, [clientId])).rows, true);
    for (const e of cov.edges) {
      if (e.child !== t || e.child === e.parent || !scoped.has(e.parent)) continue;
      const values = distinct([...scoped.get(e.parent).values()].map((r) => r[e.pcols[0]]));
      if (!values.length) continue;
      add((await client.query(
        `select ${sel(t)} from ${qt(t)} where ${q(e.cols[0])} = any($1::${colType(t, e.cols[0])}[])`, [values])).rows, true);
    }
    if (rules[t]?.match) add(await matched(t), false);
    scoped.set(t, rows);
    byKey.set(t, keyed);
  }
  // …and the tables no key reaches, found by who they are.
  for (const [t, r] of Object.entries(rules)) {
    if (!r.match || scoped.has(t)) continue;
    const rows = new Map();
    for (const row of await matched(t)) rows.set(keyOf(t, row), row);
    scoped.set(t, rows);
  }

  // Nothing reached may belong to another business, name another buyer, or —
  // reached down a key — sit in another buyer's conversation (a draft whose
  // turn is theirs, in someone else's thread). That would be inconsistent
  // data, and inconsistent data is decided by a person, not by this loop. A
  // row found by IDENTITY may point at another buyer's conversation: an
  // enrolment of their address can have started a thread under a second
  // buyer row. The row is theirs; the thread is not touched.
  const theirConversations = new Set((scoped.get('conversations') ?? new Map()).keys());
  for (const [t, rows] of scoped) {
    for (const [k, row] of rows) {
      if (has(t, 'business_id') && row.business_id !== businessId) {
        refusals.push(`${t} ${k} is reached from this buyer and belongs to another business`);
      }
      if (t !== 'clients' && has(t, 'client_id') && row.client_id !== null && row.client_id !== clientId) {
        refusals.push(`${t} ${k} is reached from this buyer and names another buyer (${row.client_id})`);
      }
      if (t !== 'conversations' && has(t, 'conversation_id') && byKey.get(t)?.has(k)
          && row.conversation_id !== null && !theirConversations.has(row.conversation_id)) {
        refusals.push(`${t} ${k} is reached from this buyer and sits in another buyer's conversation (${row.conversation_id})`);
      }
    }
  }
  if (!scoped.get('clients')?.size) refusals.push(`no buyer ${clientId} in this business`);

  // 2 · What a kept row needs stays. Walk UP every key from each kept row.
  const kept = new Map();
  for (const [t, rows] of scoped) {
    if (['keep', 'anonymise'].includes(rules[t]?.do)) kept.set(t, new Set(rows.keys()));
  }
  const index = new Map();   // "table.col" -> Map(value -> [keys])
  const lookup = (t, c, v) => {
    const id = `${t}.${c}`;
    if (!index.has(id)) {
      const m = new Map();
      for (const [k, row] of scoped.get(t) ?? []) {
        const x = row[c];
        if (x === null || x === undefined) continue;
        if (!m.has(x)) m.set(x, []);
        m.get(x).push(k);
      }
      index.set(id, m);
    }
    return index.get(id).get(v) ?? [];
  };
  const queue = [...kept].flatMap(([t, keys]) => [...keys].map((k) => [t, k]));
  while (queue.length) {
    const [t, k] = queue.pop();
    const row = scoped.get(t).get(k);
    for (const e of cov.edges) {
      if (e.child !== t || !scoped.has(e.parent)) continue;
      if (rules[t].detach?.includes(e.cols[0])) continue;
      const v = row[e.cols[0]];
      if (v === null || v === undefined) continue;
      for (const pkey of lookup(e.parent, e.pcols[0], v)) {
        if (kept.get(e.parent)?.has(pkey)) continue;
        const want = rules[e.parent].do;
        if (want === 'shell' || want === 'erase-unless-kept') {
          if (!kept.has(e.parent)) kept.set(e.parent, new Set());
          kept.get(e.parent).add(pkey);
          queue.push([e.parent, pkey]);
        } else {
          refusals.push(`a ${t} row that stays (${k}) needs a ${e.parent} row the contract erases (${pkey}), via ${e.name}`);
        }
      }
    }
  }
  if (refusals.length) return { refusals, coverage: cov };

  // 3 · What happens to each row.
  const erase = new Map();       // table -> [rows]
  const changes = [];            // { table, kind, rows | items }
  const keptCount = new Map();
  let pending = 0;               // kept rows not yet emptied — zero after a run
  const needsChange = (t, row) => {
    const r = rules[t];
    if ((r.clear ?? []).some((c) => row[c] !== null)) return true;
    if ((r.blank ?? []).some((c) => row[c] !== '')) return true;
    if (r.do === 'shell') return row.is_active !== 'false' || row.phase !== 'closed' || row.closed_at === null;
    return false;
  };
  for (const [t, rows] of scoped) {
    const r = rules[t];
    const keep = kept.get(t) ?? new Set();
    const going = [...rows].filter(([k]) => !keep.has(k)).map(([, row]) => row);
    const staying = [...rows].filter(([k]) => keep.has(k)).map(([, row]) => row);
    if (r.do === 'detach') {
      if (going.length) changes.push({ table: t, kind: 'detach', rows: going });
      continue;
    }
    if (going.length) erase.set(t, going);
    if (staying.length) {
      keptCount.set(t, staying.length);
      const change = staying.filter((row) => needsChange(t, row));
      pending += change.length;
      if (change.length) changes.push({ table: t, kind: r.do === 'shell' ? 'shell' : r.do === 'anonymise' ? 'anonymise' : 'clear', rows: change });
    }
  }

  // 4 · The links that are not keys, written out.
  const conversationIds = distinct([...(scoped.get('conversations') ?? new Map()).values()].map((r) => r.id));
  const text = await textLinks(client, { businessId, clientId, requestId, identities, identityValues, conversationIds, scoped });
  for (const [t, rows] of text.erase) if (rows.length) erase.set(t, rows);
  for (const c of text.changes) changes.push(c);

  // 5 · Deepest first, so no delete waits on a key; the tables no key reaches
  // have nothing below them and go after.
  const deleteOrder = [
    ...[...erase.keys()].filter((t) => cov.reach.has(t))
      .sort((a, b) => (cov.depth.get(b) ?? 0) - (cov.depth.get(a) ?? 0) || a.localeCompare(b)),
    ...[...erase.keys()].filter((t) => !cov.reach.has(t)).sort(),
  ];

  const matchPk = (t, rows, from = 1) => {
    const cols = pk(t);
    if (cols.length === 1) {
      return { where: `${q(cols[0])} = any($${from}::${colType(t, cols[0])}[])`, params: [rows.map((r) => r[cols[0]])] };
    }
    return {
      where: `(${cols.map(q).join(', ')}) in (select * from unnest(${cols.map((c, i) => `$${from + i}::${colType(t, c)}[]`).join(', ')}))`,
      params: cols.map((c) => rows.map((r) => r[c])),
    };
  };

  const steps = [];
  // Links cut and trails cleaned first, while what they point at still exists.
  for (const c of changes.filter((x) => x.kind === 'detach')) {
    const r = rules[c.table];
    const m = matchPk(c.table, c.rows);
    steps.push({
      table: c.table, kind: 'detach', expect: c.rows.length, params: m.params,
      sql: `update ${qt(c.table)} set ${[...r.detach, ...(r.clear ?? [])].map((x) => `${q(x)} = null`).join(', ')} where ${m.where}`,
    });
  }
  for (const c of changes.filter((x) => x.kind === 'redact' || x.kind === 'prune')) {
    steps.push({
      table: c.table, kind: c.kind, expect: c.items.length,
      params: [c.items.map((i) => i.key), c.items.map((i) => JSON.stringify(i.doc))],
      sql: `update ${qt(c.table)} x set ${q(c.column)} = v.doc from unnest($1::${colType(c.table, pk(c.table)[0])}[], $2::jsonb[]) as v(k, doc)
             where x.${q(pk(c.table)[0])} = v.k`,
    });
  }
  for (const t of deleteOrder) {
    const rows = erase.get(t);
    const m = matchPk(t, rows);
    steps.push({ table: t, kind: 'erase', expect: rows.length, params: m.params, sql: `delete from ${qt(t)} where ${m.where}` });
  }
  for (const c of changes.filter((x) => ['shell', 'anonymise', 'clear'].includes(x.kind))) {
    const r = rules[c.table];
    const set = [
      ...(r.clear ?? []).map((x) => `${q(x)} = null`),
      ...(r.blank ?? []).map((x) => `${q(x)} = ''`),
      ...(c.kind === 'shell' ? ['is_active = false', "phase = 'closed'", 'closed_at = coalesce(closed_at, now())'] : []),
    ];
    const m = matchPk(c.table, c.rows);
    steps.push({ table: c.table, kind: c.kind, expect: c.rows.length, params: m.params, sql: `update ${qt(c.table)} set ${set.join(', ')} where ${m.where}` });
  }
  if (text.jobs.erase.length) {
    steps.push({
      table: 'pgboss.job', kind: 'erase', expect: text.jobs.erase.length, params: [text.jobs.erase],
      sql: 'delete from pgboss.job where id = any($1::uuid[])',
    });
  }

  // 6 · What a person should know before saying yes.
  const notes = [];
  if ((keptCount.get('orders') ?? 0) > 0 && (erase.get('sample_requests')?.length ?? 0) > 0) {
    notes.push('They asked for a sample and also ordered. The order page works out a sample credit from the sample '
      + 'request, which this erases — after it, that credit no longer shows. If one is owed, settle it first.');
  }
  if (text.jobs.active > 0) {
    notes.push(`A worker is handling this buyer right now (${text.jobs.active} job${text.jobs.active === 1 ? '' : 's'} active). `
      + 'The real run refuses until it finishes — try again in a minute.');
  }
  if (text.others.length) {
    notes.push(`Another buyer row in this business shares one of their identities: ${text.others.join(', ')}. `
      + 'Contacts and consent for that identity go with this request; that buyer row and its conversations stay. '
      + 'If it is the same person, the owner records a request for it too.');
  }

  const counts = (m) => new Map([...m].map(([t, v]) => [t, Array.isArray(v) ? v.length : v]));
  const changed = new Map();
  for (const c of changes) {
    if (!['detach', 'redact', 'prune'].includes(c.kind)) continue;
    changed.set(c.table, (changed.get(c.table) ?? 0) + (c.rows ?? c.items).length);
  }
  const erased = counts(erase);
  if (text.jobs.erase.length) erased.set('pgboss.job', text.jobs.erase.length);

  return {
    requestId, businessId, clientId, identities, steps, notes,
    erased, kept: keptCount, changed, pending,
    jobsActive: text.jobs.active,
    conversations: { total: conversationIds.length, shells: kept.get('conversations')?.size ?? 0 },
    totals: {
      erased: [...erased.values()].reduce((a, b) => a + b, 0),
      kept: [...keptCount.values()].reduce((a, b) => a + b, 0),
      changed: [...changed.values()].reduce((a, b) => a + b, 0),
    },
    refusals: [],
    coverage: cov,
  };
}

/**
 * THE LINKS THAT ARE NOT KEYS. Each is a decision about what belongs to a
 * buyer, written out rather than derived, because the schema cannot say it.
 */
async function textLinks(client, { businessId, clientId, requestId, identities, identityValues, conversationIds, scoped }) {
  const erase = new Map();
  const changes = [];
  const ids = (t, c) => distinct([...(scoped.get(t) ?? new Map()).values()].map((r) => r[c]));
  // What a cleared document says instead, and which request cleared it.
  const marker = { erased: 'buyer deletion request', request: requestId ?? null };

  // ── channel_events — every webhook, raw. ───────────────────────────────────
  // A receipt is THEIRS when its conversation key names them
  // ('<channel>:<their id>:<our number>', main.ts persistEvent), or when it is
  // the receipt of a message they sent (id = the message's provider id) or a
  // status of one sent to them (id = '<provider id>#<status>'). Theirs go.
  // Another buyer's receipt whose body ALSO carries them (a batched webhook)
  // stays, with their part taken out.
  const hooks = identities.filter((i) => WEBHOOK_CHANNELS.includes(i.channel));
  const inbound = conversationIds.length ? distinct((await client.query(
    'select external_id from messages where conversation_id = any($1::uuid[]) and external_id is not null',
    [conversationIds])).rows.map((r) => r.external_id)) : [];
  const sent = conversationIds.length ? distinct((await client.query(
    'select provider_message_id from outbound_messages where conversation_id = any($1::uuid[]) and provider_message_id is not null',
    [conversationIds])).rows.map((r) => r.provider_message_id)) : [];
  const theirs = `(
      exists (select 1 from unnest($2::text[], $3::text[]) as i(ch, v)
               where split_part(e.conversation_external_id, ':', 1) = i.ch
                 and split_part(e.conversation_external_id, ':', 2) = i.v)
      or e.id = any($4::text[])
      or split_part(e.id, '#', 1) = any($5::text[]))`;
  const own = (await client.query(
    `select e.id from channel_events e where e.business_id = $1 and ${theirs}`,
    [businessId, hooks.map((i) => i.channel), hooks.map((i) => i.identity), inbound, sent])).rows;
  erase.set('channel_events', own);

  if (identityValues.size) {
    const carried = (await client.query(
      `select e.id, e.payload from channel_events e
        where e.business_id = $1 and not ${theirs} and e.payload::text like any($6::text[])`,
      [businessId, hooks.map((i) => i.channel), hooks.map((i) => i.identity), inbound, sent, likeAny(identityValues)])).rows
      .filter((r) => mentions(r.payload, identityValues));
    if (carried.length) {
      changes.push({
        table: 'channel_events', kind: 'prune', column: 'payload',
        items: carried.map((r) => ({ key: r.id, doc: pruneMentions(r.payload, identityValues) ?? marker })),
      });
    }
  }

  // ── channel_audit — the trail. ────────────────────────────────────────────
  // `send_refused` records who it was for ({ to }), `transcript_corrected`
  // records their words ({ before, after }), the allowlist records their
  // number. The entry stays — who did what, when, is the business's record —
  // and its detail is replaced when it names them or one of their rows: an
  // exact string anywhere in it, compared in the database, so a buyer with
  // thousands of messages is one hashed lookup per value rather than a scan.
  const theirValues = distinct([
    ...identityValues, ...conversationIds,
    ...ids('messages', 'id'), ...ids('outbound_messages', 'id'), ...ids('drafts', 'id'),
  ]);
  if (theirValues.length) {
    const trail = (await client.query(
      `select distinct a.id::text as id
         from channel_audit a
         cross join lateral jsonb_path_query(a.detail, 'strict $.**') v
        where a.business_id = $1 and a.detail is not null
          and jsonb_typeof(v) = 'string' and (v #>> '{}') = any($2::text[])`,
      [businessId, theirValues])).rows;
    if (trail.length) {
      changes.push({ table: 'channel_audit', kind: 'redact', column: 'detail', items: trail.map((r) => ({ key: r.id, doc: marker })) });
    }
  }

  // ── Worth a person's look before saying yes. ──────────────────────────────
  // The same person recorded twice in this business — a WhatsApp buyer and an
  // e-mail contact that became a second buyer row. Rows keyed by the identity
  // (contacts, consent) go with this request; the other buyer row's own
  // conversations are not this request's to erase.
  const others = (await client.query(
    `select distinct cl.id::text as id
       from clients cl
      where cl.business_id = $1 and cl.id <> $2 and (
            cl.phone = any($3::text[]) or lower(cl.email) = any($4::text[])
         or exists (select 1 from client_channels cc
                     where cc.client_id = cl.id
                       and exists (select 1 from unnest($5::text[], $6::text[]) as i(ch, v)
                                    where i.ch = cc.channel and i.v = cc.channel_user_id)))`,
    [businessId, clientId,
      identities.filter((i) => i.channel === 'whatsapp').map((i) => i.identity),
      identities.filter((i) => i.channel === 'email').map((i) => i.identity.toLowerCase()),
      identities.map((i) => i.channel), identities.map((i) => i.identity)])).rows.map((r) => r.id);

  // ── pgboss.job — queued and finished work. ────────────────────────────────
  // Inbound, outbound and notify jobs carry `conversationId`, and inbound ones
  // the buyer's own words; finished jobs are kept a week by pg-boss. Theirs
  // go. One a worker holds right now (`active`) cannot be taken from under it,
  // so the run refuses until it is done.
  const jobs = { erase: [], active: 0 };
  const boss = (await client.query("select to_regclass('pgboss.job') is not null as ok")).rows[0]?.ok;
  if (boss && conversationIds.length) {
    const rows = (await client.query(
      `select id::text as id, state::text as state from pgboss.job
        where data->>'businessId' = $1 and data->>'conversationId' = any($2::text[])`,
      [businessId, conversationIds])).rows;
    jobs.active = rows.filter((r) => r.state === 'active').length;
    jobs.erase = rows.filter((r) => r.state !== 'active').map((r) => r.id);
  }

  return { erase, changes, jobs, others };
}

/** Carry a plan out. Inside the caller's transaction; throws on any surprise. */
export async function executePlan(client, plan) {
  for (const s of plan.steps) {
    const r = await client.query(s.sql, s.params);
    if ((r.rowCount ?? 0) !== s.expect) {
      throw new Error(`${s.kind} on ${s.table} touched ${r.rowCount} rows where the plan said ${s.expect}. Rolled back; nothing changed.`);
    }
  }
}

/** What must be true after a run, judged by planning again. */
export function afterProblems(before, after) {
  const problems = [...after.refusals];
  if (after.totals.erased) problems.push(`${after.totals.erased} rows are still there to erase: ${list(after.erased)}`);
  if (after.totals.changed) problems.push(`${after.totals.changed} rows still carry them: ${list(after.changed)}`);
  if (after.pending) problems.push(`${after.pending} kept rows still hold personal fields`);
  for (const [t, n] of before.kept) {
    if ((after.kept.get(t) ?? 0) !== n) problems.push(`${t}: ${n} rows were to stay, ${after.kept.get(t) ?? 0} are there`);
  }
  return problems;
}

/** "messages 6, turns 3" — the closing note and the refusal messages. */
const list = (m) => [...m].filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => `${t} ${n}`).join(', ');

export function summaryNote(plan) {
  return [
    `erased ${plan.totals.erased}: ${list(plan.erased) || 'nothing'}`,
    `kept ${plan.totals.kept}: ${list(plan.kept) || 'nothing'}`,
    ...(plan.totals.changed ? [`changed in place ${plan.totals.changed}: ${list(plan.changed)}`] : []),
    'carried out with tools/erase-buyer.mjs',
  ].join(' · ');
}

// ─────────────────────────────────────────────────────────────────────────────
// The command.
// ─────────────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 24 * 3600_000;
/** Words an owner typed, printed on an operator's terminal: never its control sequences. */
const plain = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '?');

function printPlan(plan, rules = RULES) {
  const row = (n, t, says) => console.log(`  ${String(n).padStart(8)}  ${t}${says ? ` — ${says}` : ''}`);
  const section = (title, m, withSays) => {
    const rows = [...m].filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b));
    console.log(`  ${title}`);
    if (!rows.length) console.log('         —  nothing');
    for (const [t, n] of rows) row(n, t, withSays ? rules[t]?.says : null);
    console.log('');
  };
  section('ERASED', plan.erased, false);
  section('KEPT', plan.kept, true);
  if (plan.totals.changed) section('CHANGED IN PLACE', plan.changed, true);
  for (const n of plan.notes) console.log(`  !  ${n}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const has = (name) => args.includes(`--${name}`);
  const usage = (msg) => {
    console.error(`${msg}\n
  MIGRATE_DATABASE_URL=… node tools/erase-buyer.mjs --request <uuid>
  MIGRATE_DATABASE_URL=… node tools/erase-buyer.mjs --request <uuid> --yes --confirm <first 8 of the id> --by "<your name>"

  --request  the buyer's deletion request: an OPEN row in deletion_requests, scope 'buyer'
  --yes      actually erase. Without it this is a dry run and changes nothing.
  --confirm  the request id's first 8 characters (required with --yes)
  --by       who is carrying it out; recorded on the request (required with --yes)
`);
    process.exit(2);
  };

  const url = process.env['MIGRATE_DATABASE_URL'];
  if (!url) usage('MIGRATE_DATABASE_URL is not set. The app role cannot delete, and must not be used here.');
  const requestId = flag('request');
  if (!requestId || !UUID.test(requestId)) usage('--request must be a uuid.');
  const go = has('yes');
  const confirm = flag('confirm');
  const by = (flag('by') ?? '').trim();
  if (go && !confirm) usage('--yes needs --confirm <the first 8 characters of the request id>.');
  if (go && !by) usage('--yes needs --by "<your name>": it is recorded on the request as who carried it out.');
  if (by.length > 120) usage('--by is a name, 120 characters at most.');

  const refuse = (msg) => {
    console.error(`\n✗  ${msg}\n`);
    process.exitCode = 1;
  };

  // Five minutes for any one statement: the work is one transaction, and a
  // connection that stops answering must end it rather than hold it open.
  const client = toolClient(url, { replyTimeoutMs: 5 * 60_000 });
  try {
    await client.connect();

    // EVERY ROW OR NOTHING. A role that row security filters sees a buyer with
    // nothing to erase, and would close the request as done — the app role
    // (DATABASE_URL pasted by mistake) is exactly that role, and
    // shadow.turn_decisions forces row security even on its owner. So the
    // role must bypass it, and `row_security = off` turns any filtering this
    // check did not foresee into an error instead of an empty answer.
    const role = (await client.query(
      'select rolsuper or rolbypassrls as sees_all from pg_roles where rolname = current_user')).rows[0];
    if (!role?.sees_all) {
      return refuse('This database role is subject to row-level security, so it cannot see every row it must erase. '
        + 'Use the migration role (MIGRATE_DATABASE_URL), not the app\'s. Nothing was changed.');
    }
    await client.query('set row_security = off');

    const req = (await client.query(`
      select r.id::text as id, r.business_id::text as business_id, r.client_id::text as client_id,
             r.scope, r.state, r.asked_by, r.asked_at, r.subject_note, r.closed_at, r.closed_by, b.name
        from deletion_requests r join businesses b on b.id = r.business_id
       where r.id = $1`, [requestId])).rows[0];
    if (!req) return refuse(`No deletion request ${requestId}. Nothing was changed.`);
    if (req.scope !== 'buyer') {
      return refuse(`Request ${requestId} is for a whole workspace, not a buyer. tools/erase-workspace.mjs carries those out. Nothing was changed.`);
    }
    if (req.state !== 'open') {
      const when = req.closed_at ? ` on ${new Date(req.closed_at).toISOString().slice(0, 10)}` : '';
      return refuse(`Request ${requestId} is ${req.state}${when}${req.closed_by ? ` by ${plain(req.closed_by)}` : ''}, not open. `
        + 'Only an open request authorises an erasure. Nothing was changed.');
    }
    const buyer = (await client.query('select id::text as id, business_id::text as business_id from clients where id = $1',
      [req.client_id])).rows[0];
    if (!buyer || buyer.business_id !== req.business_id) {
      return refuse(`Request ${requestId} names a buyer who is not in ${plain(req.name)}. Nothing was changed.`);
    }

    const asked = new Date(req.asked_at);
    const due = new Date(asked.getTime() + 30 * DAY);
    const left = Math.ceil((due.getTime() - Date.now()) / DAY);
    console.log(`\n  ${plain(req.name)}`);
    console.log(`  buyer deletion request ${req.id}`);
    console.log(`  asked by ${plain(req.asked_by)} on ${asked.toISOString().slice(0, 10)} · due by ${due.toISOString().slice(0, 10)} `
      + `(${left >= 0 ? `${left} days left` : `${-left} days OVERDUE`})`);
    if (req.subject_note) console.log(`  they said: ${plain(req.subject_note)}`);

    const subject = { businessId: req.business_id, clientId: req.client_id, requestId: req.id };

    if (!go) {
      // A dry run cannot write, even by mistake: the database refuses it.
      await client.query('begin isolation level repeatable read read only');
      let plan;
      try {
        plan = await planErasure(client, subject);
      } finally {
        await client.query('rollback').catch(() => {});
      }
      if (plan.refusals.length) return refuse(`Cannot carry this out:\n   · ${plan.refusals.join('\n   · ')}`);
      console.log(`  identities: ${plan.identities.map((i) => `${i.channel} ${mask(i)}`).join(', ') || 'none left'}`);
      console.log(`  conversations: ${plan.conversations.total}, of which ${plan.conversations.shells} stay as empty shells\n`);
      printPlan(plan);
      console.log('  Dry run. Nothing was changed.');
      console.log(`  To carry it out:  --yes --confirm ${req.id.slice(0, 8)} --by "<your name>"\n`);
      return;
    }

    if (confirm.trim().toLowerCase() !== req.id.slice(0, 8).toLowerCase()) {
      return refuse('--confirm does not match the first 8 characters of this request id. Nothing was changed.');
    }

    // ONE transaction: half a buyer erased is worse than either end of it.
    // REPEATABLE READ, so the plan and the statements read one picture of the
    // database; the locks, so nothing writes about this buyer while it runs —
    // a message arriving now waits, then finds no conversation to join.
    await client.query('begin isolation level repeatable read');
    let plan;
    try {
      await client.query("set local lock_timeout = '15s'");
      const still = (await client.query(
        "select id from deletion_requests where id = $1 and state = 'open' for update", [req.id])).rows[0];
      if (!still) throw Object.assign(new Error('The request stopped being open while this ran. Nothing was changed.'), { refusal: true });
      await client.query('select id from clients where id = $1 for update', [req.client_id]);
      await client.query('select id from conversations where client_id = $1 for update', [req.client_id]);

      plan = await planErasure(client, subject);
      if (plan.refusals.length) {
        throw Object.assign(new Error(`Cannot carry this out:\n   · ${plan.refusals.join('\n   · ')}\n   Nothing was changed.`), { refusal: true });
      }
      if (plan.jobsActive > 0) {
        throw Object.assign(new Error(`A worker is handling this buyer right now (${plan.jobsActive} active). `
          + 'Run it again in a minute. Nothing was changed.'), { refusal: true });
      }
      console.log('');
      printPlan(plan);

      await executePlan(client, plan);
      const closed = await client.query(
        `update deletion_requests set state = 'done', closed_at = now(), closed_by = $2, closed_note = $3
          where id = $1 and state = 'open'`, [req.id, by, summaryNote(plan)]);
      if (closed.rowCount !== 1) throw new Error('The request could not be closed. Rolled back; nothing changed.');

      // Plan again, in the same transaction: nothing left to erase, nothing
      // kept lost. Only then commit.
      const after = await planErasure(client, subject, { identities: plan.identities });
      const wrong = afterProblems(plan, after);
      if (wrong.length) throw new Error(`After the erasure the database is not what the plan said:\n   · ${wrong.join('\n   · ')}\n   Rolled back; nothing changed.`);

      // The audit trail has no verb for a carried-out deletion (0064 added
      // 'deletion_requested' and 'deletion_withdrawn' only) and this tool adds
      // no migration, so the closed request is the record: state, when, by
      // whom, and the counts in closed_note.
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      if (e && e.refusal) return refuse(e.message);
      // Both mean somebody else was at these rows at the same moment; neither
      // left anything half done.
      if (e && e.code === '40001') {
        return refuse("Something changed this buyer's rows while the tool ran. Nothing was changed; run it again.");
      }
      if (e && e.code === '55P03') {
        return refuse('Their rows are locked by something else right now — the app in the middle of a reply, perhaps. '
          + 'Nothing was changed; run it again in a minute.');
      }
      throw e;
    }

    // Anything that wrote about them while the transaction ran (it waited on
    // the locks) shows up here — the buyer writing again at that very moment.
    await client.query('begin isolation level repeatable read read only');
    try {
      const late = await planErasure(client, subject, { identities: plan.identities });
      if (late.totals.erased || late.totals.changed) {
        console.error(`\n!  Something wrote about this buyer while the erasure ran: ${[list(late.erased), list(late.changed)].filter(Boolean).join(', ')}.`
          + '\n   Look before doing anything: if they wrote again, that is a new conversation, and whether it goes too'
          + '\n   is the owner\'s to decide — with a new request.\n');
      }
    } finally {
      await client.query('rollback').catch(() => {});
    }

    console.log(`✓  ${plain(req.name)}: buyer erased — ${plan.totals.erased} rows erased, ${plan.totals.kept} kept`
      + `${plan.totals.changed ? `, ${plan.totals.changed} changed in place` : ''}.`);
    console.log(`   Request ${req.id} is closed as done, by ${plain(by)}.`);
    console.log('   Tell the owner; confirming to the buyer is theirs. Backups age out on their own schedule.\n');
  } catch (e) {
    console.error(`\n✗  ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) await main();
