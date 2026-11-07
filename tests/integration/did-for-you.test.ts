import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { createDb, withTenantTx, type Db, type Tx } from '../../src/db/client.js';
import { parseBusinessId, type BusinessId } from '../../src/core/types/ids.js';
import { decimal } from '../../src/core/types/decimal.js';
import { draftInvoice, issueInvoice, recordPayment } from '../../src/db/booksInvoices.js';
import { draftCreditNote, issueCreditNote } from '../../src/db/booksCreditNotes.js';
import { loadMonthReport, monthFrame } from '../../src/db/monthReport.js';

/**
 * Block 4.3 — "WHAT NOMI DID FOR YOU" over Postgres: one fixture month, every figure exact.
 *
 * October 2026 in Europe/London, a month that crosses the clock change (summer time ends on the 25th), so the month is
 * 2026-09-30T23:00Z to 2026-11-01T00:00Z, not a whole number of days. Each figure has a row on each side of its rule:
 *   · an owner's test conversation holding one of everything — it moves no figure (`notOwnerTesting`);
 *   · rows an hour either side of local midnight on the 1st and the 31st — the month is the workspace's, not UTC's;
 *   · a reply queued alone that never left, drafts approved or edited whose words never left — not counted;
 *   · a message to the customer before theirs — no reply to it;
 *   · a cancelled order, an order of September — not counted; two currencies — two totals;
 *   · invoices paid in full at once and in two parts — two; in part, finished in November, in September, credited — none.
 */
const d = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;

const NOW = new Date('2026-11-07T10:00:00Z');
const at = (iso: string) => new Date(iso);

d('Block 4.3 · what Nomi did for you, one month (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: Db, admin: pg.Client;
  const BIZ = randomUUID();
  const EMPTY = randomUUID();
  const bid = (b: string): BusinessId => { const p = parseBusinessId(b); if (!p.ok) throw Error('fixture'); return p.value; };
  const tx = <T>(b: string, fn: (t: Tx) => Promise<T>) => withTenantTx(db, bid(b), fn);
  const ids: Record<string, string> = {};
  const conv: Record<string, string> = {};
  const client: Record<string, string> = {};
  let ext = 0;

  beforeAll(async () => {
    db = createDb(process.env['DATABASE_URL']!);
    admin = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] });
    await admin.connect();
    await admin.query(`insert into businesses (id, name, timezone, country, currency, books_area, created_at)
                       values ($1, 'Month Report Co', 'Europe/London', 'MA', 'MAD', true, '2026-09-14T10:00:00Z')`, [BIZ]);
    await admin.query(`insert into businesses (id, name, timezone, created_at) values ($1, 'Nothing Yet Co', 'Europe/London', '2026-10-14T10:00:00Z')`, [EMPTY]);

    await tx(BIZ, async (t) => {
      const PID = randomUUID();
      await sql`insert into products (id, business_id, sku, name, unit, is_active) values (${PID}, ${BIZ}, ${`MR-${BIZ.slice(0, 8)}`}, 'Lip balm', 'item', true)`.execute(t);
      for (const who of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'T']) {
        client[who] = randomUUID(); conv[who] = randomUUID();
        await sql`insert into clients (id, business_id, display_name) values (${client[who]}, ${BIZ}, ${`Customer ${who}`})`.execute(t);
        await sql`insert into conversations (id, business_id, client_id, channel, owner_testing)
                  values (${conv[who]}, ${BIZ}, ${client[who]}, 'whatsapp', ${who === 'T'})`.execute(t);
      }
      const said = (who: string, dir: 'inbound' | 'outbound', when: string, text = 'Words') =>
        sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
            values (${conv[who]}, ${`mr-${BIZ.slice(0, 8)}-${++ext}`}, ${dir}, 'text', ${text}, ${at(when)})`.execute(t);
      let seq = 0;
      const out = (who: string, when: string, body: string, origin: 'employee' | 'owner', status = 'sent') =>
        sql`insert into outbound_messages (business_id, conversation_id, seq, body, status, origin, sent_at)
            values (${BIZ}, ${conv[who]}, ${++seq}, ${body}, ${status}, ${origin}, ${status === 'sent' ? at(when) : null})`.execute(t);
      const event = (who: string, type: string, when: string, payload: object = {}) =>
        sql`insert into conversation_events (business_id, conversation_id, type, payload, created_at)
            values (${BIZ}, ${conv[who]}, ${type}, ${JSON.stringify(payload)}::jsonb, ${at(when)})`.execute(t);
      const signal = (who: string, kind: string, when: string) =>
        sql`insert into conversation_signals (business_id, conversation_id, kind, created_at) values (${BIZ}, ${conv[who]}, ${kind}, ${at(when)})`.execute(t);
      const draft = (who: string, status: string, made: string, decided: string | null, text: string, sent: string | null = null) =>
        sql`insert into drafts (business_id, conversation_id, capability, draft_text, status, sent_text, created_at, decided_at)
            values (${BIZ}, ${conv[who]}, 'qualify', ${text}, ${status}, ${sent}, ${at(made)}, ${decided ? at(decided) : null})`.execute(t);
      /** A reply the assistant sent alone: the turn's event, the outbound row, the words on the timeline. */
      const alone = async (who: string, when: string, body: string, left = true) => {
        await event(who, 'auto_sent', when, { capability: 'greet', messageId: `m-${++ext}`, body });
        if (left) { await out(who, when, body, 'employee'); await said(who, 'outbound', when, body); }
      };

      // A — wrote on the 3rd, answered alone 6 minutes later; a second reply queued alone on the 12th never left.
      await said('A', 'inbound', '2026-10-03T09:00:00Z');
      await alone('A', '2026-10-03T09:06:00Z', 'Hello A, it is 12 dollars.');
      await alone('A', '2026-10-12T09:00:00Z', 'A reply that never left', false);
      // …and a draft approved on the 13th whose words never reached the timeline (the send failed): not counted.
      await draft('A', 'approved', '2026-10-13T09:00:00Z', '2026-10-13T09:05:00Z', 'Approved, never left', 'Approved, never left');
      // B — wrote on the 10th, a draft approved as written three hours later; handed over in the same turn as a request.
      await said('B', 'inbound', '2026-10-10T09:00:00Z');
      await draft('B', 'approved', '2026-10-10T09:01:00Z', '2026-10-10T12:00:00Z', 'Draft for B', 'Draft for B');
      await out('B', '2026-10-10T12:00:00Z', 'Draft for B', 'employee'); await said('B', 'outbound', '2026-10-10T12:00:00Z', 'Draft for B');
      await event('B', 'handoff', '2026-10-10T12:30:00Z'); await signal('B', 'human_requested', '2026-10-10T12:30:00Z');
      // C — wrote on the 15th, a draft edited and sent 30 minutes later; a hand-off with no reason on record.
      await said('C', 'inbound', '2026-10-15T13:00:00Z');
      await draft('C', 'edited', '2026-10-15T13:01:00Z', '2026-10-15T13:30:00Z', 'Draft for C', 'Edited for C');
      await out('C', '2026-10-15T13:30:00Z', 'Edited for C', 'employee'); await said('C', 'outbound', '2026-10-15T13:30:00Z', 'Edited for C');
      await event('C', 'handoff', '2026-10-16T08:00:00Z');
      // …and a draft edited on the 16th whose words never left: not counted.
      await draft('C', 'edited', '2026-10-16T09:00:00Z', '2026-10-16T09:05:00Z', 'Second draft for C', 'Edited, never left');
      // D — wrote on the 20th and is still waiting: one draft rejected, one expired; handed over before any turn (stock).
      // The owner wrote to D an hour before: a message before theirs is no reply to it.
      await said('D', 'outbound', '2026-10-20T09:00:00Z', 'Owner wrote first');
      await said('D', 'inbound', '2026-10-20T10:00:00Z');
      await draft('D', 'rejected', '2026-10-20T10:01:00Z', '2026-10-20T11:00:00Z', 'Rejected for D');
      await draft('D', 'expired', '2026-10-20T11:01:00Z', '2026-10-22T11:00:00Z', 'Expired for D');
      await event('D', 'handoff', '2026-10-20T10:00:05Z', { reason: 'stock_asked' });
      // E — wrote on the 25th (after the clock change), the owner answered in the channel's own app 10 minutes later:
      // the waiting draft superseded. The owner's reply is a first reply, not the assistant's. Handed over (a request).
      await said('E', 'inbound', '2026-10-25T08:00:00Z');
      await draft('E', 'superseded', '2026-10-25T08:01:00Z', '2026-10-25T08:10:00Z', 'Superseded for E');
      await out('E', '2026-10-25T08:10:00Z', 'Owner wrote this', 'owner'); await said('E', 'outbound', '2026-10-25T08:10:00Z', 'Owner wrote this');
      await event('E', 'handoff', '2026-10-25T08:00:30Z'); await signal('E', 'human_requested', '2026-10-25T08:00:30Z');
      // F — wrote at 00:20 London on the 1st (23:20Z on Sep 30): October's. Answered alone at 00:30 London.
      await said('F', 'inbound', '2026-09-30T23:20:00Z');
      await alone('F', '2026-09-30T23:30:00Z', 'Hello F');
      // G — wrote at 23:20 London on Sep 30 (22:20Z), answered alone at 23:30 London: September's, not October's.
      await said('G', 'inbound', '2026-09-30T22:20:00Z');
      await alone('G', '2026-09-30T22:30:00Z', 'Hello G');
      // …and a draft approved at 00:30 London on Nov 1 (00:30Z): November's.
      await draft('G', 'approved', '2026-11-01T00:20:00Z', '2026-11-01T00:30:00Z', 'November for G', 'November for G');
      await out('G', '2026-11-01T00:30:00Z', 'November for G', 'employee'); await said('G', 'outbound', '2026-11-01T00:30:00Z', 'November for G');
      // T — the owner testing: one of everything, all in October. Moves nothing.
      await said('T', 'inbound', '2026-10-05T10:00:00Z');
      await alone('T', '2026-10-05T10:01:00Z', 'Testing alone');
      await draft('T', 'approved', '2026-10-05T10:02:00Z', '2026-10-05T10:03:00Z', 'Testing draft', 'Testing draft');
      await out('T', '2026-10-05T10:03:00Z', 'Testing draft', 'employee'); await said('T', 'outbound', '2026-10-05T10:03:00Z', 'Testing draft');
      await draft('T', 'rejected', '2026-10-05T10:04:00Z', '2026-10-05T10:05:00Z', 'Testing rejected');
      await event('T', 'handoff', '2026-10-05T10:06:00Z', { reason: 'stock_asked' });

      // Orders: two that stand in October in two currencies, a third in USD, one cancelled, one of September, one testing.
      let ref = 0;
      const order = (who: string, total: number, currency: string, status: string, confirmed: string) =>
        sql`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit,
                                agreed_unit_price_usd, total_value_usd, currency, status, confirmed_at)
            values (${`MR-${BIZ.slice(0, 8)}-${++ref}`}, ${BIZ}, ${client[who]}, ${conv[who]}, ${PID}, 10, 'item',
                    ${total / 10}, ${total}, ${currency}, ${status}, ${at(confirmed)})`.execute(t);
      await order('A', 120, 'USD', 'confirmed', '2026-10-05T12:00:00Z');
      await order('B', 300, 'AED', 'shipped', '2026-10-18T12:00:00Z');
      await order('C', 80, 'USD', 'in_production', '2026-10-31T23:30:00Z');
      await order('D', 999, 'USD', 'cancelled', '2026-10-10T12:00:00Z');
      await order('G', 50, 'USD', 'confirmed', '2026-09-20T12:00:00Z');
      await order('T', 777, 'USD', 'confirmed', '2026-10-05T12:00:00Z');

      // The books, as the owner reports' fixture makes them (tests/integration/books-owner-reports.test.ts).
      for (const [code, name, kind, money] of [['5141', 'Banque', 'asset', true], ['3421', 'Clients', 'asset', false],
        ['4455', 'TVA facturée', 'liability', false], ['7111', 'Ventes', 'income', false]] as const)
        ids[code] = (await sql<{ id: string }>`insert into accounts(business_id,code,name,kind,holds_money) values(${BIZ}::uuid,${code},${name},${kind},${money}) returning id::text`.execute(t)).rows[0]!.id;
      for (const [code, kind] of [['BQ', 'bank'], ['VT', 'sales']]) ids[kind!] = (await sql<{ id: string }>`insert into journals(business_id,code,name,kind) values(${BIZ}::uuid,${code!},${code!},${kind!}) returning id::text`.execute(t)).rows[0]!.id;
      ids['C1'] = (await sql<{ id: string }>`insert into parties(business_id,code,name,kind) values(${BIZ}::uuid,'C1','Atlas Mode','customer') returning id::text`.execute(t)).rows[0]!.id;
      await sql`insert into fiscal_years(business_id,starts_on,ends_on) values(${BIZ}::uuid,'2026-01-01','2026-12-31')`.execute(t);
      await sql`insert into books_settings(business_id,sales_journal_id,receivable_account_id,sales_account_id) values(${BIZ}::uuid,${ids['sales']}::uuid,${ids['3421']}::uuid,${ids['7111']}::uuid)`.execute(t);
      ids['TVA20'] = (await sql<{ id: string }>`insert into tax_codes(business_id,code,label,rate,kind,account_id,valid_from) values(${BIZ}::uuid,'TVA20','TVA 20 %',20,'collected',${ids['4455']}::uuid,'2020-01-01') returning id::text`.execute(t)).rows[0]!.id;
    });
    const invoice = (amount: string, issue: string) => tx(BIZ, async (t) => {
      const r = await draftInvoice(t, BIZ, 'owner', { partyId: ids['C1']!, issueDate: issue, dueDate: issue, currency: 'MAD', label: null,
        lines: [{ label: 'Sale', quantity: decimal('1'), unitPrice: decimal(amount), accountId: ids['7111']!, taxCodeId: ids['TVA20']! }] });
      if (r.kind !== 'drafted') throw Error(JSON.stringify(r));
      const i = await issueInvoice(t, BIZ, r.id, 'owner'); if (i.kind !== 'issued') throw Error(JSON.stringify(i)); return r.id;
    });
    const pay = (id: string, amount: string, date: string) => tx(BIZ, async (t) => {
      const r = await recordPayment(t, BIZ, id, 'owner', { amount: decimal(amount), paidOn: date, accountId: ids['5141']!, journalId: ids['bank']!, refund: false });
      if (r.kind !== 'recorded') throw Error(JSON.stringify(r));
    });
    // Paid in full in October: 1,000 + 20% = 1,200.
    const full = await invoice('1000', '2026-10-02'); await pay(full, '1200', '2026-10-20');
    // Paid in two parts, both in October: paid in full on the day of the second.
    const twice = await invoice('200', '2026-10-03'); await pay(twice, '100', '2026-10-11'); await pay(twice, '140', '2026-10-25');
    // Paid in part in October.
    const part = await invoice('500', '2026-10-05'); await pay(part, '300', '2026-10-21');
    // Begun in October, finished in November.
    const late = await invoice('1000', '2026-10-06'); await pay(late, '400', '2026-10-08'); await pay(late, '800', '2026-11-02');
    // Paid in full in September.
    const sept = await invoice('500', '2026-09-01'); await pay(sept, '600', '2026-09-15');
    // Settled by a credit note, no payment: not "paid".
    const credited = await invoice('100', '2026-10-07');
    await tx(BIZ, async (t) => {
      const r = await draftCreditNote(t, BIZ, 'owner', { invoiceId: credited, issueDate: '2026-10-09', reason: 'Returned',
        lines: [{ invoiceLineNo: 1, quantity: decimal('0'), reduction: decimal('100') }] });
      if (r.kind !== 'drafted') throw Error(JSON.stringify(r));
      const c = await issueCreditNote(t, BIZ, r.id, 'owner'); if (c.kind !== 'issued') throw Error(JSON.stringify(c));
    });
  });
  afterAll(async () => { await db?.destroy(); await admin?.end(); });

  const report = (b = BIZ, month = '2026-10', now = NOW) => tx(b, (t) => loadMonthReport(t, bid(b), month, now));
  const money = (ms: readonly { amount: string; currency: string }[]) => ms.map((m) => `${m.currency} ${Number(m.amount).toFixed(2)}`);

  it('October in London: the month is the workspace\'s, half open, and over', async () => {
    const r = await report();
    expect(r.month).toBe('2026-10');
    expect(r.zone).toBe('Europe/London');
    expect(r.from.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(r.running).toBe(false);
    expect((await report(BIZ, '2026-10', at('2026-10-20T12:00:00Z'))).running).toBe(true);
  });

  it('customers answered: a reply the assistant wrote reached them in the month — never the owner\'s own, never a test', async () => {
    // A (alone), B (approved), C (edited), F (alone at 00:30 London on the 1st). Not D (nothing left), E (the owner wrote),
    // G (September and November), T (testing).
    expect((await report()).customersAnswered).toBe(4);
  });

  it('replies: sent alone once it left; drafts sent as written or edited; drafts not sent', async () => {
    expect((await report()).replies).toEqual({ alone: 2, drafted: 2, asWritten: 1, edited: 1, notSent: 3 });
  });

  it('time to first reply: the median over those answered; those still waiting apart', async () => {
    // A 6 min, B 3 h, C 30 min, E 10 min (the owner's), F 10 min → median 10 min; D waits.
    expect((await report()).firstReply).toEqual({ medianSeconds: 600, measured: 5, waiting: 1 });
  });

  it('orders that stand, confirmed in the month, one total per currency', async () => {
    const r = await report();
    expect(r.orders.confirmed).toBe(3);
    expect(money(r.orders.totals)).toEqual(['AED 300.00', 'USD 200.00']);
  });

  it('invoices paid in full in the month — not in part, not finished later, not credited — and their value', async () => {
    const r = await report();
    expect(r.invoicesPaid.count).toBe(2);
    expect(money(r.invoicesPaid.totals)).toEqual(['MAD 1440.00']);
    expect(r.invoicesPaid.booksStarted).toBe(true);
  });

  it('handed to you: each hand-off by its recorded reason, most first; a test hand-off is not one', async () => {
    expect((await report()).handedToYou).toEqual([
      { reason: 'human_requested', n: 2 }, { reason: 'other', n: 1 }, { reason: 'stock_asked', n: 1 },
    ]);
  });

  it('no estimate until the owner sets minutes; then minutes × (alone + as written); the e-mail switch read', async () => {
    expect((await report()).estimate).toBeNull();
    expect((await report()).mailOff).toBe(false);
    await admin.query('update businesses set report_minutes_per_reply = 4, month_report_mail_off_at = now() where id = $1', [BIZ]);
    try {
      const r = await report();
      expect(r.estimate).toEqual({ minutesPerReply: 4, replies: 3, minutes: 12 });
      expect(r.mailOff).toBe(true);
    } finally {
      await admin.query('update businesses set report_minutes_per_reply = null, month_report_mail_off_at = null where id = $1', [BIZ]);
    }
  });

  it('an empty month is zeros and no money, and no books', async () => {
    const r = await report(EMPTY);
    expect(r).toMatchObject({
      customersAnswered: 0, replies: { alone: 0, drafted: 0, asWritten: 0, edited: 0, notSent: 0 },
      firstReply: { medianSeconds: null, measured: 0, waiting: 0 }, orders: { confirmed: 0, totals: [] },
      invoicesPaid: { count: 0, totals: [], booksStarted: false }, handedToYou: [], estimate: null, mailOff: false,
    });
  });

  it('the frame: the first month is the month it began, in its zone; the picker newest first', async () => {
    const f = await tx(BIZ, (t) => monthFrame(t, bid(BIZ), NOW));
    expect(f).toMatchObject({ zone: 'Europe/London', first: '2026-09', current: '2026-11', months: ['2026-11', '2026-10', '2026-09'] });
    expect(f.startedAt.toISOString()).toBe('2026-09-14T10:00:00.000Z');
  });

  it('another workspace reads none of it', async () => {
    const r = await report(EMPTY);
    expect(r.customersAnswered + r.replies.alone + r.orders.confirmed + r.invoicesPaid.count).toBe(0);
  });
});

/**
 * Block 4.3 B3 — the month page's routes, through the real app: the month in the address (the design spec §1.2), the
 * owner's minutes per reply (§2.1, §2.4) and the monthly e-mail's switch (§3.3). The page itself is the frontend's;
 * nothing here reads its markup beyond the Results tabs, which app.ts draws.
 */
const RUN = randomUUID().slice(0, 8);
const ROUTES_BIZ = `dd431000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const CODE = 'month-report-owner-code';

d('Block 4.3 · the month page\'s routes (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: Db, admin: pg.Client;
  let ownerCookie = '', staffCookie = '';
  const login = async (code: string) => String((await app.inject({
    method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM,
  })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const post = (cookie: string, url: string, payload: string) => app.inject({ method: 'POST', url, payload, headers: { cookie, ...FORM } });
  const setting = async () => (await admin.query<{ minutes: number | null; off: boolean }>(
    'select report_minutes_per_reply as minutes, month_report_mail_off_at is not null as off from businesses where id = $1', [ROUTES_BIZ])).rows[0]!;
  const current = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);

  beforeAll(async () => {
    const { seedRunTenant } = await import('./tenant.js');
    await seedRunTenant();
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { settingsHref } = await import('../../src/api/web/settingsNavigation.js');
    db = createDb(process.env['DATABASE_URL']!);
    admin = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] });
    await admin.connect();
    await admin.query(`insert into businesses (id, name, timezone, created_at) values ($1, 'Month Routes Co', 'Europe/London', '2026-09-14T10:00:00Z')`, [ROUTES_BIZ]);
    process.env['PILOT_BUSINESS_ID'] = ROUTES_BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: ROUTES_BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    ownerCookie = await login(CODE);
    expect(ownerCookie).not.toBe('');
    const added = await post(ownerCookie, '/app/settings/people', 'name=Xiao%20Chen');
    const issued = String(added.headers['set-cookie'] ?? '').split(';')[0]!;
    const people = await app.inject({ method: 'GET', url: settingsHref(String(added.headers['location'])), headers: { cookie: `${ownerCookie}; ${issued}` } });
    const code = people.body.match(/<p class="code"><bdi>([A-Z2-9]{5}-[A-Z2-9]{5})<\/bdi><\/p>/)?.[1] ?? '';
    staffCookie = await login(code);
    expect(staffCookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); await admin?.end(); });

  it('Results has a fourth tab, a door to the month page; the month page draws the row with it current', async () => {
    const results = await get(ownerCookie, '/app/results');
    expect(results.statusCode).toBe(200);
    expect(results.body).toMatch(/<a class="tab"\s+href="\/app\/results\/month">Monthly report<\/a>/);
    const month = await get(ownerCookie, '/app/results/month');
    expect(month.statusCode).toBe(200);
    expect(month.body).toMatch(/<a class="tab on" aria-current="page"\s+href="\/app\/results\/month">Monthly report<\/a>/);
    expect(month.body).toMatch(/<a class="tab"\s+href="\/app\/results">/);
  });

  it('the month in the address: absent is the current month; malformed, too late or too early is a 302', async () => {
    expect((await get(ownerCookie, '/app/results/month')).statusCode).toBe(200);
    expect((await get(ownerCookie, '/app/results/month?month=2026-09')).statusCode).toBe(200);
    expect((await get(ownerCookie, `/app/results/month?month=${current}`)).statusCode).toBe(200);
    for (const [asked, to] of [['2026-13', current], ['abc', current], ['2026-1', current], ['', current], ['2999-01', current], ['2026-08', '2026-09'], ['2001-01', '2026-09']]) {
      const r = await get(ownerCookie, `/app/results/month?month=${asked}`);
      expect([asked, r.statusCode, r.headers['location']]).toEqual([asked, 302, `/app/results/month?month=${to}`]);
    }
    expect((await get(staffCookie, '/app/results/month?month=2026-10')).statusCode).toBe(200);
  });

  it('minutes per reply: the owner saves 1–60, empty removes it, anything else is refused and changes nothing', async () => {
    const { flashSaid } = await import('./tenant.js');
    let r = await post(ownerCookie, '/app/results/month/minutes', 'minutes=5&month=2026-10');
    expect([r.statusCode, r.headers['location'], flashSaid(r, SECRET)]).toEqual([302, '/app/results/month?month=2026-10', 'Saved. The estimate now uses 5 minutes a reply.']);
    expect((await setting()).minutes).toBe(5);
    for (const bad of ['0', '61', '5.5', '-3', 'five', '1 0', '005', '1e1', '٥']) {
      r = await post(ownerCookie, '/app/results/month/minutes', `minutes=${encodeURIComponent(bad)}&month=2026-10`);
      expect([bad, flashSaid(r, SECRET)]).toEqual([bad, 'Type a whole number from 1 to 60, or leave it empty. Nothing was changed.']);
    }
    expect((await setting()).minutes).toBe(5);
    r = await post(ownerCookie, '/app/results/month/minutes', 'minutes=60&month=2026-10');
    expect((await setting()).minutes).toBe(60);
    r = await post(ownerCookie, '/app/results/month/minutes', 'minutes=%2012%20&month=nonsense');
    expect([r.headers['location'], (await setting()).minutes]).toEqual(['/app/results/month', 12]);
    r = await post(ownerCookie, '/app/results/month/minutes', 'minutes=&month=2026-10');
    expect([flashSaid(r, SECRET), (await setting()).minutes]).toEqual(['Removed. The page no longer shows an estimate.', null]);
    const audited = (await admin.query<{ detail: { fields: string[] } }>(
      `select detail from channel_audit where business_id = $1 and action = 'update_profile' order by at, id`, [ROUTES_BIZ])).rows;
    expect(audited.map((a) => a.detail.fields)).toEqual([['report_minutes_per_reply'], ['report_minutes_per_reply'], ['report_minutes_per_reply'], ['report_minutes_per_reply']]);
  });

  it('minutes per reply are the owner\'s: a colleague\'s post changes nothing', async () => {
    const { flashSaid } = await import('./tenant.js');
    await post(ownerCookie, '/app/results/month/minutes', 'minutes=4&month=2026-10');
    const r = await post(staffCookie, '/app/results/month/minutes', 'minutes=9&month=2026-10');
    expect([r.headers['location'], flashSaid(r, SECRET)]).toEqual(['/app/results/month?month=2026-10', 'Only the owner can change this. Nothing was changed.']);
    expect((await setting()).minutes).toBe(4);
    const cleared = await post(staffCookie, '/app/results/month/minutes', 'minutes=&month=2026-10');
    expect([flashSaid(cleared, SECRET), (await setting()).minutes]).toEqual(['Only the owner can change this. Nothing was changed.', 4]);
  });

  it('the monthly e-mail: on by default; the owner stops it and starts it; mail=maybe is a 400; a colleague changes nothing', async () => {
    const { flashSaid } = await import('./tenant.js');
    expect((await setting()).off).toBe(false);
    let r = await post(ownerCookie, '/app/results/month/mail', 'mail=off&month=2026-10');
    expect([r.headers['location'], flashSaid(r, SECRET), (await setting()).off])
      .toEqual(['/app/results/month?month=2026-10', 'The monthly e-mail is stopped. Nothing more will be sent.', true]);
    r = await post(ownerCookie, '/app/results/month/mail', 'mail=maybe&month=2026-10');
    expect([r.statusCode, flashSaid(r, SECRET), (await setting()).off]).toEqual([400, '', true]);
    r = await post(staffCookie, '/app/results/month/mail', 'mail=on&month=2026-10');
    expect([flashSaid(r, SECRET), (await setting()).off]).toEqual(['Only the owner can change this. Nothing was changed.', true]);
    r = await post(ownerCookie, '/app/results/month/mail', 'mail=on&month=2026-10');
    expect([flashSaid(r, SECRET), (await setting()).off]).toEqual(['The monthly e-mail is on. The next one comes on the 1st.', false]);
    r = await post(ownerCookie, '/app/results/month/mail', 'month=2026-10');
    expect([r.statusCode, (await setting()).off]).toEqual([400, false]);
    r = await post(staffCookie, '/app/results/month/mail', 'mail=off&month=2026-10');
    expect((await setting()).off).toBe(false);
  });
});
