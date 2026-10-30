import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { sql } from 'kysely';
import { purgeBusinesses } from './books-db.js';

/**
 * AUDIT BATCH 2 (2026-10-30), through the routes. B14: a shop, a brand or an agency gets no Terms or Samples page
 * (their forms too), no door to them on How you sell or the conversation's sample card; a factory and a workspace with
 * no kind keep all of it. B17: books with no country, or another one, get no FEC and no CGNC chart; Moroccan books do.
 * Each case flips the one business's kind or country (`factsTtlMs: 0`, so nothing is cached between them).
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `a2b20000-0000-4000-8000-${RUN}0002`;
const CODE = `audit2-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';

d('audit batch 2 · shop screens and Moroccan books (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let owner = '';
  let conv = '';
  const session = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie: owner } });
  const post = (url: string, payload = '') => app.inject({ method: 'POST', url, payload, headers: { cookie: owner, 'content-type': 'application/x-www-form-urlencoded' } });
  const be = (fields: { kind?: string | null; country?: string | null; ice?: string | null }) => admin.query(
    `update businesses set kind = $2, country = $3, legal_ice = $4 where id = $1`, [BIZ, fields.kind ?? null, fields.country ?? null, fields.ice ?? null]);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    await admin.query(`insert into businesses (id, name, engine, currency, books_area, owner_locale) values ($1, $2, 'service', 'USD', true, 'en')`, [BIZ, `Audit two ${RUN}`]);
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    conv = await withTenantTx(db, b.value, async (x) => {
      const c = (await ensureConversation(x, b.value, `ig-audit2-${RUN}`, 'Amira Haddad', 'instagram')).conversationId;
      await sql`insert into messages (conversation_id, direction, input_type, text_content, sent_at)
                values (${c}::uuid, 'inbound', 'text', 'can you send a sample?', now())`.execute(x);
      // a sample asked for, with no sample price stated: the card's door is the Samples page
      await sql`insert into sample_requests (business_id, conversation_id, asked_text, requested_at)
                values (${BIZ}, ${c}::uuid, 'can you send a sample?', now())`.execute(x);
      return c;
    });
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    owner = session(await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
    expect(owner).not.toBe('');
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await purgeBusinesses(admin, [BIZ], 'audit-batch-2-test'); await admin?.end(); });

  const EXPORT_PAGES = ['/app/settings/terms', '/app/settings/samples'];

  it('B14 · A SHOP, A BRAND OR AN AGENCY: Terms and Samples are not there, their forms change nothing, and no page opens a door to them', async () => {
    for (const kind of ['brand', 'online_shop', 'agency']) {
      await be({ kind });
      for (const url of EXPORT_PAGES) expect((await get(url)).statusCode, `${kind} GET ${url}`).toBe(404);
      expect((await post('/app/settings/terms', 'payment=T%2FT&incoterm=FOB')).statusCode, kind).toBe(404);
      expect((await post('/app/settings/samples', 'price=5&credited=on')).statusCode, kind).toBe(404);
      const how = await get('/app/business/how-you-sell');
      expect(how.statusCode, kind).toBe(200);
      for (const url of EXPORT_PAGES) expect(how.body, `${kind} how-you-sell ${url}`).not.toContain(`href="${url}"`);
      const page = await get(`/app/inbox/${conv}`);
      expect(page.statusCode, kind).toBe(200);
      expect(page.body, `${kind} sample card`).not.toContain('href="/app/settings/samples"');
    }
    expect((await admin.query(`select 1 from trade_terms where business_id = $1`, [BIZ])).rowCount).toBe(0);
    expect((await admin.query(`select 1 from sample_policy where business_id = $1`, [BIZ])).rowCount).toBe(0);
  });

  it('B14 · A FACTORY, AN EXPORTER, A WHOLESALER, OR NO KIND YET: the pages, the doors and the sample card\'s door are all there', async () => {
    for (const kind of ['manufacturer', 'trading', 'wholesale', null]) {
      await be({ kind });
      for (const url of EXPORT_PAGES) expect((await get(url)).statusCode, `${kind} GET ${url}`).toBe(200);
      const how = (await get('/app/business/how-you-sell')).body;
      for (const url of EXPORT_PAGES) expect(how, `${kind} how-you-sell ${url}`).toContain(`href="${url}"`);
      expect((await get(`/app/inbox/${conv}`)).body, `${kind} sample card`).toContain('href="/app/settings/samples"');
    }
  });

  it('B17 · BOOKS WITH NO COUNTRY, OR ANOTHER ONE: no FEC door, no CGNC chart, and their addresses are not there', async () => {
    for (const country of [null, 'FR', 'GB', 'US']) {
      await be({ kind: null, country });
      const home = await get('/app/books');
      expect(home.statusCode, String(country)).toBe(200);
      expect(home.body, String(country)).not.toContain('href="/app/books/fec"');
      expect(home.body, String(country)).not.toContain('action="/app/books/chart/cgnc"');
      expect((await get('/app/books/fec')).statusCode, String(country)).toBe(404);
      expect((await post('/app/books/chart/cgnc')).statusCode, String(country)).toBe(404);
      expect((await post('/app/books/fec/filename', 'pattern=x')).statusCode, String(country)).toBe(404);
    }
    expect((await admin.query(`select 1 from accounts where business_id = $1`, [BIZ])).rowCount, 'no CGNC account was added').toBe(0);
  });

  it('B17 · MOROCCAN BOOKS — the country, or the ICE already given: the FEC door, the chart and the FEC page', async () => {
    for (const where of [{ country: 'MA' }, { country: null, ice: '001234567000089' }]) {
      await be({ kind: null, ...where });
      const home = (await get('/app/books')).body;
      expect(home, JSON.stringify(where)).toContain('href="/app/books/fec"');
      expect(home, JSON.stringify(where)).toContain('action="/app/books/chart/cgnc"');
      expect((await get('/app/books/fec')).statusCode, JSON.stringify(where)).toBe(200);
    }
  });
});
