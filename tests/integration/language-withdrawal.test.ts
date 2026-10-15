import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * 0163 — A WITHDRAWAL IS NARROWED TO THE LANGUAGE IT HAPPENED IN (the owner, 2026-10-15: "Narrow it to the language
 * it happened in… Leave the earned-rung part alone for now.").
 *
 * One workspace, every capability on auto, real repos and the real send decision; only the model is faked. An Arabic
 * reply that could not be written without a gender (twice) withdraws its capability for Arabic ONLY:
 *
 *   · the policy stays as the owner set it, the withdrawal is written for (capability, 'ar'), and the system's own
 *     event names the language;
 *   · an English buyer, the same capability, is answered alone as before;
 *   · the next Arabic buyer waits for the owner, with the reason on the draft;
 *   · the alert and Today name the language;
 *   · the owner choosing the level again lifts it, and Arabic goes alone again;
 *   · a reply whose language nobody could tell withdraws the capability everywhere, as before.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const CAPS = ['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up'] as const;
const FORBIDDEN = 'Guangzhou Textile';
const GENDERED_TWICE = ['هل تبحث عن مقاس معين؟', 'هل تحب تشوف الموديلات؟'];

d('0163 · a withdrawal is narrowed to the language it happened in (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 180_000 }, () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let n = 0;

  const as = async <T>(biz: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };

  /** A fresh workspace: every capability on auto, a forbidden word, a confirmed name. */
  const workspace = async (): Promise<string> => {
    const biz = `dd163000-0000-4000-8000-${RUN}${String(++n).padStart(4, '0')}`;
    await as(biz, async (t) => {
      await sql`insert into businesses (id, name, engine) values (${biz}, ${`Withdraw ${RUN} ${n}`}, 'service')`.execute(t);
      for (const cap of CAPS) {
        await sql`insert into autonomy_policy (business_id, capability, mode) values (${biz}, ${cap}, 'auto')
                  on conflict (business_id, capability) do update set mode = 'auto'`.execute(t);
      }
      await sql`insert into forbidden_terms (business_id, term) values (${biz}, ${FORBIDDEN})`.execute(t);
      await sql`insert into assistants (business_id, name, is_default) values (${biz}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${biz}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
    });
    return biz;
  };

  /** One real turn from a new buyer in `lang`, whose writer says `replies`. */
  const turn = async (biz: string, lang: string, text: string, replies: string[]) => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { hybridRetriever } = await import('../../src/retrieval/hybrid.js');
    const { computeTurn, commitTurn } = await import('../../src/pipeline/turn.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    const conv = await as(biz, async (t) => {
      const client = (await sql<{ id: string }>`insert into clients (business_id, phone, display_name)
        values (${biz}, ${`+9665${Math.floor(Math.random() * 9e7 + 1e7)}`}, 'Buyer') returning id::text as id`.execute(t)).rows[0]!.id;
      return (await tenantRepos(t, b.value).conversations.create(client as never, 'whatsapp')).conversationId;
    });
    const analyzer = new FakeAnalyzer();
    analyzer.next = {
      language: { detected: lang, replyIn: lang },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification', wantsPerson: false,
    };
    const writer = new FakeReplyWriter();
    writer.replies = replies;
    const req = { conversationId: conv as never, messageId: `lw-${randomUUID()}`, text };
    const { fx } = await as(biz, async (t) => {
      const ports = { tenant: tenantRepos(t, b.value), retriever: hybridRetriever(t, b.value), analyzer, replyWriter: writer, now: () => new Date() };
      const r = await computeTurn(ports, req);
      return { fx: await commitTurn(ports, req, r, Date.now()) };
    });
    const events = await as(biz, (t) => sql<{ type: string; payload: Record<string, unknown> }>`
      select type, payload from conversation_events where conversation_id = ${conv}::uuid order by created_at, id`.execute(t)
      .then((x) => x.rows));
    // The card reads the draft's `withheld` from the `draft_pending` event the turn wrote beside it (inbox.ts).
    const draft = await as(biz, (t) => sql<{ capability: string; pending: Record<string, unknown> | null }>`
      select d.capability,
             (select e.payload from conversation_events e
               where e.conversation_id = d.conversation_id and e.type = 'draft_pending' and e.payload->>'draftId' = d.id::text
               order by e.id desc limit 1) as pending
        from drafts d where d.conversation_id = ${conv}::uuid`.execute(t).then((x) => x.rows[0] ?? null));
    return { conv, fx, events, draft };
  };

  const state = (biz: string) => as(biz, async (t) => ({
    modes: Object.fromEntries((await sql<{ capability: string; mode: string }>`
      select capability, mode from autonomy_policy where business_id = ${biz}`.execute(t)).rows.map((r) => [r.capability, r.mode])),
    open: (await sql<{ capability: string; language: string; reasons: string[] }>`
      select capability, language, reasons from language_withdrawals where business_id = ${biz} and lifted_at is null
       order by capability, language`.execute(t)).rows,
    events: (await sql<{ capability: string; action: string; actor: string; language: string | null }>`
      select capability, action, actor, language from capability_events where business_id = ${biz} order by at, id`.execute(t)).rows,
  }));

  /** The five-minute claim, for this workspace only, in a transaction rolled back: other files' alerts stay untold. */
  const claimed = async (biz: string) => {
    await admin.query('begin');
    try {
      return (await admin.query(`select capabilities, reasons, narrowed, everywhere from claim_self_demotions() where business_id = $1`, [biz])).rows;
    } finally { await admin.query('rollback'); }
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
  });
  afterAll(async () => { await admin?.end(); await db?.destroy(); });

  it('an Arabic reply gendered twice withdraws its capability in Arabic only — English is answered alone, Arabic waits', async () => {
    const biz = await workspace();
    const first = await turn(biz, 'ar', 'أريد حقيبة قماش', GENDERED_TWICE);
    const cap = first.events.find((e) => e.type === 'guard_violation')?.payload['capability'] as string;
    expect(cap).toBeTruthy();
    const s = await state(biz);
    expect(s.modes[cap]).toBe('auto');                                  // the owner's setting is untouched
    expect(s.open).toEqual([{ capability: cap, language: 'ar', reasons: expect.any(Array) }]);
    expect(s.events).toEqual([{ capability: cap, action: 'withdraw', actor: 'system_self_demoted', language: 'ar' }]);

    // English, the same capability: alone, as the owner chose.
    const en = await turn(biz, 'en', 'do you make bags?', ['Yes, we make bags. What size do you need?']);
    expect(en.events.find((e) => e.type === 'guard_violation')).toBeUndefined();
    expect(en.fx.outbound?.reply).toContain('Yes, we make bags.');
    expect(en.draft).toBeNull();

    // The next Arabic buyer: a clean reply, and still it waits — with the reason on the draft.
    const ar = await turn(biz, 'ar', 'هل عندكم حقائب قماش؟', ['نعم، لدينا حقائب قماش بعدة مقاسات.']);
    expect(ar.fx.outbound ?? null).toBeNull();
    expect(ar.draft?.capability).toBe(cap);
    expect(ar.events.find((e) => e.type === 'autonomy_withheld')?.payload).toMatchObject({ capability: cap, reason: 'language_withdrawn', language: 'ar' });
    expect(ar.draft?.pending?.['withheld']).toMatchObject({ reason: 'language_withdrawn', language: 'ar' });

    // A second failure in Arabic while one stands writes nothing more.
    await turn(biz, 'ar', 'أريد حقيبة قماش كبيرة', GENDERED_TWICE);
    expect((await state(biz)).events).toHaveLength(1);
  });

  it('the alert and Today name the language; the owner choosing the level again lifts it, and Arabic goes alone again', async () => {
    const biz = await workspace();
    const first = await turn(biz, 'ar', 'أريد حقيبة قماش', GENDERED_TWICE);
    const cap = first.events.find((e) => e.type === 'guard_violation')?.payload['capability'] as string;

    const rows = await claimed(biz);
    expect(rows).toEqual([{ capabilities: [cap], reasons: expect.any(Array), narrowed: [`${cap}:ar`], everywhere: [] }]);
    const { renderOwnerAlert } = await import('../../src/pipeline/notify.js');
    const { capabilityName } = await import('../../src/core/owner/i18n/messages.js');
    const text = renderOwnerAlert('en', 'self_demoted', null, { demoted: rows[0] });
    expect(text).toContain(`${capabilityName('en', cap)}, in Arabic`);
    expect(text).toMatch(/Every other language goes on as before/);
    expect(renderOwnerAlert('zh', 'self_demoted', null, { demoted: rows[0] })).toContain('阿拉伯语');

    const { loadOperationsSnapshot } = await import('../../src/api/web/operations.js');
    expect((await loadOperationsSnapshot(db, biz, 'today')).supervision?.demoted).toEqual([`${cap}:ar`]);

    const { loadEmployee } = await import('../../src/api/web/employee.js');
    const e = await loadEmployee(db, biz);
    expect(e.stepped).toEqual([expect.objectContaining({ capability: cap, language: 'ar', open: true })]);

    const { chooseAutonomyLevel } = await import('../../src/pipeline/capability.js');
    expect((await chooseAutonomyLevel(db, biz, 'sells', 'owner-test')).ok).toBe(true);
    expect((await state(biz)).open).toEqual([]);
    const lifted = await as(biz, (t) => sql<{ lifted_by: string | null }>`
      select lifted_by from language_withdrawals where business_id = ${biz}`.execute(t).then((x) => x.rows));
    expect(lifted).toEqual([{ lifted_by: 'owner-test' }]);
    expect((await loadEmployee(db, biz)).stepped).toEqual([]);
    expect((await loadOperationsSnapshot(db, biz, 'today')).supervision?.demoted).toEqual([]);

    const ar = await turn(biz, 'ar', 'هل عندكم حقائب قماش؟', ['نعم، لدينا حقائب قماش بعدة مقاسات.']);
    expect(ar.fx.outbound?.reply).toContain('نعم، لدينا حقائب قماش بعدة مقاسات.');
  });

  it('a reply whose language nobody could tell steps back everywhere, as before', async () => {
    const biz = await workspace();
    const x = await turn(biz, 'und', '👍👍', [`We work with ${FORBIDDEN}.`, `${FORBIDDEN} makes them.`]);
    const cap = x.events.find((e) => e.type === 'guard_violation')?.payload['capability'] as string;
    const s = await state(biz);
    expect(s.modes[cap]).toBe('draft');
    expect(s.open).toEqual([]);
    expect(s.events).toEqual([{ capability: cap, action: 'withdraw', actor: 'system_self_demoted', language: null }]);
  });
});
