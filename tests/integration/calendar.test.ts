import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { dayKey, dayStart, addDays } from '../../src/core/owner/i18n/format.js';

/**
 * V2 — the calendar, end to end.
 *
 * The renderer's shape is tests/parity/calendar.test.ts and
 * warmth-calendar.test.ts. Only Postgres can prove what matters here: that
 * every entry is a real row of the table it names, listed under its own day,
 * that a row outside the window or in ANOTHER tenant never appears, that a
 * category filter excludes exactly the other categories, that the buyer
 * filter narrows to one buyer, and that follow-ups exist only where the
 * outreach area is on.
 *
 * The owner's correction (2026-10-04): one screen, the month's grid and the
 * list together. What the screen can show of the seeded rows is read the way
 * an owner reads it: the list with nothing chosen (what is owed, then the
 * month's other dates), and the list of each seeded day, chosen in the grid.
 * The old views' addresses answer with a redirect to the same place.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd520000-0000-4000-8000-${RUN}0001`;
const OTHER = `dd520000-0000-4000-8000-${RUN}0002`;
const PROD = `dd520000-0000-4000-8000-${RUN}0003`;
const PROD2 = `dd520000-0000-4000-8000-${RUN}0004`;

const DAY = 86_400_000;

/** Which category each source table feeds. The page's chip is the renderer's; this is the data's. */
const CATEGORY_OF: Record<string, string> = {
  sample_requests: 'samples', order_updates: 'orders', orders: 'orders',
  quotes: 'negotiation', handoffs: 'negotiation', sequence_enrollments: 'followups',
  factory_closures: 'closures', conversations: 'conversations',
};

d('V2 · the calendar (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const CODE = 'calendar-test-code';

  /** Ids of what was seeded, by name. */
  const id: Record<string, string> = {};

  const as = async <T>(biz: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const one = async (t: import('../../src/db/client.js').Tx, q: import('kysely').RawBuilder<{ id: string }>): Promise<string> =>
    (await q.execute(t)).rows[0]!.id;

  const get = (url: string, locale?: string) => app.inject({
    method: 'GET', url, headers: { cookie: locale ? `${cookie}; yf_locale=${locale}` : cookie },
  });
  /** Every entry's provenance on a page: `table:id` → column. */
  const sources = (html: string): Map<string, string> =>
    new Map([...html.matchAll(/<li class="dl-row (?:solid|dashed)(?: done)?" data-src="([^"]+)" data-col="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
  /** The days the seeded rows near today fall on, in the business's zone (its default, Shanghai): each is chosen in turn. */
  const NEAR = [...new Set([-4, -3, -2, -1, 0, 1, 2, 3, 5, 6, 7].map((k) => dayKey(new Date(Date.now() + k * DAY), 'Asia/Shanghai')))];
  /** The pages an owner reads them on: the list with nothing chosen, and each of those days chosen; `extra` is a filter. */
  const pagesFor = async (extra = ''): Promise<{ url: string; day: string | null; body: string }[]> => {
    const amp = extra ? `&${extra}` : '';
    const out = [{ url: `/app/calendar${extra ? `?${extra}` : ''}`, day: null as string | null, body: '' }];
    for (const d of NEAR) out.push({ url: `/app/calendar?month=${d.slice(0, 7)}&day=${d}${amp}`, day: d, body: '' });
    for (const o of out) {
      const r = await get(o.url);
      expect(r.statusCode, o.url).toBe(200);
      o.body = r.body;
    }
    return out;
  };
  /** Everything those pages list: `table:id` → column. */
  const shown = async (extra = ''): Promise<Map<string, string>> =>
    new Map((await pagesFor(extra)).flatMap((p) => [...sources(p.body)]));
  const area = (on: boolean) => as(BIZ, (t) => sql`update businesses set outreach_area = ${on} where id = ${BIZ}::uuid`.execute(t));

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    const now = Date.now();
    const ago = (days: number) => new Date(now - days * DAY);

    await as(BIZ, async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Calendar Test Factory') on conflict (id) do nothing`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active)
                values (${PROD}, ${BIZ}, ${`CAL-${RUN}`}, 'Vacuum cup', 'pcs', 100, true) on conflict (id) do nothing`.execute(t);
      const client = (name: string, country: string, n: string) => one(t, sql<{ id: string }>`
        insert into clients (business_id, phone, display_name, country)
        values (${BIZ}, ${`+86139${RUN}${n}`}, ${name}, ${country}) returning id::text as id`);
      const conv = (c: string, closed: Date | null) => one(t, sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase, closed_at, is_active)
        values (${BIZ}, ${c}::uuid, 'whatsapp', ${closed ? 'closed' : 'warm_intake'}, ${closed}, ${closed === null})
        returning id::text as id`);
      id['ahmed'] = await client(`Ahmed ${RUN}`, 'AE', '1');
      id['olga'] = await client(`Olga ${RUN}`, 'RU', '2');
      id['chen'] = await client(`Chen ${RUN}`, 'CN', '3');
      id['convA'] = await conv(id['ahmed'], null);
      id['convB'] = await conv(id['olga'], null);
      id['convC'] = await conv(id['chen'], ago(4));            // closed in range
      id['convOld'] = await conv(id['chen'], ago(60));         // closed out of range

      // Samples: asked and handled in range; one long ago.
      id['sample'] = await one(t, sql<{ id: string }>`
        insert into sample_requests (business_id, conversation_id, asked_text, requested_at, handled_at, handled_by)
        values (${BIZ}, ${id['convA']}::uuid, 'can you send a sample?', ${ago(2)}, ${ago(1)}, 'owner') returning id::text as id`);
      id['sampleOld'] = await one(t, sql<{ id: string }>`
        insert into sample_requests (business_id, conversation_id, asked_text, requested_at, handled_at, handled_by)
        values (${BIZ}, ${id['convB']}::uuid, 'sample please', ${ago(40)}, ${ago(39)}, 'owner') returning id::text as id`);

      // Orders: B has a log (confirmed, shipped with a tracking reference);
      // A has none, so its confirmed_at stands in.
      const order = (conv: string, c: string, ref: string, at: Date) => one(t, sql<{ id: string }>`
        insert into orders (order_reference, business_id, client_id, conversation_id, product_id,
                            quantity, unit, agreed_unit_price_usd, total_value_usd, currency, status, confirmed_at)
        values (${ref}, ${BIZ}, ${c}::uuid, ${conv}::uuid, ${PROD}::uuid, 5000, 'pcs', 0.92, 4600, 'USD', 'confirmed', ${at})
        returning id::text as id`);
      id['orderB'] = await order(id['convB'], id['olga'], `CAL-${RUN}-B`, ago(3));
      id['orderA'] = await order(id['convA'], id['ahmed'], `CAL-${RUN}-A`, ago(2));
      id['updConfirmed'] = await one(t, sql<{ id: string }>`
        insert into order_updates (business_id, order_id, state, at, by_actor)
        values (${BIZ}, ${id['orderB']}::uuid, 'confirmed', ${ago(3)}, 'owner') returning id::text as id`);
      id['updShipped'] = await one(t, sql<{ id: string }>`
        insert into order_updates (business_id, order_id, state, tracking_reference, at, by_actor)
        values (${BIZ}, ${id['orderB']}::uuid, 'shipped', ${`SF${RUN}`}, ${ago(1)}, 'owner') returning id::text as id`);
      id['updPending'] = await one(t, sql<{ id: string }>`
        insert into order_updates (business_id, order_id, state, at, by_actor)
        values (${BIZ}, ${id['orderB']}::uuid, 'pending_confirmation', ${ago(3)}, 'engine') returning id::text as id`);

      // Quotes: the same figure twice in one afternoon is one line (the later
      // row); a different quantity is its own.
      const quote = (qty: number, price: number, at: Date) => one(t, sql<{ id: string }>`
        insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version, created_at)
        values (${BIZ}, ${id['convA']}::uuid, ${PROD}::uuid, ${qty}, ${'{}'}::jsonb, ${price}, ${qty * price}, 'test', ${at})
        returning id::text as id`);
      const base = dayStart(addDays(dayKey(ago(2), 'Asia/Shanghai'), 0), 'Asia/Shanghai').getTime() + 10 * 3_600_000;
      id['quoteEarly'] = await quote(1000, 0.5, new Date(base));
      id['quoteLate'] = await quote(1000, 0.5, new Date(base + 60_000));
      id['quoteOther'] = await quote(3000, 0.45, new Date(base + 120_000));

      // A reply owed (open) — and one already released, which owes nothing.
      id['handoff'] = await one(t, sql<{ id: string }>`
        insert into handoffs (business_id, conversation_id, reason, requested_at, sla_deadline_at)
        values (${BIZ}, ${id['convA']}::uuid, 'manual', ${ago(0)}, ${new Date(now + DAY)}) returning id::text as id`);
      id['handoffReleased'] = await one(t, sql<{ id: string }>`
        insert into handoffs (business_id, conversation_id, reason, requested_at, sla_deadline_at, released_at)
        values (${BIZ}, ${id['convB']}::uuid, 'manual', ${ago(2)}, ${ago(1)}, ${ago(1)}) returning id::text as id`);

      // Follow-ups: one live and due, one stopped.
      const seq = await one(t, sql<{ id: string }>`
        insert into sequences (business_id, name, created_by, approved_by, approved_at)
        values (${BIZ}, 'Autumn letters', 'owner', 'owner', now()) returning id::text as id`);
      id['enrol'] = await one(t, sql<{ id: string }>`
        insert into sequence_enrollments (business_id, sequence_id, identity, enrolled_by, next_due_at)
        values (${BIZ}, ${seq}::uuid, ${`buyer-${RUN}@example.com`}, 'owner', ${new Date(now + 3 * DAY)}) returning id::text as id`);
      id['enrolStopped'] = await one(t, sql<{ id: string }>`
        insert into sequence_enrollments (business_id, sequence_id, identity, enrolled_by, next_due_at, stopped_at, stop_reason)
        values (${BIZ}, ${seq}::uuid, ${`gone-${RUN}@example.com`}, 'owner', ${new Date(now + 2 * DAY)}, now(), 'stopped_by_owner')
        returning id::text as id`);

      // Closures: one in range, one archived, one far off.
      const closure = (label: string, from: string, to: string, archived: boolean) => one(t, sql<{ id: string }>`
        insert into factory_closures (business_id, label, starts_on, ends_on, archived_at)
        values (${BIZ}, ${label}, ${from}::date, ${to}::date, ${archived ? new Date(now) : null}) returning id::text as id`);
      const today = dayKey(new Date(now), 'Asia/Shanghai');
      id['closure'] = await closure(`Mid-Autumn ${RUN}`, addDays(today, 5), addDays(today, 7), false);
      id['closureArchived'] = await closure(`Archived ${RUN}`, addDays(today, 2), addDays(today, 3), true);
      id['closureFar'] = await closure(`Spring ${RUN}`, addDays(today, 60), addDays(today, 70), false);
    });

    // ANOTHER tenant, with a row in every window the first one uses.
    await as(OTHER, async (t) => {
      await sql`insert into businesses (id, name) values (${OTHER}, 'Other Calendar Factory') on conflict (id) do nothing`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active)
                values (${PROD2}, ${OTHER}, ${`CAL2-${RUN}`}, 'Other cup', 'pcs', 100, true) on conflict (id) do nothing`.execute(t);
      id['zed'] = await one(t, sql<{ id: string }>`
        insert into clients (business_id, phone, display_name, country)
        values (${OTHER}, ${`+86138${RUN}9`}, ${`Zed ${RUN}`}, 'US') returning id::text as id`);
      id['convZ'] = await one(t, sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase) values (${OTHER}, ${id['zed']}::uuid, 'whatsapp', 'warm_intake')
        returning id::text as id`);
      id['sampleZ'] = await one(t, sql<{ id: string }>`
        insert into sample_requests (business_id, conversation_id, asked_text, requested_at)
        values (${OTHER}, ${id['convZ']}::uuid, 'sample?', ${new Date(Date.now() - DAY)}) returning id::text as id`);
      id['closureZ'] = await one(t, sql<{ id: string }>`
        insert into factory_closures (business_id, label, starts_on, ends_on)
        values (${OTHER}, ${`Other closure ${RUN}`}, ${dayKey(new Date(), 'Asia/Shanghai')}::date, ${dayKey(new Date(), 'Asia/Shanghai')}::date) returning id::text as id`);
    });

    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE,
      sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false, factsTtlMs: 0,
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

  it('requires a session', async () => {
    const r = await app.inject({ method: 'GET', url: '/app/calendar' });
    expect(r.statusCode).toBe(302);
    expect(r.headers['location']).toBe('/login');
  });

  it('shows one entry per dated row near today, each naming the row it came from', async () => {
    await area(false);
    const src = await shown();
    const expected: [string, string][] = [
      [`sample_requests:${id['sample']}`, 'handled_at'],   // asked is the same row; see below
      [`order_updates:${id['updConfirmed']}`, 'at'],
      [`order_updates:${id['updShipped']}`, 'at'],
      [`orders:${id['orderA']}`, 'confirmed_at'],
      [`quotes:${id['quoteLate']}`, 'created_at'],
      [`quotes:${id['quoteOther']}`, 'created_at'],
      [`handoffs:${id['handoff']}`, 'sla_deadline_at'],
      [`factory_closures:${id['closure']}`, 'starts_on'],
      [`conversations:${id['convC']}`, 'closed_at'],
    ];
    for (const [k] of expected) expect(src.has(k), k).toBe(true);
    expect(src.size).toBe(expected.length);
    // A sample asked AND handled is two entries of one row, one per column (each on its own day).
    const both = (await pagesFor()).flatMap((p) => [...p.body.matchAll(new RegExp(`<li class="dl-row[^"]*" data-src="sample_requests:${id['sample']}" data-col="([^"]+)"`, 'g'))].map((m) => m[1]));
    expect([...new Set(both)].sort()).toEqual(['handled_at', 'requested_at']);
    const all = (await pagesFor()).map((p) => p.body).join('\n');
    // The tracking reference she pasted is on the shipped line.
    expect(all).toContain(`SF${RUN}`);
    expect(all).toContain(`Mid-Autumn ${RUN}`);
    // Handled, and the reply is owed tomorrow: neither is described as outstanding past its time.
    expect(all).not.toContain(t('en', 'calendar.line.sampleOpen'));
    // the warmth run — the reply owed is said in its own sentence, and only a late one says it is late
    expect(all).toContain(t('en', 'calendar.say.reply_due', { who: '' }).trim());
    expect(all).not.toContain(t('en', 'calendar.detail.late'));
  }, 60_000);

  it('nothing chosen, the list leads with what is owed — the reply owed — and then the month\'s other dates', async () => {
    const r = await get('/app/calendar');
    const list = r.body.slice(r.body.indexOf('<div class="cal-list"'));
    expect(r.body.indexOf('<table class="mo">')).toBeLessThan(r.body.indexOf('<div class="cal-list"'));
    const owed = list.indexOf(`<span class="dot warn" aria-hidden="true">●</span> ${t('en', 'calendar.legend.owed')}</h2>`);
    expect(owed).toBeGreaterThan(-1);
    expect([...sources(list).keys()][0]).toBe(`handoffs:${id['handoff']}`);
    expect(list.indexOf(`data-src="handoffs:${id['handoff']}"`)).toBeGreaterThan(owed);
    expect(list).toContain('<h2 class="cal-lh">Other dates in ');
  });

  it('every entry is a real row, listed under the very day it is dated', async () => {
    const ALLOWED: Record<string, readonly string[]> = {
      sample_requests: ['requested_at', 'handled_at'], order_updates: ['at'], orders: ['confirmed_at'],
      quotes: ['created_at'], handoffs: ['sla_deadline_at'], factory_closures: ['starts_on'], conversations: ['closed_at'],
      sequence_enrollments: ['next_due_at'],
    };
    let checked = 0;
    for (const p of await pagesFor()) {
      if (p.day === null) continue;
      const rows = [...p.body.matchAll(/<li class="dl-row (?:solid|dashed)(?: done)?" data-src="([a-z_]+):([0-9a-f-]+)" data-col="([a-z_]+)"/g)];
      for (const [, table, rowId, col] of rows) {
        checked++;
        expect(ALLOWED[table!], table).toContain(col);
        const v = (await as(BIZ, (t) => (table === 'factory_closures'
          ? sql<{ v: unknown; e: unknown }>`select starts_on::text as v, ends_on::text as e from factory_closures where id = ${rowId}::uuid`
          : sql<{ v: unknown; e: unknown }>`select ${sql.ref(`${table}.${col}`)} as v, null as e
              from ${sql.table(table!)} where id = ${rowId}::uuid`).execute(t))).rows[0];
        expect(v, `${table}:${rowId} exists in this tenant`).toBeDefined();
        if (table === 'factory_closures') {
          // A closure is listed on each day it covers.
          expect(String(v!.v) <= p.day && String(v!.e) >= p.day, `${p.day}: the closure covers it`).toBe(true);
        } else {
          expect(dayKey(v!.v as Date, 'Asia/Shanghai'), `${table}.${col} on ${p.day}`).toBe(p.day);
        }
      }
    }
    expect(checked).toBeGreaterThan(5);
  }, 60_000);

  it('what is out of the window, archived, released, stopped or superseded never appears', async () => {
    await area(true);
    const all = (await pagesFor()).map((p) => p.body).join('\n');
    for (const k of ['sampleOld', 'convOld', 'closureArchived', 'closureFar', 'handoffReleased', 'enrolStopped',
      'quoteEarly', 'updPending', 'orderB']) {
      expect(all, k).not.toContain(`:${id[k]}"`);
    }
    expect(all).not.toContain(`Archived ${RUN}`);
    expect(all).not.toContain(`gone-${RUN}@example.com`);
    await area(false);
  }, 60_000);

  it("another tenant's buyer, rows and closures never appear — not even asked for by id", async () => {
    for (const extra of ['', `buyer=${id['zed']}`, `who=${id['zed']}`, 'category=samples', 'category=closures']) {
      const all = (await pagesFor(extra)).map((p) => p.body).join('\n');
      expect(all, extra).not.toContain(`Zed ${RUN}`);
      expect(all, extra).not.toContain(`Other closure ${RUN}`);
      expect(all, extra).not.toContain(id['sampleZ']!);
      expect(all, extra).not.toContain(id['closureZ']!);
      expect(all, extra).not.toContain(id['convZ']!);
    }
    // Another tenant's buyer id is no filter at all here: the page is this tenant's whole month.
    expect([...(await shown(`who=${id['zed']}`)).keys()].sort()).toEqual([...(await shown()).keys()].sort());
  }, 120_000);

  it('follow-ups appear only where the outreach area is on', async () => {
    await area(false);
    const off = (await pagesFor()).map((p) => p.body).join('\n');
    expect(off).not.toContain(`sequence_enrollments:`);
    expect(off).not.toContain(`buyer-${RUN}@example.com`);
    expect(off).not.toContain('<option value="followups"');   // the category is a choice since V1-202
    await area(true);
    const pages = await pagesFor();
    expect(new Map(pages.flatMap((p) => [...sources(p.body)])).get(`sequence_enrollments:${id['enrol']}`)).toBe('next_due_at');
    const on = pages.map((p) => p.body).join('\n');
    expect(on).toContain(`buyer-${RUN}@example.com`);
    expect(on).toContain('<option value="followups"');
    // No conversation yet: nothing to open, so no door on that row.
    const row = new RegExp(`<li class="dl-row dashed" data-src="sequence_enrollments:${id['enrol']}"[\\s\\S]*?</li>`).exec(on)?.[0] ?? '';
    expect(row).not.toBe('');
    expect(row).not.toContain('href=');
    await area(false);
  }, 60_000);

  it('a category filter excludes exactly the other categories, and travels with the day chosen', async () => {
    await area(true);
    const all = await shown();
    for (const cat of ['samples', 'orders', 'negotiation', 'followups', 'closures', 'conversations']) {
      const got = [...(await shown(`category=${cat}`)).keys()].sort();
      const want = [...all.keys()].filter((k) => CATEGORY_OF[k.split(':')[0]!] === cat).sort();
      expect(got, cat).toEqual(want);
      expect(got.length, `${cat} has something seeded`).toBeGreaterThan(0);
    }
    // the day links of the grid carry the kind chosen
    expect((await get('/app/calendar?category=orders')).body).toMatch(/<a class="mo-d" href="\/app\/calendar\?month=\d{4}-\d{2}&amp;day=\d{4}-\d{2}-\d{2}&amp;category=orders"/);
    await area(false);
  }, 120_000);

  it('the buyer filter narrows to one buyer; a closure belongs to nobody', async () => {
    const got = [...(await shown(`who=${id['olga']}`)).keys()].sort();
    expect(got).toEqual([`order_updates:${id['updConfirmed']}`, `order_updates:${id['updShipped']}`].sort());
    // the old ?buyer= link still narrows
    expect([...(await shown(`buyer=${id['olga']}`)).keys()].sort()).toEqual(got);
    const r = await get(`/app/calendar?who=${id['olga']}`);
    expect(r.body).toContain(`<option value="${id['olga']}" selected>`);
    // The others are still offered, so she can switch.
    expect(r.body).toContain(`<option value="${id['ahmed']}"`);
    // The order's door is the order page.
    const all = (await pagesFor(`who=${id['olga']}`)).map((p) => p.body).join('\n');
    expect(all).toContain(`href="/app/orders/${id['orderB']}"`);
    const a = [...(await shown(`who=${id['ahmed']}&category=negotiation`)).keys()].sort();
    expect(a).toEqual([`handoffs:${id['handoff']}`, `quotes:${id['quoteLate']}`, `quotes:${id['quoteOther']}`].sort());
  }, 120_000);

  it('bad query values fall back to the defaults, never an error', async () => {
    const base = [...sources((await get('/app/calendar')).body).keys()].sort();
    for (const q of ['day=2026-02-31', 'day=yesterday', "day=2026-01-01'--", 'month=2026-13', 'month=26-10', 'category=everything',
      'who=ahmed', 'buyer=1%3Bdrop', 'day=2026-01-01&day=2026-01-02', 'category[]=samples']) {
      const r = await get(`/app/calendar?${q}`);
      expect(r.statusCode, q).toBe(200);
      expect([...sources(r.body).keys()].sort(), q).toEqual(base);
    }
  });

  it('a day chosen by its address: its cell wears the ring, and the list holds that day alone', async () => {
    const d = dayKey(new Date(Date.now() - 2 * DAY), 'Asia/Shanghai');
    const r = await get(`/app/calendar?month=${d.slice(0, 7)}&day=${d}`);
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(new RegExp(`<td class="(?:[a-z]+ )*sel"[^>]*>\\s*<a class="mo-d" href="/app/calendar\\?month=${d.slice(0, 7)}&amp;day=${d}" aria-label="[^"]+" aria-current="true">`));
    expect(r.body.match(/ aria-current="true"/g)).toHaveLength(1);
    const list = r.body.slice(r.body.indexOf('<div class="cal-list"'));
    expect(list).toContain(`<a class="back" href="/app/calendar${d.slice(0, 7) === dayKey(new Date(), 'Asia/Shanghai').slice(0, 7) ? '' : `?month=${d.slice(0, 7)}`}">`);
    expect([...sources(list).keys()]).toContain(`orders:${id['orderA']}`);
    expect([...sources(list).keys()]).not.toContain(`handoffs:${id['handoff']}`);
  });

  it('the old views\' addresses answer with the same place on the one screen; signed out, the sign-in', async () => {
    const today = dayKey(new Date(), 'Asia/Shanghai');
    for (const [old, to] of [
      ['/app/calendar?view=list', '/app/calendar'],
      ['/app/calendar?view=week', `/app/calendar?month=${today.slice(0, 7)}&day=${today}`],
      ['/app/calendar?view=day&at=2031-01-15', '/app/calendar?month=2031-01&day=2031-01-15'],
      ['/app/calendar?view=month&at=2031-01-15', '/app/calendar?month=2031-01'],
      ['/app/calendar?at=2031-01-15&category=orders', '/app/calendar?month=2031-01&day=2031-01-15&category=orders'],
      [`/app/calendar?view=week&at=2031-01-15&buyer=${id['olga']}`, `/app/calendar?month=2031-01&day=2031-01-15&who=${id['olga']}`],
      ['/app/calendar?view=list&from=2031-01-06', '/app/calendar?month=2031-01'],
    ] as const) {
      const r = await get(old);
      expect(r.statusCode, old).toBe(302);
      expect(r.headers['location'], old).toBe(to);
      expect((await get(to)).statusCode, to).toBe(200);
    }
    const out = await app.inject({ method: 'GET', url: '/app/calendar?view=week' });
    expect(out.statusCode).toBe(302);
    expect(out.headers['location']).toBe('/login');
  });

  it('an empty month says so beside its grid and leads somewhere; the doors move a month', async () => {
    const r = await get('/app/calendar?month=2031-01');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<table class="mo">');
    expect(r.body).toContain('<div class="empty cal-empty">');
    expect(r.body).toContain(t('en', 'calendar.empty.month'));
    expect(r.body).toContain('<details class="cal-add"><summary>');   // its one door: adding a date
    expect(r.body).toContain('href="/app/calendar?month=2030-12"');
    expect(r.body).toContain('href="/app/calendar?month=2031-02"');
    expect(r.body).toContain('<a class="tab cal-today" href="/app/calendar">');     // back to now
  });

  it('reads in all five locales, right to left in Arabic, with the calendar lit', async () => {
    for (const locale of LOCALES) {
      const r = await get('/app/calendar', locale);
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain(`<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`);
      expect(r.body).toContain(t(locale, 'nav.calendar'));
      expect(r.body).toContain(t(locale, 'calendar.cat.samples'));
      // The warmth run: the calendar is its own entry under Customers, and it is lit.
      expect(r.body).toMatch(/<a href="\/app\/calendar" class="navlink sub active" data-nav="calendar" aria-current="page"/);
      // No percent sign anywhere in the page body.
      const body = r.body.slice(r.body.indexOf('<body'));
      expect(body).not.toContain('%');
    }
  });

  it('the Buyers page links the calendar', async () => {
    const r = await get('/app/inbox');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('href="/app/calendar"');
  });
});
