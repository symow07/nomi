import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { stripeConfigFrom, stripeForm, stripeClient, verifyStripeEvent, STRIPE_SIGNATURE_TOLERANCE_S, type StripeFetch } from '../../src/billing/stripe.js';

/**
 * BILL — the Stripe client, against Stripe's documented API, with the network
 * a recorder: never run against Stripe until the owner pastes the keys.
 */

const KEY = 'sk_test_notarealkey0000000001';
const WHSEC = 'whsec_notarealsecret0000001';
const CFG = { secretKey: KEY, webhookSecret: WHSEC };

describe('BILL · the keys, both or none', () => {
  it('none is none, quietly; both is a client', () => {
    expect(stripeConfigFrom({})).toBeNull();
    expect(stripeConfigFrom({ STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: WHSEC })).toEqual(CFG);
  });
  it('half-set or misshapen is none, and says which', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(stripeConfigFrom({ STRIPE_SECRET_KEY: KEY })).toBeNull();
    expect(stripeConfigFrom({ STRIPE_SECRET_KEY: 'pk_test_publishable00000', STRIPE_WEBHOOK_SECRET: WHSEC })).toBeNull();
    expect(warn.mock.calls.map((c) => String(c[0])).join(' ')).toMatch(/STRIPE_WEBHOOK_SECRET.*STRIPE_SECRET_KEY/s);
    warn.mockRestore();
  });
});

describe('BILL · the requests', () => {
  it('form-encoded with Stripe\'s brackets; null and undefined left out', () => {
    expect(decodeURIComponent(stripeForm({ a: 1, b: null, c: undefined, metadata: { business_id: 'x' }, items: [{ price: 'p' }] })))
      .toBe('a=1&metadata[business_id]=x&items[0][price]=p');
  });
  const recorder = (answers: Record<string, { status: number; body: unknown }>) => {
    const calls: { url: string; method: string; headers: Record<string, string>; body: string | undefined }[] = [];
    const f: StripeFetch = async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers, body: init.body });
      const path = url.replace('https://api.stripe.com/v1', '');
      const a = answers[Object.keys(answers).find((k) => path.startsWith(k)) ?? ''] ?? { status: 404, body: { error: { message: 'no such route' } } };
      return { ok: a.status < 300, status: a.status, text: async () => JSON.stringify(a.body) };
    };
    return { calls, f };
  };
  it('the key only in the Authorization header; an Idempotency-Key on what must not happen twice', async () => {
    const { calls, f } = recorder({ '/customers': { status: 200, body: { id: 'cus_1' } }, '/subscriptions': { status: 200, body: { id: 'sub_1', status: 'trialing', current_period_end: 1800000000, trial_end: 1800000000 } } });
    const s = stripeClient(CFG, f);
    expect(await s.createCustomer({ businessId: 'b1', email: 'o@shop.example', name: 'Shop' })).toEqual({ ok: true, value: { id: 'cus_1' } });
    expect(await s.createSubscription({ customerId: 'cus_1', priceId: 'price_1', businessId: 'b1', trialEnd: 1800000000 }))
      .toEqual({ ok: true, value: { id: 'sub_1', status: 'trialing', currentPeriodEnd: 1800000000, trialEnd: 1800000000 } });
    for (const c of calls) {
      expect(c.headers['Authorization']).toBe(`Bearer ${KEY}`);
      expect(c.url + (c.body ?? '')).not.toContain(KEY);
      expect(c.headers['Idempotency-Key']).toBeTruthy();
    }
    expect(decodeURIComponent(calls[1]!.body!)).toContain('trial_end=1800000000');
    expect(decodeURIComponent(calls[1]!.body!)).toContain('items[0][price]=price_1');
  });
  it('setup mode saves a card and charges nothing; the portal; the setup intent\'s card', async () => {
    const { calls, f } = recorder({
      '/checkout/sessions': { status: 200, body: { id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' } },
      '/billing_portal/sessions': { status: 200, body: { url: 'https://billing.stripe.com/p/1' } },
      '/setup_intents/': { status: 200, body: { id: 'seti_1', payment_method: 'pm_1' } },
      '/customers/': { status: 200, body: { id: 'cus_1' } },
    });
    const s = stripeClient(CFG, f);
    expect(await s.setupCheckout({ customerId: 'cus_1', businessId: 'b1', successUrl: 'https://nomi.test/ok', cancelUrl: 'https://nomi.test/no', locale: 'en' }))
      .toEqual({ ok: true, value: { id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' } });
    expect(decodeURIComponent(calls[0]!.body!)).toContain('mode=setup');
    expect(decodeURIComponent(calls[0]!.body!)).not.toMatch(/price|amount/);
    expect(await s.portal({ customerId: 'cus_1', returnUrl: 'https://nomi.test/app/settings/billing', locale: 'zh' })).toEqual({ ok: true, value: { url: 'https://billing.stripe.com/p/1' } });
    expect(await s.setupIntentPaymentMethod('seti_1')).toEqual({ ok: true, value: { paymentMethod: 'pm_1' } });
    expect(await s.setDefaultPaymentMethod('cus_1', 'pm_1')).toEqual({ ok: true, value: null });
    expect(decodeURIComponent(calls.at(-1)!.body!)).toBe('invoice_settings[default_payment_method]=pm_1');
  });
  it('a price read from Stripe: amount, currency, interval — a one-off price is not a plan', async () => {
    const { f } = recorder({ '/prices/price_m': { status: 200, body: { id: 'price_m', unit_amount: 4900, currency: 'usd', recurring: { interval: 'month' }, active: true } },
      '/prices/price_once': { status: 200, body: { id: 'price_once', unit_amount: 4900, currency: 'usd', recurring: null, active: true } } });
    const s = stripeClient(CFG, f);
    expect(await s.price('price_m')).toEqual({ ok: true, value: { id: 'price_m', amountMinor: 4900, currency: 'usd', interval: 'month', active: true } });
    expect((await s.price('price_once')).ok).toBe(false);
  });
  it('a refusal says Stripe\'s words and whether a retry could help; a network failure is retryable; nothing throws', async () => {
    const s400 = stripeClient(CFG, async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'No such price' } }) }));
    expect(await s400.createSubscription({ customerId: 'c', priceId: 'p', businessId: 'b', trialEnd: null })).toEqual({ ok: false, error: 'stripe 400: No such price', retryable: false });
    const s503 = stripeClient(CFG, async () => ({ ok: false, status: 503, text: async () => 'down' }));
    expect((await s503.createCustomer({ businessId: 'b', email: null, name: 'n' })).ok === false).toBe(true);
    expect(await s503.createCustomer({ businessId: 'b', email: null, name: 'n' })).toMatchObject({ retryable: true });
    const down = stripeClient(CFG, async () => { throw new Error('ECONNRESET'); });
    expect(await down.portal({ customerId: 'c', returnUrl: 'r', locale: 'en' })).toEqual({ ok: false, error: 'stripe: ECONNRESET', retryable: true });
  });
});

describe('BILL · a webhook is Stripe\'s only when its signature says so', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: { id: 'in_1', customer: 'cus_1' } } });
  const sign = (t: number, b = body, secret = WHSEC) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${b}`).digest('hex')}`;
  const now = 1_800_000_000;
  it('a good signature, within five minutes: the event', () => {
    expect(verifyStripeEvent(body, sign(now), WHSEC, now)).toEqual({ id: 'evt_1', type: 'invoice.paid', object: { id: 'in_1', customer: 'cus_1' } });
    expect(verifyStripeEvent(body, `${sign(now)},v1=${'0'.repeat(64)}`, WHSEC, now + 10)).not.toBeNull();
  });
  it('anything else is refused: no header, another secret, a changed body, an old one, a malformed header', () => {
    expect(verifyStripeEvent(body, undefined, WHSEC, now)).toBeNull();
    expect(verifyStripeEvent(body, sign(now, body, 'whsec_another000000000'), WHSEC, now)).toBeNull();
    expect(verifyStripeEvent(body.replace('in_1', 'in_2'), sign(now), WHSEC, now)).toBeNull();
    expect(verifyStripeEvent(body, sign(now - STRIPE_SIGNATURE_TOLERANCE_S - 1), WHSEC, now)).toBeNull();
    expect(verifyStripeEvent(body, 'v1=abc', WHSEC, now)).toBeNull();
    expect(verifyStripeEvent('not json', sign(now, 'not json'), WHSEC, now)).toBeNull();
  });
});
