import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * THE WARMTH RUN, PHASE 4 (2026-10-03) — the Inbox over Postgres and the
 * owner's own routes:
 *
 *   - a customer who wrote on two channels is ONE row, which opens their
 *     newest conversation — or the one that needs the owner, when one does —
 *     and is counted once;
 *   - "matters most" orders by what each customer spent (the orders that
 *     stand: a cancelled one counts for nothing), the customers with nothing
 *     spent after, and pages both ways by its own cursor losing nobody;
 *   - the "needs attention" band holds a customer quiet after a price, one
 *     who left a question unanswered and a regular who stopped ordering —
 *     and nobody waiting for the owner, nobody too fresh, nobody too old;
 *   - the lens rides along a search; "Mine"'s old address leads to the list.
 *
 * The page by structure, in five languages: tests/parity/warmth-inbox.test.ts.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `b0e20000-0000-4000-8000-${RUN}0001`;
const PROD = `b0e20000-0000-4000-8000-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('phase 4 · the Inbox: one customer one row, two lenses, the band (requires DATABASE_URL)', () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let cookie = '';
  const who: Record<string, string> = {};    // name → client id
  const conv: Record<string, string> = {};   // name → their (newest) conversation
  let tanWhatsApp = '';

  const as = async <R>(fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

  const client = async (x: Tx, name: string): Promise<string> => (await sql<{ id: string }>`
    insert into clients (business_id, display_name) values (${BIZ}, ${name}) returning id::text as id`.execute(x)).rows[0]!.id;
  const conversation = async (x: Tx, clientId: string, channel = 'whatsapp'): Promise<string> => (await sql<{ id: string }>`
    insert into conversations (business_id, client_id, channel, phase, is_active)
    values (${BIZ}, ${clientId}::uuid, ${channel}, 'warm_intake', true) returning id::text as id`.execute(x)).rows[0]!.id;
  /** A line on the timeline, `minutes` ago. */
  const line = (x: Tx, c: string, direction: 'inbound' | 'outbound', text: string, minutes: number) => sql`
    insert into messages (conversation_id, direction, text_content, sent_at)
    values (${c}::uuid, ${direction}, ${text}, now() - make_interval(mins => ${minutes}))`.execute(x);
  /**
   * An order, in a past conversation of its own (one open order per conversation,
   * `orders_one_open_per_conversation`): a regular has several conversations, and
   * is still one row.
   */
  const order = async (x: Tx, name: string, n: number, value: number, status: string, daysAgo: number) => {
    const past = (await sql<{ id: string }>`
      insert into conversations (business_id, client_id, channel, phase, is_active, created_at)
      values (${BIZ}, ${who[name]}::uuid, 'whatsapp', 'closed', false, now() - make_interval(days => ${daysAgo + 1}))
      returning id::text as id`.execute(x)).rows[0]!.id;
    await sql`
      insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, total_value_usd, status, currency, created_at, confirmed_at)
      values (${`W4-${RUN}-${name}-${n}`}, ${BIZ}, ${who[name]}::uuid, ${past}::uuid, ${PROD}::uuid, 10, 'pcs', ${value}, ${status}, 'USD',
              now() - make_interval(days => ${daysAgo}), now() - make_interval(days => ${daysAgo}))`.execute(x);
  };
  const quote = (x: Tx, name: string, daysAgo: number) => sql`
    insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version, created_at)
    values (${BIZ}, ${conv[name]}::uuid, ${PROD}::uuid, 100, '{}'::jsonb, 2.40, 240, 'test', now() - make_interval(days => ${daysAgo}))`.execute(x);
  const DAY = 24 * 60;

  /** The customers a page lists, by their row's conversation, in page order. */
  const listed = (html: string): string[] =>
    [...html.matchAll(/<a class="ir-main" href="\/app\/inbox\/([0-9a-f-]{36})#latest"/g)].map((m) => m[1]!);
  const band = (html: string): string => /<section class="attn"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await as((x) => sql`insert into businesses (id, name, owner_locale) values (${BIZ}, 'Warm Inbox Co', 'en')
                        on conflict (id) do nothing`.execute(x));
    await as(async (x) => {
      await sql`insert into products (id, business_id, sku, name, unit, is_active)
                values (${PROD}, ${BIZ}, ${`W4-${RUN}`}, 'Canvas tote', 'pcs', true)`.execute(x);
      // A plain customer: one conversation, a line from them and a plain answer.
      const plain = async (name: string, minutes: number, last: 'inbound' | 'outbound' = 'outbound', said = `answered ${name}`) => {
        who[name] = await client(x, name);
        conv[name] = await conversation(x, who[name]!);
        await line(x, conv[name]!, 'inbound', `hello from ${name}`, minutes + 1);
        if (last === 'outbound') await line(x, conv[name]!, 'outbound', said, minutes);
      };

      // Two channels, one customer: WhatsApp two days ago, Instagram an hour ago.
      who['Tan'] = await client(x, 'Tan Two-Channels');
      tanWhatsApp = await conversation(x, who['Tan']!, 'whatsapp');
      await line(x, tanWhatsApp, 'inbound', 'first, on WhatsApp', 2 * DAY + 1);
      await line(x, tanWhatsApp, 'outbound', 'answered on WhatsApp', 2 * DAY);
      conv['Tan'] = await conversation(x, who['Tan']!, 'instagram');
      await line(x, conv['Tan']!, 'inbound', 'then, on Instagram', 61);
      await line(x, conv['Tan']!, 'outbound', 'answered on Instagram', 60);

      // What they spent.
      await plain('Ade', 10 * DAY, 'inbound');                       // one big order
      await order(x, 'Ade', 1, 12000, 'confirmed', 9);
      await plain('Bo', 2 * DAY, 'inbound');                         // small and often: a regular still ordering
      for (const [i, days] of [40, 30, 20, 10].entries()) await order(x, 'Bo', i, 300, 'shipped', days);
      await plain('Cy', 70 * DAY, 'inbound');                        // a regular who stopped
      for (const [i, days] of [80, 70, 60].entries()) await order(x, 'Cy', i, 500, 'confirmed', days);
      await plain('Dee', 3 * DAY, 'inbound');                        // a cancelled order counts for nothing
      await order(x, 'Dee', 1, 99999, 'cancelled', 4);
      await plain('Ed', 30, 'inbound');                              // nothing at all

      // The band.
      await plain('Fay', 5 * DAY + 10, 'inbound');                   // a price went out five days ago; silence since
      await quote(x, 'Fay', 5);
      await line(x, conv['Fay']!, 'outbound', 'It is $2.40 a piece for 100.', 5 * DAY - 1);
      await plain('Gus', 6 * DAY, 'outbound', 'Which colour would you like?');   // our question, unanswered
      await plain('Hal', 6 * DAY, 'outbound', 'Thank you, talk soon.');          // our last word asked nothing
      await plain('Ivy', 5 * DAY + 10, 'inbound');                   // quiet after a price, but waiting for the owner
      await quote(x, 'Ivy', 5);
      await line(x, conv['Ivy']!, 'outbound', 'It is $2.40 a piece.', 5 * DAY - 1);
      await sql`update conversations set assigned_to = 'unclaimed' where id = ${conv['Ivy']}::uuid`.execute(x);
      await plain('Jo', DAY + 10, 'inbound');                        // a price yesterday: not slipping yet
      await quote(x, 'Jo', 1);
      await line(x, conv['Jo']!, 'outbound', 'It is $2.40 a piece.', DAY - 1);
      await plain('Kim', 40 * DAY + 10, 'inbound');                  // a price forty days ago: past picking up
      await quote(x, 'Kim', 40);
      await line(x, conv['Kim']!, 'outbound', 'It is $2.40 a piece.', 40 * DAY - 1);
    });

    app = Fastify({ logger: false });
    const code = `warm-${RUN}`;
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({
      method: 'POST', url: '/login', payload: `code=${code}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 120_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('a customer on two channels is one row, which opens their newest conversation', async () => {
    const r = await get('/app/inbox');
    expect(r.statusCode).toBe(200);
    const ids = listed(r.body);
    expect(ids).toHaveLength(Object.keys(who).length);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(conv['Tan']);
    expect(ids).not.toContain(tanWhatsApp);
    expect(r.body.split(`href="/app/customers/${who['Tan']}" data-card`).length - 1).toBe(1);
  });

  it('…and the conversation that needs the owner, when one does — counted once', async () => {
    const { loadInboxList } = await import('../../src/api/web/inbox.js');
    await as((x) => sql`update conversations set assigned_to = 'unclaimed' where id = ${tanWhatsApp}::uuid`.execute(x));
    try {
      const pending = await loadInboxList(db, BIZ, 'pending');
      const tan = pending.conversations.filter((c) => c.clientId === who['Tan']);
      expect(tan.map((c) => c.conversationId)).toEqual([tanWhatsApp]);
      expect(tan[0]!.ownership).toBe('WAITING_HUMAN');
      // Tan and Ivy: two customers, however many conversations
      expect(pending.waitingCount).toBe(2);
      const all = await loadInboxList(db, BIZ, 'all');
      expect(all.conversations.slice(0, 2).map((c) => c.clientId).sort()).toEqual([who['Tan'], who['Ivy']].sort());
    } finally {
      await as((x) => sql`update conversations set assigned_to = null where id = ${tanWhatsApp}::uuid`.execute(x));
    }
  });

  it('"matters most": the most spent first, a cancelled order counts for nothing, then everyone else by newest', async () => {
    const r = await get('/app/inbox?lens=value');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<a class="tab on" aria-current="true" href="/app/inbox?lens=value">');
    const ids = listed(r.body);
    expect(ids.slice(0, 3)).toEqual([conv['Ade'], conv['Cy'], conv['Bo']]);
    const head = r.body.indexOf('<h2 class="bgroup-h">Nothing spent yet</h2>');
    expect(head).toBeGreaterThan(r.body.indexOf(`/app/inbox/${conv['Bo']}#latest`));
    expect(r.body.indexOf(`/app/inbox/${conv['Dee']}#latest`)).toBeGreaterThan(head);
    // the rest by their last contact, the newest first: Ed (30 minutes) before Tan (an hour)
    expect(ids.indexOf(conv['Ed']!)).toBeLessThan(ids.indexOf(conv['Tan']!));
    // what they spent, as the order pages write it; the regulars marked, by Nomi
    expect(r.body).toContain('<bdi aria-hidden="true">$12,000.00</bdi>');
    expect(r.body).toContain('<bdi aria-hidden="true">$1,500.00</bdi>');
    expect(r.body).toContain('<bdi aria-hidden="true">$1,200.00</bdi>');
    expect(r.body).not.toContain('99,999');
    const row = (name: string) => new RegExp(`<a class="ir-main" href="/app/inbox/${conv[name]}#latest"[^>]*>([\\s\\S]*?)</a></div>`).exec(r.body)?.[1] ?? '';
    expect(row('Bo')).toContain('class="ir-reg"');
    expect(row('Cy')).toContain('class="ir-reg"');
    expect(row('Ade')).not.toContain('class="ir-reg"');
  });

  it('"matters most" pages by its own cursor, both ways, losing nobody', async () => {
    const { readBuyersPage } = await import('../../src/db/buyersList.js');
    const size = 3;
    const forward: string[][] = [];
    let after: string | null = null;
    let prev: { cursor: string | null } | null = null;
    do {
      const p = await as((x) => readBuyersPage(x, { filter: 'all', q: '', lens: 'value', after, size }));
      forward.push(p.rows.map((x) => x.clientId));
      if (p.next) expect(p.next).toMatch(/^v-?\d+(\.\d+)?_(n|-?\d+)_[0-9a-f-]{36}$/);
      after = p.next;
      prev = p.prev;
    } while (after);
    expect(forward.flat().sort()).toEqual(Object.values(who).sort());
    expect(forward.flat().slice(0, 3)).toEqual([who['Ade'], who['Cy'], who['Bo']]);
    const backward: string[][] = [forward.at(-1)!];
    while (prev) {
      const at: { cursor: string | null } = prev;
      const p = await as((x) => readBuyersPage(x, { filter: 'all', q: '', lens: 'value', ...(at.cursor ? { before: at.cursor } : {}), size }));
      backward.unshift(p.rows.map((x) => x.clientId));
      prev = p.prev;
    }
    expect(backward).toEqual(forward);
  });

  it('the band: quiet after a price, a question unanswered, a regular who stopped — nobody waiting, too fresh or too old', async () => {
    const r = await get('/app/inbox');
    const b = band(r.body);
    expect(b).toContain('Needs attention');
    const at = (name: string) => b.indexOf(`href="/app/inbox/${conv[name]}#latest"`);
    for (const name of ['Cy', 'Fay', 'Gus']) expect(at(name), name).toBeGreaterThan(-1);
    for (const name of ['Hal', 'Ivy', 'Jo', 'Kim', 'Ade', 'Bo', 'Tan']) expect(at(name), name).toBe(-1);
    // each with its line; the one who spent most first, then the most recent
    expect(b).toMatch(/Cy<\/bdi><\/span><span class="ar-line">Regular, no order since /);
    expect(b).toMatch(/Fay<\/bdi><\/span><span class="ar-line">Price sent [^<]+, no word since/);
    expect(b).toMatch(/Gus<\/bdi><\/span><span class="ar-line">Question sent [^<]+, no answer yet/);
    expect(at('Cy')).toBeLessThan(at('Fay'));
    expect(at('Fay')).toBeLessThan(at('Gus'));
    // the same in the other lens; never on a search, a narrowing, or a later page
    expect(band((await get('/app/inbox?lens=value')).body)).toContain(`/app/inbox/${conv['Fay']}#latest`);
    expect(band((await get('/app/inbox?q=Fay')).body)).toBe('');
    expect(band((await get('/app/inbox?filter=pending')).body)).toBe('');
  });

  it('a search keeps the lens, and "Mine"\'s old address leads to the list, keeping the lens and the search', async () => {
    const r = await get('/app/inbox?lens=value&q=Bo');
    expect(listed(r.body)).toEqual([conv['Bo']]);
    expect(r.body).toContain('<a class="tab on" aria-current="true" href="/app/inbox?lens=value&amp;q=Bo">');
    expect(r.body).toContain('<input type="hidden" name="lens" value="value" />');
    const mine = await get('/app/inbox?filter=mine');
    expect(mine.statusCode).toBe(302);
    expect(mine.headers['location']).toBe('/app/inbox');
    const kept = await get('/app/inbox?filter=mine&lens=value&q=Bo');
    expect(kept.headers['location']).toBe('/app/inbox?lens=value&q=Bo');
  });
});
