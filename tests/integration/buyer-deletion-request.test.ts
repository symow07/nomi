import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { seedRunTenant, flashSaid } from './tenant.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { formatDate } from '../../src/core/owner/i18n/format.js';
import { deletionDueBy } from '../../src/core/ops/deletions.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * CC-02a — A BUYER'S DELETION REQUEST CAN BE MADE, AND ITS DEADLINE IS KEPT.
 *
 * 0126 — since the owner deletes at once (tests/integration/customer-erasure
 * .test.ts), a request is recorded and carried out in one act. What this file
 * still holds is the operator's safety net for a request that stays OPEN (one
 * recorded before 0126, or the installation's own workspace's): it is listed
 * on Your data, can be taken back, says when it was done, and the daily check
 * tells the operator as its 30 days near. The old "record it" route answers
 * that deleting is one step now, and writes nothing.
 *
 * /data-deletion promised every buyer that "a person at the business" removes
 * their records within 30 days and tells them "on the same channel", while
 * nothing could record a buyer's request, nothing counted the days and nothing
 * told anyone. The page now says: the business records it, Nomi's operator
 * carries it out within 30 days of that. This file proves the half of that
 * sentence the product owns, against real Postgres with row-level security on:
 *
 *   · the owner records it on the buyer's page — the row, the audit line, the
 *     operator's notice, and the page saying by when;
 *   · twice is once; a sales assistant is refused and nothing is written;
 *   · Your data lists it with its due date, takes it back, shows it done;
 *   · the daily check tells whoever runs the installation, by e-mail, ONE
 *     message — and nothing when nothing is due;
 *   · the definer function answers that question across tenants while the app
 *     role still cannot read another tenant's row.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const OTHER = `dd730000-0000-4000-8000-${RUN}0002`;
const OTHER_NAME = `Buyer Deletion Other ${RUN}`;
const BIZ_NAME = `Buyer Deletion Co ${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const LEGAL = 'privacy@nomi.test';
const NOTE = 'On WhatsApp, 27 September, from the number they write from';
const BUYER = `Omar Haddad ${RUN}`;
const DAY = 86_400_000;

d('CC-02a · a buyer\'s deletion request, and its deadline (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let BIZ = '';
  /**
   * The workspace's own zone, read back: since G2 (0100) a sign-up that names
   * none is born in UTC, and the dates hard-coded in Shanghai's differed from
   * the page's every day from 16:00 UTC (found 2026-10-01 on CI).
   */
  let ZONE = 'UTC';
  let CONV = '';
  let CLIENT = '';
  let OWNER_ID = '';
  let ownerCookie = '';
  let staffCookie = '';
  const CODE = `buyer-deletion-${RUN}`;
  const EMAIL = `owner-bdr-${RUN}@example.com`;

  /** What the route told the operator's address. */
  const notices: { to: string; subject: string; text: string }[] = [];
  /** What the operator alert sent. */
  const mailbox: { to: string; subject: string; text: string }[] = [];
  const texts: { to: string; body: string }[] = [];

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
  const ask = (cookie: string, note: string) =>
    post(cookie, `/app/conversations/${CONV}/deletion`, `note=${encodeURIComponent(note)}`);

  const requests = () => tx((t) => sql<{
    id: string; scope: string; client_id: string | null; asked_by: string; subject_note: string | null;
    state: string; asked_at: Date; closed_at: Date | null;
  }>`
    select id::text as id, scope, client_id::text as client_id, asked_by, subject_note, state, asked_at, closed_at
      from deletion_requests where business_id = ${BIZ} and scope = 'buyer' order by asked_at`
    .execute(t).then((r) => r.rows));
  const audits = () => tx((t) => sql<{ actor: string; detail: unknown }>`
    select actor, detail from channel_audit where business_id = ${BIZ} and action = 'deletion_requested'
     order by at`.execute(t).then((r) => r.rows));

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();

    // An earlier run of THIS file that failed before its own clean-up may have
    // left an aged request open, which would be "due" to every later run. Only
    // this file's own businesses, by the names it gives them.
    await admin.query(
      `update deletion_requests set state = 'withdrawn', closed_at = now(), closed_by = 'test-cleanup'
        where state = 'open' and business_id in (
          select id from businesses where name like 'Buyer Deletion Co %' or name like 'Buyer Deletion Other %')`);

    // The installation's own workspace — the one whose owner the operator
    // alert goes to — made the way sign-up makes one, so it has a sign-in
    // address and an owner person.
    const r = await provisionAccount(db, {
      factory: BIZ_NAME, language: 'en', ownerName: 'Owner', email: EMAIL,
      passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
      profile: { kind: 'retail', sells: 'tote bags', country: 'AE', website: null, teamSize: '1', channels: [] },
    });
    if (r.code !== 'created') throw new Error(`provision: ${r.code}`);
    BIZ = r.businessId;
    OWNER_ID = r.personId;
    ZONE = (await admin.query(`select timezone from businesses where id = $1`, [BIZ])).rows[0].timezone;

    await tx(async (t) => {
      CLIENT = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+9715${RUN}`}, ${BUYER}) returning id::text as id`.execute(t)).rows[0]!.id;
      CONV = (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${BIZ}, ${CLIENT}::uuid, 'whatsapp', 'warm_intake') returning id::text as id`.execute(t)).rows[0]!.id;
      await sql`insert into messages (conversation_id, direction, text_content, sent_at)
                values (${CONV}::uuid, 'inbound', 'Please delete everything you have about me.', now())`.execute(t);
    });

    // A SECOND business, with a buyer of its own: its request is the one the
    // daily check must see and this business's owner must never read.
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${OTHER}, ${OTHER_NAME}) on conflict (id) do nothing`.execute(t);
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
      legalContact: LEGAL,
      systemMail: {
        from: 'nomi@nomi.test',
        send: async (m: { to: string; subject: string; text: string }) => { notices.push(m); return { ok: true as const }; },
      },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    ownerCookie = await login(CODE);
    expect(ownerCookie).not.toBe('');

    const added = await post(ownerCookie, '/app/settings/people', 'name=Xiao%20Chen');
    const issued = String(added.headers['set-cookie'] ?? '').split(';')[0]!;
    const people = await app.inject({
      method: 'GET', url: String(added.headers['location']),
      headers: { cookie: `${ownerCookie}; ${issued}` },
    });
    const code = people.body.match(/<p class="code"><bdi>([A-Z2-9]{5}-[A-Z2-9]{5})<\/bdi><\/p>/)?.[1] ?? '';
    if (code) staffCookie = await login(code);
  }, 60_000);

  afterAll(async () => {
    // Nothing this file opened is left open: an aged request left behind
    // would be "due" to every later run on this database.
    await admin?.query(
      `update deletion_requests set state = 'withdrawn', closed_at = now(), closed_by = 'test-cleanup'
        where state = 'open' and business_id in ($1::uuid, $2::uuid)`, [BIZ || OTHER, OTHER]).catch(() => undefined);
    await app?.close(); await db?.destroy(); await admin?.end();
  });

  /** A request as one recorded before 0126 is: open, by the owner, with a note. */
  const openRequest = async (note = NOTE) => (await admin.query(
    `insert into deletion_requests (business_id, scope, client_id, asked_by, subject_note) values ($1, 'buyer', $2, $3, $4) returning id::text as id`,
    [BIZ, CLIENT, OWNER_ID, note])).rows[0].id as string;

  it('the old "record it" route answers that deleting is one step now — and writes nothing', async () => {
    const res = await ask(ownerCookie, NOTE);
    expect(res.statusCode).toBe(302);
    expect(String(res.headers['location'])).toBe(`/app/conversations/${CONV}#deletion`);
    expect(flashSaid(res, SECRET)).toBe(t('en', 'conv.deletion.flash.moved'));
    expect(await requests()).toEqual([]);
    expect(await audits()).toEqual([]);
    // A member of staff is refused before that, with the owner's sentence.
    expect(flashSaid(await ask(staffCookie, NOTE), SECRET)).toBe(t('en', 'staff.notAllowed'));
    // The owner's page offers the one act instead; staff see whose decision it is.
    expect((await get(ownerCookie, `/app/conversations/${CONV}`)).body).toContain(`action="/app/conversations/${CONV}/deletion/erase"`);
    expect((await get(staffCookie, `/app/conversations/${CONV}`)).body).not.toContain('/deletion/erase');
  });

  it('asking twice is ONE request — 0073\'s index holds it', async () => {
    const id = await openRequest();
    await expect(admin.query(
      `insert into deletion_requests (business_id, scope, client_id, asked_by, subject_note)
       values ($1, 'buyer', $2, 'owner', 'race')`, [BIZ, CLIENT])).rejects.toThrow(/deletion_requests_one_open_buyer/);
    await admin.query(`update deletion_requests set state = 'withdrawn', closed_at = now(), closed_by = 'test' where id = $1`, [id]);
  });

  it('an open request is on Your data — deleted from there, or taken back while it waits', async () => {
    const id = await openRequest();
    const row = (await requests()).find((r) => r.id === id)!;
    const page = (await get(ownerCookie, '/app/settings/data')).body;
    expect(page).toContain(t('en', 'data.buyers.title'));
    expect(page).toContain(BUYER);
    expect(page).toContain(t('en', 'data.buyers.open', { asked: formatDate('en', row.asked_at, ZONE) }));
    expect(page).toContain(`name="id" value="${row.id}"`);
    expect(page).toContain(`action="/app/conversations/${CONV}/deletion/erase"`);

    const back = await post(ownerCookie, '/app/settings/data/withdraw', `id=${row.id}`);
    expect(flashSaid(back, SECRET)).toBe(t('en', 'data.flash.withdrawn'));
    expect((await requests()).find((r) => r.id === row.id)!.state).toBe('withdrawn');
  });

  it('when one was carried out, both pages say so, with the date', async () => {
    const id = await openRequest();
    const row = (await requests()).find((r) => r.id === id)!;
    // The operator's side (tools/erase-buyer.mjs) closes the row.
    const done = new Date(row.asked_at.getTime() + 3 * DAY);
    await admin.query(
      `update deletion_requests set state = 'done', closed_at = $2, closed_by = 'operator' where id = $1`, [row.id, done]);

    const data = (await get(ownerCookie, '/app/settings/data')).body;
    expect(data).toContain(t('en', 'data.buyers.done', {
      asked: formatDate('en', row.asked_at, ZONE), done: formatDate('en', done, ZONE),
    }));
    expect(data, 'a done request is not offered back').not.toContain(`name="id" value="${row.id}"`);
    const file = (await get(ownerCookie, `/app/conversations/${CONV}`)).body;
    expect(file).toContain(esc(t('en', 'conv.deletion.done', { date: formatDate('en', done, ZONE) })));
    expect(file).not.toContain(`action="/app/conversations/${CONV}/deletion/erase"`);
  });

  it('THE DAILY CHECK: a request 25 days old sends ONE e-mail, to the owner who runs the installation', async () => {
    const { deletionDueAlert } = await import('../../src/pipeline/deletionWatch.js');
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    const otherClient = (await admin.query(
      'select id::text as id from clients where business_id = $1 limit 1', [OTHER])).rows[0].id as string;
    const asked = new Date(Date.now() - 25 * DAY);
    await admin.query(
      `insert into deletion_requests (business_id, scope, client_id, asked_by, subject_note, asked_at)
       values ($1, 'buyer', $2, 'owner', 'asked by e-mail', $3)`, [OTHER, otherClient, asked]);

    const job = await deletionDueAlert(db, BIZ, new Date());
    expect(job, 'a request five days from its deadline was not due').not.toBeNull();
    expect(job!.kind).toBe('deletion_due');
    expect(job!.businessId).toBe(BIZ);
    const theirs = job!.deletionsDue!.filter((x) => x.business === OTHER_NAME);
    expect(theirs).toEqual([{ business: OTHER_NAME, scope: 'buyer', askedAt: asked.toISOString(), overdue: false }]);
    expect(JSON.stringify(job), 'a note travelled in the job').not.toContain('asked by e-mail');

    mailbox.length = 0; texts.length = 0;
    const mail = { from: 'nomi@nomi.test', send: async (m: { to: string; subject: string; text: string }) => { mailbox.push(m); return { ok: true as const }; } };
    const adapter = { sendText: async (to: string, body: string) => { texts.push({ to, body }); return { ok: true as const, providerMessageId: 'x' }; } };
    expect(await deliverOwnerAlert({ db, adapter, mail }, job!)).toBe('sent');
    expect(mailbox).toHaveLength(1);
    expect(mailbox[0]!.to).toBe(EMAIL);
    expect(mailbox[0]!.subject).toBe(t('en', 'notify.deletion_due.subject'));
    expect(mailbox[0]!.text).toContain(OTHER_NAME);
    expect(mailbox[0]!.text).toContain(t('en', 'notify.deletion_due.soon', {
      business: OTHER_NAME, what: t('en', 'data.deletion.scope.buyer'),
      asked: formatDate('en', asked, ZONE), due: formatDate('en', deletionDueBy(asked), ZONE),
    }));
    // No channel is live here: e-mail only, as the backup alert.
    expect(texts).toHaveLength(0);
  });

  it('the definer function answers across tenants; the app role still cannot read the other tenant\'s row', async () => {
    const { dueDeletionRequests } = await import('../../src/db/deletionRequests.js');
    const due = await dueDeletionRequests(db);
    expect(due.some((x) => x.business === OTHER_NAME), 'the check cannot see the other tenant\'s due request').toBe(true);

    // Inside this business's tenant: none of the other's rows, by any query.
    const leak = await tx((t) => sql<{ n: number }>`
      select count(*)::int as n from deletion_requests where business_id = ${OTHER}::uuid`.execute(t).then((r) => r.rows[0]!.n));
    expect(leak, 'RLS let one tenant read another\'s deletion request').toBe(0);
    // With no tenant bound at all: nothing either.
    const bare = await sql<{ n: number }>`select count(*)::int as n from deletion_requests`.execute(db);
    expect(bare.rows[0]!.n).toBe(0);
    // The function answers three things and no more — no id, no buyer, no note.
    const cols = await sql<Record<string, unknown>>`select * from deletion_requests_due() limit 1`.execute(db);
    expect(Object.keys(cols.rows[0] ?? {}).sort()).toEqual(['asked_at', 'business_name', 'scope']);
    // …and only the app role, never PUBLIC, may call it.
    const acl = (await admin.query(
      `select coalesce(proacl::text, '') as acl from pg_proc where proname = 'deletion_requests_due'`)).rows[0].acl as string;
    expect(acl).toContain('nomi_app=X');
    expect(acl, 'PUBLIC may execute the definer function').not.toMatch(/(^|[{,])=X/);
  });

  it('a request past its 30 days is named as late', async () => {
    const { deletionDueAlert } = await import('../../src/pipeline/deletionWatch.js');
    const asked = new Date(Date.now() - 31 * DAY);
    await admin.query(
      `insert into deletion_requests (business_id, scope, asked_by, asked_at) values ($1, 'workspace', 'owner', $2)`,
      [OTHER, asked]);
    const job = await deletionDueAlert(db, BIZ, new Date());
    const late = job!.deletionsDue!.find((x) => x.business === OTHER_NAME && x.scope === 'workspace');
    expect(late).toEqual({ business: OTHER_NAME, scope: 'workspace', askedAt: asked.toISOString(), overdue: true });
    const { renderOwnerAlert } = await import('../../src/pipeline/notify.js');
    // TZ — the dates are said in the reader's zone, handed in as the sender
    // does; without it they were UTC against a Shanghai expectation, and the
    // test failed every day from 16:00 UTC (found 2026-09-30).
    const text = renderOwnerAlert('en', 'deletion_due', null, {
      deletionsDue: [{ business: OTHER_NAME, scope: 'workspace', askedAt: asked, overdue: true }],
      zone: ZONE,
    });
    expect(text).toContain(t('en', 'notify.deletion_due.late', {
      business: OTHER_NAME, what: t('en', 'data.deletion.scope.workspace'),
      asked: formatDate('en', asked, ZONE), due: formatDate('en', deletionDueBy(asked), ZONE),
    }));
  });

  it('NOTHING DUE, NO E-MAIL: a fresh request, and closed old ones, are not due', async () => {
    const { deletionDueAlert } = await import('../../src/pipeline/deletionWatch.js');
    const { dueDeletionRequests } = await import('../../src/db/deletionRequests.js');
    // The aged requests are closed — one done, one taken back — and a fresh
    // one is waiting here, asked today.
    await admin.query(
      `update deletion_requests set state = 'done', closed_at = now(), closed_by = 'operator'
        where business_id = $1 and scope = 'buyer' and state = 'open'`, [OTHER]);
    await admin.query(
      `update deletion_requests set state = 'withdrawn', closed_at = now(), closed_by = 'owner'
        where business_id = $1 and scope = 'workspace' and state = 'open'`, [OTHER]);
    // (The one this file marked done above stands; a fresh request has no date near.)

    const due = await dueDeletionRequests(db);
    expect(due.filter((x) => x.business === OTHER_NAME || x.business === BIZ_NAME)).toEqual([]);
    // The check runs across the whole database, so another tenant's aged open
    // request would be (correctly) due here too. In CI the database is pruned
    // before each pass and nothing else ages a request; locally, a leftover is
    // leftover state — named, not mistaken for a regression.
    expect(due, `leftover state: open deletion requests from earlier runs are due — ${JSON.stringify(due)}`).toEqual([]);

    mailbox.length = 0;
    expect(await deletionDueAlert(db, BIZ, new Date()), 'an alert with nothing in it').toBeNull();
    expect(mailbox).toHaveLength(0);
  });
});
