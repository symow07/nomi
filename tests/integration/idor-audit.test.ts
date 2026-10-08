import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant, flashSaid, runDigits } from './tenant.js';

/**
 * The IDOR audit (2026-10-08, docs/PRE-LAUNCH.md item 0): what one business, or one person, could reach of another's,
 * and is now refused. Each case reads the rows back: a refusal that still wrote something is not a refusal.
 *
 *   - the installation's own WhatsApp number and Instagram account are its own workspace's: another workspace's
 *     owner is neither offered them nor able to claim them;
 *   - the price floor, the discount ceiling and the ask line on "What {name} may promise" are the owner's;
 *   - the language switch sets the OWNER's alert language for the owner alone, and never from another site;
 *   - a fact is taught only to a product of this workspace.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd1d0000-0000-4000-8000-${RUN}0001`;
const OTHER = `dd1d0000-0000-4000-8000-${RUN}0002`;
const PID = `dd1d0000-0000-4000-8000-${RUN}0003`;
const OTHER_PID = `dd1d0000-0000-4000-8000-${RUN}0004`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const CODE = 'idor-audit-owner-code';
const STAFF_CODE = `IDOR-${RUN.toUpperCase()}`;
// channel_credentials.external_ref is unique across ALL tenants.
const NUMBER = `5${runDigits(RUN, 11)}`;
const IG = `17841${runDigits(RUN, 10)}`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('The IDOR audit · one business, or one person, never reaches another\'s (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let ownerCookie = '';
  let staffCookie = '';
  let otherCookie = '';

  const as = async <T>(business: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(business); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const get = (cookie: string, url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers: { cookie, ...headers } });
  const post = (cookie: string, url: string, payload = '') => app.inject({ method: 'POST', url, payload, headers: { cookie, ...FORM } });
  const credentials = (business: string) => as(business, (t) => sql<{ ref: string }>`
    select external_ref as ref from channel_credentials where business_id = ${business}`.execute(t).then((r) => r.rows.map((x) => x.ref)));
  const ownerLocale = () => as(BIZ, (t) => sql<{ l: string | null }>`
    select owner_locale as l from businesses where id = ${BIZ}`.execute(t).then((r) => r.rows[0]!.l));

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { hashCode } = await import('../../src/api/web/people.js');
    const { makeSessionCodec } = await import('../../src/api/web/session.js');
    db = createDb(DATABASE_URL!);
    await as(BIZ, async (t) => {
      await sql`insert into businesses (id, name, owner_locale) values (${BIZ}, 'Installation Shop', 'en') on conflict (id) do nothing`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active) values (${PID}, ${BIZ}, 'I-1', 'Canvas tote', 'pcs', 10, true)`.execute(t);
      await sql`insert into pricing_policy (business_id, product_id, floor_price_usd, currency, max_discount_pct, human_required_above_pct)
                values (${BIZ}, null, 7.25, 'USD', 12, 8)`.execute(t);
      await sql`insert into people (business_id, name, code_hash) values (${BIZ}, 'Mina', ${hashCode(SECRET, STAFF_CODE)})`.execute(t);
    });
    await as(OTHER, async (t) => {
      await sql`insert into businesses (id, name) values (${OTHER}, 'Another Shop') on conflict (id) do nothing`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active) values (${OTHER_PID}, ${OTHER}, 'O-1', 'Their mug', 'pcs', 10, true)`.execute(t);
    });

    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: true, connectableNumber: NUMBER, instagramAccountId: IG,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = async (code: string) => String((await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    ownerCookie = await login(CODE);
    staffCookie = await login(STAFF_CODE);
    // Another workspace's owner, signed in as the app signs anyone in (no person: the owner).
    otherCookie = `yf_session=${makeSessionCodec(SECRET).sign({ businessId: OTHER, exp: Date.now() + 3_600_000 })}`;
    expect(ownerCookie).not.toBe('');
    expect(staffCookie).not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('the installation\'s own number and Instagram account: another workspace\'s owner cannot claim them', async () => {
    // (whether the page offers them is decided by the same hostChannels; tests/parity/web-session.test.ts holds
    // that every place reads them through it. Here, the claim itself, and the rows.)
    // pressing Connect connects nothing, and the number and the account stay unclaimed
    for (const url of ['/app/channels/whatsapp/connect', '/app/channels/instagram/connect']) {
      const res = await post(otherCookie, url);
      expect(res.statusCode, url).toBe(302);
      expect(flashSaid(res, SECRET), url).not.toContain('onnected');
    }
    expect(await credentials(OTHER)).toEqual([]);
    // the control: the installation's own owner still connects them
    await post(ownerCookie, '/app/channels/whatsapp/connect');
    await post(ownerCookie, '/app/channels/instagram/connect');
    expect((await credentials(BIZ)).sort()).toEqual([IG, NUMBER].sort());
  });

  it('what {name} may promise: the owner sees the price floor and the price rules; a member of staff sees none of them', async () => {
    const owner = (await get(ownerCookie, '/app/business/promises')).body;
    const staff = (await get(staffCookie, '/app/business/promises')).body;
    // (with no volume discount written, the ceiling and the ask line are not stated to anyone: the list holds the
    // floor and "nothing comes off a price")
    expect(owner).toContain('7.25');
    expect(owner).toContain('class="frules"');
    expect(staff).not.toContain('7.25');
    expect(staff).not.toContain('class="frules"');
    // the page itself is still theirs to read: what may be promised about certifications stays
    expect(staff).toContain('id="certs"');
  });

  it('the language switch: a member of staff switches their own page, never the owner\'s alerts; nor does a link from another site', async () => {
    expect(await ownerLocale()).toBe('en');
    const staff = await get(staffCookie, '/locale?set=zh&next=/app');
    expect(String(staff.headers['set-cookie'])).toContain('yf_locale=zh');   // their own page is switched
    expect(await ownerLocale()).toBe('en');                                  // the owner's alerts are not
    await get(ownerCookie, '/locale?set=ar&next=/app', { 'sec-fetch-site': 'cross-site' });
    expect(await ownerLocale()).toBe('en');
    // the control: the owner, from the app itself, does set them
    await get(ownerCookie, '/locale?set=fr&next=/app', { 'sec-fetch-site': 'same-origin' });
    expect(await ownerLocale()).toBe('fr');
  });

  it('a fact is taught only to a product of this workspace: another business\'s product id writes nothing', async () => {
    const facts = (product: string) => as(BIZ, (t) => sql<{ n: number }>`
      select count(*)::int as n from product_knowledge where product_id = ${product}::uuid`.execute(t).then((r) => r.rows[0]!.n));
    const teach = (product: string) => post(staffCookie, '/app/knowledge/teach',
      `productId=${product}&kind=material&label=${encodeURIComponent('Lining')}&content=${encodeURIComponent('Cotton inside')}`);
    // a row taught this way would be the teacher's own business's, pointing at the other's product: read it there
    // each is turned back as the form's ordinary refusal: never a crash (a 500 also mails the operator)
    expect((await teach(OTHER_PID)).statusCode).toBe(302);
    expect((await teach('not-a-product')).statusCode).toBe(302);
    expect(await facts(OTHER_PID)).toBe(0);
    expect(await as(BIZ, (t) => sql<{ n: number }>`
      select count(*)::int as n from product_knowledge where business_id = ${BIZ} and label = 'Lining'`.execute(t).then((r) => r.rows[0]!.n))).toBe(0);
    // the control: its own product is taught
    await teach(PID);
    expect(await facts(PID)).toBe(1);
  });
});
