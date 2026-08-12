import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { seedRunTenant, RUN_BIZ, RUN_NS } from './tenant.js';

/**
 * M36.0 — EVERY SURFACE, AGAINST A TENANT THAT HAS ROWS IN IT.
 *
 * M35's proof page carried a query with a set-returning function in a JOIN
 * condition. It threw 0A000 — but ONLY for a conversation that had taught
 * knowledge attached, which is the exact case the feature exists for. Both
 * suites missed it: the parity tests render from a fixture, so they exercise
 * the renderer and never the query.
 *
 * The sibling risk is worse, because it is systemic. An EMPTY tenant is the
 * safest possible input and the least representative one: every join returns
 * nothing, every optional block is skipped, and a query that only breaks when
 * rows exist passes cleanly.
 *
 * WHAT THE EXISTING WALK ACTUALLY DID, before this file. boot.test.ts loops
 * CONTEXTUAL_ROUTES and asserts 200, against the seeded run tenant — so it was
 * populated, not empty, which is better than the brief assumed. But it covered
 * only that list minus two exclusions: no NAV route, no parameterised route
 * (`/app/inbox/:id`, `/app/products/:id`, `/app/knowledge/:id`), and not
 * `/p/:token`. The proof page was reachable by no walk at all.
 *
 * This walks EVERY registered GET route, with REAL ids from the seeded demo
 * factory — 12 products, 6 buyers, 5 conversations, taught knowledge, quotes,
 * trust history — and a proof link issued through the owner's own route so the
 * public page is exercised against a real quote rather than a fixture.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const nsId = (suffix: string) => `${RUN_NS}-0000-4000-8000-${suffix}`;

d('M36.0 · every surface answers on a POPULATED tenant (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const routes: string[] = [];
  const real: Record<string, string> = {};
  const CODE = 'surface-walk-code';

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');

    // REAL ids out of the seeded data, not invented ones: a route given a
    // nonexistent id takes its not-found branch and never runs the query that
    // matters.
    await withTenantTx(db, bid.value, async (tx) => {
      const one = async (q: string) =>
        (await sql<{ id: string }>`${sql.raw(q)}`.execute(tx)).rows[0]?.id ?? '';
      real['conversationId'] = await one(
        `select id::text as id from conversations where business_id = '${RUN_BIZ}' limit 1`);
      real['productId'] = await one(
        `select id::text as id from products where business_id = '${RUN_BIZ}' limit 1`);
      real['id'] = await one(
        `select id::text as id from product_knowledge where business_id = '${RUN_BIZ}' limit 1`);
    });
    expect(real['conversationId'], 'the seed produced no conversation').not.toBe('');
    expect(real['productId'], 'the seed produced no product').not.toBe('');

    // THE DEMO SEED CREATES NO QUOTES. A "fully populated fake company" with no
    // quote cannot exercise the quote context, the proof link, or anything
    // downstream of a price — which is why the proof page had no walk covering
    // it. One is added here so this test means something; the seed itself
    // arguably should grow one, which is reported rather than changed under a
    // test's feet.
    await withTenantTx(db, bid.value, async (tx) => {
      const n = (await sql<{ n: number }>`
        select count(*)::int as n from quotes where business_id = ${RUN_BIZ}`.execute(tx)).rows[0]!.n;
      if (n === 0) {
        await sql`insert into quotes (business_id, conversation_id, product_id, quantity,
                                      inputs, unit_price_usd, total_usd, engine_version)
                  values (${RUN_BIZ}, ${real['conversationId']}::uuid, ${real['productId']}::uuid,
                          20000, '{}'::jsonb, 0.85, 17000, 'surface-walk')`.execute(tx);
      }
      // And a knowledge_used event, so the LATERAL that shipped broken is on
      // the path this walk takes rather than skipped as an empty join.
      if (real['id']) {
        await sql`insert into conversation_events (business_id, conversation_id, type, payload)
                  values (${RUN_BIZ}, ${real['conversationId']}::uuid, 'knowledge_used',
                          ${JSON.stringify({ ids: [real['id']] })}::jsonb)`.execute(tx);
      }
    });

    process.env['PILOT_BUSINESS_ID'] = RUN_BIZ;
    app = Fastify({ logger: false });
    app.addHook('onRoute', (r) => {
      const ms = Array.isArray(r.method) ? r.method : [r.method];
      if (ms.includes('GET')) routes.push(r.url);
    });
    registerWebApp(app, {
      db, businessId: RUN_BIZ, accessCode: CODE,
      sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();

    const login = await app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');

    // A REAL proof link, issued through the owner's route, so /p/:token is
    // walked against an actual quote with actual taught knowledge behind it.
    // This is the precise shape that was broken and shipped.
    const conv = await withTenantTx(db, bid.value, (tx) => sql<{ id: string }>`
      select c.id::text as id from conversations c
       join quotes q on q.conversation_id = c.id
       where c.business_id = ${RUN_BIZ} limit 1`.execute(tx).then((r) => r.rows[0]?.id));
    if (conv) {
      await app.inject({ method: 'POST', url: `/app/inbox/${conv}/proof`, headers: { cookie } });
      const tk = await withTenantTx(db, bid.value, (tx) => sql<{ token: string }>`
        select token from quote_proofs where business_id = ${RUN_BIZ} and revoked_at is null limit 1`
        .execute(tx).then((r) => r.rows[0]?.token));
      if (tk) real['token'] = tk;
    }
  }, 90_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('the seeded tenant actually has rows — otherwise this walk proves nothing', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    const counts = await withTenantTx(db, bid.value, (tx) => sql<{
      products: number; convos: number; knowledge: number; quotes: number;
    }>`
      select (select count(*)::int from products where business_id = ${RUN_BIZ}) as products,
             (select count(*)::int from conversations where business_id = ${RUN_BIZ}) as convos,
             (select count(*)::int from product_knowledge where business_id = ${RUN_BIZ}) as knowledge,
             (select count(*)::int from quotes where business_id = ${RUN_BIZ}) as quotes
    `.execute(tx).then((r) => r.rows[0]!));
    expect(counts.products).toBeGreaterThan(0);
    expect(counts.convos).toBeGreaterThan(0);
    expect(counts.quotes).toBeGreaterThan(0);
  });

  it('EVERY GET route renders against real data — not one of them 500s', async () => {
    const broken: string[] = [];
    for (const url of [...new Set(routes)]) {
      // Params get REAL values; anything unknown is skipped rather than probed
      // with a fake id, which would silently exercise the not-found branch.
      let target = url;
      let skip = false;
      for (const m of url.matchAll(/:([A-Za-z]+)/g)) {
        const v = real[m[1]!];
        if (!v) { skip = true; break; }
        target = target.replace(`:${m[1]}`, encodeURIComponent(v));
      }
      if (skip) continue;

      const res = await app.inject({ method: 'GET', url: target, headers: { cookie } });
      if (res.statusCode >= 500) {
        broken.push(`${target} → ${res.statusCode} ${res.body.slice(0, 160)}`);
      }
    }
    expect(broken, `these threw on real data:\n  ${broken.join('\n  ')}`).toEqual([]);
  });

  it('the proof page specifically — the one that shipped broken', async () => {
    expect(real['token'], 'no proof link was issued, so this walk skipped it').toBeTruthy();
    const res = await app.inject({ method: 'GET', url: `/p/${real['token']}` });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  });

  it('and every surface returns 200, not merely "not 500"', async () => {
    const notOk: string[] = [];
    for (const url of [...new Set(routes)]) {
      if (url === '/p/:token' || url === '/') continue;   // public, or a redirect by design
      let target = url; let skip = false;
      for (const m of url.matchAll(/:([A-Za-z]+)/g)) {
        const v = real[m[1]!];
        if (!v) { skip = true; break; }
        target = target.replace(`:${m[1]}`, encodeURIComponent(v));
      }
      if (skip) continue;
      const res = await app.inject({ method: 'GET', url: target, headers: { cookie } });
      if (res.statusCode !== 200 && res.statusCode !== 302) notOk.push(`${target} → ${res.statusCode}`);
    }
    expect(notOk, `unexpected status:\n  ${notOk.join('\n  ')}`).toEqual([]);
  });
});
