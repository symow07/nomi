/**
 * E1 — one Gmail message, as the API returns it, read into what a turn needs.
 *
 * Gmail hands back a tree of MIME parts with base64url bodies and a list of
 * headers. This takes the first `text/plain` part it finds — or the HTML with
 * its tags stripped when there is none — and the six headers that matter. It
 * is deliberately plain: a mail that cannot be read this way is skipped and
 * named in the log, never guessed at.
 *
 * Pure over its input. No I/O.
 */

export type GmailPart = {
  readonly mimeType?: string;
  readonly headers?: readonly { readonly name?: string; readonly value?: string }[];
  readonly body?: { readonly data?: string; readonly size?: number };
  readonly parts?: readonly GmailPart[];
};

export type GmailMessage = {
  readonly id?: string;
  readonly threadId?: string;
  readonly internalDate?: string;
  readonly labelIds?: readonly string[];
  readonly payload?: GmailPart;
};

export type ReadMail = {
  /** Gmail's own id, and the RFC Message-ID the rest of the product keys on. */
  readonly gmailId: string;
  readonly messageId: string;
  readonly from: string;
  readonly fromName: string | null;
  readonly subject: string;
  readonly text: string;
  readonly receivedAt: Date;
  readonly inReplyTo: string | null;
  /** A machine wrote it: a bounce, a vacation notice, a list. Never answered. */
  readonly automatic: boolean;
};

const header = (p: GmailPart | undefined, name: string): string | null => {
  const h = p?.headers?.find((x) => (x.name ?? '').toLowerCase() === name.toLowerCase());
  return h?.value?.trim() || null;
};

const decode = (data: string | undefined): string =>
  data ? Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '';

/** The first part of the given type, depth first — the way a mail client picks the body. */
function firstPart(p: GmailPart | undefined, mime: string): GmailPart | null {
  if (!p) return null;
  if ((p.mimeType ?? '').toLowerCase() === mime && p.body?.data) return p;
  for (const child of p.parts ?? []) {
    const hit = firstPart(child, mime);
    if (hit) return hit;
  }
  return null;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

/** "Ahmed <ahmed@x.com>" → the address, lower-cased, and the name if any. */
export function parseAddress(raw: string | null): { readonly address: string; readonly name: string | null } | null {
  if (!raw) return null;
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(raw);
  const address = (m ? m[2]! : raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return null;
  const name = m?.[1]?.trim() || null;
  return { address, name };
}

export const MAX_MAIL_CHARS = 20_000;

export function readGmailMessage(m: GmailMessage): ReadMail | { readonly skipped: string } {
  const p = m.payload;
  if (!m.id || !p) return { skipped: 'no payload' };
  const from = parseAddress(header(p, 'From'));
  if (!from) return { skipped: 'no sender address' };
  const messageId = header(p, 'Message-ID')?.replace(/^<|>$/g, '') ?? `gmail:${m.id}`;
  const plain = firstPart(p, 'text/plain');
  const html = plain ? null : firstPart(p, 'text/html');
  const text = (plain ? decode(plain.body?.data) : html ? stripHtml(decode(html.body?.data)) : '').trim().slice(0, MAX_MAIL_CHARS);
  if (!text) return { skipped: 'no readable text' };
  const auto = header(p, 'Auto-Submitted');
  const precedence = header(p, 'Precedence')?.toLowerCase() ?? '';
  const automatic = (auto !== null && auto.toLowerCase() !== 'no')
    || precedence === 'bulk' || precedence === 'list' || precedence === 'junk'
    || header(p, 'List-Id') !== null
    || /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(from.address);
  const when = m.internalDate ? new Date(Number(m.internalDate)) : new Date(header(p, 'Date') ?? Date.now());
  return {
    gmailId: m.id, messageId, from: from.address, fromName: from.name,
    subject: (header(p, 'Subject') ?? '').slice(0, 300), text,
    receivedAt: Number.isFinite(when.getTime()) ? when : new Date(),
    inReplyTo: header(p, 'In-Reply-To')?.replace(/^<|>$/g, '') ?? null,
    automatic,
  };
}
