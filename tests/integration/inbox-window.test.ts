import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * A9 — a conversation that needs a person must not fall out of the window.
 *
 * WHAT THE AUDIT SAID, AND WHY IT WAS HALF RIGHT. `docs/AUDIT-2026-09-20.md`
 * reported that `limit 50` runs before the filters, "so past 50 conversations a
 * buyer silently vanishes from Needs you". The query does order before it caps,
 * and its `order by` deliberately floats the urgent cases — a comment in
 * `inbox.ts` says "a waiting HUMAN outranks everything, so a handoff can never
 * fall out of the 50-row window", and for THAT case it is correct.
 *
 * But "needs you" is wider than the two cases the ordering protects. It is
 *
 *     pending drafts > 0   OR   assigned_to is not null
 *
 * while the ordering floats only `assigned_to = 'unclaimed' and is_active`
 * (a buyer who asked for a person) and `pending > 0` (a draft waiting). A
 * conversation HANDED TO A NAMED PERSON (G12) is `assigned_to = <their id>` —
 * not the sentinel — so once she has replied and the last message is outbound
 * it scores the LOWEST priority in the ordering while still counting as "needs
 * you" and as that person's "Mine".
 *
 * That is the sharper version of the same bug, and it lands on the one case
 * with no other way through: `inbox.ts` says of Mine, "a staff member has no
 * phone, so this list is the only way a hand-off reaches them."
 *
 * THE COUNTS HAVE THE SAME SHAPE OF ERROR. `waitingCount`, `blockedCount` and
 * `mineCount` are computed by filtering the already-capped fifty rows, so each
 * one understates as soon as a business has more than fifty conversations —
 * and `defaultFilter` decides which tab opens from `waitingCount`.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `a9000000-0000-4000-8000-${RUN}0001`;
const STAFF = `a9000000-0000-4000-8000-${RUN}0002`;
/** Comfortably past the fifty-row window. */
const NOISE = 59;

d('A9 · nothing that needs a person falls out of the window (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let handed = '';

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);

    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Window Test Co')
                on conflict (id) do nothing`.execute(t);
      await sql`insert into people (id, business_id, name, code_hash)
                values (${STAFF}::uuid, ${BIZ}, 'Xiao Chen', ${`hash-${RUN}`})
                on conflict (id) do nothing`.execute(t);

      // ONE conversation handed to a named person, already replied to. It needs
      // her — it is on nobody else's list — and every sort key it has is the
      // lowest: not the waiting sentinel, no pending draft, last message
      // outbound, and the oldest message in the business.
      const c1 = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+9990${RUN}`}, 'Handed Buyer') returning id::text as id`.execute(t)).rows[0]!.id;
      handed = (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase, assigned_to, is_active)
        values (${BIZ}, ${c1}::uuid, 'whatsapp', 'warm_intake', ${STAFF}, true)
        returning id::text as id`.execute(t)).rows[0]!.id;
      await sql`insert into messages (conversation_id, direction, text_content, sent_at)
                values (${handed}::uuid, 'outbound', 'we replied to him', now() - interval '40 days')`.execute(t);

      // …and enough newer, noisier conversations to fill the window twice over.
      // Each is AI-owned with a recent inbound message, so each outranks it.
      for (let i = 0; i < NOISE; i++) {
        const cl = (await sql<{ id: string }>`
          insert into clients (business_id, phone, display_name)
          values (${BIZ}, ${`+9991${RUN}${String(i).padStart(2, '0')}`}, ${`Noise ${i}`})
          returning id::text as id`.execute(t)).rows[0]!.id;
        const cv = (await sql<{ id: string }>`
          insert into conversations (business_id, client_id, channel, phase, is_active)
          values (${BIZ}, ${cl}::uuid, 'whatsapp', 'warm_intake', true) returning id::text as id`.execute(t)).rows[0]!.id;
        await sql`insert into messages (conversation_id, direction, text_content, sent_at)
                  values (${cv}::uuid, 'inbound', 'hello', now() - make_interval(mins => ${i}))`.execute(t);
      }
    });
  }, 120_000);

  afterAll(async () => { await db?.destroy(); });

  const load = async (filter: 'all' | 'pending' | 'mine', viewerId?: string) => {
    const { loadInboxList } = await import('../../src/api/web/inbox.js');
    return loadInboxList(db, BIZ, filter, viewerId);
  };

  it('the fixture really is past the window', async () => {
    const n = await tx((t) => sql<{ n: number }>`
      select count(*)::int as n from conversations where business_id = ${BIZ}`
      .execute(t).then((r) => r.rows[0]!.n));
    expect(n).toBe(NOISE + 1);
    expect(n).toBeGreaterThan(50);
  });

  it('THE BUG: a conversation handed to a person is still on Needs you', async () => {
    const list = await load('pending');
    expect(list.conversations.map((c) => c.conversationId),
      'handed to a named person, replied to, and sixtieth by every sort key')
      .toContain(handed);
  });

  it('…and on THAT PERSON\'S Mine, which is the only way it reaches them', async () => {
    const list = await load('mine', STAFF);
    expect(list.conversations.map((c) => c.conversationId)).toContain(handed);
    expect(list.mineCount).toBe(1);
  });

  it('the counts are of everything, not of the fifty that were fetched', async () => {
    const list = await load('all');
    // One handed conversation needs a person; the other fifty-nine are hers.
    expect(list.waitingCount).toBe(1);
    // And the window itself is unchanged — this is about what is COUNTED and
    // what is SELECTED, not about returning every row to the page.
    expect(list.conversations.length).toBeLessThanOrEqual(50);
  });

  it('a filter still returns only what it says', async () => {
    const pending = await load('pending');
    for (const c of pending.conversations) {
      expect(c.needsAction || c.ownership !== 'AI', c.conversationId).toBe(true);
    }
    const all = await load('all');
    expect(all.conversations.length).toBeGreaterThan(pending.conversations.length);
  });
});
