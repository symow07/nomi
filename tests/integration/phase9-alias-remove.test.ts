import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant, flashSaid } from './tenant.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * Phase 9 (V1-313, 0122) — a name customers use, taken off a product, over
 * Postgres: the one function takes it, never the product's own name, never
 * another business's, and the audit trail keeps the word.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd940000-0000-4000-8000-${RUN}0001`;
const OTHER = `dd940000-0000-4000-8000-${RUN}0002`;
const PID = `dd940000-0000-4000-8001-${RUN}0001`;
const THEIRS = `dd940000-0000-4000-8001-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('Phase 9 · a customer\'s name taken off a product (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const CODE = 'alias-remove-owner-code';

  const as = async <T>(biz: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const names = (biz: string, pid: string) => as(biz, (x) => sql<{ alias: string }>`
    select alias from product_aliases where product_id = ${pid}::uuid order by alias`.execute(x).then((r) => r.rows.map((y) => y.alias)));
  const remove = (pid: string, alias: string) => app.inject({ method: 'POST', url: `/app/products/${pid}/names/remove`,
    payload: new URLSearchParams({ alias }).toString(), headers: { cookie, ...FORM } });

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    for (const [biz, pid, name] of [[BIZ, PID, 'Canvas tote'], [OTHER, THEIRS, 'Other tote']] as const) {
      await as(biz, async (x) => {
        await sql`insert into businesses (id, name) values (${biz}, ${`Alias Test ${RUN}`}) on conflict (id) do nothing`.execute(x);
        await sql`insert into products (id, business_id, sku, name, name_zh, unit, moq, currency, price_usd_per_unit, is_active)
                  values (${pid}, ${biz}, ${`AL-${RUN}-${pid.slice(-1)}`}, ${name}, '帆布袋', 'pcs', null, 'USD', 2.00, true)`.execute(x);
        for (const a of [name, '帆布袋', 'tote bag', 'shopper'])
          await sql`insert into product_aliases (product_id, alias, language, alias_type) values (${pid}, ${a}, 'en', 'common')`.execute(x);
      });
    }
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

  it('a customer\'s name is taken off, said so, and kept on the audit trail', async () => {
    const r = await remove(PID, 'tote bag');
    expect(r.statusCode).toBe(302);
    expect(r.headers['location']).toBe(`/app/products/${PID}#names`);
    expect(flashSaid(r, SECRET)).toContain(t('en', 'product.alias.removed'));
    expect(await names(BIZ, PID)).toEqual(['Canvas tote', 'shopper', '帆布袋']);
    const audit = await as(BIZ, (x) => sql<{ detail: { productId: string; changes: { customerNames?: { removed?: string } } } }>`
      select detail from channel_audit where business_id = ${BIZ} and action = 'product_edited' order by at desc limit 1`.execute(x));
    expect(audit.rows[0]?.detail).toMatchObject({ productId: PID, changes: { customerNames: { removed: 'tote bag' } } });
  });

  it('never the product\'s own name or its Chinese name, in any case', async () => {
    for (const own of ['Canvas tote', 'CANVAS TOTE', '帆布袋']) {
      const r = await remove(PID, own);
      expect(flashSaid(r, SECRET)).toContain(t('en', 'product.alias.notRemoved'));
    }
    expect(await names(BIZ, PID)).toEqual(['Canvas tote', 'shopper', '帆布袋']);
  });

  it('never another business\'s product, even by its id', async () => {
    const r = await remove(THEIRS, 'shopper');
    expect(flashSaid(r, SECRET)).toContain(t('en', 'product.alias.notRemoved'));
    expect(await names(OTHER, THEIRS)).toEqual(['Other tote', 'shopper', 'tote bag', '帆布袋']);
  });

  it('the app role still deletes nothing directly', async () => {
    await expect(as(BIZ, (x) => sql`delete from product_aliases where product_id = ${PID}::uuid and alias = 'shopper'`.execute(x))).rejects.toThrow(/permission denied/);
  });
});
