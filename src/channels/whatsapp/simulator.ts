import type { ChannelAdapter } from '../contract.js';
import type { FetchLike } from './client.js';
import { whatsappAdapter } from './adapter.js';
import { signBody } from './signature.js';

/**
 * M3 — Deterministic local WhatsApp provider simulator.
 *
 * DEVELOPMENT AND AUTOMATED TESTS ONLY. It exists because the real 360dialog
 * sandbox key is an external blocker; it simulates the provider's OBSERVABLE
 * behavior (HTTP responses, webhook payloads, failure modes) so the whole M3
 * suite runs green locally. It never fakes production behavior: the real
 * adapter code path (client, parser, signature check) is exercised unchanged —
 * only the network is scripted.
 */

const FORBID_PRODUCTION = () => {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('whatsapp simulator must never load in production');
  }
};

/** One scripted behavior per sendText call, consumed in order. */
export type SendBehavior =
  | 'ok'                    // 201 + message id
  | 'http500'               // transient provider failure → retryable
  | 'http429'               // rate limited → retryable
  | 'http400_window'        // 24h window expired (re-engagement required) → NOT retryable
  | 'http400_template'      // template unknown/rejected → NOT retryable
  | 'http401'               // credential invalid → NOT retryable
  | 'network_down';         // connection loss → retryable

export const SIMULATOR_SECRET = 'sim-webhook-secret-not-a-real-credential';

export type Simulator = {
  readonly adapter: ChannelAdapter;
  /** wamids of successful sends, in order. */
  readonly sentIds: readonly string[];
  readonly sendCount: () => number;
  /** Build a SIGNED raw webhook body + headers, as the provider would POST. */
  inboundText(args: { from?: string; text: string; name?: string; at?: Date }): SignedWebhook;
  inboundImage(args: { from?: string; caption?: string | null; at?: Date }): SignedWebhook;
  status(wamid: string, status: 'sent' | 'delivered' | 'read' | 'failed', args?: { at?: Date; errorTitle?: string }): SignedWebhook;
};

export type SignedWebhook = {
  readonly rawBody: string;
  readonly headers: { readonly 'x-hub-signature-256': string };
  readonly payload: unknown;
};

export const SIM_PHONE_NUMBER_ID = 'SIM_PNID_1';
const SIM_BUYER = '971500000001';

export function whatsappSimulator(script: readonly SendBehavior[] = []): Simulator {
  FORBID_PRODUCTION();

  let sendN = 0;
  let eventN = 0;
  const remaining = [...script];
  const sentIds: string[] = [];

  const fetchImpl: FetchLike = async (_url, init) => {
    sendN += 1;
    const behavior = remaining.shift() ?? 'ok';
    switch (behavior) {
      case 'ok': {
        const id = `wamid.SIM_OUT_${sendN}`;
        sentIds.push(id);
        void init;
        return { status: 201, text: async () => JSON.stringify({ messages: [{ id }] }) };
      }
      case 'http500':
        return { status: 500, text: async () => '{"error":"internal"}' };
      case 'http429':
        return { status: 429, text: async () => '{"error":"rate limited"}' };
      case 'http400_window':
        return { status: 400, text: async () => JSON.stringify({ error: { code: 131047, title: 'Re-engagement message required' } }) };
      case 'http400_template':
        return { status: 400, text: async () => JSON.stringify({ error: { code: 132001, title: 'Template does not exist or not approved' } }) };
      case 'http401':
        return { status: 401, text: async () => '{"error":"invalid api key"}' };
      case 'network_down':
        throw new Error('ECONNREFUSED (simulated)');
    }
  };

  const adapter = whatsappAdapter({
    baseUrl: 'https://simulator.invalid',
    apiKey: 'sim-key-not-a-real-credential',
    webhookSecret: SIMULATOR_SECRET,
    fetchImpl,
  });
  // The contract reports the truth: this is the simulator, not 360dialog.
  const simAdapter: ChannelAdapter = { ...adapter, provider: 'simulator' };

  const sign = (payload: unknown): SignedWebhook => {
    const rawBody = JSON.stringify(payload);
    return { rawBody, payload, headers: { 'x-hub-signature-256': signBody(rawBody, SIMULATOR_SECRET) } };
  };
  // Default to NOW — a real provider timestamps events in near-real-time, and
  // a fixed past date silently trips the 7-day staleness guard once the
  // calendar moves past it (tests inject their own clock when they need one).
  const unixSeconds = (d: Date | undefined): string =>
    String(Math.floor((d ?? new Date()).getTime() / 1000));

  const envelope = (value: Record<string, unknown>) => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'SIM_WABA', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '8657900000000', phone_number_id: SIM_PHONE_NUMBER_ID },
      ...value,
    } }] }],
  });

  return {
    adapter: simAdapter,
    sentIds,
    sendCount: () => sendN,

    inboundText({ from = SIM_BUYER, text, name = 'Sim Buyer', at }) {
      eventN += 1;
      return sign(envelope({
        contacts: [{ profile: { name }, wa_id: from }],
        messages: [{ from, id: `wamid.SIM_IN_${eventN}`, timestamp: unixSeconds(at), type: 'text', text: { body: text } }],
      }));
    },

    inboundImage({ from = SIM_BUYER, caption = null, at }) {
      eventN += 1;
      return sign(envelope({
        contacts: [{ profile: { name: 'Sim Buyer' }, wa_id: from }],
        messages: [{ from, id: `wamid.SIM_IN_${eventN}`, timestamp: unixSeconds(at), type: 'image',
          image: { id: `sim_media_${eventN}`, ...(caption ? { caption } : {}) } }],
      }));
    },

    status(wamid, status, args) {
      return sign(envelope({
        statuses: [{ id: wamid, status, timestamp: unixSeconds(args?.at),
          ...(args?.errorTitle ? { errors: [{ title: args.errorTitle }] } : {}) }],
      }));
    },
  };
}
