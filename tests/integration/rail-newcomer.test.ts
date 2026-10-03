import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * THE WARMTH RUN'S RE-AUDIT (w4-whole-03, w4-whole-04) — the rail's marker and
 * toast are about a customer who NEWLY waits, and name that customer.
 *
 * The audit found, against the local instance: a second customer handed over,
 * the count went 1 → 2, and the toast named the one who was already waiting;
 * and the owner answering from the phone (the conversation becoming theirs)
 * raised the count and toasted "is waiting for you" about a customer just
 * answered. Over Postgres, through `railAnswer` itself:
 *
 *   - a hand-over a turn makes (the state save) is stamped, as `assign()` is;
 *   - the newcomer is the one who began to wait after the page's moment —
 *     never a waiting customer who merely wrote again;
 *   - a conversation the reader takes is no news, though it counts;
 *   - one customer dealt with and another arriving (the count unchanged) is
 *     still news, about the one who arrived.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `9a110000-0000-4000-8000-${RUN}0001`;

d('the rail: a customer newly waiting, by when they began to wait (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  const as = async <R>(fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const bid = async () => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return b.value;
  };
  const customer = (name: string) => as(async (x) => {
    const client = (await sql<{ id: string }>`insert into clients (business_id, display_name) values (${BIZ}, ${name}) returning id::text as id`.execute(x)).rows[0]!.id;
    const conv = (await sql<{ id: string }>`
      insert into conversations (business_id, client_id, channel, phase, is_active) values (${BIZ}, ${client}::uuid, 'whatsapp', 'warm_intake', true)
      returning id::text as id`.execute(x)).rows[0]!.id;
    await sql`insert into conversation_state (conversation_id) values (${conv}::uuid)`.execute(x);
    return conv;
  });
  /** A hand-over as a turn makes it: the state saved with a waiting holder. */
  const handedOverByATurn = (conv: string) => as(async (x) => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { WAITING_HUMAN_AGENT } = await import('../../src/core/conversation/ownership.js');
    const repos = tenantRepos(x, await bid());
    const state = await repos.conversations.loadState(conv as never);
    if (!state) throw new Error('fixture');
    await repos.conversations.saveState({ ...state, assignedTo: WAITING_HUMAN_AGENT as never });
  });
  const mark = async (): Promise<string> => {
    const { railAnswer, railSaid } = await import('../../src/api/web/live.js');
    return railSaid('en', await railAnswer(db, await bid(), 'owner', '0')).mark;
  };
  const ask = async (since: string) => {
    const { railAnswer } = await import('../../src/api/web/live.js');
    return railAnswer(db, await bid(), 'owner', since);
  };
  /** A second passes: the moments compared are whole seconds. */
  const tick = () => new Promise((r) => setTimeout(r, 1100));

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    await as((x) => sql`insert into businesses (id, name, owner_locale) values (${BIZ}, ${`Rail ${RUN}`}, 'en') on conflict (id) do nothing`.execute(x));
  }, 60_000);
  afterAll(async () => { await db?.destroy(); });

  it('A CALM PAGE (nobody waiting when it was drawn) is told of the first customer to wait', async () => {
    const { railMomentOf, RAIL_FROM_THE_START } = await import('../../src/api/web/live.js');
    // What the page draws when nobody waits: the count 0 and the start, never 0 (an old page's mark, told nothing).
    expect(railMomentOf(null)).toBe(RAIL_FROM_THE_START);
    const since = `0.${railMomentOf(null)}`;
    expect((await ask(since)).newest).toBeNull();
    await tick();
    const first = await customer('First To Wait');
    await handedOverByATurn(first);
    const a = await ask(since);
    expect(a.n).toBe(1);
    expect(a.newest?.conversationId).toBe(first);
    expect(a.newest?.who).toBe('First To Wait');
  });

  it('a hand-over a turn makes is stamped with when it began; an unchanged holder keeps the stamp', async () => {
    const conv = await customer('Stamped Customer');
    await handedOverByATurn(conv);
    const at = await as((x) => sql<{ at: Date | null }>`select assigned_at as at from conversations where id = ${conv}::uuid`.execute(x));
    expect(at.rows[0]!.at).not.toBeNull();
    await tick();
    await handedOverByATurn(conv);
    const again = await as((x) => sql<{ at: Date | null }>`select assigned_at as at from conversations where id = ${conv}::uuid`.execute(x));
    expect(again.rows[0]!.at!.getTime()).toBe(at.rows[0]!.at!.getTime());
    // handed back: no holder, no stamp
    await as(async (x) => {
      const { tenantRepos } = await import('../../src/db/repos.js');
      const repos = tenantRepos(x, await bid());
      const state = await repos.conversations.loadState(conv as never);
      await repos.conversations.saveState({ ...state!, assignedTo: null });
    });
    const back = await as((x) => sql<{ at: Date | null }>`select assigned_at as at from conversations where id = ${conv}::uuid`.execute(x));
    expect(back.rows[0]!.at).toBeNull();
  });

  it('THE AUDIT\'S CASE: Aisha waits; Ben is handed over — the toast names Ben, not Aisha, even if Aisha writes again', async () => {
    const aisha = await customer('Aisha Waiting');
    await handedOverByATurn(aisha);
    await tick();
    const since = await mark();
    await tick();
    const ben = await customer('Ben Newcomer');
    await handedOverByATurn(ben);
    // Aisha writes again in the same window: a message is not a newcomer.
    await as((x) => sql`insert into messages (conversation_id, direction, text_content, sent_at) values (${aisha}::uuid, 'inbound', 'hello?', now())`.execute(x));
    const a = await ask(since);
    expect(a.newest?.conversationId).toBe(ben);
    expect(a.newest?.who).toBe('Ben Newcomer');
    // asked again from the new mark: nobody new
    const { railSaid } = await import('../../src/api/web/live.js');
    expect((await ask(railSaid('en', a).mark)).newest).toBeNull();
  });

  it('a conversation the owner takes (answering from the phone) counts, and is no news', async () => {
    const since = await mark();
    await tick();
    const taken = await customer('Answered From Phone');
    await as((x) => sql`update conversations set assigned_to = 'owner', assigned_at = now() where id = ${taken}::uuid`.execute(x));
    const a = await ask(since);
    expect(a.n).toBeGreaterThan(Number(since.split('.')[0]));
    expect(a.newest).toBeNull();
  });

  it('one dealt with and another arriving leave the count unchanged — and the newcomer is still news', async () => {
    const leaving = await customer('Dealt With');
    await handedOverByATurn(leaving);
    await tick();
    const since = await mark();
    await tick();
    await as((x) => sql`update conversations set assigned_to = null, assigned_at = null where id = ${leaving}::uuid`.execute(x));
    const arriving = await customer('Just Arrived');
    await handedOverByATurn(arriving);
    const a = await ask(since);
    expect(a.n).toBe(Number(since.split('.')[0]));
    expect(a.newest?.conversationId).toBe(arriving);
  });

  it('an old page\'s mark (the count alone) is told nothing rather than told wrongly', async () => {
    const c = await customer('Old Page');
    await handedOverByATurn(c);
    expect((await ask('0')).newest).toBeNull();
  });
});
