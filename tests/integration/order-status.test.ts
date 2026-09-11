import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { usd } from '../../src/core/types/money.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * G4 — "where is my order?", three weeks later, in a new conversation.
 *
 * M46 built the answer and the roadmap named the scenario — and the scenario
 * could never be reached. Confirming an order CLOSES the conversation it was
 * confirmed in, the buyer's next message opens a new one, and the lookup
 * searched only the conversation it was asked in. Worse, an order the turn
 * pipeline created was given no first entry in its history, and the lookup
 * reads the history, so even the same conversation got nothing. Every such
 * question fell through to the model.
 *
 * The existing after-order test inserted its order by hand, first entry
 * included, the way the 0034 backfill did — so it never saw either defect.
 * This one creates the order through `orders.create`, the call the turn makes.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd040000-0000-4000-8000-${RUN}0001`;
const PID = `dd040000-0000-4000-8000-${RUN}0002`;

d('G4 · where is my order, after the conversation closed (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let bid: import('../../src/core/types/ids.js').BusinessId;
  let clientId = '';
  let firstConv = '';
  let reference = '';
  let orderId = '';

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, bid, fn);
  };

  /** One real turn on real repos, with the model calls faked. */
  const ask = async (conversationId: string, text: string) => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { hybridRetriever } = await import('../../src/retrieval/hybrid.js');
    const { computeTurn } = await import('../../src/pipeline/turn.js');
    const analyzer = new FakeAnalyzer();
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification',
    };
    const writer = new FakeReplyWriter();
    writer.replies = ['[the model answered instead]'];
    return tx((t) => computeTurn({
      tenant: tenantRepos(t, bid), retriever: hybridRetriever(t, bid),
      analyzer, replyWriter: writer, now: () => new Date(),
    }, { conversationId: conversationId as never, messageId: `g4-${randomUUID()}`, text }));
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { tenantRepos } = await import('../../src/db/repos.js');
    db = createDb(DATABASE_URL!);
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    bid = b.value;

    await tx(async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Order Status Factory', 'service')
                on conflict (id) do nothing`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active)
                values (${PID}, ${BIZ}, ${'OS-' + RUN}, 'Canvas tote bag', 'pcs', 500, true)
                on conflict (id) do nothing`.execute(t);
      clientId = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+97150${RUN}`}, 'Khalid') returning id::text as id`.execute(t)).rows[0]!.id;

      const repos = tenantRepos(t, bid);
      firstConv = (await repos.conversations.create(clientId as never, 'whatsapp')).conversationId;
      // THE CALL THE TURN MAKES when a buyer confirms.
      const created = await repos.orders.create(firstConv as never, {
        productId: PID, quantity: { value: 2000, unit: 'pcs' },
        unitPrice: usd(0.92), total: usd(1840), email: 'khalid@example.com',
        paymentTerms: 'as agreed',
      } as never);
      orderId = created.orderId;
      reference = created.orderReference;
      // And what the turn does next: the conversation is closed.
      await repos.conversations.close(firstConv as never);
    });
  }, 60_000);

  afterAll(async () => { await db?.destroy(); });

  it('an order the pipeline creates has its first entry in its history', async () => {
    const rows = await tx((t) => sql<{ state: string }>`
      select state from order_updates where order_id = ${orderId}::uuid
    `.execute(t).then((r) => r.rows));
    expect(rows.map((r) => r.state)).toEqual(['confirmed']);
  });

  it('weeks later, in a NEW conversation, she answers from the order', async () => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const second = await tx((t) => tenantRepos(t, bid).conversations.create(clientId as never, 'whatsapp'));
    expect(second.conversationId).not.toBe(firstConv);

    const r = await ask(second.conversationId, 'Hello, where is my order?');
    expect(r.reply).toContain(`Order ${reference} is confirmed`);
    expect(r.reply).not.toContain('[the model answered instead]');
    expect(r.replyDeterministic).toBe(true);
  });

  it('and when she records it shipped, that is what he is told, with the tracking', async () => {
    const { writeOrderState } = await import('../../src/db/orders.js');
    await tx((t) => writeOrderState(t, bid, orderId, {
      state: 'shipped', note: 'left the yard', trackingReference: 'SF1234567890', actor: 'owner', at: new Date(),
    }));
    const { tenantRepos } = await import('../../src/db/repos.js');
    const third = await tx((t) => tenantRepos(t, bid).conversations.findActiveByClient(clientId as never));
    const r = await ask(third!.conversationId, 'any update on my order');
    expect(r.reply).toContain(`Order ${reference} is shipped`);
    expect(r.reply).toContain('SF1234567890');
    // Her note is hers, and is never sent.
    expect(r.reply).not.toContain('left the yard');
  });

  it('an order from before the history existed is reported as awaiting confirmation, not guessed at', async () => {
    const legacy = await tx(async (t) => {
      const c = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+97151${RUN}`}, 'Omar') returning id::text as id`.execute(t)).rows[0]!.id;
      const conv = (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel) values (${BIZ}, ${c}::uuid, 'whatsapp')
        returning id::text as id`.execute(t)).rows[0]!.id;
      await sql`insert into conversation_state (conversation_id) values (${conv}::uuid) on conflict do nothing`.execute(t);
      const o = (await sql<{ id: string; ref: string }>`
        insert into orders (order_reference, business_id, client_id, conversation_id, product_id,
                            quantity, unit, agreed_unit_price_usd, total_value_usd, currency, status)
        values (${'PI-LEG-' + RUN}, ${BIZ}, ${c}::uuid, ${conv}::uuid, ${PID}::uuid,
                500, 'pcs', 1, 500, 'USD', 'pending_confirmation')
        returning id::text as id, order_reference as ref`.execute(t)).rows[0]!;
      // What the 0034 backfill wrote for such a row: the old status, verbatim.
      await sql`insert into order_updates (business_id, order_id, state, at, by_actor)
                values (${BIZ}, ${o.id}::uuid, 'pending_confirmation', now(), 'migration')`.execute(t);
      return { conv, ref: o.ref };
    });
    const r = await ask(legacy.conv, 'where is my order?');
    expect(r.reply).toContain(`Order ${legacy.ref} is awaiting confirmation`);
  });
});
