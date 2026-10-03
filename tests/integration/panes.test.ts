import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { buttonsAndDoors } from '../parity/buttons-and-doors.js';

/**
 * THE SHELL, over Postgres (the design pass, 2026-09-29): the rail's one
 * number, the list beside a conversation, and the customer panel read from
 * the rows the product keeps — turns, quotes, samples, sent rows and drafts.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd7c0000-0000-4000-8000-${RUN}0003`;
const PID = randomUUID();
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('the shell: the rail, the list pane, the customer panel (requires DATABASE_URL)', () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let cookie = '';
  let maya = '';
  let omar = '';

  const tx = async <R>(fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await tx((x) => sql`insert into businesses (id, name, owner_locale) values (${BIZ}, 'Hana Skincare', 'en')
                        on conflict (id) do nothing`.execute(x));
    await tx(async (x) => {
      const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
                values (${BIZ}, 'whatsapp', ${`wa-panes-${RUN}`}, 'panes-secret', 'service', true)`.execute(x);
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active)
                values (${PID}, ${BIZ}, ${'RS-' + RUN}, 'Rose Face Serum', 'bottles', null, true)`.execute(x);
      const m = await ensureConversation(x, b.value, `44770090${RUN.slice(0, 4).replace(/\D/g, '1')}`, 'Maya Rahman', 'whatsapp');
      const o = await ensureConversation(x, b.value, `44770091${RUN.slice(0, 4).replace(/\D/g, '2')}`, 'Omar Haddad', 'whatsapp');
      maya = m.conversationId; omar = o.conversationId;
      await sql`update conversations set assigned_to = null where id in (${maya}::uuid, ${omar}::uuid)`.execute(x);
      await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at) values
                (${maya}::uuid, ${`m1-${RUN}`}, 'inbound', 'text', 'is the rose serum vegan?', now() - interval '3 days'),
                (${maya}::uuid, ${`m2-${RUN}`}, 'inbound', 'text', 'how much is the rose serum?', now() - interval '1 minute'),
                (${omar}::uuid, ${`o1-${RUN}`}, 'inbound', 'text', 'thanks!', now() - interval '1 hour')`.execute(x);
      // Two turns found the product in what Maya wrote.
      for (const id of [`m1-${RUN}`, `m2-${RUN}`]) {
        await sql`insert into turns (message_id, business_id, conversation_id, state_before, input, analysis, decision, engine, engine_version)
                  values (${id}, ${BIZ}, ${maya}, '{}'::jsonb, '{}'::jsonb,
                          ${JSON.stringify({ language: { detected: 'en', replyIn: 'en' }, intent: { primary: 'price_request',
                            productCandidate: { productId: PID, confidence: 0.9, confirmedByClient: false, matchMethod: 'text' },
                            quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] }, recommendedPhase: 'qualification' })}::jsonb,
                          '{}'::jsonb, 'service', 'test')`.execute(x);
      }
      await sql`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version)
                values (${BIZ}, ${maya}, ${PID}, 10, '{}'::jsonb, 34.90, 349, 'test')`.execute(x);
      await sql`insert into sample_requests (business_id, conversation_id, asked_text, requested_at)
                values (${BIZ}, ${maya}, 'can I have a sample?', now() - interval '2 days')`.execute(x);
      // Who acted: the assistant alone; the owner's approval of a draft; the owner in person; one that did not reach her.
      await sql`insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status, sent_text)
                values (${BIZ}, ${maya}, 'quote', 'Yes, it is vegan.', null, 'approved', 'Yes, it is vegan.')`.execute(x);
      await sql`insert into outbound_messages (business_id, conversation_id, seq, body, origin, status, sent_at) values
                (${BIZ}, ${maya}::uuid, 1, 'Hello Maya!', 'employee', 'sent', now() - interval '3 days'),
                (${BIZ}, ${maya}::uuid, 2, 'Yes, it is vegan.', 'employee', 'sent', now() - interval '2 days'),
                (${BIZ}, ${maya}::uuid, 3, 'I will check the 100 ml myself.', 'owner', 'sent', now() - interval '1 day'),
                (${BIZ}, ${maya}::uuid, 4, 'It is 34.90.', 'employee', 'canceled', null)`.execute(x);
      await sql`insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
                values (${BIZ}, ${maya}, 'quote', 'The Rose Face Serum is 34.90.', null, 'pending')`.execute(x);
    });
    app = Fastify({ logger: false });
    const code = `panes-${RUN}`;
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: true, kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${code}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  const page = async (url: string) => (await app.inject({ method: 'GET', url, headers: { cookie } })).body;

  it('the rail counts who needs the owner, read fresh on every page', async () => {
    const html = await page('/app');
    expect(html).toMatch(/class="navlink sub" data-nav="inbox" aria-label="Inbox, 1 customer needs you"\s*><svg[\s\S]*?<\/svg><span class="nl-text">Inbox<\/span><span class="navcount" aria-hidden="true"><span class="nl-long">1 waiting<\/span>/);
    // Omar's conversation is handed to a person: the rail says so on the next page, not a minute later
    await tx((x) => sql`update conversations set assigned_to = 'unclaimed' where id = ${omar}::uuid`.execute(x));
    expect(await page('/app')).toContain('<span class="nl-short">2</span>');
    await tx((x) => sql`update conversations set assigned_to = null where id = ${omar}::uuid`.execute(x));
  });

  it('a conversation stands between its list and its customer', async () => {
    const html = await page(`/app/inbox/${maya}`);
    // V1-105 — on a phone every page says whose workspace it is, so its line may come first.
    expect(html).toMatch(/<main id="main" class="wide">(?:<p class="business-name"><bdi>[^<]*<\/bdi><\/p>)?<div class="panes"><aside class="listpane"/);
    // The warmth run, phase 4 — the Inbox's own row, and its own first page: "waiting now", the
    // whole list, whoever needs the owner first. Maya (a reply to review) leads it; Omar is under her.
    expect(html).toMatch(new RegExp(`<div class="irow is-\\w+[^"]* on">(?:(?!<div class="irow)[\\s\\S])*?<a class="ir-main" href="/app/inbox/${maya}#latest" aria-current="page">`));
    expect(html.indexOf(`href="/app/inbox/${omar}#latest"`)).toBeGreaterThan(html.indexOf(`href="/app/inbox/${maya}#latest"`));
    expect(html).toContain('<a class="tab on" aria-current="true" href="/app/inbox">Waiting now</a><a class="tab" href="/app/inbox?lens=value">Matters most</a>');
    expect(html).toContain('<title>Maya Rahman · Hana Skincare</title>');
    expect(buttonsAndDoors(html)).toEqual([]);
  });

  it('the panel: what they asked about, the prices worked out, what is on record, and who acted', async () => {
    const html = await page(`/app/inbox/${maya}`);
    const panel = html.slice(html.indexOf('<aside class="panel"'), html.indexOf('</aside>', html.indexOf('<aside class="panel"')));
    expect(panel).toContain('<h2><bdi>Maya Rahman</bdi></h2>');
    expect(panel).toMatch(/WhatsApp <bdi dir="ltr">\+44770090\d+<\/bdi> · writes in English/);
    expect(panel).toContain('1 conversation');
    expect(panel).toMatch(/<bdi>Rose Face Serum<\/bdi><\/span><span class="pn-r">2 times · /);
    expect(panel).toContain('<bdi>$34.90</bdi> · <bdi>Rose Face Serum</bdi>');
    expect(panel).toContain('Sample · asked ');
    const activity = panel.slice(panel.indexOf('<h3>Activity</h3>'));
    const order = ['Needs you', 'didn’t reach them', 'You answered yourself', 'You sent', 'replied'].map((s) => activity.indexOf(s));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));   // newest first
    expect(activity).toContain('<span class="pn-you" aria-hidden="true">●</span> You sent');
    expect(activity).toContain('<span class="as" aria-hidden="true">✦</span> Your assistant replied');
    expect(panel).toContain(`href="/app/conversations/${maya}"`);
  });
});
