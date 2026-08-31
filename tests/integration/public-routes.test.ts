import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { seedRunTenant, RUN_BIZ } from './tenant.js';
import { PUBLIC_ROUTES } from '../../src/api/web/app.js';

/**
 * M35 — NOTHING IS PUBLIC EXCEPT WHAT WE SAY IS PUBLIC.
 *
 * verify-remote.sh used to assert that five NAMED owner surfaces redirect when
 * signed out. That proves the five we remembered are protected; it proves
 * nothing about a sixth. And the proof link makes it worse: adding an exception
 * for a genuinely public page to a check built on a list of known-protected
 * pages turns the exception into the hole.
 *
 * So the check is INVERTED. The route table is read off the Fastify instance —
 * never transcribed — the handful of deliberately public routes are subtracted,
 * and every remaining route must refuse an anonymous visitor. A route added
 * without thought fails this test instead of going untested, which is the
 * opposite of how it worked before.
 *
 * Anonymous requests are safe to inject: every guarded handler checks the
 * session and redirects BEFORE it touches the database or performs any action.
 * That ordering is the property under test.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

/**
 * The complete list of routes that may answer a stranger. Every entry is a
 * decision, and the test below fails if a route escapes this list — in either
 * direction.
 */
/**
 * DERIVED from the app's own declaration, never transcribed. This file used to
 * hold its own copy, and `tools/list-routes.mjs` — which `verify-remote.sh`
 * probes a deployed host with — held a second. M40.2 added two public routes,
 * updated this copy, and the deploy failed on the other one.
 */
const PUBLIC = PUBLIC_ROUTES;

const isPublic = (method: string, url: string): boolean =>
  PUBLIC.some((p) => p.method === method && p.url === url);

/** A value for every :param, so the probe reaches the handler's guard. */
const fill = (url: string): string =>
  url.replace(/:([A-Za-z]+)/g, (_m, name: string) =>
    /token/i.test(name) ? 'x'.repeat(43)
    : /id$/i.test(name) ? '00000000-0000-0000-0000-000000000000'
    : 'x');

d('M35 · every route that is not deliberately public refuses a stranger', () => {
  let app: import('fastify').FastifyInstance;
  const routes: { method: string; url: string }[] = [];

  beforeAll(async () => {
    await seedRunTenant();
    process.env['PILOT_BUSINESS_ID'] = RUN_BIZ;
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { createDb } = await import('../../src/db/client.js');

    app = Fastify({ logger: false });
    // The route table, read off the instance as it is built. This is the part
    // that must never become a hand-written list.
    app.addHook('onRoute', (r) => {
      const methods = Array.isArray(r.method) ? r.method : [r.method];
      for (const m of methods) if (m !== 'HEAD' && m !== 'OPTIONS') routes.push({ method: m, url: r.url });
    });

    registerWebApp(app, {
      db: createDb(DATABASE_URL!),
      businessId: RUN_BIZ,
      accessCode: 'not-the-code-under-test',
      sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
      // M40.2 — the webhook is mounted here ON PURPOSE. It is conditional in
      // production, and a route declared public in the list above but absent
      // from the app under test is dead documentation: the check below would
      // pass while nothing ever probed the real thing.
      emailWebhookSecret: 'an-email-webhook-shared-secret',
      resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  it('found a real route table to check', () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.some((r) => r.url === '/p/:token')).toBe(true);
  });

  it('every PUBLIC entry corresponds to a route that actually exists', () => {
    // Otherwise the list rots into permission for routes that are gone, and the
    // next person reads it as precedent.
    for (const p of PUBLIC) {
      expect(routes.some((r) => r.method === p.method && r.url === p.url),
        `${p.method} ${p.url} is declared public but is not registered`).toBe(true);
    }
  });

  it('EVERY other route redirects an anonymous visitor to /login', async () => {
    const leaks: string[] = [];
    for (const r of routes) {
      if (isPublic(r.method, r.url)) continue;
      const res = await app.inject({ method: r.method as 'GET', url: fill(r.url) });
      const redirected = res.statusCode === 301 || res.statusCode === 302;
      const location = String(res.headers['location'] ?? '');
      if (!redirected || !location.startsWith('/login')) {
        leaks.push(`${r.method} ${r.url} → ${res.statusCode} ${location}`);
      }
    }
    expect(leaks, `these answered a stranger:\n  ${leaks.join('\n  ')}`).toEqual([]);
  });

  it('the proof link is public but answers 404 for a token nobody issued', async () => {
    const res = await app.inject({ method: 'GET', url: `/p/${'z'.repeat(43)}` });
    expect(res.statusCode).toBe(404);
    // NEVER 403: that would confirm the quote exists and the guess was right.
    expect(res.statusCode).not.toBe(403);
    const body = res.body.toLowerCase();
    for (const oracle of ['revoked', 'expired', 'quote', 'unauthorised', 'forbidden']) {
      expect(body.includes(oracle), `the 404 body leaks "${oracle}"`).toBe(false);
    }
  });

  it('a too-short token is refused without a database lookup', async () => {
    const res = await app.inject({ method: 'GET', url: '/p/short' });
    expect(res.statusCode).toBe(404);
  });
});
