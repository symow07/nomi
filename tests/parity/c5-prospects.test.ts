import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  apolloSource, readOrganization, readProspect, readRevealedEmail, type ApolloFetch,
} from '../../src/connectors/apollo.js';
import { companyDomainOf, domainOfAddress } from '../../src/core/outreach/companyDomain.js';
import { filterFromQuery, queryOf, renderProspects, companyLineHtml } from '../../src/api/web/prospects.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * C5 · M41 — Apollo behind a connector.
 *
 * Three things are on trial. That her key goes one place and a failure carries
 * nothing a vendor said. That a credit is only spent where a person asked. And
 * the roadmap's hard rule, asserted at source level as it asked: what a
 * purchased profile says about a buyer can never reach the employee who answers
 * him, because nothing on that path can import it.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KEY = 'apollo_test_key_1234567890';

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function wire(answer: (c: Call) => { status: number; body: unknown }): { fetchImpl: ApolloFetch; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      const c = { url, method: init.method, headers: init.headers, ...(init.body ? { body: init.body } : {}) };
      calls.push(c);
      const a = answer(c);
      return { status: a.status, text: async () => (typeof a.body === 'string' ? a.body : JSON.stringify(a.body)) };
    },
  };
}

describe('C5 · her key goes one place', () => {
  it('in the X-Api-Key header — never in a URL, which servers log', async () => {
    const w = wire(() => ({ status: 200, body: { organization: { name: 'Gulf Trading', estimated_num_employees: 60 } } }));
    await apolloSource({ apiKey: KEY, fetchImpl: w.fetchImpl }).enrichDomain('gulftrading.ae');
    expect(w.calls[0]!.headers['X-Api-Key']).toBe(KEY);
    expect(w.calls[0]!.url).not.toContain(KEY);
    expect(w.calls[0]!.url).toBe('https://api.apollo.io/api/v1/organizations/enrich?domain=gulftrading.ae');
  });

  it('A FAILURE IS A REASON, and carries nothing the vendor said — its body can echo the request', async () => {
    for (const [status, reason] of [[401, 'unauthorized'], [403, 'unauthorized'], [429, 'rate_limited'],
      [503, 'unavailable'], [422, 'unreadable'], [418, 'unreadable']] as const) {
      const w = wire(() => ({ status, body: `{"error":"bad key ${KEY}"}` }));
      const r = await apolloSource({ apiKey: KEY, fetchImpl: w.fetchImpl }).enrichDomain('x.com');
      expect(r, String(status)).toMatchObject({ kind: 'failed', reason });
      expect(JSON.stringify(r), 'the key left in a failure').not.toContain(KEY);
    }
  });

  it('out of credits is named, so she is told to top up rather than to check her key', async () => {
    const w = wire(() => ({ status: 422, body: { error: 'Insufficient credits' } }));
    expect(await apolloSource({ apiKey: KEY, fetchImpl: w.fetchImpl }).revealEmail('p1'))
      .toEqual({ kind: 'failed', reason: 'no_credits', retryable: false });
  });

  it('a dropped connection or a timeout is "unavailable", retryable, and says nothing more', async () => {
    const r = await apolloSource({
      apiKey: KEY, fetchImpl: async () => { throw new Error(`socket hang up ${KEY}`); },
    }).searchPeople({ titles: [], countries: [], keywords: null, employeesMin: null, employeesMax: null, page: 1 });
    expect(r).toEqual({ kind: 'failed', reason: 'unavailable', retryable: true });
  });
});

describe('C5 · reading what Apollo sends, and refusing what it cannot vouch for', () => {
  it('a company, from its own field names into ours', () => {
    expect(readOrganization({
      name: 'Gulf Trading LLC', primary_domain: 'gulftrading.ae', industry: 'wholesale',
      estimated_num_employees: 60, country: 'United Arab Emirates', city: 'Dubai',
      website_url: 'http://www.gulftrading.ae', linkedin_url: 'http://linkedin.com/company/x', founded_year: 2009,
    })).toEqual({
      name: 'Gulf Trading LLC', domain: 'gulftrading.ae', industry: 'wholesale', employees: 60,
      country: 'United Arab Emirates', city: 'Dubai', website: 'http://www.gulftrading.ae',
      linkedinUrl: 'http://linkedin.com/company/x', foundedYear: 2009,
    });
    expect(readOrganization({ industry: 'no name' })).toBeNull();
    expect(readOrganization(null)).toBeNull();
  });

  it('a person, with a domain taken from the website when there is no primary one', () => {
    expect(readProspect({
      id: 'p1', first_name: 'Ahmed', last_name: 'Saeed', title: 'Purchasing Manager', country: 'UAE',
      organization: { name: 'Gulf Trading', website_url: 'https://www.gulftrading.ae/about' },
    })).toMatchObject({ sourceId: 'p1', name: 'Ahmed Saeed', organizationDomain: 'gulftrading.ae' });
    expect(readProspect({ name: 'No Id' })).toBeNull();
  });

  it('AN ADDRESS APOLLO WILL NOT STAND BEHIND IS NO ADDRESS: a placeholder, or an unverified one', () => {
    expect(readRevealedEmail({ person: { email: 'ahmed@gulftrading.ae', email_status: 'verified' } })).toBe('ahmed@gulftrading.ae');
    expect(readRevealedEmail({ person: { email: 'email_not_unlocked@domain.com', email_status: 'verified' } })).toBeNull();
    expect(readRevealedEmail({ person: { email: 'guess@gulftrading.ae', email_status: 'guessed' } })).toBeNull();
    expect(readRevealedEmail({ person: { email: null } })).toBeNull();
  });

  it('a search asks for business addresses only, a page at a time, with only the filters she set', async () => {
    const w = wire(() => ({ status: 200, body: { people: [{ id: 'p1', name: 'A', title: 'Buyer' }], pagination: { page: 2, total_pages: 5 } } }));
    const src = apolloSource({ apiKey: KEY, fetchImpl: w.fetchImpl });
    const r = await src.searchPeople({ titles: ['Buyer'], countries: [], keywords: 'homeware', employeesMin: 11, employeesMax: 50, page: 2 });
    expect(r).toMatchObject({ kind: 'results', page: 2, totalPages: 5 });
    expect(JSON.parse(w.calls[0]!.body!)).toEqual({
      page: 2, per_page: 25, person_titles: ['Buyer'], q_keywords: 'homeware',
      organization_num_employees_ranges: ['11,50'],
    });
    await src.revealEmail('p1');
    expect(JSON.parse(w.calls[1]!.body!)).toEqual({ id: 'p1', reveal_personal_emails: false });
  });

  it('a body that is not what Apollo sends is unreadable, never a guess', async () => {
    const w = wire(() => ({ status: 200, body: '<html>maintenance</html>' }));
    expect(await apolloSource({ apiKey: KEY, fetchImpl: w.fetchImpl }).enrichDomain('x.com'))
      .toMatchObject({ kind: 'failed', reason: 'unreadable' });
  });
});

describe('C5 · a personal mailbox has no company to buy a lookup for', () => {
  it('gmail, qq, 163, hotmail and their regional variants: nothing to look up', () => {
    for (const a of ['a@gmail.com', 'b@QQ.com', 'c@163.com', 'd@hotmail.fr', 'e@yahoo.com.sg', 'f@icloud.com']) {
      expect(companyDomainOf(a), a).toBeNull();
    }
  });
  it('a company address gives its domain, lower-cased', () => {
    expect(companyDomainOf('Ahmed@GulfTrading.ae')).toBe('gulftrading.ae');
    expect(domainOfAddress('not an address')).toBeNull();
  });
});

describe('C5 · the search in the address bar', () => {
  it('round-trips, so the next page and the way back after adding someone keep her search', () => {
    const f = filterFromQuery({ search: '1', titles: 'Buyer, Purchasing Manager', countries: 'UAE', keywords: 'homeware', size: '11-50', page: '3' })!;
    expect(f).toMatchObject({ titles: ['Buyer', 'Purchasing Manager'], countries: ['UAE'], employeesMin: 11, employeesMax: 50, page: 3 });
    const again = filterFromQuery(Object.fromEntries(new URLSearchParams(queryOf(f).slice(1))))!;
    expect(again).toEqual(f);
    expect(filterFromQuery({})).toBeNull();
    expect(filterFromQuery({ search: '1', size: '1001-' })).toMatchObject({ employeesMin: 1001, employeesMax: null });
  });
});

describe('C5 · the pages', () => {
  const stored = { kind: 'stored' as const, fingerprint: 'ab12cd34ef56', createdBy: 'Lily', createdAt: new Date(), readable: true };

  it('the key is never rendered back — only its fingerprint — and only the owner sees the form', () => {
    const owner = renderProspects({ status: stored, filter: null, outcome: null }, 'en', null);
    expect(owner).toContain('ab12cd34ef56');
    expect(owner).toContain('action="/app/prospects/key"');
    expect(owner).toMatch(/name="apiKey" type="password"/);
    expect(owner).not.toMatch(/name="apiKey"[^>]*value=/);
    const staff = renderProspects({ status: stored, filter: null, outcome: null }, 'en', null, { isOwner: false });
    expect(staff).not.toContain('/app/prospects/key');
    expect(staff).toContain('action="/app/prospects"');
  });

  it('with no key there is nothing to search with, and the page says why', () => {
    const html = renderProspects({ status: { kind: 'none' }, filter: null, outcome: null }, 'en', null);
    expect(html).not.toContain('name="search"');
    expect(html).toContain(esc(t('en', 'prospects.key.none')));
  });

  it('a result is a person with one button, which keeps her search to come back to', () => {
    const f = filterFromQuery({ search: '1', titles: 'Buyer' })!;
    const html = renderProspects({
      status: stored, filter: f,
      outcome: { kind: 'results', page: 1, totalPages: 2, prospects: [{ sourceId: 'p9', name: 'Omar', title: 'Buyer', organization: 'Souk Co', organizationDomain: null, country: 'Oman', city: null }] },
    }, 'ar', null);
    expect(html).toContain('action="/app/prospects/add"');
    expect(html).toContain('name="sourceId" value="p9"');
    expect(html).toContain(`name="back" value="${esc(queryOf(f))}"`);
    expect(html).toContain(esc(queryOf(f, 2)));
  });

  it('what a lookup found reads as one line, each vendor fact isolated from her language; "not found" says so', () => {
    for (const l of LOCALES) {
      const line = companyLineHtml(l, {
        domain: 'gulftrading.ae', source: 'apollo', found: true, lookedUpBy: 'Lily', lookedUpAt: new Date(),
        organization: { name: 'Gulf Trading', domain: 'gulftrading.ae', industry: 'wholesale', employees: 60, country: 'UAE', city: 'Dubai', website: null, linkedinUrl: null, foundedYear: null },
      })!;
      expect(line, l).toContain('<bdi>Gulf Trading</bdi>');
      expect(line, l).toContain('<bdi>Dubai, UAE</bdi>');
      expect(line, l).toContain('60');
    }
    expect(companyLineHtml('ar', { domain: 'x.ae', source: 'apollo', found: false, organization: null, lookedUpBy: 'L', lookedUpAt: new Date() }))
      .toContain('<bdi>x.ae</bdi>');
  });
});

/**
 * THE HARD RULE, at source level: enrichment is for people. The employee may
 * never say "I see you import homeware" to someone who never told her.
 *
 * Walked as an IMPORT GRAPH, not a word search: a module that reaches the
 * prospects store through three layers of re-export is exactly as able to put a
 * company profile in a prompt as one that imports it directly.
 */
describe('C5 · what a purchased profile says never reaches the employee', () => {
  const FORBIDDEN = ['src/db/prospects.ts', 'src/prospects/', 'src/connectors/'];
  const CONVERSATION_PATH = ['src/pipeline', 'src/llm', 'src/core/conversation', 'src/trust', 'src/worker', 'src/retrieval'];

  async function tsFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const e of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...await tsFiles(rel));
      else if (e.name.endsWith('.ts')) out.push(rel);
    }
    return out;
  }

  async function importsOf(file: string): Promise<string[]> {
    const src = await readFile(path.join(ROOT, file), 'utf8');
    return [...src.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)]
      .map((m) => path.normalize(path.join(path.dirname(file), m[1]!)).replace(/\.js$/, '.ts'));
  }

  it('no module on the conversation path can reach the prospects store, the service or a connector — transitively', async () => {
    const roots = (await Promise.all(CONVERSATION_PATH.map(tsFiles))).flat();
    const reaches: string[] = [];
    for (const root of roots) {
      const seen = new Set<string>([root]);
      const queue = [root];
      while (queue.length) {
        const f = queue.shift()!;
        let next: string[];
        try { next = await importsOf(f); } catch { continue; }
        for (const n of next) {
          if (FORBIDDEN.some((x) => n === x || n.startsWith(x))) reaches.push(`${root} → … → ${n}`);
          if (!seen.has(n)) { seen.add(n); queue.push(n); }
        }
      }
    }
    expect([...new Set(reaches)], 'the employee could read a purchased profile').toEqual([]);
  });

  it('and the table is QUERIED in exactly one module, the store', async () => {
    const all = await tsFiles('src');
    const querying: string[] = [];
    for (const f of all) {
      const src = await readFile(path.join(ROOT, f), 'utf8');
      if (/\b(from|into|update|join)\s+organization_enrichments\b/i.test(src)) querying.push(f);
    }
    expect(querying).toEqual(['src/db/prospects.ts']);
  });

  it('no prompt mentions it either', async () => {
    for (const f of await readdir(path.join(ROOT, 'prompts'))) {
      const text = await readFile(path.join(ROOT, 'prompts', f), 'utf8');
      expect(text, f).not.toMatch(/enrich|apollo|organization_enrichments/i);
    }
  });
});
