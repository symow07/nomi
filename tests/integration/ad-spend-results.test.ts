import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { flashSaid } from './tenant.js';
import { withoutIsolates, unisolatedFigures } from '../parity/isolates.js';

/**
 * 0238 — ad spend beside orders on Results, and "Record as a cost", through the real routes.
 *
 * What only this can prove: the card shows last month's spend per placement as Meta's own strings summed exactly, an
 * invented placement under "Other placements" (never dropped, never added to another), each currency apart, and beside
 * Instagram and Messenger the orders from those channels' conversations — never an owner's test, never a cancelled
 * one; the label says it is not attribution. Staff see the card's one line and no figure. "Record as a cost" fills the
 * bill form (estimated, Meta's figure named), posts through the one bill writer, links the bill back so the offer is
 * gone, and refuses a second record of the same month and placement — posting nothing. A placement in two currencies
 * is never offered. Nothing here asks Meta.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `dd560000-0000-4000-8000-${RUN}0011`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const ACCOUNT = '777888999';
const ZONE = 'America/New_York';

d('0238 · ad spend on Results, and recorded as a cost (requires DATABASE_URL)', { timeout: 180_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let owner = ''; let staff = '';
  let month = ''; let lastDay = ''; let expenseId = '';
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  const login = async (code: string) => {
    const res = await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM });
    return String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  };
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const post = (cookie: string, url: string, body: Record<string, string>) =>
    app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(), headers: { cookie, ...FORM } });
  const card = (html: string) => withoutIsolates(/<section class="results-section" id="ad-spend"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '');
  const bills = async () => (await admin.query(`select b.id::text as id, e.document_ref as ref, e.label from spending_bills b join journal_entries e on e.id = b.entry_id where b.business_id = $1 order by b.created_at`, [BIZ])).rows;
  const recorded = async () => (await admin.query(`select platform, spend_seen, currency, bill_id::text as bill_id from ad_spend_recorded where business_id = $1 order by platform`, [BIZ])).rows;
  const billForm = (html: string) => /<section class="block" id="bill">[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL }); await admin.connect();
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    const { dayKey } = await import('../../src/core/owner/i18n/format.js');
    const { monthDays } = await import('../../src/core/ads/spend.js');
    // Last month in the workspace's (and the account's) own day: a month that is over, so the bill dates its last day.
    const today = dayKey(new Date(), ZONE);
    const first = new Date(`${today.slice(0, 7)}-01T12:00:00Z`); first.setUTCMonth(first.getUTCMonth() - 1);
    month = first.toISOString().slice(0, 7);
    lastDay = monthDays(month)!.last;
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area, timezone, owner_locale) values ($1, $2, 'service', 'US', 'USD', true, $3, 'en')`, [BIZ, `Ads Results ${RUN}`, ZONE]);
    db = createDb(DATABASE_URL!);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: { level: 'error' } });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: `adr-${RUN}`, sessionSecret: SECRET, factsTtlMs: 0, credentialKey: Buffer.alloc(32, 7),
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      publicBaseUrl: 'https://nomi.test', kickOutbound: async () => {}, kickDrive: async () => {},
      adsLogin: { appId: '4070500000000001', appSecret: 'app-secret', configId: '9876543210' },
      adsFetch: async () => { throw new Error('Meta is never asked here'); },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    owner = await login(`adr-${RUN}`);
    const team = await addPerson(db, BIZ, SECRET, `Staff ${RUN}`, 'team'); if (team.code !== 'added') throw new Error('fixture');
    staff = await login(team.accessCode);
    // The US pack, as the owner loads it; the year opens on the first of last month so the bill's day is in it.
    expect((await post(owner, '/app/books/country', { country: 'US', period: 'month', year_start: `${month}-01` })).statusCode).toBe(302);
    expenseId = (await admin.query(`select id::text as id from accounts a where business_id = $1 and kind = 'expense' and is_active
      and not exists (select 1 from accounts c where c.parent_id = a.id) order by code limit 1`, [BIZ])).rows[0].id;

    // The connection (as the choose route writes it) and last month's days, Meta's strings exactly.
    const conn = (await admin.query(`insert into ad_spend_connections (business_id, ad_account_id, ad_account_name, account_currency, timezone_name, token_ciphertext, token_fingerprint, connected_by)
      values ($1, $2, 'Shop ads', 'USD', $3, 'v1.fixture', 'fixture', 'owner') returning id::text as id`, [BIZ, ACCOUNT, ZONE])).rows[0].id;
    const day = (n: number) => `${month}-${String(n).padStart(2, '0')}`;
    const rows: Array<[string, string, string, string]> = [
      [day(1), 'instagram', '12.40', 'USD'], [day(2), 'instagram', '0.10', 'USD'], [day(3), 'instagram', '1000000.01', 'USD'],
      [day(1), 'facebook', '3.33', 'USD'],
      [day(2), 'zz_invented_place', '7.77', 'USD'],
      [day(4), 'messenger', '5', 'USD'], [day(5), 'messenger', '2.5', 'EUR'],
    ];
    for (const [dd, p, a, c] of rows) {
      await admin.query(`insert into ad_spend_days (business_id, ad_account_id, day, platform, amount, currency, timezone_name) values ($1, $2, $3, $4, $5, $6, $7)`, [BIZ, ACCOUNT, dd, p, a, c, ZONE]);
    }
    await admin.query(`insert into ad_spend_reads (business_id, connection_id, ad_account_id, since, until, finished_at, pages, rows_read, outcome) values ($1, $2, $3, $4, $5, now(), 1, 7, 'ok')`, [BIZ, conn, ACCOUNT, `${month}-01`, lastDay]);

    // Orders: two from Instagram (one an owner's test), one cancelled, one on Messenger, one on WhatsApp, one the month before.
    const product = (await admin.query(`insert into products (business_id, sku, name) values ($1, $2, 'Tote') returning id::text as id`, [BIZ, `ADR-${RUN}`])).rows[0].id;
    const order = async (n: number, channel: string, total: string, status: string, at: string, testing = false) => {
      const client = (await admin.query(`insert into clients (business_id, display_name) values ($1, $2) returning id::text as id`, [BIZ, `Customer ${n}`])).rows[0].id;
      const conv = (await admin.query(`insert into conversations (business_id, client_id, channel, owner_testing) values ($1, $2, $3, $4) returning id::text as id`, [BIZ, client, channel, testing])).rows[0].id;
      await admin.query(`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, total_value_usd, currency, status, confirmed_at)
        values ($1, $2, $3, $4, $5, 1, 'pcs', $6, 'USD', $7, ($8::date + time '12:00') at time zone $9)`, [`ADR-${RUN}-${n}`, BIZ, client, conv, product, total, status, at, ZONE]);
    };
    await order(1, 'instagram', '40', 'confirmed', day(6));
    await order(2, 'instagram', '25.50', 'shipped', day(7));
    await order(3, 'instagram', '999', 'confirmed', day(8), true);
    await order(4, 'instagram', '888', 'cancelled', day(9));
    await order(5, 'messenger', '10', 'confirmed', day(10));
    await order(6, 'whatsapp', '777', 'confirmed', day(11));
    const before = new Date(`${month}-01T12:00:00Z`); before.setUTCDate(0);
    await order(7, 'instagram', '666', 'confirmed', before.toISOString().slice(0, 10));
  }, 90_000);
  afterAll(async () => {
    await admin?.query(`update ad_spend_connections set archived_at = now(), archived_by = 'test' where business_id = $1 and archived_at is null`, [BIZ]);
    await app?.close(); await db?.destroy(); await admin?.end();
  });

  it('THE COMPARISON: exact sums per placement, an invented one shown as itself, currencies apart, orders beside their channel, the label', async () => {
    const r = await get(owner, `/app/results?month=${month}`);
    expect(r.statusCode).toBe(200);
    const c = card(r.body);
    expect(c).toContain(t('en', 'adSpend.label'));
    expect(c).toContain('USD 1000012.51');                                   // 12.40 + 0.10 + 1000000.01, never a float
    expect(c).toContain('USD 3.33');
    expect(c).toContain(t('en', 'adSpend.place.other', { platform: 'zz_invented_place' }));
    expect(c).toContain('USD 7.77');
    expect(c).not.toContain('1000020.28');                                   // the invented placement summed into Instagram
    expect(c).toContain('USD 5');
    expect(c).toContain('EUR 2.5');                                          // its own line, never added to the dollars
    expect(c).not.toContain('USD 7.5');
    // Instagram: the confirmed and the shipped order, 65.5 — not the test, not the cancelled one, not the month before.
    expect(c).toContain(t('en', 'adSpend.orders.count', { count: '2' }));
    expect(c).toContain('USD 65.5');
    expect(c).not.toContain('999'); expect(c).not.toContain('888'); expect(c).not.toContain('666'); expect(c).not.toContain('777');
    expect(c).toContain(t('en', 'adSpend.orders.count', { count: '1' }));    // Messenger's one
    expect(c).toContain(t('en', 'adSpend.facebookNote'));
    expect(c).toContain(t('en', 'adSpend.otherNote'));
    // Each single-currency placement is offered; Messenger, in two currencies, is offered too but never prefilled (below).
    expect(r.body).toContain(`/app/books/spending?ads=${encodeURIComponent(`${month}.instagram`)}#bill`);
    expect(r.body).toContain(`/app/books/spending?ads=${encodeURIComponent(`${month}.zz_invented_place`)}#bill`);
  });

  it('RIGHT TO LEFT: on an Arabic page every figure on the card is isolated, and the zone line appears only when the zones differ', async () => {
    const r = await app.inject({ method: 'GET', url: `/app/results?month=${month}`, headers: { cookie: `${owner}; yf_locale=ar` } });
    const section = /<section class="results-section" id="ad-spend"[\s\S]*?<\/section>/.exec(r.body)?.[0] ?? '';
    expect(section).not.toBe('');
    expect(unisolatedFigures(section)).toEqual([]);
    expect(card((await get(owner, `/app/results?month=${month}`)).body)).not.toContain(t('en', 'adSpend.zone', { zone: ZONE, workspace: ZONE }));
    await admin.query(`update businesses set timezone = 'Europe/Paris' where id = $1`, [BIZ]);
    try {
      expect(card((await get(owner, `/app/results?month=${month}`)).body)).toContain(t('en', 'adSpend.zone', { zone: ZONE, workspace: 'Europe/Paris' }));
    } finally { await admin.query(`update businesses set timezone = $2 where id = $1`, [BIZ, ZONE]); }
  });

  it('STAFF see one line and no figure; the bill form is not theirs and the prefill is never drawn for them', async () => {
    const c = card((await get(staff, `/app/results?month=${month}`)).body);
    expect(c).toContain(t('en', 'adSpend.staff'));
    expect(c).not.toMatch(/USD|EUR|[0-9]\.[0-9]/);
    const s = await get(staff, `/app/books/spending?ads=${encodeURIComponent(`${month}.instagram`)}`);
    expect(billForm(s.body)).toBe('');
    expect(s.body).not.toContain('1000012.51');
    const p = await post(staff, '/app/books/spending/bills', { ads: `${month}.instagram`, date: lastDay, label: 'x', ref: 'X1', gross: '1', newSupplier: 'Meta', account: expenseId });
    expect(flashSaid(p, SECRET)).toBe(t('en', 'staff.booksNotYours'));      // the books' own gate, before the bill's
    expect(await bills()).toEqual([]);
    expect(await recorded()).toEqual([]);
  });

  it('RECORD AS A COST: the form filled and marked estimated; posted through the bill writer; linked; never offered or posted twice', async () => {
    const page = await get(owner, `/app/books/spending?ads=${encodeURIComponent(`${month}.instagram`)}`);
    const form = billForm(page.body);
    expect(form).toContain(t('en', 'adSpend.prefill.title'));
    expect(withoutIsolates(form)).toContain(t('en', 'adSpend.prefill.estimated', { platform: 'Instagram', month, amount: 'USD 1000012.51' }));
    expect(form).toContain(`name="ads" value="${month}.instagram"`);
    expect(form).toContain(`value="${lastDay}"`);
    expect(form).toContain(`value="Meta ads, Instagram, ${month}"`);
    expect(form).toContain('value="1000012.51"');
    expect(form).toContain('name="newSupplier"');

    const sent = { ads: `${month}.instagram`, date: lastDay, label: `Meta ads, Instagram, ${month}`, ref: `FBADS-${RUN}`, gross: '1000012.51', newSupplier: 'Meta', account: expenseId };
    const first = await post(owner, '/app/books/spending/bills', sent);
    expect(first.headers['location']).toBe('/app/results#ad-spend');
    const [bill] = await bills();
    expect(bill).toMatchObject({ ref: `FBADS-${RUN}`, label: `Meta ads, Instagram, ${month}` });
    expect(await recorded()).toEqual([{ platform: 'instagram', spend_seen: '1000012.51', currency: 'USD', bill_id: bill!.id }]);
    // The trial balance still ties: the one writer posted it.
    const tb = (await admin.query(`select coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0) as diff from journal_lines l join journal_entries e on e.id = l.entry_id where e.business_id = $1`, [BIZ])).rows[0];
    expect(Number(tb.diff)).toBe(0);

    const after = card((await get(owner, `/app/results?month=${month}`)).body);
    expect(after).toContain(t('en', 'adSpend.recorded'));
    expect((await get(owner, `/app/results?month=${month}`)).body).not.toContain(`ads=${encodeURIComponent(`${month}.instagram`)}`);
    expect(billForm((await get(owner, `/app/books/spending?ads=${encodeURIComponent(`${month}.instagram`)}`)).body)).not.toContain('name="ads"');
    const again = await post(owner, '/app/books/spending/bills', { ...sent, ref: `FBADS-${RUN}-2` });
    expect(again.headers['location']).toBe('/app/results#ad-spend');
    expect(flashSaid(again, SECRET)).toBe(t('en', 'adSpend.flash.recordRefused'));
    expect(await bills()).toHaveLength(1);
  });

  it('A PLACEMENT IN TWO CURRENCIES, or one with no spend, is never recorded: nothing posted', async () => {
    const m = await get(owner, `/app/books/spending?ads=${encodeURIComponent(`${month}.messenger`)}`);
    expect(billForm(m.body)).not.toContain('name="ads"');
    for (const ads of [`${month}.messenger`, `${month}.nowhere`, 'not-a-month.instagram']) {
      const p = await post(owner, '/app/books/spending/bills', { ads, date: lastDay, label: 'Meta ads', ref: `X-${RUN}-${ads.length}`, gross: '5', newSupplier: 'Meta', account: expenseId });
      expect(flashSaid(p, SECRET)).toBe(t('en', 'adSpend.flash.recordRefused'));
    }
    expect(await bills()).toHaveLength(1);
    expect((await recorded()).map((r) => r.platform)).toEqual(['instagram']);
  });

  it('AN INVENTED PLACEMENT is recorded under its own name, and the bill is an ordinary bill (no ads, no link)', async () => {
    const p = await post(owner, '/app/books/spending/bills', { ads: `${month}.zz_invented_place`, date: lastDay, label: 'Meta ads, other', ref: `FBO-${RUN}`, gross: '7.77', newSupplier: 'Meta', account: expenseId });
    expect(flashSaid(p, SECRET)).toMatch(/^Recorded as a cost: /);
    expect((await recorded()).map((r) => [r.platform, r.spend_seen])).toEqual([['instagram', '1000012.51'], ['zz_invented_place', '7.77']]);
    const plain = await post(owner, '/app/books/spending/bills', { date: lastDay, label: 'Paper', ref: `P-${RUN}`, gross: '1', newSupplier: 'Stationer', account: expenseId });
    expect(plain.headers['location']).toBe('/app/books/spending#unpaid');
    expect(await bills()).toHaveLength(3);
    expect(await recorded()).toHaveLength(2);
  });

  it('THE RACE: two presses of Record at once, both inside before either commits → one bill, one link, the other refused', async () => {
    // The barrier: this session holds the bill writer's own lock for a bill with no number (`nextNoref`), so each
    // request is inside its transaction and stopped before it can post — without the ads lock, both have already read
    // the offer as open. Released only once both are seen waiting.
    const barrier = new pg.Client({ connectionString: MIGRATE_URL }); await barrier.connect();
    try {
      await barrier.query(`select pg_advisory_lock(hashtext($1))`, [`${BIZ}:noref`]);
      const press = () => post(owner, '/app/books/spending/bills', { ads: `${month}.facebook`, date: lastDay, label: `Meta ads, Facebook, ${month}`, noref: '1', gross: '3.33', newSupplier: 'Meta', account: expenseId });
      const both = Promise.all([press(), press()]);
      const waiting = async () => Number((await admin.query(`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`)).rows[0].n);
      for (let i = 0; i < 200 && (await waiting()) < 2; i++) await new Promise((r) => setTimeout(r, 50));
      expect(await waiting()).toBe(2);
      await barrier.query(`select pg_advisory_unlock(hashtext($1))`, [`${BIZ}:noref`]);
      const answers = await both;
      expect(answers.map((r) => r.statusCode)).toEqual([302, 302]);
      expect(answers.map((r) => flashSaid(r, SECRET)).sort()).toEqual([t('en', 'adSpend.flash.recordRefused'), expect.stringMatching(/^Recorded as a cost: /)].sort());
    } finally { await barrier.end(); }
    const facebook = (await recorded()).filter((r) => r.platform === 'facebook');
    expect(facebook).toHaveLength(1);
    expect((await bills()).filter((b) => b.label === `Meta ads, Facebook, ${month}`)).toHaveLength(1);
    expect((await bills()).filter((b) => b.id === facebook[0]!.bill_id)).toHaveLength(1);
  });
});
