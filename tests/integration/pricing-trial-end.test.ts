import { settingsHref } from '../../src/api/web/settingsNavigation.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import pg from 'pg';
import Fastify from 'fastify';
import { flashSaid } from './tenant.js';
// @ts-expect-error — the operator tool, plain JS on purpose (tools/ is not type-checked).
import * as op from '../../tools/lib/operator.mjs';

/**
 * 4.1 — THE PRICE, AND THE TRIAL'S END, over Postgres and the web app, Stripe a fake behind its own client:
 *
 *   · CARD UP FRONT (already end to end, 0117 + D4): a card saved, a trial from the first channel; three days before
 *     its end the owner is told; Stripe's charge at the end fails (past due: told, nothing held); Stripe gives up
 *     (lapsed): held, told once.
 *   · NO CARD (0240): while `billing_required` is on, a workspace that connected without a card and whose trial is
 *     over is held exactly as a lapse is, told once (`billing_trial_over`), every page and refusal saying why;
 *     saving a card, or the switch off, lifts it; a trial still running, a pilot, or the switch off holds nothing.
 *   · BILLING says the plan row's figures, the trial on request or its stored days, the card asked first, and what
 *     the trial's end does.
 *   · THE SITE names the plan only from the row: none on offer (or payments not set up), no section.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `b4100000-0000-4000-8000-${RUN}0001`;
const CODE = `p41-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const WHSEC = 'whsec_testsecret00000000041';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const PLAN = `launch-${RUN}`;
const PRICE = `price_${RUN}launch`;
const DAY = 86_400_000;

d('4.1 · the price and the trial\'s end (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let bare: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  const calls: { op: string; args: unknown }[] = [];
  const stripe: import('../../src/billing/stripe.js').StripeClient = {
    createCustomer: async (i) => { calls.push({ op: 'customer', args: i }); return { ok: true, value: { id: `cus_${RUN}${i.businessId.slice(-4)}` } }; },
    setupCheckout: async (i) => { calls.push({ op: 'checkout', args: i }); return { ok: true, value: { id: `cs_${RUN}`, url: `https://checkout.stripe.test/c/${RUN}` } }; },
    setupIntentPaymentMethod: async () => ({ ok: true, value: { paymentMethod: `pm_${RUN}` } }),
    setDefaultPaymentMethod: async () => ({ ok: true, value: null }),
    createSubscription: async (i) => { calls.push({ op: 'subscription', args: i }); return { ok: true, value: { id: `sub_${RUN}${i.businessId.slice(-4)}`, status: i.trialEnd ? 'trialing' : 'active', currentPeriodEnd: i.trialEnd ?? Math.floor(Date.now() / 1000) + 30 * 86400, trialEnd: i.trialEnd } }; },
    price: async () => ({ ok: false, error: 'not used', retryable: false }),
    portal: async () => ({ ok: true, value: { url: `https://billing.stripe.test/p/${RUN}` } }),
  };
  const cookieOf = (r: { headers: Record<string, unknown> }) => ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? [])
    .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=') && c !== 'yf_session=') ?? '';
  const post = (a: typeof app, cookie: string, url: string, fields: Record<string, string> = {}) =>
    a.inject({ method: 'POST', url, headers: { ...FORM, cookie }, payload: new URLSearchParams(fields).toString() });
  const get = (a: typeof app, cookie: string, url: string) => a.inject({ method: 'GET', url: settingsHref(url), headers: { cookie } });
  const hook = (event: Record<string, unknown>) => {
    const body = JSON.stringify(event);
    const at = Math.floor(Date.now() / 1000);
    return app.inject({ method: 'POST', url: '/hooks/stripe', payload: body,
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${at},v1=${createHmac('sha256', WHSEC).update(`${at}.${body}`).digest('hex')}` } });
  };
  type Shop = { id: string; cookie: string };
  type Kind = 'card' | 'nocard' | 'running' | 'none' | 'medium';
  const shops: Record<Kind, Shop> = {} as Record<Kind, Shop>;
  let pilotCookie = '';
  let defaultDays: number | null = null;
  const row = async (id: string) => (await admin.query(`select * from workspace_billing where business_id = $1`, [id])).rows[0];
  const connect = (id: string, at: Date) => admin.query(
    `insert into meta_accounts (business_id, page_id, page_name, token_ciphertext, fingerprint, scopes, connected_by, connected_at)
     values ($1, $2, 'Shop Page', 'v1.not-a-real-token', '0123456789ab', 'pages_messaging', 'test', $3)`,
    [id, `41${randomUUID().replace(/[^0-9]/g, '').slice(0, 12)}`, at]);
  const inTenant = async <T>(id: string, fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(id); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const hold = async (id: string) => {
    const { assistantHold } = await import('../../src/db/assistantStop.js');
    const { billingHoldReason } = await import('../../src/db/billing.js');
    return { hold: await inTenant(id, (tx) => assistantHold(tx, id)), why: await inTenant(id, (tx) => billingHoldReason(tx)) };
  };
  /** One claim (it claims for every workspace at once), read for each id asked. */
  const claimFor = async (...ids: string[]) => {
    const { billingAlerts } = await import('../../src/pipeline/billing.js');
    const all = await billingAlerts(db);
    return ids.map((id) => all.filter((j) => j.businessId === id).map((j) => j.kind).sort());
  };
  const mine = async (id: string) => (await claimFor(id))[0]!;
  const flagOn = () => op.setOperatorFlag(admin, { flag: 'billing_required', businessId: null, reason: `p41 ${RUN}`, by: 'test' });
  const flagOff = () => op.clearOperatorFlag(admin, { flag: 'billing_required', businessId: null });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const { hashPassword } = await import('../../src/security/password.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    db = createDb(DATABASE_URL!);
    defaultDays = (await admin.query(`select self_serve_trial_days as d from billing_settings where id`)).rows[0]?.d ?? null;
    await admin.query(`update billing_settings set self_serve_trial_days = null where id`);
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [PILOT, `4.1 installation ${RUN}`]);
    expect(await op.setPlan(admin, { id: PLAN, name: 'Nomi', price: { id: PRICE, amountMinor: 4900, currency: 'usd', interval: 'month', active: true },
      customers: 300, assistants: 1, by: 'test' })).toBe('set');
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
    for (const k of ['card', 'nocard', 'running', 'none', 'medium'] as const) {
      const email = `p41-${k}-${RUN}@shop.example`;
      const made = await provisionAccount(db, {
        factory: `4.1 ${k} ${RUN}`, language: 'en', ownerName: 'Maya', email, passwordHash: await hashPassword(`p41-password-${RUN}`),
        invite: null, inviteRequired: false, termsVersion: 'abcdef012345',
        profile: { kind: 'retail', sells: 'candles', country: 'AE', website: null, teamSize: '1', channels: [] },
      });
      if (made.code !== 'created') throw new Error(made.code);
      const cookie = cookieOf(await app.inject({ method: 'POST', url: '/login', headers: FORM,
        payload: new URLSearchParams({ email, password: `p41-password-${RUN}` }).toString() }));
      expect(cookie, k).not.toBe('');
      shops[k] = { id: made.businessId, cookie };
    }
  }, 90_000);
  afterAll(async () => {
    await flagOff().catch(() => undefined);
    await admin?.query(`update billing_settings set self_serve_trial_days = $1 where id`, [defaultDays]).catch(() => undefined);
    await admin?.query(`update plans set active = false where id = $1`, [PLAN]).catch(() => undefined);
    await app?.close(); await bare?.close(); await db?.destroy(); await admin?.end();
  });

  it('BILLING says the row\'s figures: the price a month, customers a month and this month\'s count, the trial on request, card up front', async () => {
    expect(await flagOn()).toBe(1);
    const page = (await get(app, shops.card.cookie, '/app/settings/billing')).body;
    expect(page).toContain('$49.00');
    expect(page).toContain(t('en', 'billing.price.month', { price: '$49.00' }));
    expect(page).toContain(t('en', 'billing.plan.customers', { n: 300 }));
    expect(page).toContain(t('en', 'billing.trial.onRequest'));
    expect(page).toContain(t('en', 'billing.cardFirst'));
    expect(page).toContain(t('en', 'billing.trialEnd.charged'));
    expect(page).toContain(t('en', 'billing.trialEnd.noCard'));
    expect(page).toContain(t('en', 'billing.noChargeYet'));
    // A trial the operator granted: its days, from the row — and the switch off, no card asked first.
    expect(await op.grantTrial(admin, { businessId: shops.card.id, days: 14, by: 'operator' })).toBe('granted');
    expect(await flagOff()).toBe(1);
    const granted = (await get(app, shops.card.cookie, '/app/settings/billing')).body;
    expect(granted).toContain(t('en', 'billing.trial', { days: 14 }));
    expect(granted).not.toContain(t('en', 'billing.trial.onRequest'));
    expect(granted).not.toContain(t('en', 'billing.cardFirst'));
    expect(granted).not.toContain(t('en', 'billing.trialEnd.noCard'));
  });

  it('CARD UP FRONT, already end to end: told three days before the trial ends; a failed charge holds nothing; Stripe giving up holds, told once', async () => {
    const shop = shops.card;
    const customer = `cus_${RUN}${shop.id.slice(-4)}`;
    expect((await post(app, shop.cookie, '/app/settings/billing/card', { plan: PLAN })).statusCode).toBe(302);
    expect((await hook({ id: `evt_${RUN}card`, type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000),
      data: { object: { mode: 'setup', customer, setup_intent: `seti_${RUN}`, metadata: { business_id: shop.id } } } })).statusCode).toBe(200);
    expect((await row(shop.id)).card_saved_at).not.toBeNull();
    // The first channel 12 days ago: a 14-day trial ends in two days.
    await connect(shop.id, new Date(Date.now() - 12 * DAY));
    const { subscribeSweep } = await import('../../src/pipeline/billing.js');
    await subscribeSweep(db, stripe, new Date());
    expect((await row(shop.id)).status).toBe('trial');
    expect(await mine(shop.id)).toEqual(['billing_trial_ending']);
    expect(await mine(shop.id)).toEqual([]);
    expect(await hold(shop.id)).toEqual({ hold: null, why: null });
    // The trial's end: Stripe charges the card, and the charge fails.
    const now = Math.floor(Date.now() / 1000);
    const sub = (id: string, status: string, created: number, type = 'customer.subscription.updated') => ({ id, type, created,
      data: { object: { id: `sub_${RUN}${shop.id.slice(-4)}`, customer, status, current_period_end: now + 86400, trial_end: now - 60, items: { data: [{ price: { id: PRICE } }] } } } });
    expect((await hook(sub(`evt_${RUN}pd`, 'past_due', now - 30))).statusCode).toBe(200);
    expect(await hold(shop.id), 'past due: Stripe still retries').toEqual({ hold: null, why: null });
    expect(await mine(shop.id)).toEqual(['billing_payment_failed']);
    // Stripe gives up: lapsed, held, told once.
    expect((await hook(sub(`evt_${RUN}gone`, 'canceled', now - 10, 'customer.subscription.deleted'))).statusCode).toBe(200);
    expect(await hold(shop.id)).toEqual({ hold: 'billing', why: 'lapsed' });
    expect(await mine(shop.id)).toEqual(['billing_lapsed']);
    expect(await mine(shop.id)).toEqual([]);
    expect((await get(app, shop.cookie, '/app')).body).toContain(t('en', 'frozen.banner.title'));
    // Paid again: released.
    expect((await hook(sub(`evt_${RUN}paid`, 'active', now))).statusCode).toBe(200);
    expect(await hold(shop.id)).toEqual({ hold: null, why: null });
  });

  it('NO CARD (0240): the switch off holds nothing; on, the trial over holds as a lapse does, told once; a card lifts it', async () => {
    const shop = shops.nocard;
    expect(await op.grantTrial(admin, { businessId: shop.id, days: 14, by: 'operator' })).toBe('granted');
    await connect(shop.id, new Date(Date.now() - 20 * DAY));
    // Before 0240: no card, a channel, a trial long over — and nothing ever held it.
    expect(await hold(shop.id)).toEqual({ hold: null, why: null });
    expect(await mine(shop.id)).toEqual([]);
    expect(await flagOn()).toBe(1);
    expect(await hold(shop.id)).toEqual({ hold: 'billing', why: 'trial_over' });
    const { billingHeld } = await import('../../src/db/billing.js');
    expect(await inTenant(shop.id, (tx) => billingHeld(tx)), 'the one question D4 freezes on').toBe(true);
    // Told once, by its own alert, opening Billing.
    expect(await mine(shop.id)).toEqual(['billing_trial_over']);
    expect(await mine(shop.id)).toEqual([]);
    expect((await row(shop.id)).told_trial_over_at).not.toBeNull();
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    const outbox: { to: string; subject: string; text: string }[] = [];
    const mail = { from: 'no-reply@nomi.test', send: async (m: { to: string; subject: string; text: string }) => { outbox.push(m); return { ok: true as const }; } };
    expect(await deliverOwnerAlert({ db, adapter: { sendText: async () => ({ ok: false as const, retryable: false, error: 'none' }) }, mail, publicBaseUrl: 'https://nomi.test' },
      { businessId: shop.id, kind: 'billing_trial_over', conversationId: null })).toBe('sent');
    expect(outbox[0]!.subject).toBe(t('en', 'notify.billing_trial_over.subject'));
    expect(outbox[0]!.text).toContain(t('en', 'notify.billing_trial_over'));
    expect(outbox[0]!.text).toContain('https://nomi.test/app/settings/billing');
    // Every page says why in true words; a write is refused with them; Billing is the way back.
    const today = (await get(app, shop.cookie, '/app')).body;
    expect(today).toContain(t('en', 'frozen.trialOver.title'));
    expect(today).not.toContain(t('en', 'frozen.banner.title'));
    expect(flashSaid(await post(app, shop.cookie, '/app/settings', { name: 'x' }), SECRET)).toBe(t('en', 'frozen.refused.trialOver'));
    const billing = (await get(app, shop.cookie, '/app/settings/billing')).body;
    expect(billing).toContain(t('en', 'billing.status.trialOver'));
    expect(billing).not.toContain(t('en', 'billing.noChargeYet'));
    expect(billing).not.toContain(t('en', 'billing.cardFirst'));
    // Choosing the plan and saving the card stay open while frozen; the card lifts the hold at once.
    expect((await post(app, shop.cookie, '/app/settings/billing/card', { plan: PLAN })).statusCode).toBe(302);
    const customer = `cus_${RUN}${shop.id.slice(-4)}`;
    expect((await hook({ id: `evt_${RUN}nocard`, type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000),
      data: { object: { mode: 'setup', customer, setup_intent: `seti_${RUN}b`, metadata: { business_id: shop.id } } } })).statusCode).toBe(200);
    expect(await hold(shop.id)).toEqual({ hold: null, why: null });
    // The sweep then makes the subscription, charged now: the trial is already over.
    const { subscribeSweep } = await import('../../src/pipeline/billing.js');
    await subscribeSweep(db, stripe, new Date());
    const made = calls.filter((c) => c.op === 'subscription' && (c.args as { businessId: string }).businessId === shop.id);
    expect(made).toHaveLength(1);
    expect((made[0]!.args as { trialEnd: number | null }).trialEnd).toBeNull();
    expect(await mine(shop.id), 'told once, ever').toEqual([]);
  });

  it('NO CARD: a trial still running, none granted (on request), the switch off, and a pilot', async () => {
    // Connected two days ago with 14 days granted: still running, not held.
    expect(await op.grantTrial(admin, { businessId: shops.running.id, days: 14, by: 'operator' })).toBe('granted');
    await connect(shops.running.id, new Date(Date.now() - 2 * DAY));
    // No trial granted and none by default (on request): none to wait for — held from the first channel.
    await connect(shops.none.id, new Date(Date.now() - 60_000));
    expect(await hold(shops.running.id)).toEqual({ hold: null, why: null });
    expect(await hold(shops.none.id)).toEqual({ hold: 'billing', why: 'trial_over' });
    expect(await claimFor(shops.running.id, shops.none.id)).toEqual([[], ['billing_trial_over']]);
    // The pilot never.
    expect(await hold(PILOT)).toEqual({ hold: null, why: null });
    expect((await get(app, pilotCookie, '/app/settings/billing')).body).toContain(t('en', 'billing.notBilled'));
    // The switch off: lifted at once.
    expect(await flagOff()).toBe(1);
    expect(await hold(shops.none.id)).toEqual({ hold: null, why: null });
    expect((await get(app, shops.none.cookie, '/app')).body).not.toContain(t('en', 'frozen.trialOver.title'));
  });

  it('D2 · THE SWITCH OFF CHANGES NOTHING FOR ANYONE: a medium-risk sign-up keeps its card gate at connect, and is never held or told', async () => {
    const shop = shops.medium;
    await flagOff();
    await admin.query(`insert into signup_risk (business_id, tier, points) values ($1, 'medium', 5)
                       on conflict (business_id) do update set tier = 'medium'`, [shop.id]);
    // A mailbox an hour ago, no card, no trial (a medium sign-up gets none).
    await admin.query(`insert into mail_accounts (business_id, provider, address, refresh_token_ciphertext, fingerprint, scopes, connected_by, connected_at)
                       values ($1, 'google', $2, 'v1.not-a-real-token', '0123456789ab', 'x', 'test', now() - interval '1 hour')`, [shop.id, `p41-medium-${RUN}@shop.example`]);
    const { cardNeeded } = await import('../../src/db/billing.js');
    expect(await inTenant(shop.id, (tx) => cardNeeded(tx)), '0148: a medium sign-up still needs a card to connect').toBe(true);
    expect(await hold(shop.id), 'switch off: not held').toEqual({ hold: null, why: null });
    expect(await mine(shop.id), 'switch off: never told').toEqual([]);
    expect((await get(app, shop.cookie, '/app')).body).not.toContain('id="frozen"');
    const billing = (await get(app, shop.cookie, '/app/settings/billing')).body;
    expect(billing).toContain(t('en', 'billing.cardFirst'));
    expect(billing, 'no freeze is promised while the switch is off').not.toContain(t('en', 'billing.trialEnd.noCard'));
    // The switch on: the same rule as everyone's.
    expect(await flagOn()).toBe(1);
    expect(await hold(shop.id)).toEqual({ hold: 'billing', why: 'trial_over' });
    expect(await mine(shop.id)).toEqual(['billing_trial_over']);
    expect(await flagOff()).toBe(1);
    expect(await hold(shop.id)).toEqual({ hold: null, why: null });
  });

  it('THE SITE: the plan row, only — none on offer, or payments not set up, and there is no section', async () => {
    const site = (a: typeof app) => a.inject({ method: 'GET', url: '/site', headers: { 'accept-language': 'en' } });
    await flagOff();
    const html = (await site(app)).body;
    expect(html).toContain('id="site-price"');
    expect(html).toContain('<h3>Nomi</h3>');
    expect(html).toContain(t('en', 'site.price.month', { price: '$49.00' }));
    expect(html).toContain(t('en', 'site.price.customers', { n: 300 }));
    expect(html).toContain(t('en', 'site.price.trialOnRequest'));
    expect(html, 'the switch is off: no card asked first').not.toContain(t('en', 'site.price.card'));
    expect(await flagOn()).toBe(1);
    expect((await site(app)).body).toContain(t('en', 'site.price.card'));
    expect(await flagOff()).toBe(1);
    expect((await site(bare)).body, 'payments not set up').not.toContain('site-price');
    // No plan on offer: the site as rule 12 has it. Every active plan is switched off for the check, then back.
    const active = (await admin.query(`select id from plans where active`)).rows.map((r: { id: string }) => r.id);
    await admin.query(`update plans set active = false where id = any($1)`, [active]);
    try {
      const none = (await site(app)).body;
      expect(none).not.toContain('site-price');
      expect(none.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ')).not.toMatch(/[$€£¥￥]\s*\d/);
    } finally {
      await admin.query(`update plans set active = true where id = any($1)`, [active]);
    }
  });
});
