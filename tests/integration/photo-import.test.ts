import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';
import type { PageTranscriber } from '../../src/llm/ports.js';
import { postPhotos, importAt, submitReview, formFields } from './importReview.js';

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

d('M37 · photograph the price list, end to end (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  let transcript = PAGE;
  let unreadable = false;
  let reads = 0;
  const CODE = 'photo-import-code';

  const transcriber: PageTranscriber = {
    transcribe: async () => {
      reads++;
      return {
        text: unreadable ? '' : transcript, unreadable,
        promptVersion: 'test', modelId: 'test', usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };

  const shoot = (bytes = Buffer.from('not-really-a-jpeg'), mime = 'image/jpeg', hand: 'printed' | 'handwritten' | null = 'printed') =>
    postPhotos(app, cookie, [{ bytes, mime }], hand);
  /** The page as the paper says it: what the owner types for each challenge row. */
  const paper = (name: string): string | undefined =>
    name.startsWith('Photo tote bag') ? '1.05' : name.startsWith('Photo cup') ? '2.60' : undefined;

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

  it('THE PRODUCTION ROUTE: a photographed page becomes an import, and its review shows the photo beside the rows', async () => {
    const at = importAt(await shoot());
    const res = await app.inject({ method: 'GET', url: at, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Photo tote bag');
    expect(res.body).toContain('Photo cup');
    // The photo is kept and drawn beside the rows (K1), and served to its owner.
    expect(res.body).toContain(`<img src="${at}/photo/1"`);
    const img = await app.inject({ method: 'GET', url: `${at}/photo/1`, headers: { cookie } });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(img.headers['referrer-policy']).toBe('no-referrer');
    expect(img.rawPayload.toString()).toBe('not-really-a-jpeg');
    // The count is every line the page had, the letterhead and the footer too.
    expect(res.body).toContain('We read 5 lines.');
  });

  it('K7 · the price read from the paper stays hidden on the challenge rows until the owner types it', async () => {
    const at = importAt(await shoot());
    const res = await app.inject({ method: 'GET', url: at, headers: { cookie } });
    // Two priced lines: both are challenge rows (the last priced one and another).
    expect(res.body.match(/name="typed:/g)).toHaveLength(2);
    expect(res.body).not.toContain('1.05');
    expect(res.body).not.toContain('Photo tote bag  PT-100   $1.05   MOQ 500');
    // Typed as on the paper: the rows open, with the line each was read from.
    const { res: saved } = await submitReview(app, cookie, at, { typeFromPaper: paper, next: 'save' });
    expect(saved.statusCode).toBe(302);
    const after = await app.inject({ method: 'GET', url: at, headers: { cookie } });
    expect(after.body).toContain('Read from:');
    expect(after.body).toContain('Photo tote bag  PT-100   $1.05   MOQ 500');
    expect(after.body).toContain('Typed the same as it was read.');
  });

  it('the letterhead is SHOWN as not added, and is not among the rows the form sends', async () => {
    const at = importAt(await shoot());
    const res = await app.inject({ method: 'GET', url: at, headers: { cookie } });
    expect(res.body).toContain('TIANHE TEXTILE CO., LTD');
    expect(res.body).toContain('no price on this line');
    const rows = formFields(res.body, `${at}/save`).get('rows') ?? '';
    expect(rows.split(',')).toHaveLength(2);
  });

  it('CONFIRM WRITES EXACTLY WHAT THE REVIEW SHOWED — no letterhead in the catalogue', async () => {
    const at = importAt(await shoot());
    const { res: confirm } = await submitReview(app, cookie, at, { typeFromPaper: paper, tickAll: true });
    expect(confirm.statusCode).toBe(302);
    expect(confirm.headers['location']).toBe('/app/products');
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
    // K3 — each one says where it came from: the line, the import, the photo.
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    const src = await withTenantTx(db, bid.value, (tx) => sql<{ line: string; imp: string; photo: number }>`
      select p.source_line as line, p.source_import_id::text as imp, ph.position as photo
        from products p join catalog_import_photos ph on ph.id = p.source_photo_id
       where p.business_id = ${BIZ} order by p.sku`.execute(tx).then((r) => r.rows));
    expect(src).toHaveLength(2);
    expect(src.every((x) => at.endsWith(x.imp) && x.photo === 1)).toBe(true);
    expect(src.map((x) => x.line).sort()).toEqual(['Photo cup       PC-220   $2.60   MOQ 1000', 'Photo tote bag  PT-100   $1.05   MOQ 500']);
  });

  it('AN UNREADABLE PAGE IMPORTS NOTHING — not even the lines that were clear', async () => {
    const before = await products();
    unreadable = true;
    const res = await shoot();
    unreadable = false;
    expect(res.statusCode).toBe(200);
    // the UNREADABLE sentence specifically, not the shared refusal title — a
    // page that fell through to "no product lines" would say something else,
    // and the two ask her to do different things. With photos numbered, it
    // names the one to take again.
    expect(res.body).toContain('Photo 1 could not be read, so nothing was added');
    // no review, no form, no rows
    expect(res.body).not.toContain('/app/products/import/');
    expect(await products()).toEqual(before);
  });

  it('a page with no priced line refuses instead of showing an empty list', async () => {
    transcript = 'DELIVERY NOTE\nReceived in good order';
    const res = await shoot();
    transcript = PAGE;
    expect(res.body).toContain('no line on it looks like a product with a price');
    expect(res.body).not.toContain('/app/products/import/');
  });

  it('K1 · a handwritten list is refused before any photo is read; an unanswered question is asked again', async () => {
    const before = reads;
    const hand = await shoot(undefined, undefined, 'handwritten');
    expect(hand.statusCode).toBe(200);
    expect(hand.body).toContain('Handwritten lists are not read yet');
    const none = await shoot(undefined, undefined, null);
    expect(none.body).toContain('Say whether the list is printed or handwritten');
    expect(reads, 'a refused list reached the reader').toBe(before);
  });

  it('K1 · several photos are one import: rows from each, each photo kept', async () => {
    transcript = 'Photo mug  $3.20';
    const res = await postPhotos(app, cookie, [{ bytes: Buffer.from('first-page') }, { bytes: Buffer.from('second-page'), mime: 'image/png' }]);
    transcript = PAGE;
    const at = importAt(res);
    const page = await app.inject({ method: 'GET', url: at, headers: { cookie } });
    expect(page.body).toContain(`${at}/photo/1`);
    expect(page.body).toContain(`${at}/photo/2`);
    expect(page.body).toContain('We read 2 lines.');
    const second = await app.inject({ method: 'GET', url: `${at}/photo/2`, headers: { cookie } });
    expect(second.headers['content-type']).toBe('image/png');
    expect(second.rawPayload.toString()).toBe('second-page');
    expect((await app.inject({ method: 'GET', url: `${at}/photo/3`, headers: { cookie } })).statusCode).toBe(404);
  });

  it('THE FILE-SIZE LIMIT ACTUALLY BITES, IN BOTH DIRECTIONS', async () => {
    // Asserted through real requests, because a limit that only exists in an
    // options object is a comment — and pinned from BELOW as well as above,
    // because the inherited default (Fastify's 1 MB bodyLimit) is smaller than
    // a phone photo. A test that only checks "9 MB is refused" passes with the
    // limit deleted, and the feature would then refuse every real photograph.
    const before = await products();

    const real = await shoot(Buffer.alloc(4 * 1024 * 1024, 0x41));   // a phone photo
    expect(real.statusCode, 'a 4 MB photo — the ordinary case — was refused').toBe(303);

    const huge = await shoot(Buffer.alloc(9 * 1024 * 1024, 0x41));   // past the ceiling
    expect(huge.statusCode).toBe(200);
    expect(huge.body).toContain('too large to read');

    expect(await products(), 'an import is not a product until it is confirmed').toEqual(before);
  });

  it('a file that is not an image is refused, whatever it is named', async () => {
    const res = await shoot(Buffer.from('%PDF-1.4 not an image'), 'application/pdf');
    expect(res.body).toContain('could not read this page');
  });

  it('and the route needs a session, like every other owner surface', async () => {
    const res = await app.inject({
      method: 'POST', url: '/app/products/add/photo',
      headers: { 'content-type': 'multipart/form-data; boundary=----nomiListTest' },
      payload: Buffer.from('------nomiListTest--\r\n'),
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });
});
