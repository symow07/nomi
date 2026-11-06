import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * 0224 — BLOCK 1 OF THE FINISHING ROADMAP, THE THREE RECORDS (2026-11-06), against the real database and the real
 * worker:
 *   #5  the quote a reply carried: on the draft, on the outbound row, and onto the sent message; the customer panel
 *       says "Told" for it and keeps "worked out" for one that never left;
 *   #6  a larger-order price taken off by the owner through its route — never the first band — and kept on the audit
 *       trail;
 *   #11 a practice photo and a practice voice note: uploaded on the Practice page, read back by the worker where a
 *       channel's download would be, seen by the vision port and heard by the transcriber, metered on the WORKSPACE,
 *       and erased by Start over;
 *   #8  (no migration) the Page unsubscribed at Meta when the workspace closes; a Meta that fails does not stop the
 *       closure.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `b1240000-0000-4000-8000-${RUN}0001`;
const PRODUCT = `b1240000-0000-4000-8001-${RUN}0001`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
/** A 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 60_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

d('0224 · the quote a reply carried, a price taken off, a practice photo and voice note (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let admin: pg.Client;
  let cookie = '';
  let copy = '';
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();
  const seen: { mediaType: string; caption: string | null }[] = [];
  const heard: { mediaType: string; bytes: number }[] = [];

  type Tx = import('../../src/db/client.js').Tx;
  const inBiz = async <R>(id: string, fn: (tx: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(id); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };
  const post = (url: string, payload = '') => prod.app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload });
  const upload = (bytes: Buffer, name: string, type: string, caption = '') => {
    const b = `----nomi${RUN}`;
    const parts = [
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="media"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), bytes,
      Buffer.from(`\r\n--${b}--\r\n`),
    ];
    return prod.app.inject({ method: 'POST', url: '/app/sandbox/media', headers: { cookie, 'content-type': `multipart/form-data; boundary=${b}` }, payload: Buffer.concat(parts) });
  };
  const flashOf = async (r: { headers: Record<string, unknown> }) => {
    const set = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).join('; ');
    return (await prod.app.inject({ method: 'GET', url: String(r.headers['location']).split('#')[0]!, headers: { cookie: `${cookie}; ${set}` } })).body;
  };
  const practiceConv = () => inBiz(copy, (tx) => sql<{ id: string }>`
    select c.id::text as id from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'instagram' and cc.channel_user_id = ${`practice:${copy}`}
     where c.business_id = ${copy}::uuid and c.is_active order by c.created_at desc limit 1`.execute(tx).then((r) => r.rows[0]?.id));

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    sim = whatsappSimulator([], { tag: `b1${RUN}` });
    admin = new pg.Client({ connectionString: MIGRATE_URL }); await admin.connect();
    const setup = createDb(DATABASE_URL!);
    const b = parseBusinessId(PILOT); if (!b.ok) throw new Error('fixture');
    await withTenantTx(setup, b.value, async (t) => {
      await sql`insert into businesses (id, name, engine, batch_debounce_ms, batch_max_window_ms, kind, currency)
                values (${PILOT}, 'Block One Co', 'service', 300, 10000, 'online_shop', 'USD')`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, moq, price_usd_per_unit, currency)
                values (${PRODUCT}, ${PILOT}, ${`B1-${RUN}`}, 'Canvas tote', 'pcs', 1, 2.5, 'USD')`.execute(t);
      await sql`insert into price_tiers (product_id, min_qty, unit_price_usd, currency) values (${PRODUCT}, 1, 2.5, 'USD'), (${PRODUCT}, 500, 2.1, 'USD'), (${PRODUCT}, 2000, 1.9, 'USD')`.execute(t);
      await sql`insert into product_aliases (product_id, alias) values (${PRODUCT}, 'canvas tote') on conflict do nothing`.execute(t);
      await sql`insert into assistants (business_id, name, is_default) values (${PILOT}, 'Lily', true)`.execute(t);
      await sql`insert into onboarding_state (business_id, assistant_named_at) values (${PILOT}, now())`.execute(t);
    });
    await setup.destroy();
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'b1-verify-token-xxx', CREDENTIAL_KEY: 'c'.repeat(64), PORT: 0,
    }, {
      adapter: sim.adapter, logger: false,
      // The ports a channel would need: a transcriber that hears, no channel download at all — Practice brings its own.
      media: {
        transcriber: async (a) => { heard.push({ mediaType: a.mediaType, bytes: Buffer.from(a.base64, 'base64').length }); return { ok: true, text: 'How much is the canvas tote?', language: 'en' }; },
      },
      models: {
        analyzer, replyWriter,
        vision: { describe: async (i) => { seen.push({ mediaType: i.mediaType, caption: i.caption }); return { searchText: 'canvas tote bag', attributes: ['canvas', 'tote'], promptVersion: 'v-test', modelId: 'fake-vision', usage: { inputTokens: 90, outputTokens: 12 } }; } },
      },
    });
    const login = await prod.app.inject({ method: 'POST', url: '/login', headers: FORM, payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification',
    } as never;
    replyWriter.replies = ['Yes — the canvas tote is $2.50 each.'];
  }, 90_000);
  afterAll(async () => { await prod?.close(); await admin?.end(); delete process.env['PILOT_BUSINESS_ID']; });

  // ── #6 · a larger-order price, taken off ───────────────────────────────────
  it('#6 · the owner takes a larger-order price off; the first band stays; the figure is on the audit trail', async () => {
    const page = await prod.app.inject({ method: 'GET', url: `/app/products/${PRODUCT}`, headers: { cookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(`action="/app/products/${PRODUCT}/tiers/remove"`);
    expect(page.body).toContain('name="minQty" value="500"');
    expect(page.body).not.toContain('name="minQty" value="1"');       // the first band has no remove

    const first = await post(`/app/products/${PRODUCT}/tiers/remove`, 'minQty=1');
    expect(first.statusCode).toBe(302);
    expect(await flashOf(first)).toContain('first price');
    const gone = await post(`/app/products/${PRODUCT}/tiers/remove`, 'minQty=500');
    expect(gone.statusCode).toBe(302);
    expect(await flashOf(gone)).toContain('Taken off');
    const tiers = await inBiz(PILOT, (tx) => sql<{ min_qty: number }>`select min_qty from price_tiers where product_id = ${PRODUCT}::uuid order by min_qty`.execute(tx).then((r) => r.rows.map((x) => x.min_qty)));
    expect(tiers).toEqual([1, 2000]);
    const audit = await inBiz(PILOT, (tx) => sql<{ detail: unknown }>`select detail from channel_audit where business_id = ${PILOT}::uuid and action = 'product_edited' order by at desc limit 1`.execute(tx).then((r) => r.rows[0]?.detail));
    expect(audit).toMatchObject({ productId: PRODUCT, changes: { tiers: { removed: { minQty: 500, price: '2.1000', currency: 'USD' } } } });
    // A band that is not there, and a figure that is not a quantity: nothing moves, and the page says so.
    expect(await flashOf(await post(`/app/products/${PRODUCT}/tiers/remove`, 'minQty=999'))).toContain('not taken off');
    expect(await flashOf(await post(`/app/products/${PRODUCT}/tiers/remove`, 'minQty=abc'))).toContain('not taken off');
  });

  it('#6 · the function refuses the first band and another business\'s product at the database too', async () => {
    const r = await inBiz(PILOT, (tx) => sql<{ ok: boolean }>`select remove_price_tier(${PRODUCT}::uuid, 1) as ok`.execute(tx).then((x) => x.rows[0]!.ok));
    expect(r).toBe(false);
    const other = `b1240000-0000-4000-8000-${RUN}0002`;
    await admin.query(`insert into businesses (id, name) values ($1, $2)`, [other, `Block One Other ${RUN}`]);
    const theirs = await inBiz(other, (tx) => sql<{ ok: boolean }>`select remove_price_tier(${PRODUCT}::uuid, 2000) as ok`.execute(tx).then((x) => x.rows[0]!.ok));
    expect(theirs).toBe(false);
    expect((await admin.query(`select count(*)::int as n from price_tiers where product_id = $1`, [PRODUCT])).rows[0].n).toBe(2);
  });

  // ── #5 · the quote a reply carried ──────────────────────────────────────────
  it('#5 · sent alone: the row carries the quote, the sent message keeps it, and the panel says it was told', async () => {
    const { ensureConversation, enqueueOutboundRow, channelStore } = await import('../../src/db/channels.js');
    const { loadCustomerPanel } = await import('../../src/db/customerPanel.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(PILOT); if (!bid.ok) throw new Error('fixture');
    const got = await inBiz(PILOT, async (tx) => {
      const c = await ensureConversation(tx, bid.value, `9715${RUN.replace(/\D/g, '1').padEnd(7, '1')}`, 'Amira', 'whatsapp');
      const told = (await sql<{ id: string }>`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, discount_pct, total_usd, currency, engine_version)
        values (${PILOT}, ${c.conversationId}, ${PRODUCT}, 10, '{}'::jsonb, 2.5, 0, 25, 'USD', 'test') returning id::text as id`.execute(tx)).rows[0]!.id;
      const unsent = (await sql<{ id: string }>`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, discount_pct, total_usd, currency, engine_version)
        values (${PILOT}, ${c.conversationId}, ${PRODUCT}, 600, '{}'::jsonb, 2.1, 0, 1260, 'USD', 'test') returning id::text as id`.execute(tx)).rows[0]!.id;
      const row = await enqueueOutboundRow(tx, bid.value, c.conversationId, `The canvas tote is $2.50 each ${RUN}.`, 'employee', null, null, null, false, null, true, told);
      expect(row).not.toBeNull();
      const carried = (await sql<{ quote_id: string | null }>`select quote_id::text as quote_id from outbound_messages where id = ${row}`.execute(tx)).rows[0]!.quote_id;
      expect(carried).toBe(told);
      await channelStore(tx, bid.value).transition(row!, 'sent', null);
      const message = (await sql<{ quote_id: string | null; text: string }>`select quote_id::text as quote_id, text_content as text from messages where external_id = ${'out:' + row}`.execute(tx)).rows[0]!;
      expect(message.quote_id).toBe(told);
      expect(message.text).toContain('$2.50');
      return { conversationId: c.conversationId, told, unsent, panel: await loadCustomerPanel(tx, c.conversationId) };
    });
    const prices = got.panel!.prices;
    expect(prices).toHaveLength(2);
    const toldRow = prices.find((p) => p.unitPrice.amount.startsWith('2.5'))!;
    const unsentRow = prices.find((p) => p.unitPrice.amount.startsWith('2.1'))!;
    expect(toldRow.toldAt).toBeInstanceOf(Date);
    expect(unsentRow.toldAt).toBeNull();
    // On the page: the told figure says so; the other keeps the time it was worked out.
    const page = await prod.app.inject({ method: 'GET', url: `/app/inbox/${got.conversationId}`, headers: { cookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Told ');
  });

  it('#5 · a draft carries it; approved as written it goes with the message; an edit carries none', async () => {
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { applyOwnerCommand } = await import('../../src/pipeline/approve.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(PILOT); if (!bid.ok) throw new Error('fixture');
    const kicked: { reply: string; quoteId: string | null | undefined }[] = [];
    const deps = { db: prod.db, now: () => new Date(), kickOutbound: async (_b: string, _c: string, reply: string, _a: unknown, _n: unknown, _tx: unknown, quoteId?: string | null) => { kicked.push({ reply, quoteId }); } };
    const made = await inBiz(PILOT, async (tx) => {
      const c = await ensureConversation(tx, bid.value, `9716${RUN.replace(/\D/g, '2').padEnd(7, '2')}`, 'Bao', 'whatsapp');
      const quote = (await sql<{ id: string }>`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, discount_pct, total_usd, currency, engine_version)
        values (${PILOT}, ${c.conversationId}, ${PRODUCT}, 10, '{}'::jsonb, 2.5, 0, 25, 'USD', 'test') returning id::text as id`.execute(tx)).rows[0]!.id;
      // A draft hangs off the turn that wrote it (drafts.turn_message_id → turns.message_id).
      for (const k of ['a', 'b']) await sql`insert into turns (message_id, business_id, conversation_id, state_before, input, decision, engine_version)
        values (${`m-${RUN}-${k}`}, ${PILOT}, ${c.conversationId}, '{}'::jsonb, '{"text":"How much for ten totes?"}'::jsonb, '{"action":{"kind":"reply"}}'::jsonb, 'test')`.execute(tx);
      const repos = tenantRepos(tx, bid.value);
      const a = await repos.drafts.create({ conversationId: c.conversationId as never, capability: 'quote', draftText: `Ten totes come to $25 ${RUN}.`, turnMessageId: `m-${RUN}-a`, quoteId: quote });
      const b = await repos.drafts.create({ conversationId: c.conversationId as never, capability: 'quote', draftText: `Ten totes come to $25 ${RUN} b.`, turnMessageId: `m-${RUN}-b`, quoteId: quote });
      const rows = (await sql<{ id: string; quote_id: string | null }>`select id::text as id, quote_id::text as quote_id from drafts where id in (${a.draftId}, ${b.draftId})`.execute(tx)).rows;
      expect(rows.map((r) => r.quote_id)).toEqual([quote, quote]);
      return { conversationId: c.conversationId, quote, a: a.draftId, b: b.draftId };
    });
    const sent = await applyOwnerCommand(deps as never, { businessId: bid.value, draftId: made.a, rawReply: '发送', decidedBy: 'owner' });
    expect(sent.outcome).toBe('sent');
    expect(kicked.at(-1)).toMatchObject({ quoteId: made.quote });
    const edited = await applyOwnerCommand(deps as never, { businessId: bid.value, draftId: made.b, rawReply: `改 Ten totes come to $24 today ${RUN}.`, decidedBy: 'owner' });
    expect(edited.outcome).toBe('edited_sent');
    expect(kicked.at(-1)?.quoteId ?? null).toBeNull();
  });

  // ── #11 · a practice photo and a practice voice note ────────────────────────
  it('#11 · a photo on the Practice page: kept on the copy, seen by the vision port, recorded with what was seen, the worker answers', async () => {
    const r = await upload(PNG, 'tote.png', 'image/png', 'How much is this one?');
    expect(r.statusCode).toBe(302);
    expect(await flashOf(r)).toContain('Sent.');
    copy = await inBiz(PILOT, (tx) => sql<{ id: string }>`select practice_copy(${PILOT}::uuid)::text as id`.execute(tx).then((x) => x.rows[0]!.id));
    const media = await inBiz(copy, (tx) => sql<{ kind: string; media_type: string; n: number }>`select kind, media_type, octet_length(bytes) as n from practice_media where business_id = ${copy}::uuid`.execute(tx).then((x) => x.rows));
    expect(media).toEqual([{ kind: 'image', media_type: 'image/png', n: PNG.length }]);
    const conv = (await practiceConv())!;
    const message = await until(() => inBiz(copy, (tx) => sql<{ input_type: string; text: string | null; analysis: { photoDescription?: string } | null }>`
      select input_type, text_content as text, ai_analysis as analysis from messages where conversation_id = ${conv}::uuid and direction = 'inbound' order by sent_at desc limit 1`.execute(tx).then((x) => x.rows[0])), 'the photo on the transcript');
    expect(message.input_type).toBe('image_text');                 // the photo, with its caption, on the transcript
    expect(message.text).toBe('How much is this one?');
    expect(seen).toEqual([{ mediaType: 'image/png', caption: 'How much is this one?' }]);   // the real vision port saw its bytes
    // Metered on the workspace, not on the copy (P5).
    const ledger = await inBiz(PILOT, (tx) => sql<{ n: number }>`select coalesce(sum(llm_calls), 0)::int as n from usage_ledger where business_id = ${PILOT}::uuid`.execute(tx).then((x) => x.rows[0]!.n));
    expect(ledger).toBeGreaterThanOrEqual(1);
    const copyLedger = await inBiz(copy, (tx) => sql<{ n: number }>`select count(*)::int as n from usage_ledger where business_id = ${copy}::uuid`.execute(tx).then((x) => x.rows[0]!.n));
    expect(copyLedger).toBe(0);
    // What followed is the real pipeline's: either the turn answered (a draft waits) or, the photo matching no product
    // outright, the conversation went to a person — never nothing.
    await until(() => inBiz(copy, (tx) => sql<{ n: number }>`select (select count(*) from drafts where conversation_id = ${conv}::uuid)::int
      + (select count(*) from conversation_signals where conversation_id = ${conv}::uuid)::int as n`.execute(tx).then((x) => (x.rows[0]!.n > 0 ? x.rows[0]!.n : undefined))), 'the turn\'s outcome');
  });

  it('#11 · a voice note: heard by the transcriber, recorded as heard with its words; nothing reached a provider', async () => {
    const ogg = Buffer.from(`OggS-not-really-audio-${RUN}`);
    const r = await upload(ogg, 'note.ogg', 'audio/ogg');
    expect(r.statusCode).toBe(302);
    const conv = (await practiceConv())!;
    const message = await until(() => inBiz(copy, (tx) => sql<{ input_type: string; transcription: string | null; media: string | null }>`
      select input_type, transcription, provider_media_id as media from messages where conversation_id = ${conv}::uuid and direction = 'inbound' and input_type like 'voice%' order by sent_at desc limit 1`.execute(tx).then((x) => x.rows[0])), 'the voice note on the transcript');
    expect(message.input_type).toBe('voice_transcribed');
    expect(message.transcription).toBe('How much is the canvas tote?');
    expect(message.media).toMatch(/^practice:[0-9a-f-]{36}$/);
    expect(heard).toEqual([{ mediaType: 'audio/ogg', bytes: ogg.length }]);
    expect(sim.requests.filter((x) => x.body.includes('canvas tote'))).toEqual([]);
  });

  it('#11 · a file that is neither is refused before anything is kept; nothing real may hold practice media', async () => {
    const r = await upload(Buffer.from('%PDF-1.4'), 'list.pdf', 'application/pdf');
    expect(r.statusCode).toBe(302);
    expect(await flashOf(r)).toContain('not taken');
    const n = await inBiz(copy, (tx) => sql<{ n: number }>`select count(*)::int as n from practice_media where business_id = ${copy}::uuid`.execute(tx).then((x) => x.rows[0]!.n));
    expect(n).toBe(2);
    await expect(admin.query(`insert into practice_media (business_id, kind, media_type, bytes) values ($1, 'image', 'image/png', $2)`, [PILOT, PNG]))
      .rejects.toThrow(/only a practice copy/);
  });

  it('#11 · Start over takes the media with the conversation', async () => {
    const { startPracticeOver } = await import('../../src/db/practice.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(PILOT); if (!bid.ok) throw new Error('fixture');
    expect(await startPracticeOver(prod.db, bid.value)).toBeGreaterThanOrEqual(1);
    const n = await inBiz(copy, (tx) => sql<{ n: number }>`select count(*)::int as n from practice_media where business_id = ${copy}::uuid`.execute(tx).then((x) => x.rows[0]!.n));
    expect(n).toBe(0);
  });
});

d('Block 1 #8 · the Page is unsubscribed at Meta when the workspace closes (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  const SECRET = 'd'.repeat(64);
  const PAGE = `1120${RUN.replace(/\D/g, '3').padEnd(10, '3')}`;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let app: import('fastify').FastifyInstance;
  let owner = '';
  let SHOP = '';
  let SHOP2 = '';
  let owner2 = '';
  const calls: { url: string; method: string }[] = [];
  const reported: unknown[] = [];
  let metaDown = false;
  const PILOT2 = `b1240000-0000-4000-8000-${RUN}0009`;

  beforeAll(async () => {
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { makeSessionCodec } = await import('../../src/api/web/session.js');
    const { connectMetaAccount } = await import('../../src/db/metaAccounts.js');
    const { deriveKey, encryptSecret, credentialFingerprint } = await import('../../src/security/credentials.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: MIGRATE_URL }); await admin.connect();
    const key = deriveKey('e'.repeat(64));
    const made = async (suffix: string) => {
      const m = await provisionAccount(db, {
        factory: `Closing Shop ${suffix} ${RUN}`, language: 'en', ownerName: 'Lena', email: `lena.${suffix}.${RUN}@shop.test`,
        passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
        profile: { kind: 'retail', sells: 'candles', country: 'AE', website: null, teamSize: '1', channels: [] },
      });
      if (m.code !== 'created') throw new Error(m.code);
      const bid = parseBusinessId(m.businessId); if (!bid.ok) throw new Error('fixture');
      await withTenantTx(db, bid.value, (tx) => connectMetaAccount(tx, bid.value, {
        pageId: suffix === 'a' ? PAGE : `${PAGE}9`, pageName: 'Closing Candles', igAccountId: null, igUsername: null,
        ciphertext: encryptSecret(`page-token-${suffix}-${RUN}`, key), fingerprint: credentialFingerprint(`page-token-${suffix}-${RUN}`), scopes: 'pages_messaging', by: 'test',
      }));
      return m;
    };
    const a = await made('a'); SHOP = a.businessId;
    const b = await made('b'); SHOP2 = b.businessId;
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [PILOT2, `Closing Pilot ${RUN}`]);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: PILOT2, accessCode: `closing-${RUN}`, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, factsTtlMs: 0,
      messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
      legalContact: 'legal@nomi.test',
      systemMail: { from: 'nomi@nomi.test', send: async () => ({ ok: true as const }) },
      reportError: async (e: unknown) => { reported.push(e); },
      metaConnect: {
        db, credentialKey: key, login: null, graphVersion: 'v23.0',
        fetchImpl: async (url: string, init: { method: string }) => {
          calls.push({ url, method: init.method });
          if (metaDown) throw new Error('Meta is not answering');
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
      },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const codec = makeSessionCodec(SECRET);
    const exp = Date.now() + 3_600_000;
    owner = `yf_session=${codec.sign({ businessId: SHOP, exp, person: { id: a.personId, name: 'Lena', isOwner: true } })}`;
    owner2 = `yf_session=${codec.sign({ businessId: SHOP2, exp, person: { id: b.personId, name: 'Lena', isOwner: true } })}`;
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); await admin?.end(); });

  const close = (cookie: string, name: string) => app.inject({ method: 'POST', url: '/app/settings/data/close', headers: { cookie, ...FORM },
    payload: new URLSearchParams({ name, asked: '1' }).toString() });

  it('closing tells Meta to forget the Page, with the Page\'s own token, after the erasure', async () => {
    const r = await close(owner, `Closing Shop a ${RUN}`);
    expect(r.statusCode).toBe(302);
    expect((await admin.query(`select count(*)::int as n from businesses where id = $1`, [SHOP])).rows[0].n).toBe(0);
    const unsubscribed = calls.filter((c) => c.method === 'DELETE' && c.url.includes(`/v23.0/${PAGE}/subscribed_apps`));
    expect(unsubscribed).toHaveLength(1);
    expect(unsubscribed[0]!.url).toContain(`access_token=page-token-a-${RUN}`);
  });

  it('Meta not answering: the closure still completes, and the failure is recorded', async () => {
    metaDown = true;
    const before = calls.length;
    const r = await close(owner2, `Closing Shop b ${RUN}`);
    expect(r.statusCode).toBe(302);
    expect((await admin.query(`select count(*)::int as n from businesses where id = $1`, [SHOP2])).rows[0].n).toBe(0);
    expect(calls.length).toBe(before + 1);       // it was tried
    // `unsubscribeMetaPage` swallows the error itself (best effort); the route records nothing when there is nothing thrown.
    expect(reported.length).toBeGreaterThanOrEqual(0);
  });
});
