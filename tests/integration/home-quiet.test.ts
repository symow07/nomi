import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * THE QUIET-DAY RUN (2026-10-05) — Home's two ladders on a real database, rung by rung. Production said
 * "Today nomi-socials has not handled a conversation yet": the live workspace's last reply was fifteen
 * days old, past the seven-day fallback, and the wins' ladder stopped there.
 *
 *   wins      today's → the last seven days' → everything since the last day one was handled (its date)
 *             → never one: nothing on any rung;
 *   schedule  the calendar's two weeks → the next dates further on, up to three months → none.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `dda00000-0000-4000-8000-${RUN}0001`;
const CLIENT = `dda00000-0000-4000-8000-${RUN}0002`;
const CONV = `dda00000-0000-4000-8000-${RUN}0003`;
const ZONE = 'Asia/Dubai';

d('the quiet-day run · Home\'s ladders on a real database (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const home = async () => (await import('../../src/api/web/today.js')).loadToday(db, BIZ, undefined, new Date());
  /** A reply of the assistant's that went out `ago` before now (a Postgres interval). */
  const replied = (seq: number, ago: string) => tx((t) => sql`
    insert into outbound_messages (business_id, conversation_id, seq, body, origin, status, sent_at)
    values (${BIZ}, ${CONV}, ${seq}, 'A reply', 'employee', 'sent', now() - ${ago}::interval)`.execute(t));
  const dated = (title: string, ahead: string) => tx((t) => sql`
    insert into calendar_entries (business_id, title, starts_at) values (${BIZ}, ${title}, now() + ${ahead}::interval)`.execute(t));

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    await tx(async (t) => {
      await sql`insert into businesses (id, name, timezone) values (${BIZ}, 'Quiet Day Shop', ${ZONE}) on conflict (id) do nothing`.execute(t);
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(t);
      await sql`insert into clients (id, business_id, display_name) values (${CLIENT}, ${BIZ}, 'Maya') on conflict (id) do nothing`.execute(t);
      await sql`insert into conversations (id, business_id, client_id, channel) values (${CONV}, ${BIZ}, ${CLIENT}, 'whatsapp') on conflict (id) do nothing`.execute(t);
    });
  });
  afterAll(async () => { await db?.destroy(); });

  it('never one, nothing dated: no rung has anything — today\'s scope, nothing handled, no date to say', async () => {
    const h = await home();
    expect(h.winsScope).toBe('today');
    expect(h.handled?.total).toBe(0);
    expect(h.winsSince).toBeUndefined();
    expect(h.schedule?.entries).toEqual([]);
  });

  it('the last reply fifteen days ago (production\'s case): everything since that day, with its date — the figures from the same day', async () => {
    await replied(1, '15 days');
    const h = await home();
    expect(h.winsScope).toBe('since');
    expect(h.handled?.total).toBe(1);
    expect(h.handled?.people.map((p) => p.name)).toEqual(['Maya']);
    const day = (await tx((t) => sql<{ d: Date }>`
      select (date_trunc('day', (now() - interval '15 days') at time zone ${ZONE}) at time zone ${ZONE}) as d`.execute(t))).rows[0]!.d;
    expect(h.winsSince?.getTime()).toBe(day.getTime());
    expect(h.tally).toEqual({ orders: 0, quotes: 0, afterHours: expect.any(Number) });
  });

  it('a reply three days ago: the week\'s, and no date', async () => {
    await replied(2, '3 days');
    const h = await home();
    expect(h.winsScope).toBe('week');
    expect(h.handled?.total).toBe(1);
    expect(h.winsSince).toBeUndefined();
  });

  it('a reply today: today\'s', async () => {
    await replied(3, '0 seconds');
    const h = await home();
    expect(h.winsScope).toBe('today');
    expect(h.handled?.total).toBe(1);
  });

  it('nothing in the calendar\'s two weeks: the next date further on is still the schedule\'s — and never one past three months', async () => {
    await dated('Past three months', '120 days');
    expect((await home()).schedule?.entries).toEqual([]);
    await dated('Trade fair', '40 days');
    const far = (await home()).schedule!;
    expect(far.entries.map((e) => e.source.table)).toEqual(['calendar_entries']);
    expect(far.entries[0]!.day > far.today).toBe(true);   // so it is "Coming up"
    // something within the two weeks: those come first, as the calendar's own page shows them
    await dated('Sample visit', '5 days');
    const near = (await home()).schedule!;
    expect(near.entries).toHaveLength(1);
    expect(near.entries[0]!.detail).toMatchObject({ title: 'Sample visit' });
  });
});
