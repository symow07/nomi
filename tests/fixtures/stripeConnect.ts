import type { StripeFetch } from '../../src/billing/stripe.js';

/** Synthetic protocol answers only. There is deliberately no network fallback. */
export function connectRecorder(answers: readonly { status?: number; body: unknown }[]) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fetch: StripeFetch = async (url, init) => {
    if (!url.startsWith('https://api.stripe.com/v1/') && url !== 'https://connect.stripe.com/oauth/token') throw new Error('Real HTTP forbidden');
    calls.push({ url, ...init });
    const answer = answers[calls.length - 1];
    if (!answer) throw new Error('Unexpected HTTP: no recorded answer');
    const status = answer.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(answer.body) };
  };
  return { calls, fetch };
}

export const CONNECT_CONFIG = { secretKey: 'test-stripe-secret-0000', clientId: 'test-connect-client-0000', webhookSecret: 'test-webhook-secret-0000', live: false } as const;
export const CONNECT_ACCOUNT = { id: 'acct_example', country: 'GB', default_currency: 'gbp', charges_enabled: true, payouts_enabled: true, details_submitted: true, type: 'standard' };
export const CHECKOUT_ANSWER = { id: 'cs_test_example', url: 'https://checkout.stripe.com/c/pay/cs_test_example', status: 'open', payment_status: 'unpaid', currency: 'gbp', amount_total: 10000, payment_intent: null, expires_at: 1800003600, metadata: { nomi_attempt: 'attempt-1' } };
export const CHARGE_ANSWER = { id: 'ch_example', payment_intent: 'pi_example', paid: true, captured: true, amount: 10000, currency: 'gbp', created: 1800000000, balance_transaction: { id: 'txn_example', amount: 10000, fee: 300, net: 9700, currency: 'gbp', created: 1800000000 } };
