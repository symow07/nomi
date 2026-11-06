import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { offlineModels } from '../pipeline/fakes.js';
import type { ChannelAdapter, OutboundDocument, SendResult } from '../../src/channels/contract.js';

/**
 * 0226 (Block 2, PR 2) — INVOICES THAT GO OUT, in production's composition, over the WhatsApp simulator, Meta's and
 * Telegram's recorders and the fake mail transport.
 *
 *   · the owner turns the switch on, on the Books settings page;
 *   · an invoice sent from the conversation page on WhatsApp goes as a DOCUMENT whose link resolves to a PDF beginning
 *     `%PDF-`; on Messenger as a `file` attachment; by e-mail as an attachment of the same bytes; on Instagram as the
 *     order's proforma link, since Instagram carries no files;
 *   · a reminder due on day 3 goes on Telegram, once, with the disclosure first; one due on day 10 goes by e-mail and
 *     the day-3 one is never made up; a shut WhatsApp window and a customer who does not write in English each make a
 *     DRAFT for the owner, with the reason on the card, which the ten-minute expiry leaves alone;
 *   · the order-confirmed reply promises the invoice while the switch is on and not once it is off.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `d2260000-0000-4000-8000-${RUN}0001`;
const PID = `d2260000-0000-4000-8000-${RUN}0002`;
const CODE = `inv-out-${RUN}`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const APP_SECRET = `meta-app-secret-${RUN}`;
const IG_ACCOUNT = `1784${runDigits(RUN, 10)}`;
const PAGE_ID = `1020${runDigits(RUN, 10)}`;
const BOT = '7099990001';
const TG_ENV = { TELEGRAM_BOT_TOKEN: `${BOT}:AAtest-token-not-real_0123456789`, TELEGRAM_WEBHOOK_SECRET: 'tg-webhook-secret-for-invoices-test', TELEGRAM_BOT_USERNAME: 'NomiInvoiceBot' };
type Tx = import('../../src/db/client.js').Tx;

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 60_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Today at noon UTC: inside the sweep's daytime for a workspace on UTC, whatever hour this test runs at. */
const NOON = new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z');
// Counted back from the EARLIER of real now (the database's `now()` in `invoice_reminder_workspaces()`) and the sweep's noon.
const daysAgo = (n: number, extraHours = 1) => new Date(Math.min(Date.now(), NOON.getTime()) - n * 86_400_000 - extraHours * 3_600_000);

d('0226 · invoices that go out (requires DATABASE_URL)', { timeout: 240_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let transport: ReturnType<typeof import('../../src/channels/email/transport.js')['fakeMailTransport']>;
  let cookie = '';
  let party = '';
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let esc: typeof import('../../src/api/web/layout.js')['esc'];
  /** What each channel was asked to send, instead of a provider. */
  const wa: { texts: { to: string; body: string }[]; docs: { to: string; doc: OutboundDocument }[] } = { texts: [], docs: [] };
  const meta: { account: string; message: Record<string, unknown> }[] = [];
  const tg: { method: string; body: Record<string, unknown> }[] = [];
  let n = 0;

  const q = async <R>(fn: (tx: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, BIZ as never, fn);
  };
  const post = (url: string, fields: Record<string, string> = {}) => prod.app.inject({
    method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });
  /** The notice the redirect's page shows. */
  const landed = async (res: Awaited<ReturnType<typeof post>>) => {
    expect(res.statusCode).toBe(302);
    const flash = String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    const page = await prod.app.inject({ method: 'GET', url: String(res.headers.location).replace(/#.*$/, ''), headers: { cookie: `${cookie}; ${flash}` } });
    return page.body;
  };
  const rowsOf = (cid: string) => q(async (tx) => (await sql<{ id: string; body: string; status: string; kind: string; media_url: string | null; origin: string; subject: string | null; cancel_reason: string | null }>`
    select id::text as id, body, status, kind, media_url, origin, subject, cancel_reason from outbound_messages where conversation_id = ${cid}::uuid order by seq`.execute(tx)).rows);
  const sentRow = async (cid: string, kind: string) => {
    const end = Date.now() + 60_000;
    for (;;) {
      const rows = await rowsOf(cid);
      const hit = rows.find((r) => r.kind === kind && r.status === 'sent');
      if (hit) return hit;
      // A refused row is a plain failure, named: never a timeout to puzzle over.
      if (rows.some((r) => r.kind === kind && (r.status === 'canceled' || r.status === 'failed')) || Date.now() > end) {
        throw new Error(`no ${kind} row sent in ${cid}: ${JSON.stringify(rows.map((r) => ({ kind: r.kind, status: r.status, why: r.cancel_reason })))}`);
      }
      await pause(200);
    }
  };

  /**
   * One customer on one channel, their confirmed order, and the invoice the books made of it and issued — the chain an
   * invoice reaches a customer through (`invoices.source_order_id` → `orders.conversation_id`).
   */
  type Fix = { cid: string; clientId: string; orderId: string; invoiceId: string; key: string };
  const fixture = async (channel: 'whatsapp' | 'instagram' | 'messenger' | 'telegram' | 'email', identity: string, name: string, o: { proforma?: boolean; language?: string } = {}): Promise<Fix> => {
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { draftInvoiceFromOrder } = await import('../../src/db/booksOrders.js');
    const { issueInvoice } = await import('../../src/db/booksInvoices.js');
    return q(async (tx) => {
      const c = await ensureConversation(tx, BIZ as never, identity, name, channel);
      await sql`update client_channels set last_inbound_at = now() - interval '1 minute' where client_id = ${c.clientId}::uuid and channel = ${channel}`.execute(tx);
      await sql`update clients set preferred_language = ${o.language ?? 'en'} where id = ${c.clientId}::uuid`.execute(tx);
      const orderId = randomUUID();
      await sql`insert into orders (id, order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, status,
                                    agreed_unit_price_usd, total_value_usd, currency, payment_terms, incoterm, confirmed_at)
                values (${orderId}, ${`YW-${RUN}-${randomUUID().slice(0, 6)}`}, ${BIZ}, ${c.clientId}, ${c.conversationId}, ${PID}, 500, 'pcs', 'confirmed',
                        2.88, 1440.60, 'USD', ${o.proforma === false ? null : '30% deposit, 70% before shipment'}, ${o.proforma === false ? null : 'FOB Ningbo'}, now())`.execute(tx);
      const drafted = await draftInvoiceFromOrder(tx, BIZ, orderId, party, null, 'owner');
      if (drafted.kind !== 'drafted') throw new Error(`draft: ${JSON.stringify(drafted)}`);
      const issued = await issueInvoice(tx, BIZ, drafted.id, 'owner');
      if (issued.kind !== 'issued') throw new Error(`issue: ${JSON.stringify(issued)}`);
      return { cid: c.conversationId, clientId: c.clientId, orderId, invoiceId: drafted.id, key: issued.key };
    });
  };
  /** As if the invoice had gone from Nomi some days ago on its conversation's channel. */
  const sentAgo = (f: Fix, channel: string, days: number) => q((tx) => sql`insert into invoice_sends (business_id, invoice_id, conversation_id, channel, carried, sent_by, sent_at)
    values (${BIZ}, ${f.invoiceId}::uuid, ${f.cid}::uuid, ${channel}, 'pdf', 'owner', ${daysAgo(days)})`.execute(tx));
  const remind = async () => {
    const { remindDueInvoices } = await import('../../src/outbound/invoiceReminders.js');
    const { QUEUES } = await import('../../src/queue/boss.js');
    return remindDueInvoices({
      db: prod.db, now: () => NOON,
      kickDrive: async (businessId, conversationId) => { await prod.boss.send(QUEUES.outbound, { businessId, conversationId }, { singletonKey: conversationId }); },
      mailboxConnected: async () => true,
    });
  };
  const reminders = (f: Fix) => q(async (tx) => (await sql<{ nth: number; sent: boolean; draft_id: string | null; outbound_id: string | null }>`
    select nth, sent_at is not null as sent, draft_id::text as draft_id, outbound_id::text as outbound_id from invoice_reminders where invoice_id = ${f.invoiceId}::uuid order by nth`.execute(tx)).rows);
  const drafts = (cid: string) => q(async (tx) => (await sql<{ id: string; status: string; capability: string; draft_text: string }>`
    select id::text as id, status, capability, draft_text from drafts where conversation_id = ${cid}::uuid order by created_at`.execute(tx)).rows);

  beforeAll(async () => {
    Object.assign(process.env, TG_ENV);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    process.env['OWNER_ACCESS_CODE'] = CODE;
    process.env['META_PAGE_ACCESS_TOKEN'] = 'page-token-not-real';
    process.env['META_PAGE_ID'] = PAGE_ID;
    process.env['META_IG_ACCOUNT_ID'] = IG_ACCOUNT;
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { fakeMailTransport } = await import('../../src/channels/email/transport.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { setTelegram } = await import('../../src/db/telegram.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    ({ esc } = await import('../../src/api/web/layout.js'));
    const sim = whatsappSimulator([], { tag: `io${RUN}` });
    transport = fakeMailTransport();
    const setup = createDb(DATABASE_URL!);
    await withTenantTx(setup, BIZ as never, async (tx) => {
      await sql`insert into businesses (id, name, engine, kind, owner_locale, country, currency, timezone, books_area, postal_address)
                values (${BIZ}, ${`Invoices Out ${RUN}`}, 'service', 'brand', 'en', 'US', 'USD', 'UTC', true, '12 Harbour Road, Portsmouth')`.execute(tx);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 10000 where id = ${BIZ}`.execute(tx);
      await sql`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                values (${BIZ}, 'whatsapp', 'connected', '+971 50****0226', now(), now(), 'test', false)`.execute(tx);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(tx);
      await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, 'Lily', true)`.execute(tx);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
                on conflict (business_id) do update set assistant_named_at = now()`.execute(tx);
      await sql`insert into products (id, business_id, sku, name, unit, is_active) values (${PID}, ${BIZ}, ${'IO-' + RUN}, 'Canvas tote bag', 'pcs', true)`.execute(tx);
      await setTelegram(tx, BIZ as never, true, 'owner');
      // The books: a receivable, a sales account, the sales journal, this year, and the customer the invoices are made out to.
      const acc = async (code: string, kind: string) => (await sql<{ id: string }>`insert into accounts (business_id, code, name, kind) values (${BIZ}, ${code}, ${code}, ${kind}) returning id::text as id`.execute(tx)).rows[0]!.id;
      const receivable = await acc('1200', 'asset'); const sales = await acc('4000', 'income'); const bank = await acc('1000', 'asset');
      const ve = (await sql<{ id: string }>`insert into journals (business_id, code, name, kind) values (${BIZ}, 'SJ', 'Sales', 'sales') returning id::text as id`.execute(tx)).rows[0]!.id;
      await sql`insert into journals (business_id, code, name, kind) values (${BIZ}, 'BK', 'Bank', 'bank')`.execute(tx);
      const year = new Date().getUTCFullYear();
      await sql`insert into fiscal_years (business_id, starts_on, ends_on) values (${BIZ}, ${`${year}-01-01`}::date, ${`${year}-12-31`}::date)`.execute(tx);
      await sql`insert into books_settings (business_id, sales_journal_id, receivable_account_id, sales_account_id) values (${BIZ}, ${ve}::uuid, ${receivable}::uuid, ${sales}::uuid)`.execute(tx);
      void bank;
      party = (await sql<{ id: string }>`insert into parties (business_id, code, name, kind, country, address) values (${BIZ}, 'C001', 'Atlas Textiles SARL', 'customer', 'MA', '12 rue des Tisserands, Casablanca') returning id::text as id`.execute(tx)).rows[0]!.id;
    });
    await setup.destroy();

    const adapter: ChannelAdapter = {
      ...sim.adapter,
      sendText: async (to, body): Promise<SendResult> => { wa.texts.push({ to, body }); n += 1; return { ok: true, providerMessageId: `wamid.IO_${RUN}_${n}` }; },
      sendDocument: async (to, doc): Promise<SendResult> => { wa.docs.push({ to, doc }); n += 1; return { ok: true, providerMessageId: `wamid.IO_${RUN}_${n}` }; },
    };
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: sim.phoneNumberId,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: APP_SECRET,
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'io-verify-token-xxxx', CREDENTIAL_KEY: 'c'.repeat(64), PORT: 0,
      PUBLIC_BASE_URL: 'https://nomi.test',
    }, {
      adapter, logger: false, models: offlineModels(), mailTransport: transport,
      // Meta's Send API: a yes with a message id; a profile lookup: nobody known.
      metaFetch: async (url, init) => {
        if (init.method === 'GET') return { status: 400, text: async () => JSON.stringify({ error: {} }) };
        const account = decodeURIComponent(new URL(url).pathname.split('/').at(-2) ?? '');
        meta.push({ account, message: (JSON.parse(String(init.body)) as { message: Record<string, unknown> }).message });
        n += 1;
        return { status: 200, text: async () => JSON.stringify({ message_id: `m_io_${RUN}_${n}` }) };
      },
      telegramFetch: async (url, init) => {
        tg.push({ method: url.split('/').at(-1)!, body: JSON.parse(init.body) as Record<string, unknown> });
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 9000 + tg.length } }) };
      },
    } as Parameters<typeof buildProduction>[1]);
    const login = await prod.app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
    // The Page and the Instagram account, connected from the owner's page as C9 does.
    expect((await post('/app/channels/instagram/connect')).statusCode).toBe(302);
    expect((await post('/app/channels/messenger/connect')).statusCode).toBe(302);
  }, 120_000);

  afterAll(async () => {
    if (prod) {
      const { QUEUES } = await import('../../src/queue/boss.js');
      await until(async () => ((await sql<{ n: number }>`select count(*)::int as n from pgboss.job where name in (${QUEUES.inbound}, ${QUEUES.outbound}, ${QUEUES.notify})
        and data->>'businessId' = ${BIZ} and state in ('created', 'retry', 'active')`.execute(prod.db)).rows[0]!.n === 0 ? true : undefined), 'this test\'s jobs').catch(() => undefined);
    }
    await prod?.close();
    for (const k of [...Object.keys(TG_ENV), 'META_PAGE_ACCESS_TOKEN', 'META_PAGE_ID', 'META_IG_ACCOUNT_ID']) delete process.env[k];
  }, 90_000);

  it('THE SWITCH is off until the owner turns it on, on the Books settings page; off, a send is refused by name', async () => {
    const f = await fixture('whatsapp', `9715${runDigits(RUN, 5)}0001`, 'Ahmed');
    expect((await get('/app/books/invoices/' + f.invoiceId)).body).toContain(esc(t('en', 'invoice.send.off')));
    expect(await landed(await post(`/app/inbox/${f.cid}/invoice/send`, { invoice: f.invoiceId }))).toContain(esc(t('en', 'invoice.flash.off')));
    expect(await rowsOf(f.cid)).toEqual([]);
    const settings = await get('/app/settings/books/invoices-out');
    expect(settings.statusCode).toBe(200);
    expect(settings.body).toContain('name="on"');
    expect(await landed(await post('/app/settings/books/invoices-out', { on: '1' }))).toContain(esc(t('en', 'invoice.flash.switchedOn')));
    expect((await get('/app/settings/books')).body).toContain('/app/settings/books/invoices-out');
  });

  it('WHATSAPP: sent from the conversation page, the invoice goes as a DOCUMENT whose link is a PDF Nomi renders on demand', async () => {
    const f = await fixture('whatsapp', `9715${runDigits(RUN, 5)}0002`, 'Khalid');
    const page = (await get(`/app/inbox/${f.cid}`)).body;
    expect(page).toContain(`/app/inbox/${f.cid}/invoice/send`);
    expect(page).toContain(esc(t('en', 'invoice.row.title', { key: f.key })));
    expect(await landed(await post(`/app/inbox/${f.cid}/invoice/send`, { invoice: f.invoiceId }))).toContain(esc(t('en', 'invoice.flash.sentPdf')));
    const row = await sentRow(f.cid, 'document');
    expect(row.origin).toBe('owner');
    expect(row.media_url).toMatch(new RegExp(`^https://nomi\\.test/inv/[A-Za-z0-9_-]{32,}/${f.key}\\.pdf$`));
    const sent = wa.docs.find((x) => x.doc.url === row.media_url)!;
    expect(sent).toBeDefined();
    expect(sent.doc.filename).toBe(`${f.key}.pdf`);
    expect(sent.doc.caption).toContain(`Invoice ${f.key}`);
    // The link the provider fetches: a PDF, not stored anywhere, never cached or indexed.
    const pdf = await prod.app.inject({ method: 'GET', url: new URL(row.media_url!).pathname });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['cache-control']).toBe('no-store');
    expect(pdf.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(pdf.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.rawPayload.toString('latin1')).toContain(`(${f.key})`);
    expect(pdf.rawPayload.toString('latin1')).toContain('(Atlas Textiles SARL)');
    // A wrong name, a wrong token: nothing.
    expect((await prod.app.inject({ method: 'GET', url: new URL(row.media_url!).pathname.replace(`${f.key}.pdf`, 'other.pdf') })).statusCode).toBe(404);
    expect((await prod.app.inject({ method: 'GET', url: `/inv/${'x'.repeat(43)}/${f.key}.pdf` })).statusCode).toBe(404);
    // Recorded, once, as a PDF on WhatsApp; the trail says who.
    const sends = await q(async (tx) => (await sql<{ carried: string; channel: string; outbound_id: string }>`select carried, channel, outbound_id::text as outbound_id from invoice_sends where invoice_id = ${f.invoiceId}::uuid`.execute(tx)).rows);
    expect(sends).toEqual([{ carried: 'pdf', channel: 'whatsapp', outbound_id: row.id }]);
    expect((await get(`/app/books/invoices/${f.invoiceId}`)).body).toContain(esc(t('en', 'invoice.send.wentPdf', { channel: 'WhatsApp' })));
    expect(await q(async (tx) => (await sql<{ n: number }>`select count(*)::int as n from conversation_events where conversation_id = ${f.cid}::uuid and type = 'invoice_sent'`.execute(tx)).rows[0]!.n)).toBe(1);
    // Nothing of the figures or the customer travelled as a model's words: the row is the owner's, no draft was made.
    expect(await drafts(f.cid)).toEqual([]);
  });

  it('INSTAGRAM carries no files: the order\'s proforma link goes, as text; MESSENGER gets the PDF as a file attachment', async () => {
    const ig = await fixture('instagram', `PSID_ig_${RUN}`, 'Fatima');
    expect(await landed(await post(`/app/inbox/${ig.cid}/invoice/send`, { invoice: ig.invoiceId }))).toContain(esc(t('en', 'invoice.flash.sentLink')));
    const igRow = await sentRow(ig.cid, 'text');
    const token = await q(async (tx) => (await sql<{ t: string | null }>`select proforma_token as t from orders where id = ${ig.orderId}::uuid`.execute(tx)).rows[0]!.t);
    expect(token).not.toBeNull();
    expect(igRow.body).toContain(`https://nomi.test/pi/${token}`);
    expect(igRow.body).toContain(`Invoice ${ig.key}`);
    const igSent = meta.find((m) => String(m.message['text'] ?? '').includes(`/pi/${token}`));
    expect(igSent, JSON.stringify(meta)).toBeDefined();
    expect(await q(async (tx) => (await sql<{ carried: string }>`select carried from invoice_sends where invoice_id = ${ig.invoiceId}::uuid`.execute(tx)).rows)).toEqual([{ carried: 'link' }]);
    // And the proforma page itself opens for the customer.
    expect((await prod.app.inject({ method: 'GET', url: `/pi/${token}` })).statusCode).toBe(200);

    const ms = await fixture('messenger', `PSID_ms_${RUN}`, 'Omar');
    expect(await landed(await post(`/app/inbox/${ms.cid}/invoice/send`, { invoice: ms.invoiceId }))).toContain(esc(t('en', 'invoice.flash.sentPdf')));
    const msRow = await sentRow(ms.cid, 'document');
    const msSent = meta.find((m) => JSON.stringify(m.message).includes(msRow.media_url!))!;
    expect(msSent, JSON.stringify(meta)).toBeDefined();
    expect(msSent.message).toEqual({ attachment: { type: 'file', payload: { url: msRow.media_url, is_reusable: false } } });
    expect(msRow.body).toBe('');   // Meta carries no caption on a file
  });

  it('E-MAIL, from the invoice\'s page: the PDF is attached, the same bytes the link serves', async () => {
    const f = await fixture('email', `khalid-${RUN}@buyer.example`, 'Khalid Mansoor');
    expect(await landed(await post(`/app/books/invoices/${f.invoiceId}/send`))).toContain(esc(t('en', 'invoice.flash.sentPdf')));
    const row = await sentRow(f.cid, 'document');
    expect(row.subject).toBe(`Invoice ${f.key} from Invoices Out ${RUN}`);
    const mail = transport.sent.find((m) => m.subject === row.subject)!;
    expect(mail).toBeDefined();
    expect(mail.to).toBe(`khalid-${RUN}@buyer.example`);
    expect(mail.text).toBe(`Invoice ${f.key} for USD 1,440.60 is attached.`);
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments![0]!.filename).toBe(`${f.key}.pdf`);
    expect(mail.attachments![0]!.contentType).toBe('application/pdf');
    expect(Buffer.from(mail.attachments![0]!.bytes).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const served = await prod.app.inject({ method: 'GET', url: new URL(row.media_url!).pathname });
    expect(Buffer.from(mail.attachments![0]!.bytes).equals(served.rawPayload)).toBe(true);
  });

  it('A REMINDER DUE ON DAY 3 goes on Telegram, in English, with the disclosure first — once, however often the sweep runs', async () => {
    const f = await fixture('telegram', String(100_000_000 + Number(runDigits(RUN, 6))), 'Amal');
    await sentAgo(f, 'telegram', 3);
    const r1 = await remind();
    expect(r1.sent).toBeGreaterThanOrEqual(1);
    const row = await sentRow(f.cid, 'text');
    expect(row.origin).toBe('employee');
    expect(row.body).toContain(`A reminder that invoice ${f.key} for USD 1,440.60 is still open.`);
    expect(row.body).toContain('AI assistant');   // rule 3: the first message nobody approved says what is writing
    const said = tg.filter((x) => x.method === 'sendMessage' && String(x.body['text']).includes(`invoice ${f.key}`));
    expect(said).toHaveLength(1);
    expect(await reminders(f)).toEqual([{ nth: 1, sent: true, draft_id: null, outbound_id: row.id }]);
    // Again: nothing new.
    await remind();
    await pause(500);
    expect(tg.filter((x) => x.method === 'sendMessage' && String(x.body['text']).includes(`invoice ${f.key}`))).toHaveLength(1);
    expect((await reminders(f)).length).toBe(1);
    expect((await get(`/app/books/invoices/${f.invoiceId}`)).body).toContain(esc(t('en', 'invoice.send.reminderSent', { days: '3' })));
  });

  it('A REMINDER DUE ON DAY 10 goes by e-mail, as the second reminder alone — the third day\'s is not made up', async () => {
    const f = await fixture('email', `omar-${RUN}@buyer.example`, 'Omar');
    await sentAgo(f, 'email', 10);
    await remind();
    const row = await sentRow(f.cid, 'text');
    expect(row.subject).toBe(`Reminder: invoice ${f.key} from Invoices Out ${RUN}`);
    const mail = transport.sent.find((m) => m.subject === row.subject)!;
    expect(mail).toBeDefined();
    expect(mail.text).toContain(`invoice ${f.key} for USD 1,440.60 is still open`);
    expect(mail.attachments ?? []).toHaveLength(0);
    expect((await reminders(f)).map((r) => [r.nth, r.sent])).toEqual([[2, true]]);
  });

  it('A SHUT WINDOW on WhatsApp makes a DRAFT for the owner, with the reason on the card, which the expiry sweep leaves alone', async () => {
    const f = await fixture('whatsapp', `9715${runDigits(RUN, 5)}0003`, 'Noura');
    await q((tx) => sql`update client_channels set last_inbound_at = now() - interval '2 days' where client_id = ${f.clientId}::uuid`.execute(tx));
    await sentAgo(f, 'whatsapp', 3);
    const before = (await rowsOf(f.cid)).length;
    const r = await remind();
    expect(r.drafted).toBeGreaterThanOrEqual(1);
    const [draft] = await drafts(f.cid);
    expect(draft).toMatchObject({ status: 'pending', capability: 'follow_up' });
    expect(draft!.draft_text).toContain(`A reminder that invoice ${f.key}`);
    expect((await reminders(f))).toEqual([{ nth: 1, sent: false, draft_id: draft!.id, outbound_id: null }]);
    expect((await rowsOf(f.cid)).length).toBe(before);   // nothing queued
    const page = (await get(`/app/inbox/${f.cid}`)).body;
    expect(page).toContain(esc(t('en', 'inbox.draft.held.invoice_window', { key: f.key, name: 'Lily' })));
    // The ten-minute expiry (G5b) would mark a waiting WhatsApp reply expired after the day; this one stays the owner's.
    await sql`select expire_waiting_drafts()`.execute(prod.db);
    expect((await drafts(f.cid))[0]!.status).toBe('pending');
    expect((await get(`/app/books/invoices/${f.invoiceId}`)).body).toContain(esc(t('en', 'invoice.send.reminderDrafted', { days: '3' })));
  });

  it('A CUSTOMER WHO DOES NOT WRITE IN ENGLISH gets a draft too, never the English sentence alone', async () => {
    const f = await fixture('telegram', String(200_000_000 + Number(runDigits(RUN, 6))), 'Marie', { language: 'fr' });
    await sentAgo(f, 'telegram', 3);
    await remind();
    const [draft] = await drafts(f.cid);
    expect(draft).toMatchObject({ status: 'pending', capability: 'follow_up' });
    expect(tg.some((x) => String(x.body['text'] ?? '').includes(`invoice ${f.key}`))).toBe(false);
    expect((await get(`/app/inbox/${f.cid}`)).body).toContain(esc(t('en', 'inbox.draft.held.invoice_language', { key: f.key, name: 'Lily' })));
  });

  it('THE ORDER-CONFIRMED REPLY promises the invoice while the switch is on, and not once it is off', async () => {
    const confirm = async (tag: string) => {
      const { ensureConversation } = await import('../../src/db/channels.js');
      const { cid, proposalId } = await q(async (tx) => {
        const c = await ensureConversation(tx, BIZ as never, `9715${runDigits(RUN, 5)}${tag}`, `Buyer ${tag}`, 'whatsapp');
        await sql`update client_channels set last_inbound_at = now() - interval '1 minute' where client_id = ${c.clientId}::uuid`.execute(tx);
        await sql`update clients set preferred_language = 'en' where id = ${c.clientId}::uuid`.execute(tx);
        const p = (await sql<{ id: string }>`insert into order_proposals (business_id, conversation_id, client_id, turn_message_id, product_id, quantity, unit, unit_price, total, currency, client_email, payment_terms, incoterm)
          values (${BIZ}, ${c.conversationId}::uuid, ${c.clientId}::uuid, ${`msg-${tag}-${RUN}`}, ${PID}::uuid, 40, 'pcs', 2.10, 84.00, 'USD', 'buyer@example.test', '30% deposit', 'FOB Ningbo') returning id::text as id`.execute(tx)).rows[0]!.id;
        return { cid: c.conversationId, proposalId: p };
      });
      expect((await post(`/app/inbox/${cid}/order/confirm`, { proposalId })).statusCode).toBe(302);
      return (await sentRow(cid, 'text')).body;
    };
    const on = await confirm('0004');
    expect(on).toContain('Your order is confirmed');
    expect(on).toContain("We'll send you the invoice next.");
    await post('/app/settings/books/invoices-out', {});
    expect(await q((tx) => sql<{ on: boolean }>`select invoice_sending as "on" from books_settings where business_id = ${BIZ}`.execute(tx).then((r) => r.rows[0]!.on))).toBe(false);
    const off = await confirm('0005');
    expect(off).toContain('Your order is confirmed');
    expect(off).not.toMatch(/invoice/i);
  });
});
