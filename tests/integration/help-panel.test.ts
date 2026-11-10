import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import type { AdvisorModel } from '../../src/llm/ports.js';
import type { Db } from '../../src/db/client.js';
import { t } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import { flashSaid } from './tenant.js';
import { withoutIsolates } from '../parity/isolates.js';

/**
 * Block 6.1 — HELP THAT ANSWERS, through the real app and the real database:
 *   · every page drawn for a signed-in person carries its "?", and the help page answers owner, team and accountant;
 *   · a question is metered on the ASKER's workspace (the advisor's ledger), never on anyone else's; a used-up
 *     allowance asks nothing;
 *   · only the guide's own lines reach the owner: the tester's fifteen invented sentences, in five languages, never
 *     do; a guide line the model quotes is shown, in every owner language;
 *   · "Write to us" reaches the operator's mailbox with exactly what the notice lists — the words, the page, the
 *     workspace's id and who asked — never the business's name, the asker's address or anything about a customer —
 *     and a team member may use it; an accountant may not.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const OP = randomUUID();
const OTHER = randomUUID();
const CODE = `help-panel-${RUN}`;
const SECRET = 'a-help-panel-session-secret-of-enough-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const OP_MAIL = `operator-${RUN}@nomi.test`;
const OTHER_MAIL = `owner-${RUN}@shop.test`;
const CUSTOMER = `Noor ${RUN}`;

d('Block 6.1 · help that answers (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: Db;
  let admin: pg.Client;
  let app: import('fastify').FastifyInstance;
  let owner = ''; let staff = ''; let accountant = ''; let staffId = '';
  const outbox: { to: string; subject: string; text: string }[] = [];
  const calls: string[] = [];
  let said: string | null = null;
  const model: AdvisorModel = {
    recognise: async ({ question }) => {
      calls.push('recognise');
      return { pick: /practi[cs]e/i.test(question) ? { id: 'practice', period: null, customer: null, product: null, reference: null } : null, usage: { inputTokens: 500, outputTokens: 30 } };
    },
    phrase: async () => {
      calls.push('phrase');
      return { text: said ?? t('en', 'help.g.practice.1'), usage: { inputTokens: 300, outputTokens: 50 } };
    },
  };
  const ledger = async (biz: string) => (await admin.query(
    `select coalesce(sum(llm_calls), 0)::int as calls, coalesce(sum(input_tokens), 0)::int as i, coalesce(sum(output_tokens), 0)::int as o,
            coalesce(sum(turns), 0)::int as turns from usage_ledger where business_id = $1`, [biz])).rows[0] as { calls: number; i: number; o: number; turns: number };
  const login = async (code: string) => {
    const r = await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM });
    return String(r.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  };
  /** The answer box alone (the page around it lists the guides' lines too), its words read without isolates (rule 38). */
  const answerOf = (body: string): string => {
    const at = body.indexOf('class="help-answer"');
    return at < 0 ? '' : withoutIsolates(body.slice(at, body.indexOf('</div>', at)));
  };
  const post = (cookie: string, url: string, body: Record<string, string>, lang = 'en') =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM, 'accept-language': lang }, payload: new URLSearchParams(body).toString() });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL }); await admin.connect();
    // The installation's own workspace (the operator), with the sign-in address its mail goes to.
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [OP, `Help Operator ${RUN}`]);
    const opOwner = (await admin.query(`insert into people (business_id, name, is_owner) values ($1, 'Op', true) returning id::text as id`, [OP])).rows[0].id as string;
    await admin.query(`insert into logins (business_id, person_id, email, password_hash) values ($1, $2, $3, 'scrypt$never-used')`, [OP, opOwner, OP_MAIL]);
    // Another workspace, whose team member and accountant ask; its owner signs in with an address of their own,
    // and it has a customer — neither may reach the operator's mail.
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [OTHER, `Help Shop ${RUN}`]);
    const otherOwner = (await admin.query(`insert into people (business_id, name, is_owner) values ($1, 'Sam', true) returning id::text as id`, [OTHER])).rows[0].id as string;
    await admin.query(`insert into logins (business_id, person_id, email, password_hash) values ($1, $2, $3, 'scrypt$never-used')`, [OTHER, otherOwner, OTHER_MAIL]);
    await admin.query(`insert into clients (business_id, display_name, phone) values ($1, $2, $3)`, [OTHER, CUSTOMER, `+3362${Math.floor(Math.random() * 1e7)}`]);

    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: OP, accessCode: CODE, sessionSecret: SECRET, employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {}, factsTtlMs: 0,
      advisorModel: model,
      systemMail: { from: 'nomi@nomi.test', send: async (m: { to: string; subject: string; text: string }) => { outbox.push(m); return { ok: true as const }; } },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    owner = await login(CODE);
    const team = await addPerson(db, OTHER, SECRET, `Team ${RUN}`, 'team'); if (team.code !== 'added') throw new Error('fixture');
    staff = await login(team.accessCode);
    staffId = (await admin.query(`select id::text as id from people where business_id = $1 and name = $2`, [OTHER, `Team ${RUN}`])).rows[0].id as string;
    const books = await addPerson(db, OTHER, SECRET, `Books ${RUN}`, 'accountant'); if (books.code !== 'added') throw new Error('fixture');
    accountant = await login(books.accessCode);
    expect([owner, staff, accountant].every((c) => c !== '')).toBe(true);
  }, 90_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); await admin?.end(); });

  it('a signed-in page carries its "?"; the help page draws that page\'s guides for the owner and a team member', async () => {
    for (const [cookie, page] of [[owner, '/app/settings/channels'], [staff, '/app/products']] as const) {
      const p = await app.inject({ method: 'GET', url: page, headers: { cookie } });
      expect(p.statusCode, page).toBe(200);
      expect(p.body).toContain(`<a class="help-door" href="/app/help/page?from=${page}" data-card`);
      const h = await app.inject({ method: 'GET', url: `/app/help/page?from=${page}`, headers: { cookie } });
      expect(h.statusCode).toBe(200);
      expect(h.body).toContain('action="/app/help/ask"');
      expect(h.body).toContain('action="/app/help/write"');
    }
    const h = await app.inject({ method: 'GET', url: '/app/help/page?from=/app/settings/channels', headers: { cookie: owner } });
    expect(h.body).toContain(esc(t('en', 'help.g.channels.title')));
    expect(h.body).toContain('src="/assets/guide/channels.en.webm"');
    expect((await app.inject({ method: 'GET', url: '/assets/guide/channels.en.webm' })).statusCode).toBe(200);
  });

  it('the accountant reads the guides, and may neither ask nor write', async () => {
    const h = await app.inject({ method: 'GET', url: '/app/help/page?from=/app/books', headers: { cookie: accountant } });
    expect(h.statusCode).toBe(200);
    expect(h.body).toContain(esc(t('en', 'help.g.books.title')));
    expect(h.body).not.toContain('action="/app/help/ask"');
    calls.length = 0; const sent = outbox.length; const before = await ledger(OTHER);
    for (const [url, body] of [['/app/help/ask', { q: 'How does practice work?' }], ['/app/help/write', { words: 'Help me' }]] as const) {
      const r = await post(accountant, url, body);
      expect(r.statusCode, url).toBe(302);
    }
    expect(calls).toEqual([]);
    expect(outbox.length).toBe(sent);
    expect(await ledger(OTHER)).toEqual(before);
  });

  it('a team member\'s question is answered and metered on their own workspace — never the operator\'s', async () => {
    calls.length = 0;
    const mine = await ledger(OTHER); const op = await ledger(OP);
    const r = await post(staff, '/app/help/ask', { q: 'How does practice work?', from: '/app/assistant/practice' });
    expect(r.statusCode).toBe(200);
    expect(answerOf(r.body)).toContain(esc(t('en', 'help.g.practice.1')));
    expect(answerOf(r.body)).not.toContain(esc(t('en', 'help.g.practice.2')));
    expect(calls).toEqual(['recognise', 'phrase']);
    const after = await ledger(OTHER);
    expect({ calls: after.calls - mine.calls, i: after.i - mine.i, o: after.o - mine.o, turns: after.turns - mine.turns }).toEqual({ calls: 2, i: 800, o: 80, turns: 0 });
    expect(await ledger(OP)).toEqual(op);
  });

  it('only the guide\'s own lines reach the owner: fifteen invented sentences in five languages never do', async () => {
    // The tester's fifteen (6.1's verification, Q3); ten reached the owner under the English term list.
    const invented: readonly (readonly [string, string])[] = [
      ['en', 'Practice can also post your products to Shopify.'], ['en', 'Practice gives you 500 messages a day.'],
      ['en', 'Practice gives you five hundred messages a day.'], ['en', 'Practice will take videos from December.'],
      ['en', 'Practice can also send discount codes to customers who leave their cart.'], ['en', 'Practice also syncs your catalogue with Pinterest and Square.'],
      ['en', 'Every reply that waits is automatically translated into the customer’s language.'], ['en', 'From the Inbox you can message all your customers at once.'],
      ['en', 'The assistant can reply to customers with voice messages.'], ['en', 'You can unsend a reply up to an hour after it goes.'],
      ['ar', 'يمكن للتدريب أيضًا إرسال رسائل نصية قصيرة إلى عملائك.'], ['ar', 'يرسل التدريب ردودك إلى واتساب العميل مباشرة.'],
      ['zh', '练习也可以给你的客户发短信。'], ['es', 'Práctica también puede hacer llamadas telefónicas a tus clientes.'], ['fr', 'Practice publie aussi vos produits sur Shopify.'],
    ];
    const reached: string[] = [];
    try {
      for (const [lang, text] of invented) {
        said = text;
        const r = await post(owner, '/app/help/ask', { q: 'What else can practice do?', from: '/app/assistant/practice' }, lang);
        expect(r.statusCode).toBe(200);
        if (withoutIsolates(r.body).includes(esc(text))) reached.push(text);
        expect(answerOf(r.body), text).toContain(esc(t('en', 'help.g.practice.2')));
      }
      expect(reached).toEqual([]);
      // A guide line the model quotes is shown, as the guide words it, in every owner language; one word changed is not.
      const line = t('en', 'help.g.practice.2');
      for (const lang of ['en', 'ar', 'zh', 'es']) {
        said = line.toLowerCase().replace(/\./g, '');
        const r = await post(owner, '/app/help/ask', { q: 'How many practice messages?', from: '/app/assistant/practice' }, lang);
        const answer = answerOf(r.body);
        expect(answer, lang).toContain(esc(line));
        expect(answer, lang).not.toContain(esc(t('en', 'help.g.practice.1')));
        said = line.replace('50', '60');
        const changed = await post(owner, '/app/help/ask', { q: 'How many practice messages?', from: '/app/assistant/practice' }, lang);
        expect(withoutIsolates(changed.body), lang).not.toContain('60 messages');
        expect(answerOf(changed.body), lang).toContain(esc(t('en', 'help.g.practice.1')));
      }
    } finally { said = null; }
    calls.length = 0;
    const r = await post(owner, '/app/help/ask', { q: 'Can Nomi answer my WeChat messages?' });
    expect(r.body).toContain(esc(t('en', 'help.ask.notYet')));
    expect(calls).toEqual([]);
  });

  it('today\'s allowance used up: nothing asked, nothing written, and the owner reads why', async () => {
    await admin.query(`insert into tenant_budgets (business_id, daily_llm_calls, daily_tokens, soft_warn_pct, on_exceeded) values ($1, 1, 1000000, 80, 'pause')`, [OTHER]);
    try {
      calls.length = 0; const before = await ledger(OTHER);
      const r = await post(staff, '/app/help/ask', { q: 'How does practice work?' });
      expect(r.body).toContain(esc(t('en', 'help.ask.allowance')));
      expect(calls).toEqual([]);
      expect(await ledger(OTHER)).toEqual(before);
    } finally { await admin.query(`delete from tenant_budgets where business_id = $1`, [OTHER]); }
  });

  it('Write to us: the operator\'s mailbox gets the words, the page, the workspace\'s id and who asked — nothing else of theirs', async () => {
    const sent = outbox.length;
    const r = await post(staff, '/app/help/write', { words: 'How do I add a second WhatsApp number?', from: '/app/settings/channels' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/app/help/page?from=/app/settings/channels#write');
    expect(outbox.length).toBe(sent + 1);
    const m = outbox.at(-1)!;
    expect(m.to).toBe(OP_MAIL);
    expect(m.subject).toBe(`Help request from workspace ${OTHER}`);
    expect(m.text).toContain('How do I add a second WhatsApp number?');
    expect(m.text).toContain('Page: /app/settings/channels');
    expect(m.text).toContain(`Workspace: ${OTHER}`);
    expect(m.text).toContain('Asked by: team member');
    // Not the business's name (the operator looks it up by the id), not the person's id.
    expect(`${m.subject}\n${m.text}`).not.toContain(`Help Shop ${RUN}`);
    expect(m.text).not.toContain(staffId);
    expect(m.text).not.toContain(OTHER_MAIL);
    expect(m.text).not.toContain(CUSTOMER);
    expect(m.text).not.toContain(OP);
    expect(flashSaid(r, SECRET)).toBe(t('en', 'help.write.sent'));
  });

  it('three an hour per workspace: the fourth is refused and nothing more is mailed', async () => {
    const sent = outbox.length;
    let last: Awaited<ReturnType<typeof post>> | null = null;
    for (let i = 0; i < 3; i++) last = await post(staff, '/app/help/write', { words: `again ${i}` });
    expect(outbox.length).toBe(sent + 2);
    expect(flashSaid(last!, SECRET)).toBe(t('en', 'help.write.limit'));
    // Another workspace's limit is its own: the operator's owner still writes.
    const r = await post(owner, '/app/help/write', { words: 'Owner here' });
    expect(r.statusCode).toBe(302);
    expect(outbox.length).toBe(sent + 3);
    expect(outbox.at(-1)!.text).toContain(`Workspace: ${OP}`);
    expect(outbox.at(-1)!.text).toContain('Asked by: owner');
    expect(outbox.at(-1)!.text).not.toContain(`Help Operator ${RUN}`);
  });
});
