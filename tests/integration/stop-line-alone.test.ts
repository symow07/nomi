import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * D2 (the owner, 2026-10-11) — THE LINE THAT ANSWERS A STOP GOES ALONE, with
 * nothing on auto. Through the production composition: a signed webhook, the
 * real turn and gate per language (no `autonomyReleased` stand-in), the
 * outbound job, the real worker, the simulator's provider.
 *
 *   · English and Arabic (signed): the line leaves, carrying the disclosure,
 *     and nothing waits for the owner.
 *   · Spanish (unsigned): the line waits for the owner, with its mark.
 *   · Only the line: an ordinary reply still waits for the owner.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dda20000-0000-4000-8000-${RUN}0001`;

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
const n = (i: number) => `9720${runDigits(RUN, 5)}${String(i).padStart(2, '0')}`;
let next = 0;
const buyer = () => n(++next);

d('D2 · the stop line goes alone with nothing on auto, through production (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();

  const q = async <T>(fn: (tx: Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, await bidOf(BIZ), fn);
  };
  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });
  const convOf = (wa: string) => until(() => q((tx) => sql<{ id: string }>`
    select c.id::text as id from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
     where cc.channel_user_id = ${wa} and c.is_active limit 1`.execute(tx).then((r) => r.rows[0]?.id)), `conversation of ${wa}`);
  const rows = (conv: string) => q((tx) => sql<{ body: string; status: string; notice: string | null; approved: boolean }>`
    select body, status, notice, approved from outbound_messages where conversation_id = ${conv}::uuid order by seq`
    .execute(tx).then((r) => r.rows));
  const pending = (conv: string) => q((tx) => sql<{ text: string; notice: string | null }>`
    select draft_text as text, notice from drafts where conversation_id = ${conv}::uuid and status = 'pending' order by created_at`
    .execute(tx).then((r) => r.rows));
  const settled = (conv: string, what: string) => until(async () => {
    const r = await rows(conv);
    return r.length > 0 && r.every((x) => x.status !== 'queued' && x.status !== 'sending') ? r : undefined;
  }, what);
  const waiting = (conv: string, what: string) => until(async () => {
    const p = await pending(conv);
    return p.length > 0 ? p : undefined;
  }, what);

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    sim = whatsappSimulator([], { tag: `d2s${RUN}` });
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, await bidOf(BIZ), async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, 'Stop Line', 'service')
                on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 1000 where id = ${BIZ}`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                values (${BIZ}, 'whatsapp', 'connected', '+86 579****0002', now(), now(), 'test', false)`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      // Nothing on auto: no autonomy_policy rows, so every capability waits for the owner.
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta',
      DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'd2s-verify-token-xx',
      CREDENTIAL_KEY: 'e'.repeat(64),
      PORT: 0,
    }, { adapter: sim.adapter, logger: false, models: { analyzer, replyWriter } });
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  for (const [text, lang] of [['stop messaging me', 'en'], ['لا تراسلني', 'ar']] as const) {
    it(`${lang}, signed: the line leaves alone, carrying the disclosure, and nothing waits — ${JSON.stringify(text)}`, async () => {
      const { OPT_OUT_REPLIES } = await import('../../src/core/safety/optOut.js');
      const { disclosureFor, withDisclosure } = await import('../../src/core/conversation/disclosure.js');
      const wa = buyer();
      const before = sim.sendCount();
      expect((await post(sim.inboundText({ from: wa, text }))).statusCode).toBe(200);
      const conv = await convOf(wa);
      const r = await settled(conv, 'the line');
      expect(r).toEqual([expect.objectContaining({ status: 'sent', notice: 'opt_out', approved: false })]);
      expect(r[0]!.body).toBe(withDisclosure(disclosureFor({ detected: lang, name: 'Lily', business: 'Stop Line' })!, OPT_OUT_REPLIES[lang]));
      expect(sim.sendCount()).toBe(before + 1);
      expect(await pending(conv)).toEqual([]);
      const optedOut = await q((tx) => sql<{ n: number }>`
        select count(*)::int as n from opt_outs where business_id = ${BIZ}::uuid and identity = ${wa} and lifted_at is null`
        .execute(tx).then((x) => x.rows[0]!.n));
      expect(optedOut).toBe(1);
    });
  }

  it('es, unsigned: the line waits for the owner with its mark, and nothing is sent', async () => {
    const { OPT_OUT_REPLIES } = await import('../../src/core/safety/optOut.js');
    const wa = buyer();
    const before = sim.sendCount();
    expect((await post(sim.inboundText({ from: wa, text: 'deja de escribirme' }))).statusCode).toBe(200);
    const conv = await convOf(wa);
    expect(await waiting(conv, 'the line as a draft')).toEqual([{ text: OPT_OUT_REPLIES.es, notice: 'opt_out' }]);
    expect(await rows(conv)).toEqual([]);
    expect(sim.sendCount()).toBe(before);
  });

  it('only the line: an ordinary reply still waits for the owner', async () => {
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification', wantsPerson: false,
    };
    replyWriter.replies = ['Which colour would you like?'];
    const wa = buyer();
    const before = sim.sendCount();
    expect((await post(sim.inboundText({ from: wa, text: 'Hi, do you have totes?' }))).statusCode).toBe(200);
    const conv = await convOf(wa);
    expect(await waiting(conv, 'the reply as a draft')).toEqual([{ text: 'Which colour would you like?', notice: null }]);
    expect(await rows(conv)).toEqual([]);
    expect(sim.sendCount()).toBe(before);
  });
});
