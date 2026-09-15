import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * M35.1 — the owner can actually create the thing buyers read.
 *
 * M35 shipped `issueProofLink` and `revokeProofLink` with no caller but a test,
 * which by this repo's own standard means the feature was not built: buyers
 * could read links no owner could create. This drives the OWNER'S ROUTES, which
 * is the entire reason the part exists.
 *
 * End to end, against real Postgres and the real route table:
 *   owner issues → the public page renders → owner revokes → the page 404s,
 * and the revoked link is indistinguishable from one that never existed.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `cc350100-0000-4000-8000-${RUN}0001`;
const CLIENT = `cc350100-0000-4000-8000-${RUN}0002`;
const CONV = `cc350100-0000-4000-8000-${RUN}0003`;
const PROD = `cc350100-0000-4000-8000-${RUN}0004`;

d('M35.1 · the owner issues and revokes the buyer link (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const CODE = 'proof-test-code';

  const post = (url: string) =>
    app.inject({ method: 'POST', url, headers: { cookie } });

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');

    await withTenantTx(db, bid.value, async (tx) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Proof Test Factory') on conflict (id) do nothing`.execute(tx);
      await sql`insert into clients (id, business_id, display_name) values (${CLIENT}, ${BIZ}, 'Ahmed') on conflict (id) do nothing`.execute(tx);
      await sql`insert into conversations (id, business_id, client_id, channel) values (${CONV}, ${BIZ}, ${CLIENT}, 'whatsapp') on conflict (id) do nothing`.execute(tx);
      await sql`insert into products (id, business_id, sku, name, unit, moq, lead_time_days)
                values (${PROD}, ${BIZ}, ${'PT-' + RUN}, 'Canvas tote bag', 'pcs', 1000, 25)
                on conflict (id) do nothing`.execute(tx);
      await sql`insert into price_tiers (product_id, min_qty, max_qty, unit_price_usd)
                values (${PROD}, 10000, 50000, 0.38) on conflict do nothing`.execute(tx);
      // `inputs` deliberately carries the policy, as production does — the page
      // must still never surface it.
      await sql`insert into quotes (business_id, conversation_id, product_id, quantity,
                                    inputs, unit_price_usd, total_usd, engine_version)
                values (${BIZ}, ${CONV}, ${PROD}, 20000,
                        ${'{"policy":{"floor_price_usd":0.35,"max_discount_pct":15}}'}::jsonb,
                        0.38, 7600, 'test')`.execute(tx);
      await sql`insert into claims_policy (business_id, kind, claim_key, allowed)
                values (${BIZ}, 'certification', 'BSCI', true) on conflict do nothing`.execute(tx);
    });

    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE,
      sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      // G11 — the address a buyer reaches this installation at.
      publicBaseUrl: 'https://nomi.example.com',
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();

    const login = await app.inject({
      method: 'POST', url: '/login',
      payload: `code=${encodeURIComponent(CODE)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie, 'the owner must be able to sign in for this test').not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  let token = '';

  it('THE PRODUCTION CALLER: the owner issues a link from the conversation', async () => {
    const res = await post(`/app/inbox/${CONV}/proof`);
    expect(res.statusCode).toBe(302);

    const row = await (async () => {
      const { withTenantTx } = await import('../../src/db/client.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
      return withTenantTx(db, bid.value, (tx) => sql<{ token: string }>`
        select token from quote_proofs where business_id = ${BIZ} and revoked_at is null
      `.execute(tx).then((r) => r.rows[0]));
    })();
    expect(row, 'no link row was created by the owner action').toBeDefined();
    token = row!.token;
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('the buyer can open it, with no session at all', async () => {
    const res = await app.inject({ method: 'GET', url: `/p/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Canvas tote bag');
    expect(res.body).toContain('$0.38');
  });

  it('and it still refuses to show the floor price that is IN the quote row', async () => {
    const res = await app.inject({ method: 'GET', url: `/p/${token}` });
    expect(res.body).not.toContain('0.35');
    expect(res.body).not.toContain('max_discount');
  });

  it('issuing twice returns the same link rather than orphaning the first', async () => {
    await post(`/app/inbox/${CONV}/proof`);
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    const n = await withTenantTx(db, bid.value, (tx) => sql<{ n: number }>`
      select count(*)::int as n from quote_proofs where business_id = ${BIZ} and revoked_at is null
    `.execute(tx).then((r) => r.rows[0]!.n));
    expect(n).toBe(1);
  });

  it('the owner sees the WHOLE link on the conversation — one she can send', async () => {
    // G11 — it used to print `/p/<token>`, a path with no host: not a link,
    // and not something she could paste to a buyer.
    const res = await app.inject({ method: 'GET', url: `/app/inbox/${CONV}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`https://nomi.example.com/p/${token}`);
    expect(res.body).toContain('Turn it off');
    expect(res.body).toContain('class="proofrow"');
  });

  it('G11 · with no public address set, she is told rather than shown half a link', async () => {
    const Fastify2 = (await import('fastify')).default;
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const bare = Fastify2({ logger: false });
    registerWebApp(bare, {
      db, businessId: BIZ, accessCode: CODE,
      sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await bare.ready();
    const login = await bare.inject({ method: 'POST', url: '/login',
      payload: `code=${encodeURIComponent(CODE)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const c = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    const res = await bare.inject({ method: 'GET', url: `/app/inbox/${CONV}`, headers: { cookie: c } });
    expect(res.body).toContain('your public address is not set up yet');
    expect(res.body).not.toContain(`/p/${token}`);
    await bare.close();
  });

  it('G11 · the page is in the language HE writes in, and its band contains his quantity', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    // A second tier he did NOT buy in: 1,000–9,999. His 20,000 must not read
    // as that band — the page's whole claim is where the price came from.
    await withTenantTx(db, bid.value, (tx) => sql`
      insert into price_tiers (product_id, min_qty, max_qty, unit_price_usd)
      values (${PROD}, 1000, 9999, 0.45) on conflict do nothing`.execute(tx));
    await withTenantTx(db, bid.value, (tx) => sql`
      update clients set preferred_language = 'ar' where id = ${CLIENT}`.execute(tx));

    const res = await app.inject({ method: 'GET', url: `/p/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('dir="rtl"');
    expect(res.body).toContain('10,000');      // the band he actually bought in
    expect(res.body).not.toContain('9,999');
  });

  it('REVOKING makes it a 404 — never a 403, and never distinguishable', async () => {
    const res = await post(`/app/inbox/${CONV}/proof/revoke`);
    expect(res.statusCode).toBe(302);

    const revoked = await app.inject({ method: 'GET', url: `/p/${token}` });
    const neverExisted = await app.inject({ method: 'GET', url: `/p/${'q'.repeat(43)}` });

    expect(revoked.statusCode).toBe(404);
    expect(revoked.statusCode).not.toBe(403);
    // Byte-for-byte identical: a revoked link that looked different from an
    // invented one would confirm the quote exists.
    expect(revoked.body).toBe(neverExisted.body);
  });

  it('both actions are audited on the conversation', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    const kinds = await withTenantTx(db, bid.value, (tx) => sql<{ type: string }>`
      select type from conversation_events
       where conversation_id = ${CONV} and type in ('proof_issued','proof_revoked')
    `.execute(tx).then((r) => r.rows.map((x) => x.type)));
    expect(kinds).toContain('proof_issued');
    expect(kinds).toContain('proof_revoked');
  });

  it('the owner can issue a fresh link after revoking', async () => {
    const res = await post(`/app/inbox/${CONV}/proof`);
    expect(res.statusCode).toBe(302);
    const page = await app.inject({ method: 'GET', url: `/app/inbox/${CONV}`, headers: { cookie } });
    expect(page.body).toContain('/p/');
    expect(page.body).not.toContain(`/p/${token}`);   // a NEW token, not the revoked one
  });
});
