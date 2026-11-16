// F26 (Block 4) — the product page edits in groups. The form contract: a group's form changes only the fields it
// drew (`group=details|pricing`); every field it did not draw stays as it is. A post with no group (a page drawn
// before the groups) is read exactly as it always was. Five cases, named as the supervisor asked (a–e).
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { createDb, withTenantTx, type Db, type Tx } from '../../src/db/client.js';
import { parseBusinessId } from '../../src/core/types/ids.js';
import { seedRunTenant } from './tenant.js';

const d = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;
const B = randomUUID(), P = randomUUID(), Q = randomUUID();
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
type Row = { price: string | null; currency: string; is_active: boolean; vetted: boolean; name: string; moq: number | null; options: unknown;
  tiers: string; floor: string | null; aliases: string };

d('F26 — the product page saves one group at a time', () => {
  let db: Db, admin: Db, app: ReturnType<typeof Fastify>, owner = '', staff = '', since = '';
  const tx = <T>(fn: (t: Tx) => Promise<T>) => { const b = parseBusinessId(B); if (!b.ok) throw Error('fixture'); return withTenantTx(db, b.value, fn); };
  const post = (url: string, payload: string, cookie = owner) => app.inject({ method: 'POST', url, payload, headers: { cookie, ...FORM } });
  const get = (url: string, cookie = owner) => app.inject({ method: 'GET', url, headers: { cookie } });
  const row = (id: string) => tx(async (t) => (await sql<Row>`
    select p.price_usd_per_unit as price, p.currency, p.is_active, p.quote_vetted_at is not null as vetted, p.name, p.moq, p.options,
           (select string_agg(min_qty || '=' || unit_price_usd || ' ' || currency, ',' order by min_qty) from price_tiers where product_id = p.id) as tiers,
           (select floor_price_usd::text from pricing_policy where product_id = p.id) as floor,
           (select string_agg(alias, ',' order by alias) from product_aliases where product_id = p.id) as aliases
      from products p where p.id = ${id}::uuid`.execute(t)).rows[0]!);
  const audits = (id: string) => tx(async (t) => (await sql<{ detail: { productId: string; changes: Record<string, unknown> } }>`
    select detail from channel_audit where business_id = ${B}::uuid and action = 'product_edited' and detail->>'productId' = ${id}
       and at > ${since}::timestamptz order by at`.execute(t)).rows.map((r) => r.detail.changes));
  // The same product twice, as each case starts: a price, a larger order's price, vetted, offered, its own floor.
  // Written as the fixture's owner (the app role may not erase a price); the audit trail is only read after `since`.
  const reset = () => admin.transaction().execute(async (t) => {
    for (const id of [P, Q]) {
      await sql`update products set name = 'Linen Apron', price_usd_per_unit = 4, currency = 'USD', is_active = true, moq = 10,
                  options = '[]'::jsonb, lead_time_days = 5, unit = 'pcs', quote_vetted_at = now() where id = ${id}::uuid`.execute(t);
      await sql`delete from price_tiers where product_id = ${id}::uuid`.execute(t);
      await sql`delete from product_aliases where product_id = ${id}::uuid`.execute(t);
      await sql`insert into product_aliases (product_id, alias) values (${id}::uuid, 'Linen Apron')`.execute(t);
      await sql`insert into price_tiers (product_id, min_qty, unit_price_usd, currency) values (${id}::uuid, 10, 4, 'USD'), (${id}::uuid, 100, 3.5, 'USD')`.execute(t);
      await sql`update products set quote_vetted_at = now() where id = ${id}::uuid`.execute(t);
    }
    since = (await sql<{ at: string }>`select clock_timestamp()::text as at`.execute(t)).rows[0]!.at;
  });

  beforeAll(async () => {
    await seedRunTenant(); db = createDb(process.env['DATABASE_URL']!); admin = createDb(process.env['MIGRATE_DATABASE_URL']!);
    await tx(async (t) => {
      await sql`insert into businesses (id, name, owner_locale) values (${B}::uuid, 'Group saves', 'en')`.execute(t);
      for (const [id, sku] of [[P, 'LA-1'], [Q, 'LA-2']] as const) {
        await sql`insert into products (id, business_id, sku, name, unit, moq, price_usd_per_unit, currency, is_active)
                  values (${id}::uuid, ${B}::uuid, ${sku}, 'Linen Apron', 'pcs', 10, 4, 'USD', true)`.execute(t);
        await sql`insert into product_aliases (product_id, alias) values (${id}::uuid, 'Linen Apron')`.execute(t);
        await sql`insert into pricing_policy (business_id, product_id, floor_price_usd, currency, max_discount_pct, human_required_above_pct)
                  values (${B}::uuid, ${id}::uuid, 3, 'USD', 10, 7)`.execute(t);
      }
    });
    const { registerWebApp } = await import('../../src/api/web/app.js'); app = Fastify({ logger: false });
    const secret = 'block-four-group-saves-session-secret-32';
    registerWebApp(app, { db, businessId: B, accessCode: 'b4-owner', sessionSecret: secret, employeeName: 'Lily', avatar: 'L', provider: 'disabled',
      secureCookie: false, messagingEnabled: false, factsTtlMs: 0, kickOutbound: async () => {}, kickDrive: async () => {} } as unknown as Parameters<typeof registerWebApp>[1]);
    const login = async (code: string) => String((await post('/login', 'code=' + encodeURIComponent(code), '')).headers['set-cookie'] ?? '').split(';')[0]!;
    owner = await login('b4-owner');
    const { addPerson } = await import('../../src/api/web/people.js');
    const s = await addPerson(db, B, secret, 'Group staff', 'team'); if (s.code !== 'added') throw Error('people fixture');
    staff = await login(s.accessCode);
  }, 60_000);
  beforeEach(reset);
  afterAll(async () => { await app?.close(); await db?.destroy(); await admin?.destroy(); });

  it('(a) a Details-only save leaves the price, the tiers, the currency, quote_vetted_at, isActive and the floor unchanged', async () => {
    const before = await row(P);
    // Undrawn fields posted anyway (a stray price, a tier, no isActive box) are not read: the Details form did not draw them.
    const r = await post(`/app/products/${P}/edit`, 'group=details&name=Linen+Apron+Natural&customerNames=kitchen+apron&options=Size%3A+S%2C+M&price=9.99&tier%3A100=1&moq=1');
    expect(r.statusCode).toBe(302);
    const after = await row(P);
    expect(after.name).toBe('Linen Apron Natural');
    expect(after.aliases).toContain('kitchen apron');
    expect(after.options).not.toEqual([]);
    for (const k of ['price', 'tiers', 'currency', 'vetted', 'is_active', 'floor', 'moq'] as const) expect(after[k], k).toEqual(before[k]);
    expect(after.vetted).toBe(true); expect(after.is_active).toBe(true); expect(after.floor).toBe('3.0000');
    const changes = await audits(P);
    expect(changes).toHaveLength(1);
    expect(Object.keys(changes[0]!).sort()).toEqual(['customerNames', 'name', 'options']);
  });

  it('(b) the Pricing save still unvets (R3) and writes product_edited exactly as a whole-form save does', async () => {
    // The page before the groups posted every field; the Pricing form posts only its own. Same move, same record.
    const whole = await post(`/app/products/${P}/edit`, 'name=Linen+Apron&customerNames=&options=&price=4.25&unit=pcs&tier%3A100=3.5&moq=10&leadTime=5&isActive=on');
    const grouped = await post(`/app/products/${Q}/edit`, 'group=pricing&price=4.25&unit=pcs&tier%3A100=3.5&moq=10&leadTime=5&isActive=on');
    expect(whole.statusCode).toBe(302); expect(grouped.statusCode).toBe(302);
    expect(grouped.headers['location']).toBe(whole.headers['location']!.toString().replace(P, Q));
    const [a, b] = [await row(P), await row(Q)];
    expect(a.vetted).toBe(false); expect(b.vetted).toBe(false);
    expect(Number(b.price)).toBe(4.25);
    expect({ ...b, name: 0 }).toEqual({ ...a, name: 0 });
    const [ca, cb] = [await audits(P), await audits(Q)];
    expect(cb).toEqual(ca);
    expect(cb).toEqual([{ price: { from: '4', to: '4.25' } }]);
  });

  it('(c) unticking the active box on the form that draws it still switches the product off', async () => {
    const r = await post(`/app/products/${P}/edit`, 'group=pricing&price=4&unit=pcs&tier%3A100=3.5&moq=10&leadTime=5');
    expect(r.statusCode).toBe(302);
    const after = await row(P);
    expect(after.is_active).toBe(false);
    expect(after.vetted).toBe(true);
    expect(await audits(P)).toEqual([{ isActive: { from: true, to: false } }]);
  });

  it('(d) staff are refused the same way with a group as without, and are shown no form', async () => {
    const plain = await post(`/app/products/${P}/edit`, 'name=Staff+name', staff);
    for (const g of ['details', 'pricing']) {
      const r = await post(`/app/products/${P}/edit`, `group=${g}&name=Staff+name&price=1`, staff);
      expect(r.statusCode, g).toBe(plain.statusCode);
      expect(r.headers['location'], g).toBe(plain.headers['location']);
      expect(r.body, g).toBe(plain.body);
    }
    expect(await row(P)).toMatchObject({ name: 'Linen Apron', is_active: true, vetted: true });
    expect(await audits(P)).toEqual([]);
    const page = await get(`/app/products/${P}`, staff);
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('/edit"');
    expect(page.body).not.toContain('name="group"');
    expect(page.body).not.toMatch(/<form[^>]*method="post"/);
  });

  it('(e) a post with no group marker (an older page in a tab) behaves exactly as today', async () => {
    // Today's reading: every field is read, and an absent active box means "off".
    const r = await post(`/app/products/${P}/edit`, 'name=Linen+Apron+Old+Tab');
    expect(r.statusCode).toBe(302);
    const after = await row(P);
    expect(after.name).toBe('Linen Apron Old Tab');
    expect(after.is_active).toBe(false);
    expect(Number(after.price)).toBe(4); expect(after.vetted).toBe(true); expect(after.floor).toBe('3.0000');
    expect(Object.keys((await audits(P))[0]!).sort()).toEqual(['isActive', 'name']);
    // An unknown group is no group.
    await reset();
    await post(`/app/products/${P}/edit`, 'group=everything&name=Linen+Apron+Odd');
    expect(await row(P)).toMatchObject({ name: 'Linen Apron Odd', is_active: false });
  });
});
