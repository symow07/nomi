import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { sql } from 'kysely';
import { createDb, withTenantTx, type Db } from '../../src/db/client.js';
import { enqueueOutboundRow } from '../../src/db/channels.js';
import type { BusinessId } from '../../src/core/types/ids.js';
import { registerWebApp } from '../../src/api/web/app.js';
import { startBoss } from '../../src/queue/boss.js';
import { runDueFollowUps } from '../../src/outbound/followUps.js';

const suite = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const WORDS = 'Would you like to ask anything about the quote?';

suite('A null-turn follow-up uses the existing owner controls (requires DATABASE_URL)', () => {
  let db: Db, admin: pg.Client, app: ReturnType<typeof Fastify>, cookie: string;
  let conversation: string, draft: string;
  const business = randomUUID() as BusinessId;
  const sent: string[] = [];
  const now = new Date();
  const quotedAt = new Date(now.getTime() - 2 * 86400000);
  const query = (text: string, args: unknown[] = []) => admin.query(text, args);
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const post = (url: string, fields: Record<string, string>) => app.inject({ method: 'POST', url,
    headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const row = async () => (await query('select status, sent_text, turn_message_id from drafts where id = $1', [draft])).rows[0];

  beforeAll(async () => {
    // The page reads pg-boss even with no worker. Make its local schema explicitly, independent of suite order.
    const boss = await startBoss(process.env['DATABASE_URL']!); await boss.stop();
    db = createDb(process.env['DATABASE_URL']!);
    admin = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] }); await admin.connect();
    await query(`insert into businesses (id, name, owner_locale, timezone) values ($1, 'Follow-up controls', 'en', 'UTC')`, [business]);
    await query(`insert into follow_up_rules(business_id, enabled, enabled_at, wording)
      values ($1, true, $2, $3)`, [business, new Date(quotedAt.getTime() - 1), WORDS]);
    await query(`insert into channel_credentials(business_id, channel, external_ref, secret_ref, engine, is_active)
      values ($1, 'telegram', $2, 'fixture-only', 'service', true)`, [business, 'follow-up-' + business]);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: business, accessCode: 'follow-up-fixture', sessionSecret: 'follow-up-fixture-session-secret',
      employeeName: 'Lily', avatar: 'L', secureCookie: false, factsTtlMs: 0, provider: 'disabled', messagingEnabled: true,
      kickOutbound: async (b, c, text, asks, notice, tx, quoteId) => {
        sent.push(text);
        await enqueueOutboundRow(tx, b as BusinessId, c, text, 'employee', null, asks, notice, true, null, false, quoteId ?? null);
      },
      kickDrive: async () => {}, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    } as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', headers: FORM,
      payload: 'code=follow-up-fixture' })).headers['set-cookie']).split(';')[0]!;
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await admin?.end(); });
  beforeEach(async () => {
    const customer = randomUUID(), product = randomUUID(), quote = randomUUID(); conversation = randomUUID();
    await query(`insert into clients(id, business_id, display_name) values ($1, $2, 'Customer')`, [customer, business]);
    await query(`insert into client_channels(client_id, channel, channel_user_id, last_inbound_at)
      values ($1, 'telegram', $2, $3)`, [customer, randomUUID(), quotedAt]);
    await query(`insert into conversations(id, business_id, client_id, channel) values ($1, $2, $3, 'telegram')`, [conversation, business, customer]);
    await query(`insert into products(id, business_id, sku, name, unit) values ($1, $2, $3, 'Lip balm', 'item')`, [product, business, product]);
    await query(`insert into quotes(id, business_id, conversation_id, product_id, quantity, inputs, unit_price_usd,
      discount_pct, total_usd, requires_human, applied_rules, engine_version)
      values ($1, $2, $3, $4, 1, '{}', 12, 0, 12, false, '{}', 'fixture')`, [quote, business, conversation, product]);
    await query(`insert into outbound_messages(business_id, conversation_id, seq, body, status, quote_id, sent_at)
      values ($1, $2, 1, 'The price is 12 dollars.', 'sent', $3, $4)`, [business, conversation, quote, quotedAt]);
    await runDueFollowUps({ db, now: () => now }, business);
    draft = (await query(`select id from drafts where conversation_id = $1 and status = 'pending'`, [conversation])).rows[0].id;
    expect((await row()).turn_message_id).toBeNull();
  });

  it('renders the ordinary approval card and live refresh without an invented turn', async () => {
    const page = await get(`/app/inbox/${conversation}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(WORDS);
    expect(page.body).toContain('id="approve"');
    expect(page.body).toContain('name="command" value="send"');
    const live = await get(`/app/live/conversation/${conversation}?since=0.0.00000000`);
    expect(live.statusCode).toBe(200);
    expect(live.headers['content-type']).toContain('application/json');
  });

  it.each([['Send', WORDS, 'approved'], ['Edit', 'I can answer any questions about it.', 'edited']])('%s uses applyOwnerCommand and the exact outbound link', async (_action, edit, status) => {
    const before = sent.length;
    const response = await post(`/app/inbox/${conversation}/act`, { draftId: draft, command: 'send', edit: edit! });
    expect(response.statusCode).toBe(302);
    expect(await row()).toMatchObject({ status, sent_text: edit, turn_message_id: null });
    expect(sent.slice(before)).toEqual([edit]);
    const link = (await query(`select a.outbound_id, o.body from follow_up_approvals a
      join outbound_messages o on o.id = a.outbound_id where a.draft_id = $1`, [draft])).rows;
    expect(link).toHaveLength(1); expect(link[0].body).toBe(edit);
    await post(`/app/inbox/${conversation}/act`, { draftId: draft, command: 'send', edit: edit! });
    expect(sent.slice(before)).toEqual([edit]);
  });

  it('No reply needed resolves the ordinary draft without enqueueing anything', async () => {
    const before = sent.length;
    await post(`/app/inbox/${conversation}/act`, { draftId: draft, command: '不回', edit: WORDS });
    expect((await row()).status).toBe('rejected'); expect(sent).toHaveLength(before);
  });

  it('Hand to me keeps the existing handover, and the sweep then retires this follow-up', async () => {
    const before = sent.length;
    await post(`/app/inbox/${conversation}/takeover`, { draftId: draft, edit: WORDS });
    const page = await get(`/app/inbox/${conversation}`);
    expect(page.body).not.toContain('id="approve"');
    expect(page.body).toContain(`action="/app/inbox/${conversation}/reply"`);
    await runDueFollowUps({ db, now: () => now }, business);
    expect((await row()).status).toBe('superseded'); expect(sent).toHaveLength(before);
  });

  it('ordinary Meta draft expiry still applies, with no new exemption', async () => {
    await query(`update conversations set channel = 'instagram' where id = $1`, [conversation]);
    await query(`update client_channels set channel = 'instagram', last_inbound_at = now() - interval '25 hours'
      where client_id = (select client_id from conversations where id = $1)`, [conversation]);
    await withTenantTx(db, business, (tx) => sql`select expire_waiting_drafts()`.execute(tx));
    expect((await row()).status).toBe('expired');
    expect((await get(`/app/inbox/${conversation}`)).body).not.toContain('id="approve"');
  });

  it('a reply arriving before Send supersedes the draft and the old Send cannot queue', async () => {
    const before = sent.length;
    await query(`insert into messages(conversation_id, direction, input_type, text_content, sent_at)
      values ($1, 'inbound', 'unknown', 'A held media message', $2)`, [conversation, now]);
    await post(`/app/inbox/${conversation}/act`, { draftId: draft, command: 'send', edit: WORDS });
    expect((await row()).status).toBe('superseded'); expect(sent).toHaveLength(before);
  });
});
