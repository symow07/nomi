import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

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
    expect((await get(pilotCookie, '/app/onboarding')).body).toContain('href="/app/onboarding/technical"');
  });

  it('GETTING READY shows a self-serve workspace only what applies: Ready for customers, not backups or secrets', async () => {
    const page = (await get(shopCookie, '/app/onboarding')).body;
    expect(page).toContain(t('en', 'pilot.item.ready'));
    expect(page).toContain('href="/app/ready"');
    for (const k of ['pilot.attest.backup_tested', 'pilot.attest.secrets_rotated', 'pilot.item.sandbox'] as const) {
      expect(page, k).not.toContain(t('en', k));
    }
    // The installation's own workspace keeps them.
    expect((await get(pilotCookie, '/app/onboarding')).body).toContain(t('en', 'pilot.attest.secrets_rotated'));
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
