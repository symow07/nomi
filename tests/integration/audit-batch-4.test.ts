import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { PageFactsReader } from '../../src/llm/ports.js';
import type { StoreFetcher } from '../../src/net/publicFetch.js';

/**
 * AUDIT BATCH 4 — over Postgres and real requests:
 *   B16 every readiness count says the same, read from the practice copy (Ready was a redraw of Practice behind);
 *   B18 an accountant reaches their own sign-in and language, and books switched off are a page, not a 404 loop;
 *   B19 a page's reading is found again after leaving, and sending the page again asks no model;
 *   B21 a refused price limit comes back on its own section, with what was typed.
 * The renderers' side is tests/parity/audit-batch-4.test.ts.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `ab400000-0000-4000-8000-${RUN}0001`;
const PRODUCT = `ab400000-0000-4000-8000-${RUN}0002`;
const CODE = `b4-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const EMAIL = `b4-${RUN}@shop.example`;
const PASSWORD = `b4-password-${RUN}`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const PAGE = `<html><body><h1>Shipping</h1><p>We ship within 2 business days.</p>
  <p>Returns are accepted within 30 days of delivery.</p></body></html>`;

d('Audit batch 4 · user-facing defects (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let shop = '';
  let shopCookie = '';
  let ownerCookie = '';
  let accountantCookie = '';
  let accountantLanding = '';
  const fetched: string[] = [];
  const asked: string[] = [];
  const fetcher: StoreFetcher = {
    get: async (url) => { fetched.push(url); return { status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }; },
  };
  const reader: PageFactsReader = {
    read: async ({ text }) => {
      asked.push(text);
      return { facts: [{ fact: 'Orders ship within 2 business days.', quote: 'We ship within 2 business days.' }],
        promptVersion: 'test', modelId: 'test', usage: { inputTokens: 7, outputTokens: 3 } };
    },
  };
  const cookieOf = (r: { headers: Record<string, unknown> }) => ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? [])
    .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=') && c !== 'yf_session=') ?? '';
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const post = (cookie: string, url: string, body: Record<string, string>) =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(body).toString() });
  const occurrences = (html: string, s: string) => html.split(s).length - 1;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const { hashPassword } = await import('../../src/security/password.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    db = createDb(DATABASE_URL!);
    // The installation's own workspace: the books OFF (the default), and an accountant on its team.
    await admin.query(`insert into businesses (id, name) values ($1, $2)`, [PILOT, `B4 installation ${RUN}`]);
    // A shop that signed itself up, with one priced product — and one practice total agreed, which the checklist
    // counts as "quoted" only once the practice copy is read (nothing has written it on the workspace yet).
    const made = await provisionAccount(db, {
      factory: `B4 Shop ${RUN}`, language: 'en', ownerName: 'Noor', email: EMAIL, passwordHash: await hashPassword(PASSWORD),
      invite: null, inviteRequired: false, termsVersion: 'abcdef012345',
      profile: { kind: 'retail', sells: 'soap', country: 'AE', website: null, teamSize: '1', channels: [], zone: 'Asia/Dubai', currency: 'AED' },
    });
    if (made.code !== 'created') throw new Error(`provision: ${made.code}`);
    shop = made.businessId;
    await admin.query(`insert into products (id, business_id, sku, name, unit, moq, price_usd_per_unit) values ($1, $2, $3, 'Olive soap', 'item', null, 12)`,
      [PRODUCT, shop, `B4-${RUN}`]);
    await admin.query(`insert into practice_totals (business_id, message_id, expected, quoted, currency, agreed, decided_at)
      values ($1, 'b4-m1', 12, 12, 'AED', true, now())`, [shop]);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: PILOT, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      storeFetcher: fetcher, pageFactsReader: reader,
      kickOutbound: async () => {}, kickDrive: async () => {}, enqueueInbound: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    ownerCookie = cookieOf(await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM }));
    shopCookie = cookieOf(await app.inject({ method: 'POST', url: '/login',
      payload: new URLSearchParams({ email: EMAIL, password: PASSWORD }).toString(), headers: FORM }));
    const acct = await addPerson(db, PILOT, SECRET, `Accountant ${RUN}`, 'accountant');
    if (acct.code !== 'added') throw new Error('fixture');
    const a = await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(acct.accessCode)}`, headers: FORM });
    accountantCookie = cookieOf(a);
    accountantLanding = String(a.headers['location'] ?? '');
    for (const c of [ownerCookie, shopCookie, accountantCookie]) expect(c).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); await admin?.end(); });

  it('B16 · Ready, Getting ready (its row and its Practice row), Practice and Going live say the same count', async () => {
    // Ready FIRST, before any page has written down what the copy shows: it read the written list alone, and said 0.
    const ready = (await get(shopCookie, '/app/ready')).body;
    const total = Number(/<span class="count">\d+\/(\d+)<\/span>/.exec(ready)?.[1]);
    expect(total).toBeGreaterThan(1);
    expect(ready).toContain(`<span class="count">1/${total}</span>`);
    const said = t('en', 'pilot.ready.count', { done: 1, total });
    const onboarding = (await get(shopCookie, '/app/onboarding')).body;
    // "Ready for customers" and the Practice row: the same words, the same count ("2 of 4 done" before).
    expect(occurrences(onboarding, said), 'Getting ready').toBe(2);
    expect((await get(shopCookie, '/app/onboarding/practice')).body).toContain(said);
    expect((await get(shopCookie, '/app/sandbox')).body).toContain(t('en', 'practice.checklist.count', { done: 1, total }));
    // Going live: "Finish getting ready" says how far the checklist is.
    expect((await get(shopCookie, '/app/business/ready')).body).toContain(said);
  });

  it('B18 · books switched off: an accountant lands on a page that says so — no 404, no loop', async () => {
    expect(accountantLanding).toBe('/app/books');
    const home = await get(accountantCookie, '/app/books');
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain(t('en', 'books.off.title'));
    // Every other page still leads there, and there now answers.
    for (const url of ['/app', '/app/inbox', '/app/books/entries']) {
      const r = await get(accountantCookie, url);
      expect([r.statusCode, r.headers['location']], url).toEqual([302, '/app/books']);
    }
    // Anyone else: the books are not there, as before.
    expect((await get(ownerCookie, '/app/books')).statusCode).toBe(404);
  });

  it('B18 · an accountant changes their own password and language', async () => {
    const account = await get(accountantCookie, '/app/settings/account');
    expect(account.statusCode).toBe(200);
    expect(account.body).toContain('href="/app/settings/language"');
    expect(account.body).toContain('data-nav="account"');
    expect(account.body).not.toContain('data-nav="inbox"');
    expect((await get(accountantCookie, '/app/settings/language')).statusCode).toBe(200);
    // The password form posts and comes back to their own page (it was sent to the books, "the books only").
    const pw = await post(accountantCookie, '/app/settings/account/password', { current: 'x', next: 'y' });
    expect([pw.statusCode, pw.headers['location']]).toEqual([302, '/app/settings/account']);
    // The language switch keeps them where they were.
    const lang = await get(accountantCookie, '/locale?set=fr&next=/app/settings/language');
    expect(lang.headers['location']).toBe('/app/settings/language');
  });

  it('B19 · a reading is found again after leaving, and the same page sent again asks no model', async () => {
    const first = await post(shopCookie, '/app/knowledge/from-page', { address: 'shop.example/pages/shipping', text: '' });
    expect(first.statusCode).toBe(303);
    const at = String(first.headers['location']);
    expect(at).toMatch(/^\/app\/knowledge\/from-page\/[0-9a-f-]{36}$/);
    expect([fetched.length, asked.length]).toEqual([1, 1]);
    // Left, and back on the knowledge page: the reading is there, a door to its lines.
    expect((await get(shopCookie, '/app/knowledge')).body).toContain(`href="${at}"`);
    // The same address again: that reading — nothing fetched, nothing asked, nothing charged.
    const again = await post(shopCookie, '/app/knowledge/from-page', { address: 'https://shop.example/pages/shipping', text: '' });
    expect(again.headers['location']).toBe(at);
    expect([fetched.length, asked.length]).toEqual([1, 1]);
    // Text pasted: known again by its fingerprint.
    const pasted = await post(shopCookie, '/app/knowledge/from-page', { address: '', text: PAGE });
    const pastedAt = String(pasted.headers['location']);
    expect(asked.length).toBe(2);
    expect((await post(shopCookie, '/app/knowledge/from-page', { address: '', text: PAGE })).headers['location']).toBe(pastedAt);
    expect(asked.length).toBe(2);
    // Once decided, the page is read anew.
    const lines = (await get(shopCookie, at)).body.match(/name="(line:[^"]+)"/g)!.map((m) => m.slice(6, -1));
    await post(shopCookie, `${at}/confirm`, { [lines[0]!]: 'on' });
    expect((await get(shopCookie, '/app/knowledge')).body).not.toContain(`href="${at}"`);
    await post(shopCookie, '/app/knowledge/from-page', { address: 'shop.example/pages/shipping', text: '' });
    expect([fetched.length, asked.length]).toEqual([2, 3]);
  });

  it('B21 · a refused answer for everything comes back on its own section, with what was typed', async () => {
    const r = await post(shopCookie, '/app/business/prices', { productId: '', floor: 'abc', maxDiscountPct: '5', askAbovePct: '3' });
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain('action="/app/business/prices#everything"');
    expect(r.body).toMatch(/name="floor"[^>]*aria-invalid="true"[^>]*autofocus[^>]*value="abc"/);
    expect(occurrences(r.body, 'class="perr"')).toBe(1);
  });
});
