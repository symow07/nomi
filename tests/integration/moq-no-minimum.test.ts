import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * 0081 — "no minimum" over Postgres: the column takes NULL, the owner's
 * product page clears it with an empty box, an imported line that states none
 * is written with none (it was 100), and the export writes the owner's words
 * for none in the minimum's column — never a blank, never "null".
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd810000-0000-4000-8000-${RUN}0001`;
const PID = `dd810000-0000-4000-8001-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('0081 · a product may have no minimum (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const CODE = 'moq-owner-code';

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const get = (url: string, extra: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers: { cookie, ...extra } });
  const post = (url: string, fields: Record<string, string>) =>
    app.inject({ method: 'POST', url, payload: new URLSearchParams(fields).toString(), headers: { cookie, ...FORM } });
  const moqOf = (where: string) => tx((t) => sql<{ moq: number | null }>`
    select moq from products where business_id = ${BIZ} and (id::text = ${where} or name = ${where})`
    .execute(t).then((r) => r.rows[0]?.moq));

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Rosa and Clay') on conflict (id) do nothing`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, currency, price_usd_per_unit, is_active)
                values (${PID}, ${BIZ}, ${`RS-${RUN}`}, 'Rose face serum', 'pcs', 100, 'USD', 34.90, true)`.execute(t);
      await sql`insert into price_tiers (product_id, min_qty, unit_price_usd, currency) values (${PID}, 1, 34.90, 'USD')`.execute(t);
    });
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('the column takes NULL, and never 0', async () => {
    await tx((t) => sql`update products set moq = null where id = ${PID}`.execute(t));
    expect(await moqOf(PID)).toBeNull();
    await expect(tx((t) => sql`update products set moq = 0 where id = ${PID}`.execute(t))).rejects.toThrow();
    await tx((t) => sql`update products set moq = 100 where id = ${PID}`.execute(t));
  });

  it('the owner clears the minimum with an empty box — and the page says "No minimum"', async () => {
    const r = await post(`/app/products/${PID}/edit`, { price: '34.90', moq: '', unit: 'pcs', isActive: 'on' });
    expect(r.statusCode).toBe(302);
    expect(await moqOf(PID)).toBeNull();
    const page = await get(`/app/products/${PID}`);
    expect(page.body).toContain(t('en', 'product.noMinimum'));
    expect(page.body).not.toMatch(/\bnull\b/);
    // …and sets one again the same way.
    await post(`/app/products/${PID}/edit`, { price: '34.90', moq: '6', unit: 'pcs', isActive: 'on' });
    expect(await moqOf(PID)).toBe(6);
    await post(`/app/products/${PID}/edit`, { price: '34.90', moq: '', unit: 'pcs', isActive: 'on' });
  });

  it('an imported line that states no minimum is written with none — a stated one as stated', async () => {
    const text = ['Lip balm $6.50', 'Gift box $24 MOQ 10'].join('\n');
    const r = await post('/app/products/add/confirm', { text });
    expect(r.statusCode).toBe(302);
    expect(await moqOf('Lip balm')).toBeNull();
    expect(await moqOf('Gift box')).toBe(10);
  });

  it('the export writes the owner\'s words for none — in their language — never a blank or "null"', async () => {
    for (const [lang, said] of [['en', t('en', 'product.noMinimum')], ['zh', t('zh', 'product.noMinimum')]] as const) {
      const csv = (await get('/app/settings/data/products.csv', { cookie: `${cookie}; yf_locale=${lang}` })).body;
      const header = csv.split(/\r?\n/)[0]!.split(',');
      // The positioning rewrite named the column "minimum order" (it was "moq").
      const col = header.indexOf('minimum order');
      expect(col, 'the minimum column').toBeGreaterThan(-1);
      const serum = csv.split(/\r?\n/).find((l) => l.includes('Rose face serum'))!;
      expect(serum, lang).toContain(said);
      expect(csv, lang).not.toMatch(/\bnull\b/);
      const giftBox = csv.split(/\r?\n/).find((l) => l.includes('Gift box'))!;
      expect(giftBox).toMatch(/,10,/);
    }
  });
});
