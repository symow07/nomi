import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import pg from 'pg';
import Fastify from 'fastify';
import { flashSaid } from './tenant.js';
// @ts-expect-error — the operator tool, plain JS on purpose (tools/ is not type-checked).
import * as op from '../../tools/lib/operator.mjs';

/**
 * BILL (0117) — BILLING, over Postgres and the web app, with Stripe a fake
 * behind its own client (never the network):
 *
 *   · not set up, or a pilot: nothing to pay, nothing held;
 *   · the owner chooses a plan and saves a card on Stripe's page (setup mode:
 *     nothing charged); the signed webhook makes it the default; a bad
 *     signature or a repeat changes nothing;
 *   · card upfront: while the switch is on, no channel connects without one;
 *   · the trial's clock from the first channel connected, granted on request;
 *   · Stripe's word on the subscription, newest only; a lapse holds the
 *     assistant; the owner's e-mails, each once, opening Billing;
 *   · the unit: customers answered a month — a new customer past it goes to a
 *     person, one already answered does not; practice never counts;
 *   · seats and assistants the plan allows;
 *   · the app role reads its own row, and writes nothing directly.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `b1110000-0000-4000-8000-${RUN}0001`;
const CODE = `bill-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const WHSEC = 'whsec_testsecret00000000001';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const PLAN = `starter-${RUN}`;
const PRICE = `price_${RUN}starter`;

type Call = { op: string; args: unknown };

d('BILL · billing (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let bare: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  const calls: Call[] = [];
  let failNext = false;
  const stripe: import('../../src/billing/stripe.js').StripeClient = {
    createCustomer: async (i) => { calls.push({ op: 'customer', args: i }); return { ok: true, value: { id: `cus_${RUN}${i.businessId.slice(-4)}` } }; },
    setupCheckout: async (i) => { calls.push({ op: 'checkout', args: i }); return { ok: true, value: { id: `cs_${RUN}`, url: `https://checkout.stripe.test/c/${RUN}` } }; },
    setupIntentPaymentMethod: async (id) => { calls.push({ op: 'intent', args: id }); return failNext ? (failNext = false, { ok: false, error: 'stripe 503', retryable: true }) : { ok: true, value: { paymentMethod: `pm_${RUN}` } }; },
    setDefaultPaymentMethod: async (c, pm) => { calls.push({ op: 'default', args: [c, pm] }); return { ok: true, value: null }; },
    createSubscription: async (i) => { calls.push({ op: 'subscription', args: i }); return { ok: true, value: { id: `sub_${RUN}${i.businessId.slice(-4)}`, status: i.trialEnd ? 'trialing' : 'active', currentPeriodEnd: i.trialEnd ?? Math.floor(Date.now() / 1000) + 30 * 86400, trialEnd: i.trialEnd } }; },
    price: async () => ({ ok: false, error: 'not used', retryable: false }),
    portal: async (i) => { calls.push({ op: 'portal', args: i }); return { ok: true, value: { url: `https://billing.stripe.test/p/${RUN}` } }; },
  };
  const cookieOf = (r: { headers: Record<string, unknown> }) => ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? [])
    .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=') && c !== 'yf_session=') ?? '';
  const post = (a: typeof app, cookie: string, url: string, fields: Record<string, string> = {}) =>
    a.inject({ method: 'POST', url, headers: { ...FORM, cookie }, payload: new URLSearchParams(fields).toString() });
  const get = (a: typeof app, cookie: string, url: string) => a.inject({ method: 'GET', url, headers: { cookie } });
  const hook = (event: Record<string, unknown>, secret = WHSEC, at = Math.floor(Date.now() / 1000)) => {
    const body = JSON.stringify(event);
    return app.inject({ method: 'POST', url: '/hooks/stripe', payload: body,
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}` } });
  };
  const shops: Record<'a' | 'b', { id: string; cookie: string }> = {} as Record<'a' | 'b', { id: string; cookie: string }>;
  let pilotCookie = '';
  const row = async (id: string) => (await admin.query(`select * from workspace_billing where business_id = $1`, [id])).rows[0];
  const inTenant = async <T>(id: string, fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(id); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const { hashPassword } = await import('../../src/security/password.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    db = createDb(DATABASE_URL!);
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [PILOT, `BILL installation ${RUN}`]);
    expect(await op.setPlan(admin, { id: PLAN, name: 'Starter', price: { id: PRICE, amountMinor: 4900, currency: 'usd', interval: 'month', active: true },
      customers: 2, seats: 2, assistants: 1, by: 'test' })).toBe('set');
    const base = {
      db, businessId: PILOT, accessCode: CODE, sessionSecret: SECRET, publicBaseUrl: 'https://nomi.test',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    };
    app = Fastify({ logger: false });
    registerWebApp(app, { ...base, stripe: { client: stripe, webhookSecret: WHSEC } } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    bare = Fastify({ logger: false });
    registerWebApp(bare, base as unknown as Parameters<typeof registerWebApp>[1]);
    await bare.ready();
    pilotCookie = cookieOf(await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM }));
    for (const k of ['a', 'b'] as const) {
      const email = `bill-${k}-${RUN}@shop.example`;
      const made = await provisionAccount(db, {
        factory: `BILL ${k} ${RUN}`, language: 'en', ownerName: 'Maya', email, passwordHash: await hashPassword(`bill-password-${RUN}`),
        invite: null, inviteRequired: false, termsVersion: 'abcdef012345',
        profile: { kind: 'retail', sells: 'tea', country: 'AE', website: null, teamSize: '1', channels: [] },
      });
      if (made.code !== 'created') throw new Error(made.code);
      const cookie = cookieOf(await app.inject({ method: 'POST', url: '/login', headers: FORM,
        payload: new URLSearchParams({ email, password: `bill-password-${RUN}` }).toString() }));
      expect(cookie, k).not.toBe('');
      shops[k] = { id: made.businessId, cookie };
    }
  }, 90_000);
  afterAll(async () => {
    await op.clearOperatorFlag(admin, { flag: 'billing_required', businessId: null }).catch(() => undefined);
    await admin.query(`update plans set active = false where id = $1`, [PLAN]).catch(() => undefined);
    await app?.close(); await bare?.close(); await db?.destroy(); await admin?.end();
  });

  it('NOT SET UP, OR A PILOT: nothing to pay, and the page says so', async () => {
    expect((await get(bare, shops.a.cookie, '/app/settings/billing')).body).toContain(t('en', 'billing.notConfigured'));
    expect(flashSaid(await post(bare, shops.a.cookie, '/app/settings/billing/card', { plan: PLAN }), SECRET)).toBe(t('en', 'billing.flash.notConfigured'));
    expect((await bare.inject({ method: 'POST', url: '/hooks/stripe', payload: '{}', headers: { 'content-type': 'application/json' } })).statusCode).toBe(404);
    expect((await get(app, pilotCookie, '/app/settings/billing')).body).toContain(t('en', 'billing.notBilled'));
  });

  it('A PLAN AND A CARD: Stripe\'s page in setup mode — nothing charged; one customer, by this workspace', async () => {
    const page = (await get(app, shops.a.cookie, '/app/settings/billing')).body;
    expect(page).toContain(t('en', 'billing.status.none'));
    expect(page).toContain('$49.00');
    expect(page).toContain(t('en', 'billing.plan.customers', { n: 2 }));
    const r = await post(app, shops.a.cookie, '/app/settings/billing/card', { plan: PLAN });
    expect([r.statusCode, r.headers['location']]).toEqual([302, `https://checkout.stripe.test/c/${RUN}`]);
    const checkout = calls.find((c) => c.op === 'checkout')!.args as { successUrl: string; businessId: string };
    expect(checkout).toMatchObject({ businessId: shops.a.id, successUrl: 'https://nomi.test/app/settings/billing?card=saved' });
    expect(await row(shops.a.id)).toMatchObject({ plan_id: PLAN, stripe_customer_id: `cus_${RUN}${shops.a.id.slice(-4)}`, card_saved_at: null, status: 'none' });
    // Again: the same customer, never a second.
    await post(app, shops.a.cookie, '/app/settings/billing/card', { plan: PLAN });
    expect(calls.filter((c) => c.op === 'customer')).toHaveLength(1);
    expect(flashSaid(await post(app, shops.a.cookie, '/app/settings/billing/card', { plan: 'no-such-plan' }), SECRET)).toBe(t('en', 'billing.flash.noPlan'));
  });

  it('THE SIGNED WEBHOOK saves the card; a bad signature, a repeat, or another workspace\'s session change nothing; a failure asks Stripe to retry', async () => {
    const customer = `cus_${RUN}${shops.a.id.slice(-4)}`;
    const event = (id: string, business = shops.a.id) => ({ id, type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000),
      data: { object: { mode: 'setup', customer, setup_intent: `seti_${RUN}`, metadata: { business_id: business } } } });
    expect((await hook(event(`evt_${RUN}bad`), 'whsec_notthesecret00000001')).statusCode).toBe(400);
    expect((await hook(event(`evt_${RUN}other`, shops.b.id))).statusCode).toBe(200);
    expect((await row(shops.a.id)).card_saved_at).toBeNull();
    failNext = true;
    expect((await hook(event(`evt_${RUN}card`))).statusCode, 'Stripe asked to send it again').toBe(500);
    expect((await row(shops.a.id)).card_saved_at).toBeNull();
    expect((await hook(event(`evt_${RUN}card`))).statusCode).toBe(200);
    expect((await row(shops.a.id)).card_saved_at).not.toBeNull();
    const defaults = calls.filter((c) => c.op === 'default').length;
    expect((await hook(event(`evt_${RUN}card`))).statusCode).toBe(200);
    expect(calls.filter((c) => c.op === 'default').length, 'a repeat is handled once').toBe(defaults);
    expect((await get(app, shops.a.cookie, '/app/settings/billing')).body).toContain(t('en', 'billing.status.cardSaved', { plan: 'Starter' }));
  });

  it('CARD UPFRONT: while the switch is on, no channel connects without a card — with one, the gate is open', async () => {
    expect(await op.setOperatorFlag(admin, { flag: 'billing_required', businessId: null, reason: `bill ${RUN}`, by: 'test' })).toBe(1);
    expect(flashSaid(await get(app, shops.b.cookie, '/app/connect/meta/start'), SECRET)).toBe(t('en', 'connect.flash.card'));
    expect(flashSaid(await get(app, shops.a.cookie, '/app/connect/meta/start'), SECRET)).toBe(t('en', 'connect.flash.not_configured'));
    expect(flashSaid(await get(app, pilotCookie, '/app/connect/meta/start'), SECRET)).toBe(t('en', 'connect.flash.not_configured'));
    expect(await op.clearOperatorFlag(admin, { flag: 'billing_required', businessId: null })).toBe(1);
  });

  it('THE TRIAL, granted on request, runs from the first channel connected; the subscription made once', async () => {
    expect(await op.grantTrial(admin, { businessId: shops.a.id, days: 14, by: 'operator' })).toBe('granted');
    const { subscribeSweep } = await import('../../src/pipeline/billing.js');
    expect(await subscribeSweep(db, stripe, new Date()), 'no channel yet').toBeGreaterThanOrEqual(0);
    expect((await row(shops.a.id)).stripe_subscription_id).toBeNull();
    const connected = new Date(Date.now() - 86_400_000);
    await admin.query(`insert into meta_accounts (business_id, page_id, page_name, token_ciphertext, fingerprint, scopes, connected_by, connected_at)
                       values ($1, $2, 'Tea Page', 'v1.not-a-real-token', '0123456789ab', 'pages_messaging', 'test', $3)`, [shops.a.id, `71${RUN.replace(/[^0-9]/g, '1')}`, connected]);
    await subscribeSweep(db, stripe, new Date());
    const sub = calls.filter((c) => c.op === 'subscription' && (c.args as { businessId: string }).businessId === shops.a.id);
    expect(sub).toHaveLength(1);
    expect((sub[0]!.args as { trialEnd: number }).trialEnd).toBe(Math.floor((connected.getTime() + 14 * 86_400_000) / 1000));
    const r = await row(shops.a.id);
    expect(r).toMatchObject({ status: 'trial', stripe_subscription_id: `sub_${RUN}${shops.a.id.slice(-4)}` });
    expect(new Date(r.trial_started_at).getTime()).toBe(connected.getTime());
    await subscribeSweep(db, stripe, new Date());
    expect(calls.filter((c) => c.op === 'subscription' && (c.args as { businessId: string }).businessId === shops.a.id)).toHaveLength(1);
    expect(await op.grantTrial(admin, { businessId: shops.a.id, days: 30, by: 'operator' }), 'after the subscription, Stripe holds it').toBe('subscribed');
  });

  it('STRIPE\'S WORD, newest only: past due, then lapsed — the assistant held; an older event changes nothing; paid again, released', async () => {
    const customer = `cus_${RUN}${shops.a.id.slice(-4)}`;
    const now = Math.floor(Date.now() / 1000);
    const sub = (id: string, status: string, created: number, type = 'customer.subscription.updated') => ({ id, type, created,
      data: { object: { id: `sub_${RUN}${shops.a.id.slice(-4)}`, customer, status, current_period_end: now + 86400, trial_end: null, items: { data: [{ price: { id: PRICE } }] } } } });
    const { assistantHold } = await import('../../src/db/assistantStop.js');
    expect((await hook(sub(`evt_${RUN}s1`, 'past_due', now - 30))).statusCode).toBe(200);
    expect((await row(shops.a.id)).status).toBe('past_due');
    expect(await inTenant(shops.a.id, (tx) => assistantHold(tx, shops.a.id)), 'past due: Stripe still retries, nothing held').toBeNull();
    expect((await hook(sub(`evt_${RUN}s2`, 'canceled', now - 10, 'customer.subscription.deleted'))).statusCode).toBe(200);
    expect((await row(shops.a.id)).status).toBe('lapsed');
    expect(await inTenant(shops.a.id, (tx) => assistantHold(tx, shops.a.id))).toBe('billing');
    expect((await hook(sub(`evt_${RUN}s0`, 'active', now - 60))).statusCode).toBe(200);
    expect((await row(shops.a.id)).status, 'an older event, delivered late').toBe('lapsed');
    expect((await get(app, shops.a.cookie, '/app/settings/billing')).body).toContain(t('en', 'billing.status.lapsed'));
    // The owner's e-mails, each once, opening Billing.
    const { billingAlerts } = await import('../../src/pipeline/billing.js');
    const mine = (await billingAlerts(db)).filter((j) => j.businessId === shops.a.id).map((j) => j.kind).sort();
    expect(mine, 'lapsed now: the trial-ending and failed-payment lines are for a trial and a payment in doubt').toEqual(['billing_lapsed']);
    expect((await billingAlerts(db)).filter((j) => j.businessId === shops.a.id)).toEqual([]);
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    const outbox: { to: string; subject: string; text: string }[] = [];
    const mail = { from: 'no-reply@nomi.test', send: async (m: { to: string; subject: string; text: string }) => { outbox.push(m); return { ok: true as const }; } };
    expect(await deliverOwnerAlert({ db, adapter: { sendText: async () => ({ ok: false as const, retryable: false, error: 'none' }) }, mail, publicBaseUrl: 'https://nomi.test' },
      { businessId: shops.a.id, kind: 'billing_lapsed', conversationId: null })).toBe('sent');
    expect(outbox[0]!.subject).toBe(t('en', 'notify.billing_lapsed.subject'));
    expect(outbox[0]!.text).toContain('https://nomi.test/app/settings/billing');
    expect((await hook(sub(`evt_${RUN}s3`, 'active', now))).statusCode).toBe(200);
    expect(await inTenant(shops.a.id, (tx) => assistantHold(tx, shops.a.id)), 'paid again').toBeNull();
  });

  it('THE UNIT: customers answered a month — a new one past the plan goes to a person; one already answered does not; practice never counts', async () => {
    const conv = async (business: string) => {
      const client = (await admin.query(`insert into clients (business_id, display_name) values ($1, 'C') returning id`, [business])).rows[0].id;
      return (await admin.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'messenger') returning id::text as id`, [business, client])).rows[0].id as string;
    };
    const answered = (business: string, c: string) => admin.query(`insert into conversation_events (business_id, conversation_id, type, payload) values ($1, $2, 'auto_sent', '{}')`, [business, c]);
    const { planLimitReached } = await import('../../src/db/billing.js');
    const [c1, c2, c3] = [await conv(shops.a.id), await conv(shops.a.id), await conv(shops.a.id)];
    // A reply sent alone counts its customer; so does a draft (found 2026-10-01: the drafts trigger failed every insert).
    const drafted = async (business: string, c: string) => {
      const m = `bill-${randomUUID()}`;
      await admin.query(`insert into turns (message_id, business_id, conversation_id, state_before, input, decision, engine, engine_version)
                         values ($1, $2, $3, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'service', 'test')`, [m, business, c]);
      await admin.query(`insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
                         values ($1, $2, 'quote', 'A reply', $3, 'pending')`, [business, c, m]);
    };
    await answered(shops.a.id, c1); await drafted(shops.a.id, c1); await drafted(shops.a.id, c2);
    expect((await admin.query(`select count(*)::int as n from customers_answered where business_id = $1`, [shops.a.id])).rows[0].n, 'once a month each').toBe(2);
    expect(await inTenant(shops.a.id, (tx) => planLimitReached(tx, c3))).toBe(true);
    expect(await inTenant(shops.a.id, (tx) => planLimitReached(tx, c1))).toBe(false);
    const { turnHold } = await import('../../src/db/assistantStop.js');
    expect(await inTenant(shops.a.id, (tx) => turnHold(tx, shops.a.id, c3))).toBe('plan_limit');
    // A practice copy's customer is never counted.
    const copy = randomUUID();
    await admin.query(`insert into businesses (id, name, practice_of) values ($1, $2, $3)`, [copy, `BILL copy ${RUN}`, shops.a.id]);
    await answered(copy, await conv(copy));
    expect((await admin.query(`select count(*)::int as n from customers_answered where business_id in ($1, $2)`, [shops.a.id, copy])).rows[0].n).toBe(2);
    expect((await get(app, shops.a.cookie, '/app/settings/billing')).body).toContain(t('en', 'billing.usage.customers', { n: 2, limit: 2 }));
  });

  it('SEATS AND ASSISTANTS the plan allows', async () => {
    const { addPerson } = await import('../../src/api/web/people.js');
    expect((await addPerson(db, shops.a.id, SECRET, 'Omar')).code).toBe('added');
    expect((await addPerson(db, shops.a.id, SECRET, 'Lina')).code).toBe('seat_limit');
    const { addAssistant } = await import('../../src/db/assistants.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(shops.a.id); if (!b.ok) throw new Error('fixture');
    const { validateAssistant } = await import('../../src/core/owner/assistants.js');
    const v = validateAssistant({ name: 'Second', role: 'sales', note: '', channels: [] } as Parameters<typeof validateAssistant>[0]);
    if (!v.ok) throw new Error(v.problem);
    expect(await inTenant(shops.a.id, (tx) => addAssistant(tx, b.value, v.value, 'test'))).toBe('assistant_limit');
    // A workspace with no plan has no limit.
    expect((await addPerson(db, shops.b.id, SECRET, 'Omar')).code).toBe('added');
    expect((await addPerson(db, shops.b.id, SECRET, 'Lina')).code).toBe('added');
  });

  it('STRIPE\'S PAGE for the card and the invoices', async () => {
    const r = await post(app, shops.a.cookie, '/app/settings/billing/portal');
    expect([r.statusCode, r.headers['location']]).toEqual([302, `https://billing.stripe.test/p/${RUN}`]);
  });

  it('THE APP ROLE reads its own row only, and writes nothing directly', async () => {
    const { sql } = await import('kysely');
    expect(await inTenant(shops.b.id, async (tx) => (await sql<{ n: number }>`select count(*)::int as n from workspace_billing`.execute(tx)).rows[0]!.n)).toBe(0);
    for (const stmt of [sql`update workspace_billing set status = 'active'`, sql`select * from plans`, sql`select * from customers_answered`,
      sql`select * from stripe_events`, sql`update billing_settings set self_serve_trial_days = 90`]) {
      await expect(inTenant(shops.a.id, (tx) => stmt.execute(tx))).rejects.toThrow(/permission denied/);
    }
  });
});
