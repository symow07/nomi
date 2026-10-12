import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * D7 (the data-protection audit, 2026-10-12) — A COPY OF WHAT IS KEPT ABOUT ONE
 * CUSTOMER, and the business's files name a customer by more than a display name.
 *
 * Through the real routes, row security on: one person as two customer rows
 * (WhatsApp, and an e-mail row with the same address) with messages, a price,
 * an order, a note, a stop and a deletion request; another customer beside
 * them; another business's customer. The owner's copy holds every row of the
 * person and nobody else's; a team member and another business get nothing;
 * the messages file names each message's customer id and account.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `d7c00000-0000-4000-8000-${RUN}0001`;
const OTHER = `d7c00000-0000-4000-8000-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const DIGITS = String(parseInt(RUN, 16) % 1_000_000_000).padStart(9, '0');
const PHONE = `971${DIGITS}`;
const EMAIL = `amal.${RUN}@buyer.test`;

d('D7 · a copy of one customer (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let SHOP = '';
  let owner = '';
  let staff = '';
  const C = { wa: '', mail: '', waConv: '', mailConv: '', other: '', otherConv: '', theirs: '', theirsConv: '' };

  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const one = async (q: string, p: unknown[]) => (await admin.query(q, p)).rows[0];

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { makeSessionCodec } = await import('../../src/api/web/session.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const made = await provisionAccount(db, {
      factory: `Copy Shop ${RUN}`, language: 'en', ownerName: 'Lena', email: `lena.${RUN}@shop.test`,
      passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
      profile: { kind: 'retail', sells: 'candles', country: 'AE', website: null, teamSize: '1', channels: [] },
    });
    if (made.code !== 'created') throw new Error(made.code);
    SHOP = made.businessId;
    const staffId = (await one(`insert into people (business_id, name, is_owner) values ($1, 'Xiao Chen', false) returning id::text as id`, [SHOP])).id;
    for (const [id, name] of [[PILOT, `Copy Pilot ${RUN}`], [OTHER, `Copy Other ${RUN}`]] as const) {
      await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [id, name]);
    }
    const customer = async (biz: string, name: string | null, phone: string | null, email: string | null, channel: string, account: string, said: string) => {
      const client = (await one(`insert into clients (business_id, display_name, phone, email) values ($1, $2, $3, $4) returning id::text as id`, [biz, name, phone, email])).id as string;
      await admin.query(`insert into client_channels (client_id, channel, channel_user_id) values ($1, $2, $3)`, [client, channel, account]);
      const conv = (await one(`insert into conversations (business_id, client_id, channel) values ($1, $2, $3) returning id::text as id`, [biz, client, channel])).id as string;
      await admin.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'inbound', $2, now() - interval '1 hour')`, [conv, said]);
      return { client, conv };
    };
    const wa = await customer(SHOP, `Amal ${RUN}`, PHONE, EMAIL, 'whatsapp', PHONE, `wa-said-${RUN}`);
    const mail = await customer(SHOP, null, null, EMAIL, 'email', EMAIL, `mail-said-${RUN}`);
    const other = await customer(SHOP, `Bilal ${RUN}`, `972${DIGITS}`, null, 'whatsapp', `972${DIGITS}`, `bilal-said-${RUN}`);
    // A channel account is one customer row across every business (client_channels is unique on it): the same
    // person in another business holds the number and address on the row, and writes there on Instagram.
    const theirs = await customer(OTHER, `Amal elsewhere ${RUN}`, PHONE, EMAIL, 'instagram', `ig-theirs-${RUN}`, `theirs-said-${RUN}`);
    Object.assign(C, { wa: wa.client, waConv: wa.conv, mail: mail.client, mailConv: mail.conv, other: other.client, otherConv: other.conv, theirs: theirs.client, theirsConv: theirs.conv });

    await admin.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'outbound', $2, now())`, [wa.conv, `reply-${RUN}`]);
    const product = (await one(`insert into products (business_id, sku, name) values ($1, $2, 'Candle') returning id::text as id`, [SHOP, `CP-${RUN}`])).id;
    await admin.query(`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version)
                       values ($1, $2, $3, 40, '{}'::jsonb, 2.5, 100, 'test')`, [SHOP, wa.conv, product]);
    await admin.query(`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, client_email, shipping_address, status)
                       values ($1, $2, $3, $4, $5, 40, 'pcs', $6, $7, 'confirmed')`, [`CP-${RUN}`, SHOP, wa.client, wa.conv, product, EMAIL, `9 Cedar St ${RUN}`]);
    await admin.query(`insert into conversation_notes (business_id, conversation_id, note) values ($1, $2, $3)`, [SHOP, mail.conv, `note-${RUN}`]);
    await admin.query(`insert into suppressions (business_id, channel, identity, reason) values ($1, 'email', $2, 'unsubscribed')`, [SHOP, EMAIL]);
    await admin.query(`insert into deletion_requests (business_id, scope, client_id, asked_by, state, closed_at, closed_by)
                       values ($1, 'buyer', $2, 'owner', 'withdrawn', now(), 'owner')`, [SHOP, mail.client]);

    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: PILOT, accessCode: `copy-${RUN}`, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, factsTtlMs: 0,
      messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const codec = makeSessionCodec(SECRET);
    const exp = Date.now() + 3_600_000;
    owner = `yf_session=${codec.sign({ businessId: SHOP, exp, person: { id: made.personId, name: 'Lena', isOwner: true } })}`;
    staff = `yf_session=${codec.sign({ businessId: SHOP, exp, person: { id: staffId, name: 'Xiao Chen', isOwner: false } })}`;
  }, 120_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); await admin?.end(); });

  it('the owner\'s copy holds every row of the person, every kind of record, and nobody else', async () => {
    const res = await get(owner, `/app/conversations/${C.mailConv}/copy.csv`);
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/csv');
    expect(String(res.headers['content-disposition'])).toMatch(/^attachment; filename="nomi-customer-copy-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(String(res.headers['cache-control'])).toContain('no-store');
    const body = res.body;
    expect(body.split('\r\n')[0]).toContain('section');
    // Both rows of the same person, by id: asked from the e-mail row, the WhatsApp row is in it too.
    for (const id of [C.wa, C.mail]) expect(body).toContain(id);
    for (const v of [`Amal ${RUN}`, PHONE, EMAIL, `wa-said-${RUN}`, `mail-said-${RUN}`, `reply-${RUN}`, `CP-${RUN}`, `9 Cedar St ${RUN}`, `note-${RUN}`, '40 × 2.50 = 100.00 USD']) {
      expect(body, v).toContain(v);
    }
    for (const section of ['who they are', 'messages', 'prices given', 'orders', 'notes the business wrote', 'what they asked']) expect(body, section).toContain(section);
    expect(body).toContain('do not contact');
    expect(body).toContain('deletion request');
    // Nobody else's.
    for (const v of [C.other, `bilal-said-${RUN}`, C.theirs, `theirs-said-${RUN}`]) expect(body, v).not.toContain(v);
    const trail = await one(`select detail from channel_audit where business_id = $1 and action = 'export_data' order by id desc limit 1`, [SHOP]);
    expect(trail.detail).toEqual({ subject: 'customer-copy', rows: expect.any(Number) });
  });

  it('the buyer page offers it to the owner, never to a team member, who is refused the file too', async () => {
    expect((await get(owner, `/app/conversations/${C.waConv}`)).body).toContain(`/app/conversations/${C.waConv}/copy.csv`);
    expect((await get(staff, `/app/conversations/${C.waConv}`)).body).not.toContain('/copy.csv');
    const refused = await get(staff, `/app/conversations/${C.waConv}/copy.csv`);
    expect(String(refused.headers['content-type'] ?? '')).not.toContain('text/csv');
  });

  it('another business\'s customer is not reachable', async () => {
    const res = await get(owner, `/app/conversations/${C.theirsConv}/copy.csv`);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(`theirs-said-${RUN}`);
  });

  it('the messages file names each message\'s customer by id and account, not only by a name', async () => {
    const body = (await get(owner, '/app/settings/data/messages.csv')).body;
    const head = body.split('\r\n')[0]!;
    expect(head).toContain('customer id');
    expect(head).toContain('account');
    const line = body.split('\r\n').find((l) => l.includes(`mail-said-${RUN}`))!;
    expect(line).toContain(C.mail);
    expect(line).toContain(EMAIL);
    expect((await get(owner, '/app/settings/data/customers.csv')).body.split('\r\n')[0]).toContain('customer id');
  });
});
