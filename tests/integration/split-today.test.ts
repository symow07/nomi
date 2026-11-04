import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID, createHash } from 'node:crypto';
import { hashCode } from '../../src/api/web/people.js';
import { buttonsAndDoors } from '../parity/buttons-and-doors.js';
import { unisolatedFigures, withoutIsolates } from '../parity/isolates.js';
import { sheetLinks, linkedCss } from '../parity/linked-css.js';

/**
 * THE SPLIT TODAY PREVIEW, over Postgres and the owner's routes (the owner's locked design, 2026-11-04).
 *
 *   - the flag off, Today is what it was: nothing of the preview is drawn or linked;
 *   - the flag on, every figure is read from the workspace's rows: a conversation marked "me testing" counts for nothing;
 *   - Send and Hand to me go through the conversation's own routes, so every safety stays where it was;
 *   - one magenta, one Send; the source checks and the "not switched on" notice stay on the page;
 *   - the Books panel is the owner's: staff get Sales alone, and books switched off draw no panel;
 *   - in Arabic every figure is isolated, and buttons do things while doors go places.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `5b170000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const CODE = `split-${RUN}`;
const STAFF = `split-staff-${RUN}`;

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const daysAgo = (n: number): string => iso(new Date(Date.now() - n * 86_400_000));

d('the Split Today preview (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let plain: import('fastify').FastifyInstance;
  let cookie = '';
  let staffCookie = '';
  let plainCookie = '';
  let aisha = '';
  let tester = '';
  let draftId = '';
  const kicked: string[] = [];

  const tx = async <R>(fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const compose = (splitToday: boolean, extra: Record<string, unknown> = {}) => {
    const f = Fastify({ logger: false });
    const { registerWebApp } = imported;
    registerWebApp(f, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: true, splitToday,
      kickOutbound: async (_b: string, _c: string, text: string) => { kicked.push(text); },
      kickDrive: async () => {}, ...extra,
    } as unknown as Parameters<typeof registerWebApp>[1]);
    return f;
  };
  let imported: typeof import('../../src/api/web/app.js');
  const login = async (f: import('fastify').FastifyInstance, code: string) =>
    String((await f.inject({ method: 'POST', url: '/login', payload: `code=${code}`, headers: FORM })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const today = async (who = cookie, f = app, locale?: string) =>
    (await f.inject({ method: 'GET', url: '/app', headers: { cookie: locale ? `${who}; yf_locale=${locale}` : who } })).body;

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const inv = await import('../../src/db/booksInvoices.js');
    imported = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    const dec = (s: string) => s as import('../../src/core/types/decimal.js').Decimal;
    await tx((x) => sql`insert into businesses (id, name, owner_locale, timezone, currency, books_area) values (${BIZ}, 'Split Shop', 'en', 'UTC', 'USD', true)`.execute(x));
    await tx(async (x) => {
      const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
      await sql`insert into people (business_id, name, code_hash) values (${BIZ}, 'Sam Staff', ${hashCode(SECRET, STAFF)})`.execute(x);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
                values (${BIZ}, 'instagram', ${`ig-split-${RUN}`}, 'split-secret', 'service', true)`.execute(x);
      const a = await ensureConversation(x, b.value, `ig-aisha-${RUN}`, 'Aisha Bello', 'instagram');
      const t = await ensureConversation(x, b.value, `ig-test-${RUN}`, 'Testing Person', 'instagram');
      aisha = a.conversationId; tester = t.conversationId;
      await sql`update client_channels set last_inbound_at = now() - interval '1 minute' where client_id in (${a.clientId}::uuid, ${t.clientId}::uuid)`.execute(x);
      await sql`update conversations set assigned_to = null where id in (${aisha}::uuid, ${tester}::uuid)`.execute(x);
      await sql`update conversations set owner_testing = true where id = ${tester}::uuid`.execute(x);
      const product = (await sql<{ id: string }>`insert into products (business_id, sku, name, unit, is_active)
        values (${BIZ}, ${`S-${RUN}`}, 'Travel Cosmetic Bag', 'pcs', true) returning id::text as id`.execute(x)).rows[0]!.id;
      await sql`update conversation_state set identified_product_id = ${product}::uuid where conversation_id = ${aisha}::uuid`.execute(x);
      for (const [c, id] of [[aisha, 'a'], [tester, 't']] as const) {
        await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
                  values (${c}::uuid, ${`split-${id}-${RUN}`}, 'inbound', 'text', 'How much for 5,000?', now() - interval '1 minute')`.execute(x);
        await sql`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, discount_pct, total_usd, requires_human, applied_rules, engine_version)
                  values (${BIZ}, ${c}::uuid, ${product}::uuid, 5000, '{}'::jsonb, 1.45, 0, 7250, false, '{}', 'split-test')`.execute(x);
      }
      draftId = (await sql<{ id: string }>`insert into drafts (business_id, conversation_id, capability, draft_text, status)
        values (${BIZ}, ${aisha}, 'quote', 'Hello Aisha, 5,000 come to $1.45 each, $7,250.00 in total.', 'pending') returning id::text as id`.execute(x)).rows[0]!.id;
      // A year of books, as the invoices test lays them.
      const one = async (q: ReturnType<typeof sql<{ id: string }>>) => (await q.execute(x)).rows[0]!.id;
      const acc = (code: string, kind: string) => one(sql<{ id: string }>`insert into accounts (business_id, code, name, kind) values (${BIZ}, ${code}, ${code}, ${kind}) returning id::text as id`);
      const k = {
        receivable: await acc('3421', 'asset'), sales: await acc('7111', 'income'), bank: await acc('5141', 'asset'), loss: await acc('6331', 'expense'), gain: await acc('7331', 'income'),
        ve: await one(sql<{ id: string }>`insert into journals (business_id, code, name, kind) values (${BIZ}, 'VE', 'Sales', 'sales') returning id::text as id`),
        bq: await one(sql<{ id: string }>`insert into journals (business_id, code, name, kind) values (${BIZ}, 'BQ', 'Bank', 'bank') returning id::text as id`),
        party: await one(sql<{ id: string }>`insert into parties (business_id, code, name, kind) values (${BIZ}, 'C001', 'Karim Haddad', 'customer') returning id::text as id`),
      };
      await sql`insert into fiscal_years (business_id, starts_on, ends_on) values (${BIZ}, ${daysAgo(120)}::date, ${daysAgo(-240)}::date)`.execute(x);
      await sql`insert into books_settings (business_id, sales_journal_id, receivable_account_id, sales_account_id, fx_loss_account_id, fx_gain_account_id)
                values (${BIZ}, ${k.ve}, ${k.receivable}, ${k.sales}, ${k.loss}, ${k.gain})`.execute(x);
      const invoice = async (date: string, due: string | null, amount: string) => {
        const r = await inv.draftInvoice(x, BIZ, 'owner', { partyId: k.party, issueDate: date, dueDate: due, currency: 'USD', label: null,
          lines: [{ label: 'Goods', quantity: dec('1'), unitPrice: dec(amount), accountId: k.sales, taxCodeId: null }] });
        if (r.kind !== 'drafted') throw new Error(`draft: ${JSON.stringify(r)}`);
        const done = await inv.issueInvoice(x, BIZ, r.id, 'owner');
        if (done.kind !== 'issued') throw new Error(`issue: ${JSON.stringify(done)}`);
        return r.id;
      };
      await invoice(daysAgo(40), daysAgo(9), '2100');
      const paid = await invoice(iso(new Date()), null, '1000');
      const p = await inv.recordPayment(x, BIZ, paid, 'owner', { paidOn: iso(new Date()), amount: dec('1000'), journalId: k.bq, accountId: k.bank });
      if (p.kind !== 'recorded') throw new Error(`pay: ${JSON.stringify(p)}`);
      const imp = randomUUID();
      await sql`insert into statement_imports (id, business_id, account_id, format, sha256, added, refused, imported_by) values (${imp}::uuid, ${BIZ}, ${k.bank}, 'csv', ${createHash('sha256').update(RUN).digest('hex')}, 1, 0, 'owner')`.execute(x);
      await sql`insert into statement_lines (business_id, import_id, account_id, booked_on, amount, currency, wording, fingerprint) values (${BIZ}, ${imp}::uuid, ${k.bank}, ${iso(new Date())}::date, 1000, 'USD', 'Karim', ${`split-${RUN}`})`.execute(x);
      // A line no payment answers: it is not a match, whatever the day.
      await sql`insert into statement_lines (business_id, import_id, account_id, booked_on, amount, currency, wording, fingerprint) values (${BIZ}, ${imp}::uuid, ${k.bank}, ${iso(new Date())}::date, 777, 'USD', 'Nobody', ${`split-${RUN}-2`})`.execute(x);
    });
    app = compose(true); await app.ready();
    plain = compose(false); await plain.ready();
    cookie = await login(app, CODE);
    staffCookie = await login(app, STAFF);
    plainCookie = await login(plain, CODE);
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await plain?.close(); await db?.destroy(); });

  it('the flag off: Today is what it was, nothing of the preview drawn or linked', async () => {
    const html = await today(plainCookie, plain);
    expect(html).not.toContain('class="split"');
    expect(html).not.toContain('sp-send');
    expect(sheetLinks(html).some((h) => h.includes('/split.'))).toBe(false);
  });

  it('draws the decision from the workspace: the customer, the deal, the question, the words', async () => {
    const html = withoutIsolates(await today());
    expect(html).toContain('class="split"');
    expect(html).toContain('Aisha Bello');
    expect(html).toContain('5,000');
    expect(html).toContain('$7,250');
    expect(html).toContain('Send Aisha the price?');
    expect(html.split('$1.45 each')).toHaveLength(2);
  });

  it('keeps every safety: one Send, one magenta, Hand to me, the source checks, the notice', async () => {
    const html = await today();
    expect(html.match(/class="sp-btn sp-send"/g)).toHaveLength(1);
    expect(html).toContain('Hand to me');
    expect(html).toContain(`formaction="/app/inbox/${aisha}/takeover"`);
    expect(html).toContain(`action="/app/inbox/${aisha}/act"`);
    expect(html).toContain('class="reading"');
    expect(html).toContain('goes on Instagram, as written');
  });

  it('says so where sending is not switched on: the notice stays on the page', async () => {
    const off = compose(true, { messagingEnabled: false, provider: 'disabled' }); await off.ready();
    const html = await today(await login(off, CODE), off);
    await off.close();
    expect(html).toContain('class="muted notlive"');
    expect(html).toContain('Sending is not switched on here yet');
    expect(html.match(/class="sp-btn sp-send"/g)).toHaveLength(1);
  });

  it('counts real rows: a conversation marked as the owner testing counts for nothing', async () => {
    const html = withoutIsolates(await today());
    expect(html).not.toContain('Testing Person');
    expect(html).toMatch(/Asked<\/span><span class="sp-fig">1</);
  });

  it('reads the books: in, out, profit, what is owed, who is late, what matched, the year', async () => {
    const html = withoutIsolates(await today());
    expect(html).toContain('In $1,000');
    expect(html).toContain('1 invoice');
    expect(html).toContain('$2,100');
    expect(html).toContain('Karim Haddad');
    expect(html).toContain('9 days late');
    expect(html).toContain('1 payment matched');
    expect(html).toContain('books open');
    expect(html).toContain('class="sp-over"');
  });

  it('the number matched is the number the bank page offers', async () => {
    const { openLines, bankAccounts } = await import('../../src/db/bankStatements.js');
    const offered = await tx(async (x) => {
      const accounts = await bankAccounts(x, BIZ);
      const lines = (await Promise.all(accounts.map((a) => openLines(x, BIZ, a.id)))).flat();
      return lines.filter((l) => l.suggestions.length > 0).length;
    });
    expect(offered).toBe(1);
    expect(withoutIsolates(await today())).toContain('1 payment matched');
  });

  it('the Books panel is the owner\'s: staff get Sales alone', async () => {
    const html = await today(staffCookie);
    expect(html).toContain('sp-sales');
    expect(html).not.toContain('sp-books');
    expect(html).not.toContain('Karim Haddad');
  });

  it('books switched off draw no panel', async () => {
    await tx((x) => sql`update businesses set books_area = false where id = ${BIZ}`.execute(x));
    const html = await today();
    await tx((x) => sql`update businesses set books_area = true where id = ${BIZ}`.execute(x));
    expect(html).toContain('sp-sales');
    expect(html).not.toContain('sp-books');
  });

  it('in Arabic: every figure isolated, right to left; buttons do things, doors go places; no raw key', async () => {
    for (const locale of ['en', 'ar']) {
      const html = await today(cookie, app, locale);
      expect(buttonsAndDoors(html)).toEqual([]);
      expect(html).not.toMatch(/>\s*split\.[a-z.]+\s*</);
      if (locale === 'ar') {
        expect(html).toContain('dir="rtl"');
        expect(unisolatedFigures(html)).toEqual([]);
      }
    }
  });

  it('the sheet is linked after the app\'s own, and draws no shadow', async () => {
    const css = linkedCss(await today());
    expect(css).toContain('.sp-send');
    expect(sheetLinks(await today()).at(-1) ?? '').toContain('/assets/');
  });

  // The two that change something, last: Hand to me first, on a draft of its own.
  it('Hand to me is the take-over: nothing sent', async () => {
    const other = await tx((x) => sql<{ id: string }>`insert into drafts (business_id, conversation_id, capability, draft_text, status)
      values (${BIZ}, ${tester}, 'quote', 'A reply nobody sends.', 'pending') returning id::text as id`.execute(x).then((r) => r.rows[0]!.id));
    const r = await app.inject({ method: 'POST', url: `/app/inbox/${tester}/takeover`, headers: { cookie, ...FORM }, payload: new URLSearchParams({ draftId: other, edit: 'A reply nobody sends.' }).toString() });
    expect(r.statusCode).toBe(302);
    expect(kicked).toEqual([]);
  });

  it('Send goes through the one approval path, and lands on the conversation', async () => {
    const before = kicked.length;
    const r = await app.inject({ method: 'POST', url: `/app/inbox/${aisha}/act`, headers: { cookie, ...FORM },
      payload: new URLSearchParams({ draftId, command: 'send', edit: 'Hello Aisha, 5,000 come to $1.45 each, $7,250.00 in total.' }).toString() });
    expect(r.statusCode).toBe(302);
    expect(String(r.headers.location)).toContain(`/app/inbox/${aisha}`);
    const row = await tx((x) => sql<{ status: string }>`select status from drafts where id = ${draftId}::uuid`.execute(x).then((q) => q.rows[0]!));
    expect(row.status).not.toBe('pending');
    expect(kicked.length).toBeGreaterThan(before);
    expect(await today()).not.toContain(draftId);
  });
});
