import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import pg from 'pg';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { flashSaid } from './tenant.js';

/**
 * S1 (Phase 5, item 18) — the done-criterion (PHASE-5.md §4): "Insert, edit and send go through every owner-reply
 * guard. Five languages." Over Postgres and the real routes:
 *
 *   - a saved reply is put in the reply box, after what was typed, in the buyer's language — and NOTHING is sent;
 *   - the box's words go by the owner's reply, and only so: sent where the window is open; refused and KEPT where it is
 *     shut (CC-24); refused while the workspace is frozen, the box untouched;
 *   - whoever answers buyers keeps them (owner, staff); the accountant is refused by the route and by the database,
 *     which shows them no row (0195, 0177's policy) — the check past the route guard that every block owes (DZ).
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `51510000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('S1 · saved replies, through every owner-reply guard (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: Db;
  let admin: pg.Client;
  let app: import('fastify').FastifyInstance;
  let owner = '';
  let staff = '';
  let accountant = '';
  let accountantId = '';
  let open = '';
  let shut = '';
  const drove: string[] = [];

  const tx = async <R>(fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const post = (url: string, fields: Record<string, string> = {}, who = owner) =>
    app.inject({ method: 'POST', url, headers: { cookie: who, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const page = async (url: string, who = owner) => (await app.inject({ method: 'GET', url, headers: { cookie: who } })).body;
  const replyBox = (html: string) => /<textarea name="text"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? null;
  const kept = (conv: string) => tx((x) => sql<{ t: string | null }>`select owner_unsent_reply as t from conversations where id = ${conv}::uuid`
    .execute(x).then((q) => q.rows[0]!.t));
  const idOf = (title: string) => tx((x) => sql<{ id: string }>`select id::text as id from saved_replies where title = ${title} and archived_at is null`
    .execute(x).then((q) => q.rows[0]!.id));
  const count = () => admin.query(`select count(*)::int as n from saved_replies where business_id = $1`, [BIZ]).then((r) => r.rows[0].n as number);

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    // a workspace that signed itself up: billed, so a lapse freezes it (billing_held, 0117)
    await admin.query(`insert into businesses (id, name, owner_locale, signed_up_at) values ($1, 'Saved Replies', 'en', now())`, [BIZ]);
    await tx(async (x) => {
      const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
                values (${BIZ}, 'instagram', ${`ig-saved-${RUN}`}, 'saved-secret', 'service', true)`.execute(x);
      const o = await ensureConversation(x, b.value, `ig-open-${RUN}`, 'Open Window', 'instagram');
      const s = await ensureConversation(x, b.value, `ig-shut-${RUN}`, 'Shut Window', 'instagram');
      open = o.conversationId; shut = s.conversationId;
      await sql`update client_channels set last_inbound_at = now() - interval '1 minute' where client_id = ${o.clientId}`.execute(x);
      await sql`update client_channels set last_inbound_at = now() - interval '2 days' where client_id = ${s.clientId}`.execute(x);
      // the buyer in the open window writes in French; the other's language is not known
      await sql`update clients set preferred_language = 'fr' where id = ${o.clientId}`.execute(x);
    });
    app = Fastify({ logger: false });
    const code = `saved-${RUN}`;
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: true,
      kickOutbound: async () => {}, kickDrive: async (_b: string, c: string) => { drove.push(c); },
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

  it('KEPT by whoever answers buyers: added in several languages, a title once; the accountant refused by the route AND the database', async () => {
    expect(flashSaid(await post('/app/replies', { title: 'Prices', text_en: 'Our prices are on the list attached.', text_fr: 'Nos prix sont dans la liste jointe.' }), SECRET))
      .toBe('Saved reply added.');
    expect(flashSaid(await post('/app/replies', { title: 'prices ', text_en: 'Twice.' }), SECRET)).toContain('Another saved reply already has this title.');
    expect(flashSaid(await post('/app/replies', { title: 'Empty' }), SECRET)).toContain('Words in at least one language.');
    // staff keep them too
    expect(flashSaid(await post('/app/replies', { title: 'Lead time', text_en: 'Shipping takes 12 days from the order.' }, staff), SECRET)).toBe('Saved reply added.');
    expect(await page('/app/replies', staff)).toContain('Lead time');
    // the accountant: the route sends them to the books, nothing written
    const before = await count();
    const r = await post('/app/replies', { title: 'Theirs', text_en: 'No.' }, accountant);
    expect(r.statusCode).toBe(302);
    expect(String(r.headers['location'])).toBe('/app/books');
    expect(await count()).toBe(before);
    // …and past the route: the database shows them no row, and takes none
    const { withTenantTx } = await import('../../src/db/client.js');
    const { asViewer } = await import('../../src/db/viewer.js');
    const seen = await asViewer(accountantId, () => withTenantTx(db, BIZ as never, (x) =>
      sql<{ n: number }>`select count(*)::int as n from saved_replies`.execute(x).then((q) => q.rows[0]!.n)));
    expect(seen).toBe(0);
    await expect(asViewer(accountantId, () => withTenantTx(db, BIZ as never, (x) =>
      sql`insert into saved_replies (business_id, title, texts, created_by) values (${BIZ}::uuid, 'Theirs', '{"en":"No."}'::jsonb, 'acct')`.execute(x))))
      .rejects.toThrow(/row-level security/);
    expect(await count()).toBe(before);
    // the database's own shape: a language it does not keep, or words of nothing, are refused there too
    await expect(tx((x) => sql`insert into saved_replies (business_id, title, texts, created_by) values (${BIZ}::uuid, 'Odd', '{"de":"Hallo"}'::jsonb, 'x')`.execute(x)))
      .rejects.toThrow(/saved_replies_texts_check|check constraint/);
  });

  it('INSERT: in the box, after what was typed, in the buyer\'s language — and nothing is sent', async () => {
    await post(`/app/inbox/${open}/takeover`);
    const html = await page(`/app/inbox/${open}`);
    expect(html).toContain(`formaction="/app/inbox/${open}/saved-reply" formnovalidate`);
    expect(html).toMatch(/<option value="[0-9a-f-]+">Lead time<\/option><option value="[0-9a-f-]+">Prices<\/option>/);
    const r = await post(`/app/inbox/${open}/saved-reply`, { text: 'Bonjour,', saved: await idOf('Prices') });
    expect(flashSaid(r, SECRET)).toBe('The saved reply is in the box. Read it, change what you like, then send.');
    expect(await kept(open)).toBe('Bonjour,\n\nNos prix sont dans la liste jointe.');
    expect(replyBox(await page(`/app/inbox/${open}`))).toBe('Bonjour,\n\nNos prix sont dans la liste jointe.');
    expect(drove).toEqual([]);
  });

  it('SEND: the box goes by the owner\'s reply — where the window is open it is sent, and the box is empty again', async () => {
    const box = replyBox(await page(`/app/inbox/${open}`))!;
    await post(`/app/inbox/${open}/reply`, { text: `${box} À bientôt.` });
    expect(drove).toEqual([open]);
    expect(await kept(open)).toBeNull();
    // queued by the one send path, as the owner's own (origin 'owner'), with the person's edit in it
    const sent = await tx((x) => sql<{ t: string }>`select body as t from outbound_messages where conversation_id = ${open}::uuid and origin = 'owner'
      order by created_at desc limit 1`.execute(x).then((q) => q.rows[0]?.t ?? ''));
    expect(sent).toBe('Bonjour,\n\nNos prix sont dans la liste jointe. À bientôt.');
  });

  it('A SHUT WINDOW: the inserted words are refused by the reply\'s own guard, and KEPT in the box (CC-24); the person\'s locale where the buyer\'s is unknown', async () => {
    await post(`/app/inbox/${shut}/takeover`);
    await post(`/app/inbox/${shut}/saved-reply`, { text: '', saved: await idOf('Prices') });
    expect(await kept(shut)).toBe('Our prices are on the list attached.');
    const r = await post(`/app/inbox/${shut}/reply`, { text: 'Our prices are on the list attached.' });
    expect(r.statusCode).toBe(302);
    expect(drove).toEqual([open]);
    expect(await kept(shut)).toBe('Our prices are on the list attached.');
  });

  it('FROZEN: neither putting a saved reply in the box nor sending it is taken; the box is left as it was', async () => {
    await admin.query(`insert into workspace_billing (business_id, status, lapsed_at) values ($1, 'lapsed', now())
      on conflict (business_id) do update set status = 'lapsed', lapsed_at = now()`, [BIZ]);
    try {
      await post(`/app/inbox/${open}/saved-reply`, { text: 'Typed while frozen', saved: await idOf('Prices') });
      expect(await kept(open)).toBeNull();
      await post(`/app/inbox/${open}/reply`, { text: 'Sent while frozen?' });
      expect(drove).toEqual([open]);
    } finally {
      await admin.query(`update workspace_billing set status = 'active', lapsed_at = null where business_id = $1`, [BIZ]);
    }
  });

  it('ARCHIVED: never offered, never put in a box; back in use only while no other one in use has its title; this page sends nothing', async () => {
    const id = await idOf('Lead time');
    expect(flashSaid(await post(`/app/replies/${id}/archive`), SECRET)).toBe('Archived. It stays in the list below.');
    expect(await page(`/app/inbox/${open}`)).not.toContain('>Lead time</option>');
    expect(flashSaid(await post(`/app/inbox/${open}/saved-reply`, { text: '', saved: id }), SECRET)).toBe('Nothing was put in the box.');
    await post('/app/replies', { title: 'Lead time', text_en: 'Twelve days.' });
    expect(flashSaid(await post(`/app/replies/${id}/restore`), SECRET)).toContain('another one in use has the same title');
    const list = await page('/app/replies');
    expect(list).not.toMatch(/action="\/app\/inbox\/[^"]*\/(reply|saved-reply)"/);
    // changed: its words in a language added
    const prices = await idOf('Prices');
    expect(flashSaid(await post(`/app/replies/${prices}`, { title: 'Prices', text_en: 'Our prices are on the list attached.', text_ar: 'الأسعار في القائمة المرفقة.' }), SECRET)).toBe('Saved.');
    expect(await tx((x) => sql<{ t: Record<string, string> }>`select texts as t from saved_replies where id = ${prices}::uuid`.execute(x).then((q) => q.rows[0]!.t)))
      .toEqual({ en: 'Our prices are on the list attached.', ar: 'الأسعار في القائمة المرفقة.' });
  });
});
