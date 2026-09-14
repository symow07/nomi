/**
 * C5 · M41 — a SOURCE of prospects, as the product sees one.
 *
 * Apollo is the first implementation and must not be the shape: a CSV, Lusha,
 * or her own trade-show list should cost a file beside `apollo.ts`, not a change
 * to anything that calls this. So the vocabulary is the product's — a company,
 * a person, a search — and never a vendor's field names.
 *
 * ── THREE OPERATIONS, AND ONLY ONE IS FREE ────────────────────────────────
 *
 *   searchPeople   who might buy from her. Apollo's search does not reveal
 *                  addresses, and does not spend credits.
 *   revealEmail    one person's address. SPENDS A CREDIT.
 *   enrichDomain   what a company is. SPENDS A CREDIT.
 *
 * The two that cost money are only ever called on a person's explicit click —
 * never on arrival of a message, never in a loop — and a company already looked
 * up is read from `organization_enrichments` rather than bought again.
 *
 * ── A FAILURE IS A REASON, NEVER A MESSAGE ────────────────────────────────
 *
 * Vendor error bodies echo request details, and a request carries her key. A
 * failure here is a closed vocabulary the page can translate, and nothing a
 * provider said is carried past this boundary.
 */

export type Organization = {
  readonly name: string;
  readonly domain: string | null;
  readonly industry: string | null;
  readonly employees: number | null;
  readonly country: string | null;
  readonly city: string | null;
  readonly website: string | null;
  readonly linkedinUrl: string | null;
  readonly foundedYear: number | null;
};

export type Prospect = {
  /** The source's own id, which `revealEmail` takes. */
  readonly sourceId: string;
  readonly name: string;
  readonly title: string | null;
  readonly organization: string | null;
  readonly organizationDomain: string | null;
  readonly country: string | null;
  readonly city: string | null;
};

export const SOURCE_FAILURES = ['unauthorized', 'no_credits', 'rate_limited', 'unavailable', 'unreadable'] as const;
export type SourceFailureReason = (typeof SOURCE_FAILURES)[number];
export type SourceFailure = {
  readonly kind: 'failed';
  readonly reason: SourceFailureReason;
  /** Whether trying again later could help. A bad key will not. */
  readonly retryable: boolean;
};

export type EnrichOutcome =
  | { readonly kind: 'found'; readonly organization: Organization }
  | { readonly kind: 'not_found' }
  | SourceFailure;

export type SearchFilter = {
  readonly titles: readonly string[];
  readonly countries: readonly string[];
  readonly keywords: string | null;
  readonly employeesMin: number | null;
  readonly employeesMax: number | null;
  readonly page: number;
};

export type SearchOutcome =
  | {
    readonly kind: 'results';
    readonly prospects: readonly Prospect[];
    readonly page: number;
    readonly totalPages: number;
  }
  | SourceFailure;

export type RevealOutcome =
  | { readonly kind: 'found'; readonly email: string }
  | { readonly kind: 'not_found' }
  | SourceFailure;

export interface ProspectSource {
  /** Recorded on every enrichment row, so her page says where a fact came from. */
  readonly name: 'apollo' | 'fake';
  enrichDomain(domain: string): Promise<EnrichOutcome>;
  searchPeople(filter: SearchFilter): Promise<SearchOutcome>;
  revealEmail(sourceId: string): Promise<RevealOutcome>;
}

/** What builds a source from her key. The composition root holds the real one. */
export type ProspectSourceFor = (apiKey: string) => ProspectSource;
