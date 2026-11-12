import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { demoSeedSql } from '../../src/demo/factory.js';
import { ensureQueueSchema, flashSaid } from './tenant.js';
import { purgeBusinesses } from './books-db.js';

/**
 * The authorization audit (Block 7), fix round — L2, a capability by a name that is not one.
 *
 * `POST /app/settings/assistant/capability/<name>/{promote,revoke}` with a name that is not a capability answered 500
 * (the write threw). Now it is an address that does not exist: 404, and nothing is written; a real one works as before.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, '').slice(0, 7);
const NS = `d${RUN}`;
const A = `${NS}-0000-4000-8000-0000000000b1`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const OWNER_CODE = `authz-fix-${RUN}`;
const code = (tag: string) => `${tag}${RUN.slice(0, 2).toUpperCase()}-${RUN.slice(2, 7).toUpperCase().replace(/[^A-Z2-9]/g, 'Q')}`;

d('Authorization audit · fix round: a capability that is not one (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let db: import('../../src/db/client.js').Db;
  let app: import('fastify').FastifyInstance;
  const cookies: Record<'owner' | 'team' | 'accountant', string> = { owner: '', team: '', accountant: '' };
  const sess = (r: { headers: Record<string, unknown> }) => ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? [])
    .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const login = async (c: string) => sess(await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(c)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
  const get = (url: string, who: keyof typeof cookies) => app.inject({ method: 'GET', url, headers: { cookie: cookies[who] } });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    await ensureQueueSchema();
    await admin.query(demoSeedSql(NS));
    const { hashCode } = await import('../../src/api/web/people.js');
    for (const [kind, tag] of [['team', 'TM'], ['accountant', 'AC']] as const) {
      await admin.query(`insert into people (business_id, name, is_owner, kind, code_hash) values ($1, $2, false, $3, $4)`, [A, `Fix ${kind}`, kind, hashCode(SECRET, code(tag))]);
    }
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: A, accessCode: OWNER_CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookies.owner = await login(OWNER_CODE);
    cookies.team = await login(code('TM'));
    cookies.accountant = await login(code('AC'));
    for (const c of Object.values(cookies)) expect(c).not.toBe('');
  }, 120_000);
  afterAll(async () => {
    await app?.close(); await db?.destroy();
    await purgeBusinesses(admin, [A], 'authz-fix-round-test').catch(async () => { await admin.query('rollback'); });
    await admin?.end();
  });

  it('L2 · a name that is not a capability is not found, promote and revoke alike; nothing is written', async () => {
    const policy = async () => (await admin.query(`select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x::text), '')) as h from autonomy_policy x where business_id = $1`, [A])).rows[0].h as string;
    const was = await policy();
    for (const name of ['not_a_capability', randomUUID(), 'quote%27--']) {
      for (const verb of ['promote', 'revoke']) {
        const r = await app.inject({ method: 'POST', url: `/app/settings/assistant/capability/${name}/${verb}`, payload: '', headers: { cookie: cookies.owner, 'content-type': 'application/x-www-form-urlencoded' } });
        expect(r.statusCode, `${verb} ${name}`).toBe(404);
      }
    }
    expect(await policy()).toBe(was);
    // A real capability still goes through the route as before.
    const ok = await app.inject({ method: 'POST', url: '/app/settings/assistant/capability/greet/revoke', payload: '', headers: { cookie: cookies.owner, 'content-type': 'application/x-www-form-urlencoded' } });
    expect(ok.statusCode).toBe(302);
  });
});
