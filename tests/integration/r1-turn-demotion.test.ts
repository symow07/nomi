import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * R1 in the turn, BOTH WAYS, over Postgres (the owner, on #346: "Prove the other direction still works: a genuine
 * violation that was NOT cleanly rewritten must still withdraw the capability… A guard that never demotes is as bad as
 * one that demotes on everything"). Real repos, the real `autonomy_policy` row and `capability_events`; only the model
 * is faked. Each case its own workspace, every capability on auto, so the only thing that moves a capability is this
 * turn.
 *
 *   · a forbidden word caught and rewritten clean: sent; the capability stays on auto;
 *   · an Arabic gendered word caught and rewritten neutral: sent; stays on auto;
 *   · the forbidden word written twice (the kept reply failed): withdrawn — draft, and her own event saying so;
 *   · Arabic gendered twice and handed to a person (0158): withdrawn the same way.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const FORBIDDEN = 'Guangzhou Textile';
const CAPS = ['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up'] as const;

d('R1 in the turn: a clean rewrite keeps the capability, a failed one withdraws it (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let db: import('../../src/db/client.js').Db;
  let n = 0;

  const as = async <T>(biz: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };

  /** A fresh workspace, every capability on auto, a forbidden word; one real turn whose writer says `replies`. */
  const run = async (lang: 'en' | 'ar', text: string, replies: string[]) => {
    const biz = `dd770000-0000-4000-8000-${RUN}${String(++n).padStart(4, '0')}`;
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { hybridRetriever } = await import('../../src/retrieval/hybrid.js');
    const { computeTurn, commitTurn } = await import('../../src/pipeline/turn.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    const conv = await as(biz, async (t) => {
      await sql`insert into businesses (id, name, engine) values (${biz}, ${`R1 ${RUN} ${n}`}, 'service')`.execute(t);
      for (const cap of CAPS) {
        await sql`insert into autonomy_policy (business_id, capability, mode) values (${biz}, ${cap}, 'auto')
                  on conflict (business_id, capability) do update set mode = 'auto'`.execute(t);
      }
      await sql`insert into forbidden_terms (business_id, term) values (${biz}, ${FORBIDDEN})`.execute(t);
      await sql`insert into assistants (business_id, name, is_default) values (${biz}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${biz}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
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
    const req = { conversationId: conv as never, messageId: `r1-${randomUUID()}`, text };
    const { r, fx } = await as(biz, async (t) => {
      const ports = { tenant: tenantRepos(t, b.value), retriever: hybridRetriever(t, b.value), analyzer, replyWriter: writer, now: () => new Date() };
      const r = await computeTurn(ports, req);
      const fx = await commitTurn(ports, req, r, Date.now());
      return { r, fx };
    });
    // The capability the reply was written under, as the turn recorded it with the violation.
    const after = await as(biz, async (t) => {
      const violation = (await sql<{ payload: { final?: boolean; capability?: string } }>`select payload from conversation_events
        where conversation_id = ${conv}::uuid and type = 'guard_violation'`.execute(t)).rows[0]?.payload;
      const capability = violation?.capability ?? '';
      return {
        capability, violation,
        mode: (await sql<{ mode: string }>`select mode from autonomy_policy where business_id = ${biz} and capability = ${capability}`
          .execute(t)).rows[0]?.mode,
        events: (await sql<{ action: string; actor: string }>`select action, actor from capability_events
          where business_id = ${biz}`.execute(t)).rows,
      };
    });
    return { r, fx, ...after };
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
  });
  afterAll(async () => { await db?.destroy(); });

  it('a forbidden word caught and rewritten clean: sent — the capability stays on auto, no event', async () => {
    const x = await run('en', 'do you make bags?', [`We work with ${FORBIDDEN}.`, 'Yes, we make bags.']);
    expect(x.fx.outbound?.reply).toContain('Yes, we make bags.');
    expect(x.violation).toMatchObject({ final: false });
    expect(x.mode).toBe('auto');
    expect(x.events).toEqual([]);
  });

  it('an Arabic gendered word caught and rewritten neutral: sent — stays on auto', async () => {
    const x = await run('ar', 'أريد حقيبة قماش', ['هل تبحث عن مقاس معين؟', 'هل هناك مقاس معين مطلوب؟']);
    expect(x.fx.outbound?.reply).toContain('هل هناك مقاس معين مطلوب؟');
    expect(x.violation).toMatchObject({ final: false });
    expect(x.mode).toBe('auto');
    expect(x.events).toEqual([]);
  });

  it('THE OTHER DIRECTION — the forbidden word written twice: withdrawn to draft, and she says so', async () => {
    const x = await run('en', 'do you make bags?', [`We work with ${FORBIDDEN}.`, `${FORBIDDEN} makes them.`]);
    expect(x.r.hold).toBe('guards_failed_twice');
    expect(x.violation).toMatchObject({ final: true });
    expect(x.mode).toBe('draft');
    expect(x.events).toEqual([{ action: 'withdraw', actor: 'system_self_demoted' }]);
  });

  it('THE OTHER DIRECTION — Arabic gendered twice and handed to a person: withdrawn the same way', async () => {
    const x = await run('ar', 'أريد حقيبة قماش', ['هل تبحث عن مقاس معين؟', 'هل تحب تشوف الموديلات؟']);
    expect(x.r.signals.map((s) => s.kind)).toContain('address_unwritten');
    expect(x.violation).toMatchObject({ final: true });
    expect(x.mode).toBe('draft');
    expect(x.events).toEqual([{ action: 'withdraw', actor: 'system_self_demoted' }]);
  });
});
