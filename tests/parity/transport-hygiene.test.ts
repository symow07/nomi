import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerWebApp } from '../../src/api/web/app.js';

/**
 * R4 (Intuit's App Assessment, item 9) — transport hygiene on Nomi's own surfaces, as served (no database needed):
 * an answer without its own cache-control is `no-store`, never merely no-cache or private; HSTS where the deployment
 * is HTTPS (secure cookies) and not where it is not; TRACE answered by nothing; every OAuth callback answers with a
 * redirect, never a page (a code in a query string must not reach another site in a Referer).
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const appWith = async (secureCookie: boolean) => {
  const app = Fastify({ logger: false });
  registerWebApp(app, {
    db: {} as never, sessionSecret: 'x'.repeat(64), accessCode: 'let-me-in', businessId: 'de300000-0000-4000-8000-0000000000b1',
    employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie,
    kickOutbound: async () => {}, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
  } as unknown as Parameters<typeof registerWebApp>[1]);
  await app.ready();
  return app;
};

describe('R4 · transport hygiene, as served', () => {
  it('a page without its own cache-control is no-store; a route that set its own keeps it', async () => {
    const app = await appWith(true);
    for (const url of ['/cookies', '/login', '/privacy']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBeLessThan(400);
      expect(r.headers['cache-control'], url).toBe('no-store');
    }
    expect((await app.inject({ method: 'GET', url: '/app/books' })).headers['cache-control']).toBe('no-store');   // the redirect to sign in, too
    expect((await app.inject({ method: 'GET', url: '/sw.js' })).headers['cache-control']).toBe('no-cache');        // the worker's own, not sensitive
    await app.close();
  });

  it('HSTS where the deployment is HTTPS, and only there; subdomains are not claimed', async () => {
    const secure = await appWith(true);
    expect((await secure.inject({ method: 'GET', url: '/login' })).headers['strict-transport-security']).toBe('max-age=31536000');
    await secure.close();
    const local = await appWith(false);
    expect((await local.inject({ method: 'GET', url: '/login' })).headers['strict-transport-security']).toBeUndefined();
    await local.close();
  });

  it('TRACE is answered by nothing: no route, no echo of what was sent', async () => {
    const app = await appWith(true);
    for (const url of ['/', '/login', '/app/books']) {
      const r = await app.inject({ method: 'TRACE' as never, url, headers: { cookie: 'yf_session=secret-value' } }) as unknown as { statusCode: number; body: string };
      expect(r.statusCode, url).toBeGreaterThanOrEqual(400);
      expect(r.body, url).not.toContain('secret-value');
    }
    await app.close();
  });

  it('every OAuth callback answers with a redirect; the two that draw a picker send no Referer', () => {
    const src = readFileSync(`${ROOT}src/api/web/app.ts`, 'utf8');
    const callbacks = [...src.matchAll(/app\.get\('(\/app\/[^']*callback)'[\s\S]*?\n {2}\}\);/g)];
    expect(callbacks.map((m) => m[1]).sort()).toEqual(expect.arrayContaining(['/app/books/quickbooks/callback', '/app/books/sheets/callback', '/app/books/xero/callback']));
    for (const [body, url] of callbacks.map((m) => [m[0], m[1]] as const)) {
      const pages = [...body.matchAll(/type\('text\/html[^\n]*/g)].map((x) => x[0]);
      for (const line of pages) expect(line, url).toContain(".header('referrer-policy', 'no-referrer')");
      // the two that draw a picker (Meta's Pages, WhatsApp's numbers) after the code is spent; every other redirects
      if (!['/app/connect/meta/callback', '/app/connect/whatsapp/callback'].includes(url)) expect(pages, url).toEqual([]);
    }
  });
});
