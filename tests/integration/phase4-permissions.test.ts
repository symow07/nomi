import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant, flashSaid, flashWasRefusal, runDigits } from './tenant.js';

/**
 * Phase 4a — a sales assistant cannot change money or go-live state, and is
 * not shown the forms that would only refuse them.
 *
 * Two lists, both on OWNER_ONLY's existing rows (no new action):
 *   messaging_activation — Getting ready's answers (attest, the assistant's
 *     name, the practice run), who may be written to during the pilot, the
 *     WhatsApp number's Test / Disconnect / Reconnect, and where the owner's
 *     own alerts go;
 *   price_rules — a product's price and MOQ, the catalogue import (paste,
 *     photo, confirm), the exchange rate, and what a sample costs.
 *
 * For each: staff are refused with the owner notice AND nothing is written
 * (the rows are read back), the owner can still do it, and staff opening the
 * page see the values and "The owner decides this." in place of the form.
 * Samples' address and "handled" stay the job of whoever handles them.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `ddf4a000-0000-4000-8000-${RUN}0001`;
const PID = `ddf4a000-0000-4000-8000-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const CODE = 'phase4-permissions-owner-code';
// Code hashes are unique across every business, so each run needs its own.
const STAFF_CODE = `PFOUR-${RUN.toUpperCase()}`;
// channel_credentials.external_ref is unique across ALL tenants.
const NUMBER = `4${runDigits(RUN, 11)}`;
const LISTED = `+97150${runDigits(RUN, 7)}`;
/** The allowlist keeps a number as its digits: the comparison key. */
const digits = (phone: string): string => phone.replace(/\D/g, '');
const OWNER_NOTICE = 'Only the owner';
const DECIDES = 'The owner decides this.';

d('Phase 4a · money and going live are the owner’s (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let ownerCookie = '';
  let staffCookie = '';
  let sampleId = '';

  const login = async (code: string) => {
    const res = await app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    return String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  };

  const post = (cookie: string, url: string, payload = '') =>
    app.inject({
      method: 'POST', url, payload,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    });

  /** The price-sheet photo, as the browser sends it. */
  const BOUNDARY = '----phase4a';
  const photo = (cookie: string) => app.inject({
    method: 'POST', url: '/app/products/add/photo',
    headers: { cookie, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: `--${BOUNDARY}\r\nContent-Disposition: form-data; name="page"; filename="sheet.png"\r\n`
      + `Content-Type: image/png\r\n\r\n\x89PNG-not-really\r\n--${BOUNDARY}--\r\n`,
  });

  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  const rows = (table: string, order = '1') => tx((t) => sql<{ r: unknown }>`
    select to_jsonb(x) as r from ${sql.table(table)} x where business_id = ${BIZ} order by ${sql.raw(order)}
  `.execute(t).then((q) => q.rows.map((row) => row.r)));

  /** Everything a gated route could write, read back whole. */
  const snapshot = async () => ({
    onboarding: await rows('onboarding_state'),
    assistants: await rows('assistants', 'x.id'),
    allowlist: await rows('pilot_allowlist', 'x.phone'),
    channels: await rows('channels', 'x.kind'),
    credentials: await rows('channel_credentials', 'x.channel'),
    audit: await rows('channel_audit', 'x.id'),
    products: await rows('products', 'x.sku'),
    tiers: await tx((t) => sql<{ r: unknown }>`
      select to_jsonb(pt) as r from price_tiers pt join products p on p.id = pt.product_id
       where p.business_id = ${BIZ} order by pt.product_id, pt.min_qty`.execute(t).then((q) => q.rows.map((x) => x.r))),
    rates: await rows('owner_rates', 'x.stated_at'),
    samples: await rows('sample_policy', 'x.stated_at'),
    ownerPhone: await tx((t) => sql<{ owner_phone: string | null }>`
      select owner_phone from businesses where id = ${BIZ}`.execute(t).then((q) => q.rows[0]!.owner_phone)),
  });

  const ownerId = () => tx((t) => sql<{ id: string }>`
    select id::text as id from people where business_id = ${BIZ} and is_owner limit 1
  `.execute(t).then((r) => r.rows[0]!.id));

  /** Every write this phase gates, with a payload that WOULD succeed for the owner. */
  const GATED: ReadonlyArray<readonly [string, string]> = [
    ['/app/onboarding/attest', 'which=owner_ready'],
    ['/app/onboarding/assistant-name', 'name=Mira'],
    ['/app/onboarding/validate', ''],
    ['/app/factory/allowlist/add', 'phone=%2B971500001111&label=Staff%20try'],
    ['/app/factory/allowlist/remove', `phone=${encodeURIComponent(LISTED)}`],
    ['/app/channels/whatsapp/test', ''],
    ['/app/channels/whatsapp/disconnect', ''],
    ['/app/channels/whatsapp/reconnect', ''],
    ['/app/settings/owner-phone', 'phone=%2B971500002222'],
    [`/app/products/${PID}/edit`, 'price=0.10&moq=1&unit=pcs'],
    ['/app/products/add/review', `text=${encodeURIComponent('Staff mug $0.20 MOQ 10')}`],
    ['/app/products/add/confirm', `text=${encodeURIComponent('Staff mug $0.20 MOQ 10')}`],
    ['/app/settings/rate', 'rate=9.99'],
    ['/app/settings/samples', 'price=0&credited=on'],
  ];

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { hashCode } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    sampleId = await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Phase Four Factory')
                on conflict (id) do nothing`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active)
                values (${PID}, ${BIZ}, 'P4-1', 'Canvas tote', 'pcs', 500, true)`.execute(t);
      await sql`insert into people (business_id, name, code_hash)
                values (${BIZ}, 'Xiao Chen', ${hashCode(SECRET, STAFF_CODE)})`.execute(t);
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+8613${runDigits(RUN, 9)}`}, 'Ahmed') returning id::text as id`.execute(t)).rows[0]!.id;
      const conv = (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${BIZ}, ${client}::uuid, 'whatsapp', 'warm_intake') returning id::text as id`.execute(t)).rows[0]!.id;
      return (await sql<{ id: string }>`
        insert into sample_requests (business_id, conversation_id, asked_text)
        values (${BIZ}, ${conv}::uuid, 'Can I get a sample?') returning id::text as id`.execute(t)).rows[0]!.id;
    });

    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false, connectableNumber: NUMBER,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    ownerCookie = await login(CODE);
    staffCookie = await login(STAFF_CODE);
    expect(ownerCookie).not.toBe('');
    expect(staffCookie).not.toBe('');
    expect(staffCookie).not.toBe(ownerCookie);

    // The owner's own state before anyone else acts: a connected number, and
    // one person the pilot may write to — so Disconnect, Test and Remove exist.
    expect(flashSaid(await post(ownerCookie, '/app/channels/whatsapp/connect'), SECRET)).not.toContain(OWNER_NOTICE);
    expect(await tx((t) => sql<{ status: string }>`
      select status from channels where business_id = ${BIZ} and kind = 'whatsapp'`.execute(t)
      .then((r) => r.rows[0]?.status))).toBe('connected');
    await post(ownerCookie, '/app/factory/allowlist/add', `phone=${encodeURIComponent(LISTED)}&label=Buyer%20one`);
    expect((await rows('pilot_allowlist')).length).toBe(1);
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('STAFF ARE REFUSED every gated write, with the owner notice — and NOTHING is written', async () => {
    const before = await snapshot();
    for (const [url, payload] of GATED) {
      const res = await post(staffCookie, url, payload);
      expect(res.statusCode, url).toBe(302);
      expect(flashSaid(res, SECRET), url).toContain(OWNER_NOTICE);
      expect(flashWasRefusal(res, SECRET), url).toBe(true);
    }
    const shot = await photo(staffCookie);
    expect(shot.statusCode).toBe(302);
    expect(flashSaid(shot, SECRET)).toContain(OWNER_NOTICE);

    expect(await snapshot()).toEqual(before);
  });

  it('a refusal lands on the page the form was on', async () => {
    const where = async (url: string, payload = '') => String((await post(staffCookie, url, payload)).headers['location']);
    expect(await where('/app/onboarding/attest', 'which=owner_ready')).toBe('/app/onboarding');
    expect(await where('/app/factory/allowlist/add', 'phone=%2B971500001111')).toBe('/app/factory');
    expect(await where('/app/channels/whatsapp/disconnect')).toBe('/app/channels');
    expect(await where(`/app/products/${PID}/edit`, 'moq=1')).toBe(`/app/products/${PID}`);
    expect(await where('/app/products/add/confirm', 'text=x')).toBe('/app/products');
    expect(await where('/app/settings/rate', 'rate=9')).toBe('/app/settings/rate');
    expect(await where('/app/settings/samples', 'price=1')).toBe('/app/settings/samples');
  });

  it('STAFF SEE NO FORM THAT WOULD REFUSE THEM — the values, and whose decision they are', async () => {
    const pages: ReadonlyArray<readonly [string, RegExp]> = [
      ['/app/onboarding', /action="\/app\/onboarding\/(attest|assistant-name|validate)"/],
      ['/app/factory', /action="\/app\/factory\/allowlist\/(add|remove)"/],
      ['/app/channels', /action="\/app\/(channels\/whatsapp\/(test|disconnect|reconnect)|settings\/owner-phone)"/],
      ['/app/products', /href="\/app\/products\/add"/],
      ['/app/products/add', /action="\/app\/products\/add\/(review|photo)"/],
      [`/app/products/${PID}`, /action="\/app\/products\/[^"]+\/edit"/],
      ['/app/settings/rate', /action="\/app\/settings\/rate"/],
      ['/app/settings/samples', /action="\/app\/settings\/samples"/],
      ['/app/settings/terms', /action="\/app\/settings\/terms"/],
    ];
    for (const [url, form] of pages) {
      const owner = await get(ownerCookie, url);
      const staff = await get(staffCookie, url);
      expect([owner.statusCode, staff.statusCode], url).toEqual([200, 200]);
      // The owner's page carries the control, so its absence below is the viewer.
      expect(owner.body, url).toMatch(form);
      expect(staff.body, url).not.toMatch(form);
      if (url !== '/app/products') expect(staff.body, url).toContain(DECIDES);
    }
    // The values themselves are still there to read.
    const product = (await get(staffCookie, `/app/products/${PID}`)).body;
    expect(product).toContain('Canvas tote');
    expect(product).toContain('500');
    const factory = (await get(staffCookie, '/app/factory')).body;
    expect(factory).toContain(digits(LISTED));
    // Nor a door that opens only onto a refusal: the price limits are an owner page.
    for (const url of ['/app/onboarding', '/app/products', `/app/products/${PID}`, '/app/factory']) {
      expect((await get(staffCookie, url)).body, url).not.toContain('href="/app/factory/prices"');
    }
  });

  it('staff still do the sample job: the address and "handled" are not the owner’s', async () => {
    // The page offers them both to staff, beside the policy they may only read.
    const page = (await get(staffCookie, '/app/settings/samples')).body;
    expect(page).toContain(`action="/app/settings/samples/${sampleId}/address"`);
    expect(page).toContain(`action="/app/settings/samples/${sampleId}/handled"`);
    const addr = await post(staffCookie, `/app/settings/samples/${sampleId}/address`, 'address=Dubai%2C%20Warehouse%207');
    expect(flashSaid(addr, SECRET)).not.toContain(OWNER_NOTICE);
    const done = await post(staffCookie, `/app/settings/samples/${sampleId}/handled`);
    expect(flashSaid(done, SECRET)).not.toContain(OWNER_NOTICE);
    const row = await tx((t) => sql<{ address: string | null; handled_at: Date | null }>`
      select address, handled_at from sample_requests where id = ${sampleId}::uuid`.execute(t).then((r) => r.rows[0]!));
    expect(row.address).toBe('Dubai, Warehouse 7');
    expect(row.handled_at).not.toBeNull();
  });

  it('THE OWNER STILL DOES EACH — Getting ready', async () => {
    for (const [url, payload] of [
      ['/app/onboarding/attest', 'which=owner_ready'],
      ['/app/onboarding/assistant-name', 'name=Mira'],
      ['/app/onboarding/validate', ''],
    ] as const) {
      const res = await post(ownerCookie, url, payload);
      expect(res.statusCode, url).toBe(302);
      expect(flashSaid(res, SECRET), url).not.toContain(OWNER_NOTICE);
    }
    const st = await tx((t) => sql<{ owner_ready_at: Date | null; assistant_named_at: Date | null; last_validation_at: Date | null }>`
      select owner_ready_at, assistant_named_at, last_validation_at from onboarding_state where business_id = ${BIZ}
    `.execute(t).then((r) => r.rows[0]!));
    expect(st.owner_ready_at).not.toBeNull();
    expect(st.assistant_named_at).not.toBeNull();
    expect(st.last_validation_at).not.toBeNull();
  }, 60_000);

  it('THE OWNER STILL DOES EACH — who may be written to, the number, her alerts', async () => {
    const me = await ownerId();
    await post(ownerCookie, '/app/factory/allowlist/add', 'phone=%2B971500003333&label=Buyer%20two');
    await post(ownerCookie, '/app/factory/allowlist/remove', `phone=${encodeURIComponent(LISTED)}`);
    const list = await tx((t) => sql<{ phone: string; archived_at: Date | null; added_by: string }>`
      select phone, archived_at, added_by from pilot_allowlist where business_id = ${BIZ} order by phone
    `.execute(t).then((r) => r.rows));
    expect(list.find((x) => x.phone === '971500003333')).toMatchObject({ archived_at: null, added_by: me });
    expect(list.find((x) => x.phone === digits(LISTED))!.archived_at).not.toBeNull();

    const status = () => tx((t) => sql<{ status: string }>`
      select status from channels where business_id = ${BIZ} and kind = 'whatsapp'`.execute(t).then((r) => r.rows[0]!.status));
    expect(flashSaid(await post(ownerCookie, '/app/channels/whatsapp/test'), SECRET)).not.toContain(OWNER_NOTICE);
    await post(ownerCookie, '/app/channels/whatsapp/disconnect');
    expect(await status()).toBe('disconnected');
    await post(ownerCookie, '/app/channels/whatsapp/reconnect');
    expect(await status()).toBe('connected');
    const acts = await tx((t) => sql<{ action: string; actor: string }>`
      select action, actor from channel_audit where business_id = ${BIZ} and action in ('test', 'disconnect', 'reconnect') order by id
    `.execute(t).then((r) => r.rows));
    expect(acts.map((a) => a.action).sort()).toEqual(['disconnect', 'reconnect', 'test']);
    expect(acts.every((a) => a.actor === me)).toBe(true);

    await post(ownerCookie, '/app/settings/owner-phone', 'phone=%2B971500004444');
    expect(digits((await snapshot()).ownerPhone ?? '')).toBe('971500004444');
  });

  it('THE OWNER STILL DOES EACH — prices, the catalogue, the rate, what a sample costs', async () => {
    const edit = await post(ownerCookie, `/app/products/${PID}/edit`, 'price=1.25&moq=800&unit=pcs&isActive=on');
    expect(flashSaid(edit, SECRET)).not.toContain(OWNER_NOTICE);
    expect(await tx((t) => sql<{ moq: number }>`
      select moq from products where id = ${PID}`.execute(t).then((r) => r.rows[0]!.moq))).toBe(800);

    const text = 'Phase mug $2.60 MOQ 1000';
    const review = await post(ownerCookie, '/app/products/add/review', `text=${encodeURIComponent(text)}`);
    expect(review.statusCode).toBe(200);
    expect(review.body).toContain('action="/app/products/add/confirm"');
    const shot = await photo(ownerCookie);
    expect(shot.statusCode).toBe(200);             // no page reader here: a sentence, not a refusal
    expect(flashSaid(shot, SECRET)).not.toContain(OWNER_NOTICE);
    const confirm = await post(ownerCookie, '/app/products/add/confirm', `text=${encodeURIComponent(text)}`);
    expect(flashSaid(confirm, SECRET)).not.toContain(OWNER_NOTICE);
    expect((await snapshot()).products.length).toBe(2);

    await post(ownerCookie, '/app/settings/rate', 'rate=7.1');
    await post(ownerCookie, '/app/settings/samples', 'price=5&credited=on');
    const after = await snapshot();
    expect(after.rates).toHaveLength(1);
    expect(after.samples).toHaveLength(1);
  });

  it('the people page names what is now the owner’s', async () => {
    const page = (await get(ownerCookie, '/app/settings/people')).body;
    expect(page).toContain('Change prices, products, price limits and terms');
    expect(page).toContain('Get ready to go live');
  });
});
