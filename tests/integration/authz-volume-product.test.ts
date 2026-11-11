import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { demoSeedSql } from '../../src/demo/factory.js';
import { ensureQueueSchema } from './tenant.js';
import { purgeBusinesses } from './books-db.js';

/**
 * The authorization audit (Block 7), fix round 3 — a volume discount names a product of ITS OWN workspace, or none.
 *
 * `POST /app/business/prices/volume` wrote the form's `productId` into the rule as sent: another workspace's product
 * (found by the walk's replay of B's own form under A's session), or words. And `POST /app/business/prices` answered
 * 500 to a `productId` that is not an id. Both now answer the form again (400) and write nothing; the workspace's own
 * product works as before.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, '').slice(0, 7);
const [NS_A, NS_B] = [`a${RUN}`, `b${RUN}`];
const A = `${NS_A}-0000-4000-8000-0000000000b1`;
const B = `${NS_B}-0000-4000-8000-0000000000b1`;
const product = (ns: string) => `${ns}-0000-4000-8000-000000000101`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const CODE = `authz-volume-${RUN}`;

d('Authorization audit · fix round 3: a volume discount\'s product (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let db: import('../../src/db/client.js').Db;
  let app: import('fastify').FastifyInstance;
  let cookie = '';
  const post = (url: string, fields: Record<string, string>) => app.inject({ method: 'POST', url, payload: new URLSearchParams(fields).toString(),
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' } });
  const rules = async () => (await admin.query(`select condition::text as c from negotiation_rules where business_id = $1 and priority = 100 order by condition::text`, [A])).rows.map((r) => r.c as string);
  const audits = async () => Number((await admin.query(`select count(*)::int as n from channel_audit where business_id = $1 and detail->>'kind' = 'volume_discount'`, [A])).rows[0].n);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    await ensureQueueSchema();
    for (const ns of [NS_A, NS_B]) await admin.query(demoSeedSql(ns));
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: A, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/login', payload: `code=${CODE}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    cookie = ([] as string[]).concat((login.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
    expect(cookie).not.toBe('');
  }, 120_000);
  afterAll(async () => {
    await app?.close(); await db?.destroy();
    await purgeBusinesses(admin, [A, B], 'authz-volume-test').catch(async () => { await admin.query('rollback'); });
    await admin?.end();
  });

  it('another workspace\'s product, or words: the form again, and no rule or audit line written', async () => {
    const [was, wasAudits] = [await rules(), await audits()];
    for (const productId of [product(NS_B), randomUUID(), 'not-an-id']) {
      const res = await post('/app/business/prices/volume', { productId, minQty: '40', discountPct: '1' });
      expect(res.statusCode, productId).toBe(400);
    }
    expect(await rules()).toEqual(was);
    expect(await audits()).toBe(wasAudits);
    expect((await rules()).join('\n')).not.toContain(product(NS_B));
  });

  it('the workspace\'s own product still adds its rule', async () => {
    const was = (await rules()).length;
    const own = await post('/app/business/prices/volume', { productId: product(NS_A), minQty: '41', discountPct: '1' });
    expect(own.statusCode).toBe(302);
    const now = await rules();
    expect(now.length).toBe(was + 1);
    expect(now.filter((c) => c.includes(product(NS_A)) && c.includes('41')).length).toBe(1);
  });

  it('the limits form answers a product id that is not one with the form, never a 500', async () => {
    const res = await post('/app/business/prices', { productId: 'not-an-id', floor: '0.5', maxDiscountPct: '10', askAbovePct: '5' });
    expect(res.statusCode).toBe(400);
  });
});
