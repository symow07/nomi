import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';
import type { PageTranscriber } from '../../src/llm/ports.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * G16 · M37 — re-photographing a price sheet updates what changed, through the
 * real routes and into real rows.
 *
 * The parity suite proves the rule that sorts each line. Only Postgres can prove
 * the part that matters to her: that the change she ticked is the change that
 * was written, through the one audited edit, with her floor still in force —
 * and that nothing she did not tick moved.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd160000-0000-4000-8000-${RUN}0001`;
const CODE = 'rephotograph-owner-code';

const FIRST = [
  'TIANHE TEXTILE CO., LTD',
  'RP-100 Photo tote bag $1.05 MOQ 500',
  'RP-220 Photo cup $2.60 MOQ 1000',
  'RP-330 Photo hat $4.00 MOQ 200',
].join('\n');

/** This year's sheet: one price down, one under her floor, one new product. */
const SECOND = [
  'TIANHE TEXTILE CO., LTD · 2027',
  'RP-100 Photo tote bag $0.98 MOQ 500',
  'RP-220 Photo cup $2.60 MOQ 1000',
  'RP-330 Photo hat $3.50 MOQ 200',
  'RP-440 Photo scarf $6.20 MOQ 300',
].join('\n');

const BOUNDARY = '----nomiRephotoTest';
const multipart = (bytes: Buffer, mime = 'image/jpeg') => Buffer.concat([
  Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="page"; filename="page.jpg"\r\n`
    + `Content-Type: ${mime}\r\n\r\n`),
  bytes,
  Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
]);

d('G16 · re-photographing updates what changed (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  let transcript = FIRST;

  const transcriber: PageTranscriber = {
    transcribe: async () => ({
      text: transcript, unreadable: false,
      promptVersion: 'test', modelId: 'test', usage: { inputTokens: 1, outputTokens: 1 },
    }),
  };

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  const shoot = (page: string, body = multipart(Buffer.from('not-really-a-jpeg')), type = `multipart/form-data; boundary=${BOUNDARY}`) => {
    transcript = page;
    return app.inject({ method: 'POST', url: '/app/products/add/photo', headers: { cookie, 'content-type': type }, payload: body });
  };

  /** The value the review staged, as the browser would repost it. */
  const staged = (html: string): string => {
    const m = /<input type="hidden" name="text" value="([\s\S]*?)" \/>/.exec(html);
    expect(m, 'the review staged nothing for confirm').not.toBeNull();
    return m![1]!.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  };
  const ticks = (html: string): string[] => [...html.matchAll(/name="apply:([^"]+)" checked/g)].map((m) => m[1]!);

  const confirm = (text: string, apply: readonly string[]) => app.inject({
    method: 'POST', url: '/app/products/add/confirm',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams([['text', text], ...apply.map((id) => [`apply:${id}`, 'on'] as [string, string])]).toString(),
  });
  const flashOf = (res: { headers: Record<string, unknown> }): string =>
    new URL(String(res.headers['location']), 'http://x').searchParams.get('flash') ?? '';

  const catalogue = () => tx((t) => sql<{ id: string; sku: string; price: string | null; moq: number; active: boolean; tier: string | null }>`
    select p.id::text as id, p.sku, p.price_usd_per_unit as price, p.moq, p.is_active as active,
           (select unit_price_usd from price_tiers pt where pt.product_id = p.id and pt.min_qty = 1) as tier
      from products p where p.business_id = ${BIZ} order by p.sku
  `.execute(t).then((r) => r.rows));
  const bySku = async (sku: string) => (await catalogue()).find((p) => p.sku === sku)!;
  const edits = () => tx((t) => sql<{ actor: string; detail: { productId: string; changes: Record<string, { from: unknown; to: unknown }>; source?: { via: string; line: string } } }>`
    select actor, detail from channel_audit where business_id = ${BIZ} and action = 'product_edited' order by at
  `.execute(t).then((r) => r.rows));

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Rephotograph Factory')
                on conflict (id) do nothing`.execute(t);
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

    // Last year's sheet, photographed and confirmed the ordinary way.
    const first = await shoot(FIRST);
    expect((await confirm(staged(first.body), [])).statusCode).toBe(302);
    expect((await catalogue()).map((p) => p.sku)).toEqual(['RP-100', 'RP-220', 'RP-330']);
    // Her floor on the hat, stated the way savePriceRules states it.
    const hat = await bySku('RP-330');
    await tx((t) => sql`insert into pricing_policy (business_id, product_id, floor_price_usd, max_discount_pct, human_required_above_pct)
                        values (${BIZ}, ${hat.id}::uuid, 3.80, 5, 3)`.execute(t));
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('THE DONE-WHEN: this year’s sheet shows the ONE changed price for her to confirm', async () => {
    const res = await shoot(SECOND);
    expect(res.statusCode).toBe(200);
    const tote = await bySku('RP-100');
    expect(ticks(res.body)).toEqual([tote.id]);
    expect(res.body).toContain(esc(t('en', 'product.review.change.price', { from: '$1.05', to: '$0.98' })));
    // the rest of the page is accounted for, each in its own pile
    expect(res.body).toContain(esc(t('en', 'product.review.addedTitle', { count: 1 })));
    expect(res.body).toContain(esc(t('en', 'product.review.unchangedTitle', { count: 1 })));
    expect(res.body).toContain(esc(t('en', 'product.review.held.below_floor')));
    expect(res.body).not.toContain('$3.80');                       // the rule is named, never her number
  });

  it('confirming writes that change through the audited edit — the tier moves with it — and nothing else', async () => {
    const before = await catalogue();
    const review = await shoot(SECOND);
    const res = await confirm(staged(review.body), ticks(review.body));
    expect(res.statusCode).toBe(302);
    expect(flashOf(res)).toContain(t('en', 'product.flash.updated', { n: 1 }));

    const tote = await bySku('RP-100');
    expect([Number(tote.price), Number(tote.tier)]).toEqual([0.98, 0.98]);
    // the cup agreed, and the hat's page price was under her floor: both as they were
    for (const sku of ['RP-220', 'RP-330']) {
      expect(await bySku(sku), sku).toEqual(before.find((p) => p.sku === sku));
    }
    // the new product arrived, and — like every import — is not sellable yet
    expect(await bySku('RP-440')).toMatchObject({ active: false });
    expect(Number((await bySku('RP-440')).price)).toBe(6.2);

    const trail = await edits();
    expect(trail).toHaveLength(1);
    expect(trail[0]!.detail.productId).toBe(tote.id);
    expect(trail[0]!.detail.changes['price']).toEqual({ from: 1.05, to: 0.98 });
    // and it says which line of which page moved the price
    expect(trail[0]!.detail.source).toEqual({ via: 'import', line: 'RP-100 Photo tote bag $0.98 MOQ 500' });
  });

  it('a change she unticks is left exactly as it was', async () => {
    const page = 'RP-220 Photo cup $2.75 MOQ 1000';
    const review = await shoot(page);
    const cup = await bySku('RP-220');
    expect(ticks(review.body)).toEqual([cup.id]);
    const res = await confirm(staged(review.body), []);
    expect(flashOf(res)).toContain(t('en', 'product.flash.alreadyHere', { n: 1 }));
    expect(Number((await bySku('RP-220')).price)).toBe(2.6);
    expect(await edits()).toHaveLength(1);
  });

  it('a posted id can only choose among the changes her catalogue produced — never invent one', async () => {
    const cup = await bySku('RP-220');
    const hat = await bySku('RP-330');
    // The cup's line agrees with her catalogue; the hat's is under her floor.
    // Ticking either by hand changes nothing.
    await confirm('RP-220 Photo cup $2.60 MOQ 1000\nRP-330 Photo hat $3.50 MOQ 200', [cup.id, hat.id, randomUUID()]);
    expect(Number((await bySku('RP-220')).price)).toBe(2.6);
    expect(Number((await bySku('RP-330')).price)).toBe(4);
    expect(await edits()).toHaveLength(1);
  });

  it('a floor she raises between the review and the confirm still wins — and she is told', async () => {
    const page = 'RP-220 Photo cup $2.40 MOQ 1000';
    const review = await shoot(page);
    const cup = await bySku('RP-220');
    expect(ticks(review.body)).toEqual([cup.id]);
    await tx((t) => sql`insert into pricing_policy (business_id, product_id, floor_price_usd, max_discount_pct, human_required_above_pct)
                        values (${BIZ}, ${cup.id}::uuid, 2.50, 5, 3)`.execute(t));
    const res = await confirm(staged(review.body), ticks(review.body));
    expect(flashOf(res)).toContain(t('en', 'product.flash.refused', { n: 1 }));
    expect(flashOf(res)).not.toContain(t('en', 'product.flash.updated', { n: 1 }));
    expect(Number((await bySku('RP-220')).price)).toBe(2.6);
  });

  it('re-sending the same sheet offers nothing to confirm, and says why', async () => {
    const res = await shoot('RP-100 Photo tote bag $0.98 MOQ 500\nRP-440 Photo scarf $6.20 MOQ 300');
    expect(res.body).not.toContain('action="/app/products/add/confirm"');
    expect(res.body).toContain(esc(t('en', 'product.review.nothingToChange')));
  });

  it('UPLOAD FAILURES ARE NAMED FOR WHAT THEY ARE — not all "too large"', async () => {
    const sentence = (r: 'not_a_photo' | 'upload_failed' | 'too_large') => esc(t('en', `product.photo.refused.${r}`));
    const pdf = await shoot(FIRST, multipart(Buffer.from('%PDF-1.4 not an image'), 'application/pdf'));
    expect(pdf.body).toContain(sentence('not_a_photo'));

    // A form with no file in it: nothing arrived to be too large.
    const empty = await shoot(FIRST, Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n--${BOUNDARY}--\r\n`));
    expect(empty.body).toContain(sentence('upload_failed'));
    expect(empty.body).not.toContain(sentence('too_large'));

    // A stream that breaks off before its end.
    const cut = await shoot(FIRST, Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="page"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\nabc`));
    expect(cut.body).toContain(sentence('upload_failed'));
    expect(cut.body).not.toContain(sentence('too_large'));

    // …and a photo past the ceiling is still the one that is too large.
    const huge = await shoot(FIRST, multipart(Buffer.alloc(9 * 1024 * 1024, 0x41)));
    expect(huge.body).toContain(sentence('too_large'));
  });
});
