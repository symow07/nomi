import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { sql } from 'kysely';
import { TIKTOK_APP, tiktokFake, ALL_SCOPES } from '../channels/tiktok-fake.js';
import { purgeBusinesses } from './books-db.js';

/**
 * 0215 — A BUSINESS CONNECTS ITS OWN TIKTOK ACCOUNT, through the real routes, against the fake of TikTok's documented
 * answers: owner only; TikTok's own page with our state and never past its consent screen; back here, the state
 * checked, the code exchanged, the grant sealed and the account routed to this business; a consent missing a messaging
 * permission, or an account another workspace holds, is refused and the grant given straight back; disconnecting gives
 * it back and switches the routing off; a practice copy can hold no account.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `72720000-0000-4000-8000-${RUN}0001`;
const OTHER = `72720000-0000-4000-8000-${RUN}0002`;
const CODE = `tt-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const KEY = randomBytes(32);

d('0215 · connecting a TikTok account (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let owner = '';
  let staff = '';
  const tt = tiktokFake();
  const cookiesOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!);
  const session = (r: { headers: Record<string, unknown> }) => cookiesOf(r).find((c) => c.startsWith('yf_session=')) ?? '';
  const notice = async (r: { headers: Record<string, unknown> }) => {
    const to = String(r.headers['location']).split('#')[0]!;
    return (await app.inject({ method: 'GET', url: to, headers: { cookie: `${owner}; ${cookiesOf(r).join('; ')}` } })).body;
  };
  const screen = async (who = owner) => (await app.inject({ method: 'GET', url: '/app/channels/tiktok', headers: { cookie: who } })).body;
  const connect = async (openId: string, o: { nonce?: string } = {}) => {
    const start = await app.inject({ method: 'GET', url: '/app/connect/tiktok/start', headers: { cookie: owner } });
    const to = new URL(String(start.headers['location']));
    const state = cookiesOf(start).find((c) => c.startsWith('yf_tiktok='))!;
    return app.inject({ method: 'GET', url: `/app/connect/tiktok/callback?code=${encodeURIComponent(tt.code(openId))}&state=${encodeURIComponent(o.nonce ?? to.searchParams.get('state')!)}`,
      headers: { cookie: `${owner}; ${state}` } });
  };
  const live = async (biz = BIZ) => (await admin.query(`select open_id, username from tiktok_accounts where business_id = $1 and archived_at is null`, [biz])).rows[0] ?? null;
  const routed = async (openId: string) => (await admin.query(`select business_id::text as b from resolve_tenant('tiktok', $1)`, [openId])).rows[0]?.b ?? null;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    for (const b of [BIZ, OTHER]) await admin.query(`insert into businesses (id, name, engine) values ($1, $2, 'service')`, [b, `TikTok ${RUN} ${b.slice(-1)}`]);
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
      publicBaseUrl: 'https://app.example', credentialKey: KEY,
      tiktokConnect: { db, credentialKey: KEY, app: TIKTOK_APP, fetchImpl: tt.fetch },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = (code: string) => app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    owner = session(await login(CODE));
    const person = await addPerson(db, BIZ, SECRET, `Staff ${RUN}`, 'team');
    if (person.code !== 'added') throw new Error('fixture');
    staff = session(await login(person.accessCode));
  });
  afterAll(async () => {
    await app?.close(); await db?.destroy();
    await purgeBusinesses(admin, [BIZ, OTHER, `72720000-0000-4000-8000-${RUN}0009`], 'tiktok-connect-test');
    await admin?.end();
  });

  it('the owner is offered Connect; staff see the same page, that the owner decides, and cannot start it', async () => {
    expect(await screen()).toContain('action="/app/connect/tiktok/start"');
    const theirs = await screen(staff);
    expect(theirs).not.toContain('action="/app/connect/tiktok/start"');
    const tried = await app.inject({ method: 'GET', url: '/app/connect/tiktok/start', headers: { cookie: staff } });
    expect(String(tried.headers['location'] ?? '')).not.toContain('tiktok.com');
  });

  it('START: TikTok\'s own authorization URL, with this browser\'s state and the consent screen never skipped', async () => {
    const start = await app.inject({ method: 'GET', url: '/app/connect/tiktok/start', headers: { cookie: owner } });
    const to = new URL(String(start.headers['location']));
    expect(to.origin).toBe('https://www.tiktok.com');
    expect(to.searchParams.get('disable_auto_auth')).toBe('1');
    expect(to.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(cookiesOf(start).some((c) => c.startsWith('yf_tiktok='))).toBe(true);
  });

  it('a callback that is not this browser\'s connects nothing', async () => {
    expect(await notice(await connect(`oid-${RUN}-a`, { nonce: 'someone-elses-state' }))).toContain('Connect again');
    expect(await live()).toBeNull();
  });

  it('A CONSENT MISSING A MESSAGING PERMISSION is refused, and the grant just given is given straight back', async () => {
    tt.grant('user.info.basic,message.list.read');
    const revokedBefore = tt.revoked();
    expect(await notice(await connect(`oid-${RUN}-few`))).toContain('every permission TikTok asked about is needed');
    expect(await live()).toBeNull();
    expect(tt.revoked()).toBe(revokedBefore + 1);
    expect(tt.live(`oid-${RUN}-few`)).toBe(false);
    tt.grant(ALL_SCOPES);
  });

  it('CONNECTED: the grant sealed, never as it came; the account routes to this business; the screen says so', async () => {
    const openId = `oid-${RUN}-main`;
    expect(await notice(await connect(openId))).toContain('TikTok is connected.');
    expect((await live())?.open_id).toBe(openId);
    expect(await routed(openId)).toBe(BIZ);
    const sealed = (await admin.query(`select token_ciphertext as c from tiktok_accounts where open_id = $1 and archived_at is null`, [openId])).rows[0].c as string;
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('act.');
    expect(sealed).not.toContain('rft.');
    const page = await screen();
    expect(page).toContain('Connected');
    expect(page).toContain('action="/app/connect/tiktok/disconnect"');
  });

  it('AN ACCOUNT ANOTHER WORKSPACE HOLDS is refused, and the new grant given back', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { connectTikTokAccount, linkTikTokCredential } = await import('../../src/db/tiktokAccounts.js');
    const taken = `oid-${RUN}-taken`;
    await withTenantTx(db, OTHER as never, async (tx) => {
      const s = await connectTikTokAccount(tx, OTHER as never, { openId: taken, username: '', ciphertext: 'v1.x', fingerprint: '0123456789ab', scopes: ALL_SCOPES, by: 'other' });
      if (!s.ok) throw new Error('fixture');
      await linkTikTokCredential(tx, OTHER as never, { accountId: s.id, openId: taken, actor: 'other' });
    });
    const before = tt.revoked();
    expect(await notice(await connect(taken))).toContain('connected to another workspace');
    expect(tt.revoked()).toBe(before + 1);
    expect(await routed(taken)).toBe(OTHER);
    expect((await live())?.open_id).toBe(`oid-${RUN}-main`);   // hers is untouched
  });

  it('DISCONNECT gives the grant back at TikTok and switches the routing off; TikTok not answering is said, and the account still goes here', async () => {
    const openId = `oid-${RUN}-main`;
    expect(await notice(await app.inject({ method: 'POST', url: '/app/connect/tiktok/disconnect', headers: { cookie: owner } })))
      .toContain('TikTok is disconnected, and Nomi');
    expect(tt.live(openId)).toBe(false);
    expect(await live()).toBeNull();
    expect(await routed(openId)).toBeNull();
    // connected again, then disconnected while TikTok's revoke does not answer
    expect(await notice(await connect(openId))).toContain('TikTok is connected.');
    tt.revokeDown();
    expect(await notice(await app.inject({ method: 'POST', url: '/app/connect/tiktok/disconnect', headers: { cookie: owner } })))
      .toContain('TikTok did not confirm');
    expect(await live()).toBeNull();
    expect(await routed(openId)).toBeNull();
    tt.revokeDown(false);
  });

  it('A PRACTICE COPY holds no TikTok account: the database refuses it', async () => {
    const copy = `72720000-0000-4000-8000-${RUN}0009`;
    await admin.query(`insert into businesses (id, name, engine, practice_of) values ($1, 'copy', 'service', $2)`, [copy, BIZ]);
    const tried = await admin.query(`insert into tiktok_accounts (business_id, open_id, token_ciphertext, fingerprint, scopes, connected_by)
      values ($1, 'oid-practice-copy', 'v1.x', '0123456789ab', '', 'x')`, [copy]).then(() => 'written', (e: { code?: string }) => e.code);
    expect(tried).toBe('42501');
    void sql;
  });
});
