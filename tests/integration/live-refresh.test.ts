import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { GO } from '../../src/api/web/icons.js';

/**
 * CC-26 — a page open in the owner's browser learns of a new buyer message
 * without a reload, and says so (the audit's last open P1).
 *
 * Over Postgres, through the owner's own routes and the recorders the worker
 * uses when a buyer writes (`recordTypedMessage`, `recordReceivedMessage`):
 *
 *   - each watching page — a conversation, Buyers, Today — carries the one
 *     script and its own address with the mark it was drawn at;
 *   - that address says nothing is new, then a buyer writes and it says so;
 *     a reply waiting for review is news on the conversation, and so is the
 *     conversation changing hands or a send nobody can account for; a
 *     reaction the page does not show is not news; a file it names is;
 *   - another business's messages, drafts and hand-offs never count, and its
 *     conversation is not found (404) — row security, not a filter;
 *   - signed out, the script is told so (401) and a person is sent to sign in;
 *     a mark no page could carry is refused (400);
 *   - staff are told the same as the owner, and a stopped assistant changes
 *     nothing about it.
 *   - the warmth run, phase 8: every page asks the rail's address from the
 *     count it shows; only a rise names who arrived and why.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `c0260000-0000-4000-8000-${RUN}0001`;
const OTHER = `c0260000-0000-4000-8000-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const CODE = `live-owner-${RUN}`;
const STAFF_CODE = `live-staff-${RUN}`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const JSON_ACCEPT = { accept: 'application/json' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('CC-26 · the page learns that something new arrived (requires DATABASE_URL)', () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let owner = '';
  let staff = '';
  let conv = '';        // ours
  let second = '';      // ours, another buyer
  let theirs = '';      // another business's
  let seq = 0;

  const as = async <R>(biz: string, fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const get = (url: string, cookie = owner, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers: { ...(cookie ? { cookie } : {}), ...headers } });
  const post = (url: string, cookie = owner, fields: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  /** The address a page's script asks, as the browser reads it out of the attribute. */
  const askOf = (html: string): string => {
    // Phase 8 of the warmth run — Today's region says it is drawn again in place (`data-live-redraw`);
    // 0080's count of orders waiting, for the browser's own notice, is retired with that notice.
    const m = /<div class="live" role="status" aria-live="polite" data-live="([^"]+)"(?: data-live-redraw="1")?><\/div>/.exec(html);
    expect(m, 'the page carries its live region').not.toBeNull();
    return m![1]!.replace(/&amp;/g, '&');
  };
  const pageAsk = async (url: string, cookie = owner) => {
    const r = await get(url, cookie);
    expect(r.statusCode, url).toBe(200);
    return askOf(r.body);
  };
  const ask = async (url: string, cookie = owner) => {
    const r = await get(url, cookie, JSON_ACCEPT);
    // Phase 8 — the answer is what the page's script is told, and nothing else (0080's order count is retired).
    const said = r.json() as { news: boolean; what?: string; orders?: number };
    expect(said.orders, url).toBeUndefined();
    return { status: r.statusCode, said, headers: r.headers };
  };
  /** A buyer writes: the worker's own recorder, in the business's own transaction. */
  const buyerWrites = async (biz: string, conversationId: string, text: string) => {
    const { recordTypedMessage } = await import('../../src/pipeline/received.js');
    await as(biz, (x) => recordTypedMessage(x, conversationId, `wamid.live-${RUN}-${++seq}`, text));
  };
  const buyerSends = async (biz: string, conversationId: string, received: string) => {
    const { recordReceivedMessage } = await import('../../src/pipeline/received.js');
    await as(biz, (x) => recordReceivedMessage(x, conversationId, `wamid.live-${RUN}-${++seq}`, null, received));
  };
  const replyWaits = (biz: string, conversationId: string, text: string) => as(biz, (x) => sql<{ id: string }>`
    insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
    values (${biz}, ${conversationId}::uuid, 'quote', ${text}, null, 'pending') returning id::text as id`
    .execute(x).then((r) => r.rows[0]!.id));

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { hashCode } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    for (const [biz, name] of [[BIZ, 'Live Works'], [OTHER, 'Someone Else Ltd']] as const) {
      await as(biz, (x) => sql`insert into businesses (id, name, owner_locale) values (${biz}, ${name}, 'en')
                               on conflict (id) do nothing`.execute(x));
    }
    await as(BIZ, async (x) => {
      const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
      conv = (await ensureConversation(x, b.value, `ig-live-a-${RUN}`, 'Amira Haddad', 'instagram')).conversationId;
      second = (await ensureConversation(x, b.value, `ig-live-b-${RUN}`, 'Omar Saleh', 'instagram')).conversationId;
      await sql`update conversations set assigned_to = null where id in (${conv}::uuid, ${second}::uuid)`.execute(x);
      await sql`insert into people (business_id, name, code_hash)
                values (${BIZ}, 'Xiao Chen', ${hashCode(SECRET, STAFF_CODE)})`.execute(x);
    });
    await as(OTHER, async (x) => {
      const b = parseBusinessId(OTHER); if (!b.ok) throw new Error('fixture');
      theirs = (await ensureConversation(x, b.value, `ig-live-c-${RUN}`, 'Not Yours', 'instagram')).conversationId;
      await sql`update conversations set assigned_to = null where id = ${theirs}::uuid`.execute(x);
    });
    await buyerWrites(BIZ, conv, 'Hello, do you make vacuum cups?');
    await buyerWrites(OTHER, theirs, 'A message for someone else.');

    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: true,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = async (code: string) => String((await app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM,
    })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
    owner = await login(CODE);
    staff = await login(STAFF_CODE);
    expect(owner).not.toBe('');
    expect(staff).not.toBe('');
    expect(staff).not.toBe(owner);
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('a conversation page carries the one script, its own address and mark, and the door to its newest message', async () => {
    const r = await get(`/app/inbox/${conv}`);
    expect(r.statusCode).toBe(200);
    expect(r.body.match(/<script src="\/assets\/live\.[0-9a-f]{16}\.js" defer><\/script>/g)).toHaveLength(1);
    expect(askOf(r.body)).toMatch(new RegExp(`^/app/live/conversation/${conv}\\?since=1\\.0\\.[0-9a-f]{8}$`));
    expect(r.body).toContain(`<a class="deeper live-door" href="/app/inbox/${conv}#latest">New message from the customer${GO}</a>`);
    expect(r.body).toContain('<template data-live-news="message">');
    // …and the script it names is served, as JavaScript
    const src = /<script src="([^"]+)"/.exec(r.body)![1]!;
    const js = await get(src, '');
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
  });

  it('nothing new: the address says so — as JSON, never kept by a cache', async () => {
    const url = await pageAsk(`/app/inbox/${conv}`);
    const a = await ask(url);
    expect(a.status).toBe(200);
    expect(a.said).toEqual({ news: false });
    expect(String(a.headers['content-type'])).toMatch(/^application\/json/);
    expect(a.headers['cache-control']).toBe('no-store');
  });

  it('the buyer writes: the same address now says there is a new message — and a page drawn after it says nothing', async () => {
    const url = await pageAsk(`/app/inbox/${conv}`);
    await buyerWrites(BIZ, conv, 'And the price for 500?');
    expect((await ask(url)).said).toEqual({ news: true, what: 'message' });
    // it keeps saying so until the page is drawn again (the script asks once more, never)
    expect((await ask(url)).said).toEqual({ news: true, what: 'message' });
    const fresh = await pageAsk(`/app/inbox/${conv}`);
    expect(fresh).not.toBe(url);
    expect((await ask(fresh)).said).toEqual({ news: false });
  });

  it('a reaction the page does not show is not news; a file it names is', async () => {
    const url = await pageAsk(`/app/inbox/${conv}`);
    await buyerSends(BIZ, conv, 'reaction');
    expect((await ask(url)).said).toEqual({ news: false });
    await buyerSends(BIZ, conv, 'document');
    expect((await ask(url)).said).toEqual({ news: true, what: 'message' });
  });

  it('a reply waiting for review is news on the conversation — and another newer one is news again', async () => {
    const url = await pageAsk(`/app/inbox/${conv}`);
    const first = await replyWaits(BIZ, conv, 'We can do 500 pcs at 2.40 each.');
    expect((await ask(url)).said).toEqual({ news: true, what: 'reply' });
    const drawn = await pageAsk(`/app/inbox/${conv}`);
    expect(drawn).toMatch(new RegExp(`\\?since=3\\.${first}\\.[0-9a-f]{8}$`));
    expect((await ask(drawn)).said).toEqual({ news: false });
    await as(BIZ, (x) => sql`update drafts set created_at = now() - interval '1 minute' where id = ${first}::uuid`.execute(x));
    await replyWaits(BIZ, conv, 'A newer reply, for the newer question.');
    expect((await ask(drawn)).said).toEqual({ news: true, what: 'reply' });
  });

  it('the conversation changing hands is news on it — a colleague takes it; so is a send nobody can account for', async () => {
    const before = await pageAsk(`/app/inbox/${second}`);
    const took = await post(`/app/inbox/${second}/takeover`, staff);
    expect(took.statusCode).toBe(302);
    expect((await ask(before)).said).toEqual({ news: true, what: 'changed' });
    const now = await pageAsk(`/app/inbox/${second}`);
    expect((await ask(now)).said).toEqual({ news: false });
    await as(BIZ, (x) => sql`insert into outbound_messages (business_id, conversation_id, seq, body, status)
      values (${BIZ}, ${second}::uuid, 9001, 'did this arrive?', 'uncertain')`.execute(x));
    expect((await ask(now)).said).toEqual({ news: true, what: 'changed' });
    // her own page, drawn after, says nothing; and handing it back is hers, so she sees it by the redirect
    const after = await pageAsk(`/app/inbox/${second}`);
    expect((await ask(after)).said).toEqual({ news: false });
    await post(`/app/inbox/${second}/resume`, staff);
  });

  it('another business\'s messages, replies and hand-offs never count — on any of the three pages', async () => {
    const convUrl = await pageAsk(`/app/inbox/${second}`);
    const listUrl = await pageAsk('/app/inbox?filter=all');
    const todayUrl = await pageAsk('/app');
    await buyerWrites(OTHER, theirs, 'Another message for someone else.');
    await replyWaits(OTHER, theirs, 'Their reply, waiting for them.');
    await as(OTHER, (x) => sql`update conversations set assigned_to = 'unclaimed' where id = ${theirs}::uuid`.execute(x));
    for (const url of [convUrl, listUrl, todayUrl]) expect((await ask(url)).said, url).toEqual({ news: false });
  });

  it('another business\'s conversation is not found, and a mark no page could carry is refused', async () => {
    expect((await ask(`/app/live/conversation/${theirs}?since=0.0.d41d8cd9`)).status).toBe(404);
    expect((await ask(`/app/live/conversation/${randomUUID()}?since=0.0.d41d8cd9`)).status).toBe(404);
    expect((await ask('/app/live/conversation/not-a-conversation?since=0.0.d41d8cd9')).status).toBe(404);
    for (const bad of [`/app/live/conversation/${conv}`, `/app/live/conversation/${conv}?since=x`, `/app/live/conversation/${conv}?since=1.0`,
      '/app/live/buyers?since=1.0', '/app/live/today?since=1.2.3']) {
      const a = await ask(bad);
      expect(a.status, bad).toBe(400);
      expect(a.said, bad).toEqual({ news: false });
    }
  });

  it('signed out: the script is told so and stops; a person is sent to sign in', async () => {
    const url = await pageAsk(`/app/inbox/${conv}`);
    for (const u of [url, '/app/live/buyers?since=1.0123456789abcdef', '/app/live/today?since=0.0.0.0.0.0']) {
      const machine = await get(u, '', JSON_ACCEPT);
      expect(machine.statusCode, u).toBe(401);
      expect(machine.json(), u).toEqual({ news: false });
      const person = await get(u, '');
      expect(person.statusCode, u).toBe(302);
      expect(person.headers['location'], u).toBe('/login');
      // a cookie nobody signed is no session either
      expect((await get(u, 'yf_session=forged.value', JSON_ACCEPT)).statusCode, u).toBe(401);
    }
  });

  it('Buyers: its address says nothing, then says the list changed when a buyer writes or a conversation is taken', async () => {
    const r = await get('/app/inbox?filter=all');
    const url = askOf(r.body);
    expect(url).toMatch(/^\/app\/live\/buyers\?since=2\.[0-9a-f]{16}$/);
    // the door is the first page of the list she is on — phase 4: the whole list is its own address
    expect(r.body).toContain('<a class="deeper live-door" href="/app/inbox">');
    expect((await ask(url)).said).toEqual({ news: false });
    await buyerWrites(BIZ, second, 'Does the 1L bottle come in amber?');
    expect((await ask(url)).said).toEqual({ news: true, what: 'list' });
    const again = await pageAsk('/app/inbox?filter=all');
    expect((await ask(again)).said).toEqual({ news: false });
    const took = await post(`/app/inbox/${second}/takeover`);
    expect(took.statusCode).toBe(302);
    expect((await ask(again)).said).toEqual({ news: true, what: 'list' });
    // a search keeps its words in the door: the first page of the same search
    const searched = await get('/app/inbox?q=Omar');
    expect(searched.body).toContain('<a class="deeper live-door" href="/app/inbox?q=Omar">');
  });

  it('Today: its address says nothing, then says the counts changed when a reply starts waiting', async () => {
    const r = await get('/app');
    const url = askOf(r.body);
    // Six counts: 0080 added the orders waiting for the owner's tap.
    expect(url).toMatch(/^\/app\/live\/today\?since=[0-9]+(\.[0-9]+){5}$/);
    expect(r.body).toContain('<a class="deeper live-door" href="/app">');
    expect((await ask(url)).said).toEqual({ news: false });
    await replyWaits(BIZ, second, 'A reply for Omar.');
    expect((await ask(url)).said).toEqual({ news: true, what: 'today' });
    expect((await ask(await pageAsk('/app'))).said).toEqual({ news: false });
  });

  it('staff are told exactly what the owner is told', async () => {
    const mine = await pageAsk(`/app/inbox/${conv}`, owner);
    const theirsToo = await pageAsk(`/app/inbox/${conv}`, staff);
    expect(theirsToo).toBe(mine);
    await buyerWrites(BIZ, conv, 'Staff should hear of this too.');
    expect((await ask(theirsToo, staff)).said).toEqual({ news: true, what: 'message' });
    expect((await ask(mine, owner)).said).toEqual({ news: true, what: 'message' });
  });

  it('a stopped assistant changes nothing about it: a buyer who writes is still news', async () => {
    const stopped = await post('/app/business/stop-assistant');
    expect(stopped.statusCode).toBe(302);
    try {
      const url = await pageAsk(`/app/inbox/${conv}`);
      await buyerWrites(BIZ, conv, 'Are you there?');
      expect((await ask(url)).said).toEqual({ news: true, what: 'message' });
    } finally {
      await post('/app/business/start-assistant');
    }
  });

  it('the emergency silence changes nothing about it either', async () => {
    // The ops switch, set and cleared the way ops does it — as the table owner
    // (the app role may only read `ops_flags`).
    const pg = (await import('pg')).default;
    const ops = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] });
    await ops.connect();
    try {
      await ops.query(`insert into ops_flags (business_id, flag, reason, set_by) values ($1, 'global_silence', 'CC-26 test', 'test')`, [BIZ]);
      const url = await pageAsk(`/app/inbox/${conv}`);
      await buyerWrites(BIZ, conv, 'Hello? Anyone there?');
      expect((await ask(url)).said).toEqual({ news: true, what: 'message' });
    } finally {
      await ops.query(`update ops_flags set cleared_at = now() where business_id = $1 and flag = 'global_silence' and cleared_at is null`, [BIZ]);
      await ops.end();
    }
  });

  it('the buyer\'s own page watches nothing: it is a record, and the conversation is one door away', async () => {
    const r = await get(`/app/conversations/${conv}`);
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain('data-live=');
    expect(r.body.match(/<script src="\/assets\/live\.[0-9a-f]{16}\.js" defer><\/script>/g)).toHaveLength(1);
  });

  it('phase 8 · the rail: every page asks it from the count it shows; only a rise names who and why', async () => {
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { WAITING_HUMAN_AGENT } = await import('../../src/core/conversation/ownership.js');
    type Rail = { n: number; mark: string; shown: string; label: string; toast?: { say: string; door: string } };
    // Every page in the workspace — here one that watches nothing — draws the slot, with the rail's own count.
    const page = await get('/app/settings');
    // (w4-whole-03) the mark is the count and the moment the latest of those waiting began to: `<n>.<epoch s>`.
    const since = /data-rail="\/app\/live\/rail\?since=([0-9.]+)"/.exec(page.body)?.[1];
    expect(since, 'the page draws the rail slot').toBeDefined();
    const shownN = Number(since!.split('.')[0]);
    const ask = async (mark: string, cookie = owner) => get(`/app/live/rail?since=${mark}`, cookie, JSON_ACCEPT);
    const same = await ask(since!);
    expect(same.statusCode).toBe(200);
    expect(same.headers['cache-control']).toBe('no-store');
    expect(same.json()).toMatchObject({ n: shownN, mark: since });
    // The moments compared are whole seconds: the hand-over below begins after the page's.
    await new Promise((r) => setTimeout(r, 1100));
    expect((same.json() as Rail).toast).toBeUndefined();

    // A customer is handed over: one more needs the owner, and the answer says who and why.
    const nadia = await as(BIZ, async (x) => {
      const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
      const id = (await ensureConversation(x, b.value, `ig-live-d-${RUN}`, 'Nadia Karim', 'instagram')).conversationId;
      await sql`update conversations set assigned_to = ${WAITING_HUMAN_AGENT}, assigned_at = now() where id = ${id}::uuid`.execute(x);
      return id;
    });
    const rose = (await ask(since!)).json() as Rail;
    expect(rose.n).toBe(shownN + 1);
    expect(rose.toast).toEqual({ say: 'Nadia Karim is waiting for you', door: `/app/inbox/${nadia}#latest` });
    // The count is the rail's own: a page drawn now carries it.
    expect((await get('/app/settings')).body).toContain(`data-rail="/app/live/rail?since=${rose.n}.`);
    // Asked from the new mark, nothing is news; another business's customers never count.
    expect(((await ask(rose.mark)).json() as Rail).toast).toBeUndefined();
    await as(OTHER, (x) => sql`update conversations set assigned_to = ${WAITING_HUMAN_AGENT} where id = ${theirs}::uuid`.execute(x));
    expect(((await ask(rose.mark)).json() as Rail).n).toBe(rose.n);
    // A mark no page could carry is refused; signed out, the script is told so.
    expect((await ask('x')).statusCode).toBe(400);
    expect((await get('/app/live/rail?since=0', '', JSON_ACCEPT)).statusCode).toBe(401);
    await as(BIZ, (x) => sql`update conversations set assigned_to = null where id = ${nadia}::uuid`.execute(x));
    await as(OTHER, (x) => sql`update conversations set assigned_to = null where id = ${theirs}::uuid`.execute(x));
  });
});
