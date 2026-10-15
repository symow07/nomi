import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * 0162 — each workspace numbers its own orders (the owner, 2026-10-15:
 * "Per-workspace numbering, no shared counter, no YW.").
 *
 * The parity suite proves the shape and the year. Only Postgres can prove that
 * two workspaces each start at 0001 and may hold the same reference, that an
 * order which rolls back leaves no gap, that two orders at once in one
 * workspace get two numbers, that one workspace cannot see another's count,
 * and that the installation's old counter is closed to the app.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const A = `dd162000-0000-4000-8000-${RUN}0001`;
const B = `dd162000-0000-4000-8000-${RUN}0002`;
const PA = `dd162000-0000-4000-8000-${RUN}0003`;
const PB = `dd162000-0000-4000-8000-${RUN}0004`;

d('0162 · each workspace numbers its own orders (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  const clients: Record<string, string> = {};
  let yearA = 0;
  let yearB = 0;

  const tx = async <T>(biz: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  const conversation = (biz: string) => tx(biz, async (t) => (await sql<{ id: string }>`
    insert into conversations (business_id, client_id, channel, phase)
    values (${biz}, ${clients[biz]!}::uuid, 'whatsapp', 'confirmation') returning id::text as id`.execute(t)).rows[0]!.id);

  /** An order through the one writer, as the owner's Confirm makes it. */
  const write = async (t: import('../../src/db/client.js').Tx, biz: string, conv: string) => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { usd } = await import('../../src/core/types/money.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    const order = {
      productId: biz === A ? PA : PB, quantity: { value: 500, unit: 'pcs' },
      unitPrice: usd(1.2), total: usd(600), email: null, paymentTerms: null, incoterm: null,
    } as unknown as import('../../src/core/types/commerce.js').ConfirmableOrder;
    return (await tenantRepos(t, bid.value).orders.create(conv as never, order)).orderReference;
  };
  const confirm = async (biz: string) => {
    const conv = await conversation(biz);
    return tx(biz, (t) => write(t, biz, conv));
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { numberingYear } = await import('../../src/db/orderNumbers.js');
    db = createDb(DATABASE_URL!);
    for (const [biz, name, zone, pid] of [[A, 'Numbers A', 'UTC', PA], [B, 'Numbers B', 'Asia/Shanghai', PB]] as const) {
      await tx(biz, async (t) => {
        await sql`insert into businesses (id, name, timezone) values (${biz}, ${name}, ${zone})
                  on conflict (id) do nothing`.execute(t);
        await sql`insert into products (id, business_id, sku, name, unit, moq, is_active)
                  values (${pid}, ${biz}, ${`ON-${RUN}`}, 'Gift box', 'pcs', 100, true)`.execute(t);
        clients[biz] = (await sql<{ id: string }>`
          insert into clients (business_id, phone, display_name)
          values (${biz}, ${`+97150${RUN}`}, 'Khalid') returning id::text as id`.execute(t)).rows[0]!.id;
      });
    }
    yearA = numberingYear(new Date(), 'UTC');
    yearB = numberingYear(new Date(), 'Asia/Shanghai');
  }, 60_000);

  afterAll(async () => { await db?.destroy(); });

  it('each workspace starts at 0001 and counts its own — the same reference in two workspaces, no YW', async () => {
    expect(await confirm(A)).toBe(`${yearA}-0001`);
    expect(await confirm(A)).toBe(`${yearA}-0002`);
    expect(await confirm(B)).toBe(`${yearB}-0001`);
    const refs = await tx(A, (t) => sql<{ r: string }>`
      select order_reference as r from orders where business_id = ${A} order by order_reference`.execute(t).then((x) => x.rows.map((r) => r.r)));
    expect(refs).toEqual([`${yearA}-0001`, `${yearA}-0002`]);
    for (const r of refs) expect(r).not.toMatch(/YW/);
  });

  it('an order that rolls back takes its number with it: the next one has no gap', async () => {
    const conv = await conversation(A);
    await expect(tx(A, async (t) => {
      expect(await write(t, A, conv)).toBe(`${yearA}-0003`);
      throw new Error('the owner\'s tap failed after the order was written');
    })).rejects.toThrow(/tap failed/);
    expect(await tx(A, (t) => write(t, A, conv))).toBe(`${yearA}-0003`);
  });

  it('two orders at once in one workspace get two numbers, one after the other', async () => {
    const got = await Promise.all([confirm(A), confirm(A)]);
    expect(got.sort()).toEqual([`${yearA}-0004`, `${yearA}-0005`]);
    expect(await confirm(B)).toBe(`${yearB}-0002`);
  });

  it('A NUMBER THAT LEFT IS NEVER GIVEN AGAIN (the owner, 2026-10-15): a committed order that is cancelled keeps its number', async () => {
    // Given back only when the order's own transaction rolls back — before anything outside could see it: the
    // confirmation is queued after the commit (src/pipeline/orderProposal.ts), and a proforma needs the committed order.
    const conv = await conversation(A);
    const ref = await tx(A, (t) => write(t, A, conv));
    expect(ref).toBe(`${yearA}-0006`);
    await tx(A, (t) => sql`update orders set status = 'cancelled' where business_id = ${A} and order_reference = ${ref}`.execute(t));
    expect(await confirm(A)).toBe(`${yearA}-0007`);
  });

  it('the year is the workspace\'s own: New Year\'s Eve in Shanghai is already next year', async () => {
    const { nextOrderReference } = await import('../../src/db/orderNumbers.js');
    // 20:00 UTC on 31 December is 04:00 on 1 January in Shanghai: a new year, a new count. Rolled back: nothing is kept.
    const eve = new Date(`${yearB}-12-31T20:00:00Z`);
    await expect(tx(B, async (t) => {
      expect(await nextOrderReference(t, B, eve)).toBe(`${yearB + 1}-0001`);
      expect(await nextOrderReference(t, B, eve)).toBe(`${yearB + 1}-0002`);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    // The same moment in a UTC workspace is still this year, and its count goes on.
    await expect(tx(A, async (t) => {
      expect(await nextOrderReference(t, A, new Date(`${yearA}-12-31T20:00:00Z`))).toBe(`${yearA}-0008`);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await confirm(B)).toBe(`${yearB}-0003`);
  });

  it('one workspace cannot see or raise another\'s count, and the old shared counter is closed to the app', async () => {
    const seen = await tx(A, (t) => sql<{ business_id: string }>`
      select business_id::text from order_numbers`.execute(t).then((x) => x.rows.map((r) => r.business_id)));
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([A]));
    await expect(tx(A, (t) => sql`
      insert into order_numbers (business_id, year, last_number) values (${B}, 2026, 99)`.execute(t)))
      .rejects.toThrow(/row-level security|violates/);
    await expect(tx(A, (t) => sql`select generate_order_reference()`.execute(t)))
      .rejects.toThrow(/permission denied/);
    // Unique within a workspace, no longer across all of them.
    await expect(tx(A, async (t) => {
      const conv = (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${A}, ${clients[A]!}::uuid, 'whatsapp', 'confirmation') returning id::text as id`.execute(t)).rows[0]!.id;
      await sql`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit,
                                    agreed_unit_price_usd, total_value_usd, currency, status)
                values (${`${yearA}-0001`}, ${A}, ${clients[A]!}::uuid, ${conv}::uuid, ${PA}, 1, 'pcs', 1, 1, 'USD', 'confirmed')`.execute(t);
    })).rejects.toThrow(/orders_business_reference/);
  });
});
