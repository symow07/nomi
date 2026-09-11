import { type Result, ok, err } from '../types/result.js';

/**
 * M40.1 — is this domain allowed to send, and does the world agree?
 *
 * ── WHY THIS IS A GATE AND NOT A HINT ─────────────────────────────────────
 *
 * A misconfigured sending domain does not fail loudly. The first few hundred
 * messages land in spam, the domain's reputation drops, and by the time anyone
 * notices, mail from her own address — the one she has used with buyers for
 * years — is being filed as junk. That damage outlives the campaign that caused
 * it and is not something an apology fixes.
 *
 * So this refuses. Unverified means no send, and "we could not check" means the
 * same as "not verified": absence of a confirmation is not a confirmation, the
 * same rule M38 applies to consent and M29 states in general.
 *
 * ── AND WHY IT EXPIRES ────────────────────────────────────────────────────
 *
 * A check that never goes stale is a claim about the past wearing the clothes
 * of the present. Records get removed — a DNS migration, a well-meaning IT
 * contractor — and a cached "verified" from six weeks ago would keep sending
 * into the damage. Old enough is treated as unchecked.
 *
 * Pure per ADR-0002. The lookup itself is the caller's.
 */

/**
 * How long a passing check stays good.
 *
 * Chosen, not derived, exactly as `CLOSING_SOON_MS` is: DNS records change
 * rarely, so re-checking hourly would be noise, while a month of trust after a
 * record disappears is a month of sending into a hole.
 */
export const DOMAIN_CHECK_TTL_MS = 7 * 24 * 3600 * 1000;

export const DNS_RECORDS = ['spf', 'dkim', 'dmarc'] as const;
export type DnsRecordKind = (typeof DNS_RECORDS)[number];

/**
 * 'ok' means present AND correctly shaped. Nothing else counts.
 *
 * G14 — `no_sender` is the fourth answer, and it is about US, not her: until a
 * sending provider exists there is no `include:` to look for, so a perfectly
 * good SPF record cannot be confirmed. Calling that 'malformed' told her to fix
 * a record that was already right — the one thing this page must never do.
 * It still refuses to send: unconfirmed is not confirmed.
 */
export type RecordState = 'missing' | 'malformed' | 'unauthorized' | 'no_sender' | 'ok';

export type DomainCheck = Readonly<Record<DnsRecordKind, RecordState>>;

export type LookupResult = Readonly<Record<DnsRecordKind, readonly string[]>>;

/**
 * SPF says which servers may send as this domain.
 *
 * `requiredInclude` is the sending provider's own mechanism, supplied by the
 * caller. Without it the record can only be checked for SHAPE, and a
 * well-formed SPF that does not authorise our sender is worse than none: it
 * publishes a list our mail is not on. That case is `unauthorized`, and it is
 * kept distinct from `malformed` because the fix is different — one is a typo,
 * the other is a missing line.
 */
export function checkSpf(txt: readonly string[], requiredInclude: string | null): RecordState {
  const record = txt.map((t) => t.trim()).find((t) => t.toLowerCase().startsWith('v=spf1'));
  if (!record) return 'missing';
  const tokens = record.toLowerCase().split(/\s+/).filter(Boolean);
  // G14 — a record may DELEGATE instead of terminating: `redirect=` hands the
  // whole policy to another domain, and RFC 7208 says an `all` must not appear
  // beside it. Demanding one called every delegating record malformed.
  const delegates = tokens.some((x) => x.startsWith('redirect='));
  // An "all" mechanism must otherwise terminate it, or receivers have no
  // instruction for everything not listed.
  if (!delegates && !/[-~?+]all\s*$/.test(record)) return 'malformed';
  // G14 — her record is fine; we are the ones who cannot check it yet.
  if (requiredInclude === null) return 'no_sender';
  // G14 — a WHOLE token. `includes()` matched 'include:mail.example.com' inside
  // 'include:mail.example.com.someone-else.net', which authorises a stranger.
  const authorized = tokens.includes(`include:${requiredInclude.toLowerCase()}`);
  return authorized ? 'ok' : 'unauthorized';
}

/** DKIM signs the mail. A published key with no key in it signs nothing. */
export function checkDkim(txt: readonly string[]): RecordState {
  const record = txt.map((t) => t.trim()).find((t) => t.toLowerCase().includes('v=dkim1'));
  if (!record) return 'missing';
  const key = /(?:^|;)\s*p\s*=\s*([A-Za-z0-9+/=]*)/.exec(record)?.[1] ?? '';
  // p= present but empty is how a key is REVOKED. It parses, and it means the
  // opposite of ready.
  return key.length > 0 ? 'ok' : 'malformed';
}

/**
 * DMARC tells receivers what to do when the first two disagree.
 *
 * Any published policy counts, `p=none` included. Requiring quarantine or
 * reject would be this product inventing a stricter rule than the receivers
 * apply and refusing domains that deliver perfectly well — the same class of
 * mistake as an invented threshold.
 */
export function checkDmarc(txt: readonly string[]): RecordState {
  const record = txt.map((t) => t.trim()).find((t) => t.toLowerCase().startsWith('v=dmarc1'));
  if (!record) return 'missing';
  return /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)\b/i.test(record) ? 'ok' : 'malformed';
}

export function checkDomain(found: LookupResult, requiredInclude: string | null): DomainCheck {
  return {
    spf: checkSpf(found.spf, requiredInclude),
    dkim: checkDkim(found.dkim),
    dmarc: checkDmarc(found.dmarc),
  };
}

export type DomainRefusal =
  | { readonly kind: 'never_checked' }
  | { readonly kind: 'stale'; readonly checkedAt: Date }
  | { readonly kind: 'incomplete'; readonly missing: readonly DnsRecordKind[] };

/**
 * May mail leave as this domain?
 *
 * FAIL CLOSED in three directions — never checked, checked too long ago, or
 * checked and found wanting. All three are the same answer to the send path and
 * three different sentences to the owner, because the thing she must do differs.
 */
export function mayUseDomain(
  state: { readonly check: DomainCheck | null; readonly checkedAt: Date | null },
  now: Date,
): Result<void, DomainRefusal> {
  if (!state.check || !state.checkedAt) return err({ kind: 'never_checked' });
  if (now.getTime() - state.checkedAt.getTime() > DOMAIN_CHECK_TTL_MS) {
    return err({ kind: 'stale', checkedAt: state.checkedAt });
  }
  const missing = DNS_RECORDS.filter((k) => state.check![k] !== 'ok');
  return missing.length === 0 ? ok(undefined) : err({ kind: 'incomplete', missing });
}

/** Where each record lives, so the page can tell her exactly what to add. */
export function recordHost(kind: DnsRecordKind, domain: string, dkimSelector: string): string {
  if (kind === 'dmarc') return `_dmarc.${domain}`;
  if (kind === 'dkim') return `${dkimSelector}._domainkey.${domain}`;
  return domain;
}
