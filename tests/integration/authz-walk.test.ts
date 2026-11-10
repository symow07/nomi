import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import pg from 'pg';
import { demoSeedSql } from '../../src/demo/factory.js';
import { ensureQueueSchema } from './tenant.js';
import { purgeBusinesses } from './books-db.js';

/**
 * The authorization audit (Block 7) — WORKSPACE A'S OWNER, EVERY ROUTE, WORKSPACE B'S IDS. STATE, NOT STATUS.
 *
 * Signed in as A's owner (the most a session can do), the web app's routes are called with B's ids, and what is
 * judged is what the DATABASE holds afterwards, never what a route answered. Five passes:
 *
 *   1. every route, each of B's ids in every path parameter, every id field and the query (urlencoded; GET by query);
 *   2. the same as JSON, for every route that takes a body;
 *   3. multipart, for every route whose handler reads a file, with a small file and the fields it reads;
 *   4. ONE OF B'S IDS AMONG A'S OWN: for each id field a handler reads (by its own source), that field is one of B's
 *      ids of the matching table and every other id is A's own, with plain values in the words a form wants first —
 *      a route that needs A's own account beside B's journal line now reaches the line (the bank match, finding 1);
 *   5. A'S REAL FORMS: A's pages are crawled while A is intact, every form found is submitted as drawn, with one
 *      id-holding field (or an id in its address) swapped for each of B's ids of the same table.
 *
 * An id field is any field the audit's list names, any name ending in `Id`/`_id` that src/api spells, `reading`, and
 * any form field that holds a UUID. Then, over the database:
 *
 *   a. B is untouched — every row of every table that holds B's workspace, and every row of a table that hangs off
 *      one of them by a key (messages, price tiers …), reads byte for byte as before;
 *   b. no A row holds any of B's ids — anywhere in the row, key or text or JSON (`assigned_to`, an event's payload);
 *   c. no single-column key between two workspace tables points from A to B or back;
 *   d. nothing of B is shown — B's rows carry a marker in their words, and no body or redirect contains it;
 *   e. no route answered 5xx.
 *
 * What it still cannot see: a value no form of A draws and no handler names (a typed confirmation of a name it does not
 * know), the public token pages and the web chat, the signed provider webhooks, and providers this composition does
 * not configure. Those are named in the audit's report.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, '').slice(0, 7);
const NS_A = `a${RUN}`;
const NS_B = `b${RUN}`;
const A = `${NS_A}-0000-4000-8000-0000000000b1`;
const B = `${NS_B}-0000-4000-8000-0000000000b1`;
const A_CONV = `${NS_A}-0000-4000-8000-000000000301`;
const MARK = `zqb${RUN}`;
const A_MARK = `zqa${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const CODE = `authz-walk-${RUN}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Every form field name src/api reads that can carry an id (the audit's field list, 2026-11-11), and `reading`. */
const LISTED_ID_FIELDS = ['account', 'account_id', 'assistant', 'back', 'category', 'clientId', 'conversationId', 'draftId', 'entry', 'entryId',
  'id', 'ids', 'import', 'importId', 'invoice', 'invoiceId', 'item', 'itemId', 'journal', 'journalLine', 'label', 'labelId', 'line',
  'match', 'messageId', 'number_id', 'orderId', 'page_id', 'party', 'partyId', 'payFrom', 'pay_from', 'person', 'personId', 'photo',
  'product', 'productId', 'proposal', 'proposalId', 'quoteId', 'realmId', 'recurring', 'request', 'requestId', 'run', 'runId',
  'scenarioId', 'sequence', 'source', 'sourceId', 'subscription', 'supplier', 'supplierId', 'tax', 'taxCode', 'tax_code', 'thread',
  'to', 'waba_id', 'year', 'category_id', 'party_id', 'tax_code_id', 'substitute', 'substituteId', 'procedure', 'case', 'check', 'reading'];
/** Plain values, so a route that wants words before it reads an id gets as far as the id (a name, a floor, a rate …). */
const WORDS: Record<string, string> = {
  confirm: 'yes', note: 'authz', text: 'authz', content: 'authz', reply: 'authz', title: 'authz', kind: 'faq', body: 'authz', amount: '1',
  date: '2026-04-20', name: 'Authz Walk', price: '3', floor: '0.5', maxDiscountPct: '10', askAbovePct: '5', rate: '7', level: 'sells',
  phone: '+971500009999', domain: 'example.com', selector: 's1', which: 'owner_ready', channel: 'whatsapp', enabled: 'true',
  locale: 'en', tone: 'plain', length: 'short', emoji: 'never', gross: '100', label_text: 'authz', quantity: '1', minQty: '10',
};
/** The table an id field names, where the field's name says it. A field not here takes any of B's ids. */
const FIELD_TABLES: Record<string, readonly string[]> = {
  account: ['accounts'], account_id: ['accounts'], payFrom: ['accounts'], pay_from: ['accounts'],
  line: ['statement_lines'], journalLine: ['journal_lines'], match: ['statement_matches'],
  category: ['spending_categories'], category_id: ['spending_categories'],
  party: ['parties'], partyId: ['parties'], party_id: ['parties'], supplier: ['parties'], supplierId: ['parties'],
  tax: ['tax_codes'], taxCode: ['tax_codes'], tax_code: ['tax_codes'], tax_code_id: ['tax_codes'],
  journal: ['journals'], year: ['fiscal_years'], entry: ['journal_entries'], entryId: ['journal_entries'],
  invoice: ['invoices'], invoiceId: ['invoices'], recurring: ['recurring_costs'],
  clientId: ['clients'], conversationId: ['conversations'], draftId: ['drafts'], messageId: ['messages'], orderId: ['orders'],
  label: ['labels'], labelId: ['labels'], person: ['people'], personId: ['people'], to: ['people'], substitute: ['people'], substituteId: ['people'],
  assistant: ['assistants'], product: ['products'], productId: ['products'], quoteId: ['quotes'],
  proposal: ['knowledge_proposals', 'order_proposals', 'spending_proposals'], proposalId: ['knowledge_proposals', 'order_proposals', 'spending_proposals'],
  import: ['catalog_imports', 'contact_imports', 'statement_imports'], importId: ['catalog_imports', 'contact_imports'],
  sequence: ['sequences'], procedure: ['procedures'], case: ['case_checks'], check: ['case_checks'], subscription: ['push_subscriptions'],
  request: ['deletion_requests'], requestId: ['deletion_requests'], photo: ['product_images'],
};
/**
 * For "one of B's among A's own": which of A's seeded rows an id field names by default. Where a harmless swap can
 * USE A's row (B's id in `account` only steers the bank match's redirect, so A's own line is matched), each swapped
 * field takes its own copy: the k-th swap of a route uses the k-th (the bank lines: three pairs).
 */
const FIELD_OWN: Record<string, string | readonly string[]> = {
  account: 'bank', account_id: 'bank', payFrom: 'bank', pay_from: 'bank',
  line: ['stmtLine', 'stmtLine2', 'stmtLine3'], journalLine: ['jline', 'jline_2', 'jline_3'],
  category: 'category', category_id: 'category', party: 'party', partyId: 'party', party_id: 'party', supplier: 'party', supplierId: 'party',
  tax: 'tax', taxCode: 'tax', tax_code: 'tax', tax_code_id: 'tax', journal: 'journal', year: 'fy', entry: 'entry', entryId: 'entry',
  invoice: 'invoice', invoiceId: 'invoice', clientId: 'client', conversationId: 'conv', draftId: 'draft', orderId: 'order', label: 'label',
  labelId: 'label', person: 'person', personId: 'person', to: 'person', assistant: 'assistant', product: 'product', productId: 'product',
  quoteId: 'quote', sequence: 'sequence', procedure: 'procedure', subscription: 'phone', importId: 'catalogImport', import: 'catalogImport',
};

/** Every name ending in `Id` / `_id` that src/api spells as a string: a form or query field it may read. */
const spelledIdFields = (): string[] => {
  const out = new Set<string>();
  const walkDir = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walkDir(p);
      else if (p.endsWith('.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/['"`]([A-Za-z][A-Za-z0-9_]*(?:Id|_id))['"`]/g)) out.add(m[1]!);
    }
  };
  walkDir(join(process.cwd(), 'src', 'api'));
  return [...out];
};

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? unescape(m[2] ?? m[3] ?? '') : null;
};
type Form = { action: string; fields: [string, string][] };
/** The POST forms of a page, as a browser would send them (urlencoded ones; a file form is the multipart pass's). */
const formsIn = (html: string): Form[] => {
  const out: Form[] = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const head = m[1]!; const inner = m[2]!;
    if ((attr(head, 'method') ?? 'get').toLowerCase() !== 'post') continue;
    if (/multipart/i.test(attr(head, 'enctype') ?? '')) continue;
    const fields: [string, string][] = [];
    for (const i of inner.matchAll(/<input\b([^>]*)>/gi)) {
      const name = attr(i[1]!, 'name'); const type = (attr(i[1]!, 'type') ?? 'text').toLowerCase();
      if (!name || type === 'file' || type === 'submit') continue;
      if ((type === 'checkbox' || type === 'radio') && fields.some(([n]) => n === name)) continue;
      fields.push([name, attr(i[1]!, 'value') ?? (type === 'checkbox' ? 'on' : '')]);
    }
    for (const s of inner.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
      const name = attr(s[1]!, 'name'); if (!name) continue;
      const opts = [...s[2]!.matchAll(/<option\b([^>]*)>/gi)].map((o) => o[1]!);
      const pick = opts.find((o) => /\bselected\b/i.test(o) && attr(o, 'value')) ?? opts.find((o) => attr(o, 'value'));
      fields.push([name, pick ? attr(pick, 'value')! : '']);
    }
    for (const t of inner.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
      const name = attr(t[1]!, 'name'); if (name) fields.push([name, unescape(t[2]!) || 'authz']);
    }
    const buttons = [...inner.matchAll(/<button\b([^>]*)>/gi)].map((b) => b[1]!);
    const named = buttons.find((b) => attr(b, 'name'));
    if (named) fields.push([attr(named, 'name')!, attr(named, 'value') ?? '']);
    const action = attr(head, 'action');
    if (action) out.push({ action, fields });
    for (const b of buttons) { const fa = attr(b, 'formaction'); if (fa) out.push({ action: fa, fields }); }
  }
  return out;
};

const multipart = (fields: Record<string, string>, file: { field: string; name: string; type: string; bytes: Buffer }) => {
  const boundary = `----authzwalk${RUN}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${file.field}"; filename="${file.name}"\r\ncontent-type: ${file.type}\r\n\r\n`), file.bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CSV = Buffer.from('date,amount,label\n2026-04-20,100,authz\n');

d('Authorization audit · A\'s owner on every route with B\'s ids (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 1_800_000 }, () => {
  let admin: pg.Client;
  let db: import('../../src/db/client.js').Db;
  let app: import('fastify').FastifyInstance;
  let cookie = '';
  const routes: { method: string; url: string; source: string }[] = [];
  let ids: { table: string; id: string }[] = [];
  const bByTable = new Map<string, string[]>();
  const aTableOf = new Map<string, string>();
  let seededA: Record<string, string> = {};
  let before = new Map<string, string>();
  let heldBefore = new Map<string, number>();
  const heldShapes = new Map<string, string[]>();
  let scopes: { table: string; where: string }[] = [];
  let idFields: string[] = [];
  const shown: string[] = [];
  const failures: string[] = [];
  const errors: string[] = [];
  const statuses = new Map<number, number>();
  const passCalls: Record<string, number> = {};
  let calls = 0; let relogins = 0;
  let pass = '';

  /** Every table that holds a workspace, and every table that hangs off one of them by a key, with how to read W's rows. */
  const readScopes = async () => {
    const direct = (await admin.query(`select c.relname as t from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') order by 1`)).rows.map((r) => r.t as string);
    const hasBiz = new Set(direct);
    const kids = (await admin.query(`
      select con.conrelid::regclass::text as child, a.attname as col, con.confrelid::regclass::text as parent, pa.attname as pcol
        from pg_constraint con join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
        join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = con.confkey[1]
        join pg_class c on c.oid = con.conrelid
       where con.contype = 'f' and array_length(con.conkey, 1) = 1 and c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
       order by 1, 2`)).rows as { child: string; col: string; parent: string; pcol: string }[];
    const byKid = new Map<string, string[]>();
    for (const k of kids) {
      if (hasBiz.has(k.child) || !hasBiz.has(k.parent)) continue;
      byKid.set(k.child, [...(byKid.get(k.child) ?? []), `${k.col} in (select ${k.pcol} from ${k.parent} where business_id = $1)`]);
    }
    return [...direct.map((t) => ({ table: t, where: 'business_id = $1' })), ...[...byKid].map(([t, w]) => ({ table: t, where: w.join(' or ') }))];
  };
  const snapshot = async (w: string): Promise<Map<string, string>> => {
    const out = new Map<string, string>();
    for (const s of scopes) {
      const r = (await admin.query(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h, count(*)::int as n from ${s.table} x where ${s.where}`, [w])).rows[0];
      out.set(s.table, `${r.n}:${r.h}`);
    }
    return out;
  };
  /** How many of A's rows hold any of B's ids, by `table.column` (a JSON column by the column), anywhere in the row. */
  const heldByA = async (): Promise<Map<string, number>> => {
    const any = `(${[...new Set(ids.map((i) => i.id).concat([...bByTable.values()].flat()))].join('|')})`;
    const out = new Map<string, number>();
    for (const s of scopes) {
      for (const r of (await admin.query(`select k.key as col, count(*)::int as n, array_agg(distinct regexp_replace(k.value, '[0-9a-f]{8}-[0-9a-f-]{27}', 'U', 'gi')) as v
          from ${s.table} x cross join lateral jsonb_each_text(to_jsonb(x)) k
          where (${s.where}) and k.value ~* $2 group by k.key`, [A, any])).rows) {
        out.set(`${s.table}.${r.col as string}`, r.n as number);
        heldShapes.set(`${s.table}.${r.col as string}`, (r.v as string[]).slice(0, 12).map((x) => x.slice(0, 160)));
      }
    }
    return out;
  };

  /** S1's inventory, read from the catalogue: single-column keys between two workspace tables. Rows of A naming B's, or B's naming A's. */
  const crossings = async (): Promise<string[]> => {
    const keys = (await admin.query(`
      with scoped as (select c.oid from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
                        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped))
      select con.conrelid::regclass::text as child, a.attname as col, con.confrelid::regclass::text as parent, pa.attname as pcol
        from pg_constraint con join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
        join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = con.confkey[1]
       where con.contype = 'f' and array_length(con.conkey, 1) = 1
         and con.conrelid in (select oid from scoped) and con.confrelid in (select oid from scoped)`)).rows as { child: string; col: string; parent: string; pcol: string }[];
    const out: string[] = [];
    for (const k of keys) {
      const n = (await admin.query(`select count(*)::int as n from ${k.child} c join ${k.parent} p on p.${k.pcol} = c.${k.col}
        where c.business_id <> p.business_id and c.business_id in ($1, $2) and p.business_id in ($1, $2)`, [A, B])).rows[0].n as number;
      if (n > 0) out.push(`${k.child}.${k.col} → ${k.parent}: ${n}`);
    }
    return out;
  };

  /** A workspace's extra rows, beyond the demo: one of each kind a route takes an id of, the books included. Each alone. */
  const seedWorkspace = async (ns: string, w: string, mark: string): Promise<Record<string, string>> => {
    const v: Record<string, string> = { W: w, conv: `${ns}-0000-4000-8000-000000000301`, client: `${ns}-0000-4000-8000-000000000201`,
      product: `${ns}-0000-4000-8000-000000000101`, MARK: mark };
    const one = async (name: string, text: string): Promise<string | null> => {
      try {
        const r = await admin.query(text.replace(/\$(\w+)/g, (_m, k: string) => (v[k] !== undefined ? `'${v[k]}'` : `$${k}`)));
        const id = r.rows[0]?.id as string | undefined;
        if (id) v[name] = id;
        return id ?? null;
      } catch (e) { failures.push(`seed ${w === B ? 'B' : 'A'} ${name}: ${(e as Error).message}`); return null; }
    };
    await one('mark', `update businesses set name = name || ' ' || $MARK where id = $W returning id::text as id`);
    await admin.query(`update products set name = name || ' ' || '${mark}' where business_id = '${w}'`);
    await admin.query(`update clients set display_name = display_name || ' ' || '${mark}' where business_id = '${w}'`);
    await admin.query(`update messages set text_content = text_content || ' ' || '${mark}' where conversation_id in (select id from conversations where business_id = '${w}')`);
    await one('person', `insert into people (business_id, name, is_owner) values ($W, 'Staff ' || $MARK, false) returning id::text as id`);
    await one('assistant', `insert into assistants (business_id, name, is_default) values ($W, 'Second ' || $MARK, false) returning id::text as id`);
    await one('quote', `insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version) values ($W, $conv, $product, 10, '{}', 2, 20, 'authz') returning id::text as id`);
    await one('draft', `insert into drafts (business_id, conversation_id, capability, draft_text) values ($W, $conv, 'quote', 'Draft ' || $MARK) returning id::text as id`);
    await one('outbound', `insert into outbound_messages (business_id, conversation_id, seq, body) values ($W, $conv, 1, 'Sent ' || $MARK) returning id::text as id`);
    await one('order', `insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit) values ('AZ-' || $MARK, $W, $client, $conv, $product, 10, 'pcs') returning id::text as id`);
    await one('sample', `insert into sample_requests (business_id, conversation_id, asked_text) values ($W, $conv, 'Sample ' || $MARK) returning id::text as id`);
    await one('label', `insert into labels (business_id, name, created_by) values ($W, 'Label ' || $MARK, 'owner') returning id::text as id`);
    await one('buyerLabel', `insert into buyer_labels (business_id, client_id, label_id, added_by) values ($W, $client, $label, 'owner') returning id::text as id`);
    await one('calendar', `insert into calendar_entries (business_id, title, starts_at) values ($W, 'Entry ' || $MARK, now() + interval '1 day') returning id::text as id`);
    await one('closure', `insert into factory_closures (business_id, label, starts_on, ends_on) values ($W, 'Closed ' || $MARK, current_date + 30, current_date + 31) returning id::text as id`);
    await one('term', `insert into forbidden_terms (business_id, term) values ($W, 'term' || $MARK) returning id::text as id`);
    await one('knowledge', `insert into product_knowledge (business_id, product_id, kind, label, content) values ($W, $product, 'faq', 'Fact', 'Fact ' || $MARK) returning id::text as id`);
    await one('sequence', `insert into sequences (business_id, name, created_by) values ($W, 'Seq ' || $MARK, 'owner') returning id::text as id`);
    await one('step', `insert into sequence_steps (business_id, sequence_id, position, delay_days, subject, body) values ($W, $sequence, 1, 1, 'Hi', 'Step ' || $MARK) returning id::text as id`);
    await one('procedure', `insert into procedures (business_id, title, steps) values ($W, 'Proc ' || $MARK, '[{"text":"ask the address","kind":"do"}]') returning id::text as id`);
    await one('saved', `insert into saved_replies (business_id, title, texts, created_by) values ($W, 'Saved ' || $MARK, '{"en":"Saved"}', 'owner') returning id::text as id`);
    await one('note', `insert into conversation_notes (business_id, conversation_id, note) values ($W, $conv, 'Note ' || $MARK) returning id::text as id`);
    await one('handoff', `insert into handoffs (business_id, conversation_id, reason, sla_deadline_at) values ($W, $conv, 'human_requested', now() + interval '1 hour') returning id::text as id`);
    await one('signal', `insert into conversation_signals (business_id, conversation_id, kind) values ($W, $conv, 'human_requested') returning id::text as id`);
    await one('promise', `insert into promised_dates (business_id, conversation_id, kind, due_on, said, said_by) values ($W, $conv, 'delivery', current_date + 3, 'By Friday ' || $MARK, 'person') returning id::text as id`);
    await one('spot', `insert into spot_checks (business_id, conversation_id, capability) values ($W, $conv, 'quote') returning id::text as id`);
    await one('phone', `insert into push_subscriptions (business_id, person_id, endpoint, p256dh, auth) values ($W, $person, 'https://push.invalid/' || $MARK, repeat('k', 87), repeat('a', 22)) returning id::text as id`);
    await one('proposal', `insert into knowledge_proposals (business_id, source, lines, created_by) values ($W, 'https://example.invalid', '[{"key":"k1","fact":"Fact ${mark}"}]', 'owner') returning id::text as id`);
    await one('catalogImport', `insert into catalog_imports (business_id, kind, currency) values ($W, 'paste', 'USD') returning id::text as id`);
    await one('contactImport', `insert into contact_imports (business_id, source, cells, mapping) values ($W, 'paste', '[["a@b.c"]]', '{}') returning id::text as id`);
    await one('orderProposal', `insert into order_proposals (business_id, conversation_id, client_id, product_id, quantity, unit, unit_price, total, currency) values ($W, $conv, $client, $product, 10, 'pcs', 2, 20, 'USD') returning id::text as id`);
    await one('deletionAsk', `insert into deletion_asks (business_id, client_id, conversation_id, asked_at) values ($W, $client, $conv, now()) returning id::text as id`);
    // The books: a chart's bank, receivable, expense and income accounts, a journal, a year, a posted entry on the bank,
    // a party, a tax code, a category, an invoice — and a statement line on the bank account of the posted amount, so the
    // bank page offers the match (A's own form, which pass 5 submits with B's journal line).
    await admin.query(`update businesses set books_area = true, country = 'MA', currency = 'MAD' where id = '${w}'`);
    await one('bank', `insert into accounts (business_id, code, name, kind) values ($W, '5141', 'Bank ' || $MARK, 'asset') returning id::text as id`);
    await one('receivable', `insert into accounts (business_id, code, name, kind) values ($W, '3421', 'Customers ' || $MARK, 'asset') returning id::text as id`);
    await one('expense', `insert into accounts (business_id, code, name, kind) values ($W, '6111', 'Costs ' || $MARK, 'expense') returning id::text as id`);
    await one('income', `insert into accounts (business_id, code, name, kind) values ($W, '7111', 'Sales ' || $MARK, 'income') returning id::text as id`);
    await one('journal', `insert into journals (business_id, code, name, kind) values ($W, 'BQ', 'Banque', 'bank') returning id::text as id`);
    await one('fy', `insert into fiscal_years (business_id, starts_on, ends_on) values ($W, '2026-01-01', '2026-12-31') returning id::text as id`);
    await one('entry', `insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values ($W, $journal, $fy, '2026-04-19', 'Entry ' || $MARK, 'owner') returning id::text as id`);
    await one('jline', `insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values ($W, $entry, 1, $bank, 'MAD', 100, 0) returning id::text as id`);
    await one('jline2', `insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values ($W, $entry, 2, $receivable, 'MAD', 0, 100) returning id::text as id`);
    await one('posted', `update journal_entries set state = 'posted', posted_by = 'owner', document_ref = 'F-1', document_date = entry_date where id = $entry returning id::text as id`);
    await one('draftEntry', `insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values ($W, $journal, $fy, '2026-04-20', 'Draft entry ' || $MARK, 'owner') returning id::text as id`);
    await one('party', `insert into parties (business_id, kind, code, name) values ($W, 'customer', 'C-' || $MARK, 'Party ' || $MARK) returning id::text as id`);
    await one('tax', `insert into tax_codes (business_id, code, label, rate, kind, account_id, valid_from) values ($W, 'T20', 'Tax ' || $MARK, 20, 'collected', $receivable, '2026-01-01') returning id::text as id`);
    await one('category', `insert into spending_categories (business_id, name, account_id) values ($W, 'Cat ' || $MARK, $expense) returning id::text as id`);
    await one('invoice', `insert into invoices (business_id, party_id, issue_date, currency, label, created_by) values ($W, $party, '2026-04-20', 'MAD', 'Invoice ' || $MARK, 'owner') returning id::text as id`);
    await one('stmtImport', `insert into statement_imports (business_id, account_id, format, sha256, added, refused, imported_by) values ($W, $bank, 'csv', md5($MARK) || md5($MARK), 1, 0, 'owner') returning id::text as id`);
    await one('stmtLine', `insert into statement_lines (business_id, import_id, account_id, booked_on, amount, currency, wording, fingerprint) values ($W, $stmtImport, $bank, '2026-04-20', 100, 'MAD', 'Wire ' || $MARK, $MARK) returning id::text as id`);
    // Two more posted bank lines, each with its statement line: a copy for each swap of the bank match's fields.
    for (const [n, amount] of [[2, 101], [3, 102]] as const) {
      await one(`entry${n}`, `insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values ($W, $journal, $fy, '2026-04-19', 'Entry ${n} ' || $MARK, 'owner') returning id::text as id`);
      await one(`jline_${n}`, `insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values ($W, $entry${n}, 1, $bank, 'MAD', ${amount}, 0) returning id::text as id`);
      await one(`jline2_${n}`, `insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values ($W, $entry${n}, 2, $receivable, 'MAD', 0, ${amount}) returning id::text as id`);
      await one(`posted${n}`, `update journal_entries set state = 'posted', posted_by = 'owner', document_ref = 'F-${n}', document_date = entry_date where id = $entry${n} returning id::text as id`);
      await one(`stmtLine${n}`, `insert into statement_lines (business_id, import_id, account_id, booked_on, amount, currency, wording, fingerprint) values ($W, $stmtImport, $bank, '2026-04-20', ${amount}, 'MAD', 'Wire ${n} ' || $MARK, $MARK || '-${n}') returning id::text as id`);
    }
    return v;
  };

  /** One row of every table W has rows in (and W's messages), up to `per` a table. */
  const idsOf = async (w: string, per: number) => {
    const out: { table: string; id: string }[] = [];
    for (const s of scopes) {
      const hasId = (await admin.query(`select 1 from pg_attribute where attrelid = $1::regclass and attname = 'id' and atttypid = 'uuid'::regtype and not attisdropped`, [s.table])).rowCount;
      if (!hasId) continue;
      for (const r of (await admin.query(`select id::text as id from ${s.table} x where ${s.where} order by id limit ${per}`, [w])).rows) out.push({ table: s.table, id: r.id as string });
    }
    return out;
  };

  const look = (where: string, res: { body: string; headers: Record<string, unknown>; statusCode: number }) => {
    calls++; passCalls[pass] = (passCalls[pass] ?? 0) + 1;
    statuses.set(res.statusCode, (statuses.get(res.statusCode) ?? 0) + 1);
    if (res.statusCode >= 500) errors.push(`${pass}: ${where} → ${res.statusCode}`);
    const text = `${res.body}\n${String(res.headers['location'] ?? '')}`;
    if (text.includes(MARK)) shown.push(`${pass}: ${where}`);
  };
  const signIn = async () => {
    const login = await app.inject({ method: 'POST', url: '/login', payload: `code=${CODE}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    cookie = ([] as string[]).concat((login.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  };
  /** One call, judged; a walk that signed itself out (a password changed, a session ended) signs in again and calls once more. */
  type Body = { kind: 'form'; data: string } | { kind: 'json'; data: string } | { kind: 'multipart'; data: Buffer; type: string } | null;
  const call = async (method: string, url: string, body: Body, where: string) => {
    const go = () => app.inject({ method: method as 'POST', url, headers: { cookie,
      ...(body ? { 'content-type': body.kind === 'form' ? 'application/x-www-form-urlencoded' : body.kind === 'json' ? 'application/json' : body.type } : {}) },
      ...(body ? { payload: body.data } : {}) });
    let res = await go();
    if (res.statusCode >= 300 && res.statusCode < 400 && String(res.headers['location'] ?? '').startsWith('/login')) { relogins++; await signIn(); res = await go(); }
    look(where, res);
    return res;
  };
  const urlencoded = (o: Record<string, string>) => new URLSearchParams(o).toString();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    await ensureQueueSchema();
    await admin.query(demoSeedSql(NS_A));
    await admin.query(demoSeedSql(NS_B));
    scopes = await readScopes();
    seededA = await seedWorkspace(NS_A, A, A_MARK);
    const seededB = await seedWorkspace(NS_B, B, MARK);
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    app = Fastify({ logger: false });
    app.addHook('onRoute', (r) => { for (const m of ([] as string[]).concat(r.method as string | string[])) routes.push({ method: m, url: r.url, source: String(r.handler) }); });
    registerWebApp(app, {
      db, businessId: A, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
      // The Copilot's read-only port, so its summary reads (it answered 503 without one, and a 5xx now fails the walk);
      // and the domain check's lookup, which production always passes (no network here: every record reads as absent).
      advisorDb: db, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    await signIn();
    expect(cookie).not.toBe('');
    ids = await idsOf(B, 2);
    for (const r of await idsOf(B, 6)) bByTable.set(r.table, [...new Set([...(bByTable.get(r.table) ?? []), r.id])]);
    // The seeded rows of B by table, whatever their order: the expense account, the posted bank line …
    for (const r of (await idsOf(B, 1000))) if (Object.values(seededB).includes(r.id)) bByTable.set(r.table, [...new Set([...(bByTable.get(r.table) ?? []), r.id])]);
    for (const r of await idsOf(A, 1000)) aTableOf.set(r.id, r.table);
    idFields = [...new Set([...LISTED_ID_FIELDS, ...spelledIdFields()])];
    before = await snapshot(B);
    heldBefore = await heldByA();
  }, 300_000);
  afterAll(async () => {
    await app?.close(); await db?.destroy();
    // Orders keep their workspace (no cascade): where the purge is refused, the two workspaces stay — the isolated run's
    // database is removed with them, and nothing here reads another run's rows.
    await purgeBusinesses(admin, [A, B], 'authz-walk-test').catch(async () => { await admin.query('rollback'); });
    await admin?.end();
  });

  it('A and B were seeded with rows in the tables the routes take ids of', () => {
    expect(failures, failures.join('\n')).toEqual([]);
    const tables = new Set(ids.map((i) => i.table));
    for (const t of ['conversations', 'clients', 'products', 'drafts', 'quotes', 'orders', 'labels', 'journal_lines', 'journal_entries', 'statement_lines',
      'invoices', 'spending_categories', 'people', 'assistants', 'sequences', 'product_knowledge', 'calendar_entries', 'messages']) {
      expect(tables.has(t), t).toBe(true);
    }
    expect(heldBefore.size, `A's rows hold B's ids before the walk:\n${[...heldBefore].join('\n')}`).toBe(0);
  });

  it('every route, B\'s ids alone and among A\'s own, as a form, JSON, multipart and A\'s real forms: B untouched, A holds nothing of B\'s, nothing points across, nothing of B shown, no 5xx', async () => {
    const skip = /^\/(logout|login|signup|verify|hooks|webhooks|u$|p\/|pi\/|inv\/|media\/|chat\/|catalogue-media\/|assets|favicon|sw\.js|manifest)/;
    const walk = routes.filter((r) => !skip.test(r.url) && !r.url.includes('*') && r.method !== 'HEAD' && r.method !== 'OPTIONS');
    const allB = ids.map((i) => i.id);
    const bOf = (tables: readonly string[] | undefined): string[] => tables ? [...new Set(tables.flatMap((t) => bByTable.get(t) ?? []))] : allB;
    const ownOf = (field: string, copy = 0): string | undefined => {
      const all = FIELD_OWN[field]; const k = typeof all === 'string' || all === undefined ? all : all[copy % all.length];
      return k === 'conv' ? A_CONV : k ? seededA[k] : undefined;
    };
    /** A path parameter of A's own: by its name, else by the table its segment names (`/categories/:id` → spending_categories). */
    const ownParam = (url: string, name: string): string | undefined => {
      const byName = ownOf(name); if (byName) return byName;
      const seg = url.split('/:' + name)[0]!.split('/').pop() ?? '';
      const stem = seg.replace(/ies$/, '').replace(/s$/, '').replace(/-/g, '_');
      if (stem.length < 3) return undefined;
      const tables = [...new Set(aTableOf.values())].filter((t) => t.includes(stem)).sort((x, y) => x.length - y.length);
      for (const t of tables) for (const [id, tt] of aTableOf) if (tt === t) return id;
      return undefined;
    };
    const fillAll = (url: string, id: string, keepConversation = false) => {
      let first = true;
      return url.replace(/:(\w+)/g, (_m, name: string) => { const was = first; first = false; return keepConversation && was && /conversation/i.test(name) ? A_CONV : id; });
    };
    const read = (src: string, f: string) => new RegExp(`['"\`]${f}['"\`]|\\b${f}\\??:|\\.${f}\\b`).test(src);
    const formOf = (id: string): Record<string, string> => { const o: Record<string, string> = { ...WORDS }; for (const f of idFields) o[f] = id; return o; };

    // ── 5. A's real forms, crawled first, while A is whole ────────────────────────────────────────────────────────
    pass = 'forms';
    const pages = new Set<string>(); const queue: string[] = [];
    const ownQuery = urlencoded(Object.fromEntries(Object.keys(FIELD_OWN).map((f) => [f, ownOf(f) ?? '']).filter(([, v]) => v)));
    for (const r of walk.filter((x) => x.method === 'GET')) {
      if (!r.url.includes(':')) { queue.push(r.url, `${r.url}?${ownQuery}`); continue; }
      const filled = r.url.replace(/:(\w+)/g, (_m, name: string) => ownParam(r.url, name) ?? '');
      if (!/\/\//.test(filled) && !filled.endsWith('/')) queue.push(filled);
    }
    const forms: Form[] = [];
    const copies = new Map<string, Form[]>();
    while (queue.length && pages.size < 1500) {
      const url = queue.shift()!;
      if (pages.has(url) || /\.(csv|xlsx|zip|pdf|json)(\?|$)/.test(url)) continue;
      pages.add(url);
      const res = await call('GET', url, null, `GET ${url}`);
      if (res.statusCode !== 200 || !String(res.headers['content-type'] ?? '').includes('html')) continue;
      for (const f of formsIn(res.body)) {
        if (!f.action.startsWith('/app') && !f.action.startsWith('/login/') ) continue;
        const key = `${f.action.replace(UUID_IN, ':u')} ${f.fields.map(([n]) => n).sort().join(',')}`;
        const got = copies.get(key) ?? [];
        if (got.length < 6) { if (got.length === 0) forms.push(f); copies.set(key, [...got, f]); }
      }
      for (const h of res.body.matchAll(/href="(\/app[^"#]*)/g)) {
        const u = unescape(h[1]!);
        if (!pages.has(u) && !/logout/.test(u) && pages.size + queue.length < 3000) queue.push(u);
      }
    }
    // Each swapped position submits its OWN copy of the form (the k-th position the k-th copy drawn, where A has
    // several): a swap that leaves the form valid uses A's row, and must not use up the row the next swap needs.
    for (const [, all] of copies) {
      const send = (action: string, fields: [string, string][], where: string) => call('POST', action, { kind: 'form', data: new URLSearchParams(fields).toString() }, where);
      const at = all[0]!.fields.map(([n, v]) => ({ n, v })).filter(({ n, v }) => UUID.test(v) || idFields.includes(n) || /(Id|_id)$/.test(n)).map((x) => x.n);
      for (const [k, name] of [...new Set(at)].entries()) {
        const f = all[k % all.length]!;
        const i = f.fields.findIndex(([n]) => n === name); if (i < 0) continue;
        const [n, v] = f.fields[i]!;
        const table = aTableOf.get(v);
        for (const b of bOf(table ? [table] : FIELD_TABLES[n])) {
          const fields = f.fields.map(([k, x], j) => [k, j === i ? b : x] as [string, string]);
          await send(f.action, fields, `form ${f.action} ${n}=${b}`);
        }
      }
      const f = all[all.length - 1]!;
      for (const u of new Set(f.action.match(UUID_IN) ?? [])) {
        const table = aTableOf.get(u);
        for (const b of bOf(table ? [table] : undefined)) await send(f.action.replace(u, b), f.fields, `form ${f.action} path ${u}→${b}`);
      }
    }

    // ── 4. one of B's ids among A's own, field by field as each handler reads them ────────────────────────────────
    pass = 'mixed';
    for (const r of walk) {
      const params = [...r.url.matchAll(/:(\w+)/g)].map((m) => m[1]!);
      const ownPath = params.map((p) => ownParam(r.url, p));
      if (ownPath.some((x) => !x)) continue;
      const pathWith = (k: number, id: string) => { let n = -1; return r.url.replace(/:(\w+)/g, () => { n++; return n === k ? id : ownPath[n]!; }); };
      const ownCopy = (copy: number) => { const o: Record<string, string> = { ...WORDS }; for (const f of idFields) { const x = ownOf(f, copy); if (x) o[f] = x; } return o; };
      const own = ownCopy(0);
      const fields = idFields.filter((f) => read(r.source, f));
      const send = (url: string, o: Record<string, string>, where: string) => r.method === 'GET'
        ? call('GET', `${url}?${urlencoded(o)}`, null, where)
        : call(r.method, url, { kind: 'form', data: urlencoded(o) }, where);
      for (const [k, f] of fields.entries()) for (const b of bOf(FIELD_TABLES[f])) await send(pathWith(-1, ''), { ...ownCopy(k), [f]: b }, `${r.method} ${r.url} ${f}=${b}`);
      for (let k = 0; k < params.length; k++) {
        const t = aTableOf.get(ownPath[k]!);
        for (const b of bOf(t ? [t] : undefined)) await send(pathWith(k, b), own, `${r.method} ${r.url} :${params[k]}=${b}`);
      }
    }

    // ── 1–2. B's ids everywhere, as a form, and as JSON for every route that takes a body ─────────────────────────
    for (const [p, json] of [['ids', false], ['json', true]] as const) {
      pass = p;
      for (const r of walk) {
        if (json && r.method === 'GET') continue;
        const twice = /^\/app\/(inbox|conversations)\/:conversationId/.test(r.url) ? [false, true] : [false];
        for (const keep of twice) {
          for (const { table, id } of ids) {
            const url = fillAll(r.url, id, keep);
            const where = `${r.method} ${url} (${table})`;
            if (r.method === 'GET') await call('GET', `${url}${url.includes('?') ? '&' : '?'}${urlencoded(formOf(id))}`, null, where);
            else await call(r.method, url, json ? { kind: 'json', data: JSON.stringify({ ...formOf(id), ids: [id] }) } : { kind: 'form', data: urlencoded(formOf(id)) }, where);
            if (!r.url.includes(':') && r.method === 'GET') break;   // a page with no id in its address: once is enough for the query
          }
        }
      }
    }

    // ── 3. multipart, for every route whose handler reads a file: a small file, the fields it reads, B's ids ────────
    pass = 'multipart';
    for (const r of walk.filter((x) => x.method !== 'GET' && /req\.(file|parts)\(|isMultipart\(/.test(x.source))) {
      const image = /photo|image|media/i.test(r.url + r.source.slice(0, 400));
      const fileField = ['photo', 'media', 'file'].find((f) => r.source.includes(`'${f}'`)) ?? 'file';
      const words = Object.fromEntries(Object.entries(WORDS).filter(([k]) => r.source.includes(`'${k}'`)).slice(0, 3));
      const file = image ? { field: fileField, name: 'a.png', type: 'image/png', bytes: PNG } : { field: fileField, name: 'a.csv', type: 'text/csv', bytes: CSV };
      for (const { table, id } of ids) {
        const url = fillAll(r.url, id);
        const m = multipart(words, file);
        await call(r.method, `${url}?${urlencoded(formOf(id))}`, { kind: 'multipart', data: m.payload, type: m.type }, `${r.method} ${url} (${table}) multipart`);
      }
    }

    // AUTHZ_WALK_REPORT=<file>: what was called and how it answered, for the audit's report (never on by default).
    const report = process.env['AUTHZ_WALK_REPORT'];
    if (report) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(report, JSON.stringify({ routes: walk.length, calls, passCalls, pages: pages.size, forms: forms.length, relogins, ids: ids.length,
        idFields: idFields.length, statuses: Object.fromEntries(statuses), errors: errors.slice(0, 400), shown: [...new Set(shown)].slice(0, 100) }, null, 1));
    }
    const after = await snapshot(B);
    const changed = [...before].filter(([t, h]) => after.get(t) !== h).map(([t, h]) => `${t}: ${h} → ${after.get(t)}`);
    // `label` is an id field (labels) AND a free-text one: a phone's label on the pilot list, a fact's title, and the
    // audit line that records the label. Where B's id is the WHOLE value of a field called `label` and nowhere else in
    // the value, it is the words A typed, stored as typed — not a reference. Anything else that holds one fails.
    const typedLabel = (col: string, shapes: readonly string[]) => shapes.length > 0 && shapes.every((v) =>
      (col.endsWith('.label') && v === 'U') || (v.split('U').length === 2 && v.includes('"label": "U"')));
    const held = [...await heldByA()].filter(([t, n]) => n > (heldBefore.get(t) ?? 0) && !typedLabel(t, heldShapes.get(t) ?? []))
      .map(([t, n]) => `${t}: ${n} row(s) ${JSON.stringify(heldShapes.get(t))}`);
    const across = await crossings();
    // The session is still A's, and still works.
    if ((await app.inject({ method: 'GET', url: '/app', headers: { cookie } })).statusCode !== 200) await signIn();
    expect((await app.inject({ method: 'GET', url: '/app', headers: { cookie } })).statusCode).toBe(200);
    expect(calls).toBeGreaterThan(1000);
    expect(forms.length, 'the crawl found A\'s forms').toBeGreaterThan(50);
    expect(changed, `B's rows changed:\n${changed.join('\n')}`).toEqual([]);
    expect(held, `A's rows hold B's ids:\n${held.join('\n')}`).toEqual([]);
    expect(across, `rows point across workspaces:\n${across.join('\n')}`).toEqual([]);
    expect([...new Set(shown)].slice(0, 40), `B's words shown to A:\n${[...new Set(shown)].slice(0, 40).join('\n')}`).toEqual([]);
    expect([...new Set(errors)].slice(0, 40), `routes answered 5xx:\n${[...new Set(errors)].slice(0, 40).join('\n')}`).toEqual([]);
  });
});
