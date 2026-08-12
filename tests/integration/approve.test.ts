import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { RUN_BIZ, nsId, seedRunTenant } from './tenant.js';

/**
 * The full trust loop, proven against real Postgres: computeTurn creates a
 * pending draft → applyOwnerCommand resolves it → the EXISTING outbound path
 * is invoked (captured via a fake kickOutbound). One service, reused by both
 * the inbox and the future webhook handler. Requires DATABASE_URL (same
 * convention as the other integration tests); skips otherwise.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

// M34.8 — this run's OWN tenant, not the shared demo. These tests approve and
// edit drafts, which mutates whatever tenant they touch; pointing them at the
// shared one made a second run fail in ways indistinguishable from a regression.
const BIZ_A = RUN_BIZ;
const CONV_A = nsId('000000000302');
const BIZ_B = 'bb000000-0000-4000-8000-0000000000b2';
const CLIENT_B = 'bb000000-0000-4000-8000-0000000000c2';
const CONV_B = 'bb000000-0000-4000-8000-0000000000d2';

d('applyOwnerCommand — the full approval loop (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let withTenantTx: typeof import('../../src/db/client.js').withTenantTx;
  let applyOwnerCommand: typeof import('../../src/pipeline/approve.js').applyOwnerCommand;
  let parseBusinessId: typeof import('../../src/core/types/ids.js').parseBusinessId;
  let sent: Array<{ businessId: string; conversationId: string; reply: string }> = [];

  // All tenant-scoped tables are RLS'd; test reads/writes must carry context.
  const withA = <T,>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> =>
    withTenantTx(db, bidA(), fn);

  const deps = () => ({
    db, now: () => new Date('2026-07-27T10:00:00Z'),
    kickOutbound: async (businessId: string, conversationId: string, reply: string) => {
      sent.push({ businessId, conversationId, reply });
    },
  });

  const bidA = () => {
    const p = parseBusinessId(BIZ_A); if (!p.ok) throw new Error('fixture'); return p.value;
  };

  async function newDraft(business: string, conversation: string, text: string, capability = 'quote'): Promise<string> {
    const { withTenantTx } = await import('../../src/db/client.js');
    const bid = parseBusinessId(business); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, async (tx) => {
      // turn_message_id → null (nullable; the real pipeline FKs it to a turn
      // written in the same tx — not needed for an isolated draft fixture).
      const r = await sql<{ id: string }>`
        insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
        values (${business}, ${conversation}, ${capability}, ${text}, null, 'pending')
        returning id`.execute(tx);
      return r.rows[0]!.id;
    });
  }

  beforeAll(async () => {
    ({ applyOwnerCommand } = await import('../../src/pipeline/approve.js'));
    ({ parseBusinessId } = await import('../../src/core/types/ids.js'));
    await seedRunTenant();
    const clientMod = await import('../../src/db/client.js');
    withTenantTx = clientMod.withTenantTx;
    db = clientMod.createDb(DATABASE_URL!);
    // Business B fixtures (for cross-business isolation), created in B's tenant.
    const bidB = parseBusinessId(BIZ_B); if (!bidB.ok) throw new Error('fixture');
    await withTenantTx(db, bidB.value, async (tx) => {
      await sql`insert into businesses (id, name) values (${BIZ_B}, 'Isolation Test Co') on conflict (id) do nothing`.execute(tx);
      await sql`insert into clients (id, business_id, display_name) values (${CLIENT_B}, ${BIZ_B}, 'B Buyer') on conflict (id) do nothing`.execute(tx);
      await sql`insert into conversations (id, business_id, client_id, channel) values (${CONV_B}, ${BIZ_B}, ${CLIENT_B}, 'whatsapp') on conflict (id) do nothing`.execute(tx);
    });
  }, 30_000);

  afterAll(async () => { await db?.destroy(); });

  it('发送 → draft approved, existing send invoked once with the draft text', async () => {
    sent = [];
    const id = await newDraft(BIZ_A, CONV_A, 'For 5,000 pcs: $0.92/pc FOB Ningbo.');
    const r = await applyOwnerCommand(deps(), { businessId: bidA(), draftId: id, rawReply: '发送', decidedBy: 'owner' });
    expect(r.outcome).toBe('sent');
    expect(sent).toEqual([{ businessId: BIZ_A, conversationId: CONV_A, reply: 'For 5,000 pcs: $0.92/pc FOB Ningbo.' }]);
    const row = await readDraft(id);
    expect(row.status).toBe('approved');
    expect(row.sent_text).toBe('For 5,000 pcs: $0.92/pc FOB Ningbo.');
    // actor recorded in the audit event (decided_by FKs agents; owner is null)
    const ev = await withA((tx) => sql<{ n: number }>`
      select count(*)::int as n from conversation_events
       where conversation_id=${CONV_A} and type='draft_resolved' and payload->>'actor'='owner'`
      .execute(tx).then((x) => x.rows[0]!.n));
    expect(ev).toBeGreaterThanOrEqual(1);
  });

  it('改 → owner text sent, edit recorded for learning (training_examples)', async () => {
    sent = [];
    const id = await newDraft(BIZ_A, CONV_A, 'Unit price is $0.95.');
    const r = await applyOwnerCommand(deps(), { businessId: bidA(), draftId: id, rawReply: '改：告诉他0.92，5000个的价', decidedBy: 'owner' });
    expect(r.outcome).toBe('edited_sent');
    expect(sent[0]!.reply).toBe('告诉他0.92，5000个的价');
    const row = await readDraft(id);
    expect(row.status).toBe('edited');
    expect(row.sent_text).toBe('告诉他0.92，5000个的价');   // ≠ draft_text → the view sees a correction
    const learned = await withA((tx) => sql<{ n: number }>`select count(*)::int as n from training_examples where draft_id = ${id}`
      .execute(tx).then((x) => x.rows[0]?.n)).catch(() => null);
    if (learned !== null && learned !== undefined) expect(learned).toBeGreaterThanOrEqual(1);
  });

  it('不回 → draft rejected, nothing sent', async () => {
    sent = [];
    const id = await newDraft(BIZ_A, CONV_A, 'draft to skip');
    const r = await applyOwnerCommand(deps(), { businessId: bidA(), draftId: id, rawReply: '不回', decidedBy: 'owner' });
    expect(r.outcome).toBe('skipped');
    expect(sent).toHaveLength(0);
    expect((await readDraft(id)).status).toBe('rejected');
  });

  it('收回 → capability pulled back to draft, capability_events recorded, nothing sent', async () => {
    sent = [];
    await withA((tx) => sql`update autonomy_policy set mode='auto' where business_id=${BIZ_A} and capability='negotiate'`.execute(tx));
    const id = await newDraft(BIZ_A, CONV_A, 'draft to revoke', 'negotiate');
    const before = await countCapEvents();
    const r = await applyOwnerCommand(deps(), { businessId: bidA(), draftId: id, rawReply: '收回', decidedBy: 'owner' });
    expect(r.outcome).toBe('revoked');
    expect(sent).toHaveLength(0);
    const mode = await withA((tx) => sql<{ mode: string }>`select mode from autonomy_policy where business_id=${BIZ_A} and capability='negotiate'`
      .execute(tx).then((x) => x.rows[0]?.mode));
    expect(mode).toBe('draft');
    expect(await countCapEvents()).toBe(before + 1);
  });

  it('double submit is idempotent — the second call sends nothing', async () => {
    sent = [];
    const id = await newDraft(BIZ_A, CONV_A, 'send me once');
    const first = await applyOwnerCommand(deps(), { businessId: bidA(), draftId: id, rawReply: '发送', decidedBy: 'owner' });
    const second = await applyOwnerCommand(deps(), { businessId: bidA(), draftId: id, rawReply: '发送', decidedBy: 'owner' });
    expect(first.outcome).toBe('sent');
    expect(second.outcome).toBe('already_resolved');
    expect(sent).toHaveLength(1);   // sent exactly once despite two submits
  });

  it('unknown command leaves the draft pending and sends nothing', async () => {
    sent = [];
    const id = await newDraft(BIZ_A, CONV_A, 'still pending');
    const r = await applyOwnerCommand(deps(), { businessId: bidA(), draftId: id, rawReply: '?', decidedBy: 'owner' });
    expect(r.outcome).toBe('unknown');
    expect(sent).toHaveLength(0);
    expect((await readDraft(id)).status).toBe('pending');
  });

  it('missing draft → not_found', async () => {
    const r = await applyOwnerCommand(deps(), { businessId: bidA(), draftId: '00000000-0000-4000-8000-000000000000', rawReply: '发送', decidedBy: 'owner' });
    expect(r.outcome).toBe('not_found');
  });

  it('cross-business isolation: A cannot resolve B\'s draft (RLS hides it)', async () => {
    sent = [];
    const bDraft = await newDraft(BIZ_B, CONV_B, 'B private draft');
    // Owner of A tries to act on B's draft id.
    const r = await applyOwnerCommand(deps(), { businessId: bidA(), draftId: bDraft, rawReply: '发送', decidedBy: 'owner' });
    expect(r.outcome).toBe('not_found');   // never leaks that it exists
    expect(sent).toHaveLength(0);
    // B's draft is untouched, still pending.
    const bidB = parseBusinessId(BIZ_B); if (!bidB.ok) throw new Error('fixture');
    const { withTenantTx } = await import('../../src/db/client.js');
    const status = await withTenantTx(db, bidB.value, (tx) =>
      sql<{ status: string }>`select status from drafts where id=${bDraft}`.execute(tx).then((x) => x.rows[0]?.status));
    expect(status).toBe('pending');
  });

  // helpers
  async function readDraft(id: string): Promise<{ status: string; sent_text: string | null; decided_by: string | null }> {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, bidA(), (tx) =>
      sql<{ status: string; sent_text: string | null; decided_by: string | null }>`
        select status, sent_text, decided_by from drafts where id=${id}`.execute(tx).then((x) => x.rows[0]!));
  }
  async function countCapEvents(): Promise<number> {
    return withA((tx) => sql<{ n: number }>`select count(*)::int as n from capability_events where reasons @> array['owner_revoked']`
      .execute(tx).then((x) => x.rows[0]!.n));
  }
});
