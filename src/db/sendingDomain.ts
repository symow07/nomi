import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import type { DomainCheck, RecordState } from '../core/outreach/domain.js';

/**
 * M40.1 — the one row that says which domain her mail leaves as.
 *
 * The check result stored here is a CACHE of a DNS lookup and `checked_at` is
 * the part that makes it safe: `mayUseDomain` refuses a result older than its
 * TTL, so a record removed last month cannot keep authorising sends. Nothing
 * reads the states without also reading the timestamp.
 */

export type SendingDomain = {
  readonly domain: string;
  readonly dkimSelector: string;
  readonly check: DomainCheck | null;
  readonly checkedAt: Date | null;
  readonly addedAt: Date;
};

type Row = {
  domain: string; dkim_selector: string;
  spf_state: string | null; dkim_state: string | null; dmarc_state: string | null;
  checked_at: Date | null; added_at: Date;
};

const read = (r: Row): SendingDomain => ({
  domain: r.domain,
  dkimSelector: r.dkim_selector,
  // All three or none: a half-stored result would let a caller read one 'ok'
  // and conclude something about the others.
  check: r.spf_state && r.dkim_state && r.dmarc_state
    ? {
      spf: r.spf_state as RecordState,
      dkim: r.dkim_state as RecordState,
      dmarc: r.dmarc_state as RecordState,
    }
    : null,
  checkedAt: r.checked_at,
  addedAt: r.added_at,
});

export async function sendingDomain(
  tx: Tx, businessId: BusinessId,
): Promise<SendingDomain | null> {
  const r = await sql<Row>`
    select domain, dkim_selector, spf_state, dkim_state, dmarc_state, checked_at, added_at
      from sending_domains where business_id = ${businessId}::uuid`.execute(tx);
  return r.rows[0] ? read(r.rows[0]) : null;
}

/**
 * She names her domain. THE CHECK IS CLEARED, not carried over.
 *
 * A new domain has never been checked, and inheriting the previous one's
 * passing result is exactly how mail would leave as a domain nobody verified.
 * Changing the selector clears it too: the DKIM record lives at a host derived
 * from the selector, so a different selector is a different record.
 */
export async function setSendingDomain(
  tx: Tx, businessId: BusinessId,
  input: { readonly domain: string; readonly dkimSelector: string; readonly by: string },
): Promise<void> {
  await sql`
    insert into sending_domains (business_id, domain, dkim_selector, added_by)
    values (${businessId}::uuid, ${input.domain}, ${input.dkimSelector}, ${input.by})
    on conflict (business_id) do update
      set domain = excluded.domain,
          dkim_selector = excluded.dkim_selector,
          added_by = excluded.added_by,
          added_at = now(),
          spf_state = null, dkim_state = null, dmarc_state = null, checked_at = null`
    .execute(tx);
}

/** The result of a lookup, with the time it was taken — never one without the other. */
export async function recordDomainCheck(
  tx: Tx, businessId: BusinessId, check: DomainCheck, at: Date,
): Promise<void> {
  await sql`
    update sending_domains
       set spf_state = ${check.spf}, dkim_state = ${check.dkim}, dmarc_state = ${check.dmarc},
           checked_at = ${at}
     where business_id = ${businessId}::uuid`.execute(tx);
}
