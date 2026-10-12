import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { flashSaid } from './tenant.js';
import { t } from '../../src/core/owner/i18n/messages.js';
// @ts-expect-error — the operator tools, plain JS on purpose.
import { parseLedgerLine } from '../../tools/replay-erasures.mjs';

/**
 * D3 (the data-protection audit, 2026-10-12; 0139) — A CUSTOMER'S ERASURE
 * REACHES THE SAME PERSON ON EVERY CHANNEL.
 *
 * One person, three customer rows in one shop: WhatsApp (P), Instagram (Q,
 * whose profile holds the same phone number, written another way, and an
 * e-mail address) and e-mail (R, that address in capitals). P and R share
 * nothing directly: R is reached through Q. Beside them, a different person
 * (S) in the same shop, and the same person (T) in another shop.
 *
 * Through the real routes, row security on: the buyer page names Q and R
 * before anything is pressed; deleting P deletes P, Q and R — rows gone, not
 * hidden — closes R's own open request, writes a ledger line for each row and
 * mails the operator all three; S and T keep every row. Over the limit, the
 * database refuses and nothing changes.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `d3a50000-0000-4000-8000-${RUN}0001`;
const OTHER = `d3a50000-0000-4000-8000-${RUN}0002`;
const CROWD = `d3a50000-0000-4000-8000-${RUN}0003`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const LEGAL = 'privacy@nomi.test';
const DIGITS = String(parseInt(RUN, 16) % 1_000_000_000).padStart(9, '0');
const PHONE = `971${DIGITS}`;
const PHONE_WRITTEN = `+971 ${DIGITS.slice(0, 2)} ${DIGITS.slice(2, 5)} ${DIGITS.slice(5)}`;
const EMAIL = `rania.${RUN}@buyer.test`;
const IG = `ig-${RUN}`;

type Row = { client: string; conv: string; name: string };

d('D3 · the erasure reaches the same person on every channel (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let SHOP = '';
  let OWNER_ID = '';
  let owner = '';
  let R_REQ = '';
  const notices: { to: string; subject: string; text: string }[] = [];
  const reported: unknown[] = [];
  const R: Record<'p' | 'q' | 'r' | 's' | 't', Row> = {} as Record<'p' | 'q' | 'r' | 's' | 't', Row>;

  const post = (cookie: string, url: string, fields: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const n = async (q: string, p: unknown[]) => Number((await admin.query(q, p)).rows[0].n);
  const footprint = async (r: Row) => ({
    messages: await n('select count(*) as n from messages where conversation_id = $1', [r.conv]),
    identities: await n('select count(*) as n from client_channels where client_id = $1', [r.client]),
    named: await n('select count(*) as n from clients where id = $1 and (display_name is not null or phone is not null or email is not null)', [r.client]),
    conversations: await n('select count(*) as n from conversations where client_id = $1', [r.client]),
  });
  const WHOLE = { messages: 1, identities: 1, named: 1, conversations: 1 };
  const GONE = { messages: 0, identities: 0, named: 0, conversations: 0 };

  const row = async (biz: string, name: string, cols: { phone?: string; email?: string }, channel: string, account: string): Promise<Row> => {
    const client = (await admin.query(`insert into clients (business_id, display_name, phone, email) values ($1, $2, $3, $4) returning id::text as id`,
      [biz, name, cols.phone ?? null, cols.email ?? null])).rows[0].id as string;
    await admin.query(`insert into client_channels (client_id, channel, channel_user_id) values ($1, $2, $3)`, [client, channel, account]);
    const conv = (await admin.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, $3) returning id::text as id`,
      [biz, client, channel])).rows[0].id as string;
    await admin.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'inbound', $2, now())`,
      [conv, `${name} writes`]);
    return { client, conv, name };
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { makeSessionCodec } = await import('../../src/api/web/session.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();

    const made = await provisionAccount(db, {
      factory: `Same Person Shop ${RUN}`, language: 'en', ownerName: 'Lena', email: `lena.${RUN}@shop.test`,
      passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
      profile: { kind: 'retail', sells: 'candles', country: 'AE', website: null, teamSize: '1', channels: [] },
    });
    if (made.code !== 'created') throw new Error(made.code);
    SHOP = made.businessId;
    OWNER_ID = made.personId;
    for (const [id, name] of [[PILOT, `Same Pilot ${RUN}`], [OTHER, `Same Other ${RUN}`], [CROWD, `Same Crowd ${RUN}`]] as const) {
      await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [id, name]);
    }

    R.p = await row(SHOP, `Rania WA ${RUN}`, { phone: PHONE }, 'whatsapp', PHONE);
    R.q = await row(SHOP, `rania.ig ${RUN}`, { phone: PHONE_WRITTEN, email: EMAIL }, 'instagram', IG);
    R.r = await row(SHOP, `Rania Mail ${RUN}`, { email: EMAIL.toUpperCase() }, 'email', EMAIL.toUpperCase());
    R.s = await row(SHOP, `Samir ${RUN}`, { phone: `972${DIGITS}`, email: `samir.${RUN}@buyer.test` }, 'whatsapp', `972${DIGITS}`);
    // A channel account is one customer row across every business (client_channels is unique on it), so the
    // same person in another shop holds the number and address on the row, and writes there on Instagram.
    R.t = await row(OTHER, `Rania elsewhere ${RUN}`, { phone: PHONE, email: EMAIL }, 'instagram', `ig-elsewhere-${RUN}`);
    // The owner had already recorded a request for the e-mail row, by itself.
    R_REQ = (await admin.query(`insert into deletion_requests (business_id, scope, client_id, asked_by, subject_note) values ($1, 'buyer', $2, 'owner', 'By e-mail') returning id::text as id`,
      [SHOP, R.r.client])).rows[0].id;

    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: PILOT, accessCode: `same-${RUN}`, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, factsTtlMs: 0,
      messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
      legalContact: LEGAL,
      systemMail: { from: 'nomi@nomi.test', send: async (x: { to: string; subject: string; text: string }) => { notices.push(x); return { ok: true as const }; } },
      reportError: async (e: unknown) => { reported.push(e); },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const codec = makeSessionCodec(SECRET);
    owner = `yf_session=${codec.sign({ businessId: SHOP, exp: Date.now() + 3_600_000, person: { id: OWNER_ID, name: 'Lena', isOwner: true } })}`;
  }, 120_000);

  afterAll(async () => {
    await admin?.query(`update deletion_requests set state = 'withdrawn', closed_at = now(), closed_by = 'test-cleanup'
                         where state = 'open' and business_id = any($1::uuid[])`, [[SHOP, OTHER, PILOT, CROWD]]).catch(() => undefined);
    await app?.close(); await db?.destroy(); await admin?.end();
  });

  it('the database finds the same person through any shared identity, onward, inside one business only', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const shop = parseBusinessId(SHOP);
    if (!shop.ok) throw new Error('shop id');
    const of = async (client: string) => (await withTenantTx(db, shop.value, async (tx) => (await sql<{ id: string }>`
      select x::text as id from customer_same_person(${client}::uuid) as x`.execute(tx)).rows.map((r) => r.id).sort()));
    expect(await of(R.p.client)).toEqual([R.q.client, R.r.client].sort());
    expect(await of(R.r.client)).toEqual([R.p.client, R.q.client].sort());
    expect(await of(R.s.client)).toEqual([]);
    // Another business's customer, asked about from this workspace: nobody.
    expect(await of(R.t.client)).toEqual([]);
  });

  it('the buyer page names the other rows before anything is pressed — and so does the page that asks', async () => {
    const page = (await get(owner, `/app/conversations/${R.p.conv}`)).body;
    const line = page.slice(page.indexOf('id="same-person"'), page.indexOf('</p>', page.indexOf('id="same-person"')));
    expect(line).toContain(`rania.ig ${RUN}`);
    expect(line).toContain(`Rania Mail ${RUN}`);
    expect(line).toContain('Instagram');
    expect(line).not.toContain('Samir');
    expect((await get(owner, `/app/conversations/${R.s.conv}`)).body).not.toContain('id="same-person"');

    const ask = await post(owner, `/app/conversations/${R.p.conv}/deletion/erase`, { asked: '0', note: 'On WhatsApp, today' });
    expect(ask.statusCode).toBe(200);
    expect(ask.body).toContain('id="same-person"');
    expect(ask.body).toContain(`Rania Mail ${RUN}`);
    for (const r of [R.p, R.q, R.r, R.s, R.t]) expect(await footprint(r)).toEqual(WHOLE);
  });

  it('deleting one row deletes the same person on every channel, and nobody else', async () => {
    notices.length = 0;
    const res = await post(owner, `/app/conversations/${R.p.conv}/deletion/erase`, { asked: '1', note: 'On WhatsApp, today' });
    const said = flashSaid(res, SECRET);
    expect(said).toContain(t('en', 'data.flash.erased'));
    expect(said).toContain(t('en', 'data.flash.erasedSamePerson', { n: '2' }));
    expect(reported).toEqual([]);

    for (const r of [R.p, R.q, R.r]) expect(await footprint(r), r.name).toEqual(GONE);
    for (const r of [R.s, R.t]) expect(await footprint(r), r.name).toEqual(WHOLE);
    expect(await n(`select count(*) as n from clients where business_id = $1 and (phone = $2 or lower(email) = $3)`, [SHOP, PHONE, EMAIL])).toBe(0);

    // The request carried out, with what the other rows added; R's own request answered by it.
    const req = (await admin.query(`select id::text as id, state, closed_note from deletion_requests where business_id = $1 and client_id = $2`, [SHOP, R.p.client])).rows[0];
    expect(req.state).toBe('done');
    expect(req.closed_note).toMatch(/ · the same person's 2 other customer records too, erased \d+: .*\bmessages 2\b/);
    const theirs = (await admin.query(`select state, closed_note from deletion_requests where id = $1`, [R_REQ])).rows[0];
    expect(theirs).toEqual({ state: 'done', closed_note: `carried out with request ${req.id}: the same person` });

    // A ledger line for every row, so a restore erases each again; the operator is mailed all of them.
    const ledger = (await admin.query(`select id::text as id, customer_id::text as customer from erasure_ledger where request_id = $1 order by at, id`, [req.id])).rows;
    expect(ledger.map((l: { customer: string }) => l.customer).sort()).toEqual([R.p.client, R.q.client, R.r.client].sort());
    await expect.poll(() => notices.length).toBe(1);
    const lines = notices[0]!.text.split('\n').filter((l) => l.startsWith('{'));
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(parseLedgerLine(l).ok).toBe(true);
    expect(lines.map((l) => JSON.parse(l).id).sort()).toEqual(ledger.map((l: { id: string }) => l.id).sort());
    for (const personal of [PHONE, EMAIL, IG, R.p.name, R.q.name]) expect(notices[0]!.text).not.toContain(personal);
    // D12 (0141) — the mail went, so its lines are noted: the fifteen-minute job does not send them again.
    await expect.poll(async () => (await admin.query(`select count(*)::int as n from erasure_ledger_mailed where ledger_id = any($1::uuid[])`,
      [ledger.map((l: { id: string }) => l.id)])).rows[0].n).toBe(3);
  });

  it('more rows than one person has: refused by the database, nothing changed', async () => {
    const shared = `everyone.${RUN}@crowd.test`;
    const ids: string[] = [];
    for (let i = 0; i < 21; i++) {
      ids.push((await admin.query(`insert into clients (business_id, display_name, email) values ($1, $2, $3) returning id::text as id`,
        [CROWD, `Crowd ${i} ${RUN}`, shared])).rows[0].id);
    }
    const req = (await admin.query(`insert into deletion_requests (business_id, scope, client_id, asked_by) values ($1, 'buyer', $2, 'owner') returning id::text as id`,
      [CROWD, ids[0]])).rows[0].id;
    await expect(admin.query(`select carry_out_customer_request($1::uuid, $2::uuid, 'Operator Test', 'operator')`, [CROWD, req]))
      .rejects.toMatchObject({ code: 'NE011' });
    expect(await n(`select count(*) as n from clients where business_id = $1 and email = $2`, [CROWD, shared])).toBe(21);
    expect((await admin.query(`select state from deletion_requests where id = $1`, [req])).rows[0].state).toBe('open');
  });
});
