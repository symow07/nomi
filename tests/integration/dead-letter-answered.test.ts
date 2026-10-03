import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * A DEAD TURN IS NOT A BUYER NOBODY ANSWERED, WHEN SOMEBODY DID (2026-10-03).
 *
 * An inbound job retries for minutes before it is moved to the dead letter
 * queue. In those minutes the owner may take the conversation, answer, and
 * hand it back — or a later turn may take the same line and answer it. The
 * dead letter then handed the conversation over as `not_answered` all the
 * same (`handOverUnanswered`, 0077): the owner had the same conversation as
 * pending work a second time, under "a message that could not be answered",
 * and could send a second reply to a customer who already had one.
 *
 * Each case below is a dead letter for message M, through the function the
 * worker's dead-letter loop calls, in the same kind of transaction.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd950000-0000-4000-8000-${RUN}0001`;
const CLIENT = `dd950000-0000-4000-8001-${RUN}0001`;

d('a dead turn whose message was answered is not handed over (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  const jobs: string[] = [];

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  /** A conversation the assistant holds, with its state row, as every live one has. */
  const opened = async (t: import('../../src/db/client.js').Tx, conv: string) => {
    await sql`insert into conversations (id, business_id, client_id, channel) values (${conv}, ${BIZ}, ${CLIENT}, 'whatsapp')`.execute(t);
    await sql`insert into conversation_state (conversation_id) values (${conv})`.execute(t);
  };
  /** A conversation with the assistant, and the customer's message M, as the worker records a typed one. */
  const conversationWith = async (said: string): Promise<{ conv: string; mid: string }> => {
    const conv = randomUUID();
    const mid = `wamid.${RUN}.${conv.slice(0, 8)}`;
    await tx(async (t) => {
      await opened(t, conv);
      const { recordTypedMessage } = await import('../../src/pipeline/received.js');
      await sql`insert into message_fragments (id, business_id, conversation_id, text) values (${mid}, ${BIZ}, ${conv}, ${said})`.execute(t);
      await recordTypedMessage(t, conv, mid, said);
    });
    return { conv, mid };
  };
  /** A reply in the conversation, as the outbound worker keeps one. */
  const reply = (conv: string, origin: 'owner' | 'employee' | 'outreach', status: string, body = 'Yes, we have it in blue.') =>
    tx((t) => sql`insert into outbound_messages (business_id, conversation_id, seq, body, status, origin)
      values (${BIZ}, ${conv}, coalesce((select max(seq) from outbound_messages where conversation_id = ${conv}::uuid), 0) + 1,
              ${body}, ${status}, ${origin})`.execute(t));
  /** The dead letter arrives: exactly what the worker's `${QUEUES.inbound}.dead` handler does. */
  const deadLetter = async (conv: string, mid: string, over: Record<string, unknown> = {}) => {
    const { handOverUnanswered, unansweredIn } = await import('../../src/pipeline/received.js');
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    const u = unansweredIn({ businessId: BIZ, conversationId: conv, messageId: mid, text: 'Do you have it in blue?', ...over });
    if (!u) throw new Error('fixture');
    return tx((t) => handOverUnanswered(t, tenantRepos(t, bid.value), u));
  };
  const state = (conv: string) => tx((t) => sql<{ assigned: string | null; signals: string[]; events: string[] }>`
    select c.assigned_to as assigned,
           coalesce((select array_agg(s.kind order by s.kind) from conversation_signals s
                      where s.conversation_id = c.id and s.resolved_at is null), '{}') as signals,
           coalesce((select array_agg(e.type order by e.id) from conversation_events e
                      where e.conversation_id = c.id), '{}') as events
      from conversations c where c.id = ${conv}::uuid`.execute(t).then((r) => r.rows[0]!));
  const notHandedOver = async (conv: string, effects: unknown) => {
    expect(effects).toBeNull();
    const s = await state(conv);
    expect(s.assigned).toBeNull();
    expect(s.signals).not.toContain('not_answered');
    expect(s.events).not.toContain('handoff');
    expect(s.events).toContain('dead_letter_answered');
  };
  const handedOver = async (conv: string, effects: unknown) => {
    expect(effects).toMatchObject({ handoffAlert: true });
    const s = await state(conv);
    expect(s.assigned).toBe('unclaimed');
    expect(s.signals).toContain('not_answered');
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, ${`Dead Letter Test ${RUN}`}) on conflict (id) do nothing`.execute(t);
      await sql`insert into clients (id, business_id, display_name) values (${CLIENT}, ${BIZ}, 'Maya') on conflict (id) do nothing`.execute(t);
    });
  }, 60_000);
  afterAll(async () => {
    if (jobs.length) await admin?.query(`delete from pgboss.job where id = any($1::uuid[])`, [jobs]);
    await admin?.end();
    await db?.destroy();
  });

  it('THE DOUBLE HAND: the owner took it over, answered and handed it back while the turn retried — no second hand-over', async () => {
    const { conv, mid } = await conversationWith('Do you have it in blue?');
    await tx((t) => sql`update conversations set assigned_to = 'owner' where id = ${conv}::uuid`.execute(t));
    await reply(conv, 'owner', 'sent');
    await tx((t) => sql`update conversations set assigned_to = null where id = ${conv}::uuid`.execute(t));
    await notHandedOver(conv, await deadLetter(conv, mid));
  });

  it('a reply the assistant already queued is an answer on its way', async () => {
    const { conv, mid } = await conversationWith('And the lead time?');
    await reply(conv, 'employee', 'queued');
    await notHandedOver(conv, await deadLetter(conv, mid));
  });

  it('the owner answered from the phone (an echo on the timeline)', async () => {
    const { conv, mid } = await conversationWith('Price for 500?');
    await tx((t) => sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
      values (${conv}, ${`echo:${conv}`}, 'outbound', 'text', '1.05 each', clock_timestamp())`.execute(t));
    await notHandedOver(conv, await deadLetter(conv, mid));
  });

  it('its own turn finished (the job died after its turn was written)', async () => {
    const { conv, mid } = await conversationWith('Can you ship to Lagos?');
    await tx((t) => sql`insert into turns (message_id, business_id, conversation_id, state_before, input, decision, engine_version)
      values (${mid}, ${BIZ}, ${conv}, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'test')`.execute(t));
    await notHandedOver(conv, await deadLetter(conv, mid));
  });

  it('a later turn took the same line in its batch', async () => {
    const { conv, mid } = await conversationWith('5000 pcs');
    const later = `${mid}.later`;
    await tx(async (t) => {
      await sql`insert into turns (message_id, business_id, conversation_id, state_before, input, decision, engine_version)
        values (${later}, ${BIZ}, ${conv}, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'test')`.execute(t);
      await sql`update message_fragments set processed_in = ${later} where id = ${mid}`.execute(t);
    });
    await notHandedOver(conv, await deadLetter(conv, mid));
  });

  it('a photo whose turn rolled back: its time is when the job was queued, and the owner answered after it', async () => {
    const conv = randomUUID();
    const mid = `wamid.${RUN}.photo`;
    await tx((t) => opened(t, conv));
    const job = await admin.query<{ id: string }>(
      `insert into pgboss.job (name, data, state, created_on) values ('message.inbound', $1::jsonb, 'failed', now() - interval '6 minutes') returning id`,
      [JSON.stringify({ businessId: BIZ, conversationId: conv, messageId: mid, text: '', messageType: 'image', mediaId: 'm1' })]);
    jobs.push(job.rows[0]!.id);
    await reply(conv, 'owner', 'sent', 'I see the photo — yes, we make that.');
    await notHandedOver(conv, await deadLetter(conv, mid, { messageType: 'image', text: '', mediaId: 'm1' }));
    // The photo is still on the timeline, named and not opened.
    const said = await tx((t) => sql<{ n: number }>`select count(*)::int as n from messages where conversation_id = ${conv}::uuid and external_id = ${mid}`.execute(t));
    expect(said.rows[0]!.n).toBe(1);
  });

  it('nobody answered: handed over as not_answered, as before', async () => {
    const { conv, mid } = await conversationWith('Hello?');
    await handedOver(conv, await deadLetter(conv, mid));
  });

  it('a reply that failed or was cancelled reached nobody: handed over', async () => {
    const { conv, mid } = await conversationWith('Is anyone there?');
    await reply(conv, 'employee', 'failed');
    await reply(conv, 'owner', 'canceled');
    await handedOver(conv, await deadLetter(conv, mid));
  });

  it('a follow-up a schedule sent is not an answer to what the customer said: handed over', async () => {
    const { conv, mid } = await conversationWith('What colours?');
    await reply(conv, 'outreach', 'sent', 'Following up on our catalogue.');
    await handedOver(conv, await deadLetter(conv, mid));
  });

  it('an answer from BEFORE the message does not answer it: handed over', async () => {
    const conv = randomUUID();
    const mid = `wamid.${RUN}.after`;
    await tx(async (t) => {
      await opened(t, conv);
      await sql`insert into outbound_messages (business_id, conversation_id, seq, body, status, origin, created_at)
        values (${BIZ}, ${conv}, 1, 'Welcome!', 'sent', 'employee', now() - interval '1 hour')`.execute(t);
    });
    await tx(async (t) => {
      const { recordTypedMessage } = await import('../../src/pipeline/received.js');
      await sql`insert into message_fragments (id, business_id, conversation_id, text) values (${mid}, ${BIZ}, ${conv}, 'Thanks, and the price?')`.execute(t);
      await recordTypedMessage(t, conv, mid, 'Thanks, and the price?');
    });
    await handedOver(conv, await deadLetter(conv, mid));
  });
});
