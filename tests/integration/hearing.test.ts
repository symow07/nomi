import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { t } from '../../src/core/owner/i18n/messages.js';
import { flashSaid } from './tenant.js';

/**
 * G2a — the owner corrects what she heard, and only that.
 *
 * The route shipped in M34 and was asserted only by reading its source. Driven
 * for real it failed on every call: its audit insert named a `channel` column
 * `channel_audit` does not have and omitted the NOT NULL `actor`, so the whole
 * correction rolled back. It also accepted ANY message id in the conversation,
 * so her own reply or a typed buyer message could be rewritten and relabelled
 * as something the buyer said. And an unheard note she filled in was labelled
 * "Heard as" over her own words.
 *
 * End to end, against real Postgres and the real route table.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `cc340200-0000-4000-8000-${RUN}0001`;
const CLIENT = `cc340200-0000-4000-8000-${RUN}0002`;
const CONV = `cc340200-0000-4000-8000-${RUN}0003`;
const UNHEARD = `cc340200-0000-4000-8000-${RUN}0011`;
const HEARD = `cc340200-0000-4000-8000-${RUN}0012`;
const HER_REPLY = `cc340200-0000-4000-8000-${RUN}0013`;
const TYPED = `cc340200-0000-4000-8000-${RUN}0014`;

d('G2a · correcting what she heard (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const CODE = 'hearing-test-code';

  const tenant = async <T>(fn: (tx: import('../../src/db/client.js').Db) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn as never) as Promise<T>;
  };

  const correct = (messageId: string, heard: string) =>
    app.inject({
      method: 'POST', url: `/app/inbox/${CONV}/heard`,
      payload: `messageId=${encodeURIComponent(messageId)}&heard=${encodeURIComponent(heard)}`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    });

  const message = (id: string) => tenant((tx) => sql<{
    text_content: string | null; transcription: string | null; input_type: string;
  }>`select text_content, transcription, input_type from messages where id = ${id}::uuid`
    .execute(tx).then((r) => r.rows[0]!));

  const audits = () => tenant((tx) => sql<{ actor: string; detail: { messageId: string } }>`
    select actor, detail from channel_audit
     where business_id = ${BIZ} and action = 'transcript_corrected' order by id
  `.execute(tx).then((r) => r.rows));

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);

    await tenant(async (tx) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Hearing Test Factory') on conflict (id) do nothing`.execute(tx);
      await sql`insert into clients (id, business_id, display_name) values (${CLIENT}, ${BIZ}, 'Khalid') on conflict (id) do nothing`.execute(tx);
      await sql`insert into conversations (id, business_id, client_id, channel) values (${CONV}, ${BIZ}, ${CLIENT}, 'whatsapp') on conflict (id) do nothing`.execute(tx);
      // A note she could not make out: no words, no machine reading.
      await sql`insert into messages (id, conversation_id, direction, input_type, text_content, transcription, sent_at)
                values (${UNHEARD}, ${CONV}, 'inbound', 'voice', null, null, now() - interval '4 minutes')`.execute(tx);
      // A note she did hear: the words in force and the machine reading agree.
      await sql`insert into messages (id, conversation_id, direction, input_type, text_content, transcription, sent_at)
                values (${HEARD}, ${CONV}, 'inbound', 'voice_transcribed', 'I need five hundred bags', 'I need five hundred bags', now() - interval '3 minutes')`.execute(tx);
      // Her own reply, and a buyer message he TYPED. Neither is a hearing.
      await sql`insert into messages (id, conversation_id, direction, input_type, text_content, sent_at)
                values (${HER_REPLY}, ${CONV}, 'outbound', 'text', 'Thank you, one moment', now() - interval '2 minutes')`.execute(tx);
      await sql`insert into messages (id, conversation_id, direction, input_type, text_content, sent_at)
                values (${TYPED}, ${CONV}, 'inbound', 'text', 'Do you have blue', now() - interval '1 minute')`.execute(tx);
    });

    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE,
      sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();

    const login = await app.inject({
      method: 'POST', url: '/login',
      payload: `code=${encodeURIComponent(CODE)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie, 'the owner must be able to sign in for this test').not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('a note she never heard can be filled in, and it saves', async () => {
    const res = await correct(UNHEARD, 'Price for the red tote please');
    expect(res.statusCode).toBe(302);
    expect(flashSaid(res, 'a-test-session-secret-of-sufficient-length')).not.toBe('');

    const m = await message(UNHEARD);
    expect(m.text_content).toBe('Price for the red tote please');
    expect(m.input_type).toBe('voice_transcribed');
    // The machine's reading was NOTHING, and that is recorded rather than
    // left null — null would claim she heard exactly what the owner typed.
    expect(m.transcription).toBe('');
  });

  it('and the page says the owner supplied those words, not that she heard them', async () => {
    const res = await app.inject({ method: 'GET', url: `/app/inbox/${CONV}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const bubble = res.body.slice(res.body.indexOf('Price for the red tote please') - 400,
      res.body.indexOf('Price for the red tote please'));
    expect(bubble).toContain(t('en', 'voice.corrected'));
    expect(bubble).not.toContain(t('en', 'voice.heardAs'));
  });

  it('correcting a note she did hear keeps her reading, however often it is refined', async () => {
    expect((await correct(HEARD, 'I need fifteen hundred bags')).statusCode).toBe(302);
    expect((await correct(HEARD, 'I need 1500 bags')).statusCode).toBe(302);
    const m = await message(HEARD);
    expect(m.text_content).toBe('I need 1500 bags');
    expect(m.transcription).toBe('I need five hundred bags');
  });

  it('REFUSES anything that is not a buyer voice note — her reply, or typed text', async () => {
    const before = (await audits()).length;

    const own = await correct(HER_REPLY, 'something she never said');
    expect(own.statusCode).toBe(302);
    expect(flashSaid(own, 'a-test-session-secret-of-sufficient-length')).toBe('');
    expect((await message(HER_REPLY))).toMatchObject({ text_content: 'Thank you, one moment', input_type: 'text' });

    const typed = await correct(TYPED, 'something he never typed');
    expect(typed.statusCode).toBe(302);
    expect((await message(TYPED))).toMatchObject({ text_content: 'Do you have blue', input_type: 'text' });

    expect((await audits()).length).toBe(before);
  });

  it('every correction leaves an audit row that names who made it', async () => {
    const rows = await audits();
    expect(rows.map((r) => r.detail.messageId)).toEqual([UNHEARD, HEARD, HEARD]);
    for (const r of rows) expect(r.actor.trim()).not.toBe('');
  });
});
