import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { flashSaid } from './tenant.js';

/**
 * CC-24 — the owner's words survive a refusal (0072, 2026-09-27).
 *
 * The audit: "Editing a draft starts from an empty box, and if the send is
 * refused the text she typed is thrown away." The owner's decision: the edit
 * survives, even if the send is refused. Over Postgres and the owner's routes:
 *
 *   - the edit box opens with the draft itself, not an empty box;
 *   - an edit refused because the assistant is stopped is kept on the draft,
 *     and the box opens with it; after Start it sends exactly as written;
 *   - an edit refused because the buyer's window is shut is kept too;
 *   - the owner's own reply, refused before it could be queued, waits in the
 *     reply box; a reply that goes clears it.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd7c0000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('CC-24 · the owner’s words survive a refusal (requires DATABASE_URL)', () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let cookie = '';
  let open = '';     // his window is open
  let shut = '';     // he wrote two days ago
  const kicked: { conversationId: string; text: string }[] = [];
  const drove: string[] = [];

  const tx = async <R>(fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const post = (url: string, fields: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const page = async (conv: string) => (await app.inject({ method: 'GET', url: `/app/inbox/${conv}`, headers: { cookie } })).body;
  const newDraft = (conv: string, text: string) => tx((x) => sql<{ id: string }>`
    insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
    values (${BIZ}, ${conv}, 'quote', ${text}, null, 'pending') returning id::text as id`.execute(x).then((r) => r.rows[0]!.id));
  const draftRow = (id: string) => tx((x) => sql<{ status: string; owner_edit: string | null; sent_text: string | null }>`
    select status, owner_edit, sent_text from drafts where id = ${id}::uuid`.execute(x).then((r) => r.rows[0]!));
  /** What the edit box holds — the textarea's own contents, not text elsewhere on the page. */
  const editBox = (html: string) => /<textarea id="reply"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? null;
  const replyBox = (html: string) => /<textarea name="text"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? null;

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await tx((x) => sql`insert into businesses (id, name, owner_locale) values (${BIZ}, 'Kept Words', 'en')
                        on conflict (id) do nothing`.execute(x));
    await tx(async (x) => {
      const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
                values (${BIZ}, 'instagram', ${`ig-kept-${RUN}`}, 'kept-secret', 'service', true)`.execute(x);
      const o = await ensureConversation(x, b.value, `ig-open-${RUN}`, 'Open Window', 'instagram');
      const s = await ensureConversation(x, b.value, `ig-shut-${RUN}`, 'Shut Window', 'instagram');
      open = o.conversationId; shut = s.conversationId;
      await sql`update client_channels set last_inbound_at = now() - interval '1 minute' where client_id = ${o.clientId}`.execute(x);
      await sql`update client_channels set last_inbound_at = now() - interval '2 days' where client_id = ${s.clientId}`.execute(x);
      await sql`update conversations set assigned_to = null where id in (${open}::uuid, ${shut}::uuid)`.execute(x);
    });
    app = Fastify({ logger: false });
    const code = `kept-${RUN}`;
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: true,
      kickOutbound: async (_b: string, c: string, text: string) => { kicked.push({ conversationId: c, text }); },
      kickDrive: async (_b: string, c: string) => { drove.push(c); },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${code}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  let draftId = '';

  it('the edit box opens with the draft itself — an edit, not a retyping', async () => {
    draftId = await newDraft(open, 'We can do 500 pcs at 2.40 each.');
    const html = await page(open);
    expect(editBox(html)).toBe('We can do 500 pcs at 2.40 each.');
    expect(html).not.toContain('Your edit is kept here');
  });

  it('an edit REFUSED because the assistant is stopped is kept on the draft, and the box opens with it', async () => {
    await post('/app/business/stop-assistant');
    const r = await post(`/app/inbox/${open}/act`, { draftId, command: '改', edit: 'My own words: 500 pcs at 2.35 each, ships Friday.' });
    expect(flashSaid(r, SECRET)).toContain('this draft was not sent');
    expect(await draftRow(draftId)).toEqual({ status: 'pending', owner_edit: 'My own words: 500 pcs at 2.35 each, ships Friday.', sent_text: null });
    expect(kicked).toEqual([]);
    const html = await page(open);
    expect(editBox(html)).toBe('My own words: 500 pcs at 2.35 each, ships Friday.');
    expect(html).toContain('Your edit is kept here. It has not been sent.');
  });

  it('after Start, the kept edit sends exactly as written', async () => {
    await post('/app/business/start-assistant');
    const kept = editBox(await page(open))!;
    await post(`/app/inbox/${open}/act`, { draftId, command: '改', edit: kept });
    expect(kicked).toEqual([{ conversationId: open, text: 'My own words: 500 pcs at 2.35 each, ships Friday.' }]);
    const row = await draftRow(draftId);
    expect(row.status).toBe('edited');
    expect(row.sent_text).toBe('My own words: 500 pcs at 2.35 each, ships Friday.');
  });

  it('an edit refused because his WINDOW IS SHUT is kept too', async () => {
    const id = await newDraft(shut, 'Draft for the shut window.');
    const r = await post(`/app/inbox/${shut}/act`, { draftId: id, command: '改', edit: 'Kept despite the shut window.' });
    expect(r.statusCode).toBe(302);
    expect((await draftRow(id)).owner_edit).toBe('Kept despite the shut window.');
    expect(editBox(await page(shut))).toBe('Kept despite the shut window.');
    expect(kicked).toHaveLength(1);   // nothing more went
  });

  it('the owner’s own reply, refused before it could be queued, waits in the reply box; a reply that goes clears it', async () => {
    await post(`/app/inbox/${shut}/takeover`);
    const r = await post(`/app/inbox/${shut}/reply`, { text: 'Hello again — are you still interested?' });
    expect(r.statusCode).toBe(302);
    expect(drove).toEqual([]);
    const kept = await tx((x) => sql<{ t: string | null }>`
      select owner_unsent_reply as t from conversations where id = ${shut}::uuid`.execute(x).then((q) => q.rows[0]!.t));
    expect(kept).toBe('Hello again — are you still interested?');
    const html = await page(shut);
    expect(replyBox(html)).toBe('Hello again — are you still interested?');
    expect(html).toContain('Your reply is kept here. It has not been sent.');

    // He writes; the window opens; the owner sends — and the box is empty again.
    await tx((x) => sql`update client_channels set last_inbound_at = now()
                         where channel = 'instagram' and channel_user_id = ${`ig-shut-${RUN}`}`.execute(x));
    await post(`/app/inbox/${shut}/reply`, { text: 'Hello again — are you still interested?' });
    expect(drove).toEqual([shut]);
    const after = await tx((x) => sql<{ t: string | null }>`
      select owner_unsent_reply as t from conversations where id = ${shut}::uuid`.execute(x).then((q) => q.rows[0]!.t));
    expect(after).toBeNull();
    expect(replyBox(await page(shut))).toBe('');
  });
});
