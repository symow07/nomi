import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { createHmac, randomUUID } from 'node:crypto';

/**
 * M40.2 — bounces and complaints, arriving from the sending provider.
 *
 * The mapper is proven in parity. What only a real app can prove is that the
 * signature is required, that the tenant comes out of the signed token rather
 * than out of the request, and that a soft bounce writes nothing at all.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd402000-0000-4000-8000-${RUN}0001`;
const OTHER = `dd402000-0000-4000-8000-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const HOOK = 'an-email-webhook-shared-secret';

d('M40.2 · bounces and complaints (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;

  const inTenant = async <T>(biz: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  const suppression = (identity: string, biz = BIZ) => inTenant(biz, (t) =>
    sql<{ reason: string }>`select reason from suppressions
      where business_id = ${biz} and identity = ${identity}`
      .execute(t).then((r) => r.rows[0]?.reason ?? null));

  const tag = async (identity: string, biz = BIZ) => {
    const { mintUnsubscribe } = await import('../../src/outbound/unsubscribe.js');
    return mintUnsubscribe(SECRET, { businessId: biz, channel: 'email', identity, locale: 'en' });
  };

  const post = (events: unknown[], sign = true) => {
    const body = { events };
    const mac = createHmac('sha256', HOOK).update(JSON.stringify(body)).digest('base64url');
    return app.inject({
      method: 'POST', url: '/hooks/email', payload: body,
      headers: sign ? { 'x-webhook-signature': mac } : {},
    });
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    for (const b of [BIZ, OTHER]) {
      await inTenant(b, (t) => sql`insert into businesses (id, name)
        values (${b}, 'Events Factory') on conflict (id) do nothing`.execute(t));
    }
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: 'events-code', sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
      resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
      emailWebhookSecret: HOOK,
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('AN UNSIGNED CALL IS 404 — an open endpoint writes permanent rows', async () => {
    const res = await post([{ type: 'complaint', tag: await tag('x@example.com') }], false);
    expect(res.statusCode).toBe(404);
    expect(await suppression('x@example.com')).toBeNull();
  });

  it('a wrong signature is 404 too, and 404 rather than 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/hooks/email', payload: { events: [] },
      headers: { 'x-webhook-signature': 'not-the-right-one' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('a complaint suppresses, permanently', async () => {
    const res = await post([{ type: 'complaint', tag: await tag('angry@example.com') }]);
    expect(res.statusCode).toBe(200);
    expect(await suppression('angry@example.com')).toBe('complained');
  });

  it('A SOFT BOUNCE WRITES NOTHING — a full mailbox is not a dead one', async () => {
    const res = await post([
      { type: 'bounce', permanent: false, tag: await tag('full@example.com') },
      { type: 'bounce', tag: await tag('unclassified@example.com') },
      { type: 'delivered', tag: await tag('fine@example.com') },
    ]);
    expect(res.statusCode).toBe(200);
    for (const who of ['full@example.com', 'unclassified@example.com', 'fine@example.com']) {
      expect(await suppression(who), who).toBeNull();
    }
  });

  it('and a hard bounce does', async () => {
    await post([{ type: 'bounce', permanent: true, tag: await tag('gone@example.com') }]);
    expect(await suppression('gone@example.com')).toBe('bounced');
  });

  it('THE TENANT COMES FROM THE SIGNED TOKEN, not from the request', async () => {
    // The same address, tagged for another business, lands there and nowhere
    // else — a caller cannot suppress across tenants by claiming one.
    await post([{ type: 'complaint', tag: await tag('shared@example.com', OTHER) }]);
    expect(await suppression('shared@example.com', OTHER)).toBe('complained');
    expect(await suppression('shared@example.com', BIZ)).toBeNull();
  });

  it('an event with a forged or missing tag is ignored, and the batch still succeeds', async () => {
    const good = await tag('kept@example.com');
    const res = await post([
      { type: 'complaint' },                                    // no tag
      { type: 'complaint', tag: 'nonsense' },                   // forged
      { type: 'complaint', tag: `${good.split('.')[0]}.wrong` },
      { type: 'complaint', tag: good },
    ]);
    // Always 200 once the signature is good: an error makes the provider replay
    // a batch that already wrote permanent rows.
    expect(res.statusCode).toBe(200);
    expect(await suppression('kept@example.com')).toBe('complained');
  });

  it('a malformed body is accepted and does nothing', async () => {
    for (const body of [{}, { events: 'no' }, { events: [null, 7, 'x'] }]) {
      const mac = createHmac('sha256', HOOK).update(JSON.stringify(body)).digest('base64url');
      const res = await app.inject({
        method: 'POST', url: '/hooks/email', payload: body,
        headers: { 'x-webhook-signature': mac },
      });
      expect(res.statusCode, JSON.stringify(body)).toBe(200);
    }
  });
});
