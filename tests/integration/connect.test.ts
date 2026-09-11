import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * G3 — the factory's number can be connected, and then messages arrive.
 *
 * An inbound message is matched to a factory by `resolve_tenant`, which reads
 * `channel_credentials`, and nothing in the product ever wrote that table —
 * only the demo seed did. A real factory's messages would have been
 * acknowledged to Meta and dropped, and the Connect button led to a page of
 * steps with no action on it. This drives the whole road, against the real
 * production composition: dropped before, received after, dropped again when
 * she disconnects, received again when she reconnects.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `cc030000-0000-4000-8000-${RUN}0001`;
const OTHER = `cc030000-0000-4000-8000-${RUN}0002`;
// Globally unique per run: the credential's external ref is unique across ALL
// businesses, and so is a buyer's WhatsApp id.
const DIGITS = String(Date.now()).slice(-9);
const NUMBER = `7${DIGITS}`;
const BUYER = `97155${DIGITS}`;
const CODE = 'connect-test-owner-code';

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 30_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

d('G3 · connect the factory’s number (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let cookie = '';

  const tenant = async <T>(biz: string, fn: (tx: import('../../src/db/client.js').Db) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(prod.db, bid.value, fn as never) as Promise<T>;
  };

  /**
   * A buyer message addressed to OUR number. The simulator signs its own
   * phone-number id into the envelope; the webhook here must carry the number
   * the installation is configured with, so the body is re-addressed and
   * re-signed with the simulator's key — the real signature check still runs.
   */
  const inbound = async (text: string) => {
    const { signBody } = await import('../../src/channels/whatsapp/signature.js');
    const { SIMULATOR_SECRET } = await import('../../src/channels/whatsapp/simulator.js');
    const w = sim.inboundText({ from: BUYER, text });
    const rawBody = w.rawBody.replace(`"phone_number_id":"${sim.phoneNumberId}"`, `"phone_number_id":"${NUMBER}"`);
    const res = await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: rawBody,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signBody(rawBody, SIMULATOR_SECRET) } });
    expect(res.statusCode).toBe(200);
    return (res.json() as { received: number }).received;
  };

  const act = (path: string) => prod.app.inject({ method: 'POST', url: path, headers: { cookie } });
  const flashOf = (res: { headers: Record<string, unknown> }) =>
    decodeURIComponent(String(res.headers['location']).split('flash=')[1] ?? '');

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');

    const setup = createDb(DATABASE_URL!);
    for (const [id, name] of [[BIZ, 'Connect Test Factory'], [OTHER, 'Another Factory']] as const) {
      const bid = parseBusinessId(id); if (!bid.ok) throw new Error('fixture');
      await withTenantTx(setup, bid.value, (tx) => sql`
        insert into businesses (id, name, engine) values (${id}, ${name}, 'service') on conflict (id) do nothing
      `.execute(tx));
    }
    await setup.destroy();

    sim = whatsappSimulator([], { tag: `g3${RUN}` });
    const analyzer = new FakeAnalyzer();
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification',
    };
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    process.env['OWNER_ACCESS_CODE'] = CODE;
    prod = await buildProduction({
      provider: 'meta',
      DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: NUMBER,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'g3-verify-token-xx',
      CREDENTIAL_KEY: 'b'.repeat(64),
      PORT: 0,
    }, {
      adapter: sim.adapter, logger: false, media: {},
      models: { analyzer, replyWriter: new FakeReplyWriter() },
    });

    const login = await prod.app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie, 'the owner must be able to sign in for this test').not.toBe('');
  }, 60_000);

  afterAll(async () => {
    await prod?.close();
    delete process.env['OWNER_ACCESS_CODE'];
  });

  it('BEFORE: a buyer’s message to the configured number is acknowledged and dropped', async () => {
    expect(await inbound('hello, anyone there?')).toBe(0);
  });

  it('the page offers to connect the number, rather than a guide', async () => {
    const res = await prod.app.inject({ method: 'GET', url: '/app/channels', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(t('en', 'channel.action.connectNumber'));
    expect(res.body).toContain('action="/app/channels/whatsapp/connect"');
  });

  it('connecting writes the credential, the channel and the audit row', async () => {
    const res = await act('/app/channels/whatsapp/connect');
    expect(res.statusCode).toBe(302);
    expect(flashOf(res)).toBe(t('en', 'channel.flash.connected', { name: 'Lily' }));

    const row = await tenant(BIZ, (tx) => sql<{ external_ref: string; is_active: boolean; status: string; audited: number }>`
      select cc.external_ref, cc.is_active, ch.status,
             (select count(*)::int from channel_audit a where a.business_id = ${BIZ} and a.action = 'connect') as audited
        from channel_credentials cc join channels ch on ch.credential_id = cc.id
       where cc.business_id = ${BIZ}
    `.execute(tx).then((r) => r.rows[0]));
    expect(row).toEqual({ external_ref: NUMBER, is_active: true, status: 'connected', audited: 1 });
  });

  it('AFTER: the same buyer’s message now reaches her inbox', async () => {
    expect(await inbound('Do you make canvas tote bags?')).toBe(1);
    const conv = await until(() => tenant(BIZ, (tx) => sql<{ id: string }>`
      select c.id from conversations c join clients cl on cl.id = c.client_id
       where c.business_id = ${BIZ} and cl.phone like ${'%' + DIGITS}
    `.execute(tx).then((r) => r.rows[0])), 'the conversation to be created');
    expect(conv.id).toBeTruthy();
  });

  it('disconnecting drops messages again; the page then offers Reconnect, not Connect', async () => {
    expect(flashOf(await act('/app/channels/whatsapp/disconnect'))).toBe(t('en', 'channel.flash.disconnected', { name: 'Lily' }));
    expect(await inbound('still there?')).toBe(0);
    const page = await prod.app.inject({ method: 'GET', url: '/app/channels', headers: { cookie } });
    expect(page.body).toContain('action="/app/channels/whatsapp/reconnect"');
    expect(page.body).not.toContain('action="/app/channels/whatsapp/connect"');
  });

  it('Connect does not create a second credential; Reconnect brings the number back', async () => {
    expect(flashOf(await act('/app/channels/whatsapp/connect'))).toBe(t('en', 'channel.flash.already_connected'));
    expect(flashOf(await act('/app/channels/whatsapp/reconnect'))).toBe(t('en', 'channel.flash.reconnected', { name: 'Lily' }));
    expect(await inbound('back again')).toBe(1);
    const creds = await tenant(BIZ, (tx) => sql<{ n: number }>`
      select count(*)::int as n from channel_credentials where business_id = ${BIZ}
    `.execute(tx).then((r) => r.rows[0]!.n));
    expect(creds).toBe(1);
  });

  it('another factory cannot take a number that is already held', async () => {
    const { connectConfiguredNumber } = await import('../../src/api/web/channels.js');
    expect(await connectConfiguredNumber(prod.db, OTHER, 'owner', NUMBER)).toEqual({ code: 'number_taken' });
  });

  it('a malformed or missing number connects nothing', async () => {
    const { connectConfiguredNumber } = await import('../../src/api/web/channels.js');
    expect(await connectConfiguredNumber(prod.db, OTHER, 'owner', null)).toEqual({ code: 'not_configured' });
    expect(await connectConfiguredNumber(prod.db, OTHER, 'owner', 'not-a-number')).toEqual({ code: 'not_configured' });
  });
});
