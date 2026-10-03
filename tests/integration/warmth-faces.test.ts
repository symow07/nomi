import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * THE WARMTH RUN (2026-10-03) — customers' faces (0123), what a customer is
 * worth, and the profile card, over Postgres and the owner's own routes:
 *
 *   - a photo is kept by the background look, served by version, and cached;
 *     another business's customer's photo is a 404 like a missing one;
 *   - a look that fails never takes a kept photo away;
 *   - who is due a look (`faces_due`): Instagram and Messenger customers of a
 *     business whose Page answers, and not again until their time comes;
 *   - spent counts the orders that stand; three make a regular; a regular
 *     whose orders stopped is "quiet";
 *   - the card's page says it all, and the waiting flag is the Inbox's rule.
 *
 * The face, the card and the script, by structure: tests/parity/warmth-faces.test.ts.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `fa0e0000-0000-4000-8000-${RUN}0001`;
const OTHER = `fa0e0000-0000-4000-8000-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('the warmth run · faces, value and the profile card (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let cookie = '';
  const ids = { maya: '', omar: '', lena: '', stranger: '', mayaConv: '', omarConv: '', product: '' };

  const as = async <R>(biz: string, fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

  const customer = async (x: Tx, biz: string, name: string, channel: string, user: string): Promise<{ client: string; conv: string }> => {
    const client = (await sql<{ id: string }>`
      insert into clients (business_id, display_name, last_seen_at)
      values (${biz}, ${name}, now() + interval '1 day') returning id::text as id`.execute(x)).rows[0]!.id;
    await sql`insert into client_channels (client_id, channel, channel_user_id) values (${client}::uuid, ${channel}, ${user})`.execute(x);
    const conv = (await sql<{ id: string }>`
      insert into conversations (business_id, client_id, channel, phase, is_active)
      values (${biz}, ${client}::uuid, ${channel}, 'warm_intake', true) returning id::text as id`.execute(x)).rows[0]!.id;
    await sql`insert into messages (conversation_id, direction, text_content, sent_at)
              values (${conv}::uuid, 'inbound', ${`hello from ${name}`}, now() - interval '2 hours')`.execute(x);
    return { client, conv };
  };
  /** An order, in an earlier conversation of the customer's own (one open order per conversation, 0003). */
  const order = async (x: Tx, client: string, channel: string, status: string, total: number, daysAgo: number) => {
    const conv = (await sql<{ id: string }>`
      insert into conversations (business_id, client_id, channel, phase, is_active)
      values (${BIZ}, ${client}::uuid, ${channel}, 'warm_intake', false)
      returning id::text as id`.execute(x)).rows[0]!.id;
    await sql`insert into messages (conversation_id, direction, text_content, sent_at)
              values (${conv}::uuid, 'inbound', 'an order', now() - make_interval(days => ${daysAgo}))`.execute(x);
    await sql`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, total_value_usd, currency, status, created_at, confirmed_at)
        values (${`W-${RUN}-${randomUUID().slice(0, 6)}`}, ${BIZ}, ${client}::uuid, ${conv}::uuid, ${ids.product}::uuid, 10, 'pcs', ${total}, 'USD', ${status},
                now() - make_interval(days => ${daysAgo}), now() - make_interval(days => ${daysAgo}))`.execute(x);
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    for (const [id, name] of [[BIZ, 'Warm Faces Co'], [OTHER, 'Other Faces Co']] as const) {
      await as(id, (x) => sql`insert into businesses (id, name, owner_locale) values (${id}, ${name}, 'en') on conflict (id) do nothing`.execute(x));
    }
    await as(BIZ, async (x) => {
      // A Page that answers: the business's photos may be looked for.
      await sql`insert into meta_accounts (business_id, page_id, page_name, token_ciphertext, fingerprint, scopes, connected_by)
                values (${BIZ}, ${`90${RUN.replace(/[^0-9]/g, '7')}001`.slice(0, 12)}, 'Warm Faces Page', 'v1.test', 'abcdefabcdef', 'pages_messaging', 'test')`.execute(x);
      ids.product = (await sql<{ id: string }>`
        insert into products (business_id, sku, name, unit, moq, is_active) values (${BIZ}, ${`WF-${RUN}`}, 'Canvas tote', 'pcs', 1, true)
        returning id::text as id`.execute(x)).rows[0]!.id;
      const maya = await customer(x, BIZ, 'Maya Rahman', 'instagram', `ig-${RUN}`);
      const omar = await customer(x, BIZ, 'Omar Haddad', 'messenger', `ms-${RUN}`);
      const lena = await customer(x, BIZ, 'Lena Brandt', 'email', `lena-${RUN}@example.test`);
      ids.maya = maya.client; ids.mayaConv = maya.conv; ids.omar = omar.client; ids.omarConv = omar.conv; ids.lena = lena.client;
      // Maya: four orders that stand (a regular), one cancelled, the last 100 days ago — "quiet".
      for (const [days, total] of [[220, 300], [190, 250], [160, 400], [100, 500]] as const) await order(x, maya.client, 'instagram', 'shipped', total, days);
      await order(x, maya.client, 'instagram', 'cancelled', 9999, 50);
      // Omar: two orders, the newest yesterday; a reply waits for the owner.
      await order(x, omar.client, 'messenger', 'confirmed', 120, 1);
      await order(x, omar.client, 'messenger', 'in_production', 80, 20);
      await sql`insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
                values (${BIZ}, ${omar.conv}::uuid, 'quote', 'A reply waiting.', null, 'pending')`.execute(x);
    });
    await as(OTHER, async (x) => {
      const s = await customer(x, OTHER, 'Someone Else', 'instagram', `ig-other-${RUN}`);
      ids.stranger = s.client;
      const { recordFace } = await import('../../src/db/faces.js');
      await recordFace(x, OTHER, s.client, { state: 'kept', type: 'image/jpeg', bytes: JPEG });
    });

    app = Fastify({ logger: false });
    const code = `faces-${RUN}`;
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({
      method: 'POST', url: '/login', payload: `code=${code}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 120_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('who is due a look: this business\'s Instagram and Messenger customers, never e-mail, newest first', async () => {
    const { facesDue } = await import('../../src/db/faces.js');
    const mine = (await facesDue(db, 200)).filter((f) => f.businessId === BIZ);
    expect(mine.map((f) => f.clientId).sort()).toEqual([ids.maya, ids.omar].sort());
    expect(mine.find((f) => f.clientId === ids.maya)).toMatchObject({ channel: 'instagram', channelUserId: `ig-${RUN}` });
    // A business whose Page does not answer is not asked at all.
    expect((await facesDue(db, 200)).some((f) => f.businessId === OTHER)).toBe(false);
  });

  it('the background look keeps the photo; it is not due again; a failure later never takes it away', async () => {
    const { fetchFaces } = await import('../../src/worker/faces.js');
    const { faceVersions, facesDue, recordFace } = await import('../../src/db/faces.js');
    const r = await fetchFaces({ db, max: 200, look: async (due) => (due.businessId !== BIZ ? { state: 'failed' }
      : due.clientId === ids.maya ? { state: 'kept', type: 'image/jpeg', bytes: JPEG } : { state: 'none' }) });
    expect(r.kept).toBeGreaterThanOrEqual(1);
    const versions = await as(BIZ, (x) => faceVersions(x, [ids.maya, ids.omar, ids.lena]));
    expect([...versions.keys()]).toEqual([ids.maya]);
    expect(versions.get(ids.maya)).toMatch(/^[0-9a-f]{12}$/);
    expect((await facesDue(db, 200)).filter((f) => f.businessId === BIZ)).toEqual([]);
    await as(BIZ, (x) => recordFace(x, BIZ, ids.maya, { state: 'failed' }));
    expect((await as(BIZ, (x) => faceVersions(x, [ids.maya]))).get(ids.maya)).toBe(versions.get(ids.maya));
  });

  it('the photo is served by its version and kept by the browser; another business\'s is a 404; signed out, nothing', async () => {
    const { faceVersions } = await import('../../src/db/faces.js');
    const v = (await as(BIZ, (x) => faceVersions(x, [ids.maya]))).get(ids.maya)!;
    const r = await get(`/app/faces/${ids.maya}?v=${v}`);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/jpeg');
    expect(r.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.rawPayload.equals(JPEG)).toBe(true);
    expect((await get(`/app/faces/${ids.maya}?v=000000000000`)).headers['cache-control']).toBe('private, no-cache');
    expect((await get(`/app/faces/${ids.stranger}?v=x`)).statusCode).toBe(404);
    expect((await get(`/app/faces/${ids.omar}`)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/app/faces/${ids.maya}` })).statusCode).toBe(401);
  });

  it('spent is the orders that stand; three make a regular; a regular who stopped ordering is quiet', async () => {
    const { customerValues } = await import('../../src/db/customerValue.js');
    const v = await as(BIZ, (x) => customerValues(x, [ids.maya, ids.omar, ids.lena]));
    expect(v.get(ids.maya)).toMatchObject({ spent: { amount: 1450, currency: 'USD' }, orders: 4, regular: true });
    expect(v.get(ids.maya)!.quietSince).not.toBeNull();
    expect(v.get(ids.omar)).toMatchObject({ spent: { amount: 200, currency: 'USD' }, orders: 2, regular: false, quietSince: null });
    expect(v.get(ids.lena)).toMatchObject({ spent: null, orders: 0, regular: false, quietSince: null });
  });

  it('the card\'s page: the photo, what was bought, spent and orders, the waiting flag by the Inbox\'s own rule, one door', async () => {
    const maya = (await get(`/app/customers/${ids.maya}`)).body;
    expect(maya).toContain('<h1 class="pc-name" id="pc-name"><bdi>Maya Rahman</bdi></h1>');
    expect(maya).toContain(`/app/faces/${ids.maya}?v=`);
    expect(maya).toContain('Canvas tote');
    expect(maya).toContain('Regular');
    expect(maya).not.toContain('class="pc-wait"');
    expect(maya).toContain(`href="/app/inbox/${ids.mayaConv}#latest"`);
    const omar = (await get(`/app/customers/${ids.omar}`)).body;
    expect(omar).toContain('class="pc-wait"');
    expect(omar).toContain('class="face-i">O</span>');
    expect(omar).not.toContain(`/app/faces/${ids.omar}`);
    expect((await get(`/app/customers/${ids.stranger}`)).statusCode).toBe(404);
    expect((await get('/app/customers/not-a-uuid')).statusCode).toBe(404);
  });
});
