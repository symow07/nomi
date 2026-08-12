import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';
import type { PageTranscriber } from '../../src/llm/ports.js';

/**
 * M37 — the photograph path, through a real request and into real rows.
 *
 * The parity suite proves the composition. It cannot prove that a multipart
 * request reaches it, that the limits are actually enforced by the parser
 * rather than merely written down, or that what confirm WRITES matches what the
 * review SHOWED — and that last one is the whole safety argument of this
 * feature, so it is asserted against the products table rather than a value.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd370000-0000-4000-8000-${RUN}0001`;

/** The page the camera "saw" — a real price sheet has furniture on it too. */
const PAGE = [
  'TIANHE TEXTILE CO., LTD',
  '2026 WHOLESALE PRICE LIST',
  'Photo tote bag  PT-100   $1.05   MOQ 500',
  'Photo cup       PC-220   $2.60   MOQ 1000',
  'Thank you for your order',
].join('\n');

const BOUNDARY = '----nomiPhotoTest';
const multipart = (bytes: Buffer, mime = 'image/jpeg', filename = 'page.jpg') => Buffer.concat([
  Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="page"; filename="${filename}"\r\n`
    + `Content-Type: ${mime}\r\n\r\n`),
  bytes,
  Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
]);

d('M37 · photograph the price list, end to end (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  let transcript = PAGE;
  let unreadable = false;
  const CODE = 'photo-import-code';

  const transcriber: PageTranscriber = {
    transcribe: async () => ({
      text: unreadable ? '' : transcript, unreadable,
      promptVersion: 'test', modelId: 'test', usage: { inputTokens: 1, outputTokens: 1 },
    }),
  };

  const shoot = (bytes = Buffer.from('not-really-a-jpeg'), mime = 'image/jpeg') =>
    app.inject({
      method: 'POST', url: '/app/products/add/photo',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipart(bytes, mime),
    });

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    await withTenantTx(db, bid.value, async (tx) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Photo Import Factory')
                on conflict (id) do nothing`.execute(tx);
    });

    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE,
      sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      pageTranscriber: transcriber,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = await app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  const products = async (): Promise<{ sku: string; name: string; price: string | null }[]> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, (tx) => sql<{ sku: string; name: string; price_usd_per_unit: string | null }>`
      select sku, name, price_usd_per_unit from products where business_id = ${BIZ} order by sku
    `.execute(tx).then((r) => r.rows.map((x) => ({ sku: x.sku, name: x.name, price: x.price_usd_per_unit }))));
  };

  /** The value the review staged for confirm, as the browser would repost it. */
  const staged = (html: string): string => {
    const m = /<input type="hidden" name="text" value="([\s\S]*?)" \/>/.exec(html);
    expect(m, 'the review staged nothing for confirm').not.toBeNull();
    return m![1]!.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  };

  it('THE PRODUCTION ROUTE: a photographed page comes back as a review', async () => {
    const res = await shoot();
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Photo tote bag');
    expect(res.body).toContain('Photo cup');
    // and each product carries the line it was read from
    expect(res.body).toContain('Read from:');
    expect(res.body).toContain('Photo tote bag  PT-100   $1.05   MOQ 500');
  });

  it('the letterhead is SHOWN as skipped, and is not staged for confirm', async () => {
    const res = await shoot();
    expect(res.body).toContain('TIANHE TEXTILE CO., LTD');
    expect(res.body).toContain('no price on this line');
    const text = staged(res.body);
    expect(text).not.toContain('TIANHE TEXTILE');
    expect(text).not.toContain('Thank you for your order');
  });

  it('CONFIRM WRITES EXACTLY WHAT THE REVIEW SHOWED — no letterhead in the catalogue', async () => {
    const review = await shoot();
    const confirm = await app.inject({
      method: 'POST', url: '/app/products/add/confirm',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ text: staged(review.body) }).toString(),
    });
    expect(confirm.statusCode).toBe(302);
    const rows = await products();
    // Two priced lines on the page, two rows in the catalogue. The article
    // number stays inside the name here because it sits mid-line rather than at
    // the start — the parser's own rule, unchanged by this milestone.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual(['Photo cup PC-220', 'Photo tote bag PT-100']);
    expect(rows.map((r) => Number(r.price)).sort()).toEqual([1.05, 2.6]);
    expect(rows.every((r) => r.price !== null), 'a priceless row reached the catalogue').toBe(true);
    expect(rows.some((r) => r.name.includes('TIANHE')), 'the letterhead became a product').toBe(false);
    expect(rows.some((r) => r.name.includes('Thank you')), 'the footer became a product').toBe(false);
  });

  it('AN UNREADABLE PAGE IMPORTS NOTHING — not even the lines that were clear', async () => {
    const before = await products();
    unreadable = true;
    const res = await shoot();
    unreadable = false;
    expect(res.statusCode).toBe(200);
    // the UNREADABLE sentence specifically, not the shared refusal title — a
    // page that fell through to "no product lines" would say something else,
    // and the two ask her to do different things.
    expect(res.body).toContain('Nothing on the page came out clearly enough to read');
    // no review, no confirm form, no rows
    expect(res.body).not.toContain('name="text"');
    expect(await products()).toEqual(before);
  });

  it('a page with no priced line refuses instead of showing an empty list', async () => {
    transcript = 'DELIVERY NOTE\nReceived in good order';
    const res = await shoot();
    transcript = PAGE;
    expect(res.body).toContain('no line on it looks like a product with a price');
    expect(res.body).not.toContain('name="text"');
  });

  it('THE FILE-SIZE LIMIT ACTUALLY BITES, IN BOTH DIRECTIONS', async () => {
    // Asserted through real requests, because a limit that only exists in an
    // options object is a comment — and pinned from BELOW as well as above,
    // because the inherited default (Fastify's 1 MB bodyLimit) is smaller than
    // a phone photo. A test that only checks "9 MB is refused" passes with the
    // limit deleted, and the feature would then refuse every real photograph.
    const before = await products();

    const real = await shoot(Buffer.alloc(4 * 1024 * 1024, 0x41));   // a phone photo
    expect(real.statusCode).toBe(200);
    expect(real.body, 'a 4 MB photo — the ordinary case — was refused').not.toContain('too large to read');

    const huge = await shoot(Buffer.alloc(9 * 1024 * 1024, 0x41));   // past the ceiling
    expect(huge.statusCode).toBe(200);
    expect(huge.body).toContain('too large to read');

    expect(await products()).toEqual(before);
  });

  it('a file that is not an image is refused, whatever it is named', async () => {
    const res = await shoot(Buffer.from('%PDF-1.4 not an image'), 'application/pdf');
    expect(res.body).toContain('could not read this page');
  });

  it('and the route needs a session, like every other owner surface', async () => {
    const res = await app.inject({
      method: 'POST', url: '/app/products/add/photo',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipart(Buffer.from('x')),
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });
});
