import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * S1 (0239) — a row may point only at its own workspace's rows.
 *
 * Measured on main before 0239, as the app role scoped to workspace A and as admin: the database ACCEPTED a row of A
 * pointing at B's row through four single-column foreign keys (a key's check runs past row security). 0239 keeps the
 * keys exactly as they were — so every delete behaviour and both erasure walks are unchanged — and refuses the
 * cross-workspace reference with an AFTER trigger per reference, plus `business_id` fixed on the three targets.
 *
 * Here, on a fresh database: each of the four, as nomi_app with A's tenant set and as admin, insert and update,
 * pointed at B's row (refused, 23503, the reference's own constraint name) and at A's row (accepted); a missing target
 * is still the foreign key's own refusal (the trigger fires after it); the negative control (the triggers dropped in
 * a rolled-back transaction) accepts every forged row; deletes still cascade and still null `quote_id`; the two
 * erasure tools run for real on a customer and a workspace with rows in all four tables; and
 * tools/check-tenant-refs.sql counts what it should.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RUN = randomUUID().slice(0, 8);
const A = `dd239000-0000-4000-8000-${RUN}0001`;
const B = `dd239000-0000-4000-8000-${RUN}0002`;
const W = `dd239000-0000-4000-8000-${RUN}0003`;   // the workspace erase-workspace takes
const W_NAME = `Tenant Refs Gone ${RUN}`;

/** One workspace's rows in all four tables: a client, a conversation, a quote on it, an outbound row carrying it. */
type Set4 = { product: string; client: string; client2: string; conv: string; conv2: string; quote: string; quote2: string; out: string };

const REFS = {
  outConv: 'outbound_messages_conversation_same_workspace',
  outQuote: 'outbound_messages_quote_same_workspace',
  convClient: 'conversations_client_same_workspace',
  quoteConv: 'quotes_conversation_same_workspace',
} as const;
const TRIGGERS: Record<string, string> = {
  [REFS.outConv]: 'outbound_messages', [REFS.outQuote]: 'outbound_messages',
  [REFS.convClient]: 'conversations', [REFS.quoteConv]: 'quotes',
  conversations_workspace_fixed: 'conversations', quotes_workspace_fixed: 'quotes', clients_workspace_fixed: 'clients',
};

type Q = (text: string, params?: unknown[]) => Promise<pg.QueryResult>;
type Role = 'app' | 'admin';

d('S1 · a row may point only at its own workspace\'s rows (0239; requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 180_000 }, () => {
  let admin: pg.Client;
  let app: pg.Client;
  const S: Record<'A' | 'B' | 'W', Set4> = {} as never;
  let seq = 100;

  const seed = async (biz: string, tag: string): Promise<Set4> => {
    const one = async (text: string, p: unknown[]) => (await admin.query(text, p)).rows[0].id as string;
    const product = await one(`insert into products (business_id, sku, name, price_usd_per_unit) values ($1, $2, 'A bag', 5) returning id::text as id`, [biz, `S1-${tag}-${RUN}`]);
    const client = await one(`insert into clients (business_id, display_name) values ($1, 'A customer') returning id::text as id`, [biz]);
    const client2 = await one(`insert into clients (business_id, display_name) values ($1, 'Another customer') returning id::text as id`, [biz]);
    const conv = await one(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'web_chat') returning id::text as id`, [biz, client]);
    const conv2 = await one(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'web_chat') returning id::text as id`, [biz, client2]);
    const quote = await one(quoteSql, [biz, conv, product]);
    const quote2 = await one(quoteSql, [biz, conv2, product]);
    const out = await one(`insert into outbound_messages (business_id, conversation_id, seq, body, quote_id) values ($1, $2, 1, 'Twelve dollars each.', $3) returning id::text as id`, [biz, conv, quote]);
    await admin.query(`insert into messages (conversation_id, direction, input_type, text_content, sent_at) values ($1, 'inbound', 'text', 'how much?', now())`, [conv]);
    return { product, client, client2, conv, conv2, quote, quote2, out };
  };
  const quoteSql = `insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version)
                    values ($1, $2, $3, 10, '{}'::jsonb, 12, 120, 'test') returning id::text as id`;

  /** Runs `fn` in a transaction that is always rolled back: as nomi_app with A's tenant set, or as admin. */
  const within = async (role: Role, fn: (q: Q) => Promise<unknown>): Promise<unknown> => {
    const c = role === 'app' ? app : admin;
    await c.query('begin');
    try {
      if (role === 'app') await c.query("select set_config('app.business_id', $1, true)", [A]);
      return await fn((t, p) => c.query(t, p));
    } finally {
      await c.query('rollback');
    }
  };
  const refused = async (role: Role, text: string, params: unknown[]) => {
    try {
      await within(role, (q) => q(text, params));
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      return { code: err.code, constraint: err.constraint };
    }
    return { code: 'accepted', constraint: undefined };
  };
  const accepted = async (role: Role, text: string, params: unknown[], check: string, checkParams: unknown[]) =>
    within(role, async (q) => {
      await q(text, params);
      return (await q(check, checkParams)).rows[0];
    });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN });
    app = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await app.connect();
    await admin.query(`insert into businesses (id, name) values ($1, $2), ($3, $4), ($5, $6)`,
      [A, `Tenant Refs A ${RUN}`, B, `Tenant Refs B ${RUN}`, W, W_NAME]);
    S.A = await seed(A, 'a');
    S.B = await seed(B, 'b');
    S.W = await seed(W, 'w');
  });

  afterAll(async () => {
    await app?.end().catch(() => {});
    await admin?.end().catch(() => {});
  });

  it('the app connection IS nomi_app, scoped by row security (not a superuser, no bypass)', async () => {
    const who = (await app.query(`select current_user as u, r.rolsuper as s, r.rolbypassrls as b from pg_roles r where r.rolname = current_user`)).rows[0];
    expect(who).toEqual({ u: 'nomi_app', s: false, b: false });
    // Scoped to A, B's rows are invisible — the reference is what row security cannot see.
    const seen = await within('app', async (q) => (await q(`select count(*)::int as n from conversations where id = $1`, [S.B.conv])).rows[0].n);
    expect(seen).toBe(0);
  });

  for (const role of ['app', 'admin'] as const) {
    describe(`as ${role === 'app' ? 'nomi_app with A\'s tenant set' : 'admin'}`, () => {
      // ── 1 · outbound_messages.conversation_id → conversations ──
      it('1 insert · an outbound row of A on B\'s conversation is refused; on A\'s it is accepted', async () => {
        expect(await refused(role, `insert into outbound_messages (business_id, conversation_id, seq, body) values ($1, $2, $3, 'x')`, [A, S.B.conv, ++seq]))
          .toEqual({ code: '23503', constraint: REFS.outConv });
        expect(await accepted(role, `insert into outbound_messages (business_id, conversation_id, seq, body) values ($1, $2, $3, 'x')`, [A, S.A.conv, ++seq],
          `select count(*)::int as n from outbound_messages where conversation_id = $1 and seq = $2`, [S.A.conv, seq])).toEqual({ n: 1 });
      });
      it('1 update · A\'s outbound row moved onto B\'s conversation is refused; onto A\'s other one, accepted', async () => {
        expect(await refused(role, `update outbound_messages set conversation_id = $2, seq = $3 where id = $1`, [S.A.out, S.B.conv, ++seq]))
          .toEqual({ code: '23503', constraint: REFS.outConv });
        expect(await accepted(role, `update outbound_messages set conversation_id = $2, quote_id = null where id = $1`, [S.A.out, S.A.conv2],
          `select conversation_id::text as c from outbound_messages where id = $1`, [S.A.out])).toEqual({ c: S.A.conv2 });
      });

      // ── 2 · outbound_messages.quote_id → quotes ──
      it('2 insert · an outbound row of A carrying B\'s quote is refused; carrying A\'s, accepted', async () => {
        expect(await refused(role, `insert into outbound_messages (business_id, conversation_id, seq, body, quote_id) values ($1, $2, $3, 'x', $4)`, [A, S.A.conv, ++seq, S.B.quote]))
          .toEqual({ code: '23503', constraint: REFS.outQuote });
        expect(await accepted(role, `insert into outbound_messages (business_id, conversation_id, seq, body, quote_id) values ($1, $2, $3, 'x', $4)`, [A, S.A.conv, ++seq, S.A.quote],
          `select quote_id::text as q from outbound_messages where conversation_id = $1 and seq = $2`, [S.A.conv, seq])).toEqual({ q: S.A.quote });
      });
      it('2 update · A\'s outbound row given B\'s quote is refused; A\'s other quote, accepted', async () => {
        expect(await refused(role, `update outbound_messages set quote_id = $2 where id = $1`, [S.A.out, S.B.quote]))
          .toEqual({ code: '23503', constraint: REFS.outQuote });
        expect(await accepted(role, `update outbound_messages set quote_id = $2 where id = $1`, [S.A.out, S.A.quote2],
          `select quote_id::text as q from outbound_messages where id = $1`, [S.A.out])).toEqual({ q: S.A.quote2 });
      });

      // ── 3 · conversations.client_id → clients ──
      it('3 insert · a conversation of A for B\'s client is refused; for A\'s, accepted', async () => {
        expect(await refused(role, `insert into conversations (business_id, client_id, channel) values ($1, $2, 'web_chat')`, [A, S.B.client]))
          .toEqual({ code: '23503', constraint: REFS.convClient });
        expect(await accepted(role, `insert into conversations (business_id, client_id, channel) values ($1, $2, 'web_chat')`, [A, S.A.client2],
          `select count(*)::int as n from conversations where client_id = $1`, [S.A.client2])).toEqual({ n: 2 });
      });
      it('3 update · A\'s conversation re-pointed at B\'s client is refused; at A\'s other client, accepted', async () => {
        expect(await refused(role, `update conversations set client_id = $2 where id = $1`, [S.A.conv, S.B.client]))
          .toEqual({ code: '23503', constraint: REFS.convClient });
        expect(await accepted(role, `update conversations set client_id = $2 where id = $1`, [S.A.conv, S.A.client2],
          `select client_id::text as c from conversations where id = $1`, [S.A.conv])).toEqual({ c: S.A.client2 });
      });

      // ── 4 · quotes.conversation_id → conversations ──
      it('4 insert · a quote of A on B\'s conversation is refused; on A\'s, accepted', async () => {
        expect(await refused(role, quoteSql, [A, S.B.conv, S.A.product])).toEqual({ code: '23503', constraint: REFS.quoteConv });
        expect(await accepted(role, quoteSql, [A, S.A.conv2, S.A.product],
          `select count(*)::int as n from quotes where conversation_id = $1`, [S.A.conv2])).toEqual({ n: 2 });
      });
      it('4 update · A\'s quote moved onto B\'s conversation is refused; onto A\'s other one, accepted', async () => {
        expect(await refused(role, `update quotes set conversation_id = $2 where id = $1`, [S.A.quote, S.B.conv]))
          .toEqual({ code: '23503', constraint: REFS.quoteConv });
        expect(await accepted(role, `update quotes set conversation_id = $2 where id = $1`, [S.A.quote, S.A.conv2],
          `select conversation_id::text as c from quotes where id = $1`, [S.A.quote])).toEqual({ c: S.A.conv2 });
      });

      it('a target that does not exist is still the foreign key\'s own refusal (the trigger fires after it)', async () => {
        expect(await refused(role, `insert into outbound_messages (business_id, conversation_id, seq, body) values ($1, $2, $3, 'x')`, [A, randomUUID(), ++seq]))
          .toEqual({ code: '23503', constraint: 'outbound_messages_conversation_id_fkey' });
        expect(await refused(role, `update outbound_messages set quote_id = $2 where id = $1`, [S.A.out, randomUUID()]))
          .toEqual({ code: '23503', constraint: 'outbound_messages_quote_id_fkey' });
        expect(await refused(role, `update conversations set client_id = $2 where id = $1`, [S.A.conv, randomUUID()]))
          .toEqual({ code: '23503', constraint: 'conversations_client_id_fkey' });
        expect(await refused(role, quoteSql, [A, randomUUID(), S.A.product]))
          .toEqual({ code: '23503', constraint: 'quotes_conversation_id_fkey' });
      });

      it('a null quote is no reference: an outbound row with none is accepted', async () => {
        expect(await accepted(role, `update outbound_messages set quote_id = null where id = $1`, [S.A.out],
          `select quote_id from outbound_messages where id = $1`, [S.A.out])).toEqual({ quote_id: null });
      });
    });
  }

  it('admin only · moving the referencing row to B (its business_id) is refused by the same check, each of the four', async () => {
    expect(await refused('admin', `update outbound_messages set business_id = $2, quote_id = null where id = $1`, [S.A.out, B]))
      .toEqual({ code: '23503', constraint: REFS.outConv });
    expect(await refused('admin', `update outbound_messages set quote_id = $2, conversation_id = $3 where id = $1`, [S.A.out, S.B.quote, S.A.conv]))
      .toEqual({ code: '23503', constraint: REFS.outQuote });
  });

  it('admin only · a target\'s workspace never changes (it would carry its references across): 23514 on each of the three', async () => {
    expect(await refused('admin', `update conversations set business_id = $2 where id = $1`, [S.A.conv, B]))
      .toEqual({ code: '23514', constraint: 'conversations_workspace_fixed' });
    expect(await refused('admin', `update quotes set business_id = $2 where id = $1`, [S.A.quote, B]))
      .toEqual({ code: '23514', constraint: 'quotes_workspace_fixed' });
    expect(await refused('admin', `update clients set business_id = $2 where id = $1`, [S.A.client, B]))
      .toEqual({ code: '23514', constraint: 'clients_workspace_fixed' });
    // Writing the same workspace again is no change.
    expect(await accepted('admin', `update conversations set business_id = business_id where id = $1`, [S.A.conv],
      `select business_id::text as b from conversations where id = $1`, [S.A.conv])).toEqual({ b: A });
  });

  it('NEGATIVE CONTROL · with 0239\'s triggers dropped (rolled back), every forged row is accepted, as admin and as nomi_app', async () => {
    const forged = async (q: Q, asAdmin: boolean) => {
      await q(`insert into outbound_messages (business_id, conversation_id, seq, body) values ($1, $2, $3, 'x')`, [A, S.B.conv, ++seq]);
      await q(`update outbound_messages set quote_id = $2 where id = $1`, [S.A.out, S.B.quote]);
      await q(`update conversations set client_id = $2 where id = $1`, [S.A.conv, S.B.client]);
      await q(quoteSql, [A, S.B.conv, S.A.product]);
      await q(`update quotes set conversation_id = $2 where id = $1`, [S.A.quote, S.B.conv]);
      // Moving a target out of A: only admin can (row security keeps nomi_app's rows in A whatever the triggers say).
      if (asAdmin) await q(`update conversations set business_id = $2 where id = $1`, [S.A.conv2, B]);
    };
    await within('admin', async (q) => {
      for (const [name, table] of Object.entries(TRIGGERS)) await q(`drop trigger ${name} on ${table}`);
      await q('savepoint as_admin');
      await forged(q, true);
      await q('rollback to savepoint as_admin');
      await q('set local role nomi_app');
      await q("select set_config('app.business_id', $1, true)", [A]);
      expect((await q('select current_user as u')).rows[0].u).toBe('nomi_app');
      await forged(q, false);
    });
    // And they are back: the same forgery is refused again.
    expect(await refused('admin', `update conversations set client_id = $2 where id = $1`, [S.A.conv, S.B.client]))
      .toEqual({ code: '23503', constraint: REFS.convClient });
  });

  it('DELETES UNCHANGED · a conversation still cascades its outbound rows and quotes; a quote still nulls quote_id; a client still cascades its conversations', async () => {
    await within('admin', async (q) => {
      const outOnConv2 = (await q(`insert into outbound_messages (business_id, conversation_id, seq, body, quote_id) values ($1, $2, 1, 'y', $3) returning id`, [A, S.A.conv2, S.A.quote2])).rows[0].id;
      // A quote erased: the outbound row stays, its quote_id null (the set-null is an UPDATE the trigger lets through).
      await q(`update outbound_messages set quote_id = $2 where id = $1`, [S.A.out, S.A.quote]);
      await q(`delete from quotes where id = $1`, [S.A.quote]);
      expect((await q(`select quote_id from outbound_messages where id = $1`, [S.A.out])).rows).toEqual([{ quote_id: null }]);
      // A conversation erased: its outbound rows and quotes go with it.
      await q(`delete from conversations where id = $1`, [S.A.conv2]);
      expect((await q(`select count(*)::int as n from outbound_messages where id = $1 or conversation_id = $2`, [outOnConv2, S.A.conv2])).rows[0].n).toBe(0);
      expect((await q(`select count(*)::int as n from quotes where id = $1 or conversation_id = $2`, [S.A.quote2, S.A.conv2])).rows[0].n).toBe(0);
      // A client erased: its conversations, and theirs, go.
      await q(`delete from clients where id = $1`, [S.A.client]);
      expect((await q(`select count(*)::int as n from conversations where id = $1`, [S.A.conv])).rows[0].n).toBe(0);
      expect((await q(`select count(*)::int as n from outbound_messages where id = $1`, [S.A.out])).rows[0].n).toBe(0);
    });
    // The delete rules themselves are what they were.
    const rules = (await admin.query(`select conname, confdeltype from pg_constraint where conname = any($1::text[]) order by 1`,
      [['conversations_client_id_fkey', 'outbound_messages_conversation_id_fkey', 'outbound_messages_quote_id_fkey', 'quotes_conversation_id_fkey']])).rows;
    expect(rules).toEqual([
      { conname: 'conversations_client_id_fkey', confdeltype: 'c' },
      { conname: 'outbound_messages_conversation_id_fkey', confdeltype: 'c' },
      { conname: 'outbound_messages_quote_id_fkey', confdeltype: 'n' },
      { conname: 'quotes_conversation_id_fkey', confdeltype: 'c' },
    ]);
  });

  it('tools/check-tenant-refs.sql counts 0 on each of the four, and counts a forged row when the triggers are off', async () => {
    const sqlText = readFileSync(`${ROOT}tools/check-tenant-refs.sql`, 'utf8');
    const body = sqlText.replace(/^--.*$/gm, '').replace(/begin transaction read only;|rollback;/g, '').trim().replace(/;$/, '');
    const counts = async (q: Q) => Object.fromEntries((await q(body)).rows.map((r) => [r.reference, Number(r.other_workspace)]));
    const zero = await within('admin', counts);
    expect(zero).toEqual({
      'outbound_messages.conversation_id -> conversations': 0, 'outbound_messages.quote_id -> quotes': 0,
      'conversations.client_id -> clients': 0, 'quotes.conversation_id -> conversations': 0,
    });
    const one = await within('admin', async (q) => {
      for (const [name, table] of Object.entries(TRIGGERS)) await q(`drop trigger ${name} on ${table}`);
      await q(`insert into outbound_messages (business_id, conversation_id, seq, body, quote_id) values ($1, $2, $3, 'x', $4)`, [A, S.B.conv, ++seq, S.B.quote]);
      await q(`update conversations set client_id = $2 where id = $1`, [S.B.conv2, S.A.client2]);
      await q(quoteSql, [A, S.B.conv, S.A.product]);
      return counts(q);
    });
    expect(one).toEqual({
      'outbound_messages.conversation_id -> conversations': 1, 'outbound_messages.quote_id -> quotes': 1,
      'conversations.client_id -> clients': 1, 'quotes.conversation_id -> conversations': 1,
    });
    // The file as a whole runs read-only and writes nothing.
    expect(sqlText).toMatch(/begin transaction read only;/);
    expect(sqlText).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create)\b/i);
  });

  // ── the two erasure tools, run for real on rows in all four tables ──
  type Run = { code: number | null; out: string; err: string };
  const run = (tool: string, args: string[]): Run => {
    const r = spawnSync(process.execPath, [`tools/${tool}`, ...args], { cwd: ROOT, env: { ...process.env, MIGRATE_DATABASE_URL: ADMIN }, encoding: 'utf8', timeout: 120_000 });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  /** `clients` counts the customer with their name: erase-buyer anonymises the row (kept so orders point at nobody). */
  const footprint = async (s: Set4) => (await admin.query(`
    select (select count(*)::int from clients where id = $1 and display_name is not null) as clients,
           (select count(*)::int from conversations where client_id = $1) as conversations,
           (select count(*)::int from quotes where conversation_id = $2) as quotes,
           (select count(*)::int from outbound_messages where conversation_id = $2) as outbound`, [s.client, s.conv])).rows[0];

  it('tools/erase-buyer.mjs · dry run changes nothing, --yes erases B\'s customer with rows in all four tables; A untouched', async () => {
    // A fresh set on B (the earlier cases rolled back, B's rows are as seeded).
    expect(await footprint(S.B)).toEqual({ clients: 1, conversations: 1, quotes: 1, outbound: 1 });
    const req = (await admin.query(`insert into deletion_requests (business_id, scope, client_id, asked_by) values ($1, 'buyer', $2, 'owner') returning id::text as id`, [B, S.B.client])).rows[0].id as string;
    const dry = run('erase-buyer.mjs', ['--request', req]);
    expect(dry.code, dry.err).toBe(0);
    expect(await footprint(S.B)).toEqual({ clients: 1, conversations: 1, quotes: 1, outbound: 1 });
    const go = run('erase-buyer.mjs', ['--request', req, '--yes', '--confirm', req.slice(0, 8), '--by', 'S1 Test']);
    expect(go.code, `${go.out}\n${go.err}`).toBe(0);
    expect(await footprint(S.B)).toEqual({ clients: 0, conversations: 0, quotes: 0, outbound: 0 });
    expect((await admin.query(`select state from deletion_requests where id = $1`, [req])).rows[0].state).toBe('done');
    // B's other customer and A's rows are where they were.
    expect((await admin.query(`select count(*)::int as n from conversations where id = any($1::uuid[])`, [[S.B.conv2, S.A.conv, S.A.conv2]])).rows[0].n).toBe(3);
  });

  it('tools/erase-workspace.mjs · dry run changes nothing, --yes erases a workspace with rows in all four tables', async () => {
    expect(await footprint(S.W)).toEqual({ clients: 1, conversations: 1, quotes: 1, outbound: 1 });
    await admin.query(`insert into deletion_requests (business_id, scope, asked_by) values ($1, 'workspace', 'owner')`, [W]);
    const dry = run('erase-workspace.mjs', ['--business', W]);
    expect(dry.code, dry.err).toBe(0);
    expect(dry.out).toMatch(/Dry run\. Nothing was deleted\./);
    expect(await footprint(S.W)).toEqual({ clients: 1, conversations: 1, quotes: 1, outbound: 1 });
    const go = run('erase-workspace.mjs', ['--business', W, '--confirm', W_NAME, '--yes']);
    expect(go.code, `${go.out}\n${go.err}`).toBe(0);
    for (const t of ['clients', 'conversations', 'quotes', 'outbound_messages', 'products', 'businesses']) {
      const col = t === 'businesses' ? 'id' : 'business_id';
      expect((await admin.query(`select count(*)::int as n from ${t} where ${col} = $1`, [W])).rows[0].n, t).toBe(0);
    }
    expect((await admin.query(`select count(*)::int as n from conversations where business_id = $1`, [A])).rows[0].n).toBeGreaterThan(0);
  });
});
