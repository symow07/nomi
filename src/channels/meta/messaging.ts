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
function describe(message: J): {
  readonly received: string; readonly text: string | null; readonly ref: string | null; readonly postId: string | null;
} {
  // CH7a — a reply to the shop's story carries the story's link; a shared
  // post, its own. Kept as the provider gave them, so the owner can open what
  // the customer meant.
  // CH7 — and the media's own id where Meta gives one (the story replied to;
  // a post or a reel shared in), so the worker can read the shop's caption.
  const story = obj(obj(message['reply_to'])['story']);
  const storyRef = str(story['url']);
  const storyId = mediaIdOf(story['id']);
  const text = str(message['text']);
  if (text !== null && text !== '') return { received: 'text', text, ref: storyRef, postId: storyId };
  const attachments = arr(message['attachments']);
  const first = obj(attachments[0] ?? {});
  const kind = str(first['type']);
  if (attachments.length > 0) {
    const payload = obj(first['payload']);
    return {
      received: (kind ?? 'attachment').toLowerCase(), text: null, ref: str(payload['url']) ?? storyRef,
      postId: mediaIdOf(payload['ig_post_media_id']) ?? mediaIdOf(payload['reel_video_id']) ?? storyId,
    };
  }
  if (storyRef || storyId) return { received: 'story_reply', text: null, ref: storyRef, postId: storyId };
  // A reaction, an edit, a read receipt in the same envelope: nothing to answer.
  return { received: 'unsupported', text: null, ref: null, postId: null };
}

/** A media id as Meta writes it — digits, sometimes a string, sometimes a number. Anything else is none. */
const mediaIdOf = (v: unknown): string | null => {
  const s = typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
  return /^[0-9A-Za-z_]{1,64}$/.test(s) ? s : null;
};

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
      if (!mid || !sender || !recipient) continue;
      // CH3 — an echo is a message the account SENT: never a turn (answering
      // it would be a loop), but a reply the owner typed in Meta's own app is
      // news Nomi must hear. It travels as its own event, the account as the
      // sender and the customer as the recipient.
      if (message['is_echo'] === true) {
        const { received, text } = describe(message);
        const appId = message['app_id'];
        events.push({
          kind: 'echo', eventId: mid, dedupKey: `echo:${mid}`,
          waId: recipient, phoneNumberId: sender,
          occurredAt: at(m['timestamp'] ?? entry['time']),
          text, received,
          appId: typeof appId === 'number' || typeof appId === 'string' ? String(appId) : null,
        });
        continue;
      }

      const { received, text, ref, postId } = describe(message);
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
        ...(ref ? { ref } : {}),
        ...(postId ? { postId } : {}),
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
  /** Absent on a GET: a body on a GET is a TypeError in the real fetch. */
  body?: string;
  signal?: AbortSignal;
}) => Promise<{ status: number; text(): Promise<string> }>;

export const LOOKUP_TIMEOUT_MS = 5_000;

/**
 * The sender's name, looked up after the webhook: Meta's payload carries only
 * a scoped id, and the Page token — once it holds `pages_messaging` for the
 * Page and `instagram_manage_messages` for the account — may ask the profile
 * for a name. Messenger answers with first and last name; Instagram with a
 * profile name and a username, and the username is offered as `@handle` when
 * the profile has no name, because a handle is what she would recognise.
 *
 * It NEVER throws and never blocks a conversation: a name is a courtesy, the
 * message is the point. No token, no permission, a bad minute at Meta — all
 * read as "no name", and she can type one on the buyer's page.
 */
export function metaProfileLookup(cfg: {
  readonly channel: 'instagram' | 'messenger';
  readonly accessToken: string;
  readonly graphVersion: string;
  readonly fetchImpl?: MetaFetch;
}) {
  const doFetch: MetaFetch = cfg.fetchImpl ?? (fetch as unknown as MetaFetch);
  const fields = cfg.channel === 'instagram' ? 'name,username' : 'first_name,last_name';
  return async (senderId: string): Promise<string | null> => {
    try {
      const res = await doFetch(
        `https://graph.facebook.com/${cfg.graphVersion}/${encodeURIComponent(senderId)}?fields=${fields}`,
        { method: 'GET', headers: { Authorization: `Bearer ${cfg.accessToken}` }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) },
      );
      if (res.status < 200 || res.status >= 300) return null;
      const o = obj(JSON.parse(await res.text()));
      const handle = str(o['username'])?.trim();
      const name = cfg.channel === 'instagram'
        ? (str(o['name'])?.trim() || (handle ? `@${handle}` : null))
        : [str(o['first_name']), str(o['last_name'])].map((s) => s?.trim() ?? '').filter(Boolean).join(' ') || null;
      return name ? name.slice(0, 80) : null;
    } catch {
      return null;
    }
  };
}

/** How a customer's photo is fetched: the photo's bytes, with its headers and the address it came from. */
export type PhotoFetch = (url: string, init: { method: 'GET'; redirect: 'follow'; signal?: AbortSignal }) => Promise<{
  status: number; url?: string; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** Where Meta serves profile photos from. A photo address anywhere else is not fetched. */
const PHOTO_HOSTS = ['fbsbx.com', 'fbcdn.net', 'cdninstagram.com', 'facebook.com', 'instagram.com'];
const photoHostOk = (u: string): boolean => {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && PHOTO_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch { return false; }
};

/** What the bytes are, by their first bytes, never by what a header claims. */
export function photoType(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export const PHOTO_MAX_BYTES = 524_288;

/**
 * THE WARMTH RUN (2026-10-03) — a customer's profile photo, as their channel
 * shows it. The same profile the name comes from (`metaProfileLookup`), asked
 * for `profile_pic`: Instagram and Messenger both answer it to the Page's
 * token. The answer is an address that expires within days, so the photo is
 * downloaded and kept (0123); the token is never sent to the photo's address.
 *
 * Never throws. `none` — the channel answered, with no photo; `failed` — it
 * did not answer, or the photo was not a picture this product keeps (a type
 * it does not know, over half a megabyte, served from anywhere but Meta).
 * Background work only (src/worker/faces.ts): no page waits on it.
 */
export function metaProfilePhoto(cfg: {
  readonly accessToken: string;
  readonly graphVersion: string;
  readonly fetchImpl?: MetaFetch;
  readonly photoFetch?: PhotoFetch;
}) {
  const doFetch: MetaFetch = cfg.fetchImpl ?? (fetch as unknown as MetaFetch);
  const getPhoto: PhotoFetch = cfg.photoFetch ?? (fetch as unknown as PhotoFetch);
  return async (senderId: string): Promise<{ state: 'kept'; type: string; bytes: Buffer } | { state: 'none' } | { state: 'failed' }> => {
    try {
      const res = await doFetch(
        `https://graph.facebook.com/${cfg.graphVersion}/${encodeURIComponent(senderId)}?fields=profile_pic`,
        { method: 'GET', headers: { Authorization: `Bearer ${cfg.accessToken}` }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) },
      );
      if (res.status < 200 || res.status >= 300) return { state: 'failed' };
      const address = str(obj(JSON.parse(await res.text()))['profile_pic'])?.trim();
      if (!address) return { state: 'none' };
      if (!photoHostOk(address)) return { state: 'failed' };
      const got = await getPhoto(address, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
      if (got.status < 200 || got.status >= 300 || (got.url && !photoHostOk(got.url))) return { state: 'failed' };
      const declared = Number(got.headers.get('content-length') ?? '0');
      if (declared > PHOTO_MAX_BYTES) return { state: 'failed' };
      const bytes = Buffer.from(await got.arrayBuffer());
      if (bytes.length === 0 || bytes.length > PHOTO_MAX_BYTES) return { state: 'failed' };
      const type = photoType(bytes);
      return type ? { state: 'kept', type, bytes } : { state: 'failed' };
    } catch {
      return { state: 'failed' };
    }
  };
}

export const SEND_TIMEOUT_MS = 15_000;

/**
 * Send a reply. One call for both channels: the Page access token authorises
 * the Page and the Instagram account connected to it.
 *
 * Errors are classified by status alone — 4xx is permanent (an expired window
 * stays expired; retrying it burns the account's standing with Meta), 5xx and
 * 429 are the network having a bad minute. Meta's numeric error code rides
 * along for the record; its message never does.
 */
/**
 * Meta's numeric error code — ` (#100)`, ` (#10/2534022)` — so a refused row
 * names the rule that refused it. The code alone: the message beside it can
 * quote the buyer's id, and provider text never comes back through here.
 */
function metaErrorCode(text: string): string {
  try {
    const e = obj(obj(JSON.parse(text))['error']);
    const code = e['code'];
    const sub = e['error_subcode'];
    if (typeof code !== 'number') return '';
    return typeof sub === 'number' ? ` (#${code}/${sub})` : ` (#${code})`;
  } catch {
    return '';
  }
}

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
      const status = `meta ${res.status}${metaErrorCode(text)}`;
      if (res.status === 429 || res.status >= 500) return { ok: false, retryable: true, error: status };
      return { ok: false, retryable: false, error: status };
    } catch {
      return { ok: false, retryable: true, error: 'meta unreachable' };
    }
  };
}
