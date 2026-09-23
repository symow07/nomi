import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';
import { t, ASSISTANT_FALLBACK } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { contradictsHistory } from '../../src/core/commerce/quote.js';
import { usd } from '../../src/core/types/money.js';
import { formatDate } from '../../src/core/owner/i18n/format.js';

/**
 * G7a — the draft card says why her rules held it.
 *
 * The turn writes the reason on the `draft_pending` event beside the draft
 * (tests/pipeline/hold.test.ts). Only Postgres can prove the inbox reads that
 * event back for THIS draft — not another draft's, and not a stale one.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd7a0000-0000-4000-8000-${RUN}0001`;
const CODE = 'hold-reason-owner-code';

d('G7a · the held draft names her rule (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  let heldConv = '';
  let plainConv = '';
  let contraConv = '';

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  /** A pending draft, and the event the turn writes beside it. */
  const draftIn = (t: import('../../src/db/client.js').Tx, conv: string, heldBecause: string | null, extra: Record<string, unknown> = {}) =>
    sql<{ id: string }>`
      insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
      values (${BIZ}, ${conv}::uuid, 'quote', 'For 5,000 pcs: $0.41/pc.', null, 'pending')
      returning id::text as id`.execute(t).then(async (r) => {
      const id = r.rows[0]!.id;
      await sql`insert into conversation_events (business_id, conversation_id, type, payload)
                values (${BIZ}, ${conv}::uuid, 'draft_pending',
                        ${JSON.stringify({ draftId: id, capability: 'quote', ...(heldBecause ? { heldBecause } : {}), ...extra })}::jsonb)`.execute(t);
      return id;
    });

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Hold Reason Factory')
                on conflict (id) do nothing`.execute(t);
      const conv = async (n: number) => {
        const client = (await sql<{ id: string }>`
          insert into clients (business_id, phone, display_name)
          values (${BIZ}, ${`+8613${RUN}${n}`}, 'Ahmed') returning id::text as id`.execute(t)).rows[0]!.id;
        return (await sql<{ id: string }>`
          insert into conversations (business_id, client_id, channel, phase)
          values (${BIZ}, ${client}::uuid, 'whatsapp', 'commercial_discussion') returning id::text as id
        `.execute(t)).rows[0]!.id;
      };
      heldConv = await conv(1);
      plainConv = await conv(2);
      // An OLDER draft in the held conversation, already decided, whose event
      // says something else: the card must read the pending draft's own event.
      const old = await draftIn(t, heldConv, 'quantity_heard_not_typed');
      await sql`update drafts set status = 'rejected', decided_at = now() where id = ${old}::uuid`.execute(t);
      await draftIn(t, heldConv, 'discount_needs_owner');
      await draftIn(t, plainConv, null);
      // G7b — the payload exactly as the turn serialises it: a real
      // contradiction, through JSON (its Date becomes an ISO string).
      contraConv = await conv(3);
      await draftIn(t, contraConv, 'contradicts_history', {
        contradicts: contradictsHistory(
          [{ quantity: 5000, unitPrice: usd(0.40), at: new Date('2026-03-04T10:00:00Z') }], 8000, usd(0.45)),
      });
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
    const res = await app.inject({
      method: 'POST', url: '/login', payload: `code=${CODE}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('the pending draft’s own reason is shown — not an older draft’s', async () => {
    const res = await app.inject({ method: 'GET', url: `/app/inbox/${heldConv}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(esc(t('en', 'inbox.draft.held.discount_needs_owner')));
    expect(res.body).not.toContain(esc(t('en', 'inbox.draft.held.quantity_heard_not_typed', { name: ASSISTANT_FALLBACK.en })));
  });

  it('G7b · a contradicting price shows BOTH prices and the date he was given the first', async () => {
    const res = await app.inject({ method: 'GET', url: `/app/inbox/${contraConv}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(esc(t('en', 'inbox.draft.held.contradicts_history', { name: ASSISTANT_FALLBACK.en })));
    const at = res.body.indexOf('<div class="held-then">');
    expect(at).toBeGreaterThan(-1);
    const then = res.body.slice(at, res.body.indexOf('</form>', at));
    expect(then).toContain('$0.40');
    expect(then).toContain('$0.45');
    expect(then).toContain(esc(formatDate('en', new Date('2026-03-04T10:00:00Z'))));
    // 8,000 at a higher price than 5,000 — the worse of the two cases, named.
    expect(then).toContain(esc(t('en', 'inbox.draft.contradicts.larger')));
  });

  it('a draft that waited only for her autonomy setting says nothing extra', async () => {
    const res = await app.inject({ method: 'GET', url: `/app/inbox/${plainConv}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('For 5,000 pcs');
    expect(res.body).not.toContain('class="held-why"');
    expect(res.body).not.toContain('class="held-then"');
  });
});
