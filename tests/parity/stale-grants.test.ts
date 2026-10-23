import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { revokeAnswer } from '../../src/core/books/connector.js';
import { renderBooksHome } from '../../src/api/web/books.js';
import type { BooksConnection } from '../../src/db/booksConnections.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { withoutIsolates } from './isolates.js';

/**
 * 0212 — THE STALE GRANT (the owner, 2026-10-23). A QuickBooks or Xero grant Nomi no longer uses is given back at the
 * system; connecting again gives the old one back BEFORE the consent (a POST, never the GET a link could open), and the
 * callback never gives anything back — it could end the new grant too (Xero's revocation removes every connection the
 * person made; Intuit's disconnects the company). Not confirmed, it is kept track of, shown, and tried again.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const holding = { hasBooks: false, keepUntil: null, law: null, lastCopyAt: null, copyCoversAll: true };
const OWNER = { isOwner: true };
const conn = (o: Partial<BooksConnection>): BooksConnection => ({
  system: 'quickbooks', state: 'connected', reason: null, settings: { companyName: 'Westlake Canvas Co.' }, keyExpiresOn: null, cursor: null,
  connectedAt: '2026-10-20T08:00:00.000000Z', lastReadAt: null, lastOkAt: null, grant: { secret: 'sealed', expiresAt: null }, ...o,
});
const page = (qbo: NonNullable<NonNullable<Parameters<typeof renderBooksHome>[3]>['quickbooks']>, locale: (typeof LOCALES)[number] = 'en') =>
  withoutIsolates(renderBooksHome(locale, OWNER, holding, { sheets: { offered: false, connection: null }, quickbooks: qbo }));

describe('0212 · a revocation endpoint\'s answer, read as RFC 7009 has it', () => {
  it('200 is done; a token the system no longer honours is done too — nothing live is left', () => {
    expect(revokeAnswer({ status: 200, text: '' })).toBe('given_back');
    expect(revokeAnswer({ status: 400, text: '{"error":"invalid_token"}' })).toBe('given_back');
    expect(revokeAnswer({ status: 400, text: '{"error":"invalid_grant"}' })).toBe('given_back');
  });
  it('no answer, a server error, a throttle, a refused client, anything unknown: NOT given back — never assumed', () => {
    expect(revokeAnswer(null)).toBe('not_given_back');
    for (const status of [500, 502, 503, 429, 401, 403]) expect(revokeAnswer({ status, text: '' }), String(status)).toBe('not_given_back');
    expect(revokeAnswer({ status: 400, text: '{"error":"invalid_client"}' })).toBe('not_given_back');
    expect(revokeAnswer({ status: 400, text: 'Bad Request' })).toBe('not_given_back');
  });
});

describe('0212 · the books\' page', () => {
  it('a stale grant is said under its system in every state, with a button to try again now — in every language', () => {
    const at = new Date('2026-10-23T09:00:00Z');
    for (const c of [conn({}), conn({ state: 'disconnected', grant: null }), conn({ state: 'connect_again', reason: 'revoked' }), null]) {
      const p = page({ offered: true, connection: c, stale: [at] });
      expect(p, c?.state ?? 'never').toContain('An earlier QuickBooks connection may still be open there');
      expect(p).toContain('<form method="post" action="/app/books/quickbooks/stale"');
    }
    expect(page({ offered: true, connection: conn({}) })).not.toContain('Still open there');
    for (const l of LOCALES) expect(page({ offered: true, connection: conn({}), stale: [at] }, l), l).toContain('/app/books/quickbooks/stale');
  });

  it('"Connect again" with a grant still held is a POST that gives it back first; with none, the door to the consent', () => {
    const held = page({ offered: true, connection: conn({ state: 'connect_again', reason: 'source_missing' }) });
    expect(held).toContain('<form method="post" action="/app/books/quickbooks/again"');
    expect(held).not.toContain('href="/app/books/quickbooks/start"');
    const none = page({ offered: true, connection: conn({ state: 'connect_again', reason: 'revoked', grant: null }) });
    expect(none).toContain('href="/app/books/quickbooks/start"');
    expect(none).not.toContain('/app/books/quickbooks/again');
  });
});

describe('0212 · where a grant is given back, and where never', () => {
  const app = readFileSync(`${ROOT}src/api/web/app.ts`, 'utf8');
  const route = (method: string, url: string) => {
    const at = app.indexOf(`app.${method}('${url}'`);
    expect(at, url).toBeGreaterThan(0);
    return app.slice(at, app.indexOf('\n  app.', at + 1));
  };
  it('the GET that starts the consent and the callback give nothing back (a link must not end a connection; after the consent it could end the new one)', () => {
    for (const s of ['xero', 'quickbooks']) {
      for (const url of [`/app/books/${s}/start`, `/app/books/${s}/callback`]) {
        expect(route('get', url), url).not.toMatch(/\.revoke\(|giveBackFirst|retryStaleGrants/);
      }
    }
  });
  it('connecting again and the stale button are the owner\'s routes, listed for the books\' roles', () => {
    const books = readFileSync(`${ROOT}src/api/web/books.ts`, 'utf8');
    for (const s of ['xero', 'quickbooks']) for (const r of ['again', 'stale']) {
      expect(books).toContain(`{ method: 'POST', url: '/app/books/${s}/${r}', action: 'post' }`);
    }
  });
  it('the migration keeps track and deletes nothing; the worker\'s round reads ids only', () => {
    const m = readFileSync(`${ROOT}migrations/0212_stale_grants.sql`, 'utf8').split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    expect(m).toContain('add column if not exists stale_since');
    expect(m).toContain('returns table (business_id uuid)');
    expect(m).toMatch(/security definer set search_path = public, pg_temp/);
    expect(m).not.toMatch(/\bdelete\b|\bdrop\b|grant delete/i);
    expect(readFileSync(`${ROOT}src/main.ts`, 'utf8')).toContain('from stale_grant_workspaces()');
  });
});
