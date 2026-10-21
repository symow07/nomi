import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * S3 (Phase 5, item 21) — the done-criterion (PHASE-5.md §4): "Assignment rotates fairly among available people
 * (property test: tests/rotation.property.test.ts). Absent people are skipped. The owner's override wins." Here, end to
 * end, in the production composition — buyers on the WhatsApp simulator, the real worker: a buyer who asks for a
 * person is handed off, and the hand-off goes to the next one in turn; someone away is skipped; the turn moves only
 * when it gives one; a conversation someone holds is never taken; the owner's hand-on wins and stays; a deletion
 * request stays the owner's; with the turn off, a hand-off waits for anyone, as it always has.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `53530000-0000-4000-8000-${RUN}0001`;
const ASK = 'Can I talk to someone?';
const DELETION = 'Please delete my data.';
type Tx = import('../../src/db/client.js').Tx;

const bidOf = async (raw: string) => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
};
const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 90_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};
const n = (i: number) => `9718${runDigits(RUN, 5)}${String(i).padStart(2, '0')}`;
let next = 0;

d('S3 · hand-offs in turn, end to end (requires DATABASE_URL)', { timeout: 180_000 }, () => {
  let prod: Awaited<ReturnType<typeof import('../../src/main.js')['buildProduction']>>;
  let sim: ReturnType<typeof import('../../src/channels/whatsapp/simulator.js')['whatsappSimulator']>;
  const people: Record<'amina' | 'chen' | 'dalia', string> = { amina: '', chen: '', dalia: '' };
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = ['Thanks.'];

  const q = async <T>(fn: (tx: Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, await bidOf(BIZ), fn);
  };
  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody, headers: { 'content-type': 'application/json', ...w.headers } });
  const send = async (text: string) => {
    const from = n(++next);
    expect((await post(sim.inboundText({ from, text }))).statusCode).toBe(200);
    return until(() => q((tx) => sql<{ id: string }>`select c.id::text as id from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
      where cc.channel_user_id = ${from} and c.is_active limit 1`.execute(tx).then((r) => r.rows[0]?.id)), `conversation of ${from}`);
  };
  const holder = (conv: string) => q((tx) => sql<{ a: string | null }>`select assigned_to as a from conversations where id = ${conv}::uuid`
    .execute(tx).then((r) => r.rows[0]?.a ?? null));
  /** The hand-off, and then where the turn put it (or that it was left waiting, after the worker had its go). */
  const givenTo = async (conv: string): Promise<string> => {
    await until(async () => ((await holder(conv)) !== null ? true : undefined), 'the hand-off');
    await until(async () => (await q((tx) => sql<{ n: number }>`select count(*)::int as n from conversation_events
      where conversation_id = ${conv}::uuid and type = 'handoff'`.execute(tx).then((r) => r.rows[0]!.n))) > 0 ? true : undefined, 'the hand-off recorded');
    // the worker gives it in turn BEFORE it queues the hand-off's alert: the alert's job is the sign it has had its go
    const { QUEUES } = await import('../../src/queue/boss.js');
    await until(async () => ((await sql<{ n: number }>`select count(*)::int as n from pgboss.job where name = ${QUEUES.notify}
      and data->>'conversationId' = ${conv}`.execute(prod.db)).rows[0]!.n > 0 ? true : undefined), 'the hand-off\'s alert');
    return (await holder(conv))!;
  };
  const turnOn = (on: boolean) => q((tx) => sql`update businesses set rotation_on = ${on} where id = ${BIZ}::uuid`.execute(tx));
  const name = (id: string) => (Object.entries(people).find(([, v]) => v === id)?.[0] ?? id);

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    sim = whatsappSimulator([], { tag: `rot${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, await bidOf(BIZ), async (t) => {
      await sql`insert into businesses (id, name, engine, rotation_on, batch_debounce_ms, batch_max_window_ms)
                values (${BIZ}, 'Turns', 'service', true, 300, 1000) on conflict (id) do nothing`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at)
                values (${BIZ}, 'whatsapp', 'connected', '+86 579****0078', now())`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      for (const [i, who] of (['amina', 'chen', 'dalia'] as const).entries()) {
        people[who] = (await sql<{ id: string }>`insert into people (business_id, name, code_hash, kind, in_rotation, created_at)
          values (${BIZ}, ${who}, ${`hash-${who}-${RUN}`}, 'team', true, now() - make_interval(mins => ${10 - i}))
          returning id::text as id`.execute(t)).rows[0]!.id;
      }
      // Dalia is away until tomorrow; an accountant is never in turn (0198 refuses it)
      await sql`update people set away_until = now() + interval '1 day' where id = ${people.dalia}::uuid`.execute(t);
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real', META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'rot-verify-token-xx', CREDENTIAL_KEY: 'b'.repeat(64), PORT: 0,
    }, { adapter: sim.adapter, logger: false, models: { analyzer, replyWriter } });
  }, 60_000);
  afterAll(async () => {
    // The hand-offs' alerts are this test's own: let the running worker finish them, so none is left queued for the
    // next file to wait on (boot.test drains notify.team before it measures).
    if (prod) {
      const { QUEUES } = await import('../../src/queue/boss.js');
      await until(async () => ((await sql<{ n: number }>`select count(*)::int as n from pgboss.job where name = ${QUEUES.notify}
        and data->>'businessId' = ${BIZ} and state in ('created', 'retry', 'active')`.execute(prod.db)).rows[0]!.n === 0 ? true : undefined), 'this test\'s alerts', 60_000);
    }
    await prod?.close();
  }, 90_000);

  it('IN TURN: each hand-off goes to the next who has waited longest; someone away is skipped', async () => {
    const order: string[] = [];
    for (let i = 0; i < 4; i++) order.push(name(await givenTo(await send(ASK))));
    expect(order).toEqual(['amina', 'chen', 'amina', 'chen']);
    const given = await q((tx) => sql<{ n: number }>`select count(*)::int as n from conversation_events e join conversations c on c.id = e.conversation_id
      where c.business_id = ${BIZ}::uuid and e.type = 'given_in_turn'`.execute(tx).then((r) => r.rows[0]!.n));
    expect(given).toBe(4);
  });

  it('BACK FROM AWAY: next once, then in the cycle', async () => {
    await q((tx) => sql`update people set away_until = null where id = ${people.dalia}::uuid`.execute(tx));
    const order: string[] = [];
    for (let i = 0; i < 3; i++) order.push(name(await givenTo(await send(ASK))));
    expect(order).toEqual(['dalia', 'amina', 'chen']);
  });

  it('THE OWNER WINS: a conversation handed on stays where it was handed; one held is never taken', async () => {
    const { handTo } = await import('../../src/conversations/takeover.js');
    const conv = await send(ASK);
    const first = await givenTo(conv);
    expect(first).toBe(people.dalia);
    // the owner hands it on to Chen: it is Chen's, and the turn does not take it back
    const r = await handTo({ db: prod.db, now: () => new Date() }, { businessId: await bidOf(BIZ), conversationId: conv, actor: 'owner', toPersonId: people.chen });
    expect(r.outcome).toBe('handed');
    const { giveToNextInTurn } = await import('../../src/db/rotation.js');
    expect(await q((tx) => giveToNextInTurn(tx, BIZ as never, conv, new Date()))).toEqual({ kind: 'not_given', why: 'held' });
    expect(await holder(conv)).toBe(people.chen);
    // the same buyer asks again while held: still Chen's
    await post(sim.inboundText({ from: n(next), text: 'Hello? Can I talk to someone?' }));
    await until(async () => ((await q((tx) => sql<{ n: number }>`select count(*)::int as n from messages where conversation_id = ${conv}::uuid
      and direction = 'inbound' and text_content = 'Hello? Can I talk to someone?'`.execute(tx).then((r) => r.rows[0]!.n))) > 0 ? true : undefined), 'the second message');
    expect(await holder(conv)).toBe(people.chen);
  });

  it('A DELETION REQUEST stays the owner\'s: never given to anyone, even in turn', async () => {
    const conv = await send(DELETION);
    expect(await givenTo(conv)).toBe('unclaimed');
    // and past the worker's own check: while that request waits, no later hand-off of theirs is given in turn either
    const { giveToNextInTurn } = await import('../../src/db/rotation.js');
    expect(await q((tx) => giveToNextInTurn(tx, BIZ as never, conv, new Date()))).toEqual({ kind: 'not_given', why: 'deletion' });
    expect(await holder(conv)).toBe('unclaimed');
  });

  it('TURN OFF: a hand-off waits for anyone, as it always has; and nobody in turn is the same', async () => {
    await turnOn(false);
    expect(await givenTo(await send(ASK))).toBe('unclaimed');
    await turnOn(true);
    await q((tx) => sql`update people set in_rotation = false where business_id = ${BIZ}::uuid`.execute(tx));
    expect(await givenTo(await send(ASK))).toBe('unclaimed');
    // the database never puts an accountant in turn
    await expect(q((tx) => sql`insert into people (business_id, name, code_hash, kind, in_rotation) values (${BIZ}, 'books', 'h', 'accountant', true)`.execute(tx)))
      .rejects.toThrow(/people_rotation_not_accountant/);
  });
});
