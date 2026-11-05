#!/usr/bin/env node
/**
 * THE SPLIT TODAY PREVIEW, ON A LOCAL INSTANCE (2026-11-04). Two steps, neither of which goes near production:
 *
 *   node tools/split-preview.mjs seed   lays customers, a waiting reply, orders and a year of books over the demo
 *                                       workspace of a LOCAL database, through the books' own functions. Refuses
 *                                       anything but 127.0.0.1, and a database it has already seeded.
 *   node tools/split-preview.mjs shots  draws Today and the Inbox at a desktop and a phone width, in English and Arabic,
 *                                       into docs/design/split-today/. It opens one waiting conversation first, so
 *                                       the Inbox shows a bold name beside a plain one.
 *                                       And a conversation in each script, on each page.
 *
 *   MIGRATE_DATABASE_URL  the local admin address; DATABASE_URL  the local app address (nomi_app)
 *   SPLIT_BASE  the instance, started with SPLIT_TODAY=on (default http://127.0.0.1:8787)
 *   SPLIT_CODE  its access code (default smoke-code)
 *   SPLIT_BROWSER  a Chromium to drive (default Brave)
 *
 * The customers' photos and product pictures are DRAWN here, as flat stand-ins, because a local instance has no channel
 * to give it one: no real person's face is in this repository. Customers left without one show the neutral initial.
 * Run `npm run build` first: the books are written by `dist/`.
 * Sign in once before seeding: the owner's row is made at the first sign-in, and the seed names it.
 */
import pg from 'pg';
import { chromium } from 'playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BIZ = 'de300000-0000-4000-8000-0000000000b1';
const BASE = process.env.SPLIT_BASE ?? 'http://127.0.0.1:8787';
const CODE = process.env.SPLIT_CODE ?? 'smoke-code';
const BROWSER = process.env.SPLIT_BROWSER ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const OUT = fileURLToPath(new URL('../docs/design/split-today/', import.meta.url));

const person = (skin, hair, top, wrap = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#D9CFC2"/>
  <path d="M14 96c2-22 16-30 34-30s32 8 34 30z" fill="${top}"/><rect x="41" y="52" width="14" height="18" rx="6" fill="${skin}"/>
  ${wrap ? `<path d="M22 44c0-20 12-30 26-30s26 10 26 30c0 16-8 28-26 28S22 60 22 44z" fill="${hair}"/>` : `<path d="M26 40c0-16 10-25 22-25s22 9 22 25v10H26z" fill="${hair}"/>`}
  <ellipse cx="48" cy="42" rx="17" ry="20" fill="${skin}"/></svg>`;
const FACES = {
  aisha: person('#7A4B2E', '#2A1B14', '#5C2F3A', true),
  fatima: person('#C99A77', '#3B2A20', '#3F6B5C', true),
  rania: person('#D8AE8C', '#46291C', '#8A5A3C'),
  karim: person('#B98863', '#1F1A17', '#31404F'),
};
const bag = (a, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#EFE8DE"/><path d="M34 36c0-20 28-20 28 0" fill="none" stroke="${b}" stroke-width="5"/><rect x="22" y="34" width="52" height="46" rx="5" fill="${a}"/></svg>`;
const bottle = (a, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#EFE8DE"/><rect x="38" y="12" width="20" height="14" rx="3" fill="${b}"/><rect x="30" y="26" width="36" height="58" rx="8" fill="${a}"/></svg>`;
const mug = (a) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#EFE8DE"/><path d="M68 40h6c10 0 10 22 0 22h-6" fill="none" stroke="${a}" stroke-width="6"/><rect x="24" y="30" width="44" height="46" rx="6" fill="${a}"/></svg>`;
const THUMBS = {
  'de300000-0000-4000-8000-000000000111': bag('#A8506A', '#6E2F44'),
  'de300000-0000-4000-8000-000000000101': bag('#C9B48F', '#8C7650'),
  'de300000-0000-4000-8000-000000000102': bottle('#5F7F8C', '#39505A'),
  'de300000-0000-4000-8000-000000000103': mug('#B88A5B'),
};

async function pngs(drawings) {
  const browser = await chromium.launch({ executablePath: BROWSER });
  const page = await browser.newPage({ viewport: { width: 192, height: 192 } });
  const out = {};
  for (const [k, svg] of Object.entries(drawings)) {
    await page.setContent(`<!doctype html><body style="margin:0">${svg.replace('<svg ', '<svg width="192" height="192" ')}</body>`);
    out[k] = await page.screenshot({ type: 'png' });
  }
  await browser.close();
  return out;
}

async function seed() {
  const adminUrl = process.env.MIGRATE_DATABASE_URL, appUrl = process.env.DATABASE_URL;
  if (!adminUrl || !appUrl) throw new Error('MIGRATE_DATABASE_URL and DATABASE_URL are required');
  for (const u of [adminUrl, appUrl]) if (new URL(u).hostname !== '127.0.0.1') throw new Error('a local database only: this writes demo rows');
  const a = new pg.Client({ connectionString: adminUrl });
  await a.connect();
  const q = (text, v) => a.query(text, v);
  if ((await q(`select 1 from fiscal_years where business_id = $1`, [BIZ])).rows.length) throw new Error('already seeded: start from a fresh local database');

  const img = await pngs({ ...FACES, ...THUMBS });
  await q(`update businesses set name = 'Lumen & Co.', books_area = true where id = $1`, [BIZ]);
  await q(`update people set name = 'Moe' where business_id = $1 and is_owner`, [BIZ]);
  // The demo's own conversations stay out of the figures: this page shows the customers laid below.
  await q(`update conversations set owner_testing = true where business_id = $1`, [BIZ]);
  for (const [productId, _] of Object.entries(THUMBS)) {
    const token = randomBytes(32).toString('base64url');
    await q(`insert into product_images (product_id, url, is_primary, sort_order, token, media_type, bytes) values ($1, $2, true, 0, $3, 'image/png', $4)`,
      [productId, `/media/${token}`, token, img[productId]]);
  }

  const P = { cosmetic: 'de300000-0000-4000-8000-000000000111', tote: 'de300000-0000-4000-8000-000000000101', thermos: 'de300000-0000-4000-8000-000000000102', mug: 'de300000-0000-4000-8000-000000000103' };
  const ago = (hours) => new Date(Date.now() - hours * 3_600_000);
  /** A customer, their conversation, and what happened in it. */
  async function customer(c) {
    const client = randomUUID(), conv = randomUUID();
    const when = ago(c.hours);
    await q(`insert into clients (id, business_id, display_name, country, preferred_language, created_at, last_seen_at) values ($1, $2, $3, $4, 'en', $5, $5)`, [client, BIZ, c.name, c.country ?? null, when]);
    await q(`insert into client_channels (client_id, channel, channel_user_id, last_inbound_at) values ($1, $2, $3, $4)`, [client, c.channel, `split-${client.slice(0, 8)}`, when]);
    await q(`insert into conversations (id, business_id, client_id, channel, phase, is_active, created_at, updated_at) values ($1, $2, $3, $4, 'warm_intake', true, $5, $5)`, [conv, BIZ, client, c.channel, when]);
    await q(`insert into conversation_state (conversation_id, phase, identified_product_id, product_confidence, inquiry_quantity, inquiry_unit, turn_count, last_message_at) values ($1, 'warm_intake', $2, 0.9, $3, 'pcs', 2, $4)`, [conv, c.product ?? null, c.qty ?? null, when]);
    await q(`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at) values ($1, $2, 'inbound', 'text', $3, $4)`, [conv, `split-${conv.slice(0, 8)}-in`, c.asked ?? 'Hello, how much is this?', when]);
    if (FACES[c.face]) {
      const version = randomBytes(6).toString('hex');
      await q(`insert into client_faces (client_id, business_id, state, content_type, bytes, version, tried_at, kept_at, attempts) values ($1, $2, 'kept', 'image/png', $3, $4, now(), now(), 1)`, [client, BIZ, img[c.face], version]);
    }
    let quote = null;
    if (c.unit) {
      quote = randomUUID();
      await q(`insert into quotes (id, business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, discount_pct, total_usd, requires_human, applied_rules, engine_version, created_at) values ($1, $2, $3, $4, $5, '{"seed":"split"}'::jsonb, $6, 0, $7, false, '{}', 'split-seed', $8)`,
        [quote, BIZ, conv, c.product, c.qty, c.unit, (c.qty * c.unit).toFixed(2), when]);
    }
    if (c.given) {
      const out = randomUUID();
      const sent = new Date(when.getTime() + 60_000);
      await q(`insert into outbound_messages (id, business_id, conversation_id, seq, body, status, origin, channel, created_at, sent_at) values ($1, $2, $3, 1, $4, 'sent', 'employee', $5, $6, $6)`, [out, BIZ, conv, c.given, c.channel, sent]);
      await q(`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at) values ($1, $2, 'outbound', 'text', $3, $4)`, [conv, `out:${out}`, c.given, sent]);
    }
    if (c.draft) {
      await q(`insert into drafts (id, business_id, conversation_id, capability, draft_text, status, created_at) values ($1, $2, $3, 'quote', $4, 'pending', $5)`, [randomUUID(), BIZ, conv, c.draft, when]);
    }
    if (c.order) {
      const id = randomUUID();
      await q(`insert into orders (id, order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, agreed_unit_price_usd, total_value_usd, status, quote_id, created_at, confirmed_at) values ($1, $2, $3, $4, $5, $6, $7, 'pcs', $8, $9, 'confirmed', $10, $11, $11)`,
        [id, `SPLIT-${id.slice(0, 6)}`, BIZ, client, conv, c.product, c.qty, c.unit, (c.qty * c.unit).toFixed(2), quote, when]);
      c.orderId = id;
    }
    if (c.handoff) await q(`update conversations set assigned_to = 'unclaimed' where id = $1`, [conv]);
    if (c.sample) await q(`insert into sample_requests (business_id, conversation_id, asked_text, requested_at) values ($1, $2, 'Could you send me a sample first?', $3)`, [BIZ, conv, when]);
    return c;
  }

  await customer({ name: 'Aisha Bello', channel: 'instagram', face: 'aisha', hours: 0.7, product: P.cosmetic, qty: 5000, unit: 1.45, asked: 'Hi! How much for 5,000 of the travel cosmetic bags?',
    draft: 'Hello Aisha, 5,000 Travel Cosmetic Bags come to $1.45 each, $7,250.00 in total. Shall I put that together for you?' });
  // Three who wait for a person: two long names, one in each direction, to show where a name is cut; and the one the shots open.
  await customer({ name: 'Bartholomew Featherstonehaugh-Cholmondeley Imports', channel: 'instagram', hours: 3, product: P.tote, handoff: true, asked: 'Can I talk to someone about a bulk order?' });
  await customer({ name: 'عبد الرحمن بن محمد الحسيني العلوي الإدريسي للتجارة والتوزيع', channel: 'whatsapp', hours: 5, product: P.mug, handoff: true, asked: 'أريد التحدث مع شخص من فريقكم' });
  await customer({ name: 'Imane Chraibi', channel: 'instagram', hours: 6, product: P.cosmetic, handoff: true, asked: 'Could someone call me?' });
  const karim = await customer({ name: 'Karim Haddad', channel: 'instagram', face: 'karim', hours: 24 * 20, product: P.mug, qty: 2500, unit: 0.84, order: true, given: 'That comes to $0.84 each, $2,100.00 in total.' });
  await customer({ name: 'Fatima Zahra', channel: 'instagram', face: 'fatima', hours: 42, product: P.tote, qty: 5000, unit: 1.64, order: true, given: 'That comes to $1.64 each, $8,200.00 in total.' });
  await customer({ name: 'Omar El Amrani', channel: 'whatsapp', hours: 66, product: P.thermos, qty: 1500, unit: 2.6, given: 'That comes to $2.60 each, $3,900.00 in total.', draft: 'Hello Omar, yes, the 1,500 thermos flasks can go in black.' });
  await customer({ name: 'Rania Belhaj', channel: 'instagram', face: 'rania', hours: 68, product: P.cosmetic, qty: 4000, unit: 1.4, order: true, given: 'That comes to $1.40 each, $5,600.00 in total.' });
  await customer({ name: 'Youssef Tazi', channel: 'whatsapp', hours: 69, product: P.tote, sample: true });
  for (const [i, name] of ['Lina Saad', 'Hana Idrissi', 'Mehdi Alaoui', 'Sara Bennani', 'Nour Fassi', 'Adam Lahlou'].entries()) {
    await customer({ name, channel: 'instagram', hours: 70 + i * 3, product: i % 2 ? P.tote : P.mug, ...(i < 3 ? { qty: 1000 + i * 500, unit: 1.1, given: 'That comes to $1.10 each.' } : {}) });
  }

  // ── A year of books, through the books' own functions, as the app's role.
  const { createDb, withTenantTx } = await import('../dist/db/client.js');
  const { parseBusinessId } = await import('../dist/core/types/ids.js');
  const inv = await import('../dist/db/booksInvoices.js');
  const ent = await import('../dist/db/booksEntries.js');
  const db = createDb(appUrl);
  const B = parseBusinessId(BIZ); if (!B.ok) throw new Error('fixture');
  const tx = (fn) => withTenantTx(db, B.value, fn);
  await a.query('begin');
  await a.query(`select set_config('app.business_id', $1, true)`, [BIZ]);
  const one = async (s, v = []) => (await a.query(s, v)).rows[0].id;
  const acc = (code, name, kind) => one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $2, $3) returning id::text as id`, [code, name, kind]);
  const k = {
    receivable: await acc('1100', 'Customers', 'asset'), bank: await acc('1200', 'Bank', 'asset'), sales: await acc('4000', 'Sales', 'income'), costs: await acc('5000', 'Costs', 'expense'),
    loss: await acc('6330', 'Exchange loss', 'expense'), gain: await acc('7330', 'Exchange gain', 'income'),
    ve: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VE', 'Sales', 'sales') returning id::text as id`),
    bq: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'BQ', 'Bank', 'bank') returning id::text as id`),
  };
  await a.query(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), $1, $2)`, [`${new Date().getUTCFullYear()}-01-01`, `${new Date().getUTCFullYear()}-12-31`]);
  await a.query(`insert into books_settings (business_id, sales_journal_id, receivable_account_id, sales_account_id, fx_loss_account_id, fx_gain_account_id) values (current_business_id(), $1, $2, $3, $4, $5)`, [k.ve, k.receivable, k.sales, k.loss, k.gain]);
  const partyOf = {};
  for (const [i, name] of ['Karim Haddad', 'Fatima Zahra', 'Rania Belhaj', 'Omar El Amrani', 'Lumen Wholesale'].entries()) {
    partyOf[name] = await one(`insert into parties (business_id, code, name, kind) values (current_business_id(), $1, $2, 'customer') returning id::text as id`, [`C00${i + 1}`, name]);
  }
  await a.query('commit');

  const iso = (d) => d.toISOString().slice(0, 10);
  const today = new Date();
  const year = today.getUTCFullYear();
  const issue = async (party, date, amount, due = null, order = null) => {
    const r = await tx((t) => inv.draftInvoice(t, BIZ, 'owner', { partyId: partyOf[party], issueDate: date, dueDate: due, currency: 'USD', label: null,
      lines: [{ label: 'Goods', quantity: '1', unitPrice: amount, accountId: k.sales, taxCodeId: null }] }));
    if (r.kind !== 'drafted') throw new Error(`draft: ${JSON.stringify(r)}`);
    if (order) await q(`update invoices set source_order_id = $1 where id = $2`, [order, r.id]);
    const done = await tx((t) => inv.issueInvoice(t, BIZ, r.id, 'owner'));
    if (done.kind === 'refused' || done.kind === 'not_found') throw new Error(`issue: ${JSON.stringify(done)}`);
    return r.id;
  };
  const pay = async (id, on, amount) => {
    const r = await tx((t) => inv.recordPayment(t, BIZ, id, 'owner', { paidOn: on, amount, journalId: k.bq, accountId: k.bank }));
    if (r.kind !== 'recorded') throw new Error(`pay: ${JSON.stringify(r)}`);
  };
  const cost = async (on, amount) => {
    const d = await tx((t) => ent.draftEntry(t, BIZ, 'owner', { journalId: k.bq, date: on, label: 'Costs', documentRef: `COST-${on}`, documentDate: on, lines: [
      { accountId: k.costs, partyId: null, taxCodeId: null, currency: 'USD', debit: amount, credit: null, label: null, isFx: false },
      { accountId: k.bank, partyId: null, taxCodeId: null, currency: 'USD', debit: null, credit: amount, label: null, isFx: false },
    ] }));
    if (d.kind !== 'drafted') throw new Error(`cost: ${JSON.stringify(d)}`);
    const p = await tx((t) => ent.postEntry(t, BIZ, d.id, 'owner'));
    if (p.kind !== 'posted') throw new Error(`post: ${JSON.stringify(p)}`);
  };
  const monthly = [['6200', '3900'], ['7400', '4300'], ['6900', '4100'], ['8800', '4700'], ['9100', '5200'], ['8400', '4900'], ['10200', '5600'], ['11300', '5900'], ['10800', '6100'], ['12900', '6400']];
  for (const [i, [sold, spent]] of monthly.entries()) {
    const month = i + 1;
    if (year === today.getUTCFullYear() && month - 1 >= today.getUTCMonth()) break;
    const day = `${year}-${String(month).padStart(2, '0')}-15`;
    await pay(await issue('Lumen Wholesale', day.replace(/-\d\d$/, '-08'), sold), day, sold);
    await cost(`${year}-${String(month).padStart(2, '0')}-20`, spent);
  }
  // This month: in 18,400, out 9,150. The first three payments wait on the bank page, matched by its rule.
  const dayOf = (n) => iso(new Date(today.getTime() - n * 86_400_000));
  const thisMonth = (n) => { const d = dayOf(n); return d.slice(0, 7) === iso(today).slice(0, 7) ? d : `${iso(today).slice(0, 7)}-01`; };
  const paid = [['Fatima Zahra', '8200'], ['Rania Belhaj', '5600'], ['Lumen Wholesale', '4600']];
  for (const [party, amount] of paid) { const on = thisMonth(1); await pay(await issue(party, thisMonth(3), amount), on, amount); }
  await cost(thisMonth(1), '9150');
  // Owed: four invoices, 12,300; one late by nine days.
  const karimOrder = karim.orderId;
  await issue('Karim Haddad', dayOf(39), '2100', dayOf(9), karimOrder);
  await issue('Omar El Amrani', dayOf(10), '3900', dayOf(-20));
  await issue('Lumen Wholesale', dayOf(7), '3700', dayOf(-24));
  await issue('Fatima Zahra', dayOf(6), '2600', dayOf(-27));
  // The bank's statement: the three payments' lines, not yet matched.
  const imp = randomUUID();
  await q(`insert into statement_imports (id, business_id, account_id, format, sha256, added, refused, imported_by) values ($1, $2, $3, 'csv', $4, 3, 0, 'owner')`, [imp, BIZ, k.bank, randomBytes(32).toString('hex')]);
  for (const [i, [party, amount]] of paid.entries()) {
    await q(`insert into statement_lines (business_id, import_id, account_id, booked_on, amount, currency, wording, fingerprint) values ($1, $2, $3, $4, $5, 'USD', $6, $7)`, [BIZ, imp, k.bank, thisMonth(1), amount, party, `split-${i}`]);
  }
  // Money the bank received for no invoice: Recent entries lists it as a payment.
  await q(`insert into statement_lines (business_id, import_id, account_id, booked_on, amount, currency, wording, fingerprint) values ($1, $2, $3, $4, 640, 'USD', 'Transfer from S. Idrissi', 'split-unmatched')`, [BIZ, imp, k.bank, thisMonth(2)]);
  await db.destroy();
  await a.end();
  console.log('Seeded. Restart the instance with SPLIT_TODAY=on (the workspace\'s facts are cached for a minute).');
}

const channel = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

/** The wash stays faint: the text hidden, the worst pixel actually behind the title and the line under it. */
async function measureWash(browser, page, locale, width) {
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.sp-head h1, .sp-head .sp-sub, .sp-phead h2')].map((e) => {
    const range = document.createRange(); range.selectNodeContents(e);
    const r = range.getBoundingClientRect();
    return { name: e.tagName === 'H1' ? 'title' : e.tagName === 'H2' ? `heading ${e.textContent.trim()}` : 'subtitle', ink: getComputedStyle(e).color.match(/\d+/g).slice(0, 3).map(Number), clip: { x: r.x, y: r.y, width: r.width, height: r.height } };
  }));
  const veil = await page.addStyleTag({ content: '.sp-head h1, .sp-head .sp-sub, .sp-head h1 *, .sp-head .sp-sub *, .sp-phead h2, .sp-phead h2 * { color:transparent !important; }' });
  const probe = await browser.newPage();
  for (const b of boxes) {
    const png = (await page.screenshot({ clip: b.clip, fullPage: true })).toString('base64');
    const paper = await probe.evaluate(async (data) => {
      const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const px = []; for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
      return px;
    }, png);
    const worst = Math.min(...paper.map((p) => contrast(p, b.ink)));
    console.log(`  wash ${width} ${locale} ${b.name}: worst contrast ${worst.toFixed(2)}:1 ${worst >= 4.5 ? 'passes AA' : 'FAILS AA'}`);
  }
  await probe.close();
  await veil.evaluate((e) => e.remove());
}

/** The phone's tab bar must not cover "Also waiting for you": at rest, once a row is brought into view, and at the page's foot. */
async function measureTabBar(page, locale) {
  const read = () => page.evaluate(() => {
    const bar = document.querySelector('nav.side').getBoundingClientRect().top;
    const also = document.querySelector('.sp-also');
    const box = (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
    return { bar: Math.round(bar), head: box(also.querySelector('h3') ?? also), rows: [...also.querySelectorAll('a')].map(box), foot: box(document.querySelector('.sp-panels')) };
  });
  const rest = await read();
  await page.screenshot({ path: `${OUT}today-phone-${locale}-rest.png` });
  await page.evaluate(() => { const rows = document.querySelectorAll('.sp-also a'); rows[rows.length - 1].scrollIntoView({ block: 'nearest' }); });
  await page.waitForTimeout(300);
  const nearest = await read();
  await page.screenshot({ path: `${OUT}today-phone-${locale}-also.png` });
  // A keyboard's focus: what the browser scrolls to on Tab.
  await page.evaluate(() => { window.scrollTo(0, 0); const rows = document.querySelectorAll('.sp-also a'); rows[rows.length - 1].focus(); });
  await page.waitForTimeout(300);
  const focused = await read();
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, document.documentElement.scrollHeight); });
  await page.waitForTimeout(300);
  const end = await read();
  const last = (m) => m.rows.at(-1);
  console.log(`  tab bar ${locale}: bar top ${rest.bar}; at rest the heading ends ${rest.head.bottom} (${rest.head.bottom <= rest.bar ? 'clear' : 'COVERED'}), the last row ends ${last(rest).bottom}`);
  console.log(`  tab bar ${locale}: row scrolled into view ends ${last(nearest).bottom} (${last(nearest).bottom <= nearest.bar ? 'clear' : 'COVERED'}); focused by keyboard ends ${last(focused).bottom} (${last(focused).bottom <= focused.bar ? 'clear' : 'COVERED'}); page's foot ${end.foot.bottom} (${end.foot.bottom <= end.bar ? 'clear' : 'COVERED'})`);
}

async function shots() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: BROWSER });
  const sizes = { desktop: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 }, phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } };
  for (const [width, size] of Object.entries(sizes)) {
    for (const locale of ['en', 'ar']) {
      const ctx = await browser.newContext({ ...size, locale });
      await ctx.addCookies([{ name: 'yf_locale', value: locale, url: BASE }]);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/login?with=code`);
      await page.fill('input[name="code"]', CODE);
      await page.click('form button[type="submit"]');
      await page.goto(`${BASE}/app`);
      await page.waitForTimeout(1500);
      const dir = await page.evaluate(() => document.documentElement.dir);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      const file = `${OUT}today-${width}-${locale}.png`;
      await page.screenshot({ path: file, fullPage: false });
      await page.screenshot({ path: `${OUT}today-${width}-${locale}-full.png`, fullPage: true });
      console.log(`${file}  dir=${dir || 'ltr'}${wide ? '  WIDER THAN THE SCREEN' : ''}`);
      await measureWash(browser, page, locale, width);
      if (width === 'phone') await measureTabBar(page, locale);
      // The Inbox: opened as the owner opens it, one row plain among the bold.
      await page.goto(`${BASE}/app/inbox`);
      const opened = await page.locator('a.si-door', { hasText: 'Imane Chraibi' }).first().getAttribute('href');
      await page.goto(`${BASE}${opened}`);
      await page.goto(`${BASE}/app/inbox`);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}inbox-${width}-${locale}.png`, fullPage: false });
      await page.screenshot({ path: `${OUT}inbox-${width}-${locale}-full.png`, fullPage: true });
      const cut = await page.evaluate(() => [...document.querySelectorAll('.si-row .sp-rname')].filter((n) => n.scrollWidth > n.clientWidth)
        .map((n) => `${getComputedStyle(n).direction} ${n.textContent.slice(0, 12)}`));
      console.log(`  inbox-${width}-${locale}: cut: ${cut.join(' | ') || 'none'}`);
      // A message takes its direction from its own words, on either page.
      for (const [kind, who, words] of [['arabic', 'عبد الرحمن', 'أريد التحدث مع شخص'], ['latin', 'Bartholomew', 'Can I talk to someone about a bulk order']]) {
        await page.goto(`${BASE}/app/inbox`);
        const door = await page.locator('a.si-door', { hasText: who }).first().getAttribute('href');
        await page.goto(`${BASE}${door}`);
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}conversation-${width}-${locale}-${kind}.png`, fullPage: false });
        const read = await page.evaluate((said) => {
          const b = [...document.querySelectorAll('.bubble')].find((x) => x.textContent.includes(said));
          return b ? getComputedStyle(b).direction : 'no bubble';
        }, words);
        console.log(`  conversation-${width}-${locale}-${kind}: its bubble runs ${read}`);
      }
      await ctx.close();
    }
  }
  await browser.close();
}

const step = process.argv[2];
if (step === 'seed') await seed();
else if (step === 'shots') await shots();
else { console.error('usage: node tools/split-preview.mjs seed|shots'); process.exit(2); }
