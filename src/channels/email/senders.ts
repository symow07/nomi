import { randomUUID } from 'node:crypto';
import type { MailMessage, SendResult } from '../contract.js';
import type { OAuthFetch } from '../../connectors/oauth.js';

/**
 * C6 · M50 — the last step of an e-mail: handing it, as her, to Gmail or Outlook.
 *
 * ── ONE MIME MESSAGE, BUILT HERE, FOR BOTH ────────────────────────────────
 *
 * Both providers accept a raw RFC 5322 message, and that is what is sent to
 * both. It is the only way to carry the headers this product will not send a
 * first mail without: Graph's JSON message allows only `x-` custom headers, so a
 * List-Unsubscribe pair — RFC 8058, the buyer's way out — cannot be expressed
 * there at all, while a MIME submission carries it as written.
 *
 * ── THE MESSAGE-ID IS OURS ────────────────────────────────────────────────
 *
 * Minted here, on her own domain, and set on the message. It is what a buyer's
 * reply will quote and what `resolve_email_reply` matches (C4.c), so it is
 * returned as `providerMessageId` — the transport contract — and each sender
 * then asks the provider what it actually stored, because a provider that
 * rewrites the header must not leave the product matching an id nobody quotes.
 *
 * ── A SEND IS A STATUS, NEVER A BODY ──────────────────────────────────────
 *
 * The access token is in an Authorization header and nowhere else. Errors are
 * classified by status alone; nothing a provider said leaves as text.
 */

export type SenderOutcome = SendResult | { readonly ok: false; readonly unauthorized: true };

export type MailSender = (
  accessToken: string,
  message: MailMessage & { readonly from: string },
) => Promise<SenderOutcome>;

const CRLF = '\r\n';

/** RFC 2047, when a header holds anything but plain ASCII — a Chinese or Arabic subject. */
function encodeHeader(v: string): string {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

/** Header values may not carry a line break: that is how a header gets injected. */
const oneLine = (v: string): string => v.replace(/[\r\n]+/g, ' ').trim();

export function mimeMessage(
  m: MailMessage & { readonly from: string }, messageId: string, date: Date,
): string {
  const headers: [string, string][] = [
    ['From', oneLine(m.from)],
    ['To', oneLine(m.to)],
    ['Subject', encodeHeader(oneLine(m.subject))],
    ['Date', date.toUTCString().replace('GMT', '+0000')],
    ['Message-ID', `<${messageId}>`],
    ['MIME-Version', '1.0'],
    ['Content-Type', 'text/plain; charset=UTF-8'],
    ['Content-Transfer-Encoding', 'base64'],
  ];
  const reserved = new Set(headers.map(([k]) => k.toLowerCase()));
  for (const [k, v] of Object.entries(m.headers)) {
    // Only header NAMES a mail can legally have, and none of ours overwritten.
    if (!/^[A-Za-z0-9-]+$/.test(k) || reserved.has(k.toLowerCase())) continue;
    headers.push([k, oneLine(v)]);
  }
  const body = Buffer.from(m.text, 'utf8').toString('base64').replace(/.{76}/g, `$&${CRLF}`);
  return `${headers.map(([k, v]) => `${k}: ${v}`).join(CRLF)}${CRLF}${CRLF}${body}${CRLF}`;
}

/** A Message-ID on HER domain, so it reads as hers and cannot collide with anyone's. */
export function mintMessageId(from: string): string {
  const domain = from.slice(from.lastIndexOf('@') + 1).toLowerCase() || 'mail.invalid';
  return `${randomUUID()}@${domain}`;
}

const classify = (status: number): SenderOutcome | null => {
  if (status === 401) return { ok: false, unauthorized: true };
  if (status === 429 || status >= 500) return { ok: false, retryable: true, error: `provider ${status}` };
  if (status >= 400) return { ok: false, retryable: false, error: `provider ${status}` };
  return null;
};

const bare = (id: string): string => id.trim().replace(/^<|>$/g, '');

async function call(fetchImpl: OAuthFetch, url: string, init: Parameters<OAuthFetch>[1]): Promise<
  { readonly status: number; readonly text: string } | null
> {
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
    return { status: res.status, text: await res.text().catch(() => '') };
  } catch {
    return null;
  }
}

/** Gmail API: send the raw message, then read back the Message-ID Gmail stored. */
export function gmailSender(fetchImpl: OAuthFetch, now: () => Date = () => new Date()): MailSender {
  return async (accessToken, message) => {
    const ours = mintMessageId(message.from);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const sent = await call(fetchImpl, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: Buffer.from(mimeMessage(message, ours, now()), 'utf8').toString('base64url') }),
    });
    if (!sent) return { ok: false, retryable: true, error: 'provider unreachable' };
    const bad = classify(sent.status);
    if (bad) return bad;
    let gmailId: string | null = null;
    try { gmailId = (JSON.parse(sent.text) as { id?: unknown }).id as string ?? null; } catch { /* below */ }
    // Accepted: from here the mail is out, so nothing below may fail the send.
    if (typeof gmailId !== 'string') return { ok: true, providerMessageId: ours };
    const meta = await call(fetchImpl,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailId)}?format=metadata&metadataHeaders=Message-ID`,
      { method: 'GET', headers: auth });
    try {
      const headers = (JSON.parse(meta?.text ?? '') as { payload?: { headers?: { name?: string; value?: string }[] } })
        .payload?.headers ?? [];
      const stored = headers.find((h) => h.name?.toLowerCase() === 'message-id')?.value;
      return { ok: true, providerMessageId: stored ? bare(stored) : ours };
    } catch {
      return { ok: true, providerMessageId: ours };
    }
  };
}

/**
 * Microsoft Graph: create the message from MIME (which returns the
 * internetMessageId Exchange will use), then send it. Two calls, because
 * `sendMail` answers 202 with no body and so no id a reply could be matched by.
 */
export function graphSender(fetchImpl: OAuthFetch, now: () => Date = () => new Date()): MailSender {
  return async (accessToken, message) => {
    const ours = mintMessageId(message.from);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const created = await call(fetchImpl, 'https://graph.microsoft.com/v1.0/me/messages', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'text/plain' },
      body: Buffer.from(mimeMessage(message, ours, now()), 'utf8').toString('base64'),
    });
    if (!created) return { ok: false, retryable: true, error: 'provider unreachable' };
    const bad = classify(created.status);
    if (bad) return bad;
    let draft: { id?: unknown; internetMessageId?: unknown } = {};
    try { draft = JSON.parse(created.text) as typeof draft; } catch { /* below */ }
    if (typeof draft.id !== 'string') return { ok: false, retryable: false, error: 'provider unreadable' };
    const sent = await call(fetchImpl, `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(draft.id)}/send`, {
      method: 'POST', headers: { ...auth, 'Content-Length': '0' },
    });
    if (!sent) return { ok: false, retryable: true, error: 'provider unreachable' };
    const sendBad = classify(sent.status);
    if (sendBad) return sendBad;
    return {
      ok: true,
      providerMessageId: typeof draft.internetMessageId === 'string' ? bare(draft.internetMessageId) : ours,
    };
  };
}
