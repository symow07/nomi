import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID, createHmac } from 'node:crypto';
import pg from 'pg';
import { runDigits, flashSaid } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { Analysis } from '../../src/core/conversation/decide.js';

/**
 * G4 — SENDING ALONE IS EARNED in a workspace that signed itself up (0102), in
 * production's own composition: a signed webhook → the worker → commitTurn,
 * and the owner's two routes that grant it.
 *
 *   · Every capability set to auto, and still each reply drafts — recorded as
 *     `autonomy_withheld: not_earned`, and the card says why.
 *   · Both grant routes refuse a level above "waits", and a single grant;
 *     "waits" is never refused. The page says replies wait for now.
 *   · Once earned (`auto_earned_at`), the same reply goes alone.
 *   · A practice copy answers as its workspace does; a workspace the operator
 *     made is never held by it.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd940000-0000-4000-8000-${RUN}0001`;
const COPY = `dd940000-0000-4000-8000-${RUN}0002`;
const MADE = `dd940000-0000-4000-8000-${RUN}0003`;
const CODE = `g4-${RUN}`;
const WEB_SECRET = createHmac('sha256', 'c'.repeat(64)).update('yf-web-session').digest('hex');
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

d('G4 · sending alone is earned (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let admin: pg.Client;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let cookie = '';
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();

  const q = async <R>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<R>, id = BIZ): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(id); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };
  const writes = async (from: string, text: string) => {
    const w = sim.inboundText({ from, text });
    expect((await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } })).statusCode).toBe(200);
    return until(() => q(async (tx) => (await sql<{ conv: string; drafts: number; outbound: number; withheld: unknown }>`
      select c.id::text as conv,
             (select count(*)::int from drafts dr where dr.conversation_id = c.id) as drafts,
             (select count(*)::int from outbound_messages om where om.conversation_id = c.id and om.origin = 'employee') as outbound,
             (select payload from conversation_events e where e.conversation_id = c.id and e.type = 'autonomy_withheld' order by e.created_at desc limit 1) as withheld
        from conversations c join clients cl on cl.id = c.client_id
       where c.business_id = ${BIZ}::uuid and cl.phone like ${`%${from}`}`.execute(tx)).rows
      .find((r) => r.drafts > 0 || r.outbound > 0)), `the turn for "${text}"`);
  };
  const post = (url: string, payload: string) => prod.app.inject({ method: 'POST', url, payload, headers: { cookie, ...FORM } });
  const modes = () => q(async (tx) => Object.fromEntries((await sql<{ capability: string; mode: string }>`
    select capability, mode from autonomy_policy where business_id = ${BIZ}::uuid`.execute(tx)).rows.map((r) => [r.capability, r.mode])));

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    sim = whatsappSimulator([], { tag: `g4${RUN}` });
    // A workspace that signed itself up, everything else ready to send alone:
    // a live channel, a confirmed name, every capability but orders on auto.
    await admin.query(`insert into businesses (id, name, engine, kind, owner_locale, signed_up_at, batch_debounce_ms, batch_max_window_ms)
                       values ($1, 'Juniper Candles', 'service', 'brand', 'en', now(), 300, 10000)`, [BIZ]);
    await admin.query(`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                       values ($1, 'whatsapp', 'connected', '+971 50****0094', now(), now(), 'test', false)`, [BIZ]);
    await admin.query(`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                       values ($1, 'whatsapp', $2, 'sim-test', 'service')`, [BIZ, sim.phoneNumberId]);
    await admin.query(`insert into assistants (business_id, name, is_default) values ($1, 'Lily', true)`, [BIZ]);
    await admin.query(`insert into onboarding_state (business_id, assistant_named_at) values ($1, now())
                       on conflict (business_id) do update set assistant_named_at = now()`, [BIZ]);
    await admin.query(`insert into autonomy_policy (business_id, capability, mode)
                       select $1, c, case when c = 'confirm_order' then 'draft' else 'auto' end
                         from unnest(array['greet','qualify','recommend','quote','negotiate','confirm_order','follow_up']) c
                       on conflict (business_id, capability) do update set mode = excluded.mode`, [BIZ]);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    process.env['OWNER_ACCESS_CODE'] = CODE;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'g4-verify-token-xxxx', CREDENTIAL_KEY: 'c'.repeat(64), PORT: 0,
      PUBLIC_BASE_URL: 'https://app.example.test',
    }, { adapter: sim.adapter, logger: false, media: {}, models: { analyzer, replyWriter } } as Parameters<typeof buildProduction>[1]);
    const login = await prod.app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM });
    cookie = ([] as string[]).concat(login.headers['set-cookie'] as string | string[] ?? [])
      .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=') && c !== 'yf_session=') ?? '';
    expect(cookie).not.toBe('');
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification', wantsPerson: false,
    } satisfies Analysis;
  }, 60_000);
  afterAll(async () => { await admin?.end(); await prod?.close(); });

  it('NOT EARNED: every capability on auto, and the reply still waits — recorded, and the card says why', async () => {
    replyWriter.replies = ['Yes, the juniper candle is in stock.'];
    const r = await writes(`9715${runDigits(RUN, 6)}1`, 'Is the juniper candle in stock?');
    expect(r).toMatchObject({ drafts: 1, outbound: 0 });
    expect(r.withheld).toMatchObject({ reason: 'not_earned' });
    const card = await prod.app.inject({ method: 'GET', url: `/app/inbox/${r.conv}`, headers: { cookie } });
    expect(card.body).toContain(t('en', 'inbox.draft.held.not_earned', { name: 'Lily' }));
  }, 120_000);

  it('BOTH GRANT ROUTES refuse; "waits" is never refused; the page says replies wait for now', async () => {
    const before = await modes();
    const talks = await post('/app/employee/autonomy', 'level=sells');
    expect(flashSaid(talks, WEB_SECRET)).toBe(t('en', 'autonomy.flash.notEarned'));
    const one = await post('/app/employee/capability/greet/promote', '');
    expect(flashSaid(one, WEB_SECRET)).toBe(t('en', 'autonomy.flash.notEarned'));
    expect(await modes()).toEqual(before);
    const page = await prod.app.inject({ method: 'GET', url: '/app/employee', headers: { cookie } });
    expect(page.body).toContain(t('en', 'autonomy.notEarned.title'));
    expect(page.body).toContain(t('en', 'autonomy.notEarned.stepDown'));
    expect(page.body).not.toContain('name="level" value="sells"');
    const waits = await post('/app/employee/autonomy', 'level=waits');
    expect(flashSaid(waits, WEB_SECRET)).toBe(t('en', 'autonomy.flash.saved'));
    expect(Object.values(await modes()).every((m) => m === 'draft')).toBe(true);
  }, 60_000);

  it('A PRACTICE COPY answers as its workspace; a workspace the operator made is never held', async () => {
    const { sendingAloneEarned } = await import('../../src/db/earned.js');
    await admin.query(`insert into businesses (id, name, practice_of) values ($1, $2, $3)`, [COPY, `Juniper practice ${RUN}`, BIZ]);
    await admin.query(`insert into businesses (id, name) values ($1, $2)`, [MADE, `Operator made ${RUN}`]);
    expect(await q((tx) => sendingAloneEarned(tx), COPY)).toBe(false);
    expect(await q((tx) => sendingAloneEarned(tx), MADE)).toBe(true);
  });

  it('EARNED: the level is saved, and the same reply goes alone', async () => {
    const { sendingAloneEarned } = await import('../../src/db/earned.js');
    await admin.query(`update businesses set auto_earned_at = now() where id = $1`, [BIZ]);
    expect(await q((tx) => sendingAloneEarned(tx), COPY)).toBe(true);
    const talks = await post('/app/employee/autonomy', 'level=talks');
    expect(flashSaid(talks, WEB_SECRET)).toBe(t('en', 'autonomy.flash.saved'));
    replyWriter.replies = ['Yes, the cedar candle is in stock.'];
    const r = await writes(`9715${runDigits(RUN, 6)}2`, 'Is the cedar candle in stock?');
    expect(r.outbound).toBeGreaterThan(0);
  }, 120_000);
});
