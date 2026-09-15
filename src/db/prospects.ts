import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import type { Organization } from '../connectors/contract.js';

/**
 * C5 · M41 — the rows behind prospecting (0049). A store; it decides nothing.
 *
 * ── NOTHING ON THE CONVERSATION PATH MAY IMPORT THIS FILE ─────────────────
 *
 * `organization_enrichments` is for people to read. The employee answering a
 * buyer must never be handed what a purchased profile says about him, so the
 * pipeline, the model ports, the conversation core and the trust harness do not
 * import this module, and `tests/parity/c5-prospects.test.ts` walks their
 * imports to hold them to it.
 */

export type ConnectorName = 'apollo';

export type StoredKey = {
  readonly ciphertext: string;
  readonly keyVersion: number;
  readonly fingerprint: string;
  readonly createdBy: string;
  readonly createdAt: Date;
};

export async function liveConnectorKey(
  tx: Tx, businessId: BusinessId, connector: ConnectorName,
): Promise<StoredKey | null> {
  const r = (await sql<{
    secret_ciphertext: string; key_version: number; fingerprint: string; created_by: string; created_at: Date;
  }>`select secret_ciphertext, key_version, fingerprint, created_by, created_at from connector_credentials
      where business_id = ${businessId}::uuid and connector = ${connector} and archived_at is null
      limit 1`.execute(tx)).rows[0];
  return r ? {
    ciphertext: r.secret_ciphertext, keyVersion: r.key_version, fingerprint: r.fingerprint,
    createdBy: r.created_by, createdAt: r.created_at,
  } : null;
}

/** A new key replaces the live one: the old row is ARCHIVED in the same transaction. */
export async function replaceConnectorKey(
  tx: Tx, businessId: BusinessId,
  input: {
    readonly connector: ConnectorName; readonly ciphertext: string; readonly keyVersion: number;
    readonly fingerprint: string; readonly by: string;
  },
): Promise<void> {
  await archiveConnectorKey(tx, businessId, input.connector, input.by);
  await sql`
    insert into connector_credentials (business_id, connector, secret_ciphertext, key_version, fingerprint, created_by)
    values (${businessId}::uuid, ${input.connector}, ${input.ciphertext}, ${input.keyVersion},
            ${input.fingerprint}, ${input.by})`.execute(tx);
}

export async function archiveConnectorKey(
  tx: Tx, businessId: BusinessId, connector: ConnectorName, by: string,
): Promise<boolean> {
  const r = await sql`update connector_credentials set archived_at = now(), archived_by = ${by}
                       where business_id = ${businessId}::uuid and connector = ${connector}
                         and archived_at is null`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

export type Enrichment = {
  readonly domain: string;
  readonly source: string;
  readonly found: boolean;
  readonly organization: Organization | null;
  readonly lookedUpBy: string;
  readonly lookedUpAt: Date;
};

type EnrichmentRow = {
  domain: string; source: string; found: boolean; name: string | null; industry: string | null;
  employees: number | null; country: string | null; city: string | null; website: string | null;
  linkedin_url: string | null; founded_year: number | null; looked_up_by: string; looked_up_at: Date;
};

const readRow = (r: EnrichmentRow): Enrichment => ({
  domain: r.domain, source: r.source, found: r.found, lookedUpBy: r.looked_up_by, lookedUpAt: r.looked_up_at,
  organization: r.found && r.name ? {
    name: r.name, domain: r.domain, industry: r.industry, employees: r.employees, country: r.country,
    city: r.city, website: r.website, linkedinUrl: r.linkedin_url, foundedYear: r.founded_year,
  } : null,
});

/** The newest lookup for each domain asked about. */
export async function latestEnrichments(
  tx: Tx, businessId: BusinessId, domains: readonly string[],
): Promise<ReadonlyMap<string, Enrichment>> {
  if (domains.length === 0) return new Map();
  const rows = (await sql<EnrichmentRow>`
    select distinct on (domain) domain, source, found, name, industry, employees, country, city,
           website, linkedin_url, founded_year, looked_up_by, looked_up_at
      from organization_enrichments
     where business_id = ${businessId}::uuid and domain = any(${sql.val([...domains])}::text[])
     order by domain, looked_up_at desc`.execute(tx)).rows;
  return new Map(rows.map((r) => [r.domain, readRow(r)]));
}

/** What a source said — including "no such company", which is worth not asking again. */
export async function recordEnrichment(
  tx: Tx, businessId: BusinessId,
  input: { readonly domain: string; readonly source: string; readonly organization: Organization | null; readonly by: string },
): Promise<void> {
  const o = input.organization;
  await sql`
    insert into organization_enrichments
      (business_id, domain, source, found, name, industry, employees, country, city, website,
       linkedin_url, founded_year, looked_up_by)
    values (${businessId}::uuid, ${input.domain}, ${input.source}, ${o !== null},
            ${o?.name ?? null}, ${o?.industry ?? null}, ${o?.employees ?? null}, ${o?.country ?? null},
            ${o?.city ?? null}, ${o?.website ?? null}, ${o?.linkedinUrl ?? null}, ${o?.foundedYear ?? null},
            ${input.by})`.execute(tx);
}

/**
 * Someone she chose from a search, on her list — with NO consent. A search
 * result has agreed to nothing, and the outreach gate will say exactly that on
 * his row until a basis for writing to him is recorded (M38).
 */
export async function addProspectContact(
  tx: Tx, businessId: BusinessId,
  input: {
    readonly identity: string; readonly displayName: string; readonly company: string | null;
    readonly title: string | null; readonly by: string; readonly sourceDetail: string;
  },
): Promise<'added' | 'exists'> {
  const r = await sql<{ id: string }>`
    insert into contacts (business_id, channel, identity, display_name, company, title, source, source_detail, created_by)
    values (${businessId}::uuid, 'email', ${input.identity}, ${input.displayName}, ${input.company},
            ${input.title}, 'apollo', ${input.sourceDetail}, ${input.by})
    on conflict (business_id, channel, identity) where archived_at is null do nothing
    returning id::text as id`.execute(tx);
  return r.rows.length > 0 ? 'added' : 'exists';
}
