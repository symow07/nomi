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
 * The renderer's shape is tests/parity/calendar.test.ts. Only Postgres can
 * prove what matters here: that every entry is a real row of the table it
 * names, that a row outside the window or in ANOTHER tenant never appears,
 * that a category filter excludes exactly the other categories, that the
 * buyer filter narrows to one buyer, and that follow-ups exist only where the
 * outreach area is on.
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
    new Map([...html.matchAll(/<li class="row" data-src="([^"]+)" data-col="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
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
      const base = dayStart(addDays(dayKey(ago(2)), 0)).getTime() + 10 * 3_600_000;
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
      const today = dayKey(new Date(now));
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
        values (${OTHER}, ${`Other closure ${RUN}`}, ${dayKey(new Date())}::date, ${dayKey(new Date())}::date) returning id::text as id`);
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

  it('shows one entry per dated row in the window, each naming the row it came from', async () => {
    await area(false);
    const r = await get('/app/calendar');
    expect(r.statusCode).toBe(200);
    const src = sources(r.body);
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
    // A sample asked AND handled in range is two entries of one row, one per column.
    const sampleRows = [...r.body.matchAll(new RegExp(`data-src="sample_requests:${id['sample']}" data-col="([^"]+)"`, 'g'))].map((m) => m[1]);
    expect(sampleRows.sort()).toEqual(['handled_at', 'requested_at']);
    expect(src.size).toBe(expected.length);
    // The tracking reference she pasted is on the shipped line.
    expect(r.body).toContain(`SF${RUN}`);
    expect(r.body).toContain(`Mid-Autumn ${RUN}`);
    // Handled, and the reply is owed tomorrow: neither is described as outstanding past its time.
    expect(r.body).not.toContain(t('en', 'calendar.line.sampleOpen'));
    expect(r.body).toContain(t('en', 'calendar.line.replyDue'));
    expect(r.body).not.toContain(t('en', 'calendar.line.replyOverdue'));
  });

  it('every entry is a real row, and its date really is in the window', async () => {
    const r = await get('/app/calendar');
    const today = dayKey(new Date());
    const start = dayStart(addDays(today, -7)).getTime();
    const end = dayStart(addDays(today, 14)).getTime();
    const ALLOWED: Record<string, readonly string[]> = {
      sample_requests: ['requested_at', 'handled_at'], order_updates: ['at'], orders: ['confirmed_at'],
      quotes: ['created_at'], handoffs: ['sla_deadline_at'], factory_closures: ['starts_on'], conversations: ['closed_at'],
      sequence_enrollments: ['next_due_at'],
    };
    const rows = [...r.body.matchAll(/<li class="row" data-src="([a-z_]+):([0-9a-f-]+)" data-col="([a-z_]+)"/g)];
    expect(rows.length).toBeGreaterThan(0);
    for (const [, table, rowId, col] of rows) {
      expect(ALLOWED[table!], table).toContain(col);
      const v = (await as(BIZ, (t) => (table === 'factory_closures'
        ? sql<{ v: unknown; e: unknown }>`select starts_on::text as v, ends_on::text as e from factory_closures where id = ${rowId}::uuid`
        : sql<{ v: unknown; e: unknown }>`select ${sql.ref(`${table}.${col}`)} as v, null as e
            from ${sql.table(table!)} where id = ${rowId}::uuid`).execute(t))).rows[0];
      expect(v, `${table}:${rowId} exists in this tenant`).toBeDefined();
      if (table === 'factory_closures') {
        // A closure is shown when any of its days falls in the window.
        expect(String(v!.v) <= addDays(today, 13) && String(v!.e) >= addDays(today, -7)).toBe(true);
      } else {
        const ms = (v!.v as Date).getTime();
        expect(ms >= start && ms < end, `${table}.${col} in window`).toBe(true);
      }
    }
  });

  it('what is out of the window, archived, released, stopped or superseded never appears', async () => {
    await area(true);
    const r = await get('/app/calendar');
    for (const k of ['sampleOld', 'convOld', 'closureArchived', 'closureFar', 'handoffReleased', 'enrolStopped',
      'quoteEarly', 'updPending', 'orderB']) {
      expect(r.body, k).not.toContain(`:${id[k]}"`);
    }
    expect(r.body).not.toContain(`Archived ${RUN}`);
    expect(r.body).not.toContain(`gone-${RUN}@example.com`);
  });

  it("another tenant's buyer, rows and closures never appear — not even asked for by id", async () => {
    for (const url of ['/app/calendar', `/app/calendar?buyer=${id['zed']}`, '/app/calendar?category=samples',
      '/app/calendar?category=closures']) {
      const r = await get(url);
      expect(r.statusCode, url).toBe(200);
      expect(r.body).not.toContain(`Zed ${RUN}`);
      expect(r.body).not.toContain(`Other closure ${RUN}`);
      expect(r.body).not.toContain(id['sampleZ']!);
      expect(r.body).not.toContain(id['closureZ']!);
      expect(r.body).not.toContain(id['convZ']!);
    }
    // Another tenant's buyer id is no filter at all here: the page is this tenant's whole window.
    const all = sources((await get('/app/calendar')).body);
    const asked = sources((await get(`/app/calendar?buyer=${id['zed']}`)).body);
    expect([...asked.keys()].sort()).toEqual([...all.keys()].sort());
  });

  it('follow-ups appear only where the outreach area is on', async () => {
    await area(false);
    const off = await get('/app/calendar');
    expect(off.body).not.toContain(`sequence_enrollments:`);
    expect(off.body).not.toContain(`buyer-${RUN}@example.com`);
    expect(off.body).not.toContain(`category=followups`);
    await area(true);
    const on = await get('/app/calendar');
    expect(sources(on.body).get(`sequence_enrollments:${id['enrol']}`)).toBe('next_due_at');
    expect(on.body).toContain(`buyer-${RUN}@example.com`);
    expect(on.body).toContain('category=followups');
    // No conversation yet: nothing to open, so no door on that row.
    const row = new RegExp(`<li class="row" data-src="sequence_enrollments:${id['enrol']}"[\\s\\S]*?</li>`).exec(on.body)?.[0] ?? '';
    expect(row).not.toContain('href=');
    await area(false);
  });

  it('a category filter excludes exactly the other categories', async () => {
    await area(true);
    const all = sources((await get('/app/calendar')).body);
    for (const cat of ['samples', 'orders', 'negotiation', 'followups', 'closures', 'conversations']) {
      const r = await get(`/app/calendar?category=${cat}`);
      expect(r.statusCode).toBe(200);
      const got = [...sources(r.body).keys()].sort();
      const want = [...all.keys()].filter((k) => CATEGORY_OF[k.split(':')[0]!] === cat).sort();
      expect(got, cat).toEqual(want);
      expect(got.length, `${cat} has something seeded`).toBeGreaterThan(0);
      expect(r.body).toMatch(new RegExp(`<a class="tab on" aria-current="page" href="/app/calendar\\?category=${cat}">`));
    }
    await area(false);
  });

  it('the buyer filter narrows to one buyer; a closure belongs to nobody', async () => {
    const r = await get(`/app/calendar?buyer=${id['olga']}`);
    expect(r.statusCode).toBe(200);
    const got = [...sources(r.body).keys()].sort();
    expect(got).toEqual([`order_updates:${id['updConfirmed']}`, `order_updates:${id['updShipped']}`].sort());
    expect(r.body).toContain(`<option value="${id['olga']}" selected>`);
    // The others are still offered, so she can switch.
    expect(r.body).toContain(`<option value="${id['ahmed']}"`);
    // The order's door is the order page.
    expect(r.body).toContain(`href="/app/orders/${id['orderB']}"`);
    const a = [...sources((await get(`/app/calendar?buyer=${id['ahmed']}&category=negotiation`)).body).keys()].sort();
    expect(a).toEqual([`handoffs:${id['handoff']}`, `quotes:${id['quoteLate']}`, `quotes:${id['quoteOther']}`].sort());
  });

  it('bad query values fall back to the defaults, never an error', async () => {
    const base = [...sources((await get('/app/calendar')).body).keys()].sort();
    for (const q of ['from=2026-02-31', 'from=yesterday', "from=2026-01-01'--", 'category=everything',
      'buyer=ahmed', 'buyer=1%3Bdrop', 'from=2026-01-01&from=2026-01-02', 'category[]=samples']) {
      const r = await get(`/app/calendar?${q}`);
      expect(r.statusCode, q).toBe(200);
      expect([...sources(r.body).keys()].sort(), q).toEqual(base);
    }
  });

  it('an empty window says so and leads somewhere; the doors page by three weeks', async () => {
    const r = await get('/app/calendar?from=2031-01-06');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<div class="empty">');
    expect(r.body).toContain(t('en', 'calendar.empty'));
    expect(r.body).toContain('href="/app/inbox"');
    expect(r.body).toContain('href="/app/calendar?from=2030-12-16"');
    expect(r.body).toContain('href="/app/calendar?from=2031-01-27"');
    expect(r.body).toContain('href="/app/calendar"');     // back to this week
  });

  it('reads in all three locales, right to left in Arabic, with Buyers lit', async () => {
    for (const locale of LOCALES) {
      const r = await get('/app/calendar', locale);
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain(`<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`);
      expect(r.body).toContain(t(locale, 'nav.calendar'));
      expect(r.body).toContain(t(locale, 'calendar.cat.samples'));
      expect(r.body).toMatch(/<a href="\/app\/inbox" class="navlink active" aria-current="page"/);
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
