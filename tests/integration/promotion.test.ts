import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * M34.7 — a capability can actually be promoted, in a tenant that is not the
 * demo seed.
 *
 * THE DEFECT THIS PINS. `PROMOTION_REQUIREMENTS` demands 2–4 passed spot checks
 * for every capability. `loadCapabilityEvidence` counts `spot_checks` rows. The
 * only INSERT into `spot_checks` in the entire repo was `demo/trust.ts` — the
 * seed. So `spotChecksPassed` was permanently 0 in every real factory, no
 * capability could ever be promoted, and the "passed a spot check" condition on
 * /app/employee could only ever read false. The demo factory passed because it
 * seeded its own history, which is exactly how this survived a year.
 *
 * WHY THIS TEST IS HERE AND NOT IN tests/parity/. Spot checks are ROWS,
 * promotion is a COUNT over rows, and the whole defect was that nothing wrote
 * them. A promotion test on in-memory fakes passes while the product is broken —
 * that is not a hypothetical, it is what the parity suite did for a year. This
 * runs against real Postgres, as the real `nomi_app` role, so RLS, the grants,
 * and the CHECK constraints are all on trial too.
 *
 * It drives the PRODUCTION CALLERS: `applyOwnerCommand` (which is what creates
 * checks when work completes) and the route service `answerSpotCheck`. Nothing
 * here inserts a spot check by hand — that would prove only that the table
 * accepts rows, which was never in doubt.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

// A tenant of its own, deliberately NOT the demo factory: the demo seeds a
// spot-check history, and a test that inherited it would prove nothing.
// A FRESH tenant per run, rather than one that is cleaned between runs: the
// application role holds no DELETE (archive-never-erase), so a test that tidied
// up after itself would be a test running with privileges production does not
// have. Provisioning is the honest way to get a clean slate here.
const RUN = randomUUID().slice(0, 8);
const BIZ = `aa340700-0000-4000-8000-${RUN}0001`;
const CLIENT = `aa340700-0000-4000-8000-${RUN}0002`;
const CONV = `aa340700-0000-4000-8000-${RUN}0003`;
const CAP = 'greet';   // minSpotChecksPassed 2, minHandled 15, minDaysSupervised 5

d('M34.7 · promotion is reachable by a real tenant (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let withTenantTx: typeof import('../../src/db/client.js').withTenantTx;
  let applyOwnerCommand: typeof import('../../src/pipeline/approve.js').applyOwnerCommand;
  let answerSpotCheck: typeof import('../../src/pipeline/spotChecks.js').answerSpotCheck;
  let loadPendingSpotChecks: typeof import('../../src/pipeline/spotChecks.js').loadPendingSpotChecks;
  let loadCapabilityEvidence: typeof import('../../src/pipeline/capability.js').loadCapabilityEvidence;
  let promotionDecision: typeof import('../../src/core/trust/evidence.js').promotionDecision;
  let loadEmployee: typeof import('../../src/api/web/employee.js').loadEmployee;
  let bid: import('../../src/core/types/ids.js').BusinessId;

  const withBiz = <T,>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> =>
    withTenantTx(db, bid, fn);

  const decide = () => promotionDecision(
    // read inside a tenant tx, like the employee page does
    evidence!,
  );
  let evidence: Awaited<ReturnType<typeof loadCapabilityEvidence>> | null = null;
  const refreshEvidence = async () => {
    evidence = await withBiz((tx) => loadCapabilityEvidence(tx, CAP));
    return evidence;
  };

  beforeAll(async () => {
    const clientMod = await import('../../src/db/client.js');
    withTenantTx = clientMod.withTenantTx;
    db = clientMod.createDb(DATABASE_URL!);
    ({ applyOwnerCommand } = await import('../../src/pipeline/approve.js'));
    ({ answerSpotCheck, loadPendingSpotChecks } = await import('../../src/pipeline/spotChecks.js'));
    ({ loadCapabilityEvidence } = await import('../../src/pipeline/capability.js'));
    ({ promotionDecision } = await import('../../src/core/trust/evidence.js'));
    ({ loadEmployee } = await import('../../src/api/web/employee.js'));
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const p = parseBusinessId(BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;

    await withBiz(async (tx) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Promotion Test Factory') on conflict (id) do nothing`.execute(tx);
      await sql`insert into clients (id, business_id, display_name) values (${CLIENT}, ${BIZ}, 'Test Buyer') on conflict (id) do nothing`.execute(tx);
      await sql`insert into conversations (id, business_id, client_id, channel) values (${CONV}, ${BIZ}, ${CLIENT}, 'whatsapp') on conflict (id) do nothing`.execute(tx);
      // Migration 0009 seeds autonomy_policy for businesses that existed when it
      // ran; a tenant created afterwards needs its own row. Fully draft, which
      // is the product's default: trust is earned, not granted at signup.
      await sql`insert into autonomy_policy (business_id, capability) values (${BIZ}, ${CAP})
                on conflict (business_id, capability) do nothing`.execute(tx);
    });
  }, 60_000);

  afterAll(async () => { await db?.destroy(); });

  /** One pending draft, backdated so daysSupervised can be satisfied honestly. */
  async function pendingDraft(text: string, ageDays: number): Promise<string> {
    return withBiz(async (tx) => {
      const r = await sql<{ id: string }>`
        insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status, created_at)
        values (${BIZ}, ${CONV}, ${CAP}, ${text}, null, 'pending', now() - make_interval(days => ${ageDays}))
        returning id`.execute(tx);
      return r.rows[0]!.id;
    });
  }

  const deps = () => ({
    db, now: () => new Date(),
    kickOutbound: async () => {},
  });

  it('starts unpromotable, and says the missing thing is spot checks', async () => {
    const e = await refreshEvidence();
    expect(e.handled).toBe(0);
    expect(e.spotChecksPassed).toBe(0);
    const decision = decide();
    // Narrowed rather than asserted through: `gaps` exists only on the
    // ineligible branch, and reaching for it unnarrowed is how this test first
    // failed while the code under it was correct.
    if (decision.eligible) throw new Error('expected the capability to start unpromotable');
    expect(decision.gaps).toContain('more_spot_checks');
  });

  it('approving real work creates spot checks — the producer that did not exist', async () => {
    // 16 approvals, aged so minDaysSupervised (5) is met by real elapsed time
    // rather than by a backdated verdict.
    for (let i = 0; i < 16; i++) {
      const id = await pendingDraft(`Hello — how can we help? (${i})`, 20);
      const r = await applyOwnerCommand(deps(), {
        businessId: bid, draftId: id, rawReply: '发送', decidedBy: 'owner',
      });
      expect(r.outcome).toBe('sent');
    }

    const e = await refreshEvidence();
    expect(e.handled).toBe(16);
    expect(e.approvedNoEdit).toBe(16);

    // THE ASSERTION THIS MILESTONE EXISTS FOR: rows appeared, and no test wrote
    // them — applyOwnerCommand did.
    const pending = await withBiz((tx) => loadPendingSpotChecks(tx, BIZ));
    expect(pending.length).toBeGreaterThan(0);
    // The weekly budget is respected: this is a ritual, not a backlog.
    expect(pending.length).toBeLessThanOrEqual(3);
    // And each one shows the owner the actual work, not a reference to it.
    expect(pending[0]!.reply).toContain('how can we help');
    expect(pending[0]!.capability).toBe(CAP);
  });

  it('still unpromotable until the owner has actually answered them', async () => {
    const e = await refreshEvidence();
    expect(e.spotChecksPassed).toBe(0);          // asked ≠ passed
    const decision = decide();
    if (decision.eligible) throw new Error('asked-but-unanswered checks must not count');
    expect(decision.gaps).toContain('more_spot_checks');
  });

  it('the owner confirms the work in her own words, and the capability becomes promotable', async () => {
    const pending = await withBiz((tx) => loadPendingSpotChecks(tx, BIZ));
    expect(pending.length).toBeGreaterThanOrEqual(2);   // greet needs 2 passed

    for (const check of pending.slice(0, 2)) {
      const r = await withBiz((tx) => answerSpotCheck(tx, BIZ, check.id, '好'));
      // M34.9 added `demoted` to this result. Stated in full rather than
      // loosened to toMatchObject: a good verdict must never demote, and that
      // is worth asserting here as well as in demotion.test.ts.
      expect(r).toEqual({ answered: true, verdict: 'correct', demoted: false });
    }

    const e = await refreshEvidence();
    expect(e.spotChecksPassed).toBeGreaterThanOrEqual(2);

    // The whole point: unpromotable → promotable, because the owner confirmed
    // real work she had already approved. Nothing was seeded.
    // (`gaps` only exists on the ineligible branch of the union — asserting on
    //  it directly is how this test first failed while the feature worked.)
    const decision = decide();
    expect(decision.eligible, decision.eligible ? '' : `still blocked by: ${decision.gaps.join(', ')}`).toBe(true);
  });

  it('the badge on the employee page can now read true', async () => {
    const profile = await loadEmployee(db, BIZ);
    const cond = profile.conditions.find((c) => c.cond === 'passed_spotcheck');
    expect(cond?.met).toBe(true);
    // and the page offers the promotion, which is the owner's to take
    expect(profile.capabilities.find((c) => c.capability === CAP)?.promotable).toBe(true);
  });

  it('answering twice changes nothing — a double submit is not a second verdict', async () => {
    const answered = await withBiz((tx) => sql<{ id: string }>`
      select id from spot_checks where business_id = ${BIZ} and answered_at is not null limit 1
    `.execute(tx).then((r) => r.rows[0]!.id));
    const again = await withBiz((tx) => answerSpotCheck(tx, BIZ, answered, '有问题'));
    expect(again.answered).toBe(false);
    const verdict = await withBiz((tx) => sql<{ verdict: string }>`
      select verdict from spot_checks where id = ${answered}`.execute(tx).then((r) => r.rows[0]!.verdict));
    expect(verdict).toBe('correct');   // the first answer stands
  });

  it('a correction is recorded as one, and does not count as a pass', async () => {
    const id = await pendingDraft('We ship anywhere, no problem.', 20);
    await applyOwnerCommand(deps(), { businessId: bid, draftId: id, rawReply: '发送', decidedBy: 'owner' });
    const pending = await withBiz((tx) => loadPendingSpotChecks(tx, BIZ));
    if (pending.length === 0) return;   // weekly budget already spent; nothing to assert

    const before = (await refreshEvidence()).spotChecksPassed;
    const r = await withBiz((tx) => answerSpotCheck(tx, BIZ, pending[0]!.id, '应该先问清楚他要发到哪个国家'));
    expect(r.verdict).toBe('needs_improvement');
    const after = (await refreshEvidence()).spotChecksPassed;
    expect(after).toBe(before);

    const row = await withBiz((tx) => sql<{ correction: string | null }>`
      select correction from spot_checks where id = ${pending[0]!.id}`.execute(tx).then((x) => x.rows[0]!));
    expect(row.correction).toBe('应该先问清楚他要发到哪个国家');
  });

  it('another tenant sees none of it — the checks are tenant-scoped like everything else', async () => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const other = parseBusinessId('de300000-0000-4000-8000-0000000000b1');
    if (!other.ok) throw new Error('fixture');
    const mine = await withBiz((tx) => sql<{ n: number }>`
      select count(*)::int as n from spot_checks`.execute(tx).then((r) => r.rows[0]!.n));
    const theirs = await withTenantTx(db, other.value, (tx) => sql<{ n: number }>`
      select count(*)::int as n from spot_checks where work_ref in
        (select id::text from drafts where business_id = ${BIZ})`.execute(tx).then((r) => r.rows[0]!.n));
    expect(mine).toBeGreaterThan(0);
    expect(theirs).toBe(0);
  });
});
