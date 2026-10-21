import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import pg from 'pg';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { flashSaid } from './tenant.js';

/**
 * S5 (Phase 5, item 17) — the done-criterion (PHASE-5.md §4): "Suggestions come only from human replies. A dismissed
 * one never returns (a test re-asks it). Nothing becomes an answer without the owner." Over Postgres and the real
 * routes: replies of every kind laid in the tables as the send path leaves them — a person's typed reply, one from the
 * channel's own app, a draft a person rewrote; and the assistant's own words, sent alone or approved as written, the
 * reopening template, a test conversation — and the knowledge page offers only the people's. Dismissed, a question is
 * asked again by another buyer and answered again by a person, and is not offered. Taught, it is the owner's words.
 * Staff see, never decide; the accountant sees nothing, past the route too (DZ, in this block).
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `55550000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('S5 · answers people gave (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: Db;
  let admin: pg.Client;
  let app: import('fastify').FastifyInstance;
  let owner = '';
  let staff = '';
  let accountant = '';
  let accountantId = '';
  let seq = 0;
  let buyers = 0;
  const base = Date.now() - 3 * 86_400_000;
  const at = (min: number) => new Date(base + min * 60_000);

  const tx = async <R>(fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, BIZ as never, fn);
  };
  const post = (url: string, fields: Record<string, string> = {}, who = owner) =>
    app.inject({ method: 'POST', url, headers: { cookie: who, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const page = async (who = owner) => {
    const html = (await app.inject({ method: 'GET', url: '/app/knowledge', headers: { cookie: who } })).body;
    return /<div class="block" id="answers-given">[\s\S]*?(?=<div class="block"><h2>)/.exec(html)?.[0] ?? '';
  };
  const buyer = async (testing = false) => {
    const { ensureConversation } = await import('../../src/db/channels.js');
    const n = ++buyers;
    const c = await tx((x) => ensureConversation(x, BIZ as never, `wa-${n}-${RUN}`, `Buyer ${n} ${RUN}`, 'whatsapp'));
    if (testing) await admin.query(`update conversations set owner_testing = true where id = $1`, [c.conversationId]);
    return c.conversationId;
  };
  /** A buyer's message, then a reply — as the send path leaves it in the tables. */
  const asked = async (conv: string, question: string, answer: string, how: 'person' | 'echo' | 'assistant' | 'approved', min: number) => {
    await admin.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'inbound', $2, $3)`, [conv, question, at(min)]);
    if (how === 'echo') {
      await admin.query(`insert into messages (conversation_id, direction, text_content, external_id, sent_at, ai_analysis)
        values ($1, 'outbound', $2, $3, $4, '{"by":"owner_elsewhere"}')`, [conv, answer, `echo:${RUN}-${++seq}`, at(min + 1)]);
      return;
    }
    const o = await admin.query(`insert into outbound_messages (business_id, conversation_id, seq, body, status, origin, approved, sent_at)
      values ($1, $2, $3, $4, 'sent', $5, $6, $7) returning id::text as id`,
      [BIZ, conv, ++seq, answer, how === 'person' ? 'owner' : 'employee', how === 'approved', at(min + 1)]);
    await admin.query(`insert into messages (conversation_id, direction, text_content, external_id, sent_at) values ($1, 'outbound', $2, $3, $4)`,
      [conv, answer, `out:${o.rows[0].id}`, at(min + 1)]);
  };
  /** A turn's draft, decided: rewritten by a person ('edited'), or sent as the assistant wrote it ('approved'). */
  const drafted = async (conv: string, question: string, draft: string, sent: string, status: 'edited' | 'approved', min: number) => {
    const mid = `m-${RUN}-${++seq}`;
    await admin.query(`insert into turns (message_id, business_id, conversation_id, state_before, input, decision, engine_version)
      values ($1, $2, $3, '{}', $4, '{}', 'test')`, [mid, BIZ, conv, JSON.stringify({ text: question })]);
    await admin.query(`insert into drafts (business_id, conversation_id, turn_message_id, capability, draft_text, status, sent_text, decided_at)
      values ($1, $2, $3, 'quote', $4, $5, $6, $7)`, [BIZ, conv, mid, draft, status, sent, at(min)]);
  };
  const count = (table: string) => tx((x) => sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)}`.execute(x).then((q) => q.rows[0]!.n));

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    const { renderReopen, reopenParam } = await import('../../src/core/channel/reopen.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, 'Answers', 'en')`, [BIZ]);
    app = Fastify({ logger: false });
    const code = `answers-${RUN}`;
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = async (c: string) => String((await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(c)}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    owner = await login(code);
    const st = await addPerson(db, BIZ, SECRET, `Staff ${RUN}`, 'team');
    const ac = await addPerson(db, BIZ, SECRET, `Accountant ${RUN}`, 'accountant');
    if (st.code !== 'added' || ac.code !== 'added') throw new Error('fixture');
    staff = await login(st.accessCode);
    accountant = await login(ac.accessCode);
    accountantId = (await admin.query(`select id::text as id from people where business_id = $1 and kind = 'accountant'`, [BIZ])).rows[0].id;

    // People's words: two buyers ask the same thing, a person answers each; one more from the channel's own app;
    // a draft a person rewrote.
    await asked(await buyer(), 'Do you ship to Dubai?', 'Yes, by sea in about 25 days.', 'person', 10);
    await asked(await buyer(), 'dubai — do you SHIP there??', 'Yes, by sea, 25 days door to door.', 'person', 20);
    await asked(await buyer(), 'Can I pay by bank transfer?', 'Bank transfer is fine: 30% deposit.', 'echo', 30);
    await drafted(await buyer(), 'Can you print our logo on the bags?', 'We can discuss printing.', 'Yes — screen printing from 100 pieces.', 'edited', 40);
    // The assistant's words, never offered: sent alone, approved as written (both ways it is recorded).
    await asked(await buyer(), 'What is the MOQ for tote bags?', 'The MOQ is 500 pieces.', 'assistant', 50);
    await asked(await buyer(), 'Do you have the canvas in navy?', 'Navy is in stock.', 'approved', 60);
    await drafted(await buyer(), 'Is the cotton organic certified?', 'It is GOTS certified.', 'It is GOTS certified.', 'approved', 70);
    // A person's reply that is no answer of theirs: the reopening template went in their place.
    await asked(await buyer(), 'Are samples free of charge?', renderReopen('en', reopenParam('Answers')), 'person', 80);
    // A conversation the owner marked as their own test.
    await asked(await buyer(true), 'Do you offer gift wrapping?', 'Yes, for 1 dollar a piece.', 'person', 90);
    // Never a suggestion, whoever answers: a request for a person, a deletion request, an answer promising deletion.
    await asked(await buyer(), 'Can I talk to someone about pricing?', 'Hi, this is Amal from sales.', 'person', 100);
    await asked(await buyer(), 'Please delete my data from your records.', 'Of course.', 'person', 110);
    await asked(await buyer(), 'Old phone number in my profile, can you fix it?', 'Done, I deleted your data.', 'person', 120);
  }, 60_000);
  afterAll(async () => {
    await app?.close(); await db?.destroy();
    await admin?.query(`delete from businesses where id = $1`, [BIZ]).catch(() => {});
    await admin?.end();
  });

  it('ONLY PEOPLE\'S WORDS: a reply a person typed, one from the channel\'s own app, a draft a person rewrote — the same question once, with how many asked', async () => {
    const html = await page();
    expect(html).toContain('Asked 2 times');
    // the newest wording and the newest answer
    expect(html).toContain('dubai — do you SHIP there??');
    expect(html).toContain('Yes, by sea, 25 days door to door.');
    expect(html).not.toContain('about 25 days');
    expect(html).toContain('Can I pay by bank transfer?');
    expect(html).toContain('Yes — screen printing from 100 pieces.');
    expect(html).not.toContain('We can discuss printing.');
    for (const never of ['MOQ', 'navy', 'organic', 'samples', 'gift wrapping', 'talk to someone', 'delete my data', 'Old phone number']) {
      expect(html, never).not.toContain(never);
    }
    expect([...html.matchAll(/<div class="gap">/g)].length).toBe(3);
  });

  it('NOTHING BECOMES AN ANSWER WITHOUT THE OWNER: offered is not taught; staff see it and are refused, and nothing is written', async () => {
    expect(await count('product_knowledge')).toBe(0);
    const seen = await page(staff);
    expect(seen).toContain('Can I pay by bank transfer?');
    expect(seen).toContain('The owner decides this.');
    expect(seen).not.toContain('<form');
    const r = await post('/app/knowledge/answers/teach', { question: 'Can I pay by bank transfer?', label: 'Payment', content: 'Bank transfer.' }, staff);
    expect(flashSaid(r, SECRET)).toBe('Only the owner can do that.');
    expect(String(r.headers['location'])).toBe('/app/knowledge#answers-given');
    await post('/app/knowledge/answers/dismiss', { question: 'Can I pay by bank transfer?' }, staff);
    expect(await count('product_knowledge')).toBe(0);
    expect(await count('answer_decisions')).toBe(0);
  });

  it('A DISMISSED ONE NEVER RETURNS: set aside, then asked again by another buyer in other capitals and order, and answered again by a person', async () => {
    const r = await post('/app/knowledge/answers/dismiss', { question: 'dubai — do you SHIP there??' });
    expect(flashSaid(r, SECRET)).toBe('Set aside. That question is not offered again.');
    expect(await page()).not.toMatch(/dubai/i);
    await asked(await buyer(), 'Ship to DUBAI, do you?', 'Yes, by sea.', 'person', 200);
    await drafted(await buyer(), 'do you ship to dubai', 'Maybe.', 'Yes, we ship to Dubai.', 'edited', 210);
    expect(await page()).not.toMatch(/dubai/i);
    expect(flashSaid(await post('/app/knowledge/answers/dismiss', { question: 'Do you ship to Dubai?' }), SECRET)).toBe('That question was already decided.');
    // the decision holds the question's digest, never its words
    const row = await tx((x) => sql<{ h: string; decision: string }>`select question_hash as h, decision from answer_decisions`.execute(x).then((q) => q.rows));
    expect(row).toHaveLength(1);
    expect(row[0]!.decision).toBe('dismissed');
    expect(row[0]!.h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('TAUGHT, IN THE OWNER\'S WORDS: a business-wide answer; the question decided in the same step, and offered no more', async () => {
    const r = await post('/app/knowledge/answers/teach', {
      question: 'Can you print our logo on the bags?', label: 'Logo printing', content: 'Yes: screen printing from 100 pieces, 7 days.',
    });
    expect(flashSaid(r, SECRET)).toBe('Taught. That question is not offered again.');
    const k = await tx((x) => sql<{ kind: string; label: string; content: string; source: string; product_id: string | null }>`
      select kind, label, content, source, product_id from product_knowledge`.execute(x).then((q) => q.rows));
    expect(k).toEqual([{ kind: 'faq', label: 'Logo printing', content: 'Yes: screen printing from 100 pieces, 7 days.', source: 'owner_confirmed', product_id: null }]);
    expect(await page()).not.toContain('logo');
    // asked in other words, answered by a person: the assistant would already answer it from what was taught — not offered
    await asked(await buyer(), 'Logo printing on tote bags, possible?', 'Yes, from 100.', 'person', 300);
    expect(await page()).not.toMatch(/logo/i);
    const taught = await tx((x) => sql<{ named: boolean }>`select knowledge_id is not null as named from answer_decisions where decision = 'taught'`.execute(x).then((q) => q.rows));
    expect(taught).toEqual([{ named: true }]);
    // an answer must have its words
    expect(flashSaid(await post('/app/knowledge/answers/teach', { question: 'Can I pay by bank transfer?', label: 'Payment', content: '  ' }), SECRET))
      .toBe('Not taught: a title and the answer are both needed.');
  });

  it('DECIDED ONCE: the database takes no change and no deletion of a decision', async () => {
    await expect(tx((x) => sql`update answer_decisions set decision = 'dismissed'`.execute(x))).rejects.toThrow(/permission denied/);
    await expect(tx((x) => sql`delete from answer_decisions`.execute(x))).rejects.toThrow(/permission denied/);
  });

  it('THE ACCOUNTANT: refused by the route, and past it the database shows no decision and takes none', async () => {
    const r = await post('/app/knowledge/answers/dismiss', { question: 'Can I pay by bank transfer?' }, accountant);
    expect(String(r.headers['location'])).toBe('/app/books');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { asViewer } = await import('../../src/db/viewer.js');
    const seen = await asViewer(accountantId, () => withTenantTx(db, BIZ as never, (x) =>
      sql<{ n: number }>`select count(*)::int as n from answer_decisions`.execute(x).then((q) => q.rows[0]!.n)));
    expect(seen).toBe(0);
    await expect(asViewer(accountantId, () => withTenantTx(db, BIZ as never, (x) =>
      sql`insert into answer_decisions (business_id, question_hash, decision, decided_by) values (${BIZ}::uuid, ${'a'.repeat(64)}, 'dismissed', 'acct')`.execute(x))))
      .rejects.toThrow(/row-level security/);
    expect(await count('answer_decisions')).toBe(2);
  });
});
