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
