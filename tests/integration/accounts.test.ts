import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * A1 — two factories sign themselves up on one installation and never see each
 * other. Driven through the real production composition and real Postgres:
 * what is being proved is the definer functions, row-level security and the
 * session together, none of which a unit test can reach.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `a1550000-0000-4000-8000-${RUN}0001`;
const A = { factory: `Atlas Canvas ${RUN}`, name: 'Mei', email: `mei-${RUN}@atlas.example`, password: `atlas-password-${RUN}` };
const B = { factory: `Bolt Tools ${RUN}`, name: 'Omar', email: `omar-${RUN}@bolt.example`, password: `bolt-password-${RUN}` };

d('A1 · a factory signs itself up and signs in as itself (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let admin: pg.Client;

  const form = (url: string, fields: Record<string, string>, cookie = '') => prod.app.inject({
    method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    payload: new URLSearchParams(fields).toString(),
  });
  const get = (url: string, cookie: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });
  const cookieOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? []).map((c) => c.split(';')[0]!).find((c) => !c.endsWith('=')) ?? '';
  const invite = async (note: string, interval = '14 days') =>
    (await admin.query(`insert into signup_invites (note, expires_at) values ($1, now() + $2::interval) returning id::text as id`, [note, interval])).rows[0].id as string;

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    process.env['OWNER_ACCESS_CODE'] = `accounts-${RUN}`;
    process.env['SIGNUP_MODE'] = 'invite';
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name) values ($1, $2) on conflict (id) do nothing`, [PILOT, `Pilot ${RUN}`]);
    const { buildProduction } = await import('../../src/main.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    prod = await buildProduction({
      provider: 'disabled', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'a1-verify-token-0001',
      CREDENTIAL_KEY: 'a'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { logger: false });
  }, 90_000);

  afterAll(async () => {
    delete process.env['SIGNUP_MODE'];
    await admin?.end();
    await prod?.close();
  });

  let cookieA = '';
  let cookieB = '';
  let ticketA = '';

  it('WITHOUT AN INVITATION NOTHING IS MADE — not even with everything else right', async () => {
    const r = await form('/signup', { ...A, invite: '' });
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain(t('en', 'signup.problem.invite_missing'));
    expect(r.body, 'her password is never echoed').not.toContain(A.password);
    const unknown = await form('/signup', { ...A, invite: randomUUID() });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body).toContain(t('en', 'signup.error.invite_not_open'));
    expect((await admin.query(`select 1 from logins where email = $1`, [A.email])).rowCount).toBe(0);
  });

  it('WITH ONE, SHE HAS A WORKSPACE AND IS INSIDE IT — a business, its owner and her login, together', async () => {
    ticketA = await invite(`Atlas ${RUN}`);
    const page = await prod.app.inject({ method: 'GET', url: `/signup?invite=${ticketA}` });
    expect(page.body).toContain(`value="${ticketA}"`);

    const r = await form('/signup', { ...A, email: `  ${A.email.toUpperCase()} `, invite: ticketA });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(302);
    expect(String(r.headers['location'])).toContain('/app/factory?flash=');
    cookieA = cookieOf(r);
    expect(cookieA).not.toBe('');

    const row = (await admin.query(
      `select b.name as factory, p.name as person, p.is_owner, l.email, l.password_hash, i.used_by = b.id as spent
         from logins l join businesses b on b.id = l.business_id join people p on p.id = l.person_id
         join signup_invites i on i.id = $2 where l.email = $1`, [A.email, ticketA])).rows[0];
    expect(row).toMatchObject({ factory: A.factory, person: 'Mei', is_owner: true, email: A.email, spent: true });
    expect(row.password_hash).toMatch(/^scrypt\$/);
    expect(row.password_hash).not.toContain(A.password);

    const settings = await get('/app/settings', cookieA);
    expect(settings.statusCode).toBe(200);
    expect(settings.body).toContain(A.factory);
    expect((await get('/app', cookieA)).statusCode, 'Today renders for HER business').toBe(200);
  });

  it('AN INVITATION IS SPENT ONCE, and one that has run out opens nothing', async () => {
    const again = await form('/signup', { ...B, invite: ticketA });
    expect(again.statusCode).toBe(400);
    expect(again.body).toContain(t('en', 'signup.error.invite_not_open'));
    const { inviteIsOpen } = await import('../../src/db/accounts.js');
    expect(await inviteIsOpen(prod.db, await invite('lapsed', '-1 minute'))).toBe(false);
    expect((await admin.query(`select 1 from logins where email = $1`, [B.email])).rowCount).toBe(0);
  });

  it('A SECOND FACTORY SEES ITS OWN WORKSPACE AND NOTHING OF THE FIRST', async () => {
    const r = await form('/signup', { ...B, invite: await invite(`Bolt ${RUN}`) });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(302);
    cookieB = cookieOf(r);

    const mine = await get('/app/settings', cookieB);
    expect(mine.body).toContain(B.factory);
    expect(mine.body).not.toContain(A.factory);

    // Something of A's, written through A's own session, is invisible to B.
    const { lookupLogin } = await import('../../src/db/accounts.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const a = await lookupLogin(prod.db, A.email);
    const b = await lookupLogin(prod.db, B.email);
    expect(a!.businessId).not.toBe(b!.businessId);
    const aid = parseBusinessId(a!.businessId); const bidB = parseBusinessId(b!.businessId);
    if (!aid.ok || !bidB.ok) throw new Error('fixture');
    await withTenantTx(prod.db, aid.value, (x) => sql`
      insert into products (business_id, sku, name, is_active) values (${aid.value}::uuid, ${`SKU-${RUN}`}, ${`Secret tote ${RUN}`}, true)`.execute(x));
    expect((await get('/app/products', cookieA)).body).toContain(`Secret tote ${RUN}`);
    expect((await get('/app/products', cookieB)).body).not.toContain(`Secret tote ${RUN}`);
    // …and B's tenant cannot read A's login row, whatever it asks for.
    const seen = await withTenantTx(prod.db, bidB.value, (x) => sql<{ n: string }>`select count(*)::text as n from logins`.execute(x));
    expect(seen.rows[0]!.n).toBe('1');
  });

  it('the application role still cannot see or mint an invitation', async () => {
    await expect(sql`select count(*) from signup_invites`.execute(prod.db)).rejects.toThrow(/permission denied/);
    await expect(sql`insert into signup_invites (note) values ('mine')`.execute(prod.db)).rejects.toThrow(/permission denied/);
  });

  it('ONE E-MAIL, ONE WORKSPACE — and an open installation needs no ticket', async () => {
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const { hashPassword } = await import('../../src/security/password.js');
    const passwordHash = await hashPassword('whatever-password');
    expect(await provisionAccount(prod.db, {
      factory: 'Copycat', language: 'en', ownerName: 'X', email: A.email, passwordHash, invite: null, inviteRequired: false,
    })).toEqual({ code: 'email_taken' });
    expect((await admin.query(`select 1 from businesses where name = 'Copycat'`)).rowCount, 'nothing half-made is left behind').toBe(0);

    const open = await provisionAccount(prod.db, {
      factory: `Open ${RUN}`, language: 'xx', ownerName: 'Y', email: `open-${RUN}@open.example`, passwordHash, invite: null, inviteRequired: false,
    });
    expect(open.code).toBe('created');
    expect((await admin.query(`select default_language from businesses where name = $1`, [`Open ${RUN}`])).rows[0].default_language,
      'a language the product does not speak becomes English').toBe('en');
  });

  it('SHE SIGNS IN WITH HER OWN E-MAIL AND PASSWORD — and the door does not say which addresses exist', async () => {
    const ok = await form('/login', { email: B.email.toUpperCase(), password: B.password });
    expect(ok.statusCode).toBe(302);
    expect((await get('/app/settings', cookieOf(ok))).body).toContain(B.factory);

    const wrong = await form('/login', { email: B.email, password: 'not-her-password' });
    const nobody = await form('/login', { email: `nobody-${RUN}@nowhere.example`, password: 'not-her-password' });
    expect([wrong.statusCode, nobody.statusCode]).toEqual([401, 401]);
    expect(wrong.body).toContain(t('en', 'login.errorPassword'));
    expect(nobody.body).toContain(t('en', 'login.errorPassword'));
    expect(wrong.body, 'a password is never echoed').not.toContain('not-her-password');
  });

  it('FIVE WRONG PASSWORDS LOCK THAT LOGIN — and the lock does not answer right-or-wrong either', async () => {
    for (let i = 0; i < 5; i++) expect((await form('/login', { email: A.email, password: `guess-${i}-padding` })).statusCode).toBe(401);
    const right = await form('/login', { email: A.email, password: A.password });
    expect(right.statusCode).toBe(429);
    expect(right.body).toContain(t('en', 'login.locked'));
    const locked = (await admin.query(`select locked_until > now() as locked from logins where email = $1`, [A.email])).rows[0];
    expect(locked.locked).toBe(true);
    expect((await form('/login', { email: B.email, password: B.password })).statusCode, 'another login is not punished').toBe(302);
  });

  it('the environment\'s access code still opens the environment\'s business, exactly as before', async () => {
    const r = await form('/login', { code: prod.ownerAccessCode });
    expect(r.statusCode).toBe(302);
    expect((await get('/app/settings', cookieOf(r))).body).toContain(`Pilot ${RUN}`);
    const bad = await form('/login', { code: 'WRONG-CODE1' });
    expect(bad.statusCode).toBe(401);
    expect(bad.body).toMatch(/<details open>/);
  });

  it('A STAFF CODE NAMES ITS OWN BUSINESS, so a second factory\'s people can sign in', async () => {
    const { lookupLogin, personForCodeHash } = await import('../../src/db/accounts.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = await lookupLogin(prod.db, B.email);
    const bidB = parseBusinessId(b!.businessId); if (!bidB.ok) throw new Error('fixture');
    const hash = `hash-${RUN}-${randomUUID()}`;
    await withTenantTx(prod.db, bidB.value, (x) => sql`
      insert into people (business_id, name, code_hash) values (${bidB.value}::uuid, 'Yusuf', ${hash})`.execute(x));
    expect(await personForCodeHash(prod.db, hash)).toMatchObject({ businessId: b!.businessId, person: { name: 'Yusuf', isOwner: false } });
    expect(await personForCodeHash(prod.db, `${hash}-no`)).toBeNull();
    await withTenantTx(prod.db, bidB.value, (x) => sql`update people set archived_at = now() where code_hash = ${hash}`.execute(x));
    expect(await personForCodeHash(prod.db, hash), 'someone she removed has no way in').toBeNull();
  });

  it('SHE CHANGES HER PASSWORD ONLY AGAINST THE ONE SHE HAS NOW, and the old one stops working', async () => {
    const page = await get('/app/settings/account', cookieB);
    expect(page.body).toContain(B.email);
    expect(page.body).not.toContain(A.email);

    const flash = (r: { headers: Record<string, unknown> }) => new URL(String(r.headers['location']), 'https://x.test').searchParams.get('flash');
    expect(flash(await form('/app/settings/account/password', { current: 'not-it', next: 'a-brand-new-password' }, cookieB))).toBe(t('en', 'account.flash.wrong'));
    expect(flash(await form('/app/settings/account/password', { current: B.password, next: 'short' }, cookieB))).toBe(t('en', 'account.flash.short', { n: 10 }));
    expect(flash(await form('/app/settings/account/password', { current: B.password, next: 'a-brand-new-password' }, cookieB))).toBe(t('en', 'account.flash.changed'));

    expect((await form('/login', { email: B.email, password: B.password })).statusCode).toBe(401);
    expect((await form('/login', { email: B.email, password: 'a-brand-new-password' })).statusCode).toBe(302);

    const pilot = cookieOf(await form('/login', { code: prod.ownerAccessCode }));
    expect((await get('/app/settings/account', pilot)).body, 'a code has no password to change').toContain(t('en', 'account.codeOnly'));
  });

  it('THE CLOCK LOOKS AT EVERY FACTORY WITH SOMETHING TO DO, not only the one the environment names — and not at idle ones', async () => {
    const { liveBusinessIds, lookupLogin } = await import('../../src/db/accounts.js');
    const a = (await lookupLogin(prod.db, A.email))!.businessId;
    const b = (await lookupLogin(prod.db, B.email))!.businessId;
    expect(await liveBusinessIds(prod.db), 'a workspace with no follow-up and no domain costs the minute nothing').not.toContain(b);
    await admin.query(`insert into sending_domains (business_id, domain, dkim_selector) values ($1, $2, 'google')`, [b, `bolt-${RUN}.example`]);
    const ids = await liveBusinessIds(prod.db);
    expect(ids).toContain(b);
    expect(ids).not.toContain(a);
  });
});
