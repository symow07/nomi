import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { flashSaid } from './tenant.js';

/**
 * 0082 — THE OWNER'S OWN DATES, over Postgres and the owner's routes (the
 * design pass, decided 2026-09-29): put one on the calendar and it is on the
 * week, dashed; take it off and it is archived, never deleted; another
 * business never sees it; and the app's role cannot delete one at all.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd7c0000-0000-4000-8000-${RUN}0004`;
const OTHER = `dd7c0000-0000-4000-8000-${RUN}0005`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('0082 · the owner\'s own dates (requires DATABASE_URL)', () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let cookie = '';

  const as = async <R>(biz: string, fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const post = (url: string, fields: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const page = async (url: string) => (await app.inject({ method: 'GET', url, headers: { cookie } })).body;
  const rows = () => as(BIZ, (x) => sql<{ id: string; title: string; all_day: boolean; removed_at: Date | null; created_by: string | null }>`
    select id::text as id, title, all_day, removed_at, created_by from calendar_entries order by created_at`.execute(x).then((r) => r.rows));

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    for (const [id, name, country] of [[BIZ, 'Hana Skincare', 'GB'], [OTHER, 'Someone Else', 'US']] as const) {
      await as(id, (x) => sql`insert into businesses (id, name, owner_locale, country) values (${id}, ${name}, 'en', ${country})
                             on conflict (id) do nothing`.execute(x));
    }
    app = Fastify({ logger: false });
    const code = `cal-${RUN}`;
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${code}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('the page opens on the week, Monday first for a business in the UK', async () => {
    const html = await page('/app/calendar');
    expect(html).toContain('<table class="wk">');
    expect(html).toContain('<a class="tab on" aria-current="page" href="/app/calendar?at=');
    const firstDay = /<thead><tr><th scope="col" class="wk-corner">[\s\S]*?<\/th><th scope="col"[^>]*><a href="\/app\/calendar\?view=day&amp;at=(\d{4}-\d{2}-\d{2})"/.exec(html)?.[1];
    expect(new Date(`${firstDay}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('a date put on the calendar is on the week, dashed, with its hours', async () => {
    const r = await post('/app/calendar/entries', { title: 'Photo shoot', day: '2031-03-05', from: '11:00', to: '13:00' });
    expect(flashSaid(r, SECRET)).toContain('Added to the calendar.');
    expect(r.headers['location']).toBe('/app/calendar?at=2031-03-05');
    const [row] = await rows();
    // who put it there, by person (G9b: an actor is an id, read as a name where shown)
    expect(row).toMatchObject({ title: 'Photo shoot', all_day: false, removed_at: null, created_by: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    const html = await page('/app/calendar?at=2031-03-05');
    expect(html).toContain(`<div class="wk-e dashed" data-src="calendar_entries:${row!.id}"`);
    expect(html).toContain('<b><bdi>Photo shoot</bdi></b><span class="wk-t">11:00–13:00</span>');
    // and in the list, under "Your dates"
    const list = await page('/app/calendar?view=list&from=2031-03-01');
    expect(list).toContain(`<li class="row dashed" data-src="calendar_entries:${row!.id}"`);
    expect(list).toContain('Your dates');
  });

  it('what cannot be kept honestly is not kept, and the owner is told why', async () => {
    const before = (await rows()).length;
    for (const [fields, said] of [
      [{ title: '', day: '2031-03-05' }, 'a date needs a name'],
      [{ title: 'Fair', day: '2031-02-30' }, 'that is not a date'],
      [{ title: 'Fair', day: '2031-03-05', from: '14:00', to: '10:00' }, 'it ends before it starts'],
    ] as const) {
      expect(flashSaid(await post('/app/calendar/entries', fields), SECRET)).toContain(said);
    }
    expect(await rows()).toHaveLength(before);
  });

  it('another business never sees it, and cannot take it off', async () => {
    const [row] = await rows();
    const seen = await as(OTHER, (x) => sql<{ n: number }>`select count(*)::int as n from calendar_entries where id = ${row!.id}::uuid`
      .execute(x).then((r) => r.rows[0]!.n));
    expect(seen).toBe(0);
    const touched = await as(OTHER, (x) => sql`update calendar_entries set removed_at = now() where id = ${row!.id}::uuid`.execute(x));
    expect(Number(touched.numAffectedRows ?? 0)).toBe(0);
  });

  it('taking it off archives it: gone from the week, still a row; a second time finds nothing', async () => {
    const [row] = await rows();
    expect(flashSaid(await post(`/app/calendar/entries/${row!.id}/remove`), SECRET)).toContain('Taken off the calendar.');
    const [after] = await rows();
    expect(after!.removed_at).not.toBeNull();
    expect(await page('/app/calendar?at=2031-03-05')).not.toContain(`calendar_entries:${row!.id}`);
    expect(flashSaid(await post(`/app/calendar/entries/${row!.id}/remove`), SECRET)).toContain('that date is not on the calendar');
    expect(flashSaid(await post('/app/calendar/entries/not-an-id/remove'), SECRET)).toContain('that date is not on the calendar');
  });

  it('the app\'s role may not delete a date — only archive it', async () => {
    await expect(as(BIZ, (x) => sql`delete from calendar_entries`.execute(x))).rejects.toThrow(/permission denied/);
  });
});
