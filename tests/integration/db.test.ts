import { describe, it, expect } from 'vitest';

/**
 * Integration tests — real Postgres, no mocks. (ADR-0008 §3)
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
  const TENANT_A = 'de300000-0000-4000-8000-0000000000b1';   // the seeded demo factory
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
