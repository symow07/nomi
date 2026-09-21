import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant, flashSaid } from './tenant.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * Phase 2 · CC-12 + CC-02 — she takes a copy of her own data, and she asks for
 * it to be gone. Driven through the real routes, against real Postgres, with
 * row-level security doing the tenant scoping it exists for.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd640000-0000-4000-8000-${RUN}0001`;
const OTHER = `dd640000-0000-4000-8000-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('Phase 2 · her data, out and gone (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let ownerCookie = '';
  let staffCookie = '';
  const CODE = 'data-rights-owner-code';

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>, biz = BIZ): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const login = async (code: string) => String((await app.inject({
    method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM,
  })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const post = (cookie: string, url: string, payload = '') =>
    app.inject({ method: 'POST', url, payload, headers: { cookie, ...FORM } });

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);

    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Atlas Trading')
                on conflict (id) do nothing`.execute(t);
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name, email)
        values (${BIZ}, ${`+9715${RUN}`}, 'Omar Haddad', ${`omar-${RUN}@atlas.test`})
        returning id::text as id`.execute(t)).rows[0]!.id;
      const conv = (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${BIZ}, ${client}::uuid, 'whatsapp', 'warm_intake') returning id::text as id`.execute(t)).rows[0]!.id;
      // A buyer whose words would become a formula in a spreadsheet.
      await sql`insert into messages (conversation_id, direction, text_content, sent_at)
                values (${conv}::uuid, 'inbound', ${'=HYPERLINK("http://evil.test","invoice")'}, now())`.execute(t);
      await sql`insert into messages (conversation_id, direction, text_content, sent_at)
                values (${conv}::uuid, 'inbound', ${'你好，我要 5000 个帆布袋'}, now())`.execute(t);
      await sql`insert into products (business_id, sku, name, unit, moq, currency)
                values (${BIZ}, ${`SKU-${RUN}`}, 'Canvas tote', 'pcs', 500, 'USD')`.execute(t);
    });
    // A SECOND business, whose rows must never appear in the first one's file.
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${OTHER}, 'Someone Else Ltd')
                on conflict (id) do nothing`.execute(t);
      await sql`insert into clients (business_id, phone, display_name)
                values (${OTHER}, ${`+8613${RUN}`}, 'NOT-YOURS-Wei')`.execute(t);
    }, OTHER);

    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    ownerCookie = await login(CODE);
    expect(ownerCookie).not.toBe('');

    // G9a — the new staff code rides a short-lived cookie to the people page,
    // never a URL, so reading it back needs that cookie too.
    const added = await post(ownerCookie, '/app/settings/people', 'name=Xiao%20Chen');
    const issued = String(added.headers['set-cookie'] ?? '').split(';')[0]!;
    const page = await app.inject({
      method: 'GET', url: String(added.headers['location']),
      headers: { cookie: `${ownerCookie}; ${issued}` },
    });
    const code = page.body.match(/<p class="code"><bdi>([A-Z2-9]{5}-[A-Z2-9]{5})<\/bdi><\/p>/)?.[1] ?? '';
    if (code) staffCookie = await login(code);
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('THE PRODUCTION CALLER: every subject downloads as a CSV attachment', async () => {
    // Driven from EXPORT_SUBJECTS rather than a copy of it, so a subject added
    // to the product cannot skip this. Against REAL Postgres on purpose: the
    // configuration queries name eleven tables, and the only thing that catches
    // a wrong column is a database — `suppressions.at` was `created_at` in the
    // first draft of this export and every unit test passed.
    const { EXPORT_SUBJECTS } = await import('../../src/api/web/dataExport.js');
    expect(EXPORT_SUBJECTS.length).toBe(9);
    for (const subject of EXPORT_SUBJECTS) {
      const res = await get(ownerCookie, `/app/settings/data/${subject}.csv`);
      expect(res.statusCode, subject).toBe(200);
      expect(String(res.headers['content-type']), subject).toContain('text/csv');
      expect(String(res.headers['content-disposition']), subject)
        .toMatch(new RegExp(`attachment; filename="nomi-${subject}-\\d{4}-\\d{2}-\\d{2}\\.csv"`));
      // Nothing between here and her laptop keeps a copy.
      expect(String(res.headers['cache-control']), subject).toContain('no-store');
      // The mark Excel needs, then a header row.
      expect(res.body.charCodeAt(0), subject).toBe(0xFEFF);
      expect(res.body.split('\r\n')[0], subject).not.toBe('');
    }
  });

  it('HER BUYERS ARE IN IT, AND NOBODY ELSE\'S — row-level security, not a where clause', async () => {
    const body = (await get(ownerCookie, '/app/settings/data/buyers.csv')).body;
    expect(body).toContain('Omar Haddad');
    expect(body).toContain(`omar-${RUN}@atlas.test`);
    expect(body, 'another business\'s buyer reached her file').not.toContain('NOT-YOURS-Wei');
  });

  it('a buyer cannot write a formula into her spreadsheet', async () => {
    const body = (await get(ownerCookie, '/app/settings/data/messages.csv')).body;
    // The words are there…
    expect(body).toContain('HYPERLINK');
    // …marked as text, so the spreadsheet does not run them.
    expect(body).toContain(`"'=HYPERLINK`);
    // And Chinese survives the round trip.
    expect(body).toContain('你好，我要 5000 个帆布袋');
  });

  it('taking a copy is written on the audit trail — the subject and the count, never a value', async () => {
    await get(ownerCookie, '/app/settings/data/products.csv');
    const rows = await tx((t) => sql<{ detail: unknown }>`
      select detail from channel_audit where business_id = ${BIZ} and action = 'export_data'
       order by at desc limit 1`.execute(t).then((r) => r.rows));
    expect(rows.length).toBe(1);
    expect(rows[0]!.detail).toMatchObject({ subject: 'products' });
    expect(JSON.stringify(rows[0]!.detail), 'a value from the table leaked into the trail')
      .not.toContain('Canvas tote');
  });

  it('an address that is not a subject is a 404, not a table somebody named', async () => {
    for (const bad of ['logins', 'people', 'businesses']) {
      expect((await get(ownerCookie, `/app/settings/data/${bad}.csv`)).statusCode, bad).toBe(404);
    }
  });

  it('A SALES ASSISTANT gets neither the page nor the file', async () => {
    expect(staffCookie, 'fixture: staff must be signed in').not.toBe('');
    const page = await get(staffCookie, '/app/settings/data');
    expect(page.statusCode).toBe(302);
    expect(flashSaid(page, SECRET)).toContain('Only the owner');
    const file = await get(staffCookie, '/app/settings/data/buyers.csv');
    expect(file.statusCode, 'the FILE is gated too, not only the page').toBe(302);
    expect(String(file.headers['content-type'] ?? '')).not.toContain('text/csv');
  });

  it('SHE ASKS FOR EVERYTHING TO GO — and must type her own name to do it', async () => {
    const wrong = await post(ownerCookie, '/app/settings/data/delete', 'name=Atlas%20Trrrading');
    expect(flashSaid(wrong, SECRET)).toBe(t('en', 'data.flash.name_wrong'));
    expect(await openRequests()).toBe(0);

    const ok = await post(ownerCookie, '/app/settings/data/delete',
      'name=atlas%20trading&note=closing%20up');
    expect(flashSaid(ok, SECRET)).toBe(t('en', 'data.flash.asked'));
    expect(await openRequests(), 'the name is matched case-insensitively').toBe(1);

    const again = await post(ownerCookie, '/app/settings/data/delete', 'name=Atlas%20Trading');
    expect(flashSaid(again, SECRET)).toBe(t('en', 'data.flash.already_open'));
    expect(await openRequests(), 'pressing twice is ONE request').toBe(1);
  });

  it('NOTHING WAS DELETED by asking — the request is a row, not an erasure', async () => {
    const left = await tx((t) => sql<{ n: number }>`
      select (select count(*) from clients where business_id = ${BIZ})
           + (select count(*) from products where business_id = ${BIZ}) as n`
      .execute(t).then((r) => Number(r.rows[0]!.n)));
    expect(left, 'her buyer and her product are still there').toBeGreaterThan(0);
    const row = await tx((t) => sql<{ scope: string; state: string; asked_by: string; subject_note: string | null }>`
      select scope, state, asked_by, subject_note from deletion_requests
       where business_id = ${BIZ} order by asked_at desc limit 1`.execute(t).then((r) => r.rows[0]!));
    expect(row).toMatchObject({ scope: 'workspace', state: 'open', subject_note: 'closing up' });
  });

  it('…and she can take it back, once', async () => {
    const id = await tx((t) => sql<{ id: string }>`
      select id::text as id from deletion_requests
       where business_id = ${BIZ} and state = 'open' limit 1`.execute(t).then((r) => r.rows[0]!.id));

    const back = await post(ownerCookie, '/app/settings/data/withdraw', `id=${id}`);
    expect(flashSaid(back, SECRET)).toBe(t('en', 'data.flash.withdrawn'));
    expect(await openRequests()).toBe(0);

    const twice = await post(ownerCookie, '/app/settings/data/withdraw', `id=${id}`);
    expect(flashSaid(twice, SECRET)).toBe(t('en', 'data.flash.not_open'));

    // A request from another workspace is not hers to withdraw, and the tenant
    // transaction is what refuses it — not a check somebody remembered to write.
    const theirs = await tx(async (t) => (await sql<{ id: string }>`
      insert into deletion_requests (business_id, scope, asked_by)
      values (${OTHER}, 'workspace', 'owner') returning id::text as id`.execute(t)).rows[0]!.id, OTHER);
    const nope = await post(ownerCookie, '/app/settings/data/withdraw', `id=${theirs}`);
    expect(flashSaid(nope, SECRET)).toBe(t('en', 'data.flash.not_open'));
    const still = await tx((t) => sql<{ state: string }>`
      select state from deletion_requests where id = ${theirs}::uuid`.execute(t).then((r) => r.rows[0]!.state), OTHER);
    expect(still, 'another workspace\'s request was touched').toBe('open');
  });

  it('the asking and the taking back are both on the audit trail', async () => {
    const actions = await tx((t) => sql<{ action: string }>`
      select action from channel_audit where business_id = ${BIZ}
         and action in ('deletion_requested','deletion_withdrawn')`.execute(t).then((r) => r.rows.map((x) => x.action)));
    expect(actions.sort()).toEqual(['deletion_requested', 'deletion_withdrawn']);
  });

  const openRequests = () => tx((t) => sql<{ n: number }>`
    select count(*)::int as n from deletion_requests
     where business_id = ${BIZ} and scope = 'workspace' and state = 'open'`
    .execute(t).then((r) => r.rows[0]!.n));
});
