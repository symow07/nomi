import { withTenantTx, type Db } from '../db/client.js';
import type { BusinessId } from '../core/types/ids.js';
import { checkDomain, type DomainCheck } from '../core/outreach/domain.js';
import { recordDomainCheck, sendingDomain } from '../db/sendingDomain.js';
import { liveMailAccount } from '../db/mailAccounts.js';
import { spfIncludeFor } from '../connectors/oauth.js';
import type { DnsLookup } from './dns.js';

/**
 * M40.1 — looking at her DNS records, by her hand or by the clock.
 *
 * A passing check is good for `DOMAIN_CHECK_TTL_MS` (a week) and then reads as
 * unchecked, so a record removed last month cannot keep authorising sends. That
 * rule stays. What it left out is who looks again: only her "Look again"
 * button did, so a week after she set up her domain every follow-up in flight
 * was held, and a week after that stopped, for a reason she had done nothing to
 * cause. The records had not changed; nobody had looked.
 *
 * Now the clock looks too — daily when the last look passed, hourly when it did
 * not, so a resolver that failed one night is not a week of held mail. It looks
 * exactly the way her button does, through this one function, and it can only
 * ever record what DNS says: a lookup that fails still reads as `missing`.
 */

export type DomainCheckDeps = {
  readonly db: Db;
  readonly resolveDns: DnsLookup;
  /** The host's own SPF mechanism; unset, the connected mailbox's (C6). */
  readonly sendingInclude: string | null;
};

/** How long a PASSING look is left alone before the clock looks again. */
export const RECHECK_PASSING_AFTER_MS = 24 * 3600_000;
/** How long a FAILING one is — short, because mail is held until it passes. */
export const RECHECK_FAILING_AFTER_MS = 3600_000;

/** Look now, record what was found, and return it — null when she has named no domain. */
export async function checkSendingDomainNow(
  deps: DomainCheckDeps, businessId: BusinessId, now: Date,
): Promise<DomainCheck | null> {
  const row = await withTenantTx(deps.db, businessId, (tx) => sendingDomain(tx, businessId));
  if (!row) return null;
  // I/O outside the transaction: a slow resolver must not hold a connection.
  const found = await deps.resolveDns(row.domain, row.dkimSelector);
  const mailbox = await withTenantTx(deps.db, businessId, (tx) => liveMailAccount(tx, businessId));
  const check = checkDomain(found, deps.sendingInclude ?? spfIncludeFor(mailbox?.provider));
  await withTenantTx(deps.db, businessId, (tx) => recordDomainCheck(tx, businessId, check, now));
  return check;
}

/** Whether the clock should look again, given the last look. Pure. */
function recheckDue(
  last: { readonly check: DomainCheck | null; readonly checkedAt: Date | null }, now: Date,
): boolean {
  if (!last.checkedAt || !last.check) return true;
  const passing = last.check.spf === 'ok' && last.check.dkim === 'ok' && last.check.dmarc === 'ok';
  return now.getTime() - last.checkedAt.getTime() >= (passing ? RECHECK_PASSING_AFTER_MS : RECHECK_FAILING_AFTER_MS);
}

/**
 * The clock's look: only when she has named a domain and the last look is old
 * enough. Never checked at all counts as due — but a domain nobody has checked
 * is one she is still setting up, and looking for her changes nothing she can
 * see except a sentence that is true either way.
 */
export async function refreshDomainCheckIfDue(
  deps: DomainCheckDeps, businessId: BusinessId, now: Date,
): Promise<'checked' | 'fresh' | 'no_domain'> {
  const row = await withTenantTx(deps.db, businessId, (tx) => sendingDomain(tx, businessId));
  if (!row) return 'no_domain';
  if (!recheckDue(row, now)) return 'fresh';
  await checkSendingDomainNow(deps, businessId, now);
  return 'checked';
}
