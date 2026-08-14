import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * M45 — samples, end to end.
 *
 * The parity suite proves the policy and the matcher. Only Postgres can prove
 * that a buyer's question puts a row in front of her, that asking twice is one
 * obligation rather than two, that her policy is insert-only history, and that
 * the address is what SHE typed rather than anything pulled out of a message.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd450000-0000-4000-8000-${RUN}0001`;

d('M45 · samples (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  let convId = '';
  const CODE = 'samples-test-code';

  const post = (url: string, payload?: string) =>
    app.inject({
      method: 'POST', url,
      headers: { cookie, ...(payload ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      ...(payload ? { payload } : {}),
    });

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    convId = await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Sample Test Factory')
                on conflict (id) do nothing`.execute(t);
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+8613${RUN}`}, 'Ahmed') returning id::text as id`.execute(t)).rows[0]!.id;
      return (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${BIZ}, ${client}::uuid, 'whatsapp', 'warm_intake') returning id::text as id
      `.execute(t)).rows[0]!.id;
    });

    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE,
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
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  const requests = () => tx((t) => sql<{
    asked_text: string; address: string | null; handled_at: Date | null;
  }>`
    select asked_text, address, handled_at from sample_requests
     where business_id = ${BIZ} order by requested_at
  `.execute(t).then((r) => r.rows));

  const repos = async () => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return { bid, tenantRepos };
  };

  it('WITH NO POLICY the repo returns null — "she has not said" is the absence of a row', async () => {
    const { bid, tenantRepos } = await repos();
    expect(await tx((t) => tenantRepos(t, bid.value).catalog.samplePolicy())).toBeNull();
  });

  it('THE PRODUCTION CALLER: a buyer asking puts a row in front of her', async () => {
    const { bid, tenantRepos } = await repos();
    await tx((t) => tenantRepos(t, bid.value).samples.record(
      convId as never, 'Hello — can you send a sample first?'));
    const r = await requests();
    expect(r).toHaveLength(1);
    expect(r[0]!.asked_text).toContain('sample');
    expect(r[0]!.address).toBeNull();
  });

  it('ASKING TWICE IS ONE OBLIGATION, and the FIRST time is the one kept', async () => {
    const { bid, tenantRepos } = await repos();
    await tx((t) => tenantRepos(t, bid.value).samples.record(convId as never, 'any update on that sample?'));
    const r = await requests();
    expect(r).toHaveLength(1);
    // Not overwritten: a re-ask must not reset the clock on a request she has
    // been sitting on for two days.
    expect(r[0]!.asked_text).toContain('can you send a sample first');
  });

  it('the page shows the waiting buyer, and says she has stated nothing', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/settings/samples', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Ahmed');
    expect(res.body).toContain('can you send a sample first');
    expect(res.body).toContain('You have not told Lily anything about samples');
  });

  it('THE CONVERSATION says the sample was asked for, and why nothing was said', async () => {
    const { loadConversationDetail } = await import('../../src/api/web/inbox.js');
    const detail = await loadConversationDetail(db, BIZ, convId, new Date());
    expect(detail!.sampleAsked).toEqual({ policyStated: false });
  });

  it('SHE STATES IT, and the reply path can answer from that moment', async () => {
    const res = await post('/app/settings/samples', 'price=30&credited=on');
    expect(res.statusCode).toBe(302);

    const { bid, tenantRepos } = await repos();
    const policy = await tx((t) => tenantRepos(t, bid.value).catalog.samplePolicy());
    expect(policy!.price).toEqual({ amount: 30, currency: 'USD' });
    expect(policy!.creditedOnFirstOrder).toBe(true);

    const { sampleAnswerContext } = await import('../../src/core/commerce/samples.js');
    const c = sampleAnswerContext(policy);
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.allow).toEqual([30]);

    const { loadConversationDetail } = await import('../../src/api/web/inbox.js');
    expect((await loadConversationDetail(db, BIZ, convId, new Date()))!.sampleAsked)
      .toEqual({ policyStated: true });
  });

  it('STATING A NEW ONE INSERTS — the old promise stays on the record', async () => {
    await post('/app/settings/samples', 'price=45');
    const rows = await tx((t) => sql<{ price_amount: string; credited_on_first_order: boolean }>`
      select price_amount, credited_on_first_order from sample_policy
       where business_id = ${BIZ} order by stated_at
    `.execute(t).then((r) => r.rows));
    expect(rows).toHaveLength(2);
    expect(rows.map((x) => Number(x.price_amount))).toEqual([30, 45]);
    // and the newest is the one in force, with its own answer to "credited"
    const { bid, tenantRepos } = await repos();
    const policy = await tx((t) => tenantRepos(t, bid.value).catalog.samplePolicy());
    expect(policy!.price.amount).toBe(45);
    expect(policy!.creditedOnFirstOrder).toBe(false);
  });

  it('THE APP ROLE CANNOT EDIT A STATED POLICY IN PLACE', async () => {
    await expect(tx((t) => sql`
      update sample_policy set price_amount = 1 where business_id = ${BIZ}
    `.execute(t))).rejects.toThrow(/permission denied/i);
  });

  it('zero is stored as FREE, and is not the same row-shape as unstated', async () => {
    await post('/app/settings/samples', 'price=0');
    const { bid, tenantRepos } = await repos();
    const policy = await tx((t) => tenantRepos(t, bid.value).catalog.samplePolicy());
    expect(policy!.price.amount).toBe(0);
    // Still a policy — the difference between "free" and "unstated" is a row.
    expect(policy).not.toBeNull();
  });

  it('THE ADDRESS IS WHAT SHE TYPED', async () => {
    const id = await tx((t) => sql<{ id: string }>`
      select id from sample_requests where business_id = ${BIZ} limit 1
    `.execute(t).then((r) => r.rows[0]!.id));
    const res = await post(`/app/settings/samples/${id}/address`,
      'address=Unit%2012%2C%20Dubai%20Industrial%20City');
    expect(res.statusCode).toBe(302);
    expect((await requests())[0]!.address).toBe('Unit 12, Dubai Industrial City');
  });

  it('and marking it dealt with clears it from what is waiting', async () => {
    const id = await tx((t) => sql<{ id: string }>`
      select id from sample_requests where business_id = ${BIZ} limit 1
    `.execute(t).then((r) => r.rows[0]!.id));
    expect((await post(`/app/settings/samples/${id}/handled`)).statusCode).toBe(302);

    const after = await requests();
    expect(after).toHaveLength(1);              // archived, not erased
    expect(after[0]!.handled_at).not.toBeNull();

    const page = await app.inject({ method: 'GET', url: '/app/settings/samples', headers: { cookie } });
    expect(page.body).toContain('Nobody has asked for a sample yet');

    // and the conversation stops carrying it too
    const { loadConversationDetail } = await import('../../src/api/web/inbox.js');
    expect((await loadConversationDetail(db, BIZ, convId, new Date()))!.sampleAsked).toBeNull();
  });

  it('what she typed wrong does not become a policy', async () => {
    const before = await tx((t) => sql<{ n: number }>`
      select count(*)::int as n from sample_policy where business_id = ${BIZ}
    `.execute(t).then((r) => r.rows[0]!.n));
    for (const bad of ['price=', 'price=free', 'price=-5']) {
      expect((await post('/app/settings/samples', bad)).statusCode, bad).toBe(302);
    }
    expect(await tx((t) => sql<{ n: number }>`
      select count(*)::int as n from sample_policy where business_id = ${BIZ}
    `.execute(t).then((r) => r.rows[0]!.n))).toBe(before);
  });

  it('SHE HANDLES IT, AND HE MAY ASK AGAIN — a repeat customer is not one sample', async () => {
    /**
     * The case the FIRST version of this index forbade. It was
     * `unique (conversation_id)`, which dedups on the wrong axis: it stopped a
     * buyer nagging while a request sat open — correct — and also stopped him
     * asking for a second sample after she had shipped the first, which is
     * exactly what a repeat customer does. A constraint is a poor place to
     * decide, silently, that a factory only ever sends one sample per buyer.
     *
     * Runs LAST because it deliberately leaves an open request behind; every
     * test above it reads the one the suite opened at the start.
     */
    const { bid, tenantRepos } = await repos();
    const before = await requests();
    expect(before.every((r) => r.handled_at !== null), 'the suite left one open').toBe(true);

    // Months later he asks for another one. That is a new obligation, and the
    // old index would have swallowed it.
    await tx((t) => tenantRepos(t, bid.value).samples.record(convId as never, 'can you send one more sample?'));
    const raised = await requests();
    expect(raised).toHaveLength(before.length + 1);
    expect(raised.filter((r) => r.handled_at === null)).toHaveLength(1);
    expect(raised.at(-1)!.asked_text).toContain('one more sample');

    // And the nagging rule applies to the new one exactly as it did the first.
    await tx((t) => tenantRepos(t, bid.value).samples.record(convId as never, 'any news?'));
    expect(await requests()).toHaveLength(raised.length);

    // Handle it, and a third is allowed again — there is no ceiling, only the
    // rule that one is open at a time.
    const open = await tx((t) => sql<{ id: string }>`
      select id from sample_requests where business_id = ${BIZ} and handled_at is null limit 1
    `.execute(t).then((r) => r.rows[0]!.id));
    expect((await post(`/app/settings/samples/${open}/handled`)).statusCode).toBe(302);
    await tx((t) => tenantRepos(t, bid.value).samples.record(convId as never, 'and one in blue?'));
    expect(await requests()).toHaveLength(raised.length + 1);
  });
});
