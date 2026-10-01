import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import Fastify from 'fastify';
import { PASSING_BOT_CHECK } from './signUpWithCode.js';

/**
 * SITE (opening step 4) — the site's button is sign-up only while sign-up is
 * open in force, asked on every request as the door asks it: the operator's
 * switch in the database, a sender for the code, a bot check. Until then, and
 * the moment it closes, the site invites a visitor to write.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const PILOT = `5e700000-0000-4000-8000-${RUN}0001`;

d('SITE · the button follows sign-up (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let admin: pg.Client;
  let db: import('../../src/db/client.js').Db;
  let withCheck: import('fastify').FastifyInstance;
  let withoutCheck: import('fastify').FastifyInstance;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  const setSwitch = (mode: string | null) => admin.query(`update signup_settings set mode = $1, set_by = 'site test' where id`, [mode]);
  const site = async (app: import('fastify').FastifyInstance) => (await app.inject({ method: 'GET', url: '/site' })).body;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name) values ($1, $2)`, [PILOT, `SITE installation ${RUN}`]);
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    db = createDb(DATABASE_URL!);
    const base = {
      db, businessId: PILOT, accessCode: `site-${RUN}`, sessionSecret: 'a-test-session-secret-of-sufficient-length',
      signupMode: 'invite', legalContact: 'hello@nomi.example', publicBaseUrl: 'https://app.nomi.test',
      systemMail: { from: 'no-reply@nomi.test', send: async () => ({ ok: true as const }) },
      secureCookie: false, messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
    };
    withCheck = Fastify({ logger: false });
    registerWebApp(withCheck, { ...base, botCheck: PASSING_BOT_CHECK } as unknown as Parameters<typeof registerWebApp>[1]);
    await withCheck.ready();
    withoutCheck = Fastify({ logger: false });
    registerWebApp(withoutCheck, base as unknown as Parameters<typeof registerWebApp>[1]);
    await withoutCheck.ready();
  }, 60_000);
  afterAll(async () => {
    await setSwitch(null);
    await withCheck?.close(); await withoutCheck?.close(); await db?.destroy(); await admin?.end();
  });

  it('BY INVITATION (the deployment\'s mode): the invitation, no sign-up', async () => {
    await setSwitch(null);
    const html = await site(withCheck);
    expect(html).toContain(t('en', 'site.cta.invite'));
    expect(html).not.toContain('/signup');
  });

  it('THE SWITCH OPENS IT: "Start your workspace", to sign-up — on the next request', async () => {
    await setSwitch('open');
    const html = await site(withCheck);
    expect(html).toContain(`<a class="site-go" href="/signup">${t('en', 'site.cta.signup')}</a>`);
    expect(html).not.toContain(t('en', 'site.cta.invite'));
  });

  it('OPEN WITHOUT A BOT CHECK reads as invite, and so does the site', async () => {
    const html = await site(withoutCheck);
    expect(html).toContain(t('en', 'site.cta.invite'));
    expect(html).not.toContain('/signup');
  });

  it('CLOSED AGAIN: the invitation, at once', async () => {
    await setSwitch('closed');
    expect(await site(withCheck)).not.toContain('/signup');
  });
});
