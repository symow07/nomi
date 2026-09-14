import { withTenantTx, type Db } from '../db/client.js';
import {
  addProspectContact, archiveConnectorKey, latestEnrichments, liveConnectorKey, recordEnrichment,
  replaceConnectorKey, type Enrichment,
} from '../db/prospects.js';
import { credentialFingerprint, decryptSecret, encryptSecret } from '../security/credentials.js';
import { companyDomainOf, ENRICHMENT_REUSE_DAYS } from '../core/outreach/companyDomain.js';
import { normalizeIdentity } from '../core/outreach/consent.js';
import type {
  ProspectSource, ProspectSourceFor, SearchFilter, SearchOutcome, SourceFailureReason,
} from '../connectors/contract.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * C5 · M41 — prospecting, as a person does it: her key, a company she wants to
 * know about, a search she reads, a person she chooses.
 *
 * ── NO NETWORK CALL HOLDS A TRANSACTION ───────────────────────────────────
 *
 * Each operation reads what it needs in one tenant transaction, closes it, asks
 * the source, and writes the answer in another. A vendor that takes fifteen
 * seconds to time out must not hold a database connection — or a row lock on her
 * contact list — for those fifteen seconds.
 *
 * ── EVERY CREDIT IS A CLICK ───────────────────────────────────────────────
 *
 * Nothing here runs on its own: no lookup when a message arrives, no loop over
 * her list. Each function that can spend is called by a route a person pressed,
 * and `lookUpCompany` reads the last answer for a domain before it buys another.
 */

export type ProspectDeps = {
  readonly db: Db;
  readonly now: () => Date;
  /** CREDENTIAL_KEY, derived. Null where the installation cannot keep a secret. */
  readonly credentialKey: Buffer | null;
  /** Builds a source from her key. Null where no source is wired. */
  readonly sourceFor: ProspectSourceFor | null;
};

/** Why nothing could be asked at all — before any source was reached. */
export type NoSource = 'no_key' | 'no_key_store' | 'unreadable_key';

export type KeyStatus =
  | { readonly kind: 'none' }
  | { readonly kind: 'no_key_store' }
  | {
    readonly kind: 'stored';
    readonly fingerprint: string;
    readonly createdBy: string;
    readonly createdAt: Date;
    /** False when the installation's CREDENTIAL_KEY no longer opens it. */
    readonly readable: boolean;
  };

/** Apollo's keys are a short run of letters, digits, `_` and `-`. Anything else is a paste mistake. */
const KEY_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

export async function keyStatus(deps: ProspectDeps, businessId: BusinessId): Promise<KeyStatus> {
  if (!deps.credentialKey) return { kind: 'no_key_store' };
  const stored = await withTenantTx(deps.db, businessId, (tx) => liveConnectorKey(tx, businessId, 'apollo'));
  if (!stored) return { kind: 'none' };
  let readable = true;
  try { decryptSecret(stored.ciphertext, deps.credentialKey); } catch { readable = false; }
  return {
    kind: 'stored', fingerprint: stored.fingerprint, createdBy: stored.createdBy,
    createdAt: stored.createdAt, readable,
  };
}

/**
 * Her key, encrypted before it touches a row. The value is never logged, never
 * rendered back, and never compared except by its fingerprint.
 */
export async function saveKey(
  deps: ProspectDeps, input: { readonly businessId: BusinessId; readonly apiKey: string; readonly by: string },
): Promise<'saved' | 'invalid' | 'no_key_store'> {
  if (!deps.credentialKey) return 'no_key_store';
  const apiKey = input.apiKey.trim();
  if (!KEY_SHAPE.test(apiKey)) return 'invalid';
  const ciphertext = encryptSecret(apiKey, deps.credentialKey);
  await withTenantTx(deps.db, input.businessId, (tx) => replaceConnectorKey(tx, input.businessId, {
    connector: 'apollo', ciphertext, keyVersion: 1, fingerprint: credentialFingerprint(apiKey), by: input.by,
  }));
  return 'saved';
}

export async function removeKey(
  deps: ProspectDeps, input: { readonly businessId: BusinessId; readonly by: string },
): Promise<boolean> {
  return withTenantTx(deps.db, input.businessId, (tx) => archiveConnectorKey(tx, input.businessId, 'apollo', input.by));
}

async function sourceOf(deps: ProspectDeps, businessId: BusinessId): Promise<ProspectSource | NoSource> {
  if (!deps.credentialKey || !deps.sourceFor) return 'no_key_store';
  const stored = await withTenantTx(deps.db, businessId, (tx) => liveConnectorKey(tx, businessId, 'apollo'));
  if (!stored) return 'no_key';
  try {
    return deps.sourceFor(decryptSecret(stored.ciphertext, deps.credentialKey).plain);
  } catch {
    // The installation's CREDENTIAL_KEY changed and this row was written under
    // the old one. She is asked to paste the key again; nothing is guessed.
    return 'unreadable_key';
  }
}

export type LookupOutcome =
  | 'found' | 'not_found' | 'reused' | 'personal' | 'not_an_email' | NoSource | SourceFailureReason;

/** What company is behind this address — bought once per domain per `ENRICHMENT_REUSE_DAYS`. */
export async function lookUpCompany(
  deps: ProspectDeps, input: { readonly businessId: BusinessId; readonly address: string; readonly by: string },
): Promise<LookupOutcome> {
  const address = normalizeIdentity('email', input.address);
  if (!address.ok) return 'not_an_email';
  const domain = companyDomainOf(address.value);
  if (!domain) return 'personal';

  const previous = (await withTenantTx(deps.db, input.businessId, (tx) =>
    latestEnrichments(tx, input.businessId, [domain]))).get(domain);
  const fresh = previous
    && deps.now().getTime() - previous.lookedUpAt.getTime() < ENRICHMENT_REUSE_DAYS * 24 * 3600_000;
  if (fresh) return 'reused';

  const source = await sourceOf(deps, input.businessId);
  if (typeof source === 'string') return source;
  const r = await source.enrichDomain(domain);
  if (r.kind === 'failed') return r.reason;       // not recorded: a failure is worth asking again
  await withTenantTx(deps.db, input.businessId, (tx) => recordEnrichment(tx, input.businessId, {
    domain, source: source.name, organization: r.kind === 'found' ? r.organization : null, by: input.by,
  }));
  return r.kind;
}

/** For a page: the last word on each address's company, where there is one. */
export async function enrichmentsFor(
  deps: ProspectDeps, businessId: BusinessId, addresses: readonly string[],
): Promise<ReadonlyMap<string, Enrichment>> {
  const domains = [...new Set(addresses.map(companyDomainOf).filter((d): d is string => d !== null))];
  return withTenantTx(deps.db, businessId, (tx) => latestEnrichments(tx, businessId, domains));
}

export async function searchProspects(
  deps: ProspectDeps, input: { readonly businessId: BusinessId; readonly filter: SearchFilter },
): Promise<SearchOutcome | { readonly kind: NoSource }> {
  const source = await sourceOf(deps, input.businessId);
  if (typeof source === 'string') return { kind: source };
  return source.searchPeople(input.filter);
}

export type AddOutcome = 'added' | 'exists' | 'not_found' | NoSource | SourceFailureReason;

/**
 * She chose this person: find their business address (ONE credit) and put them
 * on her list as an Apollo contact, with no consent.
 */
export async function addProspect(
  deps: ProspectDeps,
  input: {
    readonly businessId: BusinessId; readonly sourceId: string; readonly name: string;
    readonly title: string | null; readonly organization: string | null; readonly by: string;
  },
): Promise<AddOutcome> {
  const source = await sourceOf(deps, input.businessId);
  if (typeof source === 'string') return source;
  const r = await source.revealEmail(input.sourceId);
  if (r.kind === 'failed') return r.reason;
  if (r.kind === 'not_found') return 'not_found';
  const identity = normalizeIdentity('email', r.email);
  if (!identity.ok) return 'not_found';
  return withTenantTx(deps.db, input.businessId, (tx) => addProspectContact(tx, input.businessId, {
    identity: identity.value, displayName: input.name.slice(0, 120),
    company: input.organization?.slice(0, 120) ?? null, title: input.title?.slice(0, 120) ?? null,
    by: input.by, sourceDetail: `${source.name}:${input.sourceId}`.slice(0, 200),
  }));
}
