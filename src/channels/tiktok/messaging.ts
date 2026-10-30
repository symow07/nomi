import type { ChannelAdapter, SendResult } from '../contract.js';
import type { ChannelEvent } from '../whatsapp/parse.js';
import { sendTikTokText, tiktokSignatureValid, type TikTokFetch } from './api.js';

/**
 * TIKTOK DIRECT MESSAGES, as this product's contract sees them (docs/TIKTOK-CHANNEL.md, surface A; the webhook schema
 * is TikTok's "Subscribe to Business Messaging Webhook events", read 2026-10-24).
 *
 *   · IN: one POST per event, signed (`Tiktok-Signature`, api.ts). `user_openid` is the business's account — the
 *     tenant is found from it, never from the content. The content is a JSON STRING inside the body.
 *       im_receive_msg     a customer wrote: a message. Text is read; an image, a shared post or anything else is named
 *                          and handed to a person, never opened (`/media/download/` is not used).
 *       im_send_msg        the account SENT a message: an echo. Its `message_tag.source` says from where: `APP` (the
 *                          TikTok app), `WEB` (TikTok Web, Business Center), `API` (Nomi's own sends, or another tool's
 *                          — told apart by the id Nomi recorded, src/pipeline/echo.ts). `OTHERS` is TikTok's own
 *                          automatic messages (a welcome the owner set up there): not the owner typing, so dropped.
 *       im_receive_msg_eu  a customer in the EEA, Switzerland or the UK wrote: TikTok sends NO content and no customer,
 *                          so there is nothing to answer — only counted (`tiktokDelivery`), and the page says so.
 *     The customer is the CONVERSATION: `conversation_id` is what a reply is sent to, so it is the handle kept.
 *   · OUT: text only (api.ts `sendTikTokText`), per business, with its own grant (main.ts). The limits on how many
 *     messages may go are TikTok's, held by the send gate (src/core/channel/tiktokLimits.ts).
 */
type J = Record<string, unknown>;
const obj = (v: unknown): J => (typeof v === 'object' && v !== null ? v as J : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function contentOf(body: J): J {
  const c = body['content'];
  if (typeof c === 'string') { try { return obj(JSON.parse(c)); } catch { return {}; } }
  return obj(c);
}

/** A TikTok post's own link: kept for the owner to open only when it is https on TikTok's own hosts. */
function postLink(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && (u.hostname === 'tiktok.com' || u.hostname.endsWith('.tiktok.com')) ? u.toString() : null;
  } catch { return null; }
}

/** One delivery → the canonical events (none, or one). Never throws. */
export function parseTikTokWebhook(payload: unknown): ChannelEvent[] {
  try {
    const body = obj(payload);
    const event = str(body['event']);
    const account = str(body['user_openid']);
    if (!account || (event !== 'im_receive_msg' && event !== 'im_send_msg')) return [];
    const c = contentOf(body);
    const id = str(c['message_id']); const conversation = str(c['conversation_id']);
    if (!id || !conversation) return [];
    const type = (str(c['type']) ?? 'unknown').toLowerCase();
    const text = type === 'text' ? str(obj(c['text'])['body']) : null;
    const at = typeof c['timestamp'] === 'number' && c['timestamp'] > 0 ? new Date(c['timestamp']) : new Date();
    if (event === 'im_send_msg') {
      const source = str(obj(c['message_tag'])['source']);
      // TikTok's own automatic messages are not the owner answering.
      if (source === 'OTHERS') return [];
      return [{
        kind: 'echo', eventId: `tt:${id}`, dedupKey: `echo:tt:${id}`, waId: conversation, phoneNumberId: account,
        occurredAt: at, text, received: type, appId: null,
      }];
    }
    const from = str(c['from']);
    return [{
      kind: 'message',
      eventId: `tt:${id}`, dedupKey: `tt:${id}`,
      waId: conversation,
      profileName: from ? `@${from}` : null,
      phoneNumberId: account,
      occurredAt: at,
      messageType: type === 'text' && text !== null ? 'text' : 'unsupported',
      received: type,
      text,
      mediaId: null,
      ref: type === 'share_post' ? postLink(obj(c['share_post'])['embed_url']) : null,
    }];
  } catch {
    return [];
  }
}

/**
 * What a delivery says about the ACCOUNT itself, read before any tenant is known: its username (the `to` of a
 * customer's message, the `from` of the account's own), and whether it was a message from the EEA, Switzerland or
 * the UK that carries nothing but that fact. Never throws.
 */
export function tiktokDelivery(payload: unknown): { readonly openId: string; readonly username: string | null; readonly eu: boolean } | null {
  try {
    const body = obj(payload);
    const openId = str(body['user_openid']);
    const event = str(body['event']);
    if (!openId || !event) return null;
    const c = contentOf(body);
    const username = event === 'im_send_msg' ? str(c['from']) : str(c['to']);
    return { openId, username: username && /^[A-Za-z0-9._]{1,64}$/.test(username) ? username : null, eu: event === 'im_receive_msg_eu' };
  } catch {
    return null;
  }
}

/** The ingress side: the app's own secret checks every delivery; it sends nothing (each business sends with its own). */
export function tiktokIngressAdapter(appSecret: string, now: () => number = Date.now): ChannelAdapter {
  return {
    kind: 'tiktok', provider: 'tiktok',
    verifyWebhook: (raw, header) => tiktokSignatureValid(raw, header, appSecret, Math.floor(now() / 1000)),
    parseWebhook: parseTikTokWebhook,
    sendText: async () => ({ ok: false, retryable: false, error: 'tiktok: the webhook adapter sends nothing' }),
  };
}

/**
 * One business's sending side: its account and a way to its access token (renewed before it ends, kept whole —
 * main.ts). A token TikTok calls dead is reported once (`onDead`), so the page asks the owner to connect again.
 */
export function tiktokSendAdapter(cfg: {
  readonly openId: string;
  /** The access token for one send: renewed first when it is near its end. A renewal TikTok did not answer is worth
   *  retrying; one it refused is not (the grant is dead, and `onDead` has been told). */
  readonly accessToken: () => Promise<{ readonly token: string } | { readonly token: null; readonly retryable: boolean }>;
  readonly onDead: () => Promise<void>;
  readonly fetchImpl: TikTokFetch;
}): ChannelAdapter {
  return {
    kind: 'tiktok', provider: 'tiktok',
    verifyWebhook: () => false,
    parseWebhook: () => [],
    sendText: async (to: string, body: string): Promise<SendResult> => {
      const access = await cfg.accessToken();
      if (access.token === null) return { ok: false, retryable: access.retryable, error: access.retryable ? 'tiktok: the grant could not be renewed now' : 'tiktok: the grant no longer opens or renews' };
      const r = await sendTikTokText(cfg.fetchImpl, { accessToken: access.token, openId: cfg.openId, conversationId: to, body });
      if (r.ok) return { ok: true, providerMessageId: `tt:${r.messageId}` };
      if (r.dead) await cfg.onDead().catch(() => undefined);
      return { ok: false, retryable: r.retryable, error: r.error, ...(r.uncertain ? { uncertain: true } : {}) };
    },
  };
}
