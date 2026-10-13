import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant, flashSaid, flashWasRefusal } from './tenant.js';

/**
 * Phase 2d (the owner's roadmap and word, 2026-10-13; 0152) — A PRODUCT'S PHOTO, SENT IN AN INSTAGRAM CHAT, end to
 * end against real Postgres and the real route table:
 *
 *   the owner keeps the product's photo on its page (what it is read from its own bytes; staff refused, nothing
 *   written) → Nomi serves it at an unguessable address, the bytes and nothing else → the owner, holding the
 *   conversation, sends it: one picture row on the one outbound path, at that address, which the worker's own rule
 *   (`servedByNomi`) accepts → replacing it moves the address, removing it ends it (404).
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const id = (n: number) => `cc2d0000-0000-4000-8000-${RUN}${String(n).padStart(4, '0')}`;
const BIZ = id(1); const CLIENT = id(2); const CONV = id(3); const PROD = id(4); const BARE = id(5);
const SECRET = 'a-test-session-secret-of-sufficient-length';
const CODE = 'product-photos-owner-code';
const STAFF_CODE = `PHOTO-${RUN.toUpperCase()}`;
const BASE = 'https://nomi.example.com';
const BOUNDARY = '----phase2d';

/** A tiny PNG: its eight-byte signature and a little more. What it IS comes from these bytes, never the label. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`ihdr-${RUN}`)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`jfif-${RUN}`)]);

d('Phase 2d · a product photo, kept, served and sent (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let owner = '';
  let staff = '';
  let token = '';

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const login = async (code: string) => String((await app.inject({
    method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const upload = (cookie: string, product: string, bytes: Buffer, label = 'image/png') => app.inject({
    method: 'POST', url: `/app/products/${product}/photo`,
    headers: { cookie, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: Buffer.concat([
      Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="photo"; filename="tote.png"\r\nContent-Type: ${label}\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
  });
  const post = (cookie: string, url: string, payload = '') => app.inject({
    method: 'POST', url, payload, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  });
  const tokenOf = (product: string) => tx((t) => sql<{ token: string | null }>`
    select token from product_images where product_id = ${product} and token is not null`.execute(t).then((r) => r.rows[0]?.token ?? null));

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { hashCode } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Photo Test Canvas')`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, is_active)
                values (${PROD}, ${BIZ}, ${'PH-' + RUN}, 'Canvas tote', 'pcs', true), (${BARE}, ${BIZ}, ${'PB-' + RUN}, 'Linen apron', 'pcs', true)`.execute(t);
      await sql`insert into people (business_id, name, code_hash) values (${BIZ}, 'Xiao Chen', ${hashCode(SECRET, STAFF_CODE)})`.execute(t);
      // An image from before (an address, no bytes), already the product's primary one: a photo kept now must not
      // collide with it (one primary image per product).
      await sql`insert into product_images (product_id, url, is_primary, sort_order) values (${PROD}, '/older/tote.jpg', true, 1)`.execute(t);
      await sql`insert into clients (id, business_id, display_name) values (${CLIENT}, ${BIZ}, 'Amira')`.execute(t);
      // The customer wrote an hour ago: inside Instagram's 24 hours, as the send window reads it.
      await sql`insert into client_channels (client_id, channel, channel_user_id, last_inbound_at)
                values (${CLIENT}, 'instagram', ${'igsid-' + RUN}, now() - interval '1 hour')`.execute(t);
      await sql`insert into conversations (id, business_id, client_id, channel) values (${CONV}, ${BIZ}, ${CLIENT}, 'instagram')`.execute(t);
      await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
                values (${CONV}, ${'ig-' + RUN}, 'inbound', 'text', 'Do you have a photo of the tote?', now() - interval '1 hour')`.execute(t);
    });
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: true, publicBaseUrl: BASE,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    owner = await login(CODE);
    staff = await login(STAFF_CODE);
    expect(owner).not.toBe('');
    expect(staff).not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('STAFF are refused, and nothing is kept; the page shows them no form', async () => {
    const res = await upload(staff, PROD, PNG);
    expect(flashWasRefusal(res, SECRET)).toBe(true);
    expect(await tokenOf(PROD)).toBeNull();
    const page = await app.inject({ method: 'GET', url: `/app/products/${PROD}`, headers: { cookie: staff } });
    expect(page.body).not.toContain(`action="/app/products/${PROD}/photo"`);
  });

  it('a file that is not a photo is refused by its own bytes, whatever its label says', async () => {
    const res = await upload(owner, PROD, Buffer.from(`GIF89a-${RUN}`), 'image/png');
    expect(flashSaid(res, SECRET)).toBe('That file is not a JPEG, PNG or WebP photo. Nothing was saved.');
    expect(await tokenOf(PROD)).toBeNull();
  });

  it('the owner keeps it: the page draws it from Nomi, and Nomi serves the bytes and nothing else', async () => {
    const res = await upload(owner, PROD, PNG);
    expect(flashSaid(res, SECRET)).toBe('Photo saved. You can send it from a conversation you hold.');
    token = (await tokenOf(PROD))!;
    expect(token.length).toBeGreaterThanOrEqual(43);
    const page = await app.inject({ method: 'GET', url: `/app/products/${PROD}`, headers: { cookie: owner } });
    expect(page.body).toContain(`<img src="/media/${token}"`);
    expect(page.body).toContain(`action="/app/products/${PROD}/photo/remove"`);
    const served = await app.inject({ method: 'GET', url: `/media/${token}` });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['cache-control']).toBe('no-store');
    expect(served.rawPayload.equals(PNG)).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/media/${'q'.repeat(43)}` })).statusCode).toBe(404);
  });

  it('the conversation offers it only to whoever holds it; sent, it is one picture row on the one path, at Nomi’s address', async () => {
    const before = await app.inject({ method: 'GET', url: `/app/inbox/${CONV}`, headers: { cookie: owner } });
    expect(before.body).not.toContain(`/app/inbox/${CONV}/photo`);
    // Not held: refused, nothing queued.
    const early = await post(owner, `/app/inbox/${CONV}/photo`, `product=${PROD}`);
    expect(flashWasRefusal(early, SECRET)).toBe(true);
    expect((await post(owner, `/app/inbox/${CONV}/takeover`)).statusCode).toBe(302);
    const held = await app.inject({ method: 'GET', url: `/app/inbox/${CONV}`, headers: { cookie: owner } });
    expect(held.body).toContain(`action="/app/inbox/${CONV}/photo"`);
    expect(held.body).toContain(`<option value="${PROD}">Canvas tote</option>`);
    expect(held.body).not.toContain(`<option value="${BARE}">`);

    const sent = await post(owner, `/app/inbox/${CONV}/photo`, `product=${PROD}`);
    expect(flashSaid(sent, SECRET)).toBe('Your photo is waiting to send.');
    const rows = await tx((t) => sql<{ kind: string; media_url: string | null; body: string; origin: string; channel: string }>`
      select kind, media_url, body, origin, channel from outbound_messages where conversation_id = ${CONV}`.execute(t).then((r) => r.rows));
    expect(rows).toEqual([{ kind: 'image', media_url: `${BASE}/media/${token}`, body: '', origin: 'owner', channel: 'instagram' }]);
    const { servedByNomi } = await import('../../src/outbound/worker.js');
    expect(servedByNomi(rows[0]!.media_url!, BASE)).toBe(true);
    const events = await tx((t) => sql<{ payload: { productId?: string } }>`
      select payload from conversation_events where conversation_id = ${CONV} and type = 'owner_photo'`.execute(t).then((r) => r.rows));
    expect(events.map((e) => e.payload.productId)).toEqual([PROD]);
  });

  it('a product with no photo sends nothing, and says so', async () => {
    const res = await post(owner, `/app/inbox/${CONV}/photo`, `product=${BARE}`);
    expect(flashSaid(res, SECRET)).toBe('That product has no photo. Add one on its page.');
    const n = await tx((t) => sql<{ n: number }>`select count(*)::int as n from outbound_messages where conversation_id = ${CONV}`
      .execute(t).then((r) => r.rows[0]!.n));
    expect(n).toBe(1);
  });

  it('replacing it moves the address (the old one is gone at once); removing it ends it', async () => {
    await upload(owner, PROD, JPEG, 'image/jpeg');
    const fresh = (await tokenOf(PROD))!;
    expect(fresh).not.toBe(token);
    expect((await app.inject({ method: 'GET', url: `/media/${token}` })).statusCode).toBe(404);
    const served = await app.inject({ method: 'GET', url: `/media/${fresh}` });
    expect(served.headers['content-type']).toBe('image/jpeg');
    const kept = await tx((t) => sql<{ n: number; primary: boolean }>`
      select count(*)::int as n, bool_or(is_primary) as primary from product_images where product_id = ${PROD} and token is not null`
      .execute(t).then((r) => r.rows[0]!));
    // One photo Nomi serves; the older image keeps its place as the primary one.
    expect(kept).toEqual({ n: 1, primary: false });
    const older = await tx((t) => sql<{ is_primary: boolean }>`select is_primary from product_images where product_id = ${PROD} and url = '/older/tote.jpg'`
      .execute(t).then((r) => r.rows[0]!.is_primary));
    expect(older).toBe(true);

    const staffRemove = await post(staff, `/app/products/${PROD}/photo/remove`);
    expect(flashWasRefusal(staffRemove, SECRET)).toBe(true);
    expect(await tokenOf(PROD)).toBe(fresh);
    const removed = await post(owner, `/app/products/${PROD}/photo/remove`);
    expect(flashSaid(removed, SECRET)).toBe('Photo removed.');
    expect(await tokenOf(PROD)).toBeNull();
    expect((await app.inject({ method: 'GET', url: `/media/${fresh}` })).statusCode).toBe(404);
  });

  it('the app role reaches the bytes only through the token, and removes only through the one function', async () => {
    await expect(tx((t) => sql`delete from product_images where product_id = ${PROD}`.execute(t))).rejects.toThrow(/permission denied/);
    for (const probe of ['', 'short', 'q'.repeat(43)]) {
      const r = await sql<{ n: number }>`select count(*)::int as n from product_photo(${probe})`.execute(db);
      expect(r.rows[0]!.n, probe).toBe(0);
    }
  });
});
