import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { buttonsAndDoors } from '../parity/buttons-and-doors.js';
import { unisolatedFigures, withoutIsolates } from '../parity/isolates.js';
import { sheetLinks } from '../parity/linked-css.js';

/**
 * THE INBOX IN THE SPLIT LOOK, over Postgres and the owner's routes (the owner, 2026-11-05).
 *
 *   - the flag off, the Inbox is what it was;
 *   - each view holds exactly its customers, and its count says how many;
 *   - the stage filter and the search narrow the real rows, and the rows that need the owner come first;
 *   - stage and figure are read from rows: a price worked out and never given is not "Price given";
 *   - opening a conversation takes its bold away; another workspace's customers never show.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `5b1b0000-0000-4000-8000-${RUN}0001`;
const OTHER = `5b1b0000-0000-4000-8000-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const CODE = `inbox-${RUN}`;

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('the Inbox in the Split look (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let plain: import('fastify').FastifyInstance;
  let cookie = '';
  let plainCookie = '';
  const conv: Record<string, string> = {};

  const tx = async <R>(biz: string, fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const compose = async (splitToday: boolean) => {
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const f = Fastify({ logger: false });
    registerWebApp(f, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: true, splitToday, kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await f.ready();
    return f;
  };
  const login = async (f: import('fastify').FastifyInstance) =>
    String((await f.inject({ method: 'POST', url: '/login', payload: `code=${CODE}`, headers: FORM })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const get = async (url: string, locale?: string, who = cookie, f = app) =>
    (await f.inject({ method: 'GET', url, headers: { cookie: locale ? `${who}; yf_locale=${locale}` : who } })).body;
  // A find marks the words it found inside the name; the name is still the name.
  const names = (html: string): string[] => [...withoutIsolates(html).replace(/<\/?mark[^>]*>/g, '').matchAll(/<bdi class="sp-rname">([^<]+)</g)].map((m) => m[1]!);
  const counts = (html: string): string[] => [...withoutIsolates(html.split('<nav class="si-tabs"')[1]!.split('</nav>')[0]!).matchAll(/<span class="si-tabn">([^<]+)</g)].map((m) => m[1]!);

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    db = createDb(DATABASE_URL!);
    await tx(BIZ, (x) => sql`insert into businesses (id, name, owner_locale, timezone, currency, kind) values (${BIZ}, 'Inbox Shop', 'en', 'UTC', 'USD', 'online_shop')`.execute(x));
    await tx(OTHER, (x) => sql`insert into businesses (id, name, owner_locale, timezone, currency) values (${OTHER}, 'Other Shop', 'en', 'UTC', 'USD')`.execute(x));
    await tx(OTHER, async (x) => {
      const b = parseBusinessId(OTHER); if (!b.ok) throw new Error('fixture');
      const o = await ensureConversation(x, b.value, `ig-other-${RUN}`, 'Someone Else', 'instagram');
      await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at) values (${o.conversationId}::uuid, ${`o-${RUN}`}, 'inbound', 'text', 'hi', now())`.execute(x);
    });
    await tx(BIZ, async (x) => {
      const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
      const product = (await sql<{ id: string }>`insert into products (business_id, sku, name, unit, is_active) values (${BIZ}, ${`S-${RUN}`}, 'Rose Serum', 'item', true) returning id::text as id`.execute(x)).rows[0]!.id;
      const person = async (key: string, name: string, ago: string, assigned: string | null, text = 'Hello there') => {
        const c = await ensureConversation(x, b.value, `ig-${key}-${RUN}`, name, 'instagram');
        conv[key] = c.conversationId;
        await sql`update conversations set assigned_to = ${assigned} where id = ${c.conversationId}::uuid`.execute(x);
        await sql`update conversation_state set identified_product_id = ${product}::uuid where conversation_id = ${c.conversationId}::uuid`.execute(x);
        await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
                  values (${c.conversationId}::uuid, ${`m-${key}-${RUN}`}, 'inbound', 'text', ${text}, now() - ${ago}::interval)`.execute(x);
        return c;
      };
      // Needs the owner: waiting for a person, and a reply to review.
      await person('wait', 'Hana Waiting', '2 hours', 'unclaimed');
      await person('draft', 'Dana Draft', '3 hours', null);
      await sql`insert into drafts (business_id, conversation_id, capability, draft_text, status) values (${BIZ}, ${conv['draft']}, 'greet', 'Hello!', 'pending')`.execute(x);
      // With a person here.
      await person('held', 'Tariq Team', '4 hours', 'owner');
      // With the assistant: one at each stage the rows prove. "Price given" needs a line left after it.
      await person('asked', 'Asma Asked', '5 hours', null);
      const given = await person('price', 'Priya Price', '6 hours', null);
      await sql`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, discount_pct, total_usd, requires_human, applied_rules, engine_version, created_at)
                values (${BIZ}, ${given.conversationId}::uuid, ${product}::uuid, 3, '{}'::jsonb, 13, 0, 39, false, '{}', 'inbox-test', now() - interval '5 hours 45 minutes')`.execute(x);
      await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
                values (${given.conversationId}::uuid, ${`out-p-${RUN}`}, 'outbound', 'text', 'That is $39.', now() - interval '5 hours 30 minutes')`.execute(x);
      // A price worked out that never left: still "Asked", and no figure.
      const held = await person('notgiven', 'Nadia Notgiven', '7 hours', null);
      await sql`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, discount_pct, total_usd, requires_human, applied_rules, engine_version, created_at)
                values (${BIZ}, ${held.conversationId}::uuid, ${product}::uuid, 3, '{}'::jsonb, 99, 0, 297, false, '{}', 'inbox-test', now() - interval '6 hours')`.execute(x);
      const bought = await person('order', 'Omar Order', '8 hours', null);
      await sql`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, total_value_usd, currency, status, confirmed_at)
                values (${`R-${RUN}`}, ${BIZ}, ${bought.clientId}::uuid, ${bought.conversationId}::uuid, ${product}::uuid, 10, 'item', 450, 'USD', 'confirmed', now())`.execute(x);
      // Closed: the assistant holds nothing of it, so only Everyone lists it.
      await person('closed', 'Cara Closed', '9 hours', null);
      await sql`update conversations set is_active = false, closed_at = now() where id = ${conv['closed']}::uuid`.execute(x);
      // Went quiet: our question, unanswered for five days.
      await person('quiet', 'Quentin Quiet', '6 days', null);
      await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
                values (${conv['quiet']}::uuid, ${`out-q-${RUN}`}, 'outbound', 'text', 'Which colour would you like?', now() - interval '5 days')`.execute(x);
    });
    app = await compose(true);
    plain = await compose(false);
    cookie = await login(app);
    plainCookie = await login(plain);
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await plain?.close(); await db?.destroy(); });

  it('the flag off: the Inbox is what it was, and a view it does not know is the whole list', async () => {
    const html = await get('/app/inbox', undefined, plainCookie, plain);
    expect(html).toContain('<h1 class="page">Inbox</h1>');
    expect(html).toContain('class="irow');
    expect(html).toContain('class="owner-shell"');
    expect(html).not.toContain('class="owner-shell split"');
    expect(html).not.toContain('si-tabs');
    // Both renderers share the approved theme; the Inbox layout itself still obeys its flag.
    expect(sheetLinks(html).some((h) => h.includes('/split.'))).toBe(true);
    const quiet = await get('/app/inbox?filter=quiet', undefined, plainCookie, plain);
    expect(quiet).toContain('Omar Order');
  });

  it('the flag on: the Split rail, the paper, the sheet, the word Inbox', async () => {
    const html = await get('/app/inbox');
    expect(html).toContain('class="owner-shell split"');
    expect(sheetLinks(html).some((h) => h.includes('/split.'))).toBe(true);
    expect(html).toContain('<h1 class="page">Inbox</h1>');
    expect(html).toMatch(/data-nav="inbox"[^>]*aria-current="page"/);
    expect(html).not.toContain('class="setup-strip"');
    expect(html).toContain('data-nav="customers"');
    expect(html).toContain('data-nav="more"');
  });

  it('it opens on who needs the owner while someone does', async () => {
    const html = await get('/app/inbox');
    expect(html).toMatch(/class="si-tab on" aria-current="true" href="\/app\/inbox\?filter=pending"/);
    expect(names(html)).toEqual(expect.arrayContaining(['Hana Waiting', 'Dana Draft']));
    expect(names(html)).not.toContain('Asma Asked');
  });

  it('each view holds exactly its customers, and its count says so', async () => {
    const need = names(await get('/app/inbox?filter=pending')).sort();
    const quiet = names(await get('/app/inbox?filter=quiet')).sort();
    const asst = names(await get('/app/inbox?filter=assistant')).sort();
    const team = names(await get('/app/inbox?filter=team')).sort();
    const all = await get('/app/inbox?filter=all');
    // The owner's own held conversation is on "Needs you", as the rail counts it, and on "With your team".
    expect(need).toEqual(['Dana Draft', 'Hana Waiting', 'Tariq Team']);
    expect(quiet).toEqual(['Quentin Quiet']);
    expect(asst).toEqual(['Asma Asked', 'Nadia Notgiven', 'Omar Order', 'Priya Price', 'Quentin Quiet']);
    expect(team).toEqual(['Tariq Team']);
    expect(names(all)).toHaveLength(9);
    expect(counts(all)).toEqual(['3', '1', '5', '1', '9']);
  });

  it('Everyone: the rows that need the owner first, a dot on each, the others plain', async () => {
    const html = await get('/app/inbox?filter=all');
    const list = names(html);
    expect(list.slice(0, 2).sort()).toEqual(['Dana Draft', 'Hana Waiting']);
    const rows = html.split('<div class="sp-row si-row').slice(1);
    expect(rows.filter((r) => r.includes('class="row-dot"'))).toHaveLength(2);
    expect(rows[0]).toMatch(/^ is-needs is-new"/);
  });

  it('opening a conversation takes its bold away; its dot stays while it still needs the owner', async () => {
    await get(`/app/inbox/${conv['wait']}`);
    const rows = (await get('/app/inbox?filter=all')).split('<div class="sp-row si-row').slice(1);
    const row = rows.find((r) => r.includes('Hana Waiting'))!;
    expect(row).toMatch(/^ is-needs"/);
    expect(row).toContain('class="row-dot"');
  });

  it('stage and figure come from the rows; a price that never left is not a price given', async () => {
    const html = withoutIsolates(await get('/app/inbox?filter=all'));
    const rowOf = (name: string) => html.split('<div class="sp-row si-row').slice(1).find((r) => r.includes(name))!;
    expect(rowOf('Priya Price')).toContain('>Price given<');
    // The last message is the newest line of each, whoever wrote it.
    expect(rowOf('Priya Price')).toContain('<bdi class="si-last">That is $39.</bdi>');
    expect(rowOf('Priya Price')).toContain('class="si-by"');
    expect(rowOf('Asma Asked')).toContain('<bdi class="si-last">Hello there</bdi>');
    expect(rowOf('Asma Asked')).not.toContain('class="si-by"');
    expect(rowOf('Priya Price')).toContain('$39');
    expect(rowOf('Omar Order')).toContain('>Order<');
    expect(rowOf('Omar Order')).toContain('$450');
    expect(rowOf('Nadia Notgiven')).toContain('>Asked<');
    expect(rowOf('Nadia Notgiven')).not.toContain('$297');
    expect(rowOf('Asma Asked')).toContain('<span class="sp-rval"></span>');
  });

  it('the stage filter narrows the real rows, in the view it was asked in', async () => {
    expect(names(await get('/app/inbox?filter=all&stage=order'))).toEqual(['Omar Order']);
    expect(names(await get('/app/inbox?filter=all&stage=price'))).toEqual(['Priya Price']);
    expect(names(await get('/app/inbox?filter=pending&stage=order'))).toEqual([]);
    // An address that names no stage is no filter.
    expect(names(await get('/app/inbox?filter=all&stage=nonsense'))).toHaveLength(9);
  });

  it('a sample is not offered to a shop that has none', async () => {
    expect(await get('/app/inbox?filter=all')).not.toContain('stage=sample');
  });

  it('a find looks across everyone, by name and by product, and never reaches another workspace', async () => {
    expect(names(await get('/app/inbox?q=Priya'))).toEqual(['Priya Price']);
    expect(names(await get('/app/inbox?filter=all&q=Rose'))).toHaveLength(9);
    expect(names(await get('/app/inbox?filter=all&q=Someone'))).toEqual([]);
    expect(await get('/app/inbox?filter=all')).not.toContain('Someone Else');
  });

  it('"Matters most" still orders by what they spent, and shows it', async () => {
    const html = await get('/app/inbox?filter=all&lens=value');
    expect(names(html)[0]).toBe('Omar Order');
    expect(html).toMatch(/class="si-fil on" aria-current="true" href="\/app\/inbox\?filter=all&amp;lens=value"/);
  });

  it('a deletion request stays findable and leads', async () => {
    await tx(BIZ, async (x) => {
      const client = (await sql<{ client_id: string }>`select client_id::text as client_id from conversations where id = ${conv['asked']}::uuid`.execute(x)).rows[0]!.client_id;
      const msg = (await sql<{ id: string }>`select id::text as id from messages where conversation_id = ${conv['asked']}::uuid limit 1`.execute(x)).rows[0]!.id;
      await sql`insert into deletion_asks (business_id, client_id, conversation_id, message_id, asked_at) values (${BIZ}, ${client}::uuid, ${conv['asked']}::uuid, ${msg}::uuid, now())`.execute(x);
    });
    const html = withoutIsolates(await get('/app/inbox?filter=all'));
    expect(html).toContain('filter=deletion');
    expect(names(html)[0]).toBe('Asma Asked');
    expect(names(await get('/app/inbox?filter=deletion'))).toEqual(['Asma Asked']);
  });

  it('in Arabic: right to left, every figure isolated, buttons do things and doors go places', async () => {
    for (const url of ['/app/inbox?filter=all', '/app/inbox?filter=quiet', '/app/inbox?filter=all&lens=value']) {
      const html = await get(url, 'ar');
      expect(html).toContain('dir="rtl"');
      expect(unisolatedFigures(html), url).toEqual([]);
      expect(buttonsAndDoors(html), url).toEqual([]);
    }
  });

  it('no raw catalogue key on the page, in any language', async () => {
    for (const l of ['en', 'zh', 'ar', 'es', 'fr']) {
      const body = (await get('/app/inbox?filter=all', l)).split('<main')[1]!;
      expect(body, l).not.toMatch(/>\s*(?:inbox|buyers|split)\.[a-zA-Z.]+\s*</);
    }
  });
});
