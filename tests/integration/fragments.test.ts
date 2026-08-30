import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * M51.1 — the fragment store, against Postgres.
 *
 * The parity suite proves the decision and that a production job reaches it.
 * Only the database can prove that the same message arriving twice is one
 * fragment, that answered fragments stop being pending, that a rolled-back
 * turn leaves them pending, and that her own batching knobs are what the
 * worker reads.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd510000-0000-4000-8000-${RUN}0001`;

d('M51.1 · inbound fragments (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let convId = '';

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const bid = async () => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const r = parseBusinessId(BIZ); if (!r.ok) throw new Error('fixture');
    return r.value;
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    convId = await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Fragment Test Factory')
                on conflict (id) do nothing`.execute(t);
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+8613${RUN}`}, 'Ahmed') returning id::text as id`.execute(t)).rows[0]!.id;
      return (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${BIZ}, ${client}::uuid, 'whatsapp', 'warm_intake') returning id::text as id
      `.execute(t)).rows[0]!.id;
    });
  }, 60_000);

  afterAll(async () => { await db?.destroy(); });

  const store = () => import('../../src/db/fragments.js');

  it('THE P1 SCENARIO: four fragments in ten seconds become ONE turn', async () => {
    const { recordFragment, pendingFragments, batchConfigFor } = await store();
    const { decideBatch } = await import('../../src/core/conversation/batching.js');
    const b = await bid();
    const t0 = new Date('2026-08-18T09:00:00Z');

    await tx(async (t) => {
      for (const [i, text] of ['hello', 'price?', 'the bags', '5000pcs'].entries()) {
        await recordFragment(t, b, convId, {
          id: `${RUN}-frag-${i}`, text, receivedAt: new Date(t0.getTime() + i * 2_000),
        });
      }
    });

    const { pending, config } = await tx(async (t) => ({
      pending: await pendingFragments(t, convId),
      config: await batchConfigFor(t, b),
    }));
    expect(pending).toHaveLength(4);

    // Two seconds after the last one he is still typing.
    const early = decideBatch(pending, new Date(t0.getTime() + 8_000), config);
    expect(early.action).toBe('wait');

    // Six seconds later he has stopped, and the four lines are ONE thought.
    const done = decideBatch(pending, new Date(t0.getTime() + 12_000), config);
    expect(done.action).toBe('process');
    if (done.action !== 'process') return;
    expect(done.mergedText).toBe('hello\nprice?\nthe bags\n5000pcs');
    expect(done.fragmentIds).toHaveLength(4);
    expect(done.stats.fragments).toBe(4);
  });

  it('the same message twice is ONE fragment — the buyer’s id is the key', async () => {
    const { recordFragment, pendingFragments } = await store();
    const b = await bid();
    await tx((t) => recordFragment(t, b, convId, {
      id: `${RUN}-frag-0`, text: 'hello AGAIN', receivedAt: new Date(),
    }));
    const pending = await tx((t) => pendingFragments(t, convId));
    expect(pending).toHaveLength(4);
    // And the FIRST arrival is what was kept: a redelivery must not rewrite
    // what he said or move him to the back of his own queue.
    expect(pending[0]!.text).toBe('hello');
  });

  it('ANSWERED FRAGMENTS STOP BEING PENDING', async () => {
    const { pendingFragments, markFragmentsProcessed } = await store();
    const ids = (await tx((t) => pendingFragments(t, convId))).map((f) => f.id);

    // `processed_in` references turns(message_id), so a turn must exist — the
    // same order the worker writes them in.
    await tx((t) => sql`
      insert into turns (message_id, business_id, conversation_id, state_before, input,
                         decision, engine, engine_version, latency_ms)
      values (${ids[ids.length - 1]}, ${BIZ}, ${convId}::uuid, '{}'::jsonb, '{}'::jsonb,
              '{}'::jsonb, 'service', 'fragment-test', 1)
      on conflict (message_id) do nothing`.execute(t));
    await tx((t) => markFragmentsProcessed(t, ids, ids[ids.length - 1]!));

    expect(await tx((t) => pendingFragments(t, convId))).toEqual([]);
    // Archived, not erased: what he said survives being answered.
    const kept = await tx((t) => sql<{ n: number }>`
      select count(*)::int as n from message_fragments where conversation_id = ${convId}::uuid
    `.execute(t).then((r) => r.rows[0]!.n));
    expect(kept).toBe(4);
  });

  it('A ROLLED-BACK TURN LEAVES THEM PENDING — the reason they are rows', async () => {
    const { recordFragment, pendingFragments, markFragmentsProcessed } = await store();
    const b = await bid();
    await tx((t) => recordFragment(t, b, convId, {
      id: `${RUN}-frag-rollback`, text: 'and one more thing', receivedAt: new Date(),
    }));

    // Marked against the turn the previous test committed, so the FK holds and
    // the only thing that fails is the deliberate throw.
    await expect(tx(async (t) => {
      await markFragmentsProcessed(t, [`${RUN}-frag-rollback`], `${RUN}-frag-3`);
      throw new Error('the turn failed after marking');
    })).rejects.toThrow('the turn failed after marking');

    const pending = await tx((t) => pendingFragments(t, convId));
    expect(pending.map((f) => f.id)).toEqual([`${RUN}-frag-rollback`]);
  });

  it('the config is HER row, and widening it widens the window', async () => {
    const { batchConfigFor } = await store();
    const b = await bid();
    expect(await tx((t) => batchConfigFor(t, b)))
      .toEqual({ debounceMs: 6000, maxWindowMs: 20000, maxFragments: 8 });

    // A Gulf market types slower. She widens it without a deploy.
    await tx((t) => sql`update businesses set batch_debounce_ms = 9000 where id = ${BIZ}`.execute(t));
    expect((await tx((t) => batchConfigFor(t, b))).debounceMs).toBe(9000);
    await tx((t) => sql`update businesses set batch_debounce_ms = 6000 where id = ${BIZ}`.execute(t));
  });

  it('a business with no row falls back to the defaults, never to no batching', async () => {
    const { batchConfigFor } = await store();
    const { DEFAULT_BATCH_CONFIG } = await import('../../src/core/conversation/batching.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const absent = parseBusinessId(`dd510000-0000-4000-8000-${RUN}9999`);
    if (!absent.ok) throw new Error('fixture');
    const { withTenantTx } = await import('../../src/db/client.js');
    expect(await withTenantTx(db, absent.value, (t) => batchConfigFor(t, absent.value)))
      .toEqual(DEFAULT_BATCH_CONFIG);
  });
});
