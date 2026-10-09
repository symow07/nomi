/**
 * R1 (docs/PRE-LAUNCH.md, 2026-10-09) — WHO SENT IT, as the receiving server saw it.
 *
 * The From line is whatever the sender typed. What says it is true is the receiving server's own verdict, in its
 * Authentication-Results header (RFC 8601): DMARC passed for the From domain, or DKIM or SPF passed for a domain
 * aligned with it. Anything else — no verdict, a fail, a pass for some other domain — is not confirmed, and the
 * mail is held for a person instead of being taken as that address's words (pipeline/emailReply.ts,
 * channels/email/inboxReader.ts).
 *
 * Only the receiving server's own header counts: the topmost one, which it stamps last, and — where the server is
 * known (Gmail: `mx.google.com`) — only one that names it. A sender can write any header they like further down,
 * including one that claims a pass.
 */

/** The receiving server Gmail names in its own verdict. */
export const GMAIL_AUTHSERV = 'mx.google.com';

const domainOf = (address: string): string => {
  const at = address.lastIndexOf('@');
  return (at >= 0 ? address.slice(at + 1) : address).trim().toLowerCase().replace(/\.$/, '');
};

/** Relaxed alignment (RFC 7489): the same domain, or one inside the other. */
const aligned = (domain: string, from: string): boolean =>
  domain !== '' && (domain === from || from.endsWith(`.${domain}`) || domain.endsWith(`.${from}`));

/** One method's result and its properties, comments taken out: `dkim=pass header.d=example.com`. */
type Result = { readonly method: string; readonly result: string; readonly props: Readonly<Record<string, string>> };

function results(header: string): { readonly authserv: string; readonly results: readonly Result[] } {
  const plain = header.replace(/\([^()]*\)/g, ' ');
  const [first, ...rest] = plain.split(';');
  const authserv = (first ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const out: Result[] = [];
  for (const part of rest) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const head = /^([a-z0-9-]+)=([a-z]+)$/i.exec(tokens[0] ?? '');
    if (!head) continue;
    const props: Record<string, string> = {};
    for (const t of tokens.slice(1)) {
      const m = /^([a-z0-9.-]+)=(.+)$/i.exec(t);
      if (m) props[m[1]!.toLowerCase()] = m[2]!.replace(/^"|"$/g, '');
    }
    out.push({ method: head[1]!.toLowerCase(), result: head[2]!.toLowerCase(), props });
  }
  return { authserv, results: out };
}

/**
 * Whether the receiving server confirmed that `from` sent the mail. `headers`: every Authentication-Results value,
 * in the mail's own order (topmost first). `trusted`: the receiving server's name, when it is known; null takes
 * the topmost header as the receiving server's own (a provider's adapter that passes only its own verdict).
 */
export function senderConfirmed(headers: readonly string[], from: string, trusted: string | null): boolean {
  const top = headers[0];
  if (!top) return false;
  const own = results(top);
  if (trusted !== null && own.authserv !== trusted.toLowerCase()) return false;
  const fromDomain = domainOf(from);
  if (!fromDomain || !from.includes('@')) return false;
  for (const r of own.results) {
    if (r.result !== 'pass') continue;
    if (r.method === 'dmarc') {
      const said = r.props['header.from'];
      if (said === undefined || domainOf(said) === fromDomain) return true;
    }
    if (r.method === 'dkim') {
      const d = r.props['header.d'] ?? r.props['header.i'];
      if (d !== undefined && aligned(domainOf(d), fromDomain)) return true;
    }
    if (r.method === 'spf') {
      const m = r.props['smtp.mailfrom'];
      if (m !== undefined && aligned(domainOf(m), fromDomain)) return true;
    }
  }
  return false;
}
