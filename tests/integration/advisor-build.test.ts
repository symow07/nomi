import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';
import type { AdvisorModel } from '../../src/llm/ports.js';
import { moneyFromRow } from '../../src/core/types/money.js';

/**
 * THE ADVISOR BATCH (2026-10-06), on a real database: the advisor's facts are the database's, read through
 * a pool that cannot write; the model only words them, and a sentence that says anything else is thrown
 * away for the facts themselves; missing data is its fixed sentence; the owner's own test conversation is
 * in no answer.
 *
 * The workspace's zone is chosen so that its local time is midday while this runs: "today", "this week"
 * and "this month" all hold the fixture's last twenty minutes, whatever the hour of the run.
 *
 *   Amira   a real customer: wrote twice, answered 10 minutes after the first; wrote again, answered a
 *           minute later; a confirmed order of US$120.00; a reply waiting for review.
 *   Bao     a real customer: wrote, and nobody answered; a confirmed order of CN¥500.00.
 *   Me      the owner testing their own shop: wrote, answered in 5 seconds, wrote again unanswered; an
 *           order of US$999.00 and a reply waiting — none of it is business.
 * Reply times, then: replies 600 s and 60 s → the median 330 s ("5 minutes"), 2 replies measured, 1
 * message unanswered (Bao's). Counting the test would say 60 s, 3 and 2.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const id = (n: number) => `dda30000-0000-4000-8000-${RUN}${String(n).padStart(4, '0')}`;
const BIZ = id(1); const EMPTY = id(2); const PID = id(3);
const [A, B, T] = [id(10), id(11), id(12)];
const [CA, CB, CT] = [id(20), id(21), id(22)];
const REF = `ADV-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const CODE = 'advisor-build-owner-code';

/** A zone whose local time is about midday now: Etc/GMT-N is UTC+N. */
const MIDDAY = (() => {
  const offset = 12 - new Date().getUTCHours();
  return offset === 0 ? 'UTC' : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
})();

type Route = { id: string; period?: string | null; customer?: string | null; product?: string | null; reference?: string | null };

/** A model that routes by the question's words and words the facts as given, unless told to say something else. */
function fakeModel(routes: Record<string, Route>, says: Record<string, string> = {}, calls: string[] = []): AdvisorModel {
  return {
    recognise: async ({ question }) => {
      const r = routes[question];
      calls.push(`recognise:${r?.id ?? '-'}`);
      return r ? { period: null, customer: null, product: null, reference: null, ...r } : null;
    },
    phrase: async ({ question, facts }) => {
      calls.push(`phrase:${routes[question]?.id ?? '-'}`);
      return says[question] ?? facts.join(' ');
    },
  };
}

d('the advisor batch · facts from read-only reads, worded under the check (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let ro: import('../../src/db/client.js').Db;
  const tx = async <R>(biz: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<R>, on = () => db): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(on(), bid.value, fn);
  };
  const ctx = async (o: { biz?: string; locale?: import('../../src/core/owner/i18n/locale.js').Locale; params?: Partial<import('../../src/advisor/reads.js').Params> } = {}) => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(o.biz ?? BIZ); if (!bid.ok) throw new Error('fixture');
    return { db: ro, businessId: bid.value, viewerId: 'owner', locale: o.locale ?? 'en', now: new Date(),
      params: { period: null, customer: null, product: null, reference: null, ...o.params } } as import('../../src/advisor/reads.js').ReadCtx;
  };
  const ask = async (question: string, model: AdvisorModel, o: { biz?: string; locale?: import('../../src/core/owner/i18n/locale.js').Locale } = {}) => {
    const { answerQuestion } = await import('../../src/advisor/answer.js');
    return answerQuestion({ db: ro, model, businessId: o.biz ?? BIZ, viewerId: 'owner', locale: o.locale ?? 'en', now: new Date() }, question);
  };
  /** The next transaction id the database would hand out: any transaction that writes moves it; reading never does. */
  const horizon = async () => BigInt((await sql<{ x: string }>`select pg_snapshot_xmax(pg_current_snapshot())::text as x`.execute(db)).rows[0]!.x);

  beforeAll(async () => {
    const { createDb, createReadOnlyDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    ro = createReadOnlyDb(DATABASE_URL!);
    await tx(BIZ, async (t) => {
      await sql`insert into businesses (id, name, timezone, country, currency) values (${BIZ}, 'Advisor Build Co', ${MIDDAY}, 'CN', 'USD')`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, is_active) values (${PID}, ${BIZ}, ${REF}, 'Canvas tote', 'pcs', true)`.execute(t);
      for (const [c, cl, name, testing] of [[A, CA, 'Amira Haddad', false], [B, CB, 'Bao Lin', false], [T, CT, 'Me testing', true]] as const) {
        await sql`insert into clients (id, business_id, display_name) values (${cl}, ${BIZ}, ${name})`.execute(t);
        await sql`insert into conversations (id, business_id, client_id, channel, owner_testing) values (${c}, ${BIZ}, ${cl}, 'whatsapp', ${testing})`.execute(t);
      }
      const say = (c: string, dir: 'inbound' | 'outbound', s: number, n: number) =>
        sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
            values (${c}, ${`${RUN}-${c}-${n}`}, ${dir}, 'text', 'Words', now() - interval '20 minutes' + make_interval(secs => ${s}))`.execute(t);
      // Amira: a run of two, answered 600 s after its first; then one answered 60 s later
      await say(A, 'inbound', 0, 1); await say(A, 'inbound', 60, 2); await say(A, 'outbound', 600, 3);
      await say(A, 'inbound', 700, 4); await say(A, 'outbound', 760, 5);
      // Bao: one, unanswered
      await say(B, 'inbound', 100, 1);
      // the owner testing: answered in 5 s, then one unanswered
      await say(T, 'inbound', 0, 1); await say(T, 'outbound', 5, 2); await say(T, 'inbound', 10, 3);
      const order = (ref: string, cl: string, c: string, total: number, currency: string) =>
        sql`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit,
                                agreed_unit_price_usd, total_value_usd, currency, status, confirmed_at)
            values (${ref}, ${BIZ}, ${cl}, ${c}, ${PID}, 10, 'pcs', ${total / 10}, ${total}, ${currency}, 'confirmed', now() - interval '5 minutes')`.execute(t);
      await order(REF, CA, A, 120, 'USD');
      await order(`${REF}-B`, CB, B, 500, 'CNY');
      await order(`${REF}-T`, CT, T, 999, 'USD');
      for (const c of [A, T]) {
        await sql`insert into drafts (business_id, conversation_id, capability, draft_text, status) values (${BIZ}, ${c}, 'quote', 'Waiting', 'pending')`.execute(t);
      }
      await sql`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at) values (${BIZ}, 'USD', 'CNY', 7.1, '2026-09-20T09:00:00Z')`.execute(t);
    });
    await tx(EMPTY, (t) => sql`insert into businesses (id, name, timezone) values (${EMPTY}, 'Nothing Yet Co', ${MIDDAY})`.execute(t));
  });
  afterAll(async () => { await ro?.destroy(); await db?.destroy(); });

  it('the advisor\'s pool cannot write: an insert in a tenant transaction is refused by the database (the app\'s pool is the control)', async () => {
    const write = (on: () => import('../../src/db/client.js').Db) =>
      tx(BIZ, (t) => sql`insert into clients (business_id, display_name) values (${BIZ}, 'Written by the advisor')`.execute(t), on);
    await expect(write(() => ro)).rejects.toThrow(/read-only transaction/);
    await expect(write(() => db)).resolves.toBeDefined();
    // (the control's row has no conversation: it is no customer, and counts in no answer below)
  });

  it('every one of the fifty reads runs on it — none writes, none fails — for a workspace with data and one with none', async () => {
    const { READS } = await import('../../src/advisor/reads.js');
    expect(Object.keys(READS)).toHaveLength(50);
    for (const biz of [BIZ, EMPTY]) {
      for (const [key, run] of Object.entries(READS)) {
        const sheet = await run(await ctx({ biz, params: { customer: 'Amira', product: 'tote', reference: REF } }));
        expect(sheet.empty || sheet.lines.length > 0, `${biz === BIZ ? 'data' : 'empty'} ${key}`).toBe(true);
        if (sheet.empty) expect(sheet.lines, key).toEqual([]);
      }
    }
  });

  it('asking writes nothing anywhere: the database hands out no transaction id while questions are answered (a real write is the control)', async () => {
    const c0 = await horizon();
    await tx(BIZ, (t) => sql`update businesses set name = name where id = ${BIZ}`.execute(t));
    expect(await horizon()).toBeGreaterThan(c0);
    const before = await horizon();
    const routes = { a: { id: 'A1' }, b: { id: 'B8' }, c: { id: 'D8' }, d: { id: 'I3' }, e: { id: 'A3', customer: 'Amira' }, f: { id: 'D11', reference: REF } };
    for (const q of Object.keys(routes)) expect((await ask(q, fakeModel(routes))).kind, q).not.toBe('failed');
    expect(await horizon()).toBe(before);
  });

  it('the figures are the database\'s, and the owner\'s test is in none of them', async () => {
    const { READS } = await import('../../src/advisor/reads.js');
    const show = await import('../../src/api/web/values.js');
    expect((await READS['A1']!(await ctx())).lines).toEqual(['Customers: 2']);
    expect((await READS['A1']!(await ctx({ locale: 'zh' }))).lines).toEqual(['客户：2']);
    const a2 = (await READS['A2']!(await ctx())).lines.join('\n');
    expect(a2).toContain('Amira Haddad');
    expect(a2).not.toContain('Me testing');
    const d1 = (await READS['D1']!(await ctx())).lines;
    expect(d1).toContain('Confirmed orders: 2');
    expect(d1).toContain(`Confirmed sales: ${show.money('en', moneyFromRow(120, 'USD')!)}`);
    expect(d1.join('\n')).not.toMatch(/999/);
    const b1 = (await READS['B1']!(await ctx())).lines;
    expect(b1[0]).toBe('Waiting for you: 1');
    expect(b1.join('\n')).toContain('Amira Haddad — a reply to review');
    const b7 = (await READS['B7']!(await ctx())).lines.join('\n');
    expect(b7).toContain('Bao Lin');
    expect(b7).not.toContain('Me testing');
  });

  it('B8 · reply times: the median, the replies measured, and — always with them — the messages still unanswered', async () => {
    const { READS } = await import('../../src/advisor/reads.js');
    const show = await import('../../src/api/web/values.js');
    const sheet = await READS['B8']!(await ctx());
    const median = show.timeLeft('en', 330_000);
    expect(median).toBe('5 minutes');
    expect(sheet.lines.slice(1)).toEqual([`Median time to reply: ${median}`, 'Replies measured: 2', 'Customer messages in the period still unanswered: 1']);
    expect(sheet.must).toEqual([median, '2', '1']);
    expect(sheet.lines.join(' ')).not.toMatch(/%/);
    // a sentence that leaves the unanswered out is not shown: the facts are, all three
    const routes = { 'how fast do we reply': { id: 'B8' } };
    const flattering = await ask('how fast do we reply', fakeModel(routes, { 'how fast do we reply': `We reply in a median of ${median}, over 2 replies.` }));
    expect(flattering).toMatchObject({ kind: 'fact', phrased: false });
    expect(flattering.kind === 'fact' && flattering.lines).toContain('Customer messages in the period still unanswered: 1');
    const whole = await ask('how fast do we reply', fakeModel(routes, { 'how fast do we reply': `A median of ${median} over 2 replies; 1 message is still unanswered.` }));
    expect(whole).toMatchObject({ kind: 'fact', phrased: true, text: `A median of ${median} over 2 replies; 1 message is still unanswered.` });
  });

  it('D8 · sales at the owner\'s own rate, the rate and its date said; a total in another currency is said as it is', async () => {
    const { READS } = await import('../../src/advisor/reads.js');
    const show = await import('../../src/api/web/values.js');
    const lines = (await READS['D8']!(await ctx())).lines;
    expect(lines[1]).toBe(`Your rate: 1 USD = 7.1 CNY, set ${show.date('en', new Date('2026-09-20T09:00:00Z'))}`);
    const usd = show.money('en', moneyFromRow(120, 'USD')!);
    const cny = show.money('en', moneyFromRow(852, 'CNY')!);
    expect(lines).toContain(`${usd} = ${cny} at your rate`);
    expect(lines).toContain(`${show.money('en', moneyFromRow(500, 'CNY')!)} (not converted: your rate is for another currency)`);
    // no rate stated: nothing is converted, and no figure is said
    const none = await READS['D8']!(await ctx({ biz: EMPTY }));
    expect(none).toMatchObject({ empty: true, none: 'advisor.none.rate', lines: [] });
  });

  it('a sentence with a figure, a name or a percentage the facts do not carry is thrown away; the facts are the answer', async () => {
    const routes = { 'how many customers': { id: 'A1' } };
    const lie = await ask('how many customers', fakeModel(routes, { 'how many customers': 'You have 3 customers.' }));
    expect(lie).toMatchObject({ kind: 'fact', phrased: false, lines: ['Customers: 2'] });
    const name = await ask('how many customers', fakeModel(routes, { 'how many customers': 'You have 2 customers, like Me testing.' }));
    expect(name).toMatchObject({ kind: 'fact', phrased: false });
    const pct = await ask('how many customers', fakeModel(routes, { 'how many customers': 'You have 2 customers, 2% more.' }));
    expect(pct).toMatchObject({ kind: 'fact', phrased: false });
    const true_ = await ask('how many customers', fakeModel(routes, { 'how many customers': 'You have 2 customers.' }));
    expect(true_).toMatchObject({ kind: 'fact', phrased: true, text: 'You have 2 customers.' });
  });

  it('nothing there: the fixed sentence, and the model is not asked to word anything', async () => {
    const { t } = await import('../../src/api/web/say.js');
    const routes = { a: { id: 'A1' }, d: { id: 'D1' }, r: { id: 'D8' }, o: { id: 'D11', reference: 'NOPE-1' }, c: { id: 'A3', customer: 'Zed' } };
    for (const [q, key, p] of [['a', 'advisor.none.customers', {}], ['d', 'advisor.none.salesNever', {}], ['r', 'advisor.none.rate', {}]] as const) {
      const calls: string[] = [];
      const r = await ask(q, fakeModel(routes, {}, calls), { biz: EMPTY });
      expect(r, q).toMatchObject({ kind: 'none', text: t('en', key, p) });
      expect(calls, q).toEqual([`recognise:${routes[q].id}`]);
    }
    const calls: string[] = [];
    expect(await ask('o', fakeModel(routes, {}, calls))).toMatchObject({ kind: 'none', text: t('en', 'advisor.none.noSuchOrder', { ref: 'NOPE-1' }) });
    expect(await ask('c', fakeModel(routes, {}, calls))).toMatchObject({ kind: 'none', text: t('en', 'advisor.none.noSuchCustomer', { name: 'Zed' }) });
    expect(calls.filter((c) => c.startsWith('phrase'))).toEqual([]);
  });

  it('advice: under its label, standing only on the facts its entry names', async () => {
    const routes = { 'who should I follow up': { id: 'I3' } };
    const r = await ask('who should I follow up', fakeModel(routes));
    expect(r.kind).toBe('opinion');
    if (r.kind !== 'opinion') return;
    expect(r.based).toContain('best customers');
    expect(r.lines.join('\n')).not.toContain('Me testing');
  });

  it('through the app: signed in, a question answered with its door; the page holds no form but the box', async () => {
    await seedRunTenant();
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, employeeName: 'Lily', avatar: '👩‍💼',
      provider: 'disabled', secureCookie: false, messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
      autonomyReleased: () => true, resolveDns: async () => { throw new Error('no DNS in this test'); },
      advisorDb: ro, advisorModel: fakeModel({ 'How many customers do I have?': { id: 'A1' } }, { 'How many customers do I have?': 'You have 2 customers.' }),
    });
    await app.ready();
    try {
      const login = await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM });
      const cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
      const r = await app.inject({ method: 'POST', url: '/app/advisor', payload: 'q=How%20many%20customers%20do%20I%20have%3F', headers: { cookie, ...FORM } });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('<p><bdi>You have 2 customers.</bdi></p>');
      expect(r.body).toContain('<a class="deeper" href="/app/inbox">');
      const signedOut = await app.inject({ method: 'POST', url: '/app/advisor', payload: 'q=How%20many%20customers%20do%20I%20have%3F', headers: FORM });
      expect(signedOut.statusCode).toBe(302);
      expect(signedOut.headers['location']).toBe('/login');
    } finally {
      await app.close();
    }
  });
});
