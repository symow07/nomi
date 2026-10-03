import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { flashSaid } from './tenant.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
// @ts-expect-error — the operator tools, plain JS on purpose (tools/ is not type-checked).
import { RULES, contractDifferences } from '../../tools/erase-buyer.mjs';
// @ts-expect-error — the operator tools, plain JS on purpose.
import { parseLedgerLine } from '../../tools/replay-erasures.mjs';

/**
 * 0126 — A CUSTOMER'S DATA IS DELETED WHEN THEY ASK, BY THE OWNER, AT ONCE;
 * A WORKSPACE IS ERASED WHEN ITS OWNER CLOSES IT. Through the real routes,
 * against real Postgres, row security on, the app role holding no DELETE:
 *
 *   · the owner's one act, "Delete this customer's data now": from a request
 *     noted in chat, from one still open, or with the owner's note — erased
 *     for real (rows gone, not hidden), orders kept without contact details,
 *     the do-not-contact note kept, the request closed as done, the business's
 *     audit trail and the operator's ids-only ledger written, the operator
 *     mailed the ledger's line; nothing sent to the customer;
 *   · it asks first, and with no script the route answers with a page that asks;
 *   · staff are refused at the route AND by the database; another business's
 *     customer cannot be reached; a worker busy with them changes nothing;
 *   · a table nobody classified stops the erasure, by name;
 *   · closing a workspace: refused for staff, a wrong name, the installation's
 *     own workspace and a running paid plan; then everything erased, the owner
 *     signed out onto /closed, and only the ledger's line left.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `dde00000-0000-4000-8000-${RUN}0001`;
const OTHER = `dde00000-0000-4000-8000-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const LEGAL = 'privacy@nomi.test';
const DIGITS = String(parseInt(RUN, 16) % 1_000_000_000).padStart(9, '0');

type Customer = { client: string; conv: string; phone: string; name: string; email: string };

d('0126 · the owner deletes a customer\'s data, and closes a workspace (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let SHOP = '';
  let SHOP_NAME = '';
  let OWNER_ID = '';
  let STAFF_ID = '';
  let owner = '';
  let staff = '';
  let pilotCookie = '';
  const notices: { to: string; subject: string; text: string }[] = [];
  const reported: unknown[] = [];
  const C: Record<'chat' | 'noted' | 'open' | 'busy' | 'theirs', Customer> = {} as never;
  let OPEN_REQ = '';
  let THEIR_REQ = '';

  const post = (cookie: string, url: string, fields: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const n = async (q: string, p: unknown[]) => Number((await admin.query(q, p)).rows[0].n);
  /** Everything of one customer that the contract erases, counted. */
  const footprint = async (c: Customer) => ({
    messages: await n('select count(*) as n from messages where conversation_id = $1', [c.conv]),
    identities: await n('select count(*) as n from client_channels where client_id = $1', [c.client]),
    named: await n('select count(*) as n from clients where id = $1 and display_name is not null', [c.client]),
    conversations: await n('select count(*) as n from conversations where client_id = $1 and is_active', [c.client]),
  });

  const customer = async (biz: string, key: string, i: number): Promise<Customer> => {
    const phone = `97${i}${DIGITS}`;
    const name = `Customer ${key} ${RUN}`;
    const email = `${key}.${RUN}@buyer.test`;
    const client = (await admin.query(`insert into clients (business_id, display_name, phone, email) values ($1, $2, $3, $4) returning id::text as id`,
      [biz, name, phone, email])).rows[0].id as string;
    await admin.query(`insert into client_channels (client_id, channel, channel_user_id) values ($1, 'whatsapp', $2)`, [client, phone]);
    const conv = (await admin.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp') returning id::text as id`,
      [biz, client])).rows[0].id as string;
    await admin.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'inbound', $2, now())`,
      [conv, `${name} says: please delete my data`]);
    return { client, conv, phone, name, email };
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { makeSessionCodec } = await import('../../src/api/web/session.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();

    SHOP_NAME = `Erasure Shop ${RUN}`;
    const made = await provisionAccount(db, {
      factory: SHOP_NAME, language: 'en', ownerName: 'Lena', email: `lena.${RUN}@shop.test`,
      passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
      profile: { kind: 'retail', sells: 'candles', country: 'AE', website: null, teamSize: '1', channels: [] },
    });
    if (made.code !== 'created') throw new Error(made.code);
    SHOP = made.businessId;
    OWNER_ID = made.personId;
    STAFF_ID = (await admin.query(`insert into people (business_id, name, is_owner) values ($1, 'Xiao Chen', false) returning id::text as id`, [SHOP])).rows[0].id;
    for (const [id, name] of [[PILOT, `Erasure Pilot ${RUN}`], [OTHER, `Erasure Other ${RUN}`]] as const) {
      await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [id, name]);
    }

    C.chat = await customer(SHOP, 'chat', 1);
    C.noted = await customer(SHOP, 'noted', 2);
    C.open = await customer(SHOP, 'open', 3);
    C.busy = await customer(SHOP, 'busy', 4);
    C.theirs = await customer(OTHER, 'theirs', 5);
    // The chat customer asked in a message (0076), ordered once (the order stays), and asked not to be written to.
    const m = (await admin.query(`select id::text as id from messages where conversation_id = $1`, [C.chat.conv])).rows[0].id;
    await admin.query(`insert into deletion_asks (business_id, client_id, conversation_id, message_id, asked_at) values ($1, $2, $3, $4, now() - interval '1 day')`,
      [SHOP, C.chat.client, C.chat.conv, m]);
    const product = (await admin.query(`insert into products (business_id, sku, name) values ($1, $2, 'Candle') returning id::text as id`, [SHOP, `C-${RUN}`])).rows[0].id;
    await admin.query(`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, client_email, shipping_address, status)
                       values ($1, $2, $3, $4, $5, 2, 'pcs', $6, '1 Palm St', 'confirmed')`,
      [`ER-${RUN}`, SHOP, C.chat.client, C.chat.conv, product, C.chat.email]);
    await admin.query(`insert into suppressions (business_id, channel, identity, reason) values ($1, 'email', $2, 'unsubscribed')`, [SHOP, C.chat.email]);
    // A request recorded before deleting was one act (0073): still open.
    OPEN_REQ = (await admin.query(`insert into deletion_requests (business_id, scope, client_id, asked_by, subject_note) values ($1, 'buyer', $2, 'owner', 'By phone') returning id::text as id`,
      [SHOP, C.open.client])).rows[0].id;
    THEIR_REQ = (await admin.query(`insert into deletion_requests (business_id, scope, client_id, asked_by) values ($1, 'buyer', $2, 'owner') returning id::text as id`,
      [OTHER, C.theirs.client])).rows[0].id;

    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: PILOT, accessCode: `erasure-${RUN}`, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, factsTtlMs: 0,
      messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
      legalContact: LEGAL,
      systemMail: { from: 'nomi@nomi.test', send: async (x: { to: string; subject: string; text: string }) => { notices.push(x); return { ok: true as const }; } },
      reportError: async (e: unknown) => { reported.push(e); },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const codec = makeSessionCodec(SECRET);
    const exp = Date.now() + 3_600_000;
    owner = `yf_session=${codec.sign({ businessId: SHOP, exp, person: { id: OWNER_ID, name: 'Lena', isOwner: true } })}`;
    staff = `yf_session=${codec.sign({ businessId: SHOP, exp, person: { id: STAFF_ID, name: 'Xiao Chen', isOwner: false } })}`;
    pilotCookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=erasure-${RUN}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(pilotCookie).not.toBe('');
  }, 120_000);

  afterAll(async () => {
    await admin?.query(`delete from pgboss.job where data->>'businessId' = any($1::text[])`, [[SHOP, OTHER, PILOT]]).catch(() => undefined);
    await admin?.query(`update deletion_requests set state = 'withdrawn', closed_at = now(), closed_by = 'test-cleanup'
                         where state = 'open' and business_id = any($1::uuid[])`, [[SHOP, OTHER, PILOT]]).catch(() => undefined);
    await app?.close(); await db?.destroy(); await admin?.end();
  });

  // ── One list, and every table on it ─────────────────────────────────────
  it('THE ONE LIST: the database\'s contract is the tool\'s RULES, table for table — and a difference is found', async () => {
    const rows = (await admin.query('select tbl, action, clear, blank, detach, match from customer_erasure_contract()')).rows;
    expect(contractDifferences(rows)).toEqual([]);
    // Switched off: one action changed in the tool's list is named.
    expect(contractDifferences(rows, { ...RULES, quotes: { do: 'erase' } })).toEqual(["quotes: RULES says 'erase', the database 'erase-unless-kept'"]);
    expect(contractDifferences(rows.filter((r: { tbl: string }) => r.tbl !== 'messages')).join(' ')).toMatch(/messages is in RULES and not in the database/);
  });

  it('every table with a key path to clients, conversations or messages, or a client_id / conversation_id column, is classified — none is left out', async () => {
    const reached = (await admin.query(`
      with recursive fk as (
        select (case when n.nspname = 'public' then c.relname::text else n.nspname || '.' || c.relname end) as child,
               (case when pn.nspname = 'public' then p.relname::text else pn.nspname || '.' || p.relname end) as parent
          from pg_constraint con
          join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
          join pg_class p on p.oid = con.confrelid join pg_namespace pn on pn.oid = p.relnamespace
         where con.contype = 'f' and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss')
      ), down(t) as (
        select 'clients'::text collate "C" union select 'conversations'::text collate "C" union select 'messages'::text collate "C"
        union select fk.child from fk join down on fk.parent = down.t
      )
      select t from down
      union
      select (case when n.nspname = 'public' then c.relname::text else n.nspname || '.' || c.relname end)
        from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname not in ('pg_catalog', 'information_schema', 'pgboss') and n.nspname not like 'pg\\_%'
         and c.relkind in ('r', 'p') and not c.relispartition and not a.attisdropped
         and a.attname in ('client_id', 'conversation_id')`)).rows.map((r: { t: string }) => r.t).sort();
    const contract = new Map((await admin.query('select tbl, action from customer_erasure_contract()')).rows.map((r: { tbl: string; action: string }) => [r.tbl, r.action]));
    expect(reached.length).toBeGreaterThan(30);
    expect(reached.filter((x: string) => !contract.has(x)), 'erased, detached, kept — or decided unrelated: every one').toEqual([]);
    for (const x of reached) {
      expect(['erase', 'erase-unless-kept', 'shell', 'keep', 'anonymise', 'detach', 'receipts', 'redact', 'unrelated'], x).toContain(contract.get(x));
    }
    expect((await admin.query('select customer_erasure_problems() as p')).rows[0].p).toEqual([]);
  });

  it('A TABLE NOBODY CLASSIFIED STOPS IT, by name, before anything changes', async () => {
    await admin.query('begin');
    try {
      await admin.query(`create table erasure_probe_${RUN} (id uuid primary key, conversation_id uuid references conversations(id))`);
      const p = (await admin.query('select customer_erasure_problems() as p')).rows[0].p as string[];
      expect(p.join(' ')).toMatch(new RegExp(`erasure_probe_${RUN} is a table this erasure does not know`));
      expect(p.join(' ')).toMatch(new RegExp(`erasure_probe_${RUN}\\.conversation_id → conversations\\.id is a link this erasure was not written for`));
      await expect(admin.query('select erase_customer_rows($1::uuid, $2::uuid, null)', [SHOP, C.busy.client])).rejects.toMatchObject({ code: 'NE001' });
    } finally {
      await admin.query('rollback');
    }
    expect(await footprint(C.busy)).toEqual({ messages: 1, identities: 1, named: 1, conversations: 1 });
  });

  // ── The customer's page ───────────────────────────────────────────────────
  it('the owner is offered the one act, asked first; a member of staff sees whose decision it is', async () => {
    const page = (await get(owner, `/app/conversations/${C.chat.conv}`)).body;
    expect(page).toContain(`action="/app/conversations/${C.chat.conv}/deletion/erase"`);
    expect(page).toContain(`data-confirm="${esc(t('en', 'conv.deletion.eraseConfirm'))}"`);
    expect(page).toContain(esc(t('en', 'conv.deletion.erase')));
    const theirs = (await get(staff, `/app/conversations/${C.chat.conv}`)).body;
    expect(theirs).not.toContain('/deletion/erase');
    expect(theirs).toContain(t('en', 'staff.ownerDecides'));
  });

  it('WITH NO SCRIPT the first press is answered with a page that asks — and nothing changes', async () => {
    const res = await post(owner, `/app/conversations/${C.chat.conv}/deletion/erase`, { asked: '0' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(esc(t('en', 'erase.ask.title')));
    expect(res.body).toContain(C.chat.name);
    expect(res.body).toMatch(/<input type="hidden" name="asked" value="1" \/>/);
    expect(res.body).toContain(esc(t('en', 'conv.deletion.kept')));
    expect(await footprint(C.chat)).toEqual({ messages: 1, identities: 1, named: 1, conversations: 1 });
  });

  it('A MEMBER OF STAFF is refused by the route, and by the database if a route ever forgot', async () => {
    const res = await post(staff, `/app/conversations/${C.chat.conv}/deletion/erase`, { asked: '1' });
    expect(flashSaid(res, SECRET)).toBe(t('en', 'staff.notAllowed'));
    expect(await footprint(C.chat)).toEqual({ messages: 1, identities: 1, named: 1, conversations: 1 });
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(SHOP); if (!bid.ok) throw new Error('fixture');
    await expect(withTenantTx(db, bid.value, (tx) => sql`select erase_customer(${OPEN_REQ}::uuid, ${STAFF_ID})`.execute(tx)))
      .rejects.toMatchObject({ code: 'NE003' });
    // No workspace bound to the transaction: nothing to erase from.
    await expect(sql`select erase_customer(${OPEN_REQ}::uuid, ${OWNER_ID})`.execute(db)).rejects.toMatchObject({ code: 'NE003' });
    expect((await admin.query('select state from deletion_requests where id = $1', [OPEN_REQ])).rows[0].state).toBe('open');
  });

  it('ANOTHER BUSINESS\'S CUSTOMER cannot be reached: not by its conversation, not by its request', async () => {
    const res = await post(owner, `/app/conversations/${C.theirs.conv}/deletion/erase`, { asked: '1', note: 'trying' });
    expect(res.statusCode).toBe(302);
    expect(String(res.headers['location'])).toBe('/app/inbox');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(SHOP); if (!bid.ok) throw new Error('fixture');
    // The workspace is the transaction's, never an argument: their request does not exist here.
    await expect(withTenantTx(db, bid.value, (tx) => sql`select erase_customer(${THEIR_REQ}::uuid, ${OWNER_ID})`.execute(tx)))
      .rejects.toMatchObject({ code: 'NE004' });
    expect(await footprint(C.theirs)).toEqual({ messages: 1, identities: 1, named: 1, conversations: 1 });
    expect((await admin.query('select state from deletion_requests where id = $1', [THEIR_REQ])).rows[0].state).toBe('open');
  });

  it('A WORKER BUSY WITH THEM: nothing is erased, nothing recorded — then, once it is done, it goes', async () => {
    const { startBoss, QUEUES } = await import('../../src/queue/boss.js');
    const boss = await startBoss(DATABASE_URL!);
    let job = '';
    try {
      job = (await boss.send(QUEUES.inbound, { businessId: SHOP, conversationId: C.busy.conv, messageId: 'm', text: 'hello' }, { startAfter: 3600 }))!;
    } finally {
      await boss.stop();
    }
    await admin.query(`update pgboss.job set state = 'active', started_on = now() where id = $1`, [job]);
    const busy = await post(owner, `/app/conversations/${C.busy.conv}/deletion/erase`, { asked: '1', note: 'On WhatsApp, today' });
    expect(flashSaid(busy, SECRET)).toBe(t('en', 'data.flash.busy'));
    expect(await footprint(C.busy)).toEqual({ messages: 1, identities: 1, named: 1, conversations: 1 });
    expect(await n(`select count(*) as n from deletion_requests where client_id = $1`, [C.busy.client]), 'the request rolled back with the erasure').toBe(0);
    await admin.query(`update pgboss.job set state = 'completed', completed_on = now() where id = $1`, [job]);
    const done = await post(owner, `/app/conversations/${C.busy.conv}/deletion/erase`, { asked: '1', note: 'On WhatsApp, today' });
    expect(flashSaid(done, SECRET)).toContain(t('en', 'data.flash.erased'));
    expect(await footprint(C.busy)).toEqual({ messages: 0, identities: 0, named: 0, conversations: 0 });
    expect(await n(`select count(*) as n from pgboss.job where id = $1`, [job]), 'their finished job carried their words').toBe(0);
  });

  it('NOTHING NOTED AND NO NOTE: the owner is asked how they asked, and nothing changes; with the note, it goes', async () => {
    const none = await post(owner, `/app/conversations/${C.noted.conv}/deletion/erase`, { asked: '1' });
    expect(flashSaid(none, SECRET)).toBe(t('en', 'conv.deletion.flash.note_missing'));
    expect(await footprint(C.noted)).toEqual({ messages: 1, identities: 1, named: 1, conversations: 1 });
    const long = await post(owner, `/app/conversations/${C.noted.conv}/deletion/erase`, { asked: '1', note: 'x'.repeat(301) });
    expect(flashSaid(long, SECRET)).toBe(t('en', 'conv.deletion.flash.note_long', { n: 300 }));
    const ok = await post(owner, `/app/conversations/${C.noted.conv}/deletion/erase`, { asked: '1', note: '  By e-mail,\n 3 October ' });
    expect(String(ok.headers['location'])).toBe('/app/settings/data#buyers');
    expect(await footprint(C.noted)).toEqual({ messages: 0, identities: 0, named: 0, conversations: 0 });
    const req = (await admin.query(`select state, subject_note, closed_by from deletion_requests where client_id = $1`, [C.noted.client])).rows[0];
    expect(req).toEqual({ state: 'done', subject_note: 'By e-mail, 3 October', closed_by: OWNER_ID });
  });

  it('AN OPEN REQUEST FROM BEFORE: deleted now, from Your data, no note asked again — and it lands back on Your data', async () => {
    const page = (await get(owner, '/app/settings/data')).body;
    expect(page).toContain(`action="/app/conversations/${C.open.conv}/deletion/erase"`);
    const res = await post(owner, `/app/conversations/${C.open.conv}/deletion/erase`, { asked: '1', from: 'data' });
    expect(String(res.headers['location'])).toBe('/app/settings/data#buyers');
    expect(await footprint(C.open)).toEqual({ messages: 0, identities: 0, named: 0, conversations: 0 });
    expect((await admin.query('select state from deletion_requests where id = $1', [OPEN_REQ])).rows[0].state).toBe('done');
  });

  // ── The erasure itself ────────────────────────────────────────────────────
  it('THE OWNER DELETES what they asked for in chat: gone for real, the order and the do-not-contact note kept, nothing sent to them', async () => {
    notices.length = 0;
    const res = await post(owner, `/app/conversations/${C.chat.conv}/deletion/erase`, { asked: '1' });
    expect(res.statusCode).toBe(302);
    expect(String(res.headers['location'])).toBe('/app/settings/data#buyers');
    // What went, then each thing that stayed and why.
    expect(flashSaid(res, SECRET)).toBe([
      t('en', 'data.flash.erased'), t('en', 'data.flash.erasedOrders', { n: '1' }),
      t('en', 'data.flash.erasedDoNotContact'), t('en', 'data.flash.erasedRecord'),
    ].join(' '));

    // Gone — not hidden: no row holds their words, their number or their name.
    expect(await n('select count(*) as n from messages where conversation_id = $1', [C.chat.conv])).toBe(0);
    expect(await n('select count(*) as n from client_channels where client_id = $1', [C.chat.client])).toBe(0);
    expect(await n('select count(*) as n from deletion_asks where client_id = $1', [C.chat.client])).toBe(0);
    for (const needle of [C.chat.phone, C.chat.name, `${C.chat.name} says`]) {
      expect(await n(`select count(*) as n from clients where business_id = $1 and clients::text like $2`, [SHOP, `%${needle}%`]), needle).toBe(0);
    }
    // Kept: the client row emptied, the conversation an order points at as a closed shell, the order without contact details.
    expect((await admin.query('select display_name, phone, email from clients where id = $1', [C.chat.client])).rows[0])
      .toEqual({ display_name: null, phone: null, email: null });
    expect((await admin.query('select is_active, phase from conversations where id = $1', [C.chat.conv])).rows[0]).toEqual({ is_active: false, phase: 'closed' });
    expect((await admin.query('select client_email, shipping_address, status from orders where client_id = $1', [C.chat.client])).rows[0])
      .toEqual({ client_email: null, shipping_address: null, status: 'confirmed' });
    expect(await n(`select count(*) as n from suppressions where business_id = $1 and identity = $2`, [SHOP, C.chat.email])).toBe(1);

    // The request: recorded from their message, dated when they asked, closed as done.
    const req = (await admin.query(`select id::text as id, state, closed_by, closed_note from deletion_requests where client_id = $1`, [C.chat.client])).rows[0];
    expect(req).toMatchObject({ state: 'done', closed_by: OWNER_ID });
    expect(req.closed_note).toMatch(/· deleted by the owner in Nomi$/);

    // The record that it happened keeps nothing that was deleted: the business's trail, and the operator's ledger.
    const trail = (await admin.query(`select actor, detail from channel_audit where business_id = $1 and action = 'customer_erased' and detail->>'request' = $2`, [SHOP, req.id])).rows[0];
    expect(trail.actor).toBe(OWNER_ID);
    const ledger = (await admin.query(`select * from erasure_ledger where id = $1::uuid`, [trail.detail.erasure])).rows[0];
    expect(ledger).toMatchObject({ kind: 'customer', business_id: SHOP, customer_id: C.chat.client, request_id: req.id, via: 'owner', by_who: OWNER_ID });
    for (const personal of [C.chat.phone, C.chat.email, C.chat.name, 'please delete']) expect(JSON.stringify(ledger), personal).not.toContain(personal);

    // The operator is sent the ledger's line, ids only — the copy that outlives a restore.
    await expect.poll(() => notices.length).toBe(1);
    expect(notices[0]!.to).toBe(LEGAL);
    const line = notices[0]!.text.split('\n').find((l) => l.startsWith('{'))!;
    const parsed = parseLedgerLine(line);
    expect(parsed.ok).toBe(true);
    expect(parsed.line).toMatchObject({ id: ledger.id, kind: 'customer', customer_id: C.chat.client });
    for (const personal of [C.chat.phone, C.chat.email, C.chat.name]) expect(notices[0]!.text).not.toContain(personal);

    // Your data says it is done, and what stayed.
    const data = (await get(owner, '/app/settings/data')).body;
    expect(data).toContain(esc(t('en', 'data.buyers.kept')));
    expect(data).not.toContain(C.chat.name);
  });

  // ── The workspace ─────────────────────────────────────────────────────────
  it('CLOSING: staff refused; a wrong name refused; no script answered with a page that asks — nothing erased', async () => {
    const tried = await post(staff, '/app/settings/data/close', { name: SHOP_NAME, asked: '1' });
    expect(flashSaid(tried, SECRET)).toBe(t('en', 'staff.notAllowed'));
    const wrong = await post(owner, '/app/settings/data/close', { name: 'Not my shop', asked: '1' });
    expect(flashSaid(wrong, SECRET)).toBe(t('en', 'data.flash.name_wrong'));
    const ask = await post(owner, '/app/settings/data/close', { name: SHOP_NAME.toUpperCase(), asked: '0' });
    expect(ask.statusCode).toBe(200);
    expect(ask.body).toContain(esc(t('en', 'close.ask.title', { name: SHOP_NAME })));
    expect(ask.body).toMatch(/<input type="hidden" name="asked" value="1" \/>/);
    expect(await n('select count(*) as n from businesses where id = $1', [SHOP])).toBe(1);
    // The database refuses staff too, whatever a route does.
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(SHOP); if (!bid.ok) throw new Error('fixture');
    await expect(withTenantTx(db, bid.value, (tx) => sql`select close_workspace(${SHOP_NAME}, ${STAFF_ID})`.execute(tx))).rejects.toMatchObject({ code: 'NE003' });
  });

  it('CLOSING: the installation\'s own workspace is never closed from inside it — by the route, and by the database', async () => {
    const page = (await get(pilotCookie, '/app/settings/data')).body;
    expect(page).toContain(esc(t('en', 'data.deletion.protected')));
    expect(page).not.toContain('action="/app/settings/data/close"');
    const res = await post(pilotCookie, '/app/settings/data/close', { name: `Erasure Pilot ${RUN}`, asked: '1' });
    expect(flashSaid(res, SECRET)).toBe(t('en', 'data.flash.protected'));
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(PILOT); if (!bid.ok) throw new Error('fixture');
    await expect(withTenantTx(db, bid.value, (tx) => sql`select close_workspace(${`Erasure Pilot ${RUN}`}, 'owner')`.execute(tx))).rejects.toMatchObject({ code: 'NE006' });
    expect(await n('select count(*) as n from businesses where id = $1', [PILOT])).toBe(1);
  });

  it('CLOSING: never while a paid plan runs (closing would not cancel it)', async () => {
    await admin.query(`insert into workspace_billing (business_id, stripe_subscription_id, status) values ($1, $2, 'active')`, [SHOP, `sub_${RUN}`]);
    try {
      const res = await post(owner, '/app/settings/data/close', { name: SHOP_NAME, asked: '1' });
      expect(flashSaid(res, SECRET)).toBe(t('en', 'data.flash.paid'));
      expect(await n('select count(*) as n from businesses where id = $1', [SHOP])).toBe(1);
    } finally {
      await admin.query(`update workspace_billing set status = 'lapsed' where business_id = $1`, [SHOP]);
    }
  });

  it('CLOSED: everything erased at once, the owner signed out onto /closed, only the ledger\'s line left', async () => {
    notices.length = 0;
    const res = await post(owner, '/app/settings/data/close', { name: ` ${SHOP_NAME.toLowerCase()} `, asked: '1' });
    expect(res.statusCode).toBe(302);
    expect(String(res.headers['location'])).toBe('/closed');
    expect(String(res.headers['set-cookie'])).toMatch(/yf_session=;[^,]*Max-Age=0/);

    // Nothing of it is left: no table holds a row of this business.
    const tables = (await admin.query(`
      select n.nspname as s, c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
        join information_schema.columns k on k.table_schema = n.nspname and k.table_name = c.relname and k.column_name = 'business_id'
       where c.relkind = 'r' and n.nspname in ('public', 'shadow') and c.relname <> 'erasure_ledger'`)).rows as { s: string; t: string }[];
    const left: string[] = [];
    for (const { s, t: tbl } of tables) if (await n(`select count(*) as n from ${s}.${tbl} where business_id = $1`, [SHOP])) left.push(`${s}.${tbl}`);
    expect(left).toEqual([]);
    expect(await n('select count(*) as n from businesses where id = $1', [SHOP])).toBe(0);
    expect(await n('select count(*) as n from clients where id = any($1::uuid[])', [[C.chat.client, C.noted.client, C.open.client, C.busy.client]])).toBe(0);
    // The neighbours are untouched.
    expect(await footprint(C.theirs)).toEqual({ messages: 1, identities: 1, named: 1, conversations: 1 });

    const ledger = (await admin.query(`select kind, customer_id, via, by_who from erasure_ledger where business_id = $1 order by at`, [SHOP])).rows;
    expect(ledger.at(-1)).toEqual({ kind: 'workspace', customer_id: null, via: 'owner', by_who: OWNER_ID });
    await expect.poll(() => notices.length).toBe(1);
    expect(parseLedgerLine(notices[0]!.text.split('\n').find((l) => l.startsWith('{'))!).ok).toBe(true);

    // Where the owner lands: a public page that says what happened.
    const closed = await app.inject({ method: 'GET', url: '/closed' });
    expect(closed.statusCode).toBe(200);
    expect(closed.body).toContain(esc(t('en', 'closed.body')));
    // A session still held for the closed workspace opens nothing.
    const after = await get(staff, '/app');
    expect(after.statusCode).toBe(302);
    expect(String(after.headers['location'])).toBe('/login');
  });
});
