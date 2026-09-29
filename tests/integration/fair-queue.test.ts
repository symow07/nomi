import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * FAIR (the one-month build order, 2026-09-30) — one workspace's backlog does
 * not hold another's customer, through the production composition (a signed
 * webhook → pg-boss → the worker).
 *
 * A busy workspace gets eight customers at once and a slow model; a quiet one
 * gets one. Before FAIR one worker took the queue in order, so the quiet
 * workspace's customer was read after all eight. Now each workspace is its
 * own group, the worker runs several jobs at once and at most one per
 * workspace: the quiet customer is read while the busy backlog is still
 * mostly waiting — and the busy workspace never has two turns at once.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BUSY = `dd7f0000-0000-4000-8000-${RUN}0001`;
const QUIET = `dd7f0000-0000-4000-8000-${RUN}0002`;

const until = async <T>(probe: () => Promise<T | undefined> | T | undefined, what: string, ms = 90_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

d('FAIR · one workspace\'s backlog does not hold another\'s customer (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let busy: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let quiet: import('../../src/channels/whatsapp/simulator.js').Simulator;

  /** A model that takes a while — slow enough that a backlog is a backlog. */
  let inFlight = 0;
  let mostAtOnceForBusy = 0;
  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  const slow = analyzer.analyze.bind(analyzer);
  analyzer.analyze = async (input) => {
    const isBusy = Boolean(input?.text.startsWith('busy'));
    if (isBusy) { inFlight++; mostAtOnceForBusy = Math.max(mostAtOnceForBusy, inFlight); }
    try {
      await new Promise((r) => setTimeout(r, 1500));
      return await slow(input);
    } finally {
      if (isBusy) inFlight--;
    }
  };

  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    busy = whatsappSimulator([], { tag: `fairA${RUN}` });
    quiet = whatsappSimulator([], { tag: `fairB${RUN}` });
    const setup = createDb(DATABASE_URL!);
    for (const [id, name, sim] of [[BUSY, 'Busy Shop', busy], [QUIET, 'Quiet Shop', quiet]] as const) {
      const b = parseBusinessId(id); if (!b.ok) throw new Error('fixture');
      await withTenantTx(setup, b.value, async (t) => {
        await sql`insert into businesses (id, name, engine) values (${id}, ${name}, 'service') on conflict (id) do nothing`.execute(t);
        await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 1000 where id = ${id}`.execute(t);
        await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                  values (${id}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      });
    }
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BUSY;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'fair-verify-token-x', CREDENTIAL_KEY: 'f'.repeat(64), PORT: 0,
    }, { adapter: busy.adapter, logger: false, media: {}, models: { analyzer, replyWriter: new FakeReplyWriter() } });
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  it('the quiet workspace\'s customer is read before the busy backlog clears; the busy one never runs two at once', async () => {
    // The queue is shared with every earlier file's leftovers, and they take
    // workers too (the full run once read four of the busy eight first). The
    // claim is about two workspaces, so start from an idle queue — waiting a
    // bounded while for the leftovers to drain.
    await until(async () => {
      const { sql: q } = await import('kysely');
      const n = (await q<{ n: number }>`select count(*)::int as n from pgboss.job
        where name = 'message.inbound' and state in ('created', 'retry', 'active') and start_after <= now()`.execute(prod.db)).rows[0]!.n;
      return n === 0 ? true : undefined;
    }, 'the shared queue to go idle', 120_000).catch(() => undefined);
    for (let i = 0; i < 8; i++) {
      expect((await post(busy.inboundText({ from: `9719${runDigits(RUN, 6)}${i}`, text: `busy customer ${i}: price for totes?` }))).statusCode).toBe(200);
    }
    expect((await post(quiet.inboundText({ from: `9710${runDigits(RUN, 6)}9`, text: 'quiet customer: do you ship to Oman?' }))).statusCode).toBe(200);

    const readAt = await until(() => {
      const i = analyzer.texts.findIndex((t) => t.startsWith('quiet customer'));
      return i === -1 ? undefined : i;
    }, 'the quiet workspace\'s customer to be read');
    const busyBefore = analyzer.texts.slice(0, readAt).filter((t) => t.startsWith('busy')).length;
    // In queue order it would have been ninth (switched off, it is); now most
    // of the backlog is still waiting when the quiet customer is read.
    expect(busyBefore, `busy customers read before the quiet one: ${busyBefore}`).toBeLessThanOrEqual(4);

    await until(() => (analyzer.texts.filter((t) => t.startsWith('busy')).length >= 8 ? true : undefined), 'the busy backlog to clear', 150_000);
    expect(mostAtOnceForBusy, 'one workspace never has two turns at once').toBe(1);
  }, 360_000);
});
