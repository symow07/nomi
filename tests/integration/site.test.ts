import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { seedRunTenant, RUN_BIZ } from './tenant.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * Phase 5 — nomidoes.com is served by this app, chosen by the Host header.
 *
 * Built the way production mounts it (`registerWebApp` with `siteHosts`,
 * `publicBaseUrl` and the legal contact), then asked as a browser would ask
 * each host. What must hold: the site host shows the site and hands every
 * app address to the app host; every other host is exactly as it was; the
 * preview at `/site` works anywhere and is never indexed.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const BASE = 'https://app.example.test';
const SITE = 'www.example.test';
const CONTACT = 'hello@example.test';

async function build(extra: Record<string, unknown>): Promise<FastifyInstance> {
  const { registerWebApp } = await import('../../src/api/web/app.js');
  const { createDb } = await import('../../src/db/client.js');
  const app = Fastify({ logger: false });
  registerWebApp(app, {
    db: createDb(DATABASE_URL!),
    businessId: RUN_BIZ,
    accessCode: 'not-the-code-under-test',
    sessionSecret: 'a-test-session-secret-of-sufficient-length',
    provider: 'disabled', secureCookie: false, messagingEnabled: false,
    kickOutbound: async () => {}, kickDrive: async () => {},
    resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    legalContact: CONTACT,
    ...extra,
  } as unknown as Parameters<typeof registerWebApp>[1]);
  await app.ready();
  return app;
}

d('Phase 5 · the site host', () => {
  let app: FastifyInstance;
  let bare: FastifyInstance;

  beforeAll(async () => {
    await seedRunTenant();
    app = await build({ publicBaseUrl: BASE, siteHosts: ['example.test', SITE, 'app.example.test'] });
    bare = await build({ publicBaseUrl: null, siteHosts: [SITE] });
  }, 60_000);

  afterAll(async () => { await app?.close(); await bare?.close(); });

  const get = (a: FastifyInstance, url: string, host: string, headers: Record<string, string> = {}) =>
    a.inject({ method: 'GET', url, headers: { host, accept: 'text/html', ...headers } });

  it('serves the site on / — indexable, marked, with the contact and a sign-in on the app host', async () => {
    for (const host of [SITE, 'example.test', 'WWW.Example.Test:443']) {
      const res = await get(app, '/', host);
      expect(res.statusCode, host).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('data-surface="site"');
      expect(res.body).not.toContain('noindex');
      expect(res.body).toContain(`mailto:${CONTACT}`);
      expect(res.body).toContain(`href="${BASE}/login"`);
      expect(res.body).toContain(esc(t('en', 'site.hero.title')));
    }
  });

  it('sends every app address to the same path on PUBLIC_BASE_URL, 301', async () => {
    for (const url of ['/app', '/app/inbox?filter=all', '/login', '/signup?invite=x', '/verify']) {
      const res = await get(app, url, SITE);
      expect(res.statusCode, url).toBe(301);
      expect(res.headers['location'], url).toBe(`${BASE}${url}`);
    }
  });

  it('a form posted to the site host keeps its method (308), and no cookie is set there', async () => {
    const res = await app.inject({ method: 'POST', url: '/login', headers: { host: SITE },
      payload: 'code=x', });
    expect(res.statusCode).toBe(308);
    expect(res.headers['location']).toBe(`${BASE}/login`);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('an address that only looks like the app is not redirected', async () => {
    const res = await get(app, '/apple', SITE);
    expect(res.statusCode).toBe(404);
  });

  it('keeps the legal pages and the language switch on the site host', async () => {
    for (const url of ['/privacy', '/terms', '/data-deletion']) {
      const res = await get(app, url, SITE);
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain(CONTACT);
    }
    const sw = await get(app, '/locale?set=zh&next=/', SITE);
    expect(sw.statusCode).toBe(302);
    expect(sw.headers['location']).toBe('/');
    expect(String(sw.headers['set-cookie'])).toContain('zh');
  });

  it('every other host is unchanged: / is the door, /app is the app', async () => {
    const root = await get(app, '/', 'app.example.test');
    expect(root.statusCode).toBe(302);
    expect(root.headers['location']).toBe('/login');
    const login = await get(app, '/login', 'app.example.test');
    expect(login.statusCode).toBe(200);
    expect(login.body).not.toContain('data-surface="site"');
    const other = await get(app, '/app', 'localhost:8787');
    expect(other.statusCode).toBe(302);
    expect(other.headers['location']).toBe('/login');
  });

  it('the app host is never the site, even when SITE_HOSTS names it', async () => {
    // app.example.test is in siteHosts above; it is PUBLIC_BASE_URL's host, so
    // treating it as the site would redirect /app to itself forever.
    const res = await get(app, '/app', 'app.example.test');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });

  it('/site previews the page on the app host, noindex, sign-in on the same host', async () => {
    const res = await get(app, '/site', 'app.example.test');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('data-surface="site"');
    expect(res.body).toMatch(/<meta name="robots" content="noindex/);
    expect(res.body).toContain('href="/login"');
    expect(res.body).toContain('href="/locale?set=zh&next=/site"');
  });

  it('speaks the visitor’s language: en, zh, ar — and right to left in Arabic', async () => {
    for (const [lang, dir] of [['en', 'ltr'], ['zh', 'ltr'], ['ar', 'rtl']] as const) {
      const res = await get(app, '/', SITE, { cookie: `yf_locale=${lang}` });
      expect(res.body, lang).toContain(`<html lang="${lang}" dir="${dir}">`);
      expect(res.body, lang).toContain(esc(t(lang, 'site.hero.title')));
      const viaHeader = await get(app, '/site', SITE, { 'accept-language': `${lang};q=1` });
      expect(viaHeader.body, lang).toContain(`<html lang="${lang}"`);
    }
  });

  it('with no PUBLIC_BASE_URL there is nowhere to send them: served in place, as before', async () => {
    const res = await get(bare, '/login', SITE);
    expect(res.statusCode).toBe(200);
    const app2 = await get(bare, '/app', SITE);
    expect(app2.statusCode).toBe(302);
    expect(app2.headers['location']).toBe('/login');
    const root = await get(bare, '/', SITE);
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('data-surface="site"');
    expect(root.body).toContain('href="/login"');
  });
});
