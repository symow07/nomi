import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import {
  type Consent, type ConsentEvidence, type ContactChannel, type ContactSource,
  type Suppression, type SuppressionReason,
} from '../core/outreach/consent.js';

/**
 * M38 — the rows behind "may I write to this person".
 *
 * `contactability` is THE ONE READER of that question, the way
 * `enqueueOutboundRow` is the one writer of an outbound row. The owner surface
 * calls it to show state; M42's gate calls it to refuse a send. Two callers,
 * one query, so what she is shown and what the gate does cannot disagree —
 * which is the failure mode that makes a consent screen actively harmful.
 */

export type ContactRow = {
  readonly id: string | null;
  readonly channel: ContactChannel;
  readonly identity: string;
  readonly displayName: string | null;
  readonly company: string | null;
  /** C5 — a job title, from the search she chose them in. */
  readonly title?: string | null;
  readonly source: ContactSource;
  readonly firstSeen: Date;
  readonly archivedAt: Date | null;
  readonly consent: Consent | null;
  readonly suppression: Suppression | null;
};

/**
 * DERIVED CONSENT, not stored consent.
 *
 * A buyer who wrote to her first has consented, and the evidence is his own
 * message. This finds it every time rather than copying it into a row that
 * would then have to be kept true.
 *
 * ── IT JOINS `clients.phone`, AND THAT CHOICE IS THE WHOLE FEATURE ────────
 *
 * The obvious source is `client_channels`, which exists to hold exactly this.
 * It is the wrong one, and a screenshot of a seeded factory is what proved it:
 * six buyers mid-conversation, and an empty list.
 *
 *   * `ensureConversation` writes `clients.phone = waId` unconditionally, in
 *     the same statement that creates the client. It cannot be absent.
 *   * The `client_channels` row beside it is written `on conflict do nothing`
 *     against an index that is unique on (channel, channel_user_id) GLOBALLY —
 *     not per tenant. A number already claimed by another business silently
 *     produces no row at all, which is precisely what the demo factory hits.
 *
 * So joining the channel table means a buyer she is talking to right now can be
 * missing from the list of people she may write to — and missing here reads as
 * "no consent", which is the fail-closed direction and therefore invisible.
 * A quieter wrong answer is hard to imagine.
 *
 * `clients.phone` is also tenant-scoped, so the derivation cannot reach across
 * businesses the way the global channel index can.
 *
 * It is WhatsApp-only, and that is the legally correct answer rather than a
 * limitation: he messaged her on WhatsApp, so he consented to WhatsApp. Whatever
 * e-mail address she has for him is untouched by it and needs its own evidence.
 */
const DERIVED_INBOUND = sql`
  select min(dm.sent_at) as obtained_at
    from clients dcl
    join conversations dcv on dcv.client_id = dcl.id
    join messages dm       on dm.conversation_id = dcv.id and dm.direction = 'inbound'
   where dcl.phone is not null`;

type StateRow = {
  consent_evidence: string | null;
  consent_at: Date | null;
  consent_by: string | null;
  suppressed_reason: string | null;
  suppressed_at: Date | null;
};

const readState = (r: StateRow): Pick<ContactRow, 'consent' | 'suppression'> => ({
  consent: r.consent_evidence && r.consent_at
    ? {
      evidence: r.consent_evidence as ConsentEvidence,
      obtainedAt: r.consent_at,
      recordedBy: r.consent_by ?? 'buyer',
    }
    : null,
  suppression: r.suppressed_reason && r.suppressed_at
    ? { reason: r.suppressed_reason as SuppressionReason, at: r.suppressed_at }
    : null,
});

/**
 * The two rows `mayContact` needs, for one identity.
 *
 * Stored consent and derived consent are coalesced with the STORED one first:
 * an attestation she signed names a person, and a derivation names nobody. When
 * both exist they agree about the answer anyway.
 */
export async function contactability(
  tx: Tx, businessId: BusinessId, channel: ContactChannel, identity: string,
): Promise<{ consent: Consent | null; suppression: Suppression | null }> {
  const row = (await sql<StateRow>`
    select c.evidence as consent_evidence,
           coalesce(c.obtained_at, d.obtained_at) as consent_at,
           case when c.evidence is not null then c.recorded_by end as consent_by,
           s.reason as suppressed_reason,
           s.at     as suppressed_at
      from (select 1) as _
      left join lateral (
        select evidence, obtained_at, recorded_by from contact_consent
         where business_id = ${businessId}::uuid and channel = ${channel} and identity = ${identity}
         order by obtained_at desc limit 1
      ) c on true
      left join lateral (
        ${DERIVED_INBOUND} and ${channel} = 'whatsapp'
          and dcl.business_id = ${businessId}::uuid and dcl.phone = ${identity}
      ) d on true
      left join lateral (
        select reason, at from suppressions
         where business_id = ${businessId}::uuid and channel = ${channel} and identity = ${identity}
      ) s on true`.execute(tx)).rows[0];

  if (!row) return { consent: null, suppression: null };
  // A derived hit with no stored row is `inbound_message` — his message is the
  // evidence, and nobody recorded it.
  const state = readState(row);
  if (!state.consent && row.consent_at) {
    return {
      consent: { evidence: 'inbound_message', obtainedAt: row.consent_at, recordedBy: 'buyer' },
      suppression: state.suppression,
    };
  }
  return state;
}

/** Everyone she could write to, and everyone she may not. Her page reads this. */
export async function listContacts(tx: Tx, businessId: BusinessId): Promise<readonly ContactRow[]> {
  const rows = await sql<StateRow & {
    id: string | null; channel: string; identity: string; display_name: string | null;
    company: string | null; title: string | null; source: string; first_seen: Date; archived_at: Date | null;
  }>`
    with added as (
      select id::text as id, channel, identity, display_name, company, title, source,
             created_at as first_seen, archived_at
        from contacts where business_id = ${businessId}::uuid
    ),
    wrote as (
      -- The buyers themselves, derived. Never copied into the contacts table,
      -- and read from the column that is always written — see DERIVED_INBOUND.
      select null::text as id, 'whatsapp' as channel, c.phone as identity,
             max(c.display_name) as display_name, null::text as company, null::text as title, 'inbound' as source,
             min(m.sent_at) as first_seen, null::timestamptz as archived_at
        from clients c
        join conversations v on v.client_id = c.id
        join messages m      on m.conversation_id = v.id and m.direction = 'inbound'
       where c.business_id = ${businessId}::uuid and c.phone is not null
       group by c.phone
    ),
    -- One row per identity. A row she curated wins over the derived one because
    -- it carries the name and company she typed; one she ARCHIVED loses to it,
    -- because archiving is a decision about her list, not about whether he wrote.
    merged as (
      select distinct on (channel, identity) *
        from (select * from added union all select * from wrote) u
       order by channel, identity, (archived_at is null) desc, (id is not null) desc
    )
    select x.*,
           c.evidence as consent_evidence,
           coalesce(c.obtained_at, d.obtained_at) as consent_at,
           case when c.evidence is not null then c.recorded_by end as consent_by,
           s.reason as suppressed_reason, s.at as suppressed_at
      from merged x
      left join lateral (
        select evidence, obtained_at, recorded_by from contact_consent
         where business_id = ${businessId}::uuid and channel = x.channel and identity = x.identity
         order by obtained_at desc limit 1
      ) c on true
      left join lateral (
        ${DERIVED_INBOUND} and x.channel = 'whatsapp'
          and dcl.business_id = ${businessId}::uuid and dcl.phone = x.identity
      ) d on true
      left join lateral (
        select reason, at from suppressions
         where business_id = ${businessId}::uuid and channel = x.channel and identity = x.identity
      ) s on true
     order by (s.reason is not null), x.first_seen desc`.execute(tx);

  return rows.rows.map((r) => {
    const state = readState(r);
    const consent = state.consent ?? (r.consent_at
      ? { evidence: 'inbound_message' as const, obtainedAt: r.consent_at, recordedBy: 'buyer' }
      : null);
    return {
      id: r.id, channel: r.channel as ContactChannel, identity: r.identity,
      displayName: r.display_name, company: r.company, title: r.title, source: r.source as ContactSource,
      firstSeen: r.first_seen, archivedAt: r.archived_at,
      consent, suppression: state.suppression,
    };
  });
}

/** A person she met. The identity arrives normalised — see `normalizeIdentity`. */
export async function addContact(tx: Tx, businessId: BusinessId, input: {
  readonly channel: ContactChannel; readonly identity: string;
  readonly displayName: string | null; readonly company: string | null;
  readonly createdBy: string;
}): Promise<void> {
  await sql`
    insert into contacts (business_id, channel, identity, display_name, company, source, created_by)
    values (${businessId}::uuid, ${input.channel}, ${input.identity}, ${input.displayName},
            ${input.company}, 'manual', ${input.createdBy})
    on conflict (business_id, channel, identity) where archived_at is null do nothing`.execute(tx);
}

/** ARCHIVE, NEVER ERASE. Her record of who she has met is hers. */
export async function archiveContact(tx: Tx, businessId: BusinessId, id: string): Promise<void> {
  await sql`update contacts set archived_at = now()
             where id = ${id}::uuid and business_id = ${businessId}::uuid and archived_at is null`
    .execute(tx);
}

/** How we know — with the name of whoever stands behind it. */
export async function recordConsent(tx: Tx, businessId: BusinessId, input: {
  readonly channel: ContactChannel; readonly identity: string;
  readonly evidence: ConsentEvidence; readonly note: string | null; readonly recordedBy: string;
}): Promise<void> {
  await sql`
    insert into contact_consent (business_id, channel, identity, evidence, note, recorded_by)
    values (${businessId}::uuid, ${input.channel}, ${input.identity}, ${input.evidence},
            ${input.note}, ${input.recordedBy})`.execute(tx);
}

/**
 * NEVER AGAIN.
 *
 * `do nothing` on conflict rather than an update: the FIRST time an identity was
 * suppressed is the fact worth keeping, and a later bounce must not quietly
 * restate an earlier complaint. The app role could not update it anyway.
 */
export async function suppress(tx: Tx, businessId: BusinessId, input: {
  readonly channel: ContactChannel; readonly identity: string;
  readonly reason: SuppressionReason; readonly detail: string | null;
}): Promise<void> {
  await sql`
    insert into suppressions (business_id, channel, identity, reason, detail)
    values (${businessId}::uuid, ${input.channel}, ${input.identity}, ${input.reason}, ${input.detail})
    on conflict (business_id, channel, identity) do nothing`.execute(tx);
}
