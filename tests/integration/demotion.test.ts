import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * M34.9 — the ladder comes down on its own.
 *
 * TRUST-PLAYBOOK.md described auto-revoke: any guard fires in auto mode, that
 * capability drops to draft, and she says so. `demotionDecision` and
 * `applySpotCheck` had sat in core/trust/evidence.ts since M5 with no caller.
 *
 * Until M34.7 that was harmless, because nothing could be promoted and so
 * nothing could need demoting. Promotion works now, which makes a one-way
 * ladder a live defect: automatic demotion matters precisely when a guard has
 * fired in AUTO mode, which is the one moment nobody is watching.
 *
 * Rows again, so this is an integration test again. `policyViolations` was
 * hardcoded to 0 in loadCapabilityEvidence — a demotion test on fakes would
 * have passed against that for as long as anyone cared to look.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `bb340900-0000-4000-8000-${RUN}0001`;
const CLIENT = `bb340900-0000-4000-8000-${RUN}0002`;
const CONV = `bb340900-0000-4000-8000-${RUN}0003`;
const CAP = 'greet';

d('M34.9 · a capability demotes itself (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let withTenantTx: typeof import('../../src/db/client.js').withTenantTx;
  let loadCapabilityEvidence: typeof import('../../src/pipeline/capability.js').loadCapabilityEvidence;
  let autoDemote: typeof import('../../src/pipeline/capability.js').autoDemote;
  let answerSpotCheck: typeof import('../../src/pipeline/spotChecks.js').answerSpotCheck;
  let demotionDecision: typeof import('../../src/core/trust/evidence.js').demotionDecision;
  let promotionDecision: typeof import('../../src/core/trust/evidence.js').promotionDecision;
  let tenantRepos: typeof import('../../src/db/repos.js').tenantRepos;
  let bid: import('../../src/core/types/ids.js').BusinessId;

  const withBiz = <T,>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> =>
    withTenantTx(db, bid, fn);

  const modeOf = () => withBiz((tx) => sql<{ mode: string }>`
    select mode from autonomy_policy where business_id = ${BIZ} and capability = ${CAP}
  `.execute(tx).then((r) => r.rows[0]?.mode ?? null));

  const setMode = (mode: string) => withBiz((tx) => sql`
    insert into autonomy_policy (business_id, capability, mode) values (${BIZ}, ${CAP}, ${mode})
    on conflict (business_id, capability) do update set mode = ${mode}
  `.execute(tx).then(() => undefined));

  beforeAll(async () => {
    await seedRunTenant();
    const clientMod = await import('../../src/db/client.js');
    withTenantTx = clientMod.withTenantTx;
    db = clientMod.createDb(DATABASE_URL!);
    ({ loadCapabilityEvidence, autoDemote } = await import('../../src/pipeline/capability.js'));
    ({ answerSpotCheck } = await import('../../src/pipeline/spotChecks.js'));
    ({ demotionDecision, promotionDecision } = await import('../../src/core/trust/evidence.js'));
    ({ tenantRepos } = await import('../../src/db/repos.js'));
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const p = parseBusinessId(BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;

    await withBiz(async (tx) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Demotion Test Factory') on conflict (id) do nothing`.execute(tx);
      await sql`insert into clients (id, business_id, display_name) values (${CLIENT}, ${BIZ}, 'Buyer') on conflict (id) do nothing`.execute(tx);
      await sql`insert into conversations (id, business_id, client_id, channel) values (${CONV}, ${BIZ}, ${CLIENT}, 'whatsapp') on conflict (id) do nothing`.execute(tx);
      await sql`insert into autonomy_policy (business_id, capability, mode) values (${BIZ}, ${CAP}, 'auto')
                on conflict (business_id, capability) do update set mode = 'auto'`.execute(tx);
    });
  }, 60_000);

  afterAll(async () => { await db?.destroy(); });

  it('THE PRODUCTION CALLER: a guard firing in auto mode drops the capability to draft', async () => {
    expect(await modeOf()).toBe('auto');

    // Exactly what commitTurn does when r.guardViolations > 0 and the policy
    // mode is auto — through the repo, not by writing autonomy_policy by hand.
    const result = await withBiz(async (tx) => {
      const tenant = tenantRepos(tx, bid);
      await tenant.events.append(CONV as never, 'guard_violation', { capability: CAP, count: 1 });
      return tenant.autonomy.selfDemote({ capability: CAP, conversationId: CONV, violations: 1 });
    });

    expect(result.demoted).toBe(true);
    expect(result.action).toBe('withdraw');       // a guard violation is the severe branch
    expect(await modeOf()).toBe('draft');
  });

  it('she announces it, as herself, with a reason the owner can read', async () => {
    const ev = await withBiz((tx) => sql<{ action: string; actor: string; reasons: string[]; from_mode: string; to_mode: string }>`
      select action, actor, reasons, from_mode, to_mode from capability_events
       where business_id = ${BIZ} and capability = ${CAP} order by at desc limit 1
    `.execute(tx).then((r) => r.rows[0]!));
    expect(ev.actor).toBe('system_self_demoted');   // not 'owner' — she did this
    expect(ev.from_mode).toBe('auto');
    expect(ev.to_mode).toBe('draft');
    expect(ev.reasons).toContain('policy_violation');
  });

  it('MONOTONE: demotion can never grant authority, whatever the evidence says', async () => {
    // Every decision the model can produce, applied to a capability sitting in
    // draft. None of them may put it back into auto.
    await setMode('draft');
    for (const action of ['none', 'pause', 'return_to_learning', 'withdraw'] as const) {
      const evidence = await withBiz((tx) => loadCapabilityEvidence(tx, CAP));
      await withBiz((tx) => autoDemote(tx, BIZ, CAP, { action, reasons: ['policy_violation'] }, evidence));
      expect(await modeOf(), `action=${action}`).toBe('draft');
    }
  });

  it('FRESH EVIDENCE: everything earned before the demotion stops counting', async () => {
    // Work approved BEFORE the demotion, aged past minDaysSupervised.
    await withBiz(async (tx) => {
      for (let i = 0; i < 20; i++) {
        await sql`
          insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status, created_at, decided_at)
          values (${BIZ}, ${CONV}, ${CAP}, ${'old work ' + i}, null, 'approved',
                  now() - interval '30 days', now() - interval '30 days')`.execute(tx);
      }
      for (let i = 0; i < 3; i++) {
        await sql`
          insert into spot_checks (business_id, conversation_id, capability, work_ref, verdict, asked_at, answered_at)
          values (${BIZ}, ${CONV}, ${CAP}, ${'old-' + i}, 'correct',
                  now() - interval '29 days', now() - interval '29 days')`.execute(tx);
      }
    });

    // That history is worth a promotion on its own…
    const preDemotion = await withBiz((tx) => sql<{ n: number }>`
      select count(*)::int as n from drafts where business_id = ${BIZ} and capability = ${CAP}`
      .execute(tx).then((r) => r.rows[0]!.n));
    expect(preDemotion).toBeGreaterThanOrEqual(20);

    // …but every row of it predates the demotion recorded above, so none counts.
    const e = await withBiz((tx) => loadCapabilityEvidence(tx, CAP));
    expect(e.handled, 'work before the demotion must not count').toBe(0);
    expect(e.spotChecksPassed, 'spot checks before the demotion must not count').toBe(0);
    expect(e.daysSupervised).toBe(0);

    const decision = promotionDecision(e);
    expect(decision.eligible).toBe(false);
    if (!decision.eligible) expect(decision.gaps).toContain('more_cases');
  });

  it('a SERIOUS spot-check verdict demotes through the owner-facing path', async () => {
    await setMode('auto');
    const id = await withBiz((tx) => sql<{ id: string }>`
      insert into spot_checks (business_id, conversation_id, capability, work_ref, asked_at)
      values (${BIZ}, ${CONV}, ${CAP}, ${'sc-' + RUN}, now()) returning id
    `.execute(tx).then((r) => r.rows[0]!.id));

    // The owner presses "this one was wrong" — the same wire word the page posts.
    const r = await withBiz((tx) => answerSpotCheck(tx, BIZ, id, '有问题'));
    expect(r.verdict).toBe('serious');
    expect(r.demoted).toBe(true);
    expect(await modeOf()).toBe('draft');
  });

  it('a CORRECT verdict never promotes — the ladder only descends by itself', async () => {
    await setMode('draft');
    const id = await withBiz((tx) => sql<{ id: string }>`
      insert into spot_checks (business_id, conversation_id, capability, work_ref, asked_at)
      values (${BIZ}, ${CONV}, ${CAP}, ${'sc-ok-' + RUN}, now()) returning id
    `.execute(tx).then((r) => r.rows[0]!.id));
    const r = await withBiz((tx) => answerSpotCheck(tx, BIZ, id, '好'));
    expect(r.verdict).toBe('correct');
    expect(r.demoted).toBe(false);
    expect(await modeOf(), 'a good verdict must not grant authority').toBe('draft');
  });

  it('a capability already in draft is not demoted again — no noise in her timeline', async () => {
    const before = await withBiz((tx) => sql<{ n: number }>`
      select count(*)::int as n from capability_events where business_id = ${BIZ}`
      .execute(tx).then((r) => r.rows[0]!.n));
    const evidence = await withBiz((tx) => loadCapabilityEvidence(tx, CAP));
    const r = await withBiz((tx) => autoDemote(tx, BIZ, CAP, demotionDecision({ ...evidence, policyViolations: 5 }), evidence));
    expect(r.demoted).toBe(false);
    const after = await withBiz((tx) => sql<{ n: number }>`
      select count(*)::int as n from capability_events where business_id = ${BIZ}`
      .execute(tx).then((r) => r.rows[0]!.n));
    expect(after).toBe(before);
  });
});
