import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * 0159 over Postgres (the owner, 2026-10-14: "If (b) fails, Arabic stays out"): the operator's tool holds Arabic in one
 * workspace, a real turn hands the Arabic buyer to a person and tells them so (the reason written past both reason
 * lists' checks), another workspace is untouched, and releasing answers Arabic again. Only the model is faked.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUN = randomUUID().slice(0, 8);
const HELD = `dd760000-0000-4000-8000-${RUN}0001`;
const OTHER = `dd760000-0000-4000-8000-${RUN}0002`;
const ARABIC = 'مرحبا، عندكم حقائب قماش؟';
const REPLY = 'أهلًا بكم، يسعدنا المساعدة.';

const tool = (args: string[]) => {
  const r = spawnSync(process.execPath, ['tools/language-hold.mjs', ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { ...process.env, MIGRATE_DATABASE_URL: MIGRATE_URL ?? '' },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

d('0159 · a language held out of one workspace (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let db: import('../../src/db/client.js').Db;

  const as = async <T>(biz: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const turn = async (biz: string, text: string) => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { hybridRetriever } = await import('../../src/retrieval/hybrid.js');
    const { computeTurn, commitTurn } = await import('../../src/pipeline/turn.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    const conv = await as(biz, async (t) => {
      const client = (await sql<{ id: string }>`insert into clients (business_id, phone, display_name)
        values (${biz}, ${`+9665${Math.floor(Math.random() * 9e7 + 1e7)}`}, 'Layla') returning id::text as id`.execute(t)).rows[0]!.id;
      return (await tenantRepos(t, b.value).conversations.create(client as never, 'whatsapp')).conversationId;
    });
    const analyzer = new FakeAnalyzer();
    analyzer.next = {
      language: { detected: 'ar', replyIn: 'ar' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'warm_intake', wantsPerson: false,
    };
    const writer = new FakeReplyWriter();
    writer.replies = [REPLY];
    const req = { conversationId: conv as never, messageId: `lh-${randomUUID()}`, text };
    return as(biz, async (t) => {
      const ports = { tenant: tenantRepos(t, b.value), retriever: hybridRetriever(t, b.value), analyzer, replyWriter: writer, now: () => new Date() };
      const r = await computeTurn(ports, req);
      const fx = await commitTurn(ports, req, r, Date.now());
      const signals = (await sql<{ kind: string }>`select kind from conversation_signals
        where conversation_id = ${conv}::uuid and resolved_at is null`.execute(t)).rows.map((x) => x.kind);
      return { r, fx, signals, written: writer.calls };
    });
  };

  /**
   * What a FIRST message in a conversation is, exactly: the disclosure in the buyer's language, then the words
   * (rule 3; `withDisclosure`). Each turn here opens a new conversation, so every reply carries it. (On #347 these
   * assertions first expected the bare reply — the test, not the code, was wrong: the pipeline tests seed a buyer who
   * was already told, these do not.)
   */
  const first = async (words: string): Promise<string> => {
    // One greeting (2026-10-28): the disclosure's; the reply's own «أهلًا بكم،» goes, as a reply sent alone does.
    const { disclosureFor, withDisclosureFirst } = await import('../../src/core/conversation/disclosure.js');
    return withDisclosureFirst(disclosureFor({ detected: 'ar', name: 'Lily', business: `Hold ${RUN}` })!, words);
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    for (const biz of [HELD, OTHER]) {
      await as(biz, async (t) => {
        await sql`insert into businesses (id, name, engine) values (${biz}, ${`Hold ${RUN}`}, 'service') on conflict (id) do nothing`.execute(t);
        for (const cap of ['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up', 'confirm_order']) {
          await sql`insert into autonomy_policy (business_id, capability, mode) values (${biz}, ${cap}, 'auto')
                    on conflict (business_id, capability) do update set mode = 'auto'`.execute(t);
        }
        await sql`insert into assistants (business_id, name, is_default) values (${biz}, 'Lily', true)`.execute(t);
        await sql`insert into onboarding_state (business_id, assistant_named_at) values (${biz}, now())
                  on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
      });
    }
  }, 60_000);
  afterAll(async () => { await db?.destroy(); });

  it('the tool refuses what is not a language a workspace may serve, and a business that does not exist', () => {
    expect(tool(['--business', HELD, '--hold', 'xx']).code).toBe(2);
    expect(tool(['--business', HELD, '--hold', 'ar', '--release', 'ar']).code).toBe(2);
    const none = tool(['--business', randomUUID(), '--hold', 'ar']);
    expect(none.code).toBe(1);
    expect(none.out).toMatch(/No business/);
  });

  it('held by the tool: an Arabic buyer goes to a person and is told so — nothing written; the other workspace answers', async () => {
    const r = tool(['--business', HELD, '--hold', 'ar']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/ar HELD/);
    expect(tool(['--business', HELD, '--hold', 'ar']).out).toMatch(/already held/);
    expect(tool(['--business', HELD]).out).toMatch(/held — ar/);

    const held = await turn(HELD, ARABIC);
    expect(held.signals).toContain('language_held');
    expect(held.r.decision.action.kind).toBe('handoff');
    const { HANDOFF_REPLIES } = await import('../../src/core/conversation/templates.js');
    // Exactly: the disclosure every first message of a conversation carries (rule 3, 0079), then the hand-off sentence.
    expect(held.fx.outbound?.reply, 'told, never silence').toBe(await first(HANDOFF_REPLIES.ar));
    expect(held.written).toBe(0);

    // Answered: exactly the disclosure, then the reply written — not the hand-off.
    const other = await turn(OTHER, ARABIC);
    expect(other.signals).not.toContain('language_held');
    expect(other.fx.outbound?.reply).toBe(await first(REPLY));
  });

  it('released by the tool: answered again, as every signed language is', async () => {
    const r = tool(['--business', HELD, '--release', 'ar']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/ar RELEASED/);
    const after = await turn(HELD, ARABIC);
    expect(after.signals).not.toContain('language_held');
    expect(after.fx.outbound?.reply).toBe(await first(REPLY));
  });
});
