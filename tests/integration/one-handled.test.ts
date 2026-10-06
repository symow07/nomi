import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * THE ADVISOR BATCH (2026-10-06), on a real database: Home, Results and the assistant's month say the same
 * "handled" (Home's meaning: conversations in which a reply the assistant wrote went out), and the owner's
 * own test conversation and a practice copy count for nothing on any of them.
 *
 *   R   a real customer: two replies of the assistant's went out today → handled 1;
 *   Q   a real customer: two drafts approved today whose sends failed → handled 0 (Results counted 2);
 *   T   the owner testing their shop: a reply out, a price given, an order confirmed, a message in, a
 *       draft waiting → nothing, anywhere;
 *   P   the workspace's practice copy (`practice_of`): a reply out → nothing in the live workspace.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const id = (n: number) => `dda20000-0000-4000-8000-${RUN}${String(n).padStart(4, '0')}`;
const BIZ = id(1); const COPY = id(2); const PID = id(3);
const [R, Q, T, P] = [id(10), id(11), id(12), id(13)];
const [CR, CQ, CT, CP] = [id(20), id(21), id(22), id(23)];

d('the advisor batch · one "handled", and nothing that is not business (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  const tx = async <T>(biz: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    await tx(BIZ, async (t) => {
      await sql`insert into businesses (id, name, timezone) values (${BIZ}, 'One Handled Co', 'UTC')`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, is_active) values (${PID}, ${BIZ}, ${'OH-' + RUN}, 'Tote', 'pcs', true)`.execute(t);
      for (const [c, cl, name, testing] of [[R, CR, 'Rana', false], [Q, CQ, 'Quinn', false], [T, CT, 'Me testing', true]] as const) {
        await sql`insert into clients (id, business_id, display_name) values (${cl}, ${BIZ}, ${name})`.execute(t);
        await sql`insert into conversations (id, business_id, client_id, channel, owner_testing) values (${c}, ${BIZ}, ${cl}, 'whatsapp', ${testing})`.execute(t);
        await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
                  values (${c}, ${`in-${RUN}-${c}`}, 'inbound', 'text', 'Hello', now() - interval '1 minute')`.execute(t);
      }
      // R: two replies of the assistant's went out
      for (const seq of [1, 2]) {
        await sql`insert into outbound_messages (business_id, conversation_id, seq, body, origin, status, sent_at)
                  values (${BIZ}, ${R}, ${seq}, 'A reply', 'employee', 'sent', now())`.execute(t);
      }
      // Q: two drafts approved, and the sends failed
      for (const seq of [1, 2]) {
        await sql`insert into drafts (business_id, conversation_id, capability, draft_text, status, decided_at)
                  values (${BIZ}, ${Q}, 'quote', 'Approved', 'approved', now())`.execute(t);
        await sql`insert into outbound_messages (business_id, conversation_id, seq, body, origin, status, sent_at)
                  values (${BIZ}, ${Q}, ${seq}, 'Approved', 'employee', 'failed', null)`.execute(t);
      }
      // T: everything, as the owner testing their own shop
      await sql`insert into outbound_messages (business_id, conversation_id, seq, body, origin, status, sent_at)
                values (${BIZ}, ${T}, 1, 'Ten totes are 20.', 'employee', 'sent', now())`.execute(t);
      await sql`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version)
                values (${BIZ}, ${T}, ${PID}, 10, '{}'::jsonb, 2.00, 20, 'test')`.execute(t);
      await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
                values (${T}, ${`out-${RUN}`}, 'outbound', 'text', 'Ten totes are 20.', now() + interval '1 second')`.execute(t);
      await sql`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit,
                                    agreed_unit_price_usd, total_value_usd, currency, status, confirmed_at)
                values (${'OH-' + RUN}, ${BIZ}, ${CT}, ${T}, ${PID}, 10, 'pcs', 2.00, 20, 'USD', 'confirmed', now())`.execute(t);
      await sql`insert into drafts (business_id, conversation_id, capability, draft_text, status)
                values (${BIZ}, ${T}, 'quote', 'Waiting', 'pending')`.execute(t);
    });
    // P: the practice copy, a business row of its own
    await tx(COPY, async (t) => {
      await sql`insert into businesses (id, name, timezone, practice_of) values (${COPY}, 'One Handled Co (practice)', 'UTC', ${BIZ})`.execute(t);
      await sql`insert into clients (id, business_id, display_name) values (${CP}, ${COPY}, 'Practice customer')`.execute(t);
      await sql`insert into conversations (id, business_id, client_id, channel) values (${P}, ${COPY}, ${CP}, 'whatsapp')`.execute(t);
      await sql`insert into outbound_messages (business_id, conversation_id, seq, body, origin, status, sent_at)
                values (${COPY}, ${P}, 1, 'Practice reply', 'employee', 'sent', now())`.execute(t);
    });
  });
  afterAll(async () => { await db?.destroy(); });

  it('Home, Results and the assistant\'s month say the same "handled": one conversation, R', async () => {
    const { loadToday } = await import('../../src/api/web/today.js');
    const { loadAnalytics } = await import('../../src/api/web/analytics.js');
    const { loadOperationsSnapshot } = await import('../../src/api/web/operations.js');
    const home = await loadToday(db, BIZ, undefined, new Date());
    const results = await loadAnalytics(db, BIZ, 'today');
    const month = await loadOperationsSnapshot(db, BIZ, 'today', 'disabled');
    expect(home.handled?.total).toBe(1);
    expect(home.handled?.people.map((p) => p.name)).toEqual(['Rana']);
    expect(results.employee.handled).toBe(1);
    expect(month.activity.handled).toBe(1);
  });

  it('the owner\'s own test counts for nothing: no price, no order, no message, no waiting draft — on Home or Results', async () => {
    const { loadToday } = await import('../../src/api/web/today.js');
    const { loadAnalytics } = await import('../../src/api/web/analytics.js');
    const home = await loadToday(db, BIZ, undefined, new Date());
    expect(home.tally).toEqual({ orders: 0, quotes: 0, afterHours: expect.any(Number) });
    const results = await loadAnalytics(db, BIZ, 'today');
    expect(results.commerce.quotes).toBe(0);
    expect(results.commerce.orders).toBe(0);
    expect(results.commerce.totals).toEqual([]);
    expect(results.activity.inbound).toBe(2);              // R's and Q's, not T's
    expect(results.activity.waiting).toBe(0);              // T's waiting draft is not business
    expect(results.summary.activeConvos).toBe(2);
    // the control: the same rows, the flag lifted, and they count
    await tx(BIZ, (t) => sql`update conversations set owner_testing = false where id = ${T}`.execute(t));
    const counted = await loadAnalytics(db, BIZ, 'today');
    expect([counted.commerce.quotes, counted.commerce.orders, counted.employee.handled, counted.activity.waiting]).toEqual([1, 1, 2, 1]);
    await tx(BIZ, (t) => sql`update conversations set owner_testing = true where id = ${T}`.execute(t));
  });

  it('the practice copy\'s reply counts in its own row, never the live workspace\'s', async () => {
    const { loadAnalytics } = await import('../../src/api/web/analytics.js');
    expect((await loadAnalytics(db, COPY, 'today')).employee.handled).toBe(1);
    expect((await loadAnalytics(db, BIZ, 'today')).employee.handled).toBe(1);
  });
});
