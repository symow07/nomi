import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * BILL (decision 13) — STRIPE, the payment provider (my call: the plan names
 * none; Stripe takes a card once and charges it later, which "card upfront,
 * the clock from the first channel connected" needs).
 *
 * Built against Stripe's documented API and never yet run against it: no key
 * exists until the owner makes the account and pastes two variables into
 * Railway (the never-run list in docs/PROGRESS.md). All or none —
 * STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET — and the boot says which part
 * is missing. The secret travels only in the Authorization header.
 *
 * Every request is form-encoded, as Stripe's API takes it, with nested keys in
 * brackets (`metadata[business_id]`), and carries an Idempotency-Key so a retry
 * never makes a second customer or subscription. Every answer is an outcome,
 * never a throw: `retryable` says whether trying again could help.
 */
export type StripeConfig = { readonly secretKey: string; readonly webhookSecret: string };

export function stripeConfigFrom(env: Record<string, string | undefined>): StripeConfig | null {
  const secretKey = (env['STRIPE_SECRET_KEY'] ?? '').trim();
  const webhookSecret = (env['STRIPE_WEBHOOK_SECRET'] ?? '').trim();
  if (!secretKey && !webhookSecret) return null;
  const missing: string[] = [];
  if (!/^(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}$/.test(secretKey)) missing.push('STRIPE_SECRET_KEY');
  if (!/^whsec_[A-Za-z0-9+/=]{10,}$/.test(webhookSecret)) missing.push('STRIPE_WEBHOOK_SECRET');
  if (missing.length) {
    console.warn(`Billing: ${missing.join(', ')} missing or malformed. No card can be taken and no subscription made.`);
    return null;
  }
  return { secretKey, webhookSecret };
}

export type StripeFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type StripeOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string; readonly retryable: boolean };

type Params = { readonly [key: string]: string | number | boolean | null | undefined | Params | readonly (string | Params)[] };

/** Stripe's form encoding: nested objects and arrays in brackets; null and undefined left out. Pure. */
export function stripeForm(params: Params): string {
  const out = new URLSearchParams();
  const put = (prefix: string, v: Params[string]): void => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) { v.forEach((x, i) => put(`${prefix}[${i}]`, x as Params[string])); return; }
    if (typeof v === 'object') { for (const [k, x] of Object.entries(v as Params)) put(`${prefix}[${k}]`, x); return; }
    out.append(prefix, String(v));
  };
  for (const [k, v] of Object.entries(params)) put(k, v);
  return out.toString();
}

const API = 'https://api.stripe.com/v1';
export const STRIPE_TIMEOUT_MS = 15_000;

export type StripeClient = {
  createCustomer(input: { readonly businessId: string; readonly email: string | null; readonly name: string }): Promise<StripeOutcome<{ id: string }>>;
  /** A Checkout page in setup mode: the card is saved, nothing is charged. */
  setupCheckout(input: { readonly customerId: string; readonly businessId: string; readonly successUrl: string; readonly cancelUrl: string; readonly locale: string }): Promise<StripeOutcome<{ id: string; url: string }>>;
  setupIntentPaymentMethod(setupIntentId: string): Promise<StripeOutcome<{ paymentMethod: string }>>;
  setDefaultPaymentMethod(customerId: string, paymentMethod: string): Promise<StripeOutcome<null>>;
  /** The subscription, its trial ending at `trialEnd` (unix seconds) or none. */
  createSubscription(input: { readonly customerId: string; readonly priceId: string; readonly businessId: string; readonly trialEnd: number | null }): Promise<StripeOutcome<{ id: string; status: string; currentPeriodEnd: number | null; trialEnd: number | null }>>;
  /** A price as Stripe holds it: what a plan charges, read rather than typed. */
  price(priceId: string): Promise<StripeOutcome<{ id: string; amountMinor: number; currency: string; interval: 'month' | 'year'; active: boolean }>>;
  /** Stripe's own page for the card and the invoices. */
  portal(input: { readonly customerId: string; readonly returnUrl: string; readonly locale: string }): Promise<StripeOutcome<{ url: string }>>;
};

export function stripeClient(config: StripeConfig, fetchImpl: StripeFetch = fetch as unknown as StripeFetch): StripeClient {
  const call = async <T>(method: 'GET' | 'POST', path: string, params: Params | null, idempotencyKey: string | null,
    read: (body: Record<string, unknown>) => T | null): Promise<StripeOutcome<T>> => {
    const headers: Record<string, string> = { Authorization: `Bearer ${config.secretKey}`, 'Stripe-Version': '2024-06-20' };
    if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    try {
      const res = await fetchImpl(`${API}${path}`, {
        method, headers, ...(params ? { body: stripeForm(params) } : {}), signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
      });
      const text = await res.text();
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON: said below */ }
      if (!res.ok) {
        const message = (body['error'] as { message?: string } | undefined)?.message ?? text.slice(0, 200);
        // 409 (idempotency in flight), 429 and 5xx may pass on a retry; a 4xx otherwise will not.
        return { ok: false, error: `stripe ${res.status}: ${message}`, retryable: res.status === 409 || res.status === 429 || res.status >= 500 };
      }
      const value = read(body);
      return value === null ? { ok: false, error: 'stripe: an answer without what was asked for', retryable: false } : { ok: true, value };
    } catch (e) {
      return { ok: false, error: `stripe: ${e instanceof Error ? e.message : String(e)}`, retryable: true };
    }
  };
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    createCustomer: (i) => call('POST', '/customers', { name: i.name, email: i.email, metadata: { business_id: i.businessId } },
      `customer-${i.businessId}`, (b) => (str(b['id']) ? { id: str(b['id'])! } : null)),
    setupCheckout: (i) => call('POST', '/checkout/sessions', {
      mode: 'setup', customer: i.customerId, payment_method_types: ['card'], success_url: i.successUrl, cancel_url: i.cancelUrl,
      locale: i.locale === 'zh' ? 'zh' : i.locale === 'ar' ? 'auto' : 'en', metadata: { business_id: i.businessId },
      setup_intent_data: { metadata: { business_id: i.businessId } },
    }, null, (b) => (str(b['id']) && str(b['url']) ? { id: str(b['id'])!, url: str(b['url'])! } : null)),
    setupIntentPaymentMethod: (id) => call('GET', `/setup_intents/${encodeURIComponent(id)}`, null, null,
      (b) => (str(b['payment_method']) ? { paymentMethod: str(b['payment_method'])! } : null)),
    setDefaultPaymentMethod: async (customerId, pm) => {
      // An update answers with the customer; nothing of it is kept.
      const r = await call('POST', `/customers/${encodeURIComponent(customerId)}`, { invoice_settings: { default_payment_method: pm } },
        `default-pm-${customerId}-${pm}`, (b) => (str(b['id']) ? true : null));
      return r.ok ? { ok: true, value: null } : { ok: false, error: r.error, retryable: r.retryable };
    },
    createSubscription: (i) => call('POST', '/subscriptions', {
      customer: i.customerId, items: [{ price: i.priceId }], trial_end: i.trialEnd ?? undefined,
      payment_behavior: 'allow_incomplete', metadata: { business_id: i.businessId },
    }, `subscription-${i.businessId}-${i.priceId}`, (b) => (str(b['id']) && str(b['status'])
      ? { id: str(b['id'])!, status: str(b['status'])!, currentPeriodEnd: num(b['current_period_end']), trialEnd: num(b['trial_end']) } : null)),
    price: (id) => call('GET', `/prices/${encodeURIComponent(id)}`, null, null, (b) => {
      const interval = (b['recurring'] as { interval?: unknown } | null | undefined)?.interval;
      return str(b['id']) && num(b['unit_amount']) !== null && str(b['currency']) && (interval === 'month' || interval === 'year')
        ? { id: str(b['id'])!, amountMinor: num(b['unit_amount'])!, currency: str(b['currency'])!, interval, active: b['active'] === true } : null;
    }),
    portal: (i) => call('POST', '/billing_portal/sessions', { customer: i.customerId, return_url: i.returnUrl, locale: i.locale === 'zh' ? 'zh' : 'auto' },
      null, (b) => (str(b['url']) ? { url: str(b['url'])! } : null)),
  };
}

/**
 * A webhook is Stripe's only when its signature says so: `Stripe-Signature:
 * t=<unix seconds>,v1=<hex>[,v1=…]`, the HMAC-SHA256 of `<t>.<raw body>` under
 * the endpoint's secret, compared in constant time, and no older than five
 * minutes (a replay of an old one is refused). Pure but for the clock passed in.
 */
export const STRIPE_SIGNATURE_TOLERANCE_S = 300;
export type StripeEvent = { readonly id: string; readonly type: string; readonly created: number; readonly object: Record<string, unknown> };

export function verifyStripeEvent(rawBody: string, header: string | undefined, secret: string, nowSeconds: number): StripeEvent | null {
  if (!header) return null;
  const parts = header.split(',').map((p) => p.trim().split('=') as [string, string | undefined]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k, v]) => k === 'v1' && typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)).map(([, v]) => v!);
  if (!Number.isInteger(t) || signatures.length === 0 || Math.abs(nowSeconds - t) > STRIPE_SIGNATURE_TOLERANCE_S) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'), 'utf8');
  if (!signatures.some((s) => { const b = Buffer.from(s, 'utf8'); return b.length === expected.length && timingSafeEqual(b, expected); })) return null;
  try {
    const e = JSON.parse(rawBody) as { id?: unknown; type?: unknown; created?: unknown; data?: { object?: unknown } };
    if (typeof e.id !== 'string' || typeof e.type !== 'string' || typeof e.data?.object !== 'object' || e.data.object === null) return null;
    return { id: e.id, type: e.type, created: typeof e.created === 'number' ? e.created : t, object: e.data.object as Record<string, unknown> };
  } catch {
    return null;
  }
}
