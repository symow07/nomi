import { stripeForm, verifyStripeEvent, STRIPE_TIMEOUT_MS, type StripeFetch } from '../billing/stripe.js';
import { balanceTies, minorAmount, minorUnits, type BalanceFact, type ChargeFact, type Checkout, type ConnectedAccount, type ConnectEvent, type IntentFact, type PayoutFact, type RefundFact, type ReturnedBalance } from '../core/payments/paymentLink.js';
import { parseCurrency } from '../core/types/money.js';
import { signOf, type Decimal } from '../core/types/decimal.js';

export type ConnectConfig = { readonly secretKey: string; readonly clientId: string; readonly webhookSecret: string; readonly live: boolean };
export function connectConfigFrom(env: Readonly<Record<string, string | undefined>>): ConnectConfig | null {
  const secretKey = env['STRIPE_SECRET_KEY']?.trim() ?? '';
  const clientId = env['STRIPE_CONNECT_CLIENT_ID']?.trim() ?? '';
  const webhookSecret = env['STRIPE_CONNECT_WEBHOOK_SECRET']?.trim() ?? '';
  if (!secretKey || !clientId || !webhookSecret) return null;
  return { secretKey, clientId, webhookSecret, live: /_live_/.test(secretKey) };
}
export function connectAuthorization(config: ConnectConfig, state: string, redirect: string): string {
  return 'https://connect.stripe.com/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id: config.clientId, scope: 'read_write', state, redirect_uri: redirect });
}
export type ConnectResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: 'refused' | 'unavailable' | 'invalid_answer'; readonly retryable: boolean };
type CheckoutInput = { readonly attemptId: string; readonly amount: Decimal; readonly currency: string; readonly successUrl: string; readonly cancelUrl: string; readonly expiresAt: number };
export type ConnectClient = {
  exchange(code: string): Promise<ConnectResult<{ account: string; live: boolean }>>;
  deauthorize(account: string): Promise<ConnectResult<true>>;
  findCheckout(account: string, attemptId: string, from: number, to: number): Promise<ConnectResult<Checkout | null>>;
  account(account: string): Promise<ConnectResult<ConnectedAccount>>;
  createCheckout(account: string, input: CheckoutInput): Promise<ConnectResult<Checkout>>;
  checkout(account: string, id: string): Promise<ConnectResult<Checkout>>;
  expireCheckout(account: string, id: string): Promise<ConnectResult<Checkout>>;
  intent(account: string, id: string): Promise<ConnectResult<IntentFact>>;
  refund(account: string, id: string): Promise<ConnectResult<RefundFact>>;
  payout(account: string, id: string): Promise<ConnectResult<PayoutFact>>;
};
const obj = (v: unknown): Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
const idOf = (v: unknown, prefix: string): string | null => typeof v === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(v) ? v : null;
const stamp = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;
const currency = (v: unknown): string | null => typeof v === 'string' ? parseCurrency(v.toUpperCase()) : null;
function balance(v: unknown): BalanceFact | null {
  const b = obj(v), id = idOf(b['id'], 'txn'), gross = minorAmount(b['amount']), fee = minorAmount(b['fee']), net = minorAmount(b['net']), c = currency(b['currency']), created = stamp(b['created']);
  // An empty fee breakdown with zero may be pricing whose fees this response cannot expose.
  // Keep it pending unless the provider actually describes the zero fee.
  if (fee !== null && signOf(fee) === 0 && (!Array.isArray(b['fee_details']) || b['fee_details'].length === 0)) return null;
  return id && gross !== null && fee !== null && net !== null && c && created && balanceTies(gross, fee, net) ? { id, gross, fee, net, currency: c, created } : null;
}
function returnedBalance(v: unknown): ReturnedBalance | null {
  const b = obj(v), id = idOf(b['id'], 'txn'), amount = minorAmount(b['amount']), c = currency(b['currency']), created = stamp(b['created']);
  return id && amount !== null && signOf(amount) > 0 && c && created ? { id, amount, currency: c, created } : null;
}
function charge(v: unknown): ChargeFact | null {
  const b = obj(v), id = idOf(b['id'], 'ch'), amount = minorAmount(b['amount']), c = currency(b['currency']), created = stamp(b['created']);
  return id && amount !== null && signOf(amount) > 0 && c && created ? { id, amount, currency: c, created, paid: b['paid'] === true, captured: b['captured'] === true, balance: balance(b['balance_transaction']) } : null;
}
function checkout(b: Record<string, unknown>): Checkout | null {
  const id = typeof b['id'] === 'string' && /^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(b['id']) ? b['id'] : null;
  const status = b['status'], amount = minorAmount(b['amount_total']), c = currency(b['currency']), expiresAt = stamp(b['expires_at']);
  let url: string | null = null;
  if (typeof b['url'] === 'string') {
    try { const u = new URL(b['url']); if (u.protocol !== 'https:' || u.hostname !== 'checkout.stripe.com' || u.port || u.username || u.password) return null; url = u.href; } catch { return null; }
  }
  const meta = obj(b['metadata']);
  return id && ['open', 'complete', 'expired'].includes(String(status)) && amount !== null && signOf(amount) > 0 && c && expiresAt && (status !== 'open' || url !== null)
    ? { id, url, status: status as Checkout['status'], paid: b['payment_status'] === 'paid', amount, currency: c, intentId: idOf(b['payment_intent'], 'pi'), expiresAt, attemptId: typeof meta['nomi_attempt'] === 'string' ? meta['nomi_attempt'] : null } : null;
}

/** Raw provider text, credentials and customer fields never leave this adapter. No automatic retry of OAuth. */
export function connectClient(config: ConnectConfig, fetchImpl: StripeFetch = fetch as unknown as StripeFetch): ConnectClient {
  const call = async <T>(method: 'GET' | 'POST', path: string, account: string | null, params: Parameters<typeof stripeForm>[0] | null, key: string | null, read: (b: Record<string, unknown>) => T | null): Promise<ConnectResult<T>> => {
    const headers: Record<string, string> = { Authorization: `Bearer ${config.secretKey}`, 'Stripe-Version': '2024-06-20' };
    if (account) { if (!idOf(account, 'acct')) return { ok: false, reason: 'refused', retryable: false }; headers['Stripe-Account'] = account; }
    if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (key) headers['Idempotency-Key'] = key;
    try {
      const r = await fetchImpl(path.startsWith('/oauth/') ? `https://connect.stripe.com${path}` : `https://api.stripe.com/v1${path}`, { method, headers, ...(params ? { body: stripeForm(params) } : {}), signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS) });
      if (!r.ok) return { ok: false, reason: r.status >= 500 || [409, 429].includes(r.status) ? 'unavailable' : 'refused', retryable: r.status >= 500 || [409, 429].includes(r.status) };
      const value = read(obj(JSON.parse(await r.text())));
      return value === null ? { ok: false, reason: 'invalid_answer', retryable: false } : { ok: true, value };
    } catch { return { ok: false, reason: 'unavailable', retryable: true }; }
  };
  return {
    exchange: code => call('POST', '/oauth/token', null, { grant_type: 'authorization_code', code }, null, b => {
      const account = idOf(b['stripe_user_id'], 'acct');
      return account && b['livemode'] === config.live && b['scope'] === 'read_write' ? { account, live: config.live } : null;
    }),
    deauthorize: account => idOf(account, 'acct')
      ? call('POST', '/oauth/deauthorize', null, { client_id: config.clientId, stripe_user_id: account }, null, b => b['stripe_user_id'] === account ? true : null)
      : Promise.resolve({ ok: false, reason: 'refused', retryable: false }),
    findCheckout: async (account, attemptId, from, to) => {
      if (!stamp(from) || !stamp(to) || from > to) return { ok: false, reason: 'refused', retryable: false };
      let after: string | null = null, found: Checkout | null = null;
      const seen = new Set<string>();
      // A bounded, complete scan: an unavailable page can never prove absence.
      for (let page = 0; page < 100; page++) {
        const q = new URLSearchParams({ limit: '100', 'created[gte]': String(from), 'created[lte]': String(to) });
        if (after) q.set('starting_after', after);
        const r = await call('GET', `/checkout/sessions?${q}`, account, null, null, b =>
          Array.isArray(b['data']) && typeof b['has_more'] === 'boolean' ? { rows: b['data'] as unknown[], more: b['has_more'] } : null);
        if (!r.ok) return r;
        for (const item of r.value.rows) {
          const row = obj(item);
          if (obj(row['metadata'])['nomi_attempt'] !== attemptId) continue;
          const match = checkout(row);
          if (!match || (found && found.id !== match.id)) return { ok: false, reason: 'invalid_answer', retryable: false };
          found = match;
        }
        if (!r.value.more) return { ok: true, value: found };
        const last = obj(r.value.rows.at(-1))['id'];
        if (typeof last !== 'string' || !/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(last) || seen.has(last)) return { ok: false, reason: 'invalid_answer', retryable: false };
        seen.add(last); after = last;
      }
      return { ok: false, reason: 'unavailable', retryable: true };
    },
    account: account => call('GET', `/accounts/${encodeURIComponent(account)}`, null, null, null, b => {
      const c = currency(b['default_currency']);
      return b['id'] === account && typeof b['country'] === 'string' && c ? { id: account, country: b['country'], currency: c,
        ready: b['charges_enabled'] === true && b['payouts_enabled'] === true && b['details_submitted'] === true && b['type'] === 'standard' } : null;
    }),
    createCheckout: (account, i) => {
      const units = minorUnits(i.amount);
      if (units === null) return Promise.resolve({ ok: false, reason: 'refused', retryable: false });
      return call('POST', '/checkout/sessions', account, { mode: 'payment', payment_method_types: ['card'], line_items: [{ price_data: { currency: i.currency.toLowerCase(), unit_amount: units, product_data: { name: 'Invoice payment' } }, quantity: 1 }],
        success_url: i.successUrl, cancel_url: i.cancelUrl, expires_at: i.expiresAt, metadata: { nomi_attempt: i.attemptId }, payment_intent_data: { metadata: { nomi_attempt: i.attemptId } } }, `nomi-payment-${i.attemptId}`, checkout);
    },
    checkout: (a, id) => call('GET', `/checkout/sessions/${encodeURIComponent(id)}`, a, null, null, checkout),
    expireCheckout: (a, id) => call('POST', `/checkout/sessions/${encodeURIComponent(id)}/expire`, a, {}, `nomi-expire-${id}`, checkout),
    intent: (a, id) => call('GET', `/payment_intents/${encodeURIComponent(id)}?expand[]=latest_charge.balance_transaction`, a, null, null,
      b => b['id'] === id ? { id, attemptId: typeof obj(b['metadata'])['nomi_attempt'] === 'string' ? obj(b['metadata'])['nomi_attempt'] as string : null, succeeded: b['status'] === 'succeeded', charge: charge(b['latest_charge']) } : null),
    refund: (a, id) => call('GET', `/refunds/${encodeURIComponent(id)}?expand[]=balance_transaction&expand[]=failure_balance_transaction`, a, null, null, b => {
      const amount = minorAmount(b['amount']), c = currency(b['currency']), created = stamp(b['created']);
      return b['id'] === id && amount !== null && signOf(amount) > 0 && c && created && ['pending', 'succeeded', 'failed', 'canceled', 'requires_action'].includes(String(b['status']))
        ? { id, intentId: idOf(b['payment_intent'], 'pi'), amount, currency: c, created, status: b['status'] as RefundFact['status'], balance: balance(b['balance_transaction']), failureBalance: returnedBalance(b['failure_balance_transaction']) } : null;
    }),
    payout: (a, id) => call('GET', `/payouts/${encodeURIComponent(id)}?expand[]=balance_transaction&expand[]=failure_balance_transaction`, a, null, null, b => {
      const amount = minorAmount(b['amount']), c = currency(b['currency']), created = stamp(b['created']), arrival = stamp(b['arrival_date']);
      return b['id'] === id && amount !== null && signOf(amount) > 0 && c && created && arrival && ['pending', 'in_transit', 'paid', 'failed', 'canceled'].includes(String(b['status']))
        ? { id, amount, currency: c, created, arrival, status: b['status'] as PayoutFact['status'], balance: balance(b['balance_transaction']), failureBalance: returnedBalance(b['failure_balance_transaction']), destination: idOf(b['destination'], 'ba') ?? idOf(b['destination'], 'card') } : null;
    }),
  };
}

/** Only authenticated minimal identifiers are persisted. The worker retrieves current provider facts separately. */
export function verifyConnectEvent(raw: string, signature: string | undefined, config: ConnectConfig, now: number): ConnectEvent | null {
  const verified = verifyStripeEvent(raw, signature, config.webhookSecret, now);
  if (!verified) return null;
  const e = obj(JSON.parse(raw)), account = idOf(e['account'], 'acct');
  if (!account || e['livemode'] !== config.live || !idOf(verified.id, 'evt') || !stamp(verified.created) || typeof verified.object['id'] !== 'string') return null;
  return { id: verified.id, type: verified.type, created: verified.created, account, live: config.live, objectId: verified.object['id'], intentId: idOf(verified.object['payment_intent'], 'pi') };
}
