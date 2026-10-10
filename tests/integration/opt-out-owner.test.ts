import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { flashSaid } from './tenant.js';

/**
 * 0135 — a buyer who said stop, on the owner's side of the product.
 *
 *   · Anyone looking after them records a stop nothing caught, on their page.
 *   · Until they write again the owner's own reply and an ordinary approval are
 *     refused before anything is queued — the words kept, the notice saying why
 *     — while the line that answers the stop, sent as written, goes with its mark.
 *   · After they write, the owner's reply goes. Only the owner lifts it.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd8d0000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('0135 · the owner and a buyer who said stop (requires DATABASE_URL)', () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let cookie = '';
  let conv = '';
  const ig = `ig-stop-${RUN}`;
  const kicked: { text: string; notice: string | null }[] = [];
  const drove: string[] = [];

  const tx = async <R>(fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const post = (url: string, fields: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const file = async () => (await app.inject({ method: 'GET', url: `/app/conversations/${conv}`, headers: { cookie } })).body;
  const newDraft = (text: string, notice: 'opt_out' | null = null) => tx((x) => sql<{ id: string }>`
    insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status, notice)
    values (${BIZ}, ${conv}, 'qualify', ${text}, null, 'pending', ${notice}) returning id::text as id`.execute(x).then((r) => r.rows[0]!.id));
  const optOut = () => tx((x) => sql<{ recorded_by: string; lifted_at: Date | null }>`
    select recorded_by, lifted_at from opt_outs where business_id = ${BIZ}::uuid and identity = ${ig}`.execute(x).then((r) => r.rows));
  const audit = (action: string) => tx((x) => sql<{ n: number }>`
    select count(*)::int as n from channel_audit where business_id = ${BIZ}::uuid and action = ${action}`.execute(x).then((r) => r.rows[0]!.n));

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await tx((x) => sql`insert into businesses (id, name, owner_locale) values (${BIZ}, 'Stop Owner', 'en')
                        on conflict (id) do nothing`.execute(x));
    await tx(async (x) => {
      const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
                values (${BIZ}, 'instagram', ${`ig-acct-${RUN}`}, 'stop-secret', 'service', true)`.execute(x);
      const c = await ensureConversation(x, b.value, ig, 'Stop Buyer', 'instagram');
      conv = c.conversationId;
      await sql`update client_channels set last_inbound_at = now() - interval '1 minute' where client_id = ${c.clientId}`.execute(x);
    });
    app = Fastify({ logger: false });
    const code = `stop-${RUN}`;
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: true,
      kickOutbound: async (_b: string, _c: string, text: string, _asks: unknown, notice?: string | null) => { kicked.push({ text, notice: notice ?? null }); },
      kickDrive: async (_b: string, c: string) => { drove.push(c); },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${code}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('nothing stands: the page offers to record one; recording it is on the trail', async () => {
    expect(await file()).toContain('Record that they asked not to be messaged');
    const r = await post(`/app/conversations/${conv}/opt-out/record`);
    expect(flashSaid(r, SECRET)).toContain('Nothing more will be sent to this customer on this channel.');
    expect(await optOut()).toEqual([{ recorded_by: 'owner', lifted_at: null }]);
    expect(await audit('opt_out_recorded')).toBe(1);
    const html = await file();
    expect(html).toContain('Asked not to be messaged on Instagram');
    expect(html).toContain('/opt-out/lift');
  });

  it('the owner’s own reply is refused before it is queued, and waits in the box', async () => {
    const r = await post(`/app/inbox/${conv}/reply`, { text: 'Just checking in about the totes.' });
    expect(flashSaid(r, SECRET)).toContain('this customer asked not to be messaged');
    expect(drove).toEqual([]);
    const kept = await tx((x) => sql<{ t: string | null }>`
      select owner_unsent_reply as t from conversations where id = ${conv}::uuid`.execute(x).then((q) => q.rows[0]!.t));
    expect(kept).toBe('Just checking in about the totes.');
  });

  it('an ordinary approval is refused; the line that answers the stop, as written, goes with its mark', async () => {
    const ordinary = await newDraft('Here is our new catalogue.');
    const no = await post(`/app/inbox/${conv}/act`, { draftId: ordinary, command: 'send', edit: 'Here is our new catalogue.' });
    expect(flashSaid(no, SECRET)).toContain('this customer asked not to be messaged');
    expect(kicked).toEqual([]);
    const { OPT_OUT_REPLIES } = await import('../../src/core/safety/optOut.js');
    const line = await newDraft(OPT_OUT_REPLIES.en, 'opt_out');
    await post(`/app/inbox/${conv}/act`, { draftId: line, command: 'send', edit: OPT_OUT_REPLIES.en });
    expect(kicked).toEqual([{ text: OPT_OUT_REPLIES.en, notice: 'opt_out' }]);
  });

  it('after they write, the owner’s reply goes', async () => {
    await tx((x) => sql`update client_channels set last_inbound_at = now() + interval '1 second'
                        where channel = 'instagram' and channel_user_id = ${ig}`.execute(x));
    await post(`/app/inbox/${conv}/takeover`);
    await post(`/app/inbox/${conv}/reply`, { text: 'Thanks for writing back!' });
    expect(drove).toEqual([conv]);
  });

  it('only the owner lifts it, and the trail says so; the page offers to record again', async () => {
    const r = await post(`/app/conversations/${conv}/opt-out/lift`);
    expect(flashSaid(r, SECRET)).toContain('This customer can be messaged again.');
    expect((await optOut())[0]!.lifted_at).not.toBeNull();
    expect(await audit('opt_out_lifted')).toBe(1);
    expect(await file()).toContain('Record that they asked not to be messaged');
  });
});
