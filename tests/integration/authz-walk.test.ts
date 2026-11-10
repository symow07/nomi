import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { demoSeedSql } from '../../src/demo/factory.js';
import { ensureQueueSchema } from './tenant.js';
import { purgeBusinesses } from './books-db.js';

/**
 * The authorization audit (Block 7) — WORKSPACE A'S OWNER, EVERY ROUTE, WORKSPACE B'S IDS.
 *
 * Signed in as A's owner (the most a session can do), every route the web app registers is called with each of
 * B's ids — one row of every table B has rows in — in every path parameter, in every form field that carries an id
 * somewhere in src/api, and in the query string; a second pass keeps A's own conversation in a route's
 * `:conversationId` and sends B's ids in the rest. Then three things must hold:
 *
 *   1. B is untouched — every row of every table that holds B's workspace (and the tables that hang off B's
 *      conversations, products and customers) reads byte for byte as it did before the walk;
 *   2. no row points across — over every foreign key between two workspace tables that does NOT include
 *      `business_id` (S1's inventory: the database does not check those), no row of A names a row of B, or the
 *      reverse;
 *   3. nothing of B is shown — B's rows carry a marker in their words (its name, its products, customers, messages,
 *      knowledge, labels, books), and no response body or redirect to A contains it.
 *
 * What it cannot see: a route that needs a value this walk does not send (a file, a typed confirmation, a field it
 * does not know) stops before it reaches the id; a text column that holds an id without a key (`assigned_to`); and
 * the provider webhooks (signed requests, read in ROUTES.md). Those are named in the audit's report.
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
const SECRET = 'a-test-session-secret-of-sufficient-length';
const CODE = `authz-walk-${RUN}`;

/** Every form field name src/api reads that can carry an id (tools: the audit's field list, 2026-11-11). */
const ID_FIELDS = ['account', 'account_id', 'assistant', 'back', 'category', 'clientId', 'conversationId', 'draftId', 'entry', 'entryId',
  'id', 'ids', 'import', 'importId', 'invoice', 'invoiceId', 'item', 'itemId', 'journal', 'journalLine', 'label', 'labelId', 'line',
  'match', 'messageId', 'number_id', 'orderId', 'page_id', 'party', 'partyId', 'payFrom', 'pay_from', 'person', 'personId', 'photo',
  'product', 'productId', 'proposal', 'proposalId', 'quoteId', 'realmId', 'recurring', 'request', 'requestId', 'run', 'runId',
  'scenarioId', 'sequence', 'source', 'sourceId', 'subscription', 'supplier', 'supplierId', 'tax', 'taxCode', 'tax_code', 'thread',
  'to', 'waba_id', 'year', 'category_id', 'party_id', 'tax_code_id', 'substitute', 'substituteId', 'procedure', 'case', 'check'];
/** Plain values, so a route that wants words before it reads an id gets as far as the id. */
const WORDS = { confirm: 'yes', note: 'authz', text: 'authz', content: 'authz', reply: 'authz', title: 'authz', kind: 'faq', body: 'authz', amount: '1', date: '2026-04-20' };

d('Authorization audit · A\'s owner on every route with B\'s ids (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 1_200_000 }, () => {
  let admin: pg.Client;
  let db: import('../../src/db/client.js').Db;
  let app: import('fastify').FastifyInstance;
  let cookie = '';
  const routes: { method: string; url: string }[] = [];
  let ids: { table: string; id: string }[] = [];
  let before = new Map<string, string>();
  const shown: string[] = [];
  const failures: string[] = [];
  let calls = 0;

  /** Every table that holds a workspace, and how to read B's rows of the ones that hang off another table. */
  const snapshot = async (): Promise<Map<string, string>> => {
    const tables = (await admin.query(`select c.relname as t from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') order by 1`)).rows.map((r) => r.t as string);
    const out = new Map<string, string>();
    for (const t of tables) {
      out.set(t, (await admin.query(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h, count(*)::int as n from ${t} x where business_id = $1`, [B])).rows
        .map((r) => `${r.n}:${r.h}`)[0]!);
    }
    for (const [t, via] of [['messages', `conversation_id in (select id from conversations where business_id = $1)`],
      ['conversation_state', `conversation_id in (select id from conversations where business_id = $1)`],
      ['price_tiers', `product_id in (select id from products where business_id = $1)`],
      ['product_aliases', `product_id in (select id from products where business_id = $1)`],
      ['product_images', `product_id in (select id from products where business_id = $1)`]] as const) {
      out.set(t, (await admin.query(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h, count(*)::int as n from ${t} x where ${via}`, [B])).rows
        .map((r) => `${r.n}:${r.h}`)[0]!);
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

  /** B's extra rows, beyond the demo: one of each kind a route takes an id of. Each is tried alone; a refusal is logged, not fatal. */
  const seedB = async () => {
    const conv = `${NS_B}-0000-4000-8000-000000000301`; const client = `${NS_B}-0000-4000-8000-000000000201`;
    const product = `${NS_B}-0000-4000-8000-000000000101`;
    const v: Record<string, string> = { B, conv, client, product, MARK };
    const one = async (name: string, text: string): Promise<string | null> => {
      try {
        const r = await admin.query(text.replace(/\$(\w+)/g, (_m, k: string) => (v[k] !== undefined ? `'${v[k]}'` : `$${k}`)));
        const id = r.rows[0]?.id as string | undefined;
        if (id) v[name] = id;
        return id ?? null;
      } catch (e) { failures.push(`seed ${name}: ${(e as Error).message}`); return null; }
    };
    await one('mark', `update businesses set name = name || ' ' || $MARK where id = $B returning id::text as id`);
    await admin.query(`update products set name = name || ' ' || '${MARK}' where business_id = '${B}'`);
    await admin.query(`update clients set display_name = display_name || ' ' || '${MARK}' where business_id = '${B}'`);
    await admin.query(`update messages set text_content = text_content || ' ' || '${MARK}' where conversation_id in (select id from conversations where business_id = '${B}')`);
    await one('person', `insert into people (business_id, name, is_owner) values ($B, 'Staff ' || $MARK, false) returning id::text as id`);
    await one('assistant', `insert into assistants (business_id, name, is_default) values ($B, 'Second ' || $MARK, false) returning id::text as id`);
    await one('quote', `insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version) values ($B, $conv, $product, 10, '{}', 2, 20, 'authz') returning id::text as id`);
    await one('draft', `insert into drafts (business_id, conversation_id, capability, draft_text) values ($B, $conv, 'quote', 'Draft ' || $MARK) returning id::text as id`);
    await one('outbound', `insert into outbound_messages (business_id, conversation_id, seq, body) values ($B, $conv, 1, 'Sent ' || $MARK) returning id::text as id`);
    await one('order', `insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit) values ('AZ-' || $MARK, $B, $client, $conv, $product, 10, 'pcs') returning id::text as id`);
    await one('sample', `insert into sample_requests (business_id, conversation_id, asked_text) values ($B, $conv, 'Sample ' || $MARK) returning id::text as id`);
    await one('label', `insert into labels (business_id, name, created_by) values ($B, 'Label ' || $MARK, 'owner') returning id::text as id`);
    await one('buyerLabel', `insert into buyer_labels (business_id, client_id, label_id, added_by) values ($B, $client, $label, 'owner') returning id::text as id`);
    await one('calendar', `insert into calendar_entries (business_id, title, starts_at) values ($B, 'Entry ' || $MARK, now() + interval '1 day') returning id::text as id`);
    await one('closure', `insert into factory_closures (business_id, label, starts_on, ends_on) values ($B, 'Closed ' || $MARK, current_date + 30, current_date + 31) returning id::text as id`);
    await one('term', `insert into forbidden_terms (business_id, term) values ($B, 'term' || $MARK) returning id::text as id`);
    await one('knowledge', `insert into product_knowledge (business_id, product_id, kind, label, content) values ($B, $product, 'faq', 'Fact', 'Fact ' || $MARK) returning id::text as id`);
    await one('sequence', `insert into sequences (business_id, name, created_by) values ($B, 'Seq ' || $MARK, 'owner') returning id::text as id`);
    await one('step', `insert into sequence_steps (business_id, sequence_id, position, delay_days, subject, body) values ($B, $sequence, 1, 1, 'Hi', 'Step ' || $MARK) returning id::text as id`);
    await one('procedure', `insert into procedures (business_id, title, steps) values ($B, 'Proc ' || $MARK, '[{"text":"ask the address","kind":"do"}]') returning id::text as id`);
    await one('saved', `insert into saved_replies (business_id, title, texts, created_by) values ($B, 'Saved ' || $MARK, '{"en":"Saved"}', 'owner') returning id::text as id`);
    await one('note', `insert into conversation_notes (business_id, conversation_id, note) values ($B, $conv, 'Note ' || $MARK) returning id::text as id`);
    await one('handoff', `insert into handoffs (business_id, conversation_id, reason, sla_deadline_at) values ($B, $conv, 'human_requested', now() + interval '1 hour') returning id::text as id`);
    await one('signal', `insert into conversation_signals (business_id, conversation_id, kind) values ($B, $conv, 'human_requested') returning id::text as id`);
    await one('promise', `insert into promised_dates (business_id, conversation_id, kind, due_on, said, said_by) values ($B, $conv, 'delivery', current_date + 3, 'By Friday ' || $MARK, 'person') returning id::text as id`);
    await one('spot', `insert into spot_checks (business_id, conversation_id, capability) values ($B, $conv, 'quote') returning id::text as id`);
    await one('phone', `insert into push_subscriptions (business_id, person_id, endpoint, p256dh, auth) values ($B, $person, 'https://push.invalid/' || $MARK, repeat('k', 87), repeat('a', 22)) returning id::text as id`);
    await one('proposal', `insert into knowledge_proposals (business_id, source, lines, created_by) values ($B, 'https://example.invalid', '[{"key":"k1","fact":"Fact ${MARK}"}]', 'owner') returning id::text as id`);
    await one('catalogImport', `insert into catalog_imports (business_id, kind, currency) values ($B, 'paste', 'USD') returning id::text as id`);
    await one('contactImport', `insert into contact_imports (business_id, source, cells, mapping) values ($B, 'paste', '[["a@b.c"]]', '{}') returning id::text as id`);
    await one('orderProposal', `insert into order_proposals (business_id, conversation_id, client_id, product_id, quantity, unit, unit_price, total, currency) values ($B, $conv, $client, $product, 10, 'pcs', 2, 20, 'USD') returning id::text as id`);
    await one('deletionAsk', `insert into deletion_asks (business_id, client_id, conversation_id, asked_at) values ($B, $client, $conv, now()) returning id::text as id`);
    // The books: a chart's bank, receivable and expense accounts, a journal, a year, a posted entry, a party, a tax code,
    // a category, an invoice — and a statement line on the bank account.
    await admin.query(`update businesses set books_area = true, country = 'MA', currency = 'MAD' where id = '${B}'`);
    await one('bank', `insert into accounts (business_id, code, name, kind) values ($B, '5141', 'Bank ' || $MARK, 'asset') returning id::text as id`);
    await one('receivable', `insert into accounts (business_id, code, name, kind) values ($B, '3421', 'Customers ' || $MARK, 'asset') returning id::text as id`);
    await one('expense', `insert into accounts (business_id, code, name, kind) values ($B, '6111', 'Costs ' || $MARK, 'expense') returning id::text as id`);
    await one('income', `insert into accounts (business_id, code, name, kind) values ($B, '7111', 'Sales ' || $MARK, 'income') returning id::text as id`);
    await one('journal', `insert into journals (business_id, code, name, kind) values ($B, 'BQ', 'Banque', 'bank') returning id::text as id`);
    await one('fy', `insert into fiscal_years (business_id, starts_on, ends_on) values ($B, '2026-01-01', '2026-12-31') returning id::text as id`);
    await one('entry', `insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values ($B, $journal, $fy, '2026-04-19', 'Entry ' || $MARK, 'owner') returning id::text as id`);
    await one('jline', `insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values ($B, $entry, 1, $bank, 'MAD', 100, 0) returning id::text as id`);
    await one('jline2', `insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values ($B, $entry, 2, $receivable, 'MAD', 0, 100) returning id::text as id`);
    await one('posted', `update journal_entries set state = 'posted', posted_by = 'owner', document_ref = 'F-1', document_date = entry_date where id = $entry returning id::text as id`);
    await one('draftEntry', `insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values ($B, $journal, $fy, '2026-04-20', 'Draft entry ' || $MARK, 'owner') returning id::text as id`);
    await one('party', `insert into parties (business_id, kind, code, name) values ($B, 'customer', 'C-' || $MARK, 'Party ' || $MARK) returning id::text as id`);
    await one('tax', `insert into tax_codes (business_id, code, label, rate, kind, account_id, valid_from) values ($B, 'T20', 'Tax ' || $MARK, 20, 'collected', $receivable, '2026-01-01') returning id::text as id`);
    await one('category', `insert into spending_categories (business_id, name, account_id) values ($B, 'Cat ' || $MARK, $expense) returning id::text as id`);
    await one('invoice', `insert into invoices (business_id, party_id, issue_date, currency, label, created_by) values ($B, $party, '2026-04-20', 'MAD', 'Invoice ' || $MARK, 'owner') returning id::text as id`);
    await one('stmtImport', `insert into statement_imports (business_id, account_id, format, sha256, added, refused, imported_by) values ($B, $bank, 'csv', md5($MARK) || md5($MARK), 1, 0, 'owner') returning id::text as id`);
    await one('stmtLine', `insert into statement_lines (business_id, import_id, account_id, booked_on, amount, currency, wording, fingerprint) values ($B, $stmtImport, $bank, '2026-04-20', 100, 'MAD', 'Wire ' || $MARK, $MARK) returning id::text as id`);
  };

  /** One row of every table B has rows in (and B's messages): the ids the walk sends. */
  const idsOfB = async () => {
    const tables = (await admin.query(`select c.relname as t from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped)
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'id' and a.atttypid = 'uuid'::regtype and not a.attisdropped)
      order by 1`)).rows.map((r) => r.t as string);
    const out: { table: string; id: string }[] = [];
    for (const t of tables) {
      for (const r of (await admin.query(`select id::text as id from ${t} where business_id = $1 order by id limit 2`, [B])).rows) out.push({ table: t, id: r.id as string });
    }
    for (const r of (await admin.query(`select m.id::text as id from messages m join conversations c on c.id = m.conversation_id where c.business_id = $1 order by m.id limit 2`, [B])).rows) {
      out.push({ table: 'messages', id: r.id as string });
    }
    return out;
  };

  const statuses = new Map<number, number>();
  const errors: string[] = [];
  const look = (where: string, res: { body: string; headers: Record<string, unknown>; statusCode: number }) => {
    calls++;
    statuses.set(res.statusCode, (statuses.get(res.statusCode) ?? 0) + 1);
    if (res.statusCode >= 500) errors.push(where);
    const text = `${res.body}\n${String(res.headers['location'] ?? '')}`;
    if (text.includes(MARK)) shown.push(where);
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    await ensureQueueSchema();
    await admin.query(demoSeedSql(NS_A));
    await admin.query(demoSeedSql(NS_B));
    await seedB();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    app = Fastify({ logger: false });
    app.addHook('onRoute', (r) => { for (const m of ([] as string[]).concat(r.method as string | string[])) routes.push({ method: m, url: r.url }); });
    registerWebApp(app, {
      db, businessId: A, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/login', payload: `code=${CODE}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    cookie = ([] as string[]).concat((login.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
    expect(cookie).not.toBe('');
    ids = await idsOfB();
    before = await snapshot();
  }, 120_000);
  afterAll(async () => {
    await app?.close(); await db?.destroy();
    // Orders keep their workspace (no cascade): where the purge is refused, the two workspaces stay — the isolated run's
    // database is removed with them, and nothing here reads another run's rows.
    await purgeBusinesses(admin, [A, B], 'authz-walk-test').catch(async () => { await admin.query('rollback'); });
    await admin?.end();
  });

  it('B was seeded with rows in the tables the routes take ids of', () => {
    expect(failures, failures.join('\n')).toEqual([]);
    const tables = new Set(ids.map((i) => i.table));
    for (const t of ['conversations', 'clients', 'products', 'drafts', 'quotes', 'orders', 'labels', 'journal_lines', 'journal_entries', 'statement_lines',
      'invoices', 'spending_categories', 'people', 'assistants', 'sequences', 'product_knowledge', 'calendar_entries', 'messages']) {
      expect(tables.has(t), t).toBe(true);
    }
  });

  it('every route, every id of B: B untouched, nothing points across, nothing of B shown', async () => {
    const skip = /^\/(logout|login|signup|verify|hooks|webhooks|u$|p\/|pi\/|inv\/|media\/|chat\/|catalogue-media\/|assets|favicon|sw\.js|manifest)/;
    const walk = routes.filter((r) => !skip.test(r.url) && !r.url.includes('*') && r.method !== 'HEAD' && r.method !== 'OPTIONS');
    const fill = (url: string, id: string, keepConversation: boolean) => {
      let first = true;
      return url.replace(/:(\w+)/g, (_m, name: string) => {
        const was = first; first = false;
        return keepConversation && was && /conversation/i.test(name) ? A_CONV : id;
      });
    };
    const form = (id: string) => {
      const p = new URLSearchParams(WORDS);
      for (const f of ID_FIELDS) p.set(f, id);
      return p.toString();
    };
    for (const r of walk) {
      const passes = /^\/app\/(inbox|conversations)\/:conversationId/.test(r.url) ? [false, true] : [false];
      for (const keep of passes) {
        for (const { table, id } of ids) {
          const url = fill(r.url, id, keep);
          const where = `${r.method} ${url} (${table})`;
          const res = r.method === 'GET'
            ? await app.inject({ method: 'GET', url: `${url}${url.includes('?') ? '&' : '?'}${form(id)}`, headers: { cookie } })
            : await app.inject({ method: r.method as 'POST', url, payload: form(id), headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' } });
          look(where, res);
          if (!r.url.includes(':') && r.method === 'GET') break;   // a page with no id in its address: once is enough for the query
        }
      }
    }
    // AUTHZ_WALK_REPORT=<file>: what was called and how it answered, for the audit's report (never on by default).
    const report = process.env['AUTHZ_WALK_REPORT'];
    if (report) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(report, JSON.stringify({ routes: walk.length, calls, ids: ids.length, statuses: Object.fromEntries(statuses),
        errors: [...new Set(errors.map((e) => e.replace(/ \(.*\)$/, '')))].slice(0, 400) }, null, 1));
    }
    const after = await snapshot();
    const changed = [...before].filter(([t, h]) => after.get(t) !== h).map(([t, h]) => `${t}: ${h} → ${after.get(t)}`);
    const across = await crossings();
    // The session is still A's, and still works: the walk did not lock itself out half way.
    expect((await app.inject({ method: 'GET', url: '/app', headers: { cookie } })).statusCode).toBe(200);
    expect(calls).toBeGreaterThan(1000);
    expect(changed, `B's rows changed:\n${changed.join('\n')}`).toEqual([]);
    expect(across, `rows point across workspaces:\n${across.join('\n')}`).toEqual([]);
    expect([...new Set(shown)].slice(0, 40), `B's words shown to A:\n${[...new Set(shown)].slice(0, 40).join('\n')}`).toEqual([]);
  });
});
