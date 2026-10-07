import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import pg from 'pg';
import type { AdvisorModel } from '../../src/llm/ports.js';
import type { Db } from '../../src/db/client.js';
import { t } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import { DEFAULT_PROCESSOR, processorLabel } from '../../src/core/legal/processors.js';

/**
 * 0130, PR 2 — THE ADVISOR'S MEMORY, through the page (docs/ADVISOR-MEMORY.md; the owner's decisions D1–D9 of
 * 2026-10-07). The real app, the real database, a real owner and a real member of staff, a scripted model:
 *
 *   · nothing is kept until the owner allows it for the workspace (D1) AND the person says yes; the card asks
 *     after an answer, once more 90 days after "Not now", and never after a second (D6);
 *   · a follow-up sees at most the last three turns of its own conversation, as (question, entry, params) —
 *     never an answer or a figure; a referent older than that, or in another conversation, gets the fixed
 *     "which customer" sentence; a figure the model repeats from earlier is thrown away, and a record that
 *     changed shows its new value — history is never a source of facts;
 *   · a conversation ends after four hours of quiet, or on "New conversation" (D3);
 *   · a person's history is theirs: the owner opens none of a team member's conversations (D2) and can only
 *     delete it all, unread; each person's download holds their own rows and no one else's (D4);
 *   · taking it back deletes at once, with the ledger line;
 *   · a question appears in no log line, at any level, and in no error report;
 *   · the key missing: the advisor answers and nothing is kept; the wrong key: "could not be opened" (D8).
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = randomUUID();
const CODE = `memory-page-${RUN}`;
const STAFF_CODE = `STAFF-${RUN.toUpperCase()}`;
const SECRET = 'a-memory-page-session-secret-of-sufficient-length';
const KEY = 'ab'.repeat(32);
const OTHER_KEY = 'cd'.repeat(32);
const AMIRA = `Amira ${RUN}`;
const MARKER = `QMARK${RUN}`;
const STAFF_MARK = `STAFFQ${RUN}`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
/** A sentence as the page prints it (escaped). */
const en = (k: Parameters<typeof t>[1], p: Record<string, string> = {}) => esc(t('en', k, p));
/** The provider the card names: this test app is given none, so the default the privacy page names. */
const PROCESSOR = processorLabel(DEFAULT_PROCESSOR, 'en');

d('0130 · the advisor\'s memory, through the page (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: Db;
  let admin: pg.Client;
  let app: import('fastify').FastifyInstance;
  let noKey: import('fastify').FastifyInstance;
  let wrongKey: import('fastify').FastifyInstance;
  const logs: string[] = [];
  const reported: string[] = [];
  let owner = ''; let staff = ''; let OWNER = ''; let STAFF = ''; let amiraId = '';

  /** What the scripted model was asked to route, every time. */
  const routed: { question: string; earlier?: unknown }[] = [];
  /** The phrasing: the facts as they are, unless a test says otherwise. */
  let phraseWith: ((facts: readonly string[]) => string) | null = null;
  let recogniseThrows = false;
  const model: AdvisorModel = {
    recognise: async (input) => {
      routed.push(JSON.parse(JSON.stringify(input)) as { question: string; earlier?: unknown });
      if (recogniseThrows) throw new Error(`the provider echoed: ${input.question}`);
      const q = input.question.toLowerCase();
      if (q.includes('about amira')) return { id: 'A3', period: null, customer: AMIRA, product: null, reference: null };
      if (q.includes('about her')) {
        // Resolves "her" only from what it is given: the earlier turns of this conversation.
        const named = [...(input.earlier ?? [])].reverse().map((e) => e.params['customer']).find((c) => typeof c === 'string') ?? null;
        return { id: 'A3', period: null, customer: named as string | null, product: null, reference: null };
      }
      return { id: 'A1', period: null, customer: null, product: null, reference: null };
    },
    phrase: async ({ facts }) => (phraseWith ? phraseWith(facts) : facts.join(' ')),
  };

  const build = async (key: string | null, withLogs: boolean) => {
    const { createDb, createReadOnlyDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { advisorMemory } = await import('../../src/advisor/memory.js');
    const { advisorKeysFrom } = await import('../../src/advisor/seal.js');
    db ??= createDb(DATABASE_URL!);
    const sink = new Writable({ write(chunk, _e, done) { logs.push(String(chunk)); done(); } });
    const a = Fastify({ logger: withLogs ? { level: 'trace', stream: sink } : false });
    registerWebApp(a, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
      advisorDb: createReadOnlyDb(DATABASE_URL!), advisorModel: model,
      advisorMemory: advisorMemory(db, advisorKeysFrom(key ? { ADVISOR_KEY: key } : {})),
      advisorProvider: { name: 'DeepSeek', model: 'scripted' },
      reportError: async (err: unknown, where: string, ctx: unknown) => { reported.push(JSON.stringify({ err: String(err), where, ctx })); },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await a.ready();
    return a;
  };
  const login = async (a: typeof app, code: string): Promise<string> => {
    const r = await a.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM });
    return String(r.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  };
  const get = (cookie: string, url: string, a = app) => a.inject({ method: 'GET', url, headers: { cookie } });
  const post = (cookie: string, url: string, form: Record<string, string> = {}, a = app) =>
    a.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(form).toString() });
  const ask = (cookie: string, q: string, thread?: string, a = app) => post(cookie, '/app/advisor', { q, ...(thread ? { thread } : {}) }, a);
  const n = async (q: string, p: unknown[] = []) => Number((await admin.query(q, p)).rows[0].n);
  const threadsOf = (person: string) => n('select count(*) as n from advisor_threads where person_id = $1', [person]);
  const threadIn = (body: string) => /name="thread" value="([0-9a-f-]{36})"/.exec(body)?.[1] ?? null;
  const latest = (body: string) => body.slice(body.indexOf('id="latest"'), body.indexOf('id="latest"') + 2500);
  const customer = async (name: string) => {
    const id = (await admin.query(`insert into clients (business_id, display_name, phone) values ($1, $2, $3) returning id::text as id`,
      [BIZ, name, `+3361${Math.floor(Math.random() * 1e7)}`])).rows[0].id as string;
    const conv = (await admin.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp') returning id::text as id`, [BIZ, id])).rows[0].id;
    await admin.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'inbound', 'Hello', now() - interval '1 day')`, [conv]);
    return id;
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL }); await admin.connect();
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [BIZ, `Memory Page ${RUN}`]);
    amiraId = await customer(AMIRA);
    await customer(`Bao ${RUN}`);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = await build(KEY, true);
    noKey = await build(null, false);
    wrongKey = await build(OTHER_KEY, false);
    owner = await login(app, CODE);
    expect(owner).not.toBe('');
    OWNER = (await admin.query(`select id::text as id from people where business_id = $1 and is_owner and archived_at is null`, [BIZ])).rows[0]?.id;
    expect(OWNER).toMatch(/^[0-9a-f-]{36}$/);
    const { hashCode } = await import('../../src/api/web/people.js');
    STAFF = (await admin.query(`insert into people (business_id, name, is_owner, code_hash) values ($1, 'Xiao Chen', false, $2) returning id::text as id`,
      [BIZ, hashCode(SECRET, STAFF_CODE)])).rows[0].id;
    staff = await login(app, STAFF_CODE);
    expect(staff).not.toBe('');
  }, 90_000);
  afterAll(async () => { await app?.close(); await noKey?.close(); await wrongKey?.close(); await db?.destroy(); await admin?.end(); });

  it('D1 · nothing is kept, and nothing is asked, until the owner allows it for the workspace', async () => {
    const r = await ask(owner, 'How many customers do I have?');
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(en('advisor.memory.ask'));
    expect(await threadsOf(OWNER)).toBe(0);
    // staff cannot switch the workspace on: the page refuses, and the database would too (NE022)
    await post(staff, '/app/settings/advisor-history/workspace', { on: 'on' });
    expect((await admin.query('select advisor_history_at from businesses where id = $1', [BIZ])).rows[0].advisor_history_at).toBeNull();
    const on = await post(owner, '/app/settings/advisor-history/workspace', { on: 'on' });
    expect(on.statusCode).toBe(302);
    expect((await admin.query('select advisor_history_at from businesses where id = $1', [BIZ])).rows[0].advisor_history_at).not.toBeNull();
  });

  it('D6 · the card asks after an answer; "Not now" is asked once more 90 days later; a second "Not now" ends the asking', async () => {
    const first = await ask(owner, 'How many customers do I have?');
    expect(first.body).toContain(en('advisor.memory.ask'));
    expect(first.body).toContain(en('advisor.memory.what', { processor: PROCESSOR }));
    expect(await threadsOf(OWNER)).toBe(0);                                  // asking is not keeping
    await post(owner, '/app/advisor/consent', { choice: 'notnow' });
    expect((await ask(owner, 'How many customers do I have?')).body).not.toContain(en('advisor.memory.ask'));
    await admin.query(`update advisor_consents set at = now() - interval '91 days' where person_id = $1`, [OWNER]);
    expect((await ask(owner, 'How many customers do I have?')).body).toContain(en('advisor.memory.ask'));
    await post(owner, '/app/advisor/consent', { choice: 'notnow' });
    await admin.query(`update advisor_consents set at = now() - interval '400 days' where person_id = $1`, [OWNER]);
    expect((await ask(owner, 'How many customers do I have?')).body).not.toContain(en('advisor.memory.ask'));
    expect(await threadsOf(OWNER)).toBe(0);
    // Settings is then the only way in
    const s = await get(owner, '/app/settings/advisor-history');
    expect(s.body).toContain(en('advisor.memory.ask'));
    expect((await post(owner, '/app/settings/advisor-history/me', { on: 'on' })).statusCode).toBe(302);
  });

  it('kept from the yes on: sealed, in a conversation that goes on; the page shows it', async () => {
    const r = await ask(owner, `How many customers do I have? ${MARKER}`);
    expect(await threadsOf(OWNER)).toBe(1);
    const row = (await admin.query('select question_ciphertext, answer_ciphertext from advisor_turns where person_id = $1', [OWNER])).rows[0];
    expect(row.question_ciphertext).not.toContain('customers');                // ciphertext, never the words
    expect(r.body).toContain(MARKER);                                          // the conversation, on the page
    expect(threadIn(r.body)).toMatch(/^[0-9a-f-]{36}$/);
    const again = await get(owner, '/app/advisor');
    expect(again.body).toContain(MARKER);                                      // D3: it goes on
  });

  it('a follow-up is given the last three turns of its conversation — the question, the entry and what it named; never an answer', async () => {
    const page = await get(owner, '/app/advisor');
    const thread = threadIn(page.body)!;
    const told = await ask(owner, 'Tell me about Amira', thread);
    expect(told.body).toContain(AMIRA);
    // the turn is linked to the customer it named, so her erasure finds it
    expect(await n('select count(*) as n from advisor_turn_subjects where client_id = $1', [amiraId])).toBe(1);
    routed.length = 0;
    const her = await ask(owner, 'And what about her?', thread);
    const input = routed[0]!;
    expect(input.earlier).toHaveLength(2);
    expect(JSON.stringify(input.earlier)).toContain(AMIRA);                    // what it named
    // never an answer or a fact line: none of what the advisor said is in what the model was given
    const said = told.body.slice(told.body.lastIndexOf('class="bubble adv"'));
    // every line of the answer, whole (a bare name is what it named, and may be there: that is a param)
    const words = [...said.matchAll(/<bdi>([^<]{6,})<\/bdi>/g)].map((m) => m[1]!).filter((w) => w.trim() !== AMIRA);
    expect(words.length).toBeGreaterThan(0);
    for (const w of words) expect(JSON.stringify(input), w).not.toContain(w);
    expect(Object.keys((input.earlier as Record<string, unknown>[])[0]!).sort()).toEqual(['entry', 'params', 'question']);
    expect(latest(her.body)).toContain(AMIRA);
  });

  it('a referent older than the last three turns, or in another conversation, gets the fixed "which customer" sentence', async () => {
    const thread = threadIn((await get(owner, '/app/advisor')).body)!;
    for (let i = 0; i < 3; i++) await ask(owner, `How many customers now (${i})?`, thread);
    const old = await ask(owner, 'And what about her?', thread);
    expect(latest(old.body)).toContain(en('advisor.none.whichCustomer'));
    // "New conversation": nothing of the last one goes with it
    const fresh = await get(owner, '/app/advisor?new=1');
    expect(threadIn(fresh.body)).toBeNull();
    routed.length = 0;
    const other = await ask(owner, 'And what about her?');
    expect(routed[0]!.earlier).toBeUndefined();
    expect(latest(other.body)).toContain(en('advisor.none.whichCustomer'));
    expect(await threadsOf(OWNER)).toBe(2);
  });

  it('history is never a source of facts: a record that changed shows its new value, and a figure repeated from before is thrown away', async () => {
    await get(owner, '/app/advisor?new=1');
    const before = await ask(owner, 'How many customers do I have?');
    const thread = threadIn(before.body)!;
    const earlierSentence = /<p><bdi>([^<]+)<\/bdi><\/p>/.exec(latest(before.body))![1]!;
    await customer(`Chen ${RUN}`);
    phraseWith = () => earlierSentence;                                        // the model "remembers" the old answer
    try {
      const after = await ask(owner, 'And how many now?', thread);
      const last = latest(after.body);
      expect(last).not.toContain(earlierSentence);
      expect(last).toContain(en('advisor.fallback.head'));                     // the check threw it away; the facts are shown
      expect(last).not.toBe(latest(before.body));
    } finally { phraseWith = null; }
  });

  it('D3 · four hours of quiet end a conversation: the next question begins a new one', async () => {
    expect(threadIn((await get(owner, '/app/advisor')).body)).not.toBeNull();
    await admin.query(`update advisor_threads set last_turn_at = now() - interval '5 hours' where person_id = $1`, [OWNER]);
    const page = await get(owner, '/app/advisor');
    expect(threadIn(page.body)).toBeNull();
    expect(page.body).toContain(en('advisor.thread.earlier'));
    const before = await threadsOf(OWNER);
    await ask(owner, 'How many customers do I have?');
    expect(await threadsOf(OWNER)).toBe(before + 1);
  });

  it('D2 · the owner opens none of a team member\'s conversations, and sees nothing of them anywhere', async () => {
    await post(staff, '/app/settings/advisor-history/me', { on: 'on' });
    const mine = await ask(staff, `How many customers do I have? ${STAFF_MARK}`);
    const staffThread = threadIn(mine.body)!;
    expect(await threadsOf(STAFF)).toBe(1);
    expect((await get(owner, `/app/advisor/c/${staffThread}`)).statusCode).toBe(404);
    for (const url of ['/app/advisor', '/app/settings/advisor-history', '/app/settings/data']) {
      expect((await get(owner, url)).body, url).not.toContain(STAFF_MARK);
    }
    // and the staff member opens their own
    expect((await get(staff, `/app/advisor/c/${staffThread}`)).body).toContain(STAFF_MARK);
  });

  it('D4 · each download holds that person\'s own rows and no one else\'s — the owner\'s included', async () => {
    const ownerCsv = await get(owner, '/app/settings/advisor-history/history.csv');
    expect(ownerCsv.statusCode).toBe(200);
    expect(ownerCsv.headers['content-type']).toContain('text/csv');
    expect(ownerCsv.body).toContain(MARKER);
    expect(ownerCsv.body).not.toContain(STAFF_MARK);
    const staffCsv = await get(staff, '/app/settings/advisor-history/history.csv');
    expect(staffCsv.body).toContain(STAFF_MARK);
    expect(staffCsv.body).not.toContain(MARKER);
    // the business's own nine files carry no advisor words at all
    for (const f of ['buyers', 'messages', 'products', 'orders', 'quotes', 'contacts', 'price-rules', 'selling-terms', 'teaching']) {
      const r = await get(owner, `/app/settings/data/${f}.csv`);
      expect(r.body, f).not.toContain(STAFF_MARK);
      expect(r.body, f).not.toContain(MARKER);
    }
  });

  it('D2 · the owner deletes a team member\'s history whole, unread; the notice reads the same whether anything was kept or not', async () => {
    const del = await post(owner, `/app/settings/advisor-history/team/${STAFF}/delete`, { go: '1' });
    expect(del.statusCode).toBe(302);
    expect(await threadsOf(STAFF)).toBe(0);
    expect(await n(`select count(*) as n from erasure_ledger where kind = 'advisor' and person_id = $1 and via = 'owner'`, [STAFF])).toBe(1);
    const notice = String(del.headers['set-cookie'] ?? '');
    const again = await post(owner, `/app/settings/advisor-history/team/${STAFF}/delete`, { go: '1' });
    expect(again.statusCode).toBe(302);
    expect(String(again.headers['set-cookie'] ?? '').replace(/yf_flash=[^;]+/, 'x')).toBe(notice.replace(/yf_flash=[^;]+/, 'x'));
    // staff cannot do it to anyone
    await post(staff, `/app/settings/advisor-history/team/${OWNER}/delete`, { go: '1' });
    expect(await threadsOf(OWNER)).toBeGreaterThan(0);
  });

  it('a question appears in no log line, at any level, and in no error report — even when the provider echoes it in an error', async () => {
    recogniseThrows = true;
    try {
      const r = await ask(owner, `Who has gone quiet? ${MARKER}`);
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain(en('advisor.failed'));
    } finally { recogniseThrows = false; }
    const all = logs.join('');
    expect(all.length).toBeGreaterThan(0);                                     // the logger was listening (the control)
    expect(all).not.toContain(MARKER);
    expect(all).not.toContain(STAFF_MARK);
    expect(reported.join('')).not.toContain(MARKER);
    expect(await n(`select count(*) as n from app_errors a where a::text like $1`, [`%${MARKER}%`])).toBe(0);
  });

  it('D8 · the wrong key: a kept conversation says it could not be opened, and nothing breaks', async () => {
    const thread = (await admin.query('select id::text as id from advisor_threads where person_id = $1 limit 1', [OWNER])).rows[0].id;
    const r = await get(owner, `/app/advisor/c/${thread}`, wrongKey);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(en('advisor.thread.unreadable'));
    expect(r.body).not.toContain(MARKER);
  });

  it('D8 · no key: the advisor answers as ever, nothing new is kept, and the card never asks', async () => {
    const before = await n('select count(*) as n from advisor_turns where person_id = $1', [OWNER]);
    const r = await ask(owner, 'How many customers do I have?', undefined, noKey);
    expect(r.statusCode).toBe(200);
    expect(latest(r.body)).not.toContain(en('advisor.failed'));
    expect(r.body).not.toContain(en('advisor.memory.ask'));
    expect(await n('select count(*) as n from advisor_turns where person_id = $1', [OWNER])).toBe(before);
    expect((await get(owner, '/app/settings/advisor-history', noKey)).body).toContain(en('advisor.history.keyMissing'));
  });

  it('taking it back deletes at once, with its ledger line; nothing is kept after', async () => {
    expect(await threadsOf(OWNER)).toBeGreaterThan(0);
    const off = await post(owner, '/app/settings/advisor-history/me', { on: 'off' });
    expect(off.statusCode).toBe(302);
    expect(await threadsOf(OWNER)).toBe(0);
    expect(await n(`select count(*) as n from erasure_ledger where kind = 'advisor' and person_id = $1 and via = 'person'`, [OWNER])).toBeGreaterThan(0);
    await ask(owner, 'How many customers do I have?');
    expect(await threadsOf(OWNER)).toBe(0);
  });

  it('the owner switching the workspace off deletes everyone\'s, then keeps nothing', async () => {
    await post(staff, '/app/settings/advisor-history/me', { on: 'on' });
    await ask(staff, 'How many customers do I have?');
    expect(await threadsOf(STAFF)).toBe(1);
    await post(owner, '/app/settings/advisor-history/workspace', { on: 'off' });
    expect(await threadsOf(STAFF)).toBe(0);
    await ask(staff, 'How many customers do I have?');
    expect(await threadsOf(STAFF)).toBe(0);
  });
});
