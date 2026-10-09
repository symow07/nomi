import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant, flashSaid, runDigits } from './tenant.js';

/**
 * R2 (docs/PRE-LAUNCH.md) — a draft is acted on only from its own conversation's page. The approval route asks the
 * reply window and the allowlist of the conversation in the ADDRESS, and keeps an edit on the draft it is given;
 * before R2, a draft of another conversation posted there went past both. Now it is not found and nothing is done:
 * not sent, not resolved, no edit kept. The approval path itself refuses the same (applyOwnerCommand's
 * `conversationId`), so the route is not the only guard.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd2d0000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const CODE = 'r2-draft-conversation-owner-code';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('R2 · a draft is acted on only from its own conversation (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  let convA = ''; let convB = ''; let draftB = '';
  const kicked: string[] = [];

  const as = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const act = (conversation: string, fields: Record<string, string>) => app.inject({
    method: 'POST', url: `/app/inbox/${conversation}/act`, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString(),
  });
  const draft = () => as((t) => sql<{ status: string; owner_edit: string | null }>`
    select status, owner_edit from drafts where id = ${draftB}::uuid`.execute(t).then((r) => r.rows[0]!));

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    ({ convA, convB, draftB } = await as(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Two Conversations') on conflict (id) do nothing`.execute(t);
      const conv = async (name: string, digits: string) => {
        const client = (await sql<{ id: string }>`insert into clients (business_id, phone, display_name)
          values (${BIZ}, ${`+9715${digits}`}, ${name}) returning id::text as id`.execute(t)).rows[0]!.id;
        return (await sql<{ id: string }>`insert into conversations (business_id, client_id, channel, phase)
          values (${BIZ}, ${client}::uuid, 'whatsapp', 'warm_intake') returning id::text as id`.execute(t)).rows[0]!.id;
      };
      const a = await conv('Amal', runDigits(RUN, 8));
      const b = await conv('Bilal', runDigits(`${RUN}b`, 8));
      const dr = (await sql<{ id: string }>`insert into drafts (business_id, conversation_id, capability, draft_text, status)
        values (${BIZ}, ${b}::uuid, 'quote', 'Five thousand at 0.92 each.', 'pending') returning id::text as id`.execute(t)).rows[0]!.id;
      return { convA: a, convB: b, draftB: dr };
    }));
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, employeeName: 'Lily', avatar: '👩‍💼',
      provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async (_b: string, conversationId: string) => { kicked.push(conversationId); }, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${CODE}`, headers: FORM })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('another conversation\'s draft, posted from this page: not found — not sent, not resolved, no edit kept', async () => {
    for (const fields of [{ draftId: draftB, command: '发送' }, { draftId: draftB, command: 'send', edit: 'Other words entirely.' },
      { draftId: draftB, command: '改', edit: 'Changed.' }, { draftId: draftB, command: '不回' }]) {
      const res = await act(convA, fields);
      expect(res.statusCode, JSON.stringify(fields)).toBe(302);
      expect(flashSaid(res, SECRET)).toBe('That reply was not found.');
    }
    expect(await draft()).toEqual({ status: 'pending', owner_edit: null });
    expect(kicked).toEqual([]);
    // an address that is no conversation at all, the same
    expect(flashSaid(await act('not-a-conversation', { draftId: draftB, command: '发送' }), SECRET)).toBe('That reply was not found.');
  });

  it('the approval path refuses it too: a draft named with another conversation is not found', async () => {
    const { applyOwnerCommand } = await import('../../src/pipeline/approve.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    const r = await applyOwnerCommand({ db, now: () => new Date(), kickOutbound: async () => {} },
      { businessId: bid.value, draftId: draftB, rawReply: '发送', decidedBy: 'owner', conversationId: convA });
    expect(r.outcome).toBe('not_found');
    expect((await draft()).status).toBe('pending');
  });

  it('the control: from its own page, the same draft is approved', async () => {
    const res = await act(convB, { draftId: draftB, command: '发送' });
    expect(res.statusCode).toBe(302);
    expect(flashSaid(res, SECRET)).not.toBe('That reply was not found.');
    expect((await draft()).status).not.toBe('pending');
  });
});
