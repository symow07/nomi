import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { purgeBusinesses } from './books-db.js';

/**
 * UI correction, Block 5 (check 6, inherited) — ON AN ARABIC BOOKS PAGE EVERY OPTION'S WORDS ARE ISOLATED. The verify
 * found the account, tax and currency choices of every Books select drawn bare on right-to-left pages ("1000 · …" read
 * in the wrong order). On a Moroccan workspace with its pack loaded: each Books page and Books setting, in Arabic, has
 * every option's words between the isolate marks and every option a value of its own (so the marks are never sent); in
 * English nothing changes.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `c6060000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const PAGES = ['/app/books/spending', '/app/books/invoices/new', '/app/books/advanced/entries/new', '/app/books/bank', '/app/books/reports/cash',
  '/app/settings/books/tax', '/app/settings/books/starting-balances', '/app/settings/books/accounts'];

d('Block 5 check 6 · option words isolated on Arabic Books pages (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let app: import('fastify').FastifyInstance;
  let owner = '';
  const cookieOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const options = (html: string) => [...html.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map((m) => ({ attrs: m[1]!, text: m[2]! }));

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area, timezone) values ($1, $2, 'service', 'MA', 'MAD', true, 'Africa/Casablanca')`, [BIZ, `Options ${RUN}`]);
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { dayKey } = await import('../../src/core/owner/i18n/format.js');
    db = createDb(DATABASE_URL!);
    app = Fastify({ logger: { level: 'error' } });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: `opts-${RUN}`, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    owner = cookieOf(await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(`opts-${RUN}`)}`, headers: FORM }));
    const today = dayKey(new Date(), 'Africa/Casablanca');
    expect((await app.inject({ method: 'POST', url: '/app/books/country', payload: new URLSearchParams({ country: 'MA', period: 'month', year_start: `${today.slice(0, 4)}-01-01` }).toString(), headers: { cookie: owner, ...FORM } })).statusCode).toBe(302);
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await purgeBusinesses(admin, [BIZ], 'books-options-isolated-test'); await admin?.end(); });

  it('in Arabic every option on every Books page has its words isolated and a value of its own; in English nothing is marked', async () => {
    let seen = 0;
    for (const url of PAGES) {
      const ar = await app.inject({ method: 'GET', url, headers: { cookie: owner, 'accept-language': 'ar' } });
      expect(ar.statusCode, url).toBe(200);
      for (const o of options(ar.body)) {
        expect(/\svalue="/.test(o.attrs), `${url}: an option without a value`).toBe(true);
        if (o.text.trim() === '') continue;
        seen++;
        expect(o.text.startsWith('\u2068') && o.text.endsWith('\u2069'), `${url}: "${o.text}" not isolated`).toBe(true);
        expect(o.attrs, `${url}: a mark in a value`).not.toMatch(/[\u2068\u2069]/);
      }
      const en = await app.inject({ method: 'GET', url, headers: { cookie: owner, 'accept-language': 'en' } });
      expect(en.statusCode, url).toBe(200);
      for (const o of options(en.body)) expect(o.text, `${url} in English`).not.toMatch(/[\u2068\u2069]/);
    }
    expect(seen, 'the pages drew their choices').toBeGreaterThan(100);
    // the one select whose options had no value: the currency, now sent as written
    const inv = (await app.inject({ method: 'GET', url: '/app/books/invoices/new', headers: { cookie: owner, 'accept-language': 'ar' } })).body;
    expect(inv).toContain('<option selected value="MAD">\u2068MAD\u2069</option>');
  });
});
