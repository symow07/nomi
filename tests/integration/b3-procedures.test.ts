import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { runDigits, seedRunTenant, flashSaid } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { Analysis } from '../../src/core/conversation/decide.js';

/**
 * Block 3 PR 2 (0229) — PROCEDURES, end to end. First the page: the owner saves "A sample request" in three steps, a
 * step with a figure and a step that moves money are refused by name, staff see the list and no form. Then the whole
 * pipeline on the fake WhatsApp channel, through production's composition: a customer asks for a sample, the analyser
 * names the procedure, step 1 and step 2 are each done by one reply (the writer handed exactly that step, the
 * conversation's record saying which), and the third message reaches the hand-off step — a person takes over, the
 * writer is never asked, the signal is the procedure's own.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const STEPS = ['Ask the delivery address.', 'Quote the sample price and the shipping.', 'Hand to me to confirm.'];
type Tx = import('../../src/db/client.js').Tx;

const bidOf = async (raw: string) => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
};
const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 90_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};
const reads = (procedureStarted: string | null): Analysis => ({
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'clarification', wantsPerson: false, wantsDeletion: false, procedureStarted,
});

d('0229 · procedures: the page (requires DATABASE_URL)', () => {
  const BIZ = `dd229000-0000-4000-8000-${RUN}0001`;
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let owner = ''; let staff = '';
  const login = async (code: string) => {
    const res = await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM });
    return String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  };
  const post = (cookie: string, url: string, body: Record<string, string>) =>
    app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(), headers: { cookie, ...FORM } });
  const rows = async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, await bidOf(BIZ), async (t) => (await sql<{ title: string; n: number; archived: boolean }>`
      select title, jsonb_array_length(steps)::int as n, archived_at is not null as archived from procedures where business_id = ${BIZ}::uuid order by created_at`.execute(t)).rows);
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    await withTenantTx(db, await bidOf(BIZ), (t) => sql`insert into businesses (id, name, owner_locale) values (${BIZ}, 'Procedures Test Co', 'en') on conflict (id) do nothing`.execute(t));
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: { level: 'error' } });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: `proc-${RUN}`, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    owner = await login(`proc-${RUN}`);
    const team = await addPerson(db, BIZ, SECRET, `Staff ${RUN}`, 'team'); if (team.code !== 'added') throw new Error('fixture');
    staff = await login(team.accessCode);
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('the owner saves the sample procedure; a figure and a refund are refused by step; staff read and get no form', async () => {
    const saved = await post(owner, '/app/assistant/knowledge/procedures', { title: 'A sample request', steps: STEPS.map((s, i) => `${i + 1}. ${s}`).join('\n') });
    expect(flashSaid(saved, SECRET)).toContain('Procedure saved');
    expect(flashSaid(await post(owner, '/app/assistant/knowledge/procedures', { title: 'A return', steps: 'Ask for the order number\nRefund the deposit' }), SECRET)).toMatch(/step 2 would move money/);
    expect(flashSaid(await post(owner, '/app/assistant/knowledge/procedures', { title: 'A return', steps: 'Ask for 2 photos of the damage' }), SECRET)).toMatch(/step 1 carries a figure/);
    expect(await rows()).toEqual([{ title: 'A sample request', n: 3, archived: false }]);
    const page = await app.inject({ method: 'GET', url: '/app/assistant/knowledge/procedures', headers: { cookie: owner } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Quote the sample price and the shipping.');
    expect(page.body).toContain('hands to you');
    const theirs = await app.inject({ method: 'GET', url: '/app/assistant/knowledge/procedures', headers: { cookie: staff } });
    expect(theirs.body).toContain('A sample request');
    expect(theirs.body).not.toContain('name="steps"');
    const tried = await post(staff, '/app/assistant/knowledge/procedures', { title: 'Sneak', steps: 'ask' });
    expect(tried.statusCode).toBe(302);
    expect((await rows()).length).toBe(1);
    // The knowledge page has the door.
    const knowledge = await app.inject({ method: 'GET', url: '/app/assistant/knowledge', headers: { cookie: owner } });
    expect(knowledge.body).toContain('href="/app/assistant/knowledge/procedures"');
  });
});

d('0229 · procedures: through the whole pipeline on the fake channel (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  const BIZ = `dd229000-0000-4000-8000-${RUN}0002`;
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let procedureId = '';
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = ['Happy to help with a sample. Which address should it go to?'];
  const buyer = `9719${runDigits(RUN, 5)}29`;
  const q = async <T>(fn: (tx: Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, await bidOf(BIZ), fn);
  };
  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody, headers: { 'content-type': 'application/json', ...w.headers } });
  const conv = () => until(() => q((tx) => sql<{ id: string }>`
    select c.id::text as id from conversations c join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
     where cc.channel_user_id = ${buyer} and c.is_active limit 1`.execute(tx).then((r) => r.rows[0]?.id)), 'the conversation');
  const state = (id: string) => q((tx) => sql<{ step: number | null; proc: string | null; assigned: string | null; signals: string[]; steps: number[]; drafts: number }>`
    select cs.procedure_step as step, cs.procedure_id::text as proc, c.assigned_to as assigned,
           coalesce((select array_agg(s.kind order by s.kind) from conversation_signals s where s.conversation_id = c.id and s.resolved_at is null), '{}') as signals,
           coalesce((select array_agg((e.payload->>'step')::int order by e.id) from conversation_events e where e.conversation_id = c.id and e.type = 'procedure_step'), '{}') as steps,
           (select count(*)::int from drafts dd where dd.conversation_id = c.id) as drafts
      from conversations c join conversation_state cs on cs.conversation_id = c.id where c.id = ${id}::uuid`.execute(tx).then((r) => r.rows[0]!));
  const send = async (text: string) => { expect((await post(sim.inboundText({ from: buyer, text }))).statusCode).toBe(200); return conv(); };

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { addProcedure } = await import('../../src/db/procedures.js');
    sim = whatsappSimulator([], { tag: `prc${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, await bidOf(BIZ), async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Procedure Pipeline', 'service') on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 1000 where id = ${BIZ}`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at) values (${BIZ}, 'whatsapp', 'connected', '+86 579****0229', now())`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine) values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      procedureId = await addProcedure(t, await bidOf(BIZ), 'owner', { title: 'A sample request', steps: [
        { text: STEPS[0]!, kind: 'do' }, { text: STEPS[1]!, kind: 'do' }, { text: STEPS[2]!, kind: 'handoff' }] });
    });
    await setup.destroy();
    analyzer.next = reads(null);
    analyzer.byText.set('Can I get a sample of the bag?', reads(procedureId));
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'prc-verify-token-xx', CREDENTIAL_KEY: 'c'.repeat(64), PORT: 0,
    }, { adapter: sim.adapter, logger: false, models: { analyzer, replyWriter } });
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  it('step 1, step 2, then the hand-off: one step per message, the record saying which, the writer never asked at the end', async () => {
    const id = await send('Can I get a sample of the bag?');
    await until(async () => ((await state(id)).drafts >= 1 ? true : undefined), 'the first reply');
    let s = await state(id);
    expect(s).toMatchObject({ proc: procedureId, step: 1, assigned: null, steps: [1] });
    expect(replyWriter.inputs.at(-1)?.procedure).toEqual({ for: 'A sample request', step: 1, of: 3, do: STEPS[0] });
    expect(analyzer.texts).toContain('Can I get a sample of the bag?');

    await send('12 Rue des Fleurs, Casablanca');
    await until(async () => ((await state(id)).drafts >= 2 ? true : undefined), 'the second reply');
    s = await state(id);
    expect(s).toMatchObject({ proc: procedureId, step: 2, assigned: null, steps: [1, 2] });
    expect(replyWriter.inputs.at(-1)?.procedure).toMatchObject({ step: 2, of: 3, do: STEPS[1] });

    const writes = replyWriter.calls;
    await send('ok, go ahead');
    await until(async () => ((await state(id)).assigned !== null ? true : undefined), 'the hand-off');
    s = await state(id);
    expect(s.signals).toContain('procedure_handoff');
    expect(s.steps).toEqual([1, 2, 3]);
    expect(s.proc).toBeNull();
    expect(s.step).toBeNull();
    expect(replyWriter.calls).toBe(writes);
    // The hand-off is on the conversation's record, and the step that caused it says so.
    const events = await q((tx) => sql<{ type: string; handoff: boolean | null }>`select type, (payload->>'handoff')::boolean as handoff from conversation_events where conversation_id = ${id}::uuid and type in ('handoff', 'procedure_step') order by id`.execute(tx).then((r) => r.rows));
    expect(events.map((e) => e.type)).toContain('handoff');
    expect(events.filter((e) => e.type === 'procedure_step').map((e) => e.handoff)).toEqual([false, false, true]);
  });
});
