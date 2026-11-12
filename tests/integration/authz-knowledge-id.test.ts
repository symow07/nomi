import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { demoSeedSql } from '../../src/demo/factory.js';
import { ensureQueueSchema, flashSaid } from './tenant.js';
import { purgeBusinesses } from './books-db.js';

/**
 * The authorization audit (Block 7), fix round — a fact corrected or set aside with no id.
 *
 * Found by the state-based walk (it now fails on any 5xx): `POST /app/knowledge/correct` and `/app/knowledge/archive`
 * with no `id` (or one that is not an id) reached the uuid cast and answered 500. Now they are refused as invalid
 * (a redirect with the refusal), and nothing is written.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, '').slice(0, 7);
const NS = `c${RUN}`;
const A = `${NS}-0000-4000-8000-0000000000b1`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const OWNER_CODE = `authz-fix-${RUN}`;
const code = (tag: string) => `${tag}${RUN.slice(0, 2).toUpperCase()}-${RUN.slice(2, 7).toUpperCase().replace(/[^A-Z2-9]/g, 'Q')}`;

d('Authorization audit · fix round: a fact with no id (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
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

  it('correct and archive with no id, or a word for an id, are refused — never a 500; nothing is written', async () => {
    const facts = async () => (await admin.query(`select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x::text), '')) as h from product_knowledge x where business_id = $1`, [A])).rows[0].h as string;
    const was = await facts();
    for (const url of ['/app/knowledge/correct', '/app/knowledge/archive']) {
      for (const id of [null, '', 'not-an-id']) {
        const body = new URLSearchParams({ content: 'authz', productId: `${NS}-0000-4000-8000-000000000101`, ...(id === null ? {} : { id }) }).toString();
        const r = await app.inject({ method: 'POST', url, payload: body, headers: { cookie: cookies.owner, 'content-type': 'application/x-www-form-urlencoded' } });
        expect(r.statusCode, `${url} id=${String(id)}`).toBe(302);
      }
    }
    expect(await facts()).toBe(was);
  });
});
