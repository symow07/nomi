import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * Phase 9 (V1-005) — the conversation page says the assistant's name only
 * once the owner chose it (rule 7). It read the row's default name straight,
 * so "Lily drafted", "How Lily read this" and "Lily is handling this" stood on
 * the page while Getting ready still asked the owner to choose a name.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `dd900000-0000-4000-8000-${RUN}0001`;
const CLIENT = `dd900000-0000-4000-8000-${RUN}0002`;
const CONV = `dd900000-0000-4000-8000-${RUN}0003`;

d('Phase 9 · the name on a conversation, only once chosen (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Name Test Shop') on conflict (id) do nothing`.execute(t);
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(t);
      await sql`insert into clients (id, business_id, display_name) values (${CLIENT}, ${BIZ}, 'Maya') on conflict (id) do nothing`.execute(t);
      await sql`insert into conversations (id, business_id, client_id, channel) values (${CONV}, ${BIZ}, ${CLIENT}, 'whatsapp') on conflict (id) do nothing`.execute(t);
    });
  });
  afterAll(async () => { await db?.destroy(); });

  it('a default name nobody chose is not said; once confirmed, it is', async () => {
    const { loadConversationDetail } = await import('../../src/api/web/inbox.js');
    const before = await loadConversationDetail(db, BIZ, CONV);
    expect(before?.assistantName ?? null).toBeNull();
    await tx((t) => sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
      on conflict (business_id) do update set assistant_named_at = now()`.execute(t));
    const after = await loadConversationDetail(db, BIZ, CONV);
    expect(after?.assistantName).toBe('Lily');
  });

  it('V1-163 · a conversation a colleague holds is theirs, not the owner\'s "Needs you"', async () => {
    const { readBuyerCounts } = await import('../../src/db/buyersList.js');
    const chen = (await tx((t) => sql<{ id: string }>`insert into people (business_id, name, is_owner) values (${BIZ}, 'Chen', false) returning id::text as id`.execute(t))).rows[0]!.id;
    const owner = (await tx((t) => sql<{ id: string }>`insert into people (business_id, name, is_owner) values (${BIZ}, 'Owner', true) returning id::text as id`.execute(t))).rows[0]!.id;
    await tx((t) => sql`update conversations set assigned_to = ${chen} where id = ${CONV}`.execute(t));
    expect((await tx((t) => readBuyerCounts(t, owner))).waiting).toBe(0);
    expect((await tx((t) => readBuyerCounts(t, chen))).waiting).toBe(1);
    expect((await tx((t) => readBuyerCounts(t))).waiting).toBe(1);     // no reader known: everyone's, as before
    // Taken over with nobody named (the 'owner' sentinel): the owner's, and nobody else's.
    await tx((t) => sql`update conversations set assigned_to = 'owner' where id = ${CONV}`.execute(t));
    const ownerSees = await tx((t) => readBuyerCounts(t, owner));
    expect([ownerSees.waiting, ownerSees.mine]).toEqual([1, 1]);
    const chenSees = await tx((t) => readBuyerCounts(t, chen));
    expect([chenSees.waiting, chenSees.mine]).toEqual([0, 0]);
    const codeSees = await tx((t) => readBuyerCounts(t, 'owner'));   // the access code with no person on record
    expect([codeSees.waiting, codeSees.mine]).toEqual([1, 1]);
    await tx((t) => sql`update conversations set assigned_to = null where id = ${CONV}`.execute(t));
  });

  // The warmth run (phase 2) — "The last 24 hours" left Today with V1-088's
  // count of who wrote; a customer who wrote and waits is the band's (the
  // Inbox's own "Needs you"). What this proves now is the hero and the three
  // figures, read from the rows themselves in the workspace's own day.
  it('the warmth run · Home\'s wins and figures count today\'s rows in the workspace\'s day — yesterday\'s only as the week\'s', async () => {
    const { loadToday } = await import('../../src/api/web/today.js');
    const PID = randomUUID();
    const zone = (await tx((t) => sql<{ z: string }>`select coalesce(timezone, 'UTC') as z from businesses where id = ${BIZ}`.execute(t))).rows[0]!.z;
    await tx(async (t) => {
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active)
                values (${PID}, ${BIZ}, ${'TT-' + RUN}, 'Canvas tote', 'pcs', null, true)`.execute(t);
      // A reply the assistant sent one minute before the workspace's midnight: yesterday's, not today's.
      await sql`insert into outbound_messages (business_id, conversation_id, seq, body, origin, status, sent_at)
                values (${BIZ}, ${CONV}, 901, 'Yesterday', 'employee', 'sent',
                        (date_trunc('day', now() at time zone ${zone}) at time zone ${zone}) - interval '1 minute')`.execute(t);
    });
    // THE HOME RUN — nothing of today's: the reply one minute before midnight is not today's (the scope
    // turns to the week, which it does only when today counts none), and it shows as the week's.
    const quiet = await loadToday(db, BIZ, undefined, new Date());
    expect(quiet.winsScope).toBe('week');
    expect(quiet.handled?.total).toBe(1);
    expect(quiet.tally).toEqual({ orders: 0, quotes: 0, afterHours: 1 });   // 23:59 is after hours

    await tx(async (t) => {
      // Today: a price worked out, the assistant's reply that carried it, and an order confirmed.
      await sql`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version)
                values (${BIZ}, ${CONV}, ${PID}, 10, '{}'::jsonb, 2.00, 20, 'test')`.execute(t);
      await sql`insert into outbound_messages (business_id, conversation_id, seq, body, origin, status, sent_at)
                values (${BIZ}, ${CONV}, 902, 'Ten totes are 20.', 'employee', 'sent', now())`.execute(t);
      // …and the line it wrote when it left (channels.ts writes it at 'sent'): a quote counts once a line LEFT
      // after it (PRICE_GIVEN, phase 9 of the warmth run — Today, Results and the calendar read the same rule).
      await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
                values (${CONV}, ${`out-${RUN}-902`}, 'outbound', 'text', 'Ten totes are 20.', now())`.execute(t);
      // A reply that never left counts for nothing.
      await sql`insert into outbound_messages (business_id, conversation_id, seq, body, origin, status, sent_at)
                values (${BIZ}, ${CONV}, 903, 'Refused', 'employee', 'canceled', null)`.execute(t);
      await sql`insert into orders (order_reference, business_id, client_id, conversation_id, product_id,
                                    quantity, unit, agreed_unit_price_usd, total_value_usd, currency, status, confirmed_at)
                values (${'TT-' + RUN}, ${BIZ}, ${CLIENT}, ${CONV}, ${PID}, 10, 'pcs', 2.00, 20, 'USD', 'confirmed', now())`.execute(t);
    });
    // "Today" is read at the reply's own instant, so a run that crosses midnight cannot move it into yesterday.
    const sent = (await tx((t) => sql<{ at: Date; h: number }>`
      select sent_at as at, extract(hour from sent_at at time zone ${zone})::int as h
        from outbound_messages where conversation_id = ${CONV} and seq = 902`.execute(t))).rows[0]!;
    const hour = sent.h;
    const after = await loadToday(db, BIZ, undefined, sent.at);
    expect(after.winsScope).toBe('today');
    expect(after.handled?.total).toBe(1);
    expect(after.handled?.people).toEqual([{ conversationId: CONV, clientId: CLIENT, name: 'Maya', photo: null, word: 'confirmed' }]);
    // After hours is 20:00–08:00 in the workspace's zone (today.ts, OPEN_HOUR / CLOSE_HOUR).
    expect(after.tally).toEqual({ orders: 1, quotes: 1, afterHours: hour < 8 || hour >= 20 ? 1 : 0 });
  });
});
