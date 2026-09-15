import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * M44 — her closures, end to end.
 *
 * The parity suite proves the date arithmetic. It cannot prove that the route
 * writes a row, that removing one ARCHIVES rather than deletes, that the
 * pipeline's own catalog repo returns what she stated, or — the one that
 * matters — that a quote computed against those rows loses its delivery date.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd440000-0000-4000-8000-${RUN}0001`;
const PID = `dd440000-0000-4000-8000-${RUN}0002`;

d('M44 · the factory closure calendar (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const CODE = 'closures-test-code';

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
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Closure Test Factory')
                on conflict (id) do nothing`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, lead_time_days, is_active)
                values (${PID}, ${BIZ}, 'CLO-1', 'Closure test bag', 'pcs', 1000, 25, true)
                on conflict (id) do nothing`.execute(t);
      await sql`insert into price_tiers (product_id, min_qty, max_qty, unit_price_usd, currency)
                values (${PID}, 1000, null, 0.45, 'USD')
                on conflict (product_id, min_qty) do nothing`.execute(t);
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

  const rows = () => tx((t) => sql<{ label: string; archived_at: Date | null }>`
    select label, archived_at from factory_closures where business_id = ${BIZ} order by starts_on
  `.execute(t).then((r) => r.rows.map((x) => ({ label: x.label, archived: x.archived_at !== null }))));

  it('THE PRODUCTION CALLER: she states a closure from her settings page', async () => {
    const res = await post('/app/settings/closures', 'label=%E6%98%A5%E8%8A%82&from=2027-02-05&to=2027-02-21');
    expect(res.statusCode).toBe(302);
    expect(await rows()).toEqual([{ label: '春节', archived: false }]);
  });

  it('the page shows it, in her own words', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/settings/closures', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('春节');
  });

  it('THE PIPELINE READS HER ROWS — not a calendar of ours', async () => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    const closures = await tx((t) => tenantRepos(t, bid.value).catalog.factoryClosures());
    expect(closures).toHaveLength(1);
    expect(closures[0]!.label).toBe('春节');
    expect(closures[0]!.from.toISOString().slice(0, 10)).toBe('2027-02-05');
    expect(closures[0]!.to.toISOString().slice(0, 10)).toBe('2027-02-21');
  });

  it('A QUOTE COMPUTED AGAINST THOSE ROWS LOSES ITS DELIVERY DATE', async () => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { computeQuote } = await import('../../src/core/commerce/quote.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');

    const { product, tiers, closures } = await tx(async (t) => {
      const repos = tenantRepos(t, bid.value);
      return {
        product: await repos.catalog.product(PID),
        tiers: await repos.catalog.priceTiers(PID),
        closures: await repos.catalog.factoryClosures(),
      };
    });
    expect(product).not.toBeNull();
    expect(product!.leadTimeDays).toBe(25);

    const inJanuary = computeQuote({
      product: product!, tiers, policy: null, rules: [], quantity: 20000,
      closures, now: new Date('2027-01-20T09:00:00Z'),
    });
    expect(inJanuary.ok).toBe(true);
    if (inJanuary.ok) {
      expect(inJanuary.value.leadTimeDays).toBeNull();
      expect(inJanuary.value.leadTimeBlocked?.closure.label).toBe('春节');
    }

    const inJune = computeQuote({
      product: product!, tiers, policy: null, rules: [], quantity: 20000,
      closures, now: new Date('2027-06-01T09:00:00Z'),
    });
    expect(inJune.ok).toBe(true);
    if (inJune.ok) expect(inJune.value.leadTimeDays).toBe(25);
  });

  it('a typo cannot be stored — a closure that ends before it starts blocks nothing', async () => {
    await expect(tx((t) => sql`
      insert into factory_closures (business_id, label, starts_on, ends_on)
      values (${BIZ}, 'backwards', '2027-03-10', '2027-03-01')
    `.execute(t))).rejects.toThrow(/factory_closures_ordered|violates check constraint/);
  });

  it('and neither can a nameless one', async () => {
    await expect(tx((t) => sql`
      insert into factory_closures (business_id, label, starts_on, ends_on)
      values (${BIZ}, '   ', '2027-03-01', '2027-03-10')
    `.execute(t))).rejects.toThrow(/violates check constraint/);
  });

  it('REMOVING archives — a past closure still explains a quote that promised no date', async () => {
    const id = await tx((t) => sql<{ id: string }>`
      select id from factory_closures where business_id = ${BIZ} and archived_at is null limit 1
    `.execute(t).then((r) => r.rows[0]!.id));

    const res = await post(`/app/settings/closures/${id}/remove`);
    expect(res.statusCode).toBe(302);

    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0]!.archived).toBe(true);

    // and the pipeline no longer blocks on it
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    expect(await tx((t) => tenantRepos(t, bid.value).catalog.factoryClosures())).toEqual([]);
  });

  it('THE CONVERSATION SURFACE says WHY no date was promised — from what the QUOTE said', async () => {
    // G5 — this used to re-run the closure check against the clock the page
    // was viewed at. But "no delivery date was promised" is a statement about
    // the quote: a closure added AFTER a date was promised made the card say
    // the opposite of what the buyer was told. The quote now records what it
    // said, and the card reads that — at any clock.
    const { loadConversationDetail } = await import('../../src/api/web/inbox.js');
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { usd } = await import('../../src/core/types/money.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    await post('/app/settings/closures', 'label=%E6%98%A5%E8%8A%82&from=2027-02-05&to=2027-02-21');

    const conversation = (phone: string) => tx(async (t) => {
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${phone}, 'Closure test buyer') returning id::text as id
      `.execute(t)).rows[0]!.id;
      return (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${BIZ}, ${client}::uuid, 'whatsapp', 'warm_intake') returning id::text as id
      `.execute(t)).rows[0]!.id;
    });
    const quote = (c: string, leadTimeDays: number | null, withheld: boolean) =>
      tx((t) => tenantRepos(t, bid.value).audit.recordQuote({
        conversationId: c as never, productId: PID, quantity: 20000, inputs: {},
        unitPrice: usd(0.45), discountPct: 0, total: usd(9000), requiresHuman: false, appliedRules: [],
        leadTimeDays,
        leadTimeWithheld: withheld
          ? { label: '春节', from: new Date('2027-02-05'), to: new Date('2027-02-21') } : null,
      }));

    const withheld = await conversation(`+8613${RUN}9`);
    await quote(withheld, null, true);
    const promised = await conversation(`+8613${RUN}8`);
    await quote(promised, 25, false);

    // What the quote said, whichever day the page is opened on.
    for (const at of ['2027-01-20T09:00:00Z', '2027-06-01T09:00:00Z']) {
      expect((await loadConversationDetail(db, BIZ, withheld, new Date(at)))!.leadTimeBlocked?.label).toBe('春节');
      // Inside her closure, but this quote DID state a date: the card must not
      // claim otherwise.
      expect((await loadConversationDetail(db, BIZ, promised, new Date(at)))!.leadTimeBlocked).toBeNull();
    }

    // and it is HER calendar the page names, with a way to go and change it
    const { renderConversationDetail } = await import('../../src/api/web/inbox.js');
    const detail = await loadConversationDetail(db, BIZ, withheld, new Date('2027-01-20T09:00:00Z'));
    const html = renderConversationDetail(detail!, 'en', new Date('2027-01-20T09:00:00Z'), null);
    expect(html).toContain('No delivery date was promised');
    expect(html).toContain('春节');
    expect(html).toContain('/app/settings/closures');
  });

  it('what she typed wrong does not become a closure', async () => {
    const before = (await rows()).length;
    for (const bad of ['label=&from=2027-02-05&to=2027-02-21', 'label=x&from=&to=2027-02-21',
      'label=x&from=2027-02-21&to=2027-02-05']) {
      expect((await post('/app/settings/closures', bad)).statusCode, bad).toBe(302);
    }
    expect(await rows()).toHaveLength(before);
  });
});
