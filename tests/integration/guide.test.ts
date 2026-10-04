import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * THE GUIDED PATH, through the real routes: the page shows a new workspace's
 * five steps in order with the next one marked; Setup and Today lead to it;
 * its videos and captions are served as what they are, and nothing else is.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `9d1d0000-0000-4000-8000-${RUN}0001`;
const CODE = `guide-${RUN}`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const RECORDED = (() => { try { return readdirSync(new URL('../../assets/guide/', import.meta.url)); } catch { return []; } })();

d('Guide · the guided path (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let cookie = '';

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await admin.query(`insert into businesses (id, name, kind, country) values ($1, $2, 'online_shop', 'US')`, [BIZ, `Guide ${RUN}`]);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: 'a-test-session-secret-of-sufficient-length', employeeName: 'Lily', avatar: '👩‍💼',
      provider: 'disabled', factsTtlMs: 0, secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {}, enqueueInbound: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); await admin?.end(); });

  it('A NEW WORKSPACE sees the five steps, none done, the first one next, each with its door', async () => {
    const r = await app.inject({ method: 'GET', url: '/app/guide', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(esc(t('en', 'guide.title')));
    expect(r.body).toMatch(/class="guide-step next" id="profile"/);
    // (w4-today-setup-06) a step to do is a chore: the to-do ○ in the secondary ink, never the waiting signal
    expect(r.body.match(/<span class="pill"><span class="dot todo shape s-waiting" aria-hidden="true"><\/span> /g)?.length).toBeGreaterThanOrEqual(5);
    expect(r.body).not.toContain('class="pill warn"');
    for (const href of ['/app/settings/profile', '/app/products', '/app/onboarding#name', '/app/business/channels', '/app/inbox']) expect(r.body).toContain(`href="${href}"`);
  });

  it('SETUP and TODAY lead to it', async () => {
    expect((await app.inject({ method: 'GET', url: '/app/settings/setup', headers: { cookie } })).body).toContain('href="/app/guide"');
    expect((await app.inject({ method: 'GET', url: '/app', headers: { cookie } })).body).toContain('href="/app/guide#profile"');
  });

  it('ITS FILES are served as what they are; a name outside the folder\'s shape is not found', async () => {
    const webm = RECORDED.find((f) => f.endsWith('.webm'));
    if (webm) {
      const v = await app.inject({ method: 'GET', url: `/assets/guide/${webm}` });
      expect(v.statusCode).toBe(200);
      expect(v.headers['content-type']).toContain('video/webm');
      const c = await app.inject({ method: 'GET', url: `/assets/guide/${webm.replace(/\.webm$/, '.vtt')}` });
      expect(c.headers['content-type']).toContain('text/vtt');
      expect(c.body.startsWith('WEBVTT')).toBe(true);
    }
    for (const bad of ['..%2Fpackage.json', 'profile.en.mp4', 'profile.xx.webm']) {
      expect((await app.inject({ method: 'GET', url: `/assets/guide/${bad}` })).statusCode, bad).toBe(404);
    }
  });
});
