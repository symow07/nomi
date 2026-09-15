import type {
  EnrichOutcome, Organization, Prospect, ProspectSource, RevealOutcome, SearchFilter, SearchOutcome,
} from '../../src/connectors/contract.js';

/**
 * C5 — the prospect source every test uses. It lives here, not in src/: an
 * installation with no Apollo key has NO source (the page asks for a key), and a
 * fake reachable from production would be a place a lookup could silently go.
 *
 * It records what it was asked, because what the product must PROVE about a
 * paid source is how often it spends: a lookup a person did not click for, or a
 * company looked up twice, is money gone. A fake that only answered could not
 * show either.
 */
export type FakeSourceData = {
  readonly organizations?: Readonly<Record<string, Organization>>;
  readonly prospects?: readonly (Prospect & { readonly email: string | null })[];
  /** Answer every call with this failure instead — the key is wrong, the credits ran out. */
  readonly failWith?: Extract<EnrichOutcome, { kind: 'failed' }>;
};

export function fakeProspectSource(data: FakeSourceData = {}): ProspectSource & {
  readonly calls: { readonly op: 'enrich' | 'search' | 'reveal'; readonly arg: string }[];
} {
  const calls: { op: 'enrich' | 'search' | 'reveal'; arg: string }[] = [];
  return {
    name: 'fake',
    calls,
    async enrichDomain(domain: string): Promise<EnrichOutcome> {
      calls.push({ op: 'enrich', arg: domain });
      if (data.failWith) return data.failWith;
      const org = data.organizations?.[domain];
      return org ? { kind: 'found', organization: org } : { kind: 'not_found' };
    },
    async searchPeople(filter: SearchFilter): Promise<SearchOutcome> {
      calls.push({ op: 'search', arg: JSON.stringify(filter) });
      if (data.failWith) return data.failWith;
      const kw = filter.keywords?.toLowerCase() ?? null;
      const prospects = (data.prospects ?? []).filter((p) =>
        (filter.titles.length === 0 || filter.titles.some((t) => p.title?.toLowerCase().includes(t.toLowerCase())))
        && (filter.countries.length === 0 || filter.countries.some((c) => p.country?.toLowerCase() === c.toLowerCase()))
        && (kw === null || `${p.name} ${p.title ?? ''} ${p.organization ?? ''}`.toLowerCase().includes(kw)));
      return {
        kind: 'results',
        prospects: prospects.map(({ email: _e, ...p }) => p),
        page: filter.page, totalPages: prospects.length === 0 ? 0 : 1,
      };
    },
    async revealEmail(sourceId: string): Promise<RevealOutcome> {
      calls.push({ op: 'reveal', arg: sourceId });
      if (data.failWith) return data.failWith;
      const p = (data.prospects ?? []).find((x) => x.sourceId === sourceId);
      return p?.email ? { kind: 'found', email: p.email } : { kind: 'not_found' };
    },
  };
}
