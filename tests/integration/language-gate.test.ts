import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * THE DISCLOSURE GATE, PER LANGUAGE (the owner, 2026-09-30), through the
 * production composition with the REAL gate — no rehearsal override: a
 * signed webhook → pg-boss → the worker → the turn → the send path.
 *
 * #124 added Spanish and French unread, and the gate was one answer for the
 * whole product, so every workspace stopped sending alone — Westlake's six
 * auto capabilities included. Now each customer's own language decides:
 *   · English (signed off): the reply goes alone, the disclosure in front;
 *   · a language whose disclosure nobody signed — CHANGED at the Phase 4 gate
 *     (blocker 1, the owner, 2026-10-14; 0153): it drafted; now the buyer goes
 *     to a person and receives nothing automated at all — no reply, no draft,
 *     no hand-off sentence. Spanish and Portuguese (written, unread) and German
 *     (no sentence at all) alike. The owner's own reply goes.
 *   · the send gate, the last door: a reply the assistant would send alone to
 *     such a buyer is refused (`language_not_reviewed`); the same reply the
 *     owner approved goes.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd740000-0000-4000-8000-${RUN}0001`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 90_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

d('the disclosure gate is per language, with the real flags (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let cookie = '';
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();
  const speaks = (detected: string) => {
    analyzer.next = {
      language: { detected, replyIn: detected },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification',
    };
  };

  const q = async <R>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };
  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody, headers: { 'content-type': 'application/json', ...w.headers } });

  /** A customer writes; wait until the turn has settled — a reply queued alone, or a draft. */
  const writes = async (from: string, text: string) => {
    expect((await post(sim.inboundText({ from, text }))).statusCode).toBe(200);
    return until(() => q(async (tx) => {
      const r = (await sql<{ conv: string; outbound: number; drafts: number }>`
        select c.id::text as conv,
               (select count(*)::int from outbound_messages o where o.conversation_id = c.id and o.origin = 'employee') as outbound,
               (select count(*)::int from drafts dr where dr.conversation_id = c.id) as drafts
          from conversations c join clients cl on cl.id = c.client_id
         where c.business_id = ${BIZ}::uuid and cl.phone like ${`%${from}`}`.execute(tx)).rows[0];
      return r && (r.outbound > 0 || r.drafts > 0) ? r : undefined;
    }), `the turn for "${text}"`);
  };

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    sim = whatsappSimulator([], { tag: `lg${RUN}` });
    const setup = createDb(DATABASE_URL!);
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    await withTenantTx(setup, b.value, async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Language Gate Co', 'service') on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 10000 where id = ${BIZ}`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                values (${BIZ}, 'whatsapp', 'connected', '+86 579****0074', now(), now(), 'test', false)`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      for (const cap of ['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up']) {
        await sql`insert into autonomy_policy (business_id, capability, mode) values (${BIZ}, ${cap}, 'auto')
                  on conflict (business_id, capability) do update set mode = 'auto'`.execute(t);
      }
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      // The installation's number IS the one this workspace's credential holds, as in production: since
      // 2026-10-14 that number sends only for its own workspace (src/main.ts `installationNumber`).
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: sim.phoneNumberId,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'lg-verify-token-xxx', CREDENTIAL_KEY: 'c'.repeat(64), PORT: 0,
    }, { adapter: sim.adapter, logger: false, media: {}, models: { analyzer, replyWriter } });   // the REAL gate: no autonomyReleased override
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: FORM,
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  /** A customer writes in a language nobody signed: wait until the turn has handed them to a person. */
  const handedOver = async (from: string, text: string) => {
    expect((await post(sim.inboundText({ from, text }))).statusCode).toBe(200);
    return until(() => q(async (tx) => {
      const r = (await sql<{ conv: string; assigned: string | null; outbound: number; drafts: number; reason: boolean }>`
        select c.id::text as conv, c.assigned_to as assigned,
               (select count(*)::int from outbound_messages o where o.conversation_id = c.id) as outbound,
               (select count(*)::int from drafts dr where dr.conversation_id = c.id) as drafts,
               exists (select 1 from conversation_signals s where s.conversation_id = c.id
                         and s.kind = 'language_not_reviewed' and s.resolved_at is null) as reason
          from conversations c join clients cl on cl.id = c.client_id
         where c.business_id = ${BIZ}::uuid and cl.phone like ${`%${from}`}`.execute(tx)).rows[0];
      return r && r.reason ? r : undefined;
    }), `the hand-over for "${text}"`);
  };

  it('English — signed off: the reply goes alone, with the disclosure in front', async () => {
    speaks('en');
    replyWriter.replies = ['We make canvas totes in three sizes.'];
    const r = await writes(`9716${runDigits(RUN, 6)}1`, 'Hello, do you make canvas bags?');
    expect(r.drafts).toBe(0);
    const body = await q((tx) => sql<{ body: string }>`select body from outbound_messages where conversation_id = ${r.conv}::uuid and origin = 'employee'`
      .execute(tx).then((x) => x.rows[0]!.body));
    expect(body).toContain("Language Gate Co's AI assistant");
    expect(body).toContain('We make canvas totes in three sizes.');
  }, 120_000);

  it('Spanish — written, not yet read: the buyer goes to a person; nothing is written or sent, and the page says why', async () => {
    speaks('es');
    replyWriter.replies = ['Hacemos bolsas de lona en tres tamaños.'];
    const before = sim.sendCount();
    const r = await handedOver(`9716${runDigits(RUN, 6)}2`, 'Hola, ¿hacen bolsas de lona?');
    expect(r.outbound).toBe(0);   // no reply, no hand-off sentence, nothing at all
    expect(r.drafts).toBe(0);
    expect(r.assigned).not.toBeNull();   // with a person: Needs you
    expect(sim.sendCount()).toBe(before);
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const page = await prod.app.inject({ method: 'GET', url: `/app/inbox/${r.conv}`, headers: { cookie } });
    expect(page.body).toContain(t('en', 'takeover.reason.language_not_reviewed'));

    // The owner's own reply goes — the conversation taken first, as any reply of theirs needs.
    expect((await prod.app.inject({ method: 'POST', url: `/app/inbox/${r.conv}/takeover`, headers: { cookie, ...FORM }, payload: '' })).statusCode).toBe(302);
    const reply = await prod.app.inject({ method: 'POST', url: `/app/inbox/${r.conv}/reply`, headers: { cookie, ...FORM },
      payload: new URLSearchParams({ text: 'Sí, en tres tamaños.' }).toString() });
    expect(reply.statusCode).toBe(302);
    await until(async () => (sim.sendCount() > before ? true : undefined), 'the owner\'s reply');
  }, 120_000);

  it('German — no sentence at all: the buyer goes to a person, and no English sentence goes in front of anything', async () => {
    speaks('de');
    replyWriter.replies = ['Wir machen Taschen aus Segeltuch in drei Größen.'];
    const r = await handedOver(`9716${runDigits(RUN, 6)}3`, 'Hallo, machen Sie Taschen aus Segeltuch?');
    expect(r.outbound).toBe(0);
    expect(r.drafts).toBe(0);
  }, 120_000);

  it('Portuguese — its sentence is written and unread: the buyer goes to a person', async () => {
    speaks('pt');
    replyWriter.replies = ['Fazemos sacolas de lona em três tamanhos.'];
    const r = await handedOver(`9716${runDigits(RUN, 6)}4`, 'Olá, vocês fazem sacolas de lona?');
    expect(r.outbound).toBe(0);
    expect(r.drafts).toBe(0);
  }, 120_000);

  it('THE LAST DOOR — what the assistant would send alone to a buyer whose language is unsigned is refused; what the owner approved goes', async () => {
    // An English conversation the assistant holds; then the buyer's language on record turns Spanish.
    speaks('en');
    replyWriter.replies = ['We make canvas totes in three sizes.'];
    const r = await writes(`9716${runDigits(RUN, 6)}5`, 'Hello, do you make canvas bags?');
    const english = await until(() => q((tx) => sql<{ id: string }>`select provider_message_id as id from outbound_messages
      where conversation_id = ${r.conv}::uuid and status in ('sent', 'delivered') and provider_message_id is not null`.execute(tx)
      .then((x) => x.rows[0]?.id)), 'the English reply');
    // Its receipt, so nothing after it waits on the sequencer's 90 s for one.
    expect((await post(sim.status(english, 'delivered'))).statusCode).toBe(200);
    const { enqueueOutboundRow } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { QUEUES } = await import('../../src/queue/boss.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    const [alone, notice] = await q(async (tx) => {
      await sql`update clients set preferred_language = 'es' where id = (select client_id from conversations where id = ${r.conv}::uuid)`.execute(tx);
      return [await enqueueOutboundRow(tx, b.value, r.conv, 'Tenemos la talla M.', 'employee'),
        await enqueueOutboundRow(tx, b.value, r.conv, 'Le responderá una persona.', 'employee', null, null, 'handoff')];
    });
    await prod.boss.send(QUEUES.outbound, { businessId: BIZ, conversationId: r.conv });
    const refused = await until(() => q((tx) => sql<{ id: string; reason: string }>`
      select detail->>'outboundId' as id, detail->>'reason' as reason from channel_audit
       where business_id = ${BIZ}::uuid and action = 'send_refused' and detail->>'outboundId' = any(${[alone, notice]}::text[])`.execute(tx))
      .then((x) => (x.rows.length === 2 ? x.rows : undefined)), 'the refusals');
    expect(refused.map((x) => x.reason)).toEqual(['language_not_reviewed', 'language_not_reviewed']);

    // The same words, approved by the owner, go.
    const before = sim.sendCount();
    await q((tx) => enqueueOutboundRow(tx, b.value, r.conv, 'Tenemos la talla M.', 'employee', null, null, null, true));
    await prod.boss.send(QUEUES.outbound, { businessId: BIZ, conversationId: r.conv });
    await until(async () => (sim.sendCount() > before ? true : undefined), 'the approved reply');
  }, 120_000);
});
