import type { SendResult } from '../contract.js';
import type { ChannelEvent, InboundMessageEvent } from '../whatsapp/parse.js';

/**
 * Instagram and Messenger — one wire, two channels.
 *
 * Meta carries both over the same Graph messaging API: the same webhook
 * envelope, the same signature, the same send call. Only the `object` on the
 * payload and the id of the account differ. So the wire lives here once and the
 * two adapters are thin, rather than the same code twice with two chances to
 * drift.
 *
 * ── WHAT THESE CHANNELS CAN AND CANNOT DO ─────────────────────────────────
 *
 * They answer; they never start. Meta's API allows a reply only inside the 24
 * hours after the buyer wrote, there is no template to reopen it and no
 * one-time notification. `CHANNEL_REGISTRY` says so, and `gateOutbound` refuses
 * a first message on both by construction — nothing here relaxes that.
 *
 * ── THE ID SHAPE, AND WHY IT REUSES WHATSAPP'S EVENT ──────────────────────
 *
 * The ingress and the pipeline already speak one canonical event. Its fields
 * are named for WhatsApp because WhatsApp came first, and the mapping is exact:
 *
 *   phoneNumberId  ← the account the buyer wrote TO (Page id / IG account id)
 *   waId           ← the buyer's scoped id for this business (PSID / IGSID)
 *
 * Both are opaque per-business handles, which is what those fields have always
 * meant to everything downstream: one resolves the tenant, the other identifies
 * the person. A parity test pins this mapping so it cannot quietly invert.
 *
 * ── WHAT A BUYER CAN SEND THAT WE CANNOT READ ─────────────────────────────
 *
 * A story reply, a shared post, a voice clip, a reaction. They arrive as
 * attachments with no text, and are reported as `received` so the pipeline
 * hands them to a person by name (G2c) instead of running a turn on nothing.
 */

export type MetaMessagingChannel = 'instagram' | 'messenger';

/** The webhook `object` each channel arrives under. */
export const WEBHOOK_OBJECT: Readonly<Record<MetaMessagingChannel, string>> = {
  instagram: 'instagram',
  messenger: 'page',
};

type J = Record<string, unknown>;
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const obj = (v: unknown): J => (typeof v === 'object' && v !== null ? v as J : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Meta sends milliseconds here, unlike WhatsApp's unix seconds. */
const at = (v: unknown): Date => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n) : new Date();
};

/**
 * What kind of thing the buyer sent. Only text can be answered by the employee;
 * everything else is recorded and handed over, which is what `received` carries.
 */
function describe(message: J): { readonly received: string; readonly text: string | null } {
  const text = str(message['text']);
  if (text !== null && text !== '') return { received: 'text', text };
  const attachments = arr(message['attachments']);
  const kind = str(obj(attachments[0] ?? {})['type']);
  if (attachments.length > 0) return { received: (kind ?? 'attachment').toLowerCase(), text: null };
  // A reaction, an edit, a read receipt in the same envelope: nothing to answer.
  return { received: 'unsupported', text: null };
}

/**
 * Webhook → canonical events. Pure, like WhatsApp's parser, and it drops
 * anything belonging to another channel: one Meta app serves Instagram, the
 * Page and WhatsApp, so the object check is what keeps a Messenger message out
 * of an Instagram conversation.
 */
export function parseMetaMessaging(channel: MetaMessagingChannel, payload: unknown): ChannelEvent[] {
  const root = obj(payload);
  if (str(root['object']) !== WEBHOOK_OBJECT[channel]) return [];

  const events: ChannelEvent[] = [];
  for (const entry of arr(root['entry'])) {
    for (const m of arr(entry['messaging'])) {
      const message = obj(m['message']);
      const mid = str(message['mid']);
      const sender = str(obj(m['sender'])['id']);
      const recipient = str(obj(m['recipient'])['id']);
      // An echo is our own message coming back; answering it would be a loop.
      if (!mid || !sender || !recipient || message['is_echo'] === true) continue;

      const { received, text } = describe(message);
      const event: InboundMessageEvent = {
        kind: 'message',
        eventId: mid,
        dedupKey: mid,
        waId: sender,
        profileName: null,          // Meta sends none here; the profile API is a separate permission
        phoneNumberId: recipient,
        occurredAt: at(m['timestamp'] ?? entry['time']),
        messageType: text !== null ? 'text' : 'unsupported',
        received,
        text,
        mediaId: null,
      };
      events.push(event);
    }
  }
  return events;
}

/**
 * Which app secret signs these webhooks.
 *
 * Instagram and Messenger need not live in the same Meta app as WhatsApp — and
 * for this installation they do not: WhatsApp sits in `nomi-pilot` and these
 * two in `nomi-social`, because mixing a channel under review with a live one
 * puts both at the mercy of one app's standing. Each app signs with its OWN
 * secret, so a single `META_APP_SECRET` would fail every webhook signature with
 * a 401 that looks exactly like an attack.
 *
 * `META_SOCIAL_APP_SECRET` names the second app's secret. Unset, the WhatsApp
 * app's secret is used, which is correct for an installation that keeps all
 * three in one app.
 */
export const socialAppSecret = (
  env: Record<string, string | undefined>, whatsappAppSecret: string | undefined,
): string | undefined => env['META_SOCIAL_APP_SECRET']?.trim() || whatsappAppSecret;

export type MetaFetch = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}) => Promise<{ status: number; text(): Promise<string> }>;

export const SEND_TIMEOUT_MS = 15_000;

/**
 * Send a reply. One call for both channels: the Page access token authorises
 * the Page and the Instagram account connected to it.
 *
 * Errors are classified by status alone — 4xx is permanent (an expired window
 * stays expired; retrying it burns the account's standing with Meta), 5xx and
 * 429 are the network having a bad minute.
 */
export function metaMessagingSender(cfg: {
  readonly accountId: string;
  readonly accessToken: string;
  readonly graphVersion: string;
  readonly fetchImpl?: MetaFetch;
}) {
  const doFetch: MetaFetch = cfg.fetchImpl ?? (fetch as unknown as MetaFetch);
  return async (to: string, body: string): Promise<SendResult> => {
    try {
      const res = await doFetch(
        `https://graph.facebook.com/${cfg.graphVersion}/${encodeURIComponent(cfg.accountId)}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: { id: to }, message: { text: body } }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        },
      );
      const text = await res.text().catch(() => '');
      if (res.status >= 200 && res.status < 300) {
        let id: string | null = null;
        try { id = str(obj(JSON.parse(text))['message_id']); } catch { /* id below */ }
        // A provider always names what it accepted; the row's own id would not
        // match the status webhooks Meta sends about it.
        return id ? { ok: true, providerMessageId: id } : { ok: false, retryable: true, error: 'meta accepted without an id' };
      }
      if (res.status === 429 || res.status >= 500) return { ok: false, retryable: true, error: `meta ${res.status}` };
      return { ok: false, retryable: false, error: `meta ${res.status}` };
    } catch {
      return { ok: false, retryable: true, error: 'meta unreachable' };
    }
  };
}
