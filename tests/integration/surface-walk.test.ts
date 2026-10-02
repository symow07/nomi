import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { seedRunTenant, RUN_BIZ, RUN_NS } from './tenant.js';
import { buttonsAndDoors } from '../parity/buttons-and-doors.js';
import { unisolatedFigures } from '../parity/isolates.js';

/**
 * M36.0 — EVERY SURFACE, AGAINST A TENANT THAT HAS ROWS IN IT.
 *
 * M35's proof page carried a query with a set-returning function in a JOIN
 * condition. It threw 0A000 — but ONLY for a conversation that had taught
 * knowledge attached, which is the exact case the feature exists for. Both
 * suites missed it: the parity tests render from a fixture, so they exercise
 * the renderer and never the query.
 *
 * The sibling risk is worse, because it is systemic. An EMPTY tenant is the
 * safest possible input and the least representative one: every join returns
 * nothing, every optional block is skipped, and a query that only breaks when
 * rows exist passes cleanly.
 *
 * WHAT THE EXISTING WALK ACTUALLY DID, before this file. boot.test.ts loops
 * CONTEXTUAL_ROUTES and asserts 200, against the seeded run tenant — so it was
 * populated, not empty, which is better than the brief assumed. But it covered
 * only that list minus two exclusions: no NAV route, no parameterised route
 * (`/app/inbox/:id`, `/app/products/:id`, `/app/knowledge/:id`), and not
 * `/p/:token`. The proof page was reachable by no walk at all.
 *
 * This walks EVERY registered GET route, with REAL ids from the seeded demo
 * factory — 12 products, 6 buyers, 5 conversations, taught knowledge, quotes,
 * trust history — and a proof link issued through the owner's own route so the
 * public page is exercised against a real quote rather than a fixture.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const nsId = (suffix: string) => `${RUN_NS}-0000-4000-8000-${suffix}`;

d('M36.0 · every surface answers on a POPULATED tenant (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const routes: string[] = [];
  const real: Record<string, string> = {};
  const CODE = 'surface-walk-code';
  /**
   * CC-26 — the live line's addresses answer only with the mark a page was
   * drawn at (a request without one is refused, 400). Walked here the way a
   * page asks them, with a well-formed mark from long ago, so their reads run
   * on these real rows like every page's; `live-refresh.test.ts` holds what
   * they answer.
   */
  const STALE_MARK: Record<string, string> = {
    '/app/live/today': '0.0.0.0.0.0',
    '/app/live/buyers': '0.0000000000000000',
    '/app/live/channels': '0.0000000000000000',
    '/app/live/conversation/:conversationId': '0.0.00000000',
    '/app/live/practice': '0.0.00000000',
    // Phase 6 — Billing watches for the card Stripe is confirming.
    '/app/live/billing': '0.none',
  };
  const asked = (url: string, target: string): string =>
    STALE_MARK[url] ? `${target}?since=${STALE_MARK[url]}` : target;

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');

    // D — every GET route must answer, including the outreach area's, which
    // exists only where the area is switched on. On for this tenant; the OFF
    // state (404s, no links) is outreach-area.test.ts.
    await withTenantTx(db, bid.value, (tx) =>
      sql`update businesses set outreach_area = true where id = ${RUN_BIZ}::uuid`.execute(tx));

    // REAL ids out of the seeded data, not invented ones: a route given a
    // nonexistent id takes its not-found branch and never runs the query that
    // matters.
    await withTenantTx(db, bid.value, async (tx) => {
      const one = async (q: string) =>
        (await sql<{ id: string }>`${sql.raw(q)}`.execute(tx)).rows[0]?.id ?? '';
      real['conversationId'] = await one(
        `select id::text as id from conversations where business_id = '${RUN_BIZ}' limit 1`);
      real['productId'] = await one(
        `select id::text as id from products where business_id = '${RUN_BIZ}' limit 1`);
      real['id'] = await one(
        `select id::text as id from product_knowledge where business_id = '${RUN_BIZ}' limit 1`);
    });
    expect(real['conversationId'], 'the seed produced no conversation').not.toBe('');

    // P3 — the workspace has practised once: its copy, and a practice line, so
    // Practice and its live line are drawn on real rows too.
    {
      const { refreshPractice, practiceConversation } = await import('../../src/db/practice.js');
      const copy = await refreshPractice(db, bid.value);
      await withTenantTx(db, copy, async (tx) => {
        const conv = await practiceConversation(tx, copy);
        await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
                  values (${conv}::uuid, ${`practice:walk-${RUN_BIZ}`}, 'inbound', 'text', 'How much for 5,000 pieces?', now())
                  on conflict do nothing`.execute(tx);
      });
    }
    expect(real['productId'], 'the seed produced no product').not.toBe('');

    // K1 — a list being checked, from a photo, with a discount given: its
    // review, its floors page and its photo are drawn on real rows.
    real['importId'] = await withTenantTx(db, bid.value, async (tx) => {
      const rows = [
        { key: 'p1-1', line: 'Canvas tote $12.00', photo: 1, sku: null, name: 'Canvas tote', nameZh: null, price: 12, unit: 'item', moq: null,
          names: [], refused: null, removed: false, ticked: false, challenge: 'ask', reopened: false, edited: false },
        { key: 'p1-2', line: 'Hoodie S-M $40 / L-XL $45', photo: 1, sku: null, name: 'Hoodie S-M / L-XL', nameZh: null, price: 40, unit: 'item', moq: 5,
          names: ['hoodie'], refused: null, removed: false, ticked: true, challenge: null, reopened: false, edited: true },
        { key: 'p1-3', line: 'PRICE LIST', photo: 1, sku: null, name: 'PRICE LIST', nameZh: null, price: null, unit: 'item', moq: null,
          names: [], refused: 'no_price_on_page', removed: false, ticked: false, challenge: null, reopened: false, edited: false },
      ];
      const id = (await sql<{ id: string }>`
        insert into catalog_imports (business_id, kind, currency, rows, discount_pct, created_by)
        values (${RUN_BIZ}, 'photo', 'USD', ${JSON.stringify(rows)}::jsonb, 10, 'owner') returning id::text as id`.execute(tx)).rows[0]!.id;
      await sql`insert into catalog_import_photos (business_id, import_id, position, media_type, bytes, transcript)
                values (${RUN_BIZ}, ${id}::uuid, 1, 'image/png', ${Buffer.from('walk-photo')}, 'Canvas tote $12.00')`.execute(tx);
      return id;
    });
    real['n'] = '1';

    // THE DEMO SEED CREATES NO QUOTES. A "fully populated fake company" with no
    // quote cannot exercise the quote context, the proof link, or anything
    // downstream of a price — which is why the proof page had no walk covering
    // it. One is added here so this test means something; the seed itself
    // arguably should grow one, which is reported rather than changed under a
    // test's feet.
    await withTenantTx(db, bid.value, async (tx) => {
      const n = (await sql<{ n: number }>`
        select count(*)::int as n from quotes where business_id = ${RUN_BIZ}`.execute(tx)).rows[0]!.n;
      if (n === 0) {
        await sql`insert into quotes (business_id, conversation_id, product_id, quantity,
                                      inputs, unit_price_usd, total_usd, engine_version)
                  values (${RUN_BIZ}, ${real['conversationId']}::uuid, ${real['productId']}::uuid,
                          20000, '{}'::jsonb, 0.85, 17000, 'surface-walk')`.execute(tx);
      }
      // And a knowledge_used event, so the LATERAL that shipped broken is on
      // the path this walk takes rather than skipped as an empty join.
      if (real['id']) {
        await sql`insert into conversation_events (business_id, conversation_id, type, payload)
                  values (${RUN_BIZ}, ${real['conversationId']}::uuid, 'knowledge_used',
                          ${JSON.stringify({ ids: [real['id']] })}::jsonb)`.execute(tx);
      }
    });

    process.env['PILOT_BUSINESS_ID'] = RUN_BIZ;
    app = Fastify({ logger: false });
    app.addHook('onRoute', (r) => {
      const ms = Array.isArray(r.method) ? r.method : [r.method];
      if (ms.includes('GET')) routes.push(r.url);
    });
    registerWebApp(app, {
      db, businessId: RUN_BIZ, accessCode: CODE,
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

    // A REAL proof link, issued through the owner's route, so /p/:token is
    // walked against an actual quote with actual taught knowledge behind it.
    // This is the precise shape that was broken and shipped.
    const conv = await withTenantTx(db, bid.value, (tx) => sql<{ id: string }>`
      select c.id::text as id from conversations c
       join quotes q on q.conversation_id = c.id
       where c.business_id = ${RUN_BIZ} limit 1`.execute(tx).then((r) => r.rows[0]?.id));
    if (conv) {
      await app.inject({ method: 'POST', url: `/app/inbox/${conv}/proof`, headers: { cookie } });
      const tk = await withTenantTx(db, bid.value, (tx) => sql<{ token: string }>`
        select token from quote_proofs where business_id = ${RUN_BIZ} and revoked_at is null limit 1`
        .execute(tx).then((r) => r.rows[0]?.token));
      if (tk) real['token'] = tk;
    }
  }, 90_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('the seeded tenant actually has rows — otherwise this walk proves nothing', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    const counts = await withTenantTx(db, bid.value, (tx) => sql<{
      products: number; convos: number; knowledge: number; quotes: number;
    }>`
      select (select count(*)::int from products where business_id = ${RUN_BIZ}) as products,
             (select count(*)::int from conversations where business_id = ${RUN_BIZ}) as convos,
             (select count(*)::int from product_knowledge where business_id = ${RUN_BIZ}) as knowledge,
             (select count(*)::int from quotes where business_id = ${RUN_BIZ}) as quotes
    `.execute(tx).then((r) => r.rows[0]!));
    expect(counts.products).toBeGreaterThan(0);
    expect(counts.convos).toBeGreaterThan(0);
    expect(counts.quotes).toBeGreaterThan(0);
  });

  it('EVERY GET route renders against real data — not one of them 500s', async () => {
    const broken: string[] = [];
    for (const url of [...new Set(routes)]) {
      // Params get REAL values; anything unknown is skipped rather than probed
      // with a fake id, which would silently exercise the not-found branch.
      let target = url;
      let skip = false;
      for (const m of url.matchAll(/:([A-Za-z]+)/g)) {
        const v = real[m[1]!];
        if (!v) { skip = true; break; }
        target = target.replace(`:${m[1]}`, encodeURIComponent(v));
      }
      if (skip) continue;

      const res = await app.inject({ method: 'GET', url: asked(url, target), headers: { cookie } });
      if (res.statusCode >= 500) {
        broken.push(`${target} → ${res.statusCode} ${res.body.slice(0, 160)}`);
      }
    }
    expect(broken, `these threw on real data:\n  ${broken.join('\n  ')}`).toEqual([]);
  });

  it('M51.5 · the month-change query runs against real rows', async () => {
    // A three-way UNION with month bounds in her timezone is exactly the shape
    // that passes a fixture and throws on a database — M35's LATERAL did.
    const { loadInsights } = await import('../../src/api/web/insights.js');
    const data = await loadInsights(db, RUN_BIZ);
    expect(Array.isArray(data.insights)).toBe(true);
    for (const i of data.insights) {
      // The insight rule, over whatever the seeded tenant actually produced.
      expect(i.action.href, JSON.stringify(i)).toMatch(/^\/app\//);
    }
  });

  it('the proof page specifically — the one that shipped broken', async () => {
    expect(real['token'], 'no proof link was issued, so this walk skipped it').toBeTruthy();
    const res = await app.inject({ method: 'GET', url: `/p/${real['token']}` });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  });

  /**
   * The audit's last rows (2026-09-28), over real rows instead of a fixture:
   * every page drawn in English and Arabic, as an owner opens it.
   *   CC-13 — no Chinese colon or space in the page's own words, and no
   *           figure run into its unit ("5,000pcs", "5,000قطعة").
   *   CC-14 — the shell names the business, from its own row.
   *   CC-20 — the skip link first, `main` its target, one heading per page.
   *   CC-29 — every form that takes something away asks first.
   *   Buttons and doors (2026-09-29) — a link is never drawn as a button, a
   *     button outside a form is only a script's, a form that posts can be
   *     posted. The components gallery draws specimens on purpose.
   * What a PERSON wrote (a bubble, a draft, a field's value) is theirs, and
   * is left out of the punctuation check.
   */
  it('CC-13, CC-14, CC-20, CC-29, buttons and doors · every owner page, in English and Arabic, on real rows', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    const business = await withTenantTx(db, bid.value, (tx) => sql<{ name: string }>`
      select name from businesses where id = ${RUN_BIZ}::uuid`.execute(tx).then((r) => r.rows[0]!.name));
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const ASK = 'onclick="return confirm(this.dataset.confirm)"';
    const TAKES = /\/(remove|archive|disconnect|revoke|promote|withdraw|dismiss|delete|stop)$|^\/app\/channels\/outreach$/;
    // Phase 5 — these set something aside at once, and the notice that follows carries Undo
    // (audit-closeout.test.ts holds which, and that each route offers it).
    const UNDONE = /^\/app\/settings\/forbidden\/[0-9a-f-]{36}\/remove$|^\/app\/settings\/closures\/[0-9a-f-]{36}\/remove$|^\/app\/knowledge\/archive$|^\/app\/calendar\/entries\/[0-9a-f-]{36}\/remove$/;
    const words = (html: string) => html
      .replace(/<(textarea|script|template)\b[\s\S]*?<\/\1>/g, ' ')
      .replace(/<div[^>]*class="[^"]*\b(bubble|proposed)\b[^"]*"[^>]*>[\s\S]*?<\/div>/g, ' ')
      // a customer's own words in a list row are theirs, not the page's
      .replace(/<span class="cr-text"[^>]*>[\s\S]*?<\/span>/g, ' ')
      .replace(/<p class="voice">[\s\S]*?<\/p>/g, ' ')
      .replace(/\svalue="[^"]*"/g, ' ')
      .replace(/<[^>]+>/g, ' ');
    const { messages } = await import('../../src/core/owner/i18n/messages.js');
    const spaces = [...new Set(Object.keys(messages.en).map((k) => k.split('.')[0]!))].join('|');
    const KEYISH = new RegExp(`\\b(?:${spaces})\\.[a-z][A-Za-z0-9_]*(?:\\.[A-Za-z0-9_]+)*\\b`, 'g');
    const problems: string[] = [];
    let pages = 0;
    for (const locale of ['en', 'ar'] as const) {
      for (const url of [...new Set(routes)]) {
        if (!url.startsWith('/app') || url.startsWith('/app/live')) continue;
        let target = url; let skip = false;
        for (const m of url.matchAll(/:([A-Za-z]+)/g)) {
          const v = real[m[1]!];
          if (!v) { skip = true; break; }
          target = target.replace(`:${m[1]}`, encodeURIComponent(v));
        }
        if (skip) continue;
        const res = await app.inject({ method: 'GET', url: target, headers: { cookie: `${cookie}; yf_locale=${locale}` } });
        if (res.statusCode !== 200 || !String(res.headers['content-type'] ?? '').includes('text/html')) continue;
        const html = res.body;
        if (!html.includes('<nav class="side">')) continue;   // a download or a fragment, not a page
        pages++;
        const at = `${locale} ${target}`;
        const text = words(html);
        // A line the catalogue does not have prints its own key
        // ("people.ownerOnly.data_rights", 2026-09-30): no page shows one.
        for (const m of text.matchAll(KEYISH)) problems.push(`${at}: a raw catalogue key "${m[0]}"`);
        for (const m of text.matchAll(/[：　]|\d(?:pcs|قطعة)/g)) {
          problems.push(`${at}: "${text.slice(Math.max(0, m.index! - 40), m.index! + 20).replace(/\s+/g, ' ').trim()}"`);
        }
        if (!html.includes(`<span class="brandname"><bdi>${esc(business)}</bdi><small>Nomi</small></span>`)) problems.push(`${at}: the shell does not name the business`);
        if (!/<body><a class="skip" href="#main">[^<]+<\/a>/.test(html) || !/<main id="main"(?: class="wide")?>/.test(html)) problems.push(`${at}: no skip link to main`);
        const h1 = html.match(/<h1[\s>]/g)?.length ?? 0;
        if (h1 !== 1) problems.push(`${at}: ${h1} headings of the first rank`);
        // Phase 4 of the UI rebuild — graphite fills ONE act on a page: the one it exists for.
        const fills = html.match(/class="btn send\b/g)?.length ?? 0;
        if (fills > 1 && target !== '/app/settings/components') problems.push(`${at}: ${fills} filled buttons — one primary act per page`);
        for (const f of html.matchAll(/<form\b[^>]*\baction="([^"]+)"[\s\S]*?<\/form>/g)) {
          const action = f[1]!.replace(/&amp;/g, '&').split('?')[0]!;
          if (TAKES.test(action) && !UNDONE.test(action) && !f[0].includes(ASK)) problems.push(`${at}: ${action} does not ask first`);
        }
        if (target !== '/app/settings/components') {
          for (const p of buttonsAndDoors(html)) problems.push(`${at}: ${p}`);
        }
      }
    }
    expect(pages, 'the walk drew no owner page').toBeGreaterThan(40);
    expect(problems).toEqual([]);
  }, 180_000);

  /**
   * RIGHT TO LEFT, BY DESIGN (the design pass §9, 2026-09-30): every owner
   * page drawn in Arabic, over real rows with a value of each kind — money
   * (quotes, prices), quantities and units, counts, dates, times, a phone
   * number, an order number, a calendar entry of the owner's own — and not one
   * digit run or currency sign outside an isolate. What a person wrote is in
   * its own `dir="auto"` element, so it is its own isolate.
   */
  it('right to left · every owner page in Arabic: every figure and currency sign isolated', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    // A value of each kind the seed may not have: an order (its number), and
    // a date the owner put on the calendar, this week.
    await withTenantTx(db, bid.value, async (tx) => {
      const orders = (await sql<{ n: number }>`select count(*)::int as n from orders where business_id = ${RUN_BIZ}`.execute(tx)).rows[0]!.n;
      if (orders === 0) {
        await sql`insert into orders (order_reference, business_id, client_id, conversation_id, product_id,
                                      quantity, unit, agreed_unit_price_usd, total_value_usd, currency, status, confirmed_at)
                  select ${`RTL-${RUN_NS}`}, c.business_id, c.client_id, c.id, ${real['productId']}::uuid,
                         2500, 'pcs', 1.95, 4875, 'USD', 'confirmed', now() - interval '1 day'
                    from conversations c where c.id = ${real['conversationId']}::uuid`.execute(tx);
      }
      await sql`insert into calendar_entries (business_id, title, starts_at, created_by)
                values (${RUN_BIZ}, 'Visit 2', now() + interval '1 day', 'owner')`.execute(tx);
    });
    const problems: string[] = [];
    let pages = 0;
    for (const url of [...new Set(routes)]) {
      if (!url.startsWith('/app') || url.startsWith('/app/live')) continue;
      let target = url; let skip = false;
      for (const m of url.matchAll(/:([A-Za-z]+)/g)) {
        const v = real[m[1]!];
        if (!v) { skip = true; break; }
        target = target.replace(`:${m[1]}`, encodeURIComponent(v));
      }
      if (skip) continue;
      const res = await app.inject({ method: 'GET', url: target, headers: { cookie: `${cookie}; yf_locale=ar` } });
      if (res.statusCode !== 200 || !String(res.headers['content-type'] ?? '').includes('text/html')) continue;
      if (!res.body.includes('<nav class="side">')) continue;
      pages++;
      for (const hit of unisolatedFigures(res.body)) problems.push(`${target}: «${hit}»`);
    }
    expect(pages, 'the walk drew too few owner pages').toBeGreaterThan(30);
    expect(problems, `figures outside an isolate:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 180_000);

  it('and every surface returns 200, not merely "not 500"', async () => {
    const notOk: string[] = [];
    for (const url of [...new Set(routes)]) {
      // Skipped because this walk cannot mint the credential they carry in the
      // URL, or because they are a redirect by design. Both are covered
      // elsewhere: the proof page by the test directly above, `/u` by
      // contacts.test.ts with a real signed token.
      if (url === '/p/:token' || url === '/u' || url === '/') continue;
      let target = url; let skip = false;
      for (const m of url.matchAll(/:([A-Za-z]+)/g)) {
        const v = real[m[1]!];
        if (!v) { skip = true; break; }
        target = target.replace(`:${m[1]}`, encodeURIComponent(v));
      }
      if (skip) continue;
      const res = await app.inject({ method: 'GET', url: asked(url, target), headers: { cookie } });
      if (res.statusCode !== 200 && res.statusCode !== 302) notOk.push(`${target} → ${res.statusCode}`);
    }
    expect(notOk, `unexpected status:\n  ${notOk.join('\n  ')}`).toEqual([]);
  });
});
