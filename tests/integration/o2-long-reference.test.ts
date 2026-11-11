import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createDb, withTenantTx, type Db, type Tx } from '../../src/db/client.js';
import { parseBusinessId } from '../../src/core/types/ids.js';
import { seedRunTenant } from './tenant.js';

/**
 * O2 (2026-11-11) — the customer summary at a phone's width. An order reference written outside Nomi's own numbering
 * ("ORD_" and 33 hex characters, 37 in all, no break) widened `/app/customers/…` by 69 px at 390: the latest order's
 * row (`.cx`, `renderCustomerFile`) let it run past the page. `.cx { overflow-wrap:break-word; }` wraps it in its row.
 *
 * In real Chromium, every request answered by the app itself (never the network): at 360 and 390, en and ar, a 37- and
 * an 80-character reference — no sideways scroll, the reference whole and inside the viewport. With the rule taken
 * back out (a later style on the page), the same page scrolls sideways: the test sees what it guards. At 1440, the
 * page with the 37-character reference lays out exactly as without the rule; the 80-character one, which ran out of its
 * row there too (over the label, on an Arabic page), wraps inside it.
 */

const d = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;
const CHROMIUM = await import('playwright').then(({ chromium }) => existsSync(chromium.executablePath())).catch(() => false);

const B = randomUUID();
const SECRET = 'o2-long-reference-session-secret-at-least-32';
const CODE = `o2-owner-${randomBytes(4).toString('hex')}`;
const hex = (n: number) => randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);
const CASES = [
  { ref: `ORD_${hex(33)}`, client: randomUUID(), conv: randomUUID(), order: randomUUID() },
  { ref: `ORD_${hex(76)}`, client: randomUUID(), conv: randomUUID(), order: randomUUID() },
] as const;
/** The rule taken back out: a later style of the same weight. */
const WITHOUT_RULE = '.cx { overflow-wrap:normal; }';

d('O2: a long order reference on the customer summary never widens the page', () => {
  let db: Db, app: ReturnType<typeof Fastify>, owner = '';
  const tx = <T>(fn: (t: Tx) => Promise<T>) => { const b = parseBusinessId(B); if (!b.ok) throw Error('fixture'); return withTenantTx(db, b.value, fn); };

  beforeAll(async () => {
    await seedRunTenant();
    db = createDb(process.env['DATABASE_URL']!);
    await tx(async (t) => {
      await sql`insert into businesses(id,name,owner_locale) values(${B}::uuid,'Long references','en')`.execute(t);
      const product = randomUUID();
      await sql`insert into products(id,business_id,sku,name,unit,moq) values(${product}::uuid,${B}::uuid,'O2','A product','pcs',1)`.execute(t);
      for (const [i, c] of CASES.entries()) {
        await sql`insert into clients(id,business_id,display_name) values(${c.client}::uuid,${B}::uuid,${`Customer ${i + 1}`})`.execute(t);
        await sql`insert into conversations(id,business_id,client_id,channel,is_active) values(${c.conv}::uuid,${B}::uuid,${c.client}::uuid,'email',true)`.execute(t);
        await sql`insert into messages(conversation_id,direction,text_content) values(${c.conv}::uuid,'inbound','Where is my order?')`.execute(t);
        await sql`insert into orders(id,business_id,client_id,conversation_id,product_id,order_reference,quantity,unit,currency,total_value_usd,status)
          values(${c.order}::uuid,${B}::uuid,${c.client}::uuid,${c.conv}::uuid,${product}::uuid,${c.ref},3,'pcs','USD',80,'confirmed')`.execute(t);
      }
    });
    const { registerWebApp } = await import('../../src/api/web/app.js');
    app = Fastify({ logger: false });
    registerWebApp(app, { db, businessId: B, accessCode: CODE, sessionSecret: SECRET, employeeName: 'Lily', avatar: 'L', provider: 'disabled',
      secureCookie: false, messagingEnabled: false, factsTtlMs: 0, kickOutbound: async () => {}, kickDrive: async () => {} } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    owner = String(login.headers['set-cookie'] ?? '').split(';')[0]!;
    expect(owner).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('the page draws each reference in the latest order\'s row, whole', async () => {
    expect(CASES.map((c) => c.ref.length)).toEqual([37, 80]);
    for (const c of CASES) {
      const r = await app.inject({ method: 'GET', url: `/app/customers/${c.client}?conversation=${c.conv}`, headers: { cookie: owner } });
      expect(r.statusCode).toBe(200);
      expect(r.body).toMatch(new RegExp(`<div class="cx">.*?<a href="/app/orders/${c.order}">[^<]*${c.ref}[^<]*</a>`, 's'));
    }
  });

  it.skipIf(!CHROMIUM)('real Chromium: 360 and 390, en and ar, 37 and 80 characters — no sideways scroll, the reference whole and in view; 1440 unchanged', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const results: unknown[] = [];
    try {
      for (const locale of ['en', 'ar'] as const) for (const width of [360, 390, 1440]) for (const c of CASES) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const offOrigin: string[] = [];
        await page.route('**/*', async (route) => {
          const url = new URL(route.request().url());
          if (url.host !== 'nomi.test') { offOrigin.push(url.href); return route.abort(); }
          const r = await app.inject({ method: 'GET', url: url.pathname + url.search, headers: { cookie: `${owner}; yf_locale=${locale}` } });
          return route.fulfill({ status: r.statusCode, headers: { 'content-type': String(r.headers['content-type'] ?? 'text/plain') }, body: r.rawPayload });
        });
        const res = await page.goto(`http://nomi.test/app/customers/${c.client}?conversation=${c.conv}`, { waitUntil: 'load' });
        expect(res?.status()).toBe(200);
        const where = `${locale}/${width}/${c.ref.length}`;
        expect(await page.evaluate<string>("document.documentElement.dir || 'ltr'"), where).toBe(locale === 'ar' ? 'rtl' : 'ltr');
        const link = page.locator(`.cx a[href="/app/orders/${c.order}"]`);
        expect(await link.count(), where).toBe(1);
        type Reading = { vw: number; sw: number; bodySW: number; text: string; rects: { l: number; r: number }[]; boxes: string[] };
        // A string, read in the page (the typecheck has no DOM): the link's lines, the page's widths, and every element's
        // box, to compare one layout with another. The isolates (U+2066..U+2069) are left out of the text.
        const measure = () => page.evaluate<Reading>(`(() => {
          const a = document.querySelector('.cx a[href="/app/orders/${c.order}"]');
          const rects = [...a.getClientRects()].map((r) => ({ l: Math.round(r.left), r: Math.round(r.right) }));
          const boxes = [...document.querySelectorAll('body *')].map((e) => { const r = e.getBoundingClientRect();
            return e.tagName.toLowerCase() + '.' + (e.getAttribute('class') || '') + ' ' + [r.x, r.y, r.width, r.height].map(Math.round).join(','); });
          return { vw: window.innerWidth, sw: document.documentElement.scrollWidth, bodySW: document.body.scrollWidth,
            text: (a.textContent || '').replace(/[\\u2066-\\u2069]/g, ''), rects, boxes };
        })()`);
        // The faces are the product's own (Noto, served by the app) and the prose measure is in `ch`: on an Arabic
        // page the first style recalculation after load moves it (603 → 664 px at 1440) whatever the style says — a
        // no-op style does the same, sometimes on the second. So no-op styles are added until two readings in a row
        // agree, and only then is anything compared.
        await page.evaluate('document.fonts.ready.then(() => undefined)');
        // The evidence picture first: a full-page picture resizes the page, which also moves the measure.
        if (process.env['O2_PNG']) await page.screenshot({ path: `${process.env['O2_PNG']}/${locale}-${width}-${c.ref.length}.png`, fullPage: true });
        let withRule = await measure();
        for (let i = 0, settled = false; !settled; i++) {
          expect(i, `${where}: the layout settles within five recalculations`).toBeLessThan(5);
          await page.addStyleTag({ content: `.o2-settle-${i} { color:inherit; }` });
          const again = await measure();
          settled = JSON.stringify(again.boxes) === JSON.stringify(withRule.boxes);
          withRule = again;
        }
        await page.addStyleTag({ content: WITHOUT_RULE });
        const withoutRule = await measure();
        results.push({ where, withRule: { ...withRule, boxes: withRule.boxes.length }, withoutRule: { sw: withoutRule.sw, rects: withoutRule.rects } });
        expect(offOrigin, where).toEqual([]);
        expect(withRule.text, `${where}: the reference whole`).toBe(c.ref);
        expect(withRule.sw, `${where}: no sideways scroll`).toBe(width);
        expect(withRule.bodySW, `${where}: no sideways scroll (body)`).toBe(width);
        for (const r of withRule.rects) {
          expect(r.l, `${where}: inside the viewport`).toBeGreaterThanOrEqual(0);
          expect(r.r, `${where}: inside the viewport`).toBeLessThanOrEqual(width);
        }
        if (width < 1440) expect(withoutRule.sw, `${where}: without the rule the page scrolls sideways (the test sees what it guards)`).toBeGreaterThan(width);
        else {
          expect(withoutRule.sw, `${where}: no sideways scroll at 1440 either way`).toBe(1440);
          if (c.ref.length === 37) {
            const moved = withRule.boxes.flatMap((b, i) => (b === withoutRule.boxes[i] ? [] : [`${withoutRule.boxes[i]} → ${b}`]));
            expect(moved, `${where}: the page at 1440 lays out exactly as without the rule`).toEqual([]);
          }
        }
        await context.close();
      }
    } finally {
      await browser.close();
      if (process.env['O2_OUT']) (await import('node:fs')).writeFileSync(process.env['O2_OUT'], JSON.stringify(results, null, 1));
    }
  }, 180_000);
});
