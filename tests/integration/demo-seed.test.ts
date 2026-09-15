import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { seedRunTenant, RUN_BIZ } from './tenant.js';

/**
 * G21 — the demo factory tells a true story.
 *
 * It seeded six buyers with phone numbers and no `client_channels` row, which
 * is the row that says how a buyer can be REACHED. Everything downstream then
 * went quietly wrong on the tenant a new factory is shown first:
 *
 *   · `enqueueOutboundRow` returns null with no channel identity, so approving
 *     a draft reported "sent" while nothing was queued — and because nothing
 *     was queued, nothing was refused either, so the blocked-messages list that
 *     exists to catch exactly this stayed empty;
 *   · his 24-hour window read as expired, so the owner's own precheck said she
 *     could not message a buyer who had just written;
 *   · once messaging was activated, every seeded buyer would have read as a
 *     number that is not on her list.
 *
 * A demo that cannot send is a demo of the wrong product. These assert the row
 * and the one consequence that hid all the others.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

d('G21 · the seeded demo factory can actually be replied to (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
  }, 60_000);

  afterAll(async () => { await db?.destroy(); });

  it('every seeded buyer has the number he can be reached on', async () => {
    const rows = await tx((t) => sql<{ name: string; wa: string | null }>`
      select cl.display_name as name, cc.channel_user_id as wa
        from clients cl
        left join client_channels cc on cc.client_id = cl.id and cc.channel = 'whatsapp'
       where cl.business_id = ${RUN_BIZ}
       order by cl.display_name
    `.execute(t).then((r) => r.rows));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.wa === null).map((r) => r.name), 'buyers nobody can reply to').toEqual([]);
    // …and the number is digits, the shape the provider and the allowlist use.
    for (const r of rows) expect(r.wa, r.name).toMatch(/^\d{7,15}$/);
  });

  it('so a reply to a seeded conversation is QUEUED — the silence that hid everything else', async () => {
    const { enqueueOutboundRow } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    const conv = await tx((t) => sql<{ id: string }>`
      select id::text as id from conversations where business_id = ${RUN_BIZ} order by created_at limit 1
    `.execute(t).then((r) => r.rows[0]?.id));
    expect(conv, 'the demo seed has no conversations').toBeTruthy();

    const id = await tx((t) => enqueueOutboundRow(t, bid.value, conv!, 'A reply the demo can actually make.', 'owner'));
    // Null is what it returned before: no channel identity, nothing queued, and
    // the caller reporting success to the owner.
    expect(id).not.toBeNull();
    const row = await tx((t) => sql<{ to_wa_id: string; status: string }>`
      select to_wa_id, status from outbound_messages where id = ${id}::uuid`.execute(t).then((r) => r.rows[0]));
    expect(row?.to_wa_id).toMatch(/^\d{7,15}$/);
    expect(row?.status).toBe('queued');
  });

  it('and his reply window is open, the way a buyer who just wrote would be', async () => {
    const stale = await tx((t) => sql<{ n: number }>`
      select count(*)::int as n from client_channels cc
        join clients cl on cl.id = cc.client_id
       where cl.business_id = ${RUN_BIZ} and cc.last_inbound_at is null
    `.execute(t).then((r) => r.rows[0]!.n));
    expect(stale, 'a seeded buyer whose window reads as expired').toBe(0);
  });
});
