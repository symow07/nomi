import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { flashSaid } from './tenant.js';
import { buttonsAndDoors } from '../parity/buttons-and-doors.js';

/**
 * THE APPROVAL CARD, over Postgres and the owner's routes (the design pass,
 * 2026-09-29).
 *
 *   - the page draws one card from the stored turn: what was understood, how
 *     the reply was read, the reply once in its box, one Send;
 *   - Send with the draft's own words goes as the draft (the approval path's
 *     "send"), with other words as the owner's edit, with an empty box not at
 *     all — and the approval path is the one it always was;
 *   - Hand to me is the take-over, from the same form;
 *   - No reply needed drops this one reply and sends nothing.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd7c0000-0000-4000-8000-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('the approval card (requires DATABASE_URL)', () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let cookie = '';
  let conv = '';
  let other = '';
  const kicked: { conversationId: string; text: string }[] = [];

  const tx = async <R>(fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const post = (url: string, fields: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const page = async (c: string) => (await app.inject({ method: 'GET', url: `/app/inbox/${c}`, headers: { cookie } })).body;
  const newDraft = (c: string, text: string) => tx((x) => sql<{ id: string }>`
    insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
    values (${BIZ}, ${c}, 'quote', ${text}, null, 'pending') returning id::text as id`.execute(x).then((r) => r.rows[0]!.id));
  const draftRow = (id: string) => tx((x) => sql<{ status: string; sent_text: string | null }>`
    select status, sent_text from drafts where id = ${id}::uuid`.execute(x).then((r) => r.rows[0]!));

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await tx((x) => sql`insert into businesses (id, name, owner_locale) values (${BIZ}, 'Card Shop', 'en')
                        on conflict (id) do nothing`.execute(x));
    await tx(async (x) => {
      const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
                values (${BIZ}, 'instagram', ${`ig-card-${RUN}`}, 'card-secret', 'service', true)`.execute(x);
      const c = await ensureConversation(x, b.value, `ig-maya-${RUN}`, 'Maya Rahman', 'instagram');
      const o = await ensureConversation(x, b.value, `ig-omar-${RUN}`, 'Omar Haddad', 'instagram');
      conv = c.conversationId; other = o.conversationId;
      await sql`update client_channels set last_inbound_at = now() - interval '1 minute'
                 where client_id in (${c.clientId}::uuid, ${o.clientId}::uuid)`.execute(x);
      await sql`update conversations set assigned_to = null where id in (${conv}::uuid, ${other}::uuid)`.execute(x);
      await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
                values (${conv}::uuid, ${`in-${RUN}`}, 'inbound', 'text', 'do you have the rose serum in 50ml? how much?', now() - interval '1 minute')`.execute(x);
      // The turn that drafted the reply: the model's reading and a second, separate one that agreed.
      await sql`insert into turns (message_id, business_id, conversation_id, state_before, input, analysis, decision, engine, engine_version, own_understanding)
                values (${`in-${RUN}`}, ${BIZ}, ${conv}, '{}'::jsonb, '{}'::jsonb,
                        ${JSON.stringify({ language: { detected: 'en', replyIn: 'en' }, intent: { primary: 'price_request', productCandidate: null,
                          quantityMentioned: { value: 50, unit: 'ml' }, nextLogicalQuestion: null, missingFields: [] }, recommendedPhase: 'qualification' })}::jsonb,
                        '{}'::jsonb, 'service', 'test',
                        ${JSON.stringify({ own: {}, agrees: { language: true, quantity: true, product: true, complaint: true, phase: true }, onEverything: true })}::jsonb)`.execute(x);
    });
    app = Fastify({ logger: false });
    const code = `card-${RUN}`;
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: true,
      kickOutbound: async (_b: string, c: string, text: string) => { kicked.push({ conversationId: c, text }); },
      kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${code}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('draws one card from the stored turn: understood, read twice, the reply once, one Send', async () => {
    await newDraft(conv, 'Hi Maya! Yes, it comes in 50 ml. Shall I send the link?');
    const html = await page(conv);
    // Phase 2 — who asked and when is the transcript's caption, just above; the card opens on who drafted it
    expect(html).not.toContain('<b><bdi>Maya Rahman</bdi></b> asked ·');
    expect(html).toContain('<span class="as"><span class="shape s-assistant" aria-hidden="true"></span> Your assistant drafted</span>');
    expect(html).toMatch(/<span class="k">Understood as:<\/span> <span><bdi>a price question<\/bdi> · <bdi>50\u00a0ml<\/bdi> · <bdi>English<\/bdi><\/span>/);
    expect(html).toContain('checked twice');
    expect(html).toContain('a second, separate reading found the same');
    expect(html).toContain('<span class="k">goes on Instagram, as written</span>');
    expect(html).toMatch(/Instagram takes replies until \d\d:\d\d/);
    expect(html.split('Shall I send the link?')).toHaveLength(2);
    expect(html.match(/name="command" value="send"/g)).toHaveLength(1);
    expect(buttonsAndDoors(html)).toEqual([]);
  });

  it('Send with the draft\'s own words sends the draft — line endings and the ends aside', async () => {
    const id = (await tx((x) => sql<{ id: string }>`
      select id::text as id from drafts where conversation_id = ${conv}::uuid and status = 'pending'`.execute(x))).rows[0]!.id;
    const r = await post(`/app/inbox/${conv}/act`, { draftId: id, command: 'send', edit: '  Hi Maya! Yes, it comes in 50 ml. Shall I send the link?\r\n' });
    expect(flashSaid(r, SECRET)).toContain('Waiting to send.');
    expect(await draftRow(id)).toEqual({ status: 'approved', sent_text: 'Hi Maya! Yes, it comes in 50 ml. Shall I send the link?' });
    expect(kicked.at(-1)).toEqual({ conversationId: conv, text: 'Hi Maya! Yes, it comes in 50 ml. Shall I send the link?' });
  });

  it('Send with other words sends them as the owner\'s edit, through the same path', async () => {
    const id = await newDraft(conv, 'The 100 ml is back next week.');
    const r = await post(`/app/inbox/${conv}/act`, { draftId: id, command: 'send', edit: 'The 100 ml is back on Friday.' });
    expect(flashSaid(r, SECRET)).toContain('Your version is waiting to send');
    expect(await draftRow(id)).toEqual({ status: 'edited', sent_text: 'The 100 ml is back on Friday.' });
    expect(kicked.at(-1)).toEqual({ conversationId: conv, text: 'The 100 ml is back on Friday.' });
  });

  it('an empty box sends nothing, says so, and the reply still waits', async () => {
    const before = kicked.length;
    const id = await newDraft(conv, 'Anything else I can help with?');
    const r = await post(`/app/inbox/${conv}/act`, { draftId: id, command: 'send', edit: '   ' });
    expect(flashSaid(r, SECRET)).toContain('Nothing went: the reply box was empty.');
    expect((await draftRow(id)).status).toBe('pending');
    expect(kicked).toHaveLength(before);
  });

  it('No reply needed drops this one reply and sends nothing', async () => {
    const before = kicked.length;
    const id = (await tx((x) => sql<{ id: string }>`
      select id::text as id from drafts where conversation_id = ${conv}::uuid and status = 'pending'`.execute(x))).rows[0]!.id;
    await post(`/app/inbox/${conv}/act`, { draftId: id, command: '不回', edit: 'Anything else I can help with?' });
    expect((await draftRow(id)).status).toBe('rejected');
    expect(kicked).toHaveLength(before);
  });

  it('Hand to me takes the conversation from the same form; the card gives way to the owner\'s own box', async () => {
    const id = await newDraft(other, 'For 4 gift boxes I can do 76 instead of 84.');
    const html = await page(other);
    expect(html).toContain(`formaction="/app/inbox/${other}/takeover"`);
    // the browser posts the card's form to the button's formaction
    await post(`/app/inbox/${other}/takeover`, { draftId: id, edit: 'For 4 gift boxes I can do 76 instead of 84.' });
    const after = await page(other);
    expect(after).not.toContain('id="approve"');
    expect(after).toContain(`action="/app/inbox/${other}/reply"`);
    expect((await draftRow(id)).status).toBe('pending');   // taken over, not decided: nothing went
  });
});
