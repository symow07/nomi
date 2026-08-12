import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * M37.5 — the owner can actually configure this, and it is enforced from rows.
 *
 * The parity tests prove the matcher. They cannot prove that her list reaches
 * the reply path, that the route writes a row, or that removing a term is an
 * archive rather than a delete — those are rows, and a test on fakes proves
 * nothing about a real tenant. That is how the promotion ladder hid for a year.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd375000-0000-4000-8000-${RUN}0001`;

d('M37.5 · her forbidden list, end to end (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const CODE = 'forbidden-test-code';

  const post = (url: string, payload?: string) =>
    app.inject({
      method: 'POST', url, headers: {
        cookie, ...(payload ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(payload ? { payload } : {}),
    });

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    await withTenantTx(db, bid.value, async (tx) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Forbidden Test Factory')
                on conflict (id) do nothing`.execute(tx);
    });

    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE,
      sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = await app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  const rows = async (): Promise<{ term: string; archived: boolean }[]> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, (tx) => sql<{ term: string; archived_at: Date | null }>`
      select term, archived_at from forbidden_terms where business_id = ${BIZ} order by created_at
    `.execute(tx).then((r) => r.rows.map((x) => ({ term: x.term, archived: x.archived_at !== null }))));
  };

  it('THE PRODUCTION CALLER: the owner adds a term from her settings', async () => {
    const res = await post('/app/settings/forbidden', 'term=Guangzhou%20Textile');
    expect(res.statusCode).toBe(302);
    expect(await rows()).toEqual([{ term: 'Guangzhou Textile', archived: false }]);
  });

  it('the reply path reads HER row, not a hardcoded list', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { guardForbidden } = await import('../../src/core/safety/forbiddenWords.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');

    const terms = await withTenantTx(db, bid.value, (tx) =>
      tenantRepos(tx, bid.value).catalog.forbiddenTerms());
    expect(terms).toContain('Guangzhou Textile');

    // The same composition the turn performs.
    const r = guardForbidden({ reply: 'We beat Guangzhou Textile on price.', ownerTerms: terms });
    expect(r.ok).toBe(false);
  });

  it('adding the same term twice does not duplicate it', async () => {
    await post('/app/settings/forbidden', 'term=guangzhou%20textile');
    const live = (await rows()).filter((r) => !r.archived);
    expect(live).toHaveLength(1);
  });

  it('a blank term is refused rather than matching every reply', async () => {
    await post('/app/settings/forbidden', 'term=%20%20');
    expect((await rows()).filter((r) => !r.archived)).toHaveLength(1);
  });

  it('the page shows her term and the floor', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/settings/forbidden', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Guangzhou Textile');
    expect(res.body).toContain('Always enforced');
  });

  it('REMOVING archives, never deletes — the record survives her changing her mind', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    const id = await withTenantTx(db, bid.value, (tx) => sql<{ id: string }>`
      select id from forbidden_terms where business_id = ${BIZ} and archived_at is null limit 1
    `.execute(tx).then((r) => r.rows[0]!.id));

    const res = await post(`/app/settings/forbidden/${id}/remove`);
    expect(res.statusCode).toBe(302);

    const after = await rows();
    expect(after).toHaveLength(1);                 // still there
    expect(after[0]!.archived).toBe(true);         // as history
    // and the reply path no longer enforces it
    const { tenantRepos } = await import('../../src/db/repos.js');
    const terms = await withTenantTx(db, bid.value, (tx) =>
      tenantRepos(tx, bid.value).catalog.forbiddenTerms());
    expect(terms).not.toContain('Guangzhou Textile');
  });

  it('THE FLOOR SURVIVES an empty list — she cannot switch it off by removing rows', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { guardForbidden } = await import('../../src/core/safety/forbiddenWords.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    const terms = await withTenantTx(db, bid.value, (tx) =>
      tenantRepos(tx, bid.value).catalog.forbiddenTerms());
    expect(terms).toHaveLength(0);
    expect(guardForbidden({ reply: 'you idiot', ownerTerms: terms }).ok).toBe(false);
  });
});
