import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { spawnSync } from 'node:child_process';

/**
 * G6 — over Postgres and real requests: a workspace that signed itself up
 * signs in, reads "Ready for customers" and a Getting ready without the
 * installation's facts, and is told the machine room does not exist; the
 * installation's own workspace still reaches it.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `dd960000-0000-4000-8000-${RUN}0001`;
const CODE = `g6-${RUN}`;
const EMAIL = `g6-${RUN}@shop.example`;
const PASSWORD = `g6-password-${RUN}`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('G6 · Ready for customers (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let selfServe = '';
  let pilotCookie = '';
  let shopCookie = '';
  const cookieOf = (r: { headers: Record<string, unknown> }) => ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? [])
    .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=') && c !== 'yf_session=') ?? '';
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const { hashPassword } = await import('../../src/security/password.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    db = createDb(DATABASE_URL!);
    await admin.query(`insert into businesses (id, name) values ($1, $2)`, [PILOT, `G6 installation ${RUN}`]);
    const made = await provisionAccount(db, {
      factory: `G6 Shop ${RUN}`, language: 'en', ownerName: 'Noor', email: EMAIL, passwordHash: await hashPassword(PASSWORD),
      invite: null, inviteRequired: false, termsVersion: 'abcdef012345',
      profile: { kind: 'retail', sells: 'soap', country: 'AE', website: null, teamSize: '1', channels: [], zone: 'Asia/Dubai', currency: 'AED' },
    });
    if (made.code !== 'created') throw new Error(`provision: ${made.code}`);
    selfServe = made.businessId;
    // Two items already seen in this workspace's Practice.
    await admin.query(`insert into practice_checks (business_id, item) values ($1, 'bot_answered'), ($1, 'person_handoff')`, [selfServe]);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: PILOT, accessCode: CODE, sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    pilotCookie = cookieOf(await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM }));
    shopCookie = cookieOf(await app.inject({ method: 'POST', url: '/login',
      payload: new URLSearchParams({ email: EMAIL, password: PASSWORD }).toString(), headers: FORM }));
    expect(pilotCookie).not.toBe('');
    expect(shopCookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); await admin?.end(); });

  it('THE MACHINE ROOM is the installation\'s: 404 for a workspace that signed itself up, and no door to it', async () => {
    expect((await get(shopCookie, '/app/onboarding/technical')).statusCode).toBe(404);
    expect((await get(pilotCookie, '/app/onboarding/technical')).statusCode).toBe(200);
    const ready = await get(shopCookie, '/app/onboarding');
    expect(ready.body).not.toContain('href="/app/onboarding/technical"');
    // Phase 9 — the installation's own workspace keeps the page, but no owner's page links to it.
    expect((await get(pilotCookie, '/app/onboarding')).body).not.toContain('href="/app/onboarding/technical"');
  });

  it('PHASE 9 · V1-007 · a mistyped /app address keeps a signed-in owner in the workspace; signed out it is the door page', async () => {
    const html = { accept: 'text/html' };
    const inside = await app.inject({ method: 'GET', url: '/app/no-such-page', headers: { ...html, cookie: shopCookie } });
    expect(inside.statusCode).toBe(404);
    expect(inside.body).toContain('<nav class="side"');
    expect(inside.body).toContain(t('en', 'error.notfound.title'));
    expect(inside.body).toContain('href="/app"');
    const outside = await app.inject({ method: 'GET', url: '/app/no-such-page', headers: html });
    expect(outside.statusCode).toBe(404);
    expect(outside.body).not.toContain('<nav class="side"');
  });

  it('PHASE 9 · V1-007 · an empty product paste says so instead of reloading in silence', async () => {
    const { flashSaid } = await import('./tenant.js');
    const r = await app.inject({ method: 'POST', url: '/app/products/add/review', payload: 'text=%20%20', headers: { ...FORM, cookie: pilotCookie } });
    expect(r.statusCode).toBe(302);
    expect(flashSaid(r, 'a-test-session-secret-of-sufficient-length')).toBe(t('en', 'product.add.empty'));
    expect((await get(pilotCookie, '/app/products/add')).body).toMatch(/<textarea name="text" rows="8" required/);
  });

  it('PHASE 9 · the component gallery is the installation\'s too: 404 for any other owner, and no door to it', async () => {
    expect((await get(shopCookie, '/app/settings/components')).statusCode).toBe(404);
    expect((await get(pilotCookie, '/app/settings/components')).statusCode).toBe(200);
    for (const cookie of [shopCookie, pilotCookie]) {
      expect((await get(cookie, '/app/settings')).body).not.toContain('href="/app/settings/components"');
    }
  });

  it('GETTING READY shows a self-serve workspace only what applies: Ready for customers, not backups or secrets', async () => {
    const page = (await get(shopCookie, '/app/onboarding')).body;
    expect(page).toContain(t('en', 'pilot.item.ready'));
    expect(page).toContain('href="/app/ready"');
    for (const k of ['pilot.nomiChecks', 'pilot.item.sandbox'] as const) {
      expect(page, k).not.toContain(t('en', k));
    }
    // The installation's own workspace keeps the condition — as Nomi's row, not the owner's chore.
    expect((await get(pilotCookie, '/app/onboarding')).body).toContain(t('en', 'pilot.nomiChecks'));
  });

  it('PHASE 9 · backups and keys are the operator\'s: the owner\'s tick is refused, the tool stamps them', async () => {
    const keys = async () => (await admin.query(
      `select secrets_rotated_at as k, backup_tested_at as b from onboarding_state where business_id = $1`, [PILOT])).rows[0] ?? { k: null, b: null };
    const before = await keys();
    for (const which of ['secrets_rotated', 'backup_tested']) {
      const r = await app.inject({ method: 'POST', url: '/app/onboarding/attest', payload: `which=${which}`,
        headers: { ...FORM, cookie: pilotCookie } });
      expect(r.statusCode, which).toBe(302);
    }
    expect(await keys()).toEqual(before);                         // nothing the owner pressed stamped them
    let page = (await get(pilotCookie, '/app/onboarding')).body;
    expect(page).not.toMatch(/value="(backup_tested|secrets_rotated)"/);
    expect(page).toContain(t('en', 'pilot.nomiChecks.todo'));

    const run = spawnSync(process.execPath, ['tools/installation-checks.mjs', '--business', PILOT, '--backup-tested', '--secrets-rotated'], {
      env: { ...process.env, MIGRATE_DATABASE_URL: MIGRATE_URL }, encoding: 'utf8', timeout: 60_000,
    });
    expect(run.status, run.stderr).toBe(0);
    const after = await keys();
    expect(after.k).not.toBeNull();
    expect(after.b).not.toBeNull();
    page = (await get(pilotCookie, '/app/onboarding')).body;
    expect(page).not.toContain(t('en', 'pilot.nomiChecks.todo'));
    expect(page).toContain(t('en', 'pilot.verifiedBySystem'));
  });

  it('READY FOR CUSTOMERS: what was seen, counted, and that sending alone waits to be earned', async () => {
    const res = await get(shopCookie, '/app/ready');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(t('en', 'ready.title'));
    expect(res.body).toMatch(/2\/\d/);
    expect(res.body).toContain(t('en', 'ready.alone.not'));
    expect(res.body).toContain(t('en', 'ready.channel.todo'));
  });
});
