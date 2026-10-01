import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * R1 — WHAT THE RAMP WILL COUNT, COUNTED RIGHT (the plan's six evidence
 * fixes; the owner-versus-staff read is R2's counter, where it is used).
 *   1. "Edit & send" with the words unchanged is sent as written.
 *   3. A guard trip on a reply rewritten clean is not evidence against her.
 *   4. The owner's step-downs and revokes do not reset the window; the
 *      system's own demotion does.
 *   5. One spot-check correction is counted once.
 *   6. Every count is this business's, by name (a source check in parity).
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `bb350000-0000-4000-8000-${RUN}0001`;
const CLIENT = `bb350000-0000-4000-8000-${RUN}0002`;
const CONV = `bb350000-0000-4000-8000-${RUN}0003`;

d('R1 · the evidence, counted right (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let withTenantTx: typeof import('../../src/db/client.js').withTenantTx;
  let bid: import('../../src/core/types/ids.js').BusinessId;
  const withBiz = <T,>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => withTenantTx(db, bid, fn);
  const draft = (cap: string, text: string) => withBiz(async (tx) => (await sql<{ id: string }>`
    insert into drafts (business_id, conversation_id, capability, draft_text) values (${BIZ}, ${CONV}, ${cap}, ${text}) returning id::text as id`.execute(tx)).rows[0]!.id);

  beforeAll(async () => {
    const m = await import('../../src/db/client.js');
    withTenantTx = m.withTenantTx;
    db = m.createDb(DATABASE_URL!);
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const p = parseBusinessId(BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
    await withBiz(async (tx) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'R1 Shop') on conflict (id) do nothing`.execute(tx);
      await sql`insert into clients (id, business_id, display_name) values (${CLIENT}, ${BIZ}, 'Buyer') on conflict (id) do nothing`.execute(tx);
      await sql`insert into conversations (id, business_id, client_id, channel) values (${CONV}, ${BIZ}, ${CLIENT}, 'whatsapp') on conflict (id) do nothing`.execute(tx);
    });
  }, 60_000);
  afterAll(async () => { await db?.destroy(); });

  it('1 · "Edit & send" with the words unchanged is the draft sent as written', async () => {
    const { applyOwnerCommand } = await import('../../src/pipeline/approve.js');
    const sent: string[] = [];
    const deps = { db, now: () => new Date(), kickOutbound: async (_b: string, _c: string, t: string) => { sent.push(t); } };
    const same = await draft('qualify', 'Which size would you like?');
    const r = await applyOwnerCommand(deps, { businessId: bid, draftId: same, rawReply: '改 Which size  would you like? ', decidedBy: 'owner' });
    expect(r.outcome).toBe('sent');
    const changed = await draft('qualify', 'Which colour?');
    expect((await applyOwnerCommand(deps, { businessId: bid, draftId: changed, rawReply: '改 Which colour would you like?', decidedBy: 'owner' })).outcome).toBe('edited_sent');
    const st = await withBiz(async (tx) => (await sql<{ id: string; status: string }>`select id::text as id, status from drafts where id in (${same}::uuid, ${changed}::uuid)`.execute(tx)).rows);
    expect(Object.fromEntries(st.map((x) => [x.id, x.status]))).toEqual({ [same]: 'approved', [changed]: 'edited' });
  });

  it('3 · a guard trip on a reply rewritten clean is not counted; one on the final reply is; one from before R1 is', async () => {
    const { loadCapabilityEvidence } = await import('../../src/pipeline/capability.js');
    const before = (await withBiz((tx) => loadCapabilityEvidence(tx, 'recommend'))).policyViolations;
    const ev = (payload: object) => withBiz((tx) => sql`insert into conversation_events (business_id, conversation_id, type, payload)
      values (${BIZ}, ${CONV}, 'guard_violation', ${JSON.stringify({ capability: 'recommend', count: 1, ...payload })}::jsonb)`.execute(tx));
    await ev({ final: false });
    expect((await withBiz((tx) => loadCapabilityEvidence(tx, 'recommend'))).policyViolations).toBe(before);
    await ev({ final: true });
    await ev({});
    expect((await withBiz((tx) => loadCapabilityEvidence(tx, 'recommend'))).policyViolations).toBe(before + 2);
  });

  it('4 · the owner\'s revoke does not reset the window; the system\'s demotion does', async () => {
    const { loadCapabilityEvidence, demotedSince } = await import('../../src/pipeline/capability.js');
    const id = await draft('greet', 'Hello!');
    await withBiz((tx) => sql`update drafts set status = 'approved', decided_at = now() - interval '1 minute' where id = ${id}::uuid`.execute(tx));
    await withBiz((tx) => sql`insert into capability_events (business_id, capability, action, from_mode, to_mode, reasons, actor)
      values (${BIZ}, 'greet', 'pause', 'auto', 'draft', array['owner_revoked'], 'owner')`.execute(tx));
    expect(await withBiz((tx) => demotedSince(tx, 'greet'))).toBeNull();
    expect((await withBiz((tx) => loadCapabilityEvidence(tx, 'greet'))).handled).toBe(1);
    await withBiz((tx) => sql`insert into capability_events (business_id, capability, action, from_mode, to_mode, reasons, actor)
      values (${BIZ}, 'greet', 'pause', 'auto', 'draft', array['failed_spot_check'], 'system_self_demoted')`.execute(tx));
    expect((await withBiz((tx) => loadCapabilityEvidence(tx, 'greet'))).handled).toBe(0);
  });

  it('5 · one spot-check correction is counted once: it does not demote alone; a second does', async () => {
    const { answerSpotCheck } = await import('../../src/pipeline/spotChecks.js');
    await withBiz((tx) => sql`insert into autonomy_policy (business_id, capability, mode) values (${BIZ}, 'quote', 'auto')
      on conflict (business_id, capability) do update set mode = 'auto'`.execute(tx));
    const ask = () => withBiz(async (tx) => (await sql<{ id: string }>`insert into spot_checks (business_id, conversation_id, capability, work_ref)
      values (${BIZ}, ${CONV}, 'quote', ${randomUUID()}) returning id::text as id`.execute(tx)).rows[0]!.id);
    const first = await withBiz(async (tx) => answerSpotCheck(tx, BIZ, await ask(), 'The price should be 12 a piece'));
    expect(first).toMatchObject({ verdict: 'needs_improvement', demoted: false });
    const second = await withBiz(async (tx) => answerSpotCheck(tx, BIZ, await ask(), 'Wrong size chart again'));
    expect(second).toMatchObject({ verdict: 'needs_improvement', demoted: true });
  });
});
