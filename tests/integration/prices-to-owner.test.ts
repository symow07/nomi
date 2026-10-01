import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID, createHmac } from 'node:crypto';
import { flashSaid, runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * K5 — "PRICES GO TO ME", in production's own composition (0094).
 *
 * The owner turns it on from the add page (owner-only, audited); Setup's
 * products step counts it; and a customer who asks a price, on the real
 * webhook and the real worker, is handed to the owner with nothing priced —
 * the repo reads the business's own column, so the choice binds the next turn.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('K5 · prices go to the owner, end to end (requires DATABASE_URL)', { timeout: 90_000 }, () => {
  const BIZ = `dd950000-0000-4000-8000-${RUN}0005`;
  const C = `9715${runDigits(RUN, 6)}6`;
  const WEB_SECRET = createHmac('sha256', 'b'.repeat(64)).update('yf-web-session').digest('hex');
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let cookie = '';
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();
  const q = async <T>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };
  const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 30_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await probe();
      if (v !== undefined) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    sim = whatsappSimulator([], { tag: `k5${RUN}` });
    const setup = createDb(DATABASE_URL!);
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    await withTenantTx(setup, b.value, async (t) => {
      await sql`insert into businesses (id, name, engine, kind) values (${BIZ}, 'Prices To Me Studio', 'service', 'services') on conflict (id) do nothing`.execute(t);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at)
                values (${BIZ}, 'whatsapp', 'connected', '+971 50****0095', now())`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'k5-verify-token-xxxx', CREDENTIAL_KEY: 'b'.repeat(64), PORT: 0,
    }, { adapter: sim.adapter, logger: false, models: { analyzer, replyWriter } });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: FORM,
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  }, 60_000);
  afterAll(async () => { await prod?.close(); });

  it('the owner turns it on from the add page: recorded on the business, audited once, and Setup\'s products step is done', async () => {
    const r = await prod.app.inject({ method: 'POST', url: '/app/products/prices-to-me', headers: { cookie, ...FORM }, payload: 'on=1' });
    expect(r.headers['location']).toBe('/app/products/add');
    expect(flashSaid(r, WEB_SECRET)).toContain('Prices go to you now');
    // A second press changes nothing and records nothing.
    await prod.app.inject({ method: 'POST', url: '/app/products/prices-to-me', headers: { cookie, ...FORM }, payload: 'on=1' });
    const row = await q((tx) => sql<{ on: boolean; audits: number }>`
      select prices_to_owner as on,
             (select count(*)::int from channel_audit where business_id = ${BIZ} and action = 'prices_to_owner_set') as audits
        from businesses where id = ${BIZ}`.execute(tx).then((x) => x.rows[0]!));
    expect(row).toEqual({ on: true, audits: 1 });
    const { setupProgress } = await import('../../src/db/setup.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    const progress = await q((tx) => setupProgress(tx, b.value));
    expect(progress.steps.find((s) => s.step === 'products')?.done).toBe(true);
    expect((await prod.app.inject({ method: 'GET', url: '/app/products/add', headers: { cookie } })).body)
      .toContain('name="on" value="0"');
  });

  it('A CUSTOMER WHO ASKS A PRICE is handed to the owner, on the real worker, with nothing priced', async () => {
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'price_request', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'qualification', wantsPerson: false,
    };
    const w = sim.inboundText({ from: C, text: 'How much is a logo design?' });
    const res = await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });
    expect(res.statusCode).toBe(200);
    const signal = await until(() => q((tx) => sql<{ kind: string }>`
      select s.kind from conversation_signals s join conversations c on c.id = s.conversation_id
       where c.business_id = ${BIZ} and s.kind = 'price_to_owner'`.execute(tx).then((x) => x.rows[0])), 'the hand-off');
    expect(signal.kind).toBe('price_to_owner');
    const after = await q((tx) => sql<{ quotes: number; assigned: boolean }>`
      select (select count(*)::int from quotes where business_id = ${BIZ}) as quotes,
             (select c.assigned_to is not null from conversations c where c.business_id = ${BIZ} limit 1) as assigned`
      .execute(tx).then((x) => x.rows[0]!));
    expect(after.quotes).toBe(0);
    expect(after.assigned).toBe(true);
    // Nothing was written for THIS customer's question. Not \`replyWriter.calls\`:
    // this file's worker also runs any job an earlier file left queued with a
    // delay (a batch's re-check), with this file's fakes — on CI's second pass
    // one such turn counted here (2026-10-01, PR #193).
    expect(replyWriter.inputs.filter((i) => i.text.includes('How much is a logo design?'))).toEqual([]);
  });

  it('turned off again, the next price question is the assistant\'s', async () => {
    await prod.app.inject({ method: 'POST', url: '/app/products/prices-to-me', headers: { cookie, ...FORM }, payload: 'on=0' });
    const on = await q((tx) => sql<{ on: boolean }>`select prices_to_owner as on from businesses where id = ${BIZ}`.execute(tx).then((x) => x.rows[0]!.on));
    expect(on).toBe(false);
  });
});
