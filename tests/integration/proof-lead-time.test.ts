import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { usd } from '../../src/core/types/money.js';

/**
 * G5 — the buyer's proof page states only what the quote said about delivery.
 *
 * The page read `products.lead_time_days`. During one of her closures M44
 * withholds that very number from the quote and makes it unstateable in a
 * reply — and then the proof page printed it anyway, attributed to her
 * catalogue. This runs the real public route against real rows: a quote whose
 * date her closure withheld, a quote that stated one, and a quote from before
 * quotes recorded either.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `cc050000-0000-4000-8000-${RUN}0001`;
const CLIENT = `cc050000-0000-4000-8000-${RUN}0002`;
const CONV = `cc050000-0000-4000-8000-${RUN}0003`;
const PROD = `cc050000-0000-4000-8000-${RUN}0004`;

d('G5 · the proof page and a withheld date (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let bid: import('../../src/core/types/ids.js').BusinessId;

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, bid, fn);
  };

  /** A quote through the real writer, then its public page. */
  const pageFor = async (quote: { leadTimeDays: number | null; withheld: boolean } | 'legacy') => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { issueProofLink } = await import('../../src/api/web/proof.js');
    const quoteId = quote === 'legacy'
      ? await tx((t) => sql<{ id: string }>`
          insert into quotes (business_id, conversation_id, product_id, quantity,
                              inputs, unit_price_usd, total_usd, engine_version)
          values (${BIZ}, ${CONV}, ${PROD}, 20000, '{}'::jsonb, 0.38, 7600, 'before-g5')
          returning id::text as id`.execute(t).then((r) => r.rows[0]!.id))
      : (await tx((t) => tenantRepos(t, bid).audit.recordQuote({
          conversationId: CONV as never, productId: PROD, quantity: 20000, inputs: {},
          unitPrice: usd(0.38), discountPct: 0, total: usd(7600), requiresHuman: false, appliedRules: [],
          leadTimeDays: quote.leadTimeDays,
          leadTimeWithheld: quote.withheld
            ? { label: '春节', from: new Date('2027-02-05'), to: new Date('2027-02-21') } : null,
        }))).quoteId;
    const link = await issueProofLink(db, BIZ, quoteId);
    const res = await app.inject({ method: 'GET', url: `/p/${link!.token}` });
    expect(res.statusCode).toBe(200);
    return res.body;
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    bid = b.value;
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Lead Time Factory') on conflict (id) do nothing`.execute(t);
      await sql`insert into clients (id, business_id, display_name) values (${CLIENT}, ${BIZ}, 'Ahmed') on conflict (id) do nothing`.execute(t);
      await sql`insert into conversations (id, business_id, client_id, channel) values (${CONV}, ${BIZ}, ${CLIENT}, 'whatsapp') on conflict (id) do nothing`.execute(t);
      // The PRODUCT's lead time is 25 days. It is the number that must not
      // appear on a page whose quote did not state it.
      await sql`insert into products (id, business_id, sku, name, unit, moq, lead_time_days)
                values (${PROD}, ${BIZ}, ${'LT-' + RUN}, 'Canvas tote bag', 'pcs', 1000, 25)
                on conflict (id) do nothing`.execute(t);
    });
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: 'lead-time-test',
      sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('her closure withheld the date: the page says so, and never shows the product’s 25 days', async () => {
    const body = await pageFor({ leadTimeDays: null, withheld: true });
    expect(body).not.toContain('25 days');
    expect(body).toContain('春节');
    expect(body).toContain('2027-02-05');
    expect(body).toContain('2027-02-21');
  });

  it('a quote that stated a lead time shows that one', async () => {
    const body = await pageFor({ leadTimeDays: 25, withheld: false });
    expect(body).toContain('25 days');
  });

  it('a quote from before quotes recorded delivery states none, rather than guessing the product’s', async () => {
    const body = await pageFor('legacy');
    expect(body).not.toContain('25 days');
    expect(body).not.toContain('Lead time');
  });
});
