import { timingSafeEqual } from 'node:crypto';
import type { ChannelAdapter, OutboundMedia, SendResult } from '../contract.js';
import type { ChannelEvent } from '../whatsapp/parse.js';

/**
 * S7 (Phase 5, item 22) — TELEGRAM, as this product's contract sees it: a bot of the business's own, through the
 * Telegram Bot API.
 *
 *   · IN: Telegram posts each update to the webhook with the secret the bot was given when the webhook was set
 *     (`X-Telegram-Bot-Api-Secret-Token`); anything without it is refused before it is read. Only a person writing
 *     to the bot in a private chat is a buyer: a group, a channel, an edit or a button press is not a message here.
 *   · OUT: `sendMessage` to that chat. Telegram has no window and no price per message; a buyer who blocked the bot
 *     is refused for good (403), a flood limit is tried again (429).
 *   · A photo, a voice note, a file: named and handed to a person, never opened — reading Telegram's media needs its
 *     own download path, not built.
 *
 * The bot's token is in the address Telegram is called at. It never appears in an error this returns or logs.
 */
export type TelegramFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) =>
  Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

export const TELEGRAM_TEXT_MAX = 4096;
const API = 'https://api.telegram.org';

type TgUser = { readonly id?: number; readonly first_name?: string; readonly last_name?: string; readonly username?: string; readonly language_code?: string };
type TgMessage = {
  readonly message_id?: number; readonly date?: number; readonly from?: TgUser;
  readonly chat?: { readonly id?: number; readonly type?: string };
  readonly text?: string; readonly caption?: string;
  readonly photo?: unknown[]; readonly voice?: unknown; readonly audio?: unknown; readonly document?: unknown;
  readonly sticker?: unknown; readonly video?: unknown; readonly location?: unknown; readonly contact?: unknown;
};

/** What the buyer sent, by Telegram's own name for it. */
function receivedOf(m: TgMessage): string {
  if (typeof m.text === 'string') return 'text';
  for (const k of ['photo', 'voice', 'audio', 'document', 'sticker', 'video', 'location', 'contact'] as const) if (m[k] !== undefined) return k;
  return 'other';
}

/** One update → the canonical events (none, or one). Never throws. */
export function parseTelegramUpdate(botId: string, payload: unknown): ChannelEvent[] {
  try {
    const u = payload as { update_id?: number; message?: TgMessage };
    const m = u?.message;
    if (typeof u?.update_id !== 'number' || !m || m.chat?.type !== 'private' || typeof m.chat.id !== 'number' || typeof m.message_id !== 'number') return [];
    if (m.from && (m.from as { is_bot?: boolean }).is_bot === true) return [];
    const received = receivedOf(m);
    const name = [m.from?.first_name, m.from?.last_name].filter((x): x is string => typeof x === 'string' && x.trim() !== '').join(' ').trim();
    return [{
      kind: 'message',
      // The message's own id is the receipt's too: a retry of the same update is the same receipt, and the buyer's
      // erasure finds the receipt by the message it carried.
      eventId: `tg:${m.chat.id}:${m.message_id}`,
      dedupKey: `tg:${m.chat.id}:${m.message_id}`,
      waId: String(m.chat.id),
      profileName: name || (m.from?.username ? `@${m.from.username}` : null),
      phoneNumberId: botId,
      occurredAt: new Date((m.date ?? 0) * 1000),
      messageType: received === 'text' ? 'text' : 'unsupported',
      received,
      text: typeof m.text === 'string' ? m.text : typeof m.caption === 'string' ? m.caption : null,
      mediaId: null,
      language: typeof m.from?.language_code === 'string' ? m.from.language_code : null,
    }];
  } catch {
    return [];
  }
}

/** Is this the secret the webhook was set with? Compared in constant time; nothing else is read first. */
export function telegramSecretMatches(header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const a = Buffer.from(header, 'utf8'), b = Buffer.from(secret, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function telegramAdapter(cfg: {
  /** The bot's own id (the number before the colon in its token): which business an update belongs to. */
  readonly botId: string;
  readonly token: string;
  /** The secret Telegram echoes on every update (set with the webhook). */
  readonly secretToken: string;
  readonly fetchImpl?: TelegramFetch;
}): ChannelAdapter {
  const doFetch: TelegramFetch = cfg.fetchImpl ?? (async (url, init) => {
    const r = await fetch(url, init);
    return { ok: r.ok, status: r.status, json: () => r.json() };
  });
  const call = async (method: 'sendMessage' | 'sendPhoto', body: Record<string, unknown>, to: string): Promise<SendResult> => {
    let r: Awaited<ReturnType<TelegramFetch>>;
    try {
      r = await doFetch(`${API}/bot${cfg.token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      return { ok: false, retryable: true, error: 'telegram: network' };
    }
    const j = (await r.json().catch(() => null)) as { ok?: boolean; result?: { message_id?: number }; description?: string } | null;
    if (r.ok && j?.ok === true && typeof j.result?.message_id === 'number') return { ok: true, providerMessageId: `tg:${to}:${j.result.message_id}` };
    // The description is Telegram's words about the request, never the token; cut short all the same.
    const said = typeof j?.description === 'string' ? j.description.replace(/bot\d+:[\w-]+/g, 'bot…').slice(0, 160) : '';
    return { ok: false, retryable: r.status === 429 || r.status >= 500, error: `telegram ${r.status}${said ? `: ${said}` : ''}` };
  };
  return {
    kind: 'telegram',
    provider: 'telegram',
    verifyWebhook: (_raw, header) => telegramSecretMatches(header, cfg.secretToken),
    parseWebhook: (payload) => parseTelegramUpdate(cfg.botId, payload),
    sendText: async (to, body) => {
      if (body.length > TELEGRAM_TEXT_MAX) return { ok: false, retryable: false, error: `telegram: longer than ${TELEGRAM_TEXT_MAX} characters` };
      return call('sendMessage', { chat_id: to, text: body }, to);
    },
    sendMedia: async (to, media: OutboundMedia) => call('sendPhoto', { chat_id: to, photo: media.url, ...(media.caption ? { caption: media.caption.slice(0, 1024) } : {}) }, to),
  };
}

/**
 * Nomi's one bot, from the installation's environment (pasted into Railway by the owner, never typed anywhere else):
 * `TELEGRAM_BOT_TOKEN`, the secret its webhook was set with (`TELEGRAM_WEBHOOK_SECRET`, `tools/telegram-webhook.mjs`)
 * and its public name (`TELEGRAM_BOT_USERNAME`, for the start links). All three, or no Telegram here; and none at all
 * while the privacy page does not name Telegram (D18: `named` is checked by the caller).
 */
export function telegramFrom(env: Readonly<Record<string, string | undefined>>, fetchImpl?: TelegramFetch):
  { readonly adapter: ChannelAdapter; readonly username: string } | null {
  const token = (env['TELEGRAM_BOT_TOKEN'] ?? '').trim();
  const secret = (env['TELEGRAM_WEBHOOK_SECRET'] ?? '').trim();
  const username = (env['TELEGRAM_BOT_USERNAME'] ?? '').trim().replace(/^@/, '');
  const botId = /^(\d{5,}):[\w-]{20,}$/.exec(token)?.[1];
  if (!botId || !/^[A-Za-z0-9_-]{16,256}$/.test(secret) || !/^[A-Za-z][A-Za-z0-9_]{3,31}bot$/i.test(username)) return null;
  return { adapter: telegramAdapter({ botId, token, secretToken: secret, ...(fetchImpl ? { fetchImpl } : {}) }), username };
}
