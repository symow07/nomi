import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { flashSaid } from './tenant.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * CC-25 leftovers — every way back from an action, and every door into a
 * conversation, lands on its newest message (2026-09-27).
 *
 * #95 opened the conversation page on `#latest` from Buyers. After anything
 * she DID there — send, skip, take over, reply, hand to a colleague, a voice
 * note, a proof link, a send nobody could account for — the page came back at
 * its top, where the notice was, and she scrolled down to where she had been.
 * The calendar, an order, Today, the samples list opened a conversation at the
 * top too, and Practice still drew its approval above its transcript.
 *
 * Over Postgres and the owner's own routes:
 *
 *   - every action's 302 goes to `/app/inbox/<id>#latest` — a Location with a
 *     fragment, which a browser keeps and scrolls to;
 *   - the page it lands on draws the notice under the newest message and above
 *     the reply waiting for approval, in English and in Arabic;
 *   - Today, the calendar, an order, the samples list, Buyers and the buyer
 *     file link the conversation at `#latest`, never at its top;
 *   - Practice: transcript, notice, approval, take-over, checks, the next
 *     message — and every practice action lands on `#latest` in the mode it
 *     was practising in, Reset on the empty transcript.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `cc2e0000-0000-4000-8000-${RUN}0001`;
const PROD = `cc2e0000-0000-4000-8000-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;
type Res = Awaited<ReturnType<import('fastify').FastifyInstance['inject']>>;

d('CC-25 · every way back lands on the newest message (requires DATABASE_URL)', () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let cookie = '';
  let conv = '';         // the conversation she acts on
  let voice = '';        // a buyer's voice note in it, already heard
  let order = '';
  let olderDraft = '';   // two replies wait; the page shows the newer
  let newerDraft = '';
  const unsure: string[] = [];   // sends nobody can account for
  const answered: string[] = [];
  const practised: { businessId: string; conversationId: string }[] = [];
  /** The practice adapter's part, for this test: queued rows sent, and on the transcript. */
  const deliver = (biz: string, conv: string) => as(biz, async (x) => {
    const rows = (await sql<{ id: string; body: string }>`
      select id::text as id, body from outbound_messages where conversation_id = ${conv}::uuid and status = 'queued'`.execute(x)).rows;
    for (const r of rows) {
      await sql`update outbound_messages set status = 'sent', sent_at = now(), provider_message_id = ${`practice:${r.id}`} where id = ${r.id}::uuid`.execute(x);
      await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
                values (${conv}::uuid, ${`out:${r.id}`}, 'outbound', 'text', ${r.body}, clock_timestamp())`.execute(x);
    }
  });

  const as = async <R>(biz: string, fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const get = (url: string, extra = '') => app.inject({ method: 'GET', url, headers: { cookie: `${cookie}${extra}` } });
  const post = (url: string, fields: Record<string, string> = {}) => app.inject({
    method: 'POST', url, headers: { ...FORM, cookie }, payload: new URLSearchParams(fields).toString(),
  });
  /** The notice a response set, carried to the next request as a browser would. */
  const noticeCookie = (res: Res): string => {
    const raw = res.headers['set-cookie'];
    const all = Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')];
    const c = all.find((x) => x.startsWith('yf_flash='));
    return c ? `; ${c.split(';')[0]}` : '';
  };
  /** Follow a redirect the way a browser does: the path goes to the server, the fragment stays with the browser. */
  const land = async (res: Res, locale?: string): Promise<string> => {
    const location = String(res.headers['location']);
    const r = await get(location.split('#')[0]!, `${noticeCookie(res)}${locale ? `; yf_locale=${locale}` : ''}`);
    expect(r.statusCode, location).toBe(200);
    return r.body;
  };
  const at = (html: string, needle: string): number => {
    const i = html.indexOf(needle);
    expect(i, needle).toBeGreaterThan(-1);
    return i;
  };
  /** Where a page lands after an action: the notice, carrying the one `latest` mark. */
  const landing = (html: string): number => {
    const m = /<div class="flash(?: bad)?" role="(?:status|alert)" id="latest">/.exec(html);
    expect(m, 'the notice carries the landing mark').not.toBeNull();
    expect(html.split('id="latest"').length - 1, 'one landing').toBe(1);
    return m!.index;
  };
  /** Every address on a page that opens a conversation. */
  const doors = (html: string) => [...html.matchAll(/href="(\/app\/inbox\/[^"]*)"/g)].map((m) => m[1]!);

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await as(BIZ, (x) => sql`insert into businesses (id, name, owner_locale) values (${BIZ}, 'Landing Works', 'en')
                             on conflict (id) do nothing`.execute(x));
    await as(BIZ, async (x) => {
      const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
      conv = (await ensureConversation(x, b.value, `ig-cc25-landing-${RUN}`, 'Amira Haddad', 'instagram')).conversationId;
      await sql`update conversations set assigned_to = null where id = ${conv}::uuid`.execute(x);
      // Six lines a minute apart, the buyer's question newest; a voice note of
      // hers early on, heard.
      voice = (await sql<{ id: string }>`
        insert into messages (conversation_id, direction, input_type, text_content, sent_at)
        values (${conv}::uuid, 'inbound', 'voice_transcribed', 'heard: five hundred in navy', now() - interval '30 minutes')
        returning id::text as id`.execute(x)).rows[0]!.id;
      await sql`
        insert into messages (conversation_id, direction, input_type, text_content, sent_at)
        select ${conv}::uuid, case when i % 2 = 1 then 'inbound' else 'outbound' end, 'text',
               'line-' || i, now() - (7 - i) * interval '1 minute'
          from generate_series(1, 6) as i
         where true`.execute(x);
      const draft = async (text: string, ago: string) => (await sql<{ id: string }>`
        insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status, created_at)
        values (${BIZ}, ${conv}::uuid, 'quote', ${text}, null, 'pending', now() - ${ago}::interval)
        returning id::text as id`.execute(x)).rows[0]!.id;
      olderDraft = await draft('An earlier reply, still waiting.', '10 minutes');
      newerDraft = await draft('We can do 500 pcs at 2.40 each.', '1 minute');
      // Two sends nobody can account for: Today names one, and she settles both.
      for (const n of [1, 2]) {
        unsure.push((await sql<{ id: string }>`
          insert into outbound_messages (business_id, conversation_id, seq, body, status)
          values (${BIZ}, ${conv}::uuid, ${1000 + n}, ${`did this arrive? ${n}`}, 'uncertain')
          returning id::text as id`.execute(x)).rows[0]!.id);
      }
      // A sample she has not dealt with (the calendar, the samples list), and an order (the calendar, the order page).
      await sql`insert into sample_requests (business_id, conversation_id, asked_text, requested_at)
                values (${BIZ}, ${conv}::uuid, 'can you send a sample?', now() - interval '1 day')`.execute(x);
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active)
                values (${PROD}, ${BIZ}, ${`LND-${RUN}`}, 'Vacuum cup', 'pcs', 100, true)`.execute(x);
      const client = (await sql<{ id: string }>`select client_id::text as id from conversations where id = ${conv}::uuid`
        .execute(x)).rows[0]!.id;
      order = (await sql<{ id: string }>`
        insert into orders (order_reference, business_id, client_id, conversation_id, product_id,
                            quantity, unit, agreed_unit_price_usd, total_value_usd, currency, status, confirmed_at)
        values (${`LND-${RUN}`}, ${BIZ}, ${client}::uuid, ${conv}::uuid, ${PROD}::uuid,
                500, 'pcs', 2.4, 1200, 'USD', 'confirmed', now() - interval '2 days')
        returning id::text as id`.execute(x)).rows[0]!.id;
    });

    app = Fastify({ logger: false });
    const code = `landing-${RUN}`;
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: true,
      kickOutbound: async () => {},
      // Practice (P3) runs on the worker, which this test does not start: it stands
      // in for the worker's answer (below) and for the practice adapter here — an
      // owner's reply on the practice copy is delivered as the adapter would.
      kickDrive: async (b: string, c: string) => { if (b !== BIZ) await deliver(b, c); },
      kickAnswer: async (_b: string, c: string) => { answered.push(c); },
      enqueueInbound: async (job: { businessId: string; conversationId: string }) => { practised.push(job); },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${code}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 120_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('Today, the calendar, an order, the samples list, Buyers and the buyer file open it on its newest message', async () => {
    const landing = `href="/app/inbox/${conv}#latest"`;
    const top = `href="/app/inbox/${conv}"`;
    // the calendar's three-week list: its window holds yesterday's sample and this week's order, whatever today is
    for (const url of ['/app', '/app/calendar?view=list', `/app/orders/${order}`, '/app/settings/samples',
      '/app/inbox?filter=all', `/app/conversations/${conv}`]) {
      const r = await get(url);
      expect(r.statusCode, url).toBe(200);
      expect(r.body, url).toContain(landing);
      expect(r.body, url).not.toContain(top);
      // every door into a conversation, on every one of them, lands — and carries no `%`
      for (const href of doors(r.body)) {
        expect(href, url).toMatch(/#latest$/);
        expect(href, url).not.toContain('%');
      }
    }
    // The calendar's order row opens the order; the order opens the conversation.
    expect((await get('/app/calendar?view=list')).body).toContain(`href="/app/orders/${order}"`);
    expect((await get(`/app/orders/${order}`)).body).toContain(`<a class="back" href="/app/inbox/${conv}#latest">`);
  });

  it('after she presses Send: back on the newest message, the notice under it, the next reply to approve under that', async () => {
    const res = await post(`/app/inbox/${conv}/act`, { draftId: olderDraft, command: '发送' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(`/app/inbox/${conv}#latest`);
    const said = flashSaid(res, SECRET);
    expect(said).not.toBe('');
    const html = await land(res);
    const newest = at(html, '<bdi>line-6</bdi>');
    const notice = landing(html);                  // the page opens on the notice itself
    const approve = at(html, 'class="card draft"');
    expect(notice).toBeGreaterThan(newest);
    expect(notice).toBeLessThan(approve);
    expect(html.slice(notice, approve)).toContain(esc(said));
    expect(html).toContain('We can do 500 pcs at 2.40 each.');   // the newer reply, still waiting
    expect(html.slice(newest, notice)).not.toMatch(/class="card|<form/);
    // nothing of it above the transcript, where it used to be drawn
    // The live line's template waits in the header (UI-PASS 6); a template is never drawn.
    expect(html.slice(at(html, '<main'), at(html, '<div class="block">')).replace(/<template[\s\S]*?<\/template>/g, '')).not.toContain('class="flash');
  });

  it('Arabic: the same landing, right to left', async () => {
    const res = await post(`/app/inbox/${conv}/handto`, { personId: randomUUID() });
    expect(res.headers['location']).toBe(`/app/inbox/${conv}#latest`);
    const html = await land(res, 'ar');
    expect(html).toContain('<html lang="ar" dir="rtl"');
    const notice = landing(html);
    expect(html.slice(notice)).toMatch(/^<div class="flash bad" role="alert" id="latest">/);   // a refusal, announced as one
    expect(notice).toBeGreaterThan(at(html, '<bdi>line-6</bdi>'));
    expect(notice).toBeLessThan(at(html, 'class="card draft"'));
    expect(html.slice(notice, at(html, 'class="card draft"'))).not.toContain('Nobody by that name');   // in Arabic, not English
  });

  it('every action on a conversation answers 302 onto its newest message', async () => {
    const back = `/app/inbox/${conv}#latest`;
    const cases: ReadonlyArray<readonly [string, Record<string, string>, boolean]> = [
      // [route, form, does it leave a notice]
      [`/app/inbox/${conv}/act`, {}, false],                                              // nothing chosen: straight back
      [`/app/inbox/${conv}/proof`, {}, true],                                             // no quote to prove: said there
      [`/app/inbox/${conv}/proof/revoke`, {}, true],
      [`/app/inbox/${conv}/assistant`, { assistant: randomUUID() }, true],
      [`/app/inbox/${conv}/heard`, {}, false],                                            // nothing typed: straight back
      [`/app/inbox/${conv}/heard`, { messageId: voice, heard: 'Five hundred, in navy.' }, true],
      [`/app/inbox/${conv}/answer-now`, {}, false],
      [`/app/inbox/${conv}/answer-now`, { messageId: voice }, true],
      [`/app/outbound/${unsure[0]}/leave`, {}, true],                                     // a send nobody can account for
      [`/app/outbound/${unsure[1]}/send-again`, {}, true],
      [`/app/inbox/${conv}/act`, { draftId: newerDraft, command: '不回' }, true],          // skip
      [`/app/inbox/${conv}/takeover`, {}, true],
      [`/app/inbox/${conv}/reply`, { text: 'Checking with the line now.' }, true],
      [`/app/inbox/${conv}/resume`, {}, true],
    ];
    for (const [url, fields, notice] of cases) {
      const r = await post(url, fields);
      const what = `${url} ${JSON.stringify(fields)}`;
      expect(r.statusCode, what).toBe(302);
      expect(r.headers['location'], what).toBe(back);
      expect(flashSaid(r, SECRET) !== '', what).toBe(notice);
      // and where it lands: on the notice, under the newest message — or, with
      // nothing to say, on the newest message itself
      const html = await land(r);
      if (notice) expect(landing(html), what).toBeGreaterThan(at(html, '<bdi>line-6</bdi>'));
      else expect(html, what).toMatch(/id="latest" class="msg (?:inbound|outbound)">\s*<div dir="auto" class="bubble(?: by-as)?"><bdi>line-6<\/bdi>/);
    }
    expect(answered).toEqual([conv]);   // "answer now" reached the worker's door, once
  });

  it('Practice: the transcript, then the approval, the take-over, the checks and the next message — and every action lands on #latest', async () => {
    const run = await post('/app/sandbox/scenario', { scenarioId: 'price-floor-clamp-under-aggressive-discount' });
    expect(run.statusCode).toBe(302);
    expect(run.headers['location']).toBe('/app/sandbox#latest');
    // P3 — the case's words went to the queue, on the workspace's own copy; the notice says so, under the line.
    const job = practised.at(-1)!;
    expect(job.businessId).not.toBe(BIZ);
    const sent = await land(run);
    expect(sent).toContain('We can commit to 5000 units');
    expect(landing(sent)).toBeGreaterThan(at(sent, 'We can commit to 5000 units'));

    // What the worker would write: the reply for approval, and the checks it ran.
    await as(job.businessId, async (x) => {
      await sql`insert into drafts (business_id, conversation_id, capability, draft_text, status)
                values (${job.businessId}::uuid, ${job.conversationId}::uuid, 'negotiate', 'Our floor for 5000 units is firm.', 'pending')`.execute(x);
      await sql`insert into conversation_events (business_id, conversation_id, type, payload)
                values (${job.businessId}::uuid, ${job.conversationId}::uuid, 'sandbox_turn', ${JSON.stringify({
                  scenarioId: null, scenarioTitle: null, capability: 'negotiate', appliedMode: 'draft', guardViolations: 0,
                  handoff: false, quote: null, checks: [{ invariant: 'priceFloorRespected', pass: true, detail: 'ok' }] })}::jsonb)`.execute(x);
    });
    const page = await get('/app/sandbox').then((r) => r.body);
    const order = [
      at(page, 'class="timeline"'), at(page, 'id="latest"'), at(page, 'class="card draft"'),
      at(page, 'class="card sbx-trust'), at(page, 'id="compose"'),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(page).not.toContain('class="card takeover');   // the fix wave (w4-conversation-03): the draft card's "I'll reply" is the take-over
    expect(page).toMatch(/id="latest" class="msg (?:inbound|outbound)">/);
    expect(at(page, 'We can commit to 5000 units')).toBeLessThan(at(page, 'class="card draft"'));

    const took = await post('/app/sandbox/takeover');
    expect(took.headers['location']).toBe('/app/sandbox#latest');
    const held = await land(took);
    const notice = landing(held);
    expect(notice).toBeGreaterThan(at(held, 'class="timeline"'));
    expect(notice).toBeLessThan(at(held, 'action="/app/sandbox/reply"'));

    const replied = await post('/app/sandbox/reply', { text: 'Let me check the floor for you.' });
    expect(replied.headers['location']).toBe('/app/sandbox#latest');
    const after = await land(replied);
    // her reply is the newest line now, and the notice — the landing — is under it
    // the signature line may carry the assistant's ✦ and name in spans (the design pass)
    expect(after).toMatch(/<div class="msg outbound">\s*<div dir="auto" class="bubble(?: by-as)?"><bdi>Let me check the floor for you\.<\/bdi><\/div>\s*<div class="ts muted">(?:[^<]|<\/?span[^>]*>)*<\/div>\s*<\/div><\/div>/);
    expect(landing(after)).toBeGreaterThan(at(after, 'Let me check the floor for you.'));

    const resumed = await post('/app/sandbox/resume');
    expect(resumed.headers['location']).toBe('/app/sandbox#latest');

    const said = await post('/app/sandbox/message', { text: 'do you have canvas bags?' });
    expect(said.headers['location']).toBe('/app/sandbox#latest');
    const draftId = await as(job.businessId, (x) => sql<{ id: string }>`
      select id::text as id from drafts where business_id = ${job.businessId}::uuid and status = 'pending'
       order by created_at desc limit 1`.execute(x).then((r) => r.rows[0]?.id ?? ''));
    const acted = await post('/app/sandbox/act', { draftId, command: '发送' });
    expect(acted.headers['location']).toBe('/app/sandbox#latest');

    // Reset empties it, and lands on its notice: under the empty transcript, the box under that —
    // not the top of a page whose first screen is the safety-check card.
    const reset = await post('/app/sandbox/reset');
    expect(reset.headers['location']).toBe('/app/sandbox#latest');
    const empty = await land(reset);
    const mark = landing(empty);
    expect(empty.slice(mark)).toMatch(/^<div class="flash" role="status" id="latest">/);   // good news, not drawn as a refusal
    expect(mark).toBeGreaterThan(at(empty, '<div class="empty muted">'));
    // Phase 9 (V1-286) — the safety checks are folded under the conversation now: the notice comes first.
    expect(at(empty, 'class="pcases"')).toBeGreaterThan(mark);
    expect(at(empty, 'id="compose"')).toBeGreaterThan(mark);
  });
});
