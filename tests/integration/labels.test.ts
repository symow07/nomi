import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import pg from 'pg';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { flashSaid } from './tenant.js';

/**
 * S2 (Phase 5, item 19) — the done-criterion (PHASE-5.md §4): labels "filter and search on Buyers, and are erased
 * with the buyer" (the erasure: tests/integration/erase-buyer.test.ts runs the tool for real and finds a buyer's label
 * gone and the next buyer's kept). Here, over Postgres and the real routes: put on from the buyer's panel, by name; a
 * narrowing of Buyers and a word its search finds; taken off and archived, never deleted; owner and staff; the
 * accountant refused by the route and by the database, which shows them no row (DZ, in this block).
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `52520000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('S2 · labels on buyers (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: Db;
  let admin: pg.Client;
  let app: import('fastify').FastifyInstance;
  let owner = '';
  let staff = '';
  let accountant = '';
  let accountantId = '';
  const buyer: Record<'amal' | 'bilal' | 'chen', { client: string; conv: string }> = {} as never;

  const tx = async <R>(fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const post = (url: string, fields: Record<string, string> = {}, who = owner) =>
    app.inject({ method: 'POST', url, headers: { cookie: who, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const get = async (url: string, who = owner) => (await app.inject({ method: 'GET', url, headers: { cookie: who } })).body;
  const put = (who: keyof typeof buyer, name: string, as = owner) => post(`/app/buyers/${buyer[who].client}/labels`, { name, back: buyer[who].conv }, as);
  const labelId = (name: string) => tx((x) => sql<{ id: string }>`select id::text as id from labels where lower(name) = lower(${name}) and archived_at is null`
    .execute(x).then((q) => q.rows[0]!.id));
  /** The buyers a Buyers page lists, by name. */
  const listed = async (url: string) => {
    const html = await get(url);
    return ['Amal', 'Bilal', 'Chen'].filter((n) => html.includes(`${n} ${RUN}`));
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, 'Labels', 'en')`, [BIZ]);
    await tx(async (x) => {
      const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
      for (const n of ['amal', 'bilal', 'chen'] as const) {
        const c = await ensureConversation(x, b.value, `ig-${n}-${RUN}`, `${n[0]!.toUpperCase()}${n.slice(1)} ${RUN}`, 'instagram');
        buyer[n] = { client: c.clientId, conv: c.conversationId };
        await sql`insert into messages (conversation_id, direction, text_content) values (${c.conversationId}::uuid, 'inbound', ${`hello from ${n}`})`.execute(x);
      }
    });
    app = Fastify({ logger: false });
    const code = `labels-${RUN}`;
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = async (c: string) => String((await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(c)}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    owner = await login(code);
    const st = await addPerson(db, BIZ, SECRET, `Staff ${RUN}`, 'team');
    const ac = await addPerson(db, BIZ, SECRET, `Accountant ${RUN}`, 'accountant');
    if (st.code !== 'added' || ac.code !== 'added') throw new Error('fixture');
    staff = await login(st.accessCode);
    accountant = await login(ac.accessCode);
    accountantId = (await admin.query(`select id::text as id from people where business_id = $1 and kind = 'accountant'`, [BIZ])).rows[0].id;
  }, 60_000);
  afterAll(async () => {
    await app?.close(); await db?.destroy();
    await admin?.query(`delete from businesses where id = $1`, [BIZ]).catch(() => {});
    await admin?.end();
  });

  it('PUT ON from the buyer\'s panel, by name: a new label, or the one in use of that name whatever its capitals; staff too', async () => {
    const r = await put('amal', '  Wholesale ');
    expect(flashSaid(r, SECRET)).toBe('Wholesale is on this buyer.');
    expect(String(r.headers['location'])).toBe(`/app/inbox/${buyer.amal.conv}#labels`);
    expect(flashSaid(await put('amal', 'WHOLESALE'), SECRET)).toBe('Wholesale was already on this buyer.');
    expect(flashSaid(await put('bilal', 'wholesale', staff), SECRET)).toBe('Wholesale is on this buyer.');
    expect(flashSaid(await put('bilal', 'Dubai fair', staff), SECRET)).toBe('Dubai fair is on this buyer.');
    expect(flashSaid(await put('chen', 'x'.repeat(41)), SECRET)).toContain('A label of 1 to 40 characters');
    expect(await tx((x) => sql<{ n: number }>`select count(*)::int as n from labels`.execute(x).then((q) => q.rows[0]!.n))).toBe(2);
    const panel = await get(`/app/inbox/${buyer.amal.conv}`);
    expect(panel).toContain('id="labels"');
    expect(panel).toMatch(/<li class="label-on"><bdi>Wholesale<\/bdi>/);
    expect(panel).toContain('<option value="Dubai fair"></option>');
  });

  it('FILTER: a label narrows Buyers to the buyers carrying it; the row stays as it is (decision 5)', async () => {
    const wholesale = await labelId('wholesale');
    expect(await listed('/app/inbox?filter=all')).toEqual(['Amal', 'Bilal', 'Chen']);
    expect(await listed(`/app/inbox?filter=all&label=${wholesale}`)).toEqual(['Amal', 'Bilal']);
    expect(await listed(`/app/inbox?filter=all&label=${await labelId('dubai fair')}`)).toEqual(['Bilal']);
    const page = await get('/app/inbox?filter=all');
    expect(page).toMatch(/<nav class="tabs labels"[^>]*>.*Wholesale.*\(2\)/s);
    // a label is not drawn on the row: the row is name, last message, time
    expect(page).not.toContain('class="label-on"');
    // an id that is no label is no narrowing
    expect(await listed('/app/inbox?filter=all&label=00000000-0000-4000-8000-000000000000')).toEqual(['Amal', 'Bilal', 'Chen']);
  });

  it('SEARCH: the search finds a buyer by a label they carry', async () => {
    expect(await listed('/app/inbox?q=dubai')).toEqual(['Bilal']);
    expect(await listed('/app/inbox?q=wholesale')).toEqual(['Amal', 'Bilal']);
  });

  it('TAKEN OFF and ARCHIVED: the row stays, marked; never deleted; an archived label narrows nothing (a link to it is the whole list) and is found by no search', async () => {
    const wholesale = await labelId('wholesale');
    expect(flashSaid(await post(`/app/buyers/${buyer.bilal.client}/labels/${wholesale}/off`, { back: buyer.bilal.conv }), SECRET)).toBe('Taken off.');
    expect(await listed(`/app/inbox?filter=all&label=${wholesale}`)).toEqual(['Amal']);
    const kept = await tx((x) => sql<{ removed: boolean }>`select removed_at is not null as removed from buyer_labels where client_id = ${buyer.bilal.client}::uuid and label_id = ${wholesale}::uuid`
      .execute(x).then((q) => q.rows));
    expect(kept).toEqual([{ removed: true }]);
    // put on again: a new row, the old one kept
    await put('bilal', 'Wholesale');
    expect(await tx((x) => sql<{ n: number }>`select count(*)::int as n from buyer_labels where client_id = ${buyer.bilal.client}::uuid and label_id = ${wholesale}::uuid`
      .execute(x).then((q) => q.rows[0]!.n))).toBe(2);
    expect(flashSaid(await post(`/app/labels/${wholesale}/archive`), SECRET)).toBe('Archived.');
    expect(await listed(`/app/inbox?filter=all&label=${wholesale}`)).toEqual(['Amal', 'Bilal', 'Chen']);
    const labelsNav = /<nav class="tabs labels"[\s\S]*?<\/nav>/.exec(await get(`/app/inbox?filter=all&label=${wholesale}`))?.[0] ?? '';
    expect(labelsNav).not.toContain('aria-current');
    expect(await listed('/app/inbox?q=wholesale')).toEqual([]);
    expect(await get(`/app/inbox/${buyer.amal.conv}`)).not.toMatch(/<li class="label-on"><bdi>Wholesale/);
    // a new "Wholesale" while the old one is archived: the old one cannot come back under the same name
    await put('chen', 'Wholesale');
    expect(flashSaid(await post(`/app/labels/${wholesale}/restore`), SECRET)).toContain('another label in use has the same name');
    // the database never lets a label be moved to another buyer, or one taken off be put back on in place
    await expect(tx((x) => sql`update buyer_labels set client_id = ${buyer.chen.client}::uuid where client_id = ${buyer.amal.client}::uuid`.execute(x)))
      .rejects.toThrow(/never moved/);
    await expect(tx((x) => sql`delete from buyer_labels`.execute(x))).rejects.toThrow(/permission denied/);
  });

  it('THE ACCOUNTANT: refused by the route, and past it the database shows no label and takes none', async () => {
    const r = await post(`/app/buyers/${buyer.chen.client}/labels`, { name: 'Theirs', back: buyer.chen.conv }, accountant);
    expect(String(r.headers['location'])).toBe('/app/books');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { asViewer } = await import('../../src/db/viewer.js');
    const seen = await asViewer(accountantId, () => withTenantTx(db, BIZ as never, (x) =>
      sql<{ l: number; b: number }>`select (select count(*)::int from labels) as l, (select count(*)::int from buyer_labels) as b`.execute(x).then((q) => q.rows[0]!)));
    expect(seen).toEqual({ l: 0, b: 0 });
    await expect(asViewer(accountantId, () => withTenantTx(db, BIZ as never, (x) =>
      sql`insert into labels (business_id, name, created_by) values (${BIZ}::uuid, 'Theirs', 'acct')`.execute(x)))).rejects.toThrow(/row-level security/);
    expect(await tx((x) => sql<{ n: number }>`select count(*)::int as n from labels where name = 'Theirs'`.execute(x).then((q) => q.rows[0]!.n))).toBe(0);
  });
});
