import https from 'node:https';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isPublicAddress, readStoreAddress } from '../core/onboard/storeAddress.js';

/**
 * K8 — THE ONE WAY NOMI READS A STRANGER'S ADDRESS.
 *
 * A public product list, over https, from the public internet only:
 *   · the address is checked as typed (`readStoreAddress`: https, a name, the
 *     standard port);
 *   · the CONNECTION is made only to a public address: the DNS lookup is our
 *     own, and it refuses a name that resolves to any private, loopback or
 *     link-local address — at connect time, so a name that changes its answer
 *     after an earlier check (DNS rebinding) cannot reach one;
 *   · at most 3 redirects, each checked the same way;
 *   · 10 seconds and 5 MB at most, then it stops.
 * Nothing is sent but the GET: no cookie, no credential, no referrer.
 */

export type FetchedPage = { readonly status: number; readonly contentType: string; readonly body: string };
export type StoreFetcher = { get(url: string): Promise<FetchedPage> };
export class StoreFetchError extends Error {
  constructor(readonly reason: 'not_public' | 'too_large' | 'timeout' | 'unreachable' | 'too_many_redirects') { super(reason); }
}

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** A lookup that answers only with public addresses; any private one refuses the name. */
export function publicLookup(hostname: string, options: object, cb: LookupCb): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, '');
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
      const e = new Error('not_public') as NodeJS.ErrnoException;
      e.code = 'NOT_PUBLIC';
      return cb(e, '');
    }
    const wantsAll = (options as { all?: boolean }).all === true;
    return wantsAll ? cb(null, list) : cb(null, list[0]!.address, list[0]!.family);
  });
}

function getOnce(url: URL): Promise<{ status: number; contentType: string; location: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET', lookup: publicLookup as never, timeout: TIMEOUT_MS,
      headers: { 'user-agent': 'NomiCatalogReader/1.0 (+https://nomidoes.com)', accept: 'application/json, text/csv;q=0.8, */*;q=0.1' },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const location = typeof res.headers.location === 'string' ? res.headers.location : null;
      if (status >= 300 && status < 400) { res.resume(); return resolve({ status, contentType: '', location, body: '' }); }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(new StoreFetchError('too_large')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status, contentType: String(res.headers['content-type'] ?? ''), location, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new StoreFetchError('timeout')));
    req.on('error', (e: NodeJS.ErrnoException) => reject(
      e instanceof StoreFetchError ? e : new StoreFetchError(e.code === 'NOT_PUBLIC' ? 'not_public' : 'unreachable')));
    req.end();
  });
}

/** The production fetcher. */
export const publicFetcher: StoreFetcher = {
  async get(raw: string): Promise<FetchedPage> {
    let url = new URL(raw);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const checked = readStoreAddress(url.origin);
      if (!checked.ok || url.protocol !== 'https:') throw new StoreFetchError('not_public');
      const r = await getOnce(url);
      if (r.status >= 300 && r.status < 400 && r.location) { url = new URL(r.location, url); continue; }
      return { status: r.status, contentType: r.contentType, body: r.body };
    }
    throw new StoreFetchError('too_many_redirects');
  },
};
