import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { seedRunTenant, RUN_BIZ } from './tenant.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const suite = DATABASE_URL ? describe : describe.skip;

suite('Today navigation migration (requires DATABASE_URL)', () => {
  let app: ReturnType<typeof Fastify>;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: RUN_BIZ, accessCode: 'redesign-owner',
      sessionSecret: 'redesign-route-test-secret-long-enough',
      employeeName: 'Lily', avatar: '', secureCookie: false,
      provider: 'disabled', messagingEnabled: false,
      resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
      kickOutbound: async () => {}, kickDrive: async () => {},
    });
    const login = await app.inject({ method: 'POST', url: '/login',
      payload: 'code=redesign-owner', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    cookie = String(login.headers['set-cookie']).split(';')[0]!;
  });

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('renders the new Today without an environment preview flag', async () => {
    const page = await app.inject({ url: '/app', headers: { cookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('id="sp-sales"');
  });

  it('keeps a results bookmark and its selected period', async () => {
    const old = await app.inject({ url: '/app/analytics?range=month', headers: { cookie } });
    expect(old.statusCode).toBe(302);
    expect(old.headers.location).toBe('/app/results?range=month');
    const page = await app.inject({ url: old.headers.location!, headers: { cookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Sales results');
    expect(page.body).toContain('range=month');
  });

  it('combines guide and readiness without losing the owner confirmations', async () => {
    const page = await app.inject({ url: '/app/get-started', headers: { cookie } });
    expect(page.statusCode).toBe(200);
    expect((page.body.match(/<h1\b/g) ?? [])).toHaveLength(1);
    expect(page.body).toContain('id="readiness"');
    expect(page.body).toContain('action="/app/onboarding/assistant-name"');
    expect(page.body).toContain('action="/app/onboarding/attest"');
    expect(page.body).not.toContain('<video');
  });

  it('redirects the old setup pages and keeps unauthenticated access private', async () => {
    for (const url of ['/app/guide', '/app/onboarding']) {
      const old = await app.inject({ url, headers: { cookie } });
      expect(old.statusCode).toBe(302);
      expect(old.headers.location).toBe('/app/get-started');
      const anonymous = await app.inject({ url });
      expect(anonymous.headers.location).toBe('/login');
    }
  });

  it('gives every new primary destination a real authenticated page', async () => {
    for (const [url, title] of [['/app/customers', 'Customers'], ['/app/assistant', 'Assistant']]) {
      const page = await app.inject({ url: url!, headers: { cookie } });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain(title);
      const anonymous = await app.inject({ url: url! });
      expect(anonymous.headers.location).toBe('/login');
    }
  });

  it('keeps the Books-off refusal inside the signed-in shell', async () => {
    const page = await app.inject({ url: '/app/books', headers: { cookie, accept: 'text/html' } });
    expect(page.statusCode).toBe(404);
    expect(page.body).toContain('owner-shell');
    expect(page.body).not.toContain('data-nav="books"');
  });

  it('moves assistant and setup results to explicit views without dropping queries', async () => {
    for (const [oldPath, view] of [['/app/settings/assistant/month', 'assistant'], ['/app/onboarding/activity', 'setup']]) {
      const old = await app.inject({ url: `${oldPath}?range=month`, headers: { cookie } });
      expect(old.statusCode).toBe(302);
      const target = new URL(old.headers.location!, 'http://localhost');
      expect(target.pathname).toBe('/app/results');
      expect(target.searchParams.get('view')).toBe(view);
      expect(target.searchParams.get('range')).toBe('month');
      const page = await app.inject({ url: target.pathname + target.search, headers: { cookie } });
      expect(page.statusCode).toBe(200);
      expect((page.body.match(/<h1\b/g) ?? [])).toHaveLength(1);
    }
  });
});
