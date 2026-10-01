import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * R2 — THE RAMP, OVER POSTGRES. A workspace that signed itself up earns rung 1
 * from drafts decided for real customers: the stamp lands in the transaction
 * of the decision that earns it; the gate then lets talks through and keeps
 * prices waiting; a conversation marked "me testing" counts toward nothing;
 * the system's own demotion takes the rung away again.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);

d('R2 · the ramp (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let bid: import('../../src/core/types/ids.js').BusinessId;
  let BIZ = '';
  let OWNER = '';
  let STAFF = '';
  const convs: string[] = [];
  const q = (text: string, args: unknown[]) => admin.query(text, args);
  const withBiz = async <T,>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>) =>
    (await import('../../src/db/client.js')).withTenantTx(db, bid, fn);
  /** A draft decided `daysAgo` for customer `i`, by `actor`, as written or not. */
  const decided = async (i: number, daysAgo: number, actor: string, opts: { status?: string; text?: string; sent?: string; cap?: string } = {}) => {
    const text = opts.text ?? 'Yes, we have it.';
    const id = (await q(`insert into drafts (business_id, conversation_id, capability, draft_text, status, sent_text, created_at, decided_at)
      values ($1, $2, $3, $4, $5, $6, now() - make_interval(days => $7) - interval '1 minute', now() - make_interval(days => $7)) returning id::text as id`,
      [BIZ, convs[i], opts.cap ?? 'qualify', text, opts.status ?? 'approved', opts.sent ?? text, daysAgo])).rows[0].id;
    await q(`insert into conversation_events (business_id, conversation_id, type, payload, created_at) values ($1, $2, 'draft_resolved', $3, now() - make_interval(days => $4))`,
      [BIZ, convs[i], JSON.stringify({ draftId: id, status: opts.status ?? 'approved', actor }), daysAgo]);
    return id;
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const m = await import('../../src/db/client.js');
    db = m.createDb(DATABASE_URL!);
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const made = await provisionAccount(db, {
      factory: `R2 Studio ${RUN}`, language: 'en', ownerName: 'Ines', email: `r2-${RUN}@studio.example`,
      passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
      profile: { kind: 'agency', sells: 'design', country: 'AE', website: null, teamSize: '2-5', channels: [] },
    });
    if (made.code !== 'created') throw new Error(made.code);
    BIZ = made.businessId; OWNER = made.personId;
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const p = parseBusinessId(BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
    STAFF = (await q(`insert into people (business_id, name, is_owner) values ($1, 'Sam', false) returning id::text as id`, [BIZ])).rows[0].id;
    for (let i = 0; i < 6; i++) {
      const c = (await q(`insert into clients (business_id, display_name) values ($1, $2) returning id`, [BIZ, `Customer ${i}`])).rows[0].id;
      convs.push((await q(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'instagram') returning id::text as id`, [BIZ, c])).rows[0].id);
    }
    // The no-catalogue checklist complete, and the name confirmed.
    for (const item of ['price_handed', 'offer_answered', 'handed_over', 'bot_answered', 'person_handoff', 'stop_handoff']) {
      await q(`insert into practice_checks (business_id, item) values ($1, $2)`, [BIZ, item]);
    }
    await q(`insert into onboarding_state (business_id, assistant_named_at) values ($1, now()) on conflict (business_id) do update set assistant_named_at = now()`, [BIZ]);
  }, 60_000);
  afterAll(async () => { await admin?.end(); await db?.destroy(); });

  it('NOTHING YET: rung 0, and the counter says how far', async () => {
    const { rampState } = await import('../../src/db/ramp.js');
    const s = await withBiz((tx) => rampState(tx, bid));
    expect(s).toMatchObject({ gated: true, rung: 0, talks: { done: 0, of: 20 }, sells: null });
  });

  it('A CONVERSATION MARKED "ME TESTING" counts toward nothing', async () => {
    const { rampState } = await import('../../src/db/ramp.js');
    await q(`update conversations set owner_testing = true where id = $1`, [convs[5]]);
    for (let k = 0; k < 5; k++) await decided(5, k, OWNER);
    expect((await withBiz((tx) => rampState(tx, bid))).talks.done).toBe(0);
  });

  it('RUNG 1 IS STAMPED by the decision that earns it — staff decisions count — and the gate opens for talks only', async () => {
    const { applyOwnerCommand } = await import('../../src/pipeline/approve.js');
    const { earnedRung } = await import('../../src/db/ramp.js');
    // 19 decided over 5 customers and 3 days, 2 of them edited, some by staff.
    for (let k = 0; k < 19; k++) {
      await decided(k % 5, 1 + (k % 3), k % 4 === 0 ? STAFF : OWNER,
        k < 2 ? { status: 'edited', sent: 'Yes — we do have it in stock.' } : {});
    }
    expect(await withBiz((tx) => earnedRung(tx))).toBe(0);
    const twentieth = (await q(`insert into drafts (business_id, conversation_id, capability, draft_text) values ($1, $2, 'greet', 'Hello!') returning id::text as id`, [BIZ, convs[0]])).rows[0].id;
    const r = await applyOwnerCommand({ db, now: () => new Date(), kickOutbound: async () => {} },
      { businessId: bid, draftId: twentieth, rawReply: '发送', decidedBy: OWNER });
    expect(r.outcome).toBe('sent');
    const b = (await q(`select talks_earned_at, sells_earned_at, auto_earned_by from businesses where id = $1`, [BIZ])).rows[0];
    expect(b.talks_earned_at).not.toBeNull();
    expect(b.sells_earned_at).toBeNull();
    expect(b.auto_earned_by).toBe('ramp');
    expect(await withBiz((tx) => earnedRung(tx))).toBe(1);
  });

  it('THE SYSTEM\'S DEMOTION of a talks capability takes the rung away, to be earned again', async () => {
    const { autoDemote } = await import('../../src/pipeline/capability.js');
    const { earnedRung } = await import('../../src/db/ramp.js');
    await q(`insert into autonomy_policy (business_id, capability, mode) values ($1, 'greet', 'auto') on conflict (business_id, capability) do update set mode = 'auto'`, [BIZ]);
    const out = await withBiz((tx) => autoDemote(tx, BIZ, 'greet', { action: 'pause', reasons: ['failed_spot_check'] }, {} as never));
    expect(out.demoted).toBe(true);
    expect(await withBiz((tx) => earnedRung(tx))).toBe(0);
    expect((await q(`select talks_earned_at, auto_earned_at from businesses where id = $1`, [BIZ])).rows[0]).toEqual({ talks_earned_at: null, auto_earned_at: null });
  });
});
