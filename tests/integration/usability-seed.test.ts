import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { seedRunTenant, RUN_NS, RUN_BIZ } from './tenant.js';
import {
  usabilitySeedSql, usabilityChecks, inNamespace, USABILITY_HANDED, USABILITY_DRAFT, USABILITY_CONVERSATIONS,
} from '../../src/demo/usability.js';

/**
 * The usability workspace (docs/USABILITY-SCRIPT.md "开始前的准备"), proven
 * through the readers the pages use — not through the seed's own counts.
 *
 * The line that matters most is the one A9 fixed: a conversation handed to a
 * named colleague, replied to and long idle scores the lowest priority there
 * is, so past fifty conversations it left "All"; it must still be on
 * "Waiting", because that is where task one sends the participant.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

d('usability workspace · what the pages read (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  const handedId = inNamespace(USABILITY_HANDED.id, RUN_NS);
  const draftId = inNamespace(USABILITY_DRAFT.id, RUN_NS);

  const seedTwice = async (): Promise<void> => {
    const pg = (await import('pg')).default;
    const c = new pg.Client({ connectionString: MIGRATE_URL });
    await c.connect();
    try {
      await c.query('begin');
      await c.query(usabilitySeedSql(RUN_NS));
      await c.query(usabilitySeedSql(RUN_NS));   // idempotent by construction
      await c.query('commit');
    } catch (e) { await c.query('rollback'); throw e; } finally { await c.end(); }
  };
  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  beforeAll(async () => {
    await seedRunTenant();
    await seedTwice();
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
  }, 60_000);

  afterAll(async () => { await db?.destroy(); });

  it('every line of the script\'s list holds', async () => {
    for (const c of usabilityChecks(RUN_NS)) {
      const r = await tx((t) => sql.raw<{ ok: boolean }>(c.sql).execute(t));
      expect(r.rows[0]?.ok, `${c.key}: ${c.en}`).toBe(true);
    }
  });

  it('the handed conversation is older than fifty others, and still on the first page of All and on Waiting (A9, then A)', async () => {
    // It is placed where a fifty-row window lost it (A9). Since A the list is
    // paged and ranked by who needs the owner, so it leads its group on the
    // FIRST page of All instead of falling off the end — and it is on Waiting.
    const { loadInboxList } = await import('../../src/api/web/inbox.js');
    const all = await loadInboxList(db, RUN_BIZ, 'all');
    expect(all.conversations).toHaveLength(50);
    expect(all.page?.total).toBeGreaterThan(50);
    expect(all.conversations.some((c) => c.conversationId === handedId)).toBe(true);

    const waiting = await loadInboxList(db, RUN_BIZ, 'pending');
    const handed = waiting.conversations.find((c) => c.conversationId === handedId);
    expect(handed, 'the handed conversation is on Waiting').toBeDefined();
    expect(handed!.heldBy).not.toBeNull();
    expect(handed!.awaitingReview).toBe(false);
    expect(waiting.conversations.some((c) => c.conversationId === draftId && c.awaitingReview)).toBe(true);
    expect(waiting.waitingCount).toBeGreaterThanOrEqual(2);
  });

  it('Results has this week\'s activity: replies, inquiries, a draft waiting', async () => {
    const { loadAnalytics } = await import('../../src/api/web/analytics.js');
    const a = await loadAnalytics(db, RUN_BIZ, 'week');
    expect(a.hasActivity).toBe(true);
    expect(a.activity.inbound).toBeGreaterThan(0);
    expect(a.activity.replied).toBeGreaterThan(0);
    expect(a.employee.waiting).toBeGreaterThanOrEqual(1);
  });

  /**
   * FOUND 2026-09-28 00:12 (Shanghai), a Monday: "Results has this week's
   * activity" failed — the freshest reply was seeded "40 minutes ago", which
   * was last week. Replayed here at that clock: the old expression falls
   * outside the week, the seed's expression inside it.
   */
  it('seeded just after midnight on a Monday in Shanghai, this week still has its replies', async () => {
    const at = `'2026-09-28 00:12:00+08'::timestamptz`;
    const fresh = USABILITY_CONVERSATIONS[0]!;
    const seeded = usabilitySeedSql(RUN_NS);
    const lines = seeded.split('\n').filter((l) => l.includes(`'usab-${fresh.id.slice(-4)}-`));
    expect(lines.length).toBe(fresh.messages.length);
    const weekStart = `(date_trunc('week', ${at} at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')`;
    for (const [k, line] of lines.entries()) {
      const expr = line.slice(line.lastIndexOf(", greatest(") + 2, line.lastIndexOf(')'));
      expect(expr.startsWith('greatest(now() - interval'), line).toBe(true);
      const r = (await tx((t) => sql.raw<{ seeded: boolean; old: boolean }>(`
        select (${expr.replaceAll('now()', at)}) >= ${weekStart} as seeded,
               (${at} - interval '${fresh.messages[k]!.ageMin} minutes') >= ${weekStart} as old`).execute(t))).rows[0]!;
      expect(r).toEqual({ seeded: true, old: false });
    }
  });

  it('a third run changes nothing', async () => {
    const count = () => tx(async (t) => (await sql<{ n: number }>`
      select (select count(*) from conversations where business_id = ${RUN_BIZ}::uuid)::int
           + (select count(*) from messages m join conversations c on c.id = m.conversation_id where c.business_id = ${RUN_BIZ}::uuid)::int
           + (select count(*) from drafts where business_id = ${RUN_BIZ}::uuid)::int
           + (select count(*) from orders where business_id = ${RUN_BIZ}::uuid)::int
           + (select count(*) from conversation_events where business_id = ${RUN_BIZ}::uuid)::int as n`.execute(t)).rows[0]!.n);
    const before = await count();
    await seedTwice();
    expect(await count()).toBe(before);
  });
});
