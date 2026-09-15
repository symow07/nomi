import type { ChannelAdapter } from '../contract.js';
import type { FetchLike } from './client.js';
import type { BinaryFetchLike } from './media.js';
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
  /** The phone-number id this instance's webhooks carry — the credential's
   *  `external_ref`, which Postgres holds unique across ALL tenants. */
  readonly phoneNumberId: string;
  /** wamids of successful sends, in order. */
  readonly sentIds: readonly string[];
  readonly sendCount: () => number;
  /** Build a SIGNED raw webhook body + headers, as the provider would POST. */
  inboundText(args: { from?: string; text: string; name?: string; at?: Date }): SignedWebhook;
  inboundImage(args: { from?: string; caption?: string | null; at?: Date }): SignedWebhook;
  /** G2b — a voice note, the shape the Cloud API sends: type 'audio'. */
  inboundAudio(args?: { from?: string; at?: Date }): SignedWebhook;
  /**
   * G2c — any other kind the Cloud API sends ('document', 'sticker',
   * 'reaction', 'location', 'video'…), with `body` as its type-named object.
   */
  inboundOther(args: { from?: string; type: string; body?: Record<string, unknown>; at?: Date }): SignedWebhook;
  status(wamid: string, status: 'sent' | 'delivered' | 'read' | 'failed', args?: { at?: Date; errorTitle?: string }): SignedWebhook;
  /**
   * G2b — the provider's media endpoint, for the media ids this instance
   * issued. Hand it to `whatsappMediaFetcher` / `whatsappAudioFetcher` as
   * `fetchImpl` with base URL `SIM_MEDIA_BASE`: the real two-GET code runs
   * unchanged and only the network is scripted, as with sends. An id it never
   * issued answers 404, the way an expired WhatsApp media id does.
   */
  readonly mediaFetch: BinaryFetchLike;
};

export const SIM_MEDIA_BASE = 'https://simulator.invalid/media';

export type SignedWebhook = {
  readonly rawBody: string;
  readonly headers: { readonly 'x-hub-signature-256': string };
  readonly payload: unknown;
};

export const SIM_PHONE_NUMBER_ID = 'SIM_PNID_1';
const SIM_BUYER = '971500000001';

/**
 * M22 — `tag` namespaces the two identifiers Postgres holds GLOBALLY unique:
 * the credential's `external_ref` (the phone-number id the webhook resolves a
 * tenant by) and `outbound_messages.provider_message_id` (the wamid). Two
 * simulator instances, or two runs against one database, otherwise collide on
 * both — a duplicate-key error in the middle of an unrelated assertion, which
 * is how it has surfaced twice. Defaults to the historical values, so every
 * existing caller behaves exactly as before.
 */
export function whatsappSimulator(
  script: readonly SendBehavior[] = [], opts: { readonly tag?: string } = {},
): Simulator {
  FORBID_PRODUCTION();

  const tag = opts.tag ?? '1';
  const phoneNumberId = `SIM_PNID_${tag}`;
  // G2b — inbound message and media ids carry the tag too. A message id is the
  // event's dedup key, held unique across the whole database, so a second run
  // of a suite that sent `wamid.SIM_IN_1` found it already recorded and never
  // processed the message at all — which only a test that waits for the worker
  // to answer would ever notice.
  let sendN = 0;
  let eventN = 0;
  const remaining = [...script];
  const sentIds: string[] = [];
  /** media id → the MIME type the provider would report for it. */
  const media = new Map<string, string>();

  const mediaFetch: BinaryFetchLike = async (url) => {
    const bytes = new TextEncoder().encode('simulated media bytes').buffer as ArrayBuffer;
    if (url.startsWith(`${SIM_MEDIA_BASE}/bytes/`)) {
      return { status: 200, text: async () => '', arrayBuffer: async () => bytes };
    }
    const id = url.slice(`${SIM_MEDIA_BASE}/`.length);
    const mime = media.get(id);
    if (!mime) return { status: 404, text: async () => '{"error":"media not found"}' };
    return {
      status: 200,
      text: async () => JSON.stringify({ url: `${SIM_MEDIA_BASE}/bytes/${id}`, mime_type: mime }),
    };
  };

  const fetchImpl: FetchLike = async (_url, init) => {
    sendN += 1;
    const behavior = remaining.shift() ?? 'ok';
    switch (behavior) {
      case 'ok': {
        const id = `wamid.SIM_OUT_${tag}_${sendN}`;
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
      metadata: { display_phone_number: '8657900000000', phone_number_id: phoneNumberId },
      ...value,
    } }] }],
  });

  return {
    adapter: simAdapter,
    phoneNumberId,
    sentIds,
    sendCount: () => sendN,

    inboundText({ from = SIM_BUYER, text, name = 'Sim Buyer', at }) {
      eventN += 1;
      return sign(envelope({
        contacts: [{ profile: { name }, wa_id: from }],
        messages: [{ from, id: `wamid.SIM_IN_${tag}_${eventN}`, timestamp: unixSeconds(at), type: 'text', text: { body: text } }],
      }));
    },

    inboundImage({ from = SIM_BUYER, caption = null, at }) {
      eventN += 1;
      media.set(`sim_media_${tag}_${eventN}`, 'image/jpeg');
      return sign(envelope({
        contacts: [{ profile: { name: 'Sim Buyer' }, wa_id: from }],
        messages: [{ from, id: `wamid.SIM_IN_${tag}_${eventN}`, timestamp: unixSeconds(at), type: 'image',
          image: { id: `sim_media_${tag}_${eventN}`, ...(caption ? { caption } : {}) } }],
      }));
    },

    inboundAudio({ from = SIM_BUYER, at } = {}) {
      eventN += 1;
      // WhatsApp voice notes are ogg/opus, and the provider reports the codec
      // in the MIME type — the real fetcher must strip it to match.
      media.set(`sim_media_${tag}_${eventN}`, 'audio/ogg; codecs=opus');
      return sign(envelope({
        contacts: [{ profile: { name: 'Sim Buyer' }, wa_id: from }],
        messages: [{ from, id: `wamid.SIM_IN_${tag}_${eventN}`, timestamp: unixSeconds(at), type: 'audio',
          audio: { id: `sim_media_${tag}_${eventN}`, mime_type: 'audio/ogg; codecs=opus', voice: true } }],
      }));
    },

    inboundOther({ from = SIM_BUYER, type, body = {}, at }) {
      eventN += 1;
      return sign(envelope({
        contacts: [{ profile: { name: 'Sim Buyer' }, wa_id: from }],
        messages: [{ from, id: `wamid.SIM_IN_${tag}_${eventN}`, timestamp: unixSeconds(at), type, [type]: body }],
      }));
    },

    mediaFetch,

    status(wamid, status, args) {
      return sign(envelope({
        statuses: [{ id: wamid, status, timestamp: unixSeconds(args?.at),
          ...(args?.errorTitle ? { errors: [{ title: args.errorTitle }] } : {}) }],
      }));
    },
  };
}
