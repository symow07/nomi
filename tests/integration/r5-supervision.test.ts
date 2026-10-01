import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * R5 (0109) — SUPERVISION AFTER PROMOTION, OVER POSTGRES. Work sent alone is
 * offered for a spot check once it actually left (and by the daily sweep, for
 * every workspace that sent alone this week); a wrong price found by one
 * demotes the capability and takes the price rung, on the record as the
 * system's own; the owner is told of every such step back exactly once; the
 * level the owner chose is kept, and the page and Today read what changed.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);

d('R5 · supervision (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let bid: import('../../src/core/types/ids.js').BusinessId;
  let BIZ = '';
  let OWNER = '';
  let CONV = '';
  const q = (text: string, args: unknown[]) => admin.query(text, args);
  const tx = async <T,>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>) =>
    (await import('../../src/db/client.js')).withTenantTx(db, bid, fn);
  /** A reply sent alone, as commitTurn records it; `left` writes the sent message the outbound worker writes. */
  const autoSent = async (capability: string, body: string, left: boolean) => {
    const id = (await q(`insert into conversation_events (business_id, conversation_id, type, payload) values ($1, $2, 'auto_sent', $3) returning id::text as id`,
      [BIZ, CONV, JSON.stringify({ capability, messageId: `m-${randomUUID()}`, body })])).rows[0].id as string;
    if (left) {
      await q(`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at) values ($1, $2, 'outbound', 'text', $3, now())`,
        [CONV, `out:${randomUUID()}`, body]);
    }
    return id;
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const m = await import('../../src/db/client.js');
    db = m.createDb(DATABASE_URL!);
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const made = await provisionAccount(db, {
      factory: `R5 Rugs ${RUN}`, language: 'en', ownerName: 'Laila', email: `r5-${RUN}@rugs.example`,
      passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
      profile: { kind: 'online_shop', sells: 'rugs', country: 'AE', website: null, teamSize: '1', channels: [] },
    });
    if (made.code !== 'created') throw new Error(made.code);
    BIZ = made.businessId; OWNER = made.personId;
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const p = parseBusinessId(BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
    const c = (await q(`insert into clients (business_id, display_name) values ($1, 'Omar') returning id`, [BIZ])).rows[0].id;
    CONV = (await q(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'instagram') returning id::text as id`, [BIZ, c])).rows[0].id;
    // Earned all the way, quote sent alone.
    await q(`update businesses set talks_earned_at = now(), sells_earned_at = now(), auto_earned_at = now(), auto_earned_by = 'ramp' where id = $1`, [BIZ]);
    await q(`update autonomy_policy set mode = 'auto' where business_id = $1 and capability in ('greet', 'qualify', 'recommend', 'quote', 'negotiate')`, [BIZ]);
  }, 60_000);
  afterAll(async () => { await admin?.end(); await db?.destroy(); });

  it('THE LEVEL CHOSEN is kept, with when', async () => {
    const { chooseAutonomyLevel } = await import('../../src/pipeline/capability.js');
    expect((await chooseAutonomyLevel(db, BIZ, 'sells', OWNER)).ok).toBe(true);
    const b = (await q(`select autonomy_level_chosen, autonomy_level_chosen_at from businesses where id = $1`, [BIZ])).rows[0];
    expect(b.autonomy_level_chosen).toBe('sells');
    expect(b.autonomy_level_chosen_at).not.toBeNull();
  });

  it('WORK SENT ALONE is offered once it left; work that never left is not', async () => {
    const { ensureSpotChecks, loadPendingSpotChecks } = await import('../../src/pipeline/spotChecks.js');
    const left = await autoSent('quote', `That rug is $120.00 each. ${RUN}`, true);
    await autoSent('quote', `Never left ${RUN}`, false);
    expect(await tx((t) => ensureSpotChecks(t, BIZ))).toBe(1);
    const pending = await tx((t) => loadPendingSpotChecks(t, BIZ));
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ capability: 'quote', reply: `That rug is $120.00 each. ${RUN}`, wasAuto: true, conversationId: CONV });
    expect((await q(`select work_ref from spot_checks where business_id = $1`, [BIZ])).rows[0].work_ref).toBe(`auto:${left}`);
    // Never twice.
    expect(await tx((t) => ensureSpotChecks(t, BIZ))).toBe(0);
  });

  it('THE DAILY SWEEP reaches every workspace that sent alone this week', async () => {
    const { spotCheckSweep } = await import('../../src/pipeline/supervision.js');
    await autoSent('greet', `Hello! ${RUN}`, true);
    await spotCheckSweep(db);
    expect((await q(`select count(*)::int as n from spot_checks where business_id = $1`, [BIZ])).rows[0].n).toBe(2);
  });

  it('A WRONG PRICE: serious, the capability back to drafts, the price rung gone — the system\'s own step back', async () => {
    const { answerSpotCheck } = await import('../../src/pipeline/spotChecks.js');
    const check = (await q(`select id from spot_checks where business_id = $1 and capability = 'quote'`, [BIZ])).rows[0].id;
    const r = await tx((t) => answerSpotCheck(t, BIZ, check, 'It is $140 a rug, not $120'));
    expect(r).toMatchObject({ answered: true, verdict: 'serious', demoted: true });
    expect((await q(`select verdict from spot_checks where id = $1`, [check])).rows[0].verdict).toBe('serious');
    expect((await q(`select mode from autonomy_policy where business_id = $1 and capability = 'quote'`, [BIZ])).rows[0].mode).toBe('draft');
    const b = (await q(`select talks_earned_at, sells_earned_at from businesses where id = $1`, [BIZ])).rows[0];
    expect(b.sells_earned_at).toBeNull();
    expect(b.talks_earned_at).not.toBeNull();
    const ev = (await q(`select reasons, actor, alerted_at from capability_events where business_id = $1 and capability = 'quote' order by id desc limit 1`, [BIZ])).rows[0];
    expect(ev).toMatchObject({ reasons: ['wrong_price'], actor: 'system_self_demoted', alerted_at: null });
  });

  it('a wording correction on priced work changes no rung', async () => {
    const { answerSpotCheck, ensureSpotChecks } = await import('../../src/pipeline/spotChecks.js');
    await q(`update businesses set sells_earned_at = now() where id = $1`, [BIZ]);
    await q(`delete from spot_checks where business_id = $1 and answered_at is null`, [BIZ]);
    await autoSent('negotiate', `We can do 10% off. ${RUN}`, true);
    await tx((t) => ensureSpotChecks(t, BIZ));
    const check = (await q(`select id from spot_checks where business_id = $1 and capability = 'negotiate' and answered_at is null`, [BIZ])).rows[0].id;
    const r = await tx((t) => answerSpotCheck(t, BIZ, check, 'Say it more warmly'));
    expect(r.verdict).toBe('needs_improvement');
    expect((await q(`select sells_earned_at from businesses where id = $1`, [BIZ])).rows[0].sells_earned_at).not.toBeNull();
  });

  it('A WRONG PRICE on an approved draft, the capability already in drafts: the rung still goes, and it is on the record', async () => {
    const { answerSpotCheck } = await import('../../src/pipeline/spotChecks.js');
    const draft = (await q(`insert into drafts (business_id, conversation_id, capability, draft_text, status, sent_text, decided_at)
      values ($1, $2, 'quote', 'Two rugs: $240.', 'approved', 'Two rugs: $240.', now()) returning id::text as id`, [BIZ, CONV])).rows[0].id;
    const check = (await q(`insert into spot_checks (business_id, conversation_id, capability, work_ref, asked_at) values ($1, $2, 'quote', $3, now()) returning id`,
      [BIZ, CONV, draft])).rows[0].id;
    await tx((t) => answerSpotCheck(t, BIZ, check, '有问题'));
    expect((await q(`select sells_earned_at from businesses where id = $1`, [BIZ])).rows[0].sells_earned_at).toBeNull();
    expect((await q(`select count(*)::int as n from capability_events where business_id = $1 and capability = 'quote' and actor = 'system_self_demoted'`, [BIZ])).rows[0].n).toBe(2);
  });

  it('THE OWNER IS TOLD once: the sweep claims the step backs, and the next one finds nothing', async () => {
    const { demotionAlerts } = await import('../../src/pipeline/supervision.js');
    const jobs = (await demotionAlerts(db)).filter((j) => j.businessId === BIZ);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'self_demoted', conversationId: null, demoted: { capabilities: ['quote'], reasons: ['wrong_price'] } });
    expect((await demotionAlerts(db)).filter((j) => j.businessId === BIZ)).toHaveLength(0);
  });

  it('A PRACTICE COPY\'s step back is never an alert', async () => {
    const { demotionAlerts } = await import('../../src/pipeline/supervision.js');
    const COPY = randomUUID();
    await q(`insert into businesses (id, name, practice_of) values ($1, $2, $3)`, [COPY, `R5 practice ${RUN}`, BIZ]);
    await q(`insert into capability_events (business_id, capability, action, from_mode, to_mode, reasons, actor) values ($1, 'greet', 'pause', 'auto', 'draft', array['failed_spot_check'], 'system_self_demoted')`, [COPY]);
    expect((await demotionAlerts(db)).filter((j) => j.businessId === COPY)).toHaveLength(0);
    expect((await q(`select alerted_at from capability_events where business_id = $1`, [COPY])).rows[0].alerted_at).not.toBeNull();
  });

  it('THE PAGE AND TODAY read it: chose sells, quote waits since the wrong price, work to check', async () => {
    const { loadEmployee } = await import('../../src/api/web/employee.js');
    const e = await loadEmployee(db, BIZ);
    expect(e.chosen?.level).toBe('sells');
    expect(e.stepped?.find((x) => x.capability === 'quote')?.reasons).toContain('wrong_price');
    const { loadOperationsSnapshot } = await import('../../src/api/web/operations.js');
    const s = await loadOperationsSnapshot(db, BIZ, 'today');
    expect(s.supervision?.demoted).toContain('quote');
    expect(s.supervision?.spotChecks).toBeGreaterThanOrEqual(1);
  });
});
