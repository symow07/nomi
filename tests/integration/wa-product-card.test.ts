import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { createDb, withTenantTx, type Db } from '../../src/db/client.js';
import type { BusinessId } from '../../src/core/types/ids.js';
import { saveProductPhoto } from '../../src/db/productPhotos.js';
import { saveCatalogueProduct, previewCatalogue, submitCatalogue, checkCatalogue } from '../../src/db/waCatalogue.js';
import type { CatalogueClient } from '../../src/net/waCatalogue.js';
import { channelStore } from '../../src/db/channels.js';
import { driveConversationOutbound, type DriveEffect } from '../../src/outbound/worker.js';
import { ownerProductCard } from '../../src/outbound/ownerReply.js';
import type { ChannelAdapter, OutboundProduct, SendResult } from '../../src/channels/contract.js';
import { registerWebApp } from '../../src/api/web/app.js';
import { hashCode } from '../../src/api/web/people.js';
import { flashSaid, flashWasRefusal } from './tenant.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * Part B (5.3) — the owner's WhatsApp product card, over the real tables: the route, the one writer, the store the
 * worker reads, the send rows, and the erasures. Only Meta is faked; nothing leaves this machine.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ADMIN = process.env['MIGRATE_DATABASE_URL'];
const d = process.env['DATABASE_URL'] && ADMIN ? describe : describe.skip;
const SECRET = 'product-card-test-session-secret-long-enough';

type Call = { kind: 'text' | 'template' | 'product'; what: unknown };
function fakeWhatsApp(): ChannelAdapter & { calls: Call[] } {
  const calls: Call[] = [];
  const ok = (): SendResult => ({ ok: true, providerMessageId: `wamid.${randomUUID()}` });
  return {
    kind: 'whatsapp', provider: 'test', calls, verifyWebhook: () => true, parseWebhook: () => [],
    sendText: async (_to, body) => { calls.push({ kind: 'text', what: body }); return ok(); },
    sendTemplate: async (_to, tpl) => { calls.push({ kind: 'template', what: tpl }); return ok(); },
    sendProduct: async (_to, p: OutboundProduct) => { calls.push({ kind: 'product', what: p }); return ok(); },
  };
}

d('Part B · the owner sends a WhatsApp product card (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let admin: pg.Client;
  let db: Db;
  beforeAll(async () => { admin = new pg.Client({ connectionString: ADMIN }); await admin.connect(); db = createDb(process.env['DATABASE_URL']!); });
  afterAll(async () => { await db?.destroy(); await admin?.end(); });
  const one = async (text: string, values: unknown[] = []) => (await admin.query(text, values)).rows[0];

  /** A business with its own live number, one product Meta accepted, and a customer who wrote an hour ago. */
  const fixture = async () => {
    const biz = randomUUID() as BusinessId;
    const name = `Card Shop ${biz.slice(0, 8)}`;
    await admin.query(`insert into businesses(id,name,currency) values($1,$2,'GBP')`, [biz, name]);
    await admin.query(`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
      values ($1, 'whatsapp', 'connected', '+44 77****0001', now(), now(), 'test', false)`, [biz]);
    await admin.query(`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine) values ($1,'whatsapp',$2,'test','service')`,
      [biz, String(randomInt(100000, 999999999))]);
    const waba = String(randomInt(10000000, 99999999));
    await admin.query(`insert into whatsapp_accounts(business_id,waba_id,phone_number_id,token_ciphertext,fingerprint,connected_by)
      values($1,$2,$3,'v1.test-only-encrypted','012345abcdef','owner')`, [biz, waba, String(randomInt(100000, 999999999))]);
    const product = (await one(`insert into products(business_id,sku,name,unit,price_usd_per_unit,currency,is_active,quote_vetted_at)
      values($1,$2,'Linen shirt','item',24.50,'GBP',true,now()) returning id`, [biz, randomUUID()])).id as string;
    await admin.query(`insert into product_aliases(product_id,alias) values($1,'linen shirt')`, [product]);
    await withTenantTx(db, biz, (tx) => saveProductPhoto(tx, biz, product, Buffer.from('89504e470d0a1a0a', 'hex')));
    const image = (await one(`select id from product_images where product_id=$1`, [product])).id as string;
    await withTenantTx(db, biz, (tx) => saveCatalogueProduct(tx, biz, product, { description: 'A linen shirt', link: 'https://shop.example/shirt', availability: 'in stock', brand: 'Card Shop', condition: 'new', imageId: image }));
    const client: CatalogueClient = { linked: async () => ({ ok: true, catalogId: '456' }),
      submit: async () => ({ ok: true, handle: 'h', invalid: {}, warnings: {} }), status: async () => ({ ok: true, finished: true, invalid: {}, warnings: {} }) };
    const deps = { db, client, now: () => new Date(), publicBaseUrl: 'https://nomi.example' };
    const preview = await previewCatalogue(deps, biz, 'owner'); if (!preview.ok) throw Error(preview.reason);
    const row = await one(`select id from wa_catalogue_batch_items where batch_id=$1`, [preview.batchId]);
    expect(await submitCatalogue(deps, biz, preview.batchId, [row.id])).toMatchObject({ ok: true });
    expect(await checkCatalogue(deps, biz, preview.batchId)).toMatchObject({ ok: true, state: 'finished' });
    const retailer = (await one(`select retailer_id from wa_catalogue_items where product_id=$1 and state='synced'`, [product])).retailer_id as string;
    const customer = (await one(`insert into clients(business_id,display_name,phone) values($1,'Nadia',$2) returning id`, [biz, `+4477009${randomInt(10000, 99999)}`])).id as string;
    await admin.query(`insert into client_channels(client_id,channel,channel_user_id,last_inbound_at) values($1,'whatsapp',$2,now()-interval '1 hour')`,
      [customer, `4477${randomInt(1000000, 9999999)}`]);
    const conv = (await one(`insert into conversations(business_id,client_id,channel,assigned_to) values($1,$2,'whatsapp','owner') returning id`, [biz, customer])).id as string;
    return { biz, name, waba, product, retailer, customer, conv };
  };
  const drive = async (biz: BusinessId, conv: string, adapter: ChannelAdapter): Promise<readonly DriveEffect[]> =>
    withTenantTx(db, biz, (tx) => driveConversationOutbound({ store: channelStore(tx, biz), adapter, now: () => new Date(), mediaOrigin: 'https://nomi.example' }, conv));
  const queue = (f: { biz: BusinessId; conv: string; product: string }) =>
    ownerProductCard({ db, now: () => new Date(), kickDrive: async () => {} }, { businessId: f.biz, conversationId: f.conv, productId: f.product, actor: 'owner' });

  it('test 15 · one card through the one writer: the row, its snapshot, ONE sendProduct, and the transcript says what was chosen', async () => {
    const f = await fixture();
    expect(await queue(f)).toMatchObject({ outcome: 'sent' });
    const row = await one(`select id,kind,body,origin,media_url,status from outbound_messages where conversation_id=$1`, [f.conv]);
    expect(row).toMatchObject({ kind: 'product', body: 'Product card: Linen shirt, £24.50', origin: 'owner', media_url: null, status: 'queued' });
    expect(await one(`select catalog_id,retailer_id,name,price,currency from wa_catalogue_sends where outbound_id=$1`, [row.id]))
      .toEqual({ catalog_id: '456', retailer_id: f.retailer, name: 'Linen shirt', price: '24.5000', currency: 'GBP' });
    const a = fakeWhatsApp();
    expect(await drive(f.biz, f.conv, a)).toContainEqual(expect.objectContaining({ kind: 'sent', id: row.id }));
    expect(a.calls).toEqual([{ kind: 'product', what: { catalogId: '456', retailerId: f.retailer } }]);
    expect(await one(`select text_content,input_type from messages where conversation_id=$1 and direction='outbound'`, [f.conv]))
      .toEqual({ text_content: 'Product card: Linen shirt, £24.50', input_type: 'text' });
    expect((await one(`select payload from conversation_events where conversation_id=$1 and type='owner_product_card'`, [f.conv])).payload)
      .toEqual({ actor: 'owner', productId: f.product });
  });

  it('a price changed after the card was queued: product_changed at dispatch, nothing leaves', async () => {
    const f = await fixture();
    expect(await queue(f)).toMatchObject({ outcome: 'sent' });
    await admin.query(`update products set price_usd_per_unit=26 where id=$1`, [f.product]);
    const a = fakeWhatsApp();
    expect(await drive(f.biz, f.conv, a)).toContainEqual(expect.objectContaining({ kind: 'canceled', reason: 'product_changed' }));
    expect(a.calls).toEqual([]);
    // …and at enqueue the same question refuses a new one.
    expect(await queue(f)).toMatchObject({ outcome: 'not_sendable' });
  });

  it('test 16 · after the 24 hours, with an APPROVED reopening template: refused by the worker, no template, no card, no text', async () => {
    const f = await fixture();
    expect(await queue(f)).toMatchObject({ outcome: 'sent' });
    await admin.query(`update client_channels set last_inbound_at=now()-interval '3 days' where client_id=$1`, [f.customer]);
    await admin.query(`insert into whatsapp_templates(business_id,waba_id,name,language,status,submitted_by) values($1,$2,'nomi_reply_waiting','en','APPROVED','test')`, [f.biz, f.waba]);
    const a = fakeWhatsApp();
    expect(await drive(f.biz, f.conv, a)).toContainEqual(expect.objectContaining({ kind: 'canceled', reason: 'window_needs_owner' }));
    expect(a.calls).toEqual([]);
    expect((await one(`select body from outbound_messages where conversation_id=$1`, [f.conv])).body).toBe('Product card: Linen shirt, £24.50');
  });

  it('test 16 · and without one: the free-form window refusal, no adapter call', async () => {
    const f = await fixture();
    expect(await queue(f)).toMatchObject({ outcome: 'sent' });
    await admin.query(`update client_channels set last_inbound_at=now()-interval '3 days' where client_id=$1`, [f.customer]);
    const a = fakeWhatsApp();
    expect(await drive(f.biz, f.conv, a)).toContainEqual(expect.objectContaining({ kind: 'canceled', reason: 'window_closed' }));
    expect(a.calls).toEqual([]);
  });

  it('the route: owner only; held by a person first; refused outside the window either way; the page offers only cards Meta holds', async () => {
    const f = await fixture();
    await admin.query(`update conversations set assigned_to=null where id=$1`, [f.conv]);
    const staffCode = 'STAFF-CARD-' + randomUUID();
    await admin.query(`insert into people(business_id,name,code_hash) values($1,'Colleague',$2)`, [f.biz, hashCode(SECRET, staffCode)]);
    const app = Fastify({ logger: false });
    registerWebApp(app, { db, businessId: f.biz, accessCode: 'owner-card-test', sessionSecret: SECRET, provider: 'meta',
      secureCookie: false, messagingEnabled: true, publicBaseUrl: 'https://nomi.example', kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const post = (cookie: string, url: string, body: Record<string, string> = {}) => app.inject({ method: 'POST', url,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(body).toString() });
    const login = async (code: string) => String((await post('', '/login', { code })).headers['set-cookie']).split(';')[0]!;
    const rows = async () => (await admin.query(`select kind from outbound_messages where conversation_id=$1`, [f.conv])).rows.length;
    const url = `/app/inbox/${f.conv}/product-card`;
    try {
      const owner = await login('owner-card-test'), staff = await login(staffCode);
      // Not held: refused, nothing queued.
      expect(flashWasRefusal(await post(owner, url, { product: f.product }), SECRET)).toBe(true);
      expect((await post(owner, `/app/inbox/${f.conv}/takeover`)).statusCode).toBe(302);
      // Staff: refused by the owner-only rule, and no picker on their page.
      expect(flashSaid(await post(staff, url, { product: f.product }), SECRET)).toBe(t('en', 'staff.notAllowed'));
      expect((await app.inject({ url: `/app/inbox/${f.conv}`, headers: { cookie: staff } })).body).not.toContain(`action="${url}"`);
      const page = (await app.inject({ url: `/app/inbox/${f.conv}`, headers: { cookie: owner } })).body;
      expect(page).toContain(`action="${url}"`);
      expect(page).toContain(`<option value="${f.product}">Linen shirt · £24.50</option>`);
      expect(await rows()).toBe(0);
      // Another workspace's product is not sendable here.
      const other = await fixture();
      expect(flashSaid(await post(owner, url, { product: other.product }), SECRET)).toBe(t('en', 'card.flash.not_sendable'));
      expect(await rows()).toBe(0);
      // Outside the window, no template: the words' refusal.
      await admin.query(`update client_channels set last_inbound_at=now()-interval '3 days' where client_id=$1`, [f.customer]);
      expect(flashSaid(await post(owner, url, { product: f.product }), SECRET)).toBe(t('en', 'inbox.blocked.window_closed'));
      // …with the reopening template approved: still refused; a card never rides a template.
      await admin.query(`insert into whatsapp_templates(business_id,waba_id,name,language,status,submitted_by) values($1,$2,'nomi_reply_waiting','en','APPROVED','test')`, [f.biz, f.waba]);
      expect(flashSaid(await post(owner, url, { product: f.product }), SECRET)).toBe(t('en', 'card.flash.window'));
      expect(await rows()).toBe(0);
      // Inside the window: queued, and said so.
      await admin.query(`update client_channels set last_inbound_at=now()-interval '1 hour' where client_id=$1`, [f.customer]);
      expect(flashSaid(await post(owner, url, { product: f.product }), SECRET)).toBe(t('en', 'card.flash.sent'));
      expect(await rows()).toBe(1);
    } finally { await app.close(); }
  });

  it('practice: a practice copy has no card to send, and the table refuses its send rows', async () => {
    const f = await fixture();
    const live = await fixture();
    await admin.query(`update businesses set practice_of=$2 where id=$1`, [f.biz, live.biz]);
    expect(await queue(f)).toMatchObject({ outcome: 'not_sendable' });
    expect((await admin.query(`select 1 from outbound_messages where conversation_id=$1`, [f.conv])).rows).toEqual([]);
    const out = (await one(`insert into outbound_messages(business_id,conversation_id,seq,body,origin,to_wa_id,channel,kind)
      values($1,$2,1,'x','owner','1','whatsapp','product') returning id`, [f.biz, f.conv])).id;
    // The table itself refuses a send row on a copy, even for the copy's own item (0086's practice_refuses).
    const own = (await one(`select id from wa_catalogue_items where business_id=$1`, [f.biz])).id;
    const insert = (biz: string, outId: string, item: string) => admin.query(`insert into wa_catalogue_sends(outbound_id,business_id,item_id,catalog_id,retailer_id,name,price,currency,fingerprint)
      values($1,$2,$3,'456','r','n','1','GBP','f')`, [outId, biz, item]);
    await expect(insert(f.biz, out, own)).rejects.toMatchObject({ code: '42501' });
    // The same row on the live workspace is accepted: the refusal is the copy's, not the shape's.
    const liveOut = (await one(`insert into outbound_messages(business_id,conversation_id,seq,body,origin,to_wa_id,channel,kind)
      values($1,$2,1,'x','owner','1','whatsapp','product') returning id`, [live.biz, live.conv])).id;
    const liveItem = (await one(`select id from wa_catalogue_items where business_id=$1`, [live.biz])).id;
    await expect(insert(live.biz, liveOut, liveItem)).resolves.toBeTruthy();
  });

  it('erasure · the customer: erase-buyer takes the send row with the message, dry run first', async () => {
    const f = await fixture();
    expect(await queue(f)).toMatchObject({ outcome: 'sent' });
    await drive(f.biz, f.conv, fakeWhatsApp());
    const out = (await one(`select id from outbound_messages where conversation_id=$1`, [f.conv])).id;
    expect((await one(`select count(*)::int n from wa_catalogue_sends where outbound_id=$1`, [out])).n).toBe(1);
    const req = (await one(`insert into deletion_requests(business_id,scope,client_id,asked_by) values($1,'buyer',$2,'owner') returning id::text as id`, [f.biz, f.customer])).id as string;
    const run = (args: string[]) => spawnSync(process.execPath, ['tools/erase-buyer.mjs', '--request', req, ...args],
      { cwd: ROOT, env: { ...process.env, MIGRATE_DATABASE_URL: ADMIN }, encoding: 'utf8', timeout: 120_000 });
    const dry = run([]);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('wa_catalogue_sends');
    expect((await one(`select count(*)::int n from wa_catalogue_sends where outbound_id=$1`, [out])).n).toBe(1);
    const done = run(['--yes', '--confirm', req.slice(0, 8), '--by', 'Operator Test']);
    expect(done.stderr).toBe(''); expect(done.status).toBe(0);
    expect((await one(`select count(*)::int n from wa_catalogue_sends where business_id=$1`, [f.biz])).n).toBe(0);
    expect((await one(`select count(*)::int n from outbound_messages where id=$1`, [out])).n).toBe(0);
    // The business's catalogue is not the customer's: it stays.
    expect((await one(`select state from wa_catalogue_items where product_id=$1`, [f.product])).state).toBe('synced');
    expect((await one(`select counts from erasure_ledger where request_id=$1`, [req])).counts.erased.wa_catalogue_sends).toBe(1);
  });

  it('erasure · the workspace: erase-workspace takes every send row with it', async () => {
    const f = await fixture();
    expect(await queue(f)).toMatchObject({ outcome: 'sent' });
    expect((await one(`select count(*)::int n from wa_catalogue_sends where business_id=$1`, [f.biz])).n).toBe(1);
    await admin.query(`insert into deletion_requests (business_id, scope, asked_by) values ($1, 'workspace', 'owner')`, [f.biz]);
    const r = spawnSync(process.execPath, ['tools/erase-workspace.mjs', '--business', f.biz, '--confirm', f.name, '--yes'],
      { cwd: ROOT, env: { ...process.env, MIGRATE_DATABASE_URL: ADMIN }, encoding: 'utf8', timeout: 120_000 });
    expect(r.status, r.stderr).toBe(0);
    for (const tbl of ['wa_catalogue_sends', 'wa_catalogue_items', 'wa_catalogue_batches', 'wa_catalogue_images']) {
      expect((await one(`select count(*)::int n from ${tbl} where business_id=$1`, [f.biz])).n, tbl).toBe(0);
    }
  });
});
