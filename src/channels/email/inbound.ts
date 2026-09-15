/**
 * C4.c — a buyer's answer to one of her e-mails, as the product receives it.
 *
 * ── ONE SHAPE, WHICHEVER PROVIDER ─────────────────────────────────────────
 *
 * Every inbound-mail provider posts a different JSON: SES wraps the raw MIME in
 * SNS, Postmark sends `FromFull` and `Headers[]`, Mailgun posts form fields. No
 * provider is chosen yet (M52), so this is the shape the product accepts, and
 * the adapter that arrives with the provider maps its own payload onto it
 * before signing. Parsing a provider format here would be guessing one.
 *
 *   {
 *     "from":       "buyer@example.com",       required
 *     "messageId":  "abc@mail.example.com",     required — HIS mail's Message-ID
 *     "inReplyTo":  "<ours@...>",               the mail he answered
 *     "references": "<a@...> <b@...>" | [...]  the thread
 *     "subject":    "Re: Canvas totes",
 *     "text":       "Yes, send prices."         required — the plain-text body
 *   }
 *
 * ── WHAT IS DELIBERATELY NOT DONE ─────────────────────────────────────────
 *
 * The quoted history under his answer is kept, not stripped. Every heuristic
 * for "where his words end" ("On Tue … wrote:", "-----Original Message-----",
 * a `>` prefix) fails on some client in some language, and a stripper that cut
 * his actual answer would hide the one thing a person must read. She sees the
 * whole mail; her own words below his are recognisable to her.
 *
 * NULL IS THE ONLY FAILURE, and it is acknowledged, not errored: a provider
 * that gets a 4xx or 5xx retries, and a payload that cannot be read today will
 * not be readable on the fifth retry either.
 */

export type InboundMail = {
  readonly from: string;
  /** His mail's Message-ID, without angle brackets. */
  readonly messageId: string;
  /** Every Message-ID he quoted — In-Reply-To first, then References — bare. */
  readonly quoted: readonly string[];
  readonly subject: string | null;
  readonly text: string;
};

/** The longest body kept. A reply longer than this is a forwarded catalogue. */
export const MAX_REPLY_CHARS = 20_000;

/** `<a@b>`, ` a@b `, `<a@b> <c@d>` → `['a@b', 'c@d']`. */
export function messageIds(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const ids: string[] = [];
  for (const p of parts) {
    if (typeof p !== 'string') continue;
    const bracketed = [...p.matchAll(/<([^<>\s]+)>/g)].map((m) => m[1]!);
    const found = bracketed.length > 0 ? bracketed : p.split(/\s+/).filter(Boolean);
    for (const id of found) {
      const bare = id.replace(/^<|>$/g, '').trim();
      // A Message-ID has an @ and no whitespace; anything else is not one.
      if (/^[^\s@<>]+@[^\s@<>]+$/.test(bare) && bare.length <= 998 && !ids.includes(bare)) ids.push(bare);
    }
  }
  return ids;
}

export function parseInboundMail(payload: unknown): InboundMail | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const from = typeof p['from'] === 'string' ? p['from'].trim() : '';
  // "Ahmed <ahmed@x.com>" as well as a bare address.
  const address = /<([^<>\s]+@[^<>\s]+)>/.exec(from)?.[1] ?? from;
  const [messageId] = messageIds(p['messageId']);
  const text = typeof p['text'] === 'string' ? p['text'] : '';
  if (!address || !messageId || !text.trim()) return null;
  const quoted = [...messageIds(p['inReplyTo']), ...messageIds(p['references'])]
    .filter((id, i, all) => all.indexOf(id) === i);
  return {
    from: address,
    messageId,
    quoted,
    subject: typeof p['subject'] === 'string' && p['subject'].trim() ? p['subject'].trim().slice(0, 200) : null,
    text: text.slice(0, MAX_REPLY_CHARS),
  };
}
