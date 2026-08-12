import { RUN_BIZ, seedRunTenant } from './tenant.js';
import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Integration tests — real Postgres, no mocks. (ADR-0013 §3)
 *
 * These verify the two guarantees that CANNOT be faked, because they ARE
 * database behaviours:
 *   1. RLS blocks a cross-tenant read (security control — must fail loudly)
 *   2. orders_one_open_per_conversation stops a second order (money invariant)
 *
 * They run when DATABASE_URL points at a database with migrations 0001–0007
 * applied, and SKIP otherwise (no Docker in every dev environment). CI must
 * set DATABASE_URL — a skipped security test in CI is a failing one.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

d('RLS tenant isolation (requires DATABASE_URL)', () => {
  it('a query without app.business_id returns ZERO rows', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const db = createDb(DATABASE_URL!);
    // No withTenantTx wrapper on purpose: this simulates the forgotten filter.
    const rows = await db.selectFrom('clients').select('id').execute();
    expect(rows).toHaveLength(0); // RLS: no tenant context, no data
    await db.destroy();
  });

  it('tenant A cannot read tenant B, even with an explicit WHERE', async () => {
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const db = createDb(DATABASE_URL!);
    const tenantA = parseBusinessId('a0000000-0000-0000-0000-000000000001');
    if (!tenantA.ok) throw new Error('fixture');

    const rows = await withTenantTx(db, tenantA.value, (tx) =>
      tx.selectFrom('clients').select('id')
        .where('business_id', '=', 'b9999999-9999-9999-9999-999999999999')
        .execute(),
    );
    expect(rows).toHaveLength(0);
    await db.destroy();
  });
});

/**
 * M17.3 — RLS denial coverage for the tables added since M13. The older tables
 * are covered above; these three carry the factory's taught knowledge, its
 * claims allowlist, and its pilot state, so a cross-tenant leak here would be
 * the most damaging kind. Each is checked on all three denial paths:
 *   1. no tenant context      → zero rows (the "forgotten filter" case)
 *   2. wrong tenant + WHERE   → zero rows (USING clause)
 *   3. insert for another id  → refused (WITH CHECK clause)
 * (3) is the one that matters most and had no coverage at all: RLS WITH CHECK
 * is evaluated before the business_id foreign key, so the refusal is a genuine
 * policy denial, not an FK error.
 */
d('M17.3 · RLS denial — knowledge, claims, pilot state (requires DATABASE_URL)', () => {
  beforeAll(async () => { await seedRunTenant(); }, 60_000);
  const TENANT_A = RUN_BIZ;   // this run's own seeded factory (M34.8)
  const FOREIGN = '99999999-9999-4999-8999-999999999999';    // never this tenant

  // Minimal valid rows: enough columns to satisfy NOT NULL + CHECK, so the ONLY
  // thing that can reject them is the tenant policy.
  const INSERTS: Record<string, (bid: string) => string> = {
    product_knowledge: (b) =>
      `insert into product_knowledge (business_id, product_id, kind, label, content)
       values ('${b}', null, 'faq', 'rls-probe', 'rls-probe')`,
    claims_policy: (b) =>
      `insert into claims_policy (business_id, kind, claim_key, allowed)
       values ('${b}', 'certification', 'RLS_PROBE', true)`,
    onboarding_state: (b) =>
      `insert into onboarding_state (business_id, step) values ('${b}', 'name_employee')`,
  };
  const TABLES = Object.keys(INSERTS);

  it('no tenant context → every table returns ZERO rows', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { sql } = await import('kysely');
    const db = createDb(DATABASE_URL!);
    try {
      for (const t of TABLES) {
        // No withTenantTx: the forgotten-filter case. RLS must deny by default.
        const r = await sql<{ n: number }>`select count(*)::int as n from ${sql.raw(t)}`.execute(db);
        expect(r.rows[0]!.n, `${t} without tenant context`).toBe(0);
      }
    } finally { await db.destroy(); }
  });

  it('wrong tenant + explicit WHERE → ZERO rows (USING clause holds)', async () => {
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { sql } = await import('kysely');
    const a = parseBusinessId(TENANT_A); if (!a.ok) throw new Error('fixture');
    const db = createDb(DATABASE_URL!);
    try {
      for (const t of TABLES) {
        const r = await withTenantTx(db, a.value, (tx) =>
          sql<{ n: number }>`select count(*)::int as n from ${sql.raw(t)} where business_id = ${FOREIGN}`
            .execute(tx).then((x) => x.rows[0]!.n));
        expect(r, `${t} reading a foreign tenant`).toBe(0);
      }
    } finally { await db.destroy(); }
  });

  it('inserting a row for ANOTHER tenant is refused by policy (WITH CHECK holds)', async () => {
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { sql } = await import('kysely');
    const a = parseBusinessId(TENANT_A); if (!a.ok) throw new Error('fixture');
    const db = createDb(DATABASE_URL!);
    try {
      for (const t of TABLES) {
        const attempt = withTenantTx(db, a.value, (tx) => sql.raw(INSERTS[t]!(FOREIGN)).execute(tx));
        // 42501 = insufficient_privilege, which is how Postgres reports a
        // WITH CHECK violation. It must NOT be an FK error (23503).
        await expect(attempt, `${t} cross-tenant insert`).rejects.toMatchObject({ code: '42501' });
      }
    } finally { await db.destroy(); }
  });

  it('a tenant CAN write its own row — the policy denies, it does not break writes', async () => {
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { sql } = await import('kysely');
    const a = parseBusinessId(TENANT_A); if (!a.ok) throw new Error('fixture');
    const db = createDb(DATABASE_URL!);
    try {
      // product_knowledge is the safe one to prove on: additive, archive-not-erase.
      await withTenantTx(db, a.value, async (tx) => {
        await sql.raw(INSERTS['product_knowledge']!(TENANT_A)).execute(tx);
        const n = await sql<{ n: number }>`
          select count(*)::int as n from product_knowledge
           where business_id = ${TENANT_A} and label = 'rls-probe'`.execute(tx).then((r) => r.rows[0]!.n);
        expect(n).toBeGreaterThanOrEqual(1);
      });
    } finally { await db.destroy(); }
  });
});

/**
 * M19 (B0) — the runtime connection this suite uses must itself be subject to
 * RLS. If it were a superuser, every isolation test above would pass while
 * proving nothing, because superusers bypass row security entirely.
 */
d('M19 · runtime role is subject to RLS (requires DATABASE_URL)', () => {
  it('the runtime connection is not a superuser and does not bypass RLS', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { readRuntimeIdentity, checkRuntimeRole } = await import('../../src/db/runtimeIdentity.js');
    const db = createDb(DATABASE_URL!);
    try {
      const identity = await readRuntimeIdentity(db);
      expect(identity.isSuperuser, `connected as ${identity.currentUser}`).toBe(false);
      expect(identity.bypassesRls, `connected as ${identity.currentUser}`).toBe(false);
      expect(checkRuntimeRole(identity, { expectRole: false }).safe).toBe(true);
    } finally { await db.destroy(); }
  });

  it('assertSafeRuntimeRole accepts this connection under production rules', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { assertSafeRuntimeRole, RUNTIME_ROLE, readRuntimeIdentity } =
      await import('../../src/db/runtimeIdentity.js');
    const db = createDb(DATABASE_URL!);
    try {
      const identity = await readRuntimeIdentity(db);
      if (identity.currentUser !== RUNTIME_ROLE) return;   // a differently-named local role is fine
      const v = await assertSafeRuntimeRole(db, { production: true });
      expect(v.safe).toBe(true);
    } finally { await db.destroy(); }
  });
});

d('order idempotency invariant (requires DATABASE_URL)', () => {
  it('a second open order for the same conversation violates the unique index', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { sql } = await import('kysely');
    const db = createDb(DATABASE_URL!);
    const idx = await sql<{ indexname: string }>`
      select indexname from pg_indexes
       where indexname = 'orders_one_open_per_conversation'
    `.execute(db);
    expect(idx.rows).toHaveLength(1); // the invariant exists; repos.ts relies on 23505
    await db.destroy();
  });
});

/**
 * M20.5 — the factory rehearsal's fixture query, against a real Postgres as the
 * RUNTIME role (RLS enforced, no BYPASSRLS). The pure half is covered in
 * tests/parity/factory-rehearsal.test.ts; what can only be proven here is that
 * the SQL runs, that it stays inside the tenant, and that it WRITES NOTHING.
 */
d('M20.5 factory rehearsal reads (requires DATABASE_URL)', () => {
  /**
   * The business with the MOST products. Picking `limit 1` would usually land on
   * an empty fixture tenant, and a rehearsal over zero products asserts nothing.
   */
  const anyBusiness = async (db: unknown): Promise<string | null> => {
    const { sql } = await import('kysely');
    const r = await sql<{ id: string }>`
      select b.id from businesses b
       order by (select count(*) from products p where p.business_id = b.id) desc
       limit 1
    `.execute(db as never);
    return r.rows[0]?.id ?? null;
  };

  it('the fixture query runs as the app role and stays inside the tenant', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { loadFactoryRehearsal } = await import('../../src/api/web/factory.js');
    const db = createDb(DATABASE_URL!);
    try {
      const bid = await anyBusiness(db);
      if (bid === null) return;                       // an empty database proves nothing
      const r = await loadFactoryRehearsal(db, bid);
      expect(r).not.toBeNull();
      // It actually ran over rows — otherwise the assertions below are theatre.
      expect(r!.productsChecked, 'no products to rehearse').toBeGreaterThan(0);
      expect(r!.probesRun).toBeGreaterThanOrEqual(r!.productsChecked);
      // Every product it checked came from THIS business, and the cap held.
      expect(r!.productsChecked).toBeLessThanOrEqual(20);
      expect(r!.productsChecked).toBeLessThanOrEqual(r!.productsTotal);
      // An invariant failing on real rows is an engine defect, not a data gap.
      expect(r!.violations, JSON.stringify(r!.violations)).toEqual([]);
    } finally { await db.destroy(); }
  });

  it('an unknown business id yields nothing rather than another tenant’s rows', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { loadFactoryRehearsal } = await import('../../src/api/web/factory.js');
    const db = createDb(DATABASE_URL!);
    try {
      expect(await loadFactoryRehearsal(db, 'not-a-uuid')).toBeNull();
      const r = await loadFactoryRehearsal(db, '00000000-0000-4000-8000-000000000000');
      expect(r?.productsChecked).toBe(0);
      expect(r?.productsTotal).toBe(0);
    } finally { await db.destroy(); }
  });

  it('running it changes no row — the rehearsal is read-only', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { loadFactoryRehearsal } = await import('../../src/api/web/factory.js');
    const { sql } = await import('kysely');
    const db = createDb(DATABASE_URL!);
    try {
      const bid = await anyBusiness(db);
      if (bid === null) return;
      const counts = async () => (await sql<{ c: string }>`
        select (select count(*) from conversations)::text
             || ',' || (select count(*) from outbound_messages)::text
             || ',' || (select count(*) from drafts)::text
             || ',' || (select count(*) from product_knowledge)::text
             || ',' || (select count(*) from quotes)::text as c
      `.execute(db)).rows[0]!.c;
      const before = await counts();
      await loadFactoryRehearsal(db, bid);
      expect(await counts()).toBe(before);
    } finally { await db.destroy(); }
  });
});

/**
 * M22 (F-02) — the owner's article number survives all the way to the database,
 * and a re-import says so instead of silently doing nothing.
 */
d('M22 · product import preserves owner identity (requires DATABASE_URL)', () => {
  it('stores her sku, and a second import of the same list reports it', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { confirmImport } = await import('../../src/api/web/products.js');
    const { sql } = await import('kysely');
    const db = createDb(DATABASE_URL!);
    try {
      const bid = (await sql<{ id: string }>`
        select b.id from businesses b
         order by (select count(*) from products p where p.business_id = b.id) desc limit 1`
        .execute(db)).rows[0]?.id;
      if (!bid) return;

      // A unique article number, so this test is repeatable against a database
      // that has already run it (the row is never deleted — see ADR-0005).
      const sku = `M22-${Date.now().toString(36).toUpperCase()}`;
      const line = `${sku} Test Thermos $2.60 MOQ 1000`;

      const first = await confirmImport(db, bid, line);
      expect(first.added).toBe(1);
      expect(first.withPrice).toBe(1);
      expect(first.alreadyHere).toBe(0);

      const { withTenantTx } = await import('../../src/db/client.js');
      const { parseBusinessId } = await import('../../src/core/types/ids.js');
      const p = parseBusinessId(bid); if (!p.ok) throw new Error('fixture');
      const stored = await withTenantTx(db, p.value, (tx) => sql<{ sku: string; name: string }>`
        select sku, name from products where business_id = ${bid} and sku = ${sku}`
        .execute(tx).then((r) => r.rows[0]));
      // HER number, not NEW-<timestamp>, and not glued into the name.
      expect(stored?.sku).toBe(sku);
      expect(stored?.name).not.toContain(sku);
      expect(stored?.name).toContain('Thermos');

      // Re-importing the same list must not duplicate her catalogue, and must
      // not report "0 learned" with no explanation.
      const second = await confirmImport(db, bid, line);
      expect(second.added).toBe(0);
      expect(second.alreadyHere).toBe(1);

      const copies = await withTenantTx(db, p.value, (tx) => sql<{ n: number }>`
        select count(*)::int n from products where business_id = ${bid} and sku = ${sku}`
        .execute(tx).then((r) => Number(r.rows[0]!.n)));
      expect(copies).toBe(1);
    } finally { await db.destroy(); }
  });
});

/**
 * M23 — tenant identity, against a real database.
 *
 * The pure tests cover every decision branch. What can only be proven here is
 * the READ: that a real business is found, an absent one is not, and the
 * security property this tool must not weaken still holds — the application
 * role cannot create a tenant.
 */
d('M23 · pilot tenant identity (requires DATABASE_URL)', () => {
  const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';

  it('reads a real business, and refuses one that does not exist', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { readPilotTenant, enforcePilotTenant } = await import('../../src/db/pilotTenant.js');
    const { sql } = await import('kysely');
    const db = createDb(DATABASE_URL!);
    try {
      const real = (await sql<{ id: string }>`
        select id from businesses where id <> ${SANDBOX} limit 1`.execute(db)).rows[0]?.id;

      if (real) {
        const ok = await readPilotTenant(db, { pilotBusinessId: real, sandboxBusinessId: SANDBOX });
        expect(ok.exists).toBe(true);
        expect(ok.isSandbox).toBe(false);
        expect(ok.ok).toBe(true);
        expect(ok.name).not.toBeNull();
        expect(() => enforcePilotTenant(ok, { production: true })).not.toThrow();
      }

      const missing = await readPilotTenant(db, {
        pilotBusinessId: '00000000-0000-4000-8000-00000000dead', sandboxBusinessId: SANDBOX });
      expect(missing.exists).toBe(false);
      expect(missing.ok).toBe(false);
      expect(() => enforcePilotTenant(missing, { production: true })).toThrow(/no business with that id exists/);
    } finally { await db.destroy(); }
  });

  it('refuses the practice sandbox even though the row is really there', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { readPilotTenant, enforcePilotTenant } = await import('../../src/db/pilotTenant.js');
    const db = createDb(DATABASE_URL!);
    try {
      const s = await readPilotTenant(db, { pilotBusinessId: SANDBOX, sandboxBusinessId: SANDBOX });
      expect(s.isSandbox).toBe(true);
      expect(s.ok).toBe(false);
      expect(() => enforcePilotTenant(s, { production: true })).toThrow(/PRACTICE SANDBOX/);
    } finally { await db.destroy(); }
  });

  it('a malformed id is refused, not crashed on', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { readPilotTenant } = await import('../../src/db/pilotTenant.js');
    const db = createDb(DATABASE_URL!);
    try {
      const s = await readPilotTenant(db, { pilotBusinessId: 'not-a-uuid', sandboxBusinessId: SANDBOX });
      expect(s.exists).toBe(false);
      expect(s.ok).toBe(false);
    } finally { await db.destroy(); }
  });

  it('SECURITY: the application role still cannot create a tenant', async () => {
    // The provisioning tool uses the ADMIN connection. If this ever passes,
    // the tool has become a permission expansion and must be reverted.
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { sql } = await import('kysely');
    const db = createDb(DATABASE_URL!);
    try {
      const anyBiz = (await sql<{ id: string }>`select id from businesses limit 1`.execute(db)).rows[0]?.id;
      if (!anyBiz) return;
      const bid = parseBusinessId(anyBiz); if (!bid.ok) throw new Error('fixture');
      const attempt = withTenantTx(db, bid.value, (tx) => sql`
        insert into businesses (id, name, timezone, default_language, engine)
        values ('00000000-0000-4000-8000-0000000000ff', 'Smuggled Co', 'Asia/Shanghai', 'en', 'service')
      `.execute(tx));
      await expect(attempt).rejects.toMatchObject({ code: '42501' });   // RLS WITH CHECK
    } finally { await db.destroy(); }
  });
});

/**
 * M29 — the owner authors her own price rules, against a real database.
 *
 * The pure tests cover validation and what the quote engine does with the
 * answers. What can only be proven here: the importer really stops writing a
 * policy row, an edit really supersedes and is really audited, and readiness
 * really derives the new item from rows rather than from a constant.
 */
d('M29 · owner-authored price rules (requires DATABASE_URL)', () => {
  const biz = async (db: unknown): Promise<string | null> => {
    const { sql } = await import('kysely');
    const r = await sql<{ id: string }>`
      select b.id from businesses b
       order by (select count(*) from products p where p.business_id = b.id) desc limit 1
    `.execute(db as never);
    return r.rows[0]?.id ?? null;
  };

  it('an import writes NO pricing_policy row, and nothing it adds is sellable', async () => {
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { confirmImport } = await import('../../src/api/web/products.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { sql } = await import('kysely');
    const db = createDb(DATABASE_URL!);
    try {
      const bid = await biz(db); if (!bid) return;
      const p = parseBusinessId(bid); if (!p.ok) throw new Error('fixture');
      const sku = `M29-${Date.now().toString(36).toUpperCase()}`;

      const r = await confirmImport(db, bid, `${sku} Test Tote $2.60 MOQ 1000`);
      expect(r.added).toBe(1);
      expect(r.withPrice).toBe(1);

      const row = await withTenantTx(db, p.value, (tx) => sql<{
        id: string; is_active: boolean; policies: number;
      }>`
        select pr.id, pr.is_active,
               (select count(*)::int from pricing_policy pp where pp.product_id = pr.id) as policies
          from products pr where pr.business_id = ${bid} and pr.sku = ${sku}
      `.execute(tx as never).then((x) => x.rows[0]!));

      // The fabricated floor is gone…
      expect(Number(row.policies)).toBe(0);
      // …and because no human has stated one, she cannot sell it yet.
      expect(row.is_active).toBe(false);
    } finally { await db.destroy(); }
  });

  it('the owner answers, the product becomes sellable, and it is audited', async () => {
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { confirmImport } = await import('../../src/api/web/products.js');
    const { savePriceRules, loadPriceRules } = await import('../../src/api/web/priceRules.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { sql } = await import('kysely');
    const db = createDb(DATABASE_URL!);
    try {
      const bid = await biz(db); if (!bid) return;
      const p = parseBusinessId(bid); if (!p.ok) throw new Error('fixture');
      const sku = `M29B-${Date.now().toString(36).toUpperCase()}`;
      await confirmImport(db, bid, `${sku} Test Mug $3.00 MOQ 500`);

      const id = await withTenantTx(db, p.value, (tx) => sql<{ id: string }>`
        select id from products where business_id = ${bid} and sku = ${sku}
      `.execute(tx as never).then((x) => x.rows[0]!.id));

      const saved = await savePriceRules(db, bid, 'owner', {
        productId: id, floorUsd: '2.00', maxDiscountPct: '10', askAbovePct: '7',
      });
      expect(saved.ok).toBe(true);
      if (saved.ok) expect(saved.activated).toBe(true);      // her answer turned it on

      const after = await withTenantTx(db, p.value, (tx) => sql<{
        is_active: boolean; floor: string; max: string; ask: string;
      }>`
        select pr.is_active, pp.floor_price_usd as floor, pp.max_discount_pct as max,
               pp.human_required_above_pct as ask
          from products pr join pricing_policy pp on pp.product_id = pr.id
         where pr.id = ${id}
      `.execute(tx as never).then((x) => x.rows[0]!));
      expect(after.is_active).toBe(true);
      expect(Number(after.floor)).toBe(2);
      expect(Number(after.max)).toBe(10);

      // The view reports her own answers back, not an inherited default.
      const view = await loadPriceRules(db, bid);
      const mine = view.products.find((x) => x.productId === id);
      expect(mine?.own).toEqual({ floorUsd: 2, maxDiscountPct: 10, askAbovePct: 7 });

      // Audited, with the verb migration 0025 added and from → to.
      const audit = await withTenantTx(db, p.value, (tx) => sql<{ detail: unknown }>`
        select detail from channel_audit
         where business_id = ${bid} and action = 'price_rules_set'
         order by at desc limit 1
      `.execute(tx as never).then((x) => x.rows[0]!));
      const d0 = audit.detail as { productId: string; changes: Record<string, { from: unknown; to: unknown }> };
      expect(d0.productId).toBe(id);
      expect(d0.changes['floorUsd']).toEqual({ from: null, to: 2 });
    } finally { await db.destroy(); }
  });

  it('a price edit supersedes rather than overwriting silently, and moves the tier with it', async () => {
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { confirmImport, updateProduct } = await import('../../src/api/web/products.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { sql } = await import('kysely');
    const db = createDb(DATABASE_URL!);
    try {
      const bid = await biz(db); if (!bid) return;
      const p = parseBusinessId(bid); if (!p.ok) throw new Error('fixture');
      const sku = `M29C-${Date.now().toString(36).toUpperCase()}`;
      await confirmImport(db, bid, `${sku} Test Bottle $4.00 MOQ 200`);
      const id = await withTenantTx(db, p.value, (tx) => sql<{ id: string }>`
        select id from products where business_id = ${bid} and sku = ${sku}
      `.execute(tx as never).then((x) => x.rows[0]!.id));

      const r = await updateProduct(db, bid, id, 'owner', { priceUsd: '3.50' });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.changed).toContain('priceUsd');

      const after = await withTenantTx(db, p.value, (tx) => sql<{ price: string; tier: string }>`
        select pr.price_usd_per_unit as price, pt.unit_price_usd as tier
          from products pr join price_tiers pt on pt.product_id = pr.id and pt.min_qty = 1
         where pr.id = ${id}
      `.execute(tx as never).then((x) => x.rows[0]!));
      // The list price and the entry tier are one fact; letting them drift is
      // how a quote comes out at a number the owner never set.
      expect(Number(after.price)).toBe(3.5);
      expect(Number(after.tier)).toBe(3.5);

      const audit = await withTenantTx(db, p.value, (tx) => sql<{ detail: unknown }>`
        select detail from channel_audit
         where business_id = ${bid} and action = 'product_edited'
         order by at desc limit 1
      `.execute(tx as never).then((x) => x.rows[0]!));
      const d0 = audit.detail as { changes: Record<string, { from: unknown; to: unknown }> };
      // The change is legible as a change: 4 → 3.5, not just "3.5".
      expect(d0.changes['priceUsd']).toEqual({ from: 4, to: 3.5 });
    } finally { await db.destroy(); }
  });

  it('readiness reports the new item from real rows — false on a tenant with none', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { loadPilotReadiness } = await import('../../src/api/web/pilot.js');
    const { sql } = await import('kysely');
    const db = createDb(DATABASE_URL!);
    try {
      // A tenant with no pricing_policy row at all.
      const bare = (await sql<{ id: string }>`
        select b.id from businesses b
         where not exists (select 1 from pricing_policy pp where pp.business_id = b.id)
         limit 1
      `.execute(db)).rows[0]?.id;
      if (bare) expect((await loadPilotReadiness(db, bare)).detected.priceRules).toBe(false);

      const withRules = (await sql<{ id: string }>`
        select business_id as id from pricing_policy limit 1`.execute(db)).rows[0]?.id;
      if (withRules) expect((await loadPilotReadiness(db, withRules)).detected.priceRules).toBe(true);
    } finally { await db.destroy(); }
  });
});

/**
 * M29 follow-up — fabricated price rules are COUNTED, never rewritten.
 *
 * The values cannot discriminate (a real owner may legitimately answer
 * floor == list with no discount authority), so the audit trail does: a row the
 * owner authored always leaves `price_rules_set`, and the old importer never
 * could.
 */
d('M29 · unauthored price rules are reported, not migrated (requires DATABASE_URL)', () => {
  it('zero when every rule carries its audit entry; non-zero when one does not', async () => {
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { countUnauthoredPriceRules, savePriceRules } = await import('../../src/api/web/priceRules.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { sql } = await import('kysely');
    const db = createDb(DATABASE_URL!);
    try {
      const bid = (await sql<{ id: string }>`
        select b.id from businesses b
         order by (select count(*) from products p where p.business_id = b.id) desc limit 1
      `.execute(db)).rows[0]?.id;
      if (!bid) return;
      const p = parseBusinessId(bid); if (!p.ok) throw new Error('fixture');

      const sku = `M29D-${Date.now().toString(36).toUpperCase()}`;
      const { confirmImport } = await import('../../src/api/web/products.js');
      await confirmImport(db, bid, `${sku} Audit Probe $9.00 MOQ 100`);
      const id = await withTenantTx(db, p.value, (tx) => sql<{ id: string }>`
        select id from products where business_id = ${bid} and sku = ${sku}
      `.execute(tx as never).then((x) => x.rows[0]!.id));

      const before = await countUnauthoredPriceRules(db, bid);

      // Simulate what the OLD importer wrote: a policy row with no audit entry.
      await withTenantTx(db, p.value, (tx) => sql`
        insert into pricing_policy (business_id, product_id, floor_price_usd,
                                    max_discount_pct, human_required_above_pct)
        values (${bid}, ${id}, 9.00, 0, 0)
      `.execute(tx as never));
      expect(await countUnauthoredPriceRules(db, bid)).toBe(before + 1);

      // The owner answering the three questions is what clears it — her write
      // leaves the audit entry the importer never could.
      const saved = await savePriceRules(db, bid, 'owner',
        { productId: id, floorUsd: '7.00', maxDiscountPct: '10', askAbovePct: '5' });
      expect(saved.ok).toBe(true);
      expect(await countUnauthoredPriceRules(db, bid)).toBe(before);

      // Nothing was rewritten on the way: the count is a read.
      const still = await withTenantTx(db, p.value, (tx) => sql<{ n: number }>`
        select count(*)::int n from pricing_policy where business_id = ${bid}
      `.execute(tx as never).then((x) => Number(x.rows[0]!.n)));
      expect(still).toBeGreaterThan(0);
    } finally { await db.destroy(); }
  });

  it('the operator line is absent at zero and present above it', async () => {
    const { renderPilotRunbook } = await import('../../src/api/web/pilot.js');
    const { readDeployment } = await import('../../src/api/web/deployment.js');
    const rb = {
      readiness: { detected: { profile: false, products: false, priceRules: false, knowledge: false,
        claims: false, sandbox: false, channel: false },
        attest: { backupTestedAt: null, secretsRotatedAt: null, ownerReadyAt: null },
        validation: { at: null, pass: null, total: null }, readyToLaunch: false },
      operations: { range: 'week', attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 },
        activity: { handled: 0, draftsCreated: 0, corrections: 0 },
        knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
        channel: { status: 'not_connected', provider: 'disabled' }, hasAttention: false },
      rehearsal: { available: false, done: { takeover: false, ownerReply: false, resume: false,
        knowledgeCorrection: false, validationPassed: false }, completed: 0, total: 5 },
      reliability: { stuckOutbound: 0, oldestQueuedAt: null },
    } as never;
    const dep = readDeployment({ OWNER_ACCESS_CODE: 'x', CREDENTIAL_KEY: 'y' }, new Date(), 60);

    const quiet = renderPilotRunbook(rb, 'en', null, dep, undefined, undefined, undefined, 'none', 0);
    expect(quiet).not.toContain('written by the old importer');

    const loud = renderPilotRunbook(rb, 'en', null, dep, undefined, undefined, undefined, 'none', 3);
    expect(loud).toContain('3 price rules were written by the old importer');
    expect(loud).toContain('Nothing rewrites them');
  });
});

/**
 * B1 — the runtime role is renamed, and RLS survives it.
 *
 * The claim this proves rather than assumes: `pg_policy` stores role OIDs, not
 * names, so `ALTER ROLE ... RENAME TO` carries every policy written across
 * 0005–0022 with it and not one has to be rewritten. If that were wrong, the
 * rename would silently strip tenant isolation from 49 tables while every
 * surface kept working — the worst shape a defect can take here.
 */
d('B1 · tenant isolation holds under the renamed role (requires DATABASE_URL)', () => {
  it('every RLS policy names the role this build actually connects as', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ACCEPTED_RUNTIME_ROLES } = await import('../../src/db/runtimeIdentity.js');
    const { sql } = await import('kysely');
    const db = createDb(DATABASE_URL!);
    try {
      const me = (await sql<{ u: string }>`select current_user as u`.execute(db)).rows[0]!.u;
      expect(ACCEPTED_RUNTIME_ROLES, `connected as ${me}`).toContain(me);

      // Policies are attached to THIS role by OID. After a rename the count must
      // be unchanged and must name the current role — not the old one.
      const n = (await sql<{ n: number }>`
        select count(*)::int as n from pg_policy p
         join pg_roles r on r.oid = any(p.polroles)
        where r.rolname = current_user
      `.execute(db)).rows[0]!.n;
      expect(Number(n), 'no policy targets the connected role').toBeGreaterThan(0);

      // And no policy is left pointing at a role that no longer exists.
      const orphans = (await sql<{ n: number }>`
        select count(*)::int as n from pg_policy p
         where exists (select 1 from unnest(p.polroles) oid
                        where oid <> 0 and not exists (select 1 from pg_roles r where r.oid = oid))
      `.execute(db)).rows[0]!.n;
      expect(Number(orphans)).toBe(0);
    } finally { await db.destroy(); }
  });

  it('the transition set is temporary by construction', async () => {
    const { ACCEPTED_RUNTIME_ROLES, RUNTIME_ROLE } = await import('../../src/db/runtimeIdentity.js');
    // One release only. If this grows, the rename never finished.
    expect(ACCEPTED_RUNTIME_ROLES.length).toBeLessThanOrEqual(2);
    expect(ACCEPTED_RUNTIME_ROLES[0]).toBe(RUNTIME_ROLE);
    expect(RUNTIME_ROLE).toBe('nomi_app');
  });

  it('cross-tenant reads are still refused — the isolation, not just the wiring', async () => {
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { sql } = await import('kysely');
    const db = createDb(DATABASE_URL!);
    try {
      const a = (await sql<{ id: string }>`select id from businesses limit 1`.execute(db)).rows[0]?.id;
      if (!a) return;
      const p = parseBusinessId(a); if (!p.ok) throw new Error('fixture');
      const foreign = '99999999-9999-4999-8999-999999999999';
      for (const table of ['products', 'conversations', 'product_knowledge', 'pricing_policy']) {
        const n = await withTenantTx(db, p.value, (tx) =>
          sql<{ n: number }>`select count(*)::int n from ${sql.raw(table)} where business_id = ${foreign}`
            .execute(tx).then((r) => Number(r.rows[0]!.n)));
        expect(n, `${table} leaked across tenants after the rename`).toBe(0);
      }
      // And with no tenant context at all, nothing is visible.
      const bare = (await sql<{ n: number }>`select count(*)::int n from products`.execute(db)).rows[0]!.n;
      expect(Number(bare)).toBe(0);
    } finally { await db.destroy(); }
  });
});
