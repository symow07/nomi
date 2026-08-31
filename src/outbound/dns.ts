import { Resolver } from 'node:dns/promises';
import { DNS_RECORDS, recordHost, type LookupResult } from '../core/outreach/domain.js';

/**
 * M40.1 — the only I/O the domain check needs.
 *
 * It lives here rather than under `src/channels/email/` on purpose: that
 * directory is what the M39 registry test reads as "this product has an e-mail
 * adapter", and it does not. Verifying a domain is not sending on it, and
 * creating the adapter's home before the adapter exists would flip e-mail to
 * available and put a switch in front of the owner that changes nothing.
 *
 * A LOOKUP THAT FAILS RETURNS NOTHING, NOT AN ERROR. Every failure mode here —
 * NXDOMAIN, a timeout, a resolver that is down — means the same thing to the
 * caller: we did not see the record. `checkDomain` reads an empty list as
 * 'missing', which is the fail-closed answer, and a thrown error at this level
 * would only tempt a caller into a catch that treats "could not check" as
 * "fine".
 */

/** Short, because an owner is watching this run on a page. */
const TIMEOUT_MS = 5000;

export type DnsLookup = (domain: string, dkimSelector: string) => Promise<LookupResult>;

export const resolveSendingRecords: DnsLookup = async (domain, dkimSelector) => {
  const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: 2 });
  const one = async (host: string): Promise<readonly string[]> => {
    try {
      // TXT records arrive as arrays of chunks; a long DKIM key is split across
      // several and means nothing until they are joined.
      return (await resolver.resolveTxt(host)).map((chunks) => chunks.join(''));
    } catch {
      return [];
    }
  };
  const entries = await Promise.all(
    DNS_RECORDS.map(async (kind) => [kind, await one(recordHost(kind, domain, dkimSelector))] as const),
  );
  return Object.fromEntries(entries) as unknown as LookupResult;
};
