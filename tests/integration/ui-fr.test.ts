import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * Phase 9 (0121, V1-001) — the owner's pages in French, through the real routes
 * and the real schema, as UI-es proved Spanish: the switch is kept on the
 * business (so the owner's alerts are French too), a browser that asks for
 * French gets it, a sign-up made in French stays French, and a draft may be
 * translated into French. Before 0121 every one of these fell back to English.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `f5500000-0000-4000-8000-${RUN}0001`;
const CODE = `fr-${RUN}`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('UI-fr · the owner reads French (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
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
    await admin.query(`insert into businesses (id, name, kind, country) values ($1, $2, 'online_shop', 'FR')`, [BIZ, `Boutique ${RUN}`]);
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

  it('THE SWITCH IS KEPT: the pages turn French, and the business remembers it for the alerts', async () => {
    const r = await app.inject({ method: 'GET', url: '/locale?set=fr&next=/app', headers: { cookie } });
    expect(r.statusCode).toBe(302);
    const lang = String(r.headers['set-cookie'] ?? '').split(';')[0]!;
    expect(lang).toBe('yf_locale=fr');
    expect((await admin.query(`select owner_locale from businesses where id = $1`, [BIZ])).rows[0].owner_locale).toBe('fr');
    const page = await app.inject({ method: 'GET', url: '/app/settings', headers: { cookie: `${cookie}; ${lang}` } });
    expect(page.body).toContain('<html lang="fr" dir="ltr"');
    expect(page.body).toContain(esc(t('fr', 'nav.settings')));
    expect(page.body).not.toContain(esc(t('en', 'nav.settings')));
  });

  it('A BROWSER THAT ASKS FOR FRENCH gets it, before any switch', async () => {
    const page = await app.inject({ method: 'GET', url: '/login', headers: { 'accept-language': 'fr-CA,fr;q=0.9,en;q=0.5' } });
    expect(page.body).toContain('<html lang="fr"');
  });

  it('A SIGN-UP MADE IN FRENCH STAYS FRENCH; a draft may be translated into it', async () => {
    const made = (await admin.query(
      `select business_id::text as id from provision_workspace($1, 'fr', 'Camille', $2, 'scrypt$not-a-real-hash', null, false, '{"zone":"Europe/Paris","currency":"USD"}'::jsonb)`,
      [`Atelier ${RUN}`, `fr-${RUN}@example.test`])).rows[0].id as string;
    expect((await admin.query(`select owner_locale, default_language from businesses where id = $1`, [made])).rows[0])
      .toEqual({ owner_locale: 'fr', default_language: 'fr' });
    // A language the schema does not know is still refused.
    await expect(admin.query(`update businesses set owner_locale = 'xx' where id = $1`, [made])).rejects.toThrow();
    const conv = await admin.query(`select 1 from pg_constraint where conname = 'drafts_translation_locale_check' and pg_get_constraintdef(oid) like '%''fr''%'`);
    expect(conv.rowCount).toBe(1);
  });
});
