import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { withoutIsolates, unisolatedFigures } from '../parity/isolates.js';

/**
 * A — Buyers and Customers are one list (2026-09-28). Over Postgres and the
 * owner's own routes:
 *
 *   - past one page of buyers, everyone who needs the owner is on the FIRST
 *     page, whenever they last wrote — the three ways a buyer needs her
 *     (waiting for a person, a reply waiting for review, a conversation a
 *     person here holds), each timed to lose on every other sort key;
 *   - paging forward and back by the page's own doors shows every buyer once
 *     and nobody twice, and a cursor that names nothing is the first page;
 *   - the search finds by name (and by number, and by product), in this
 *     workspace only;
 *   - `/app/conversations` answers with the one list, the search carried; a
 *     stranger is sent to sign in; `/app/conversations/<id>` is still the
 *     buyer's page, lit as Buyers, one door from the conversation.
 *
 * The page, by structure and in three languages: tests/parity/buyers-merge.test.ts.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `b0e10000-0000-4000-8000-${RUN}0001`;
const OTHER = `b0e10000-0000-4000-8000-${RUN}0002`;
const PROD = `b0e10000-0000-4000-8000-${RUN}0003`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
/** Comfortably past one page (50), not two. */
const NOISE = 58;

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('A · Buyers is one list: searched, paged, nobody left behind (requires DATABASE_URL)', () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let cookie = '';
  const needs: Record<'waiting' | 'review' | 'held', string> = { waiting: '', review: '', held: '' };
  const everyone: string[] = [];
  let zhang = '';
  let dubai = '';
  let bag = '';

  const as = async <R>(biz: string, fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const get = (url: string, extra = '') => app.inject({ method: 'GET', url, headers: { cookie: `${cookie}${extra}` } });

  /** One buyer and their conversation, with messages from `wrote` minutes ago on. */
  const buyer = async (x: Tx, biz: string, name: string, o: {
    readonly wrote: number; readonly last: 'inbound' | 'outbound'; readonly phone?: string;
    readonly assigned?: string; readonly channel?: string; readonly product?: string;
  }): Promise<string> => {
    const client = (await sql<{ id: string }>`
      insert into clients (business_id, display_name, phone)
      values (${biz}, ${name}, ${o.phone ?? null}) returning id::text as id`.execute(x)).rows[0]!.id;
    const conv = (await sql<{ id: string }>`
      insert into conversations (business_id, client_id, channel, phase, is_active, assigned_to)
      values (${biz}, ${client}::uuid, ${o.channel ?? 'whatsapp'}, 'warm_intake', true, ${o.assigned ?? null})
      returning id::text as id`.execute(x)).rows[0]!.id;
    await sql`insert into messages (conversation_id, direction, text_content, sent_at)
              values (${conv}::uuid, 'inbound', ${`hello from ${name}`}, now() - make_interval(mins => ${o.wrote + 1}))`.execute(x);
    if (o.last === 'outbound') {
      await sql`insert into messages (conversation_id, direction, text_content, sent_at)
                values (${conv}::uuid, 'outbound', ${`answered ${name}`}, now() - make_interval(mins => ${o.wrote}))`.execute(x);
    }
    if (o.product) {
      await sql`insert into conversation_state (conversation_id, identified_product_id)
                values (${conv}::uuid, ${o.product}::uuid)`.execute(x);
    }
    return conv;
  };

  /** The conversations a Buyers page lists, in page order. */
  const listed = (html: string): string[] =>
    [...html.matchAll(/<a class="crow[^"]*" href="\/app\/inbox\/([0-9a-f-]{36})#latest">/g)].map((m) => m[1]!);
  /** Where a pager door goes, as the browser would follow it. */
  const door = (html: string, cls: 'deeper' | 'back'): string | null => {
    const pager = /<nav class="pager"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
    const href = new RegExp(`<a class="${cls}" href="([^"]+)">`).exec(pager)?.[1];
    return href ? href.replace(/&amp;/g, '&') : null;
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    for (const [id, name] of [[BIZ, 'Merged Buyers Co'], [OTHER, 'Another Buyers Co']] as const) {
      await as(id, (x) => sql`insert into businesses (id, name, owner_locale) values (${id}, ${name}, 'en')
                              on conflict (id) do nothing`.execute(x));
    }
    await as(BIZ, async (x) => {
      await sql`insert into products (id, business_id, sku, name, name_zh, unit, moq, is_active)
                values (${PROD}, ${BIZ}, ${`BM-${RUN}`}, ${`Harbour tote ${RUN}`}, '海港帆布袋', 'pcs', 100, true)`.execute(x);
      // The three who need the owner, each OLDER than every other buyer and
      // each on a different rule. The one a person here holds is A9's sharp
      // case: not the waiting sentinel, no draft, and answered last — every
      // key but "needs you" puts it at the very end.
      needs.waiting = await buyer(x, BIZ, 'Waiting Buyer', { wrote: 60 * 24 * 40, last: 'inbound', assigned: 'unclaimed' });
      needs.review = await buyer(x, BIZ, 'Review Buyer', { wrote: 60 * 24 * 39, last: 'inbound' });
      await sql`insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
                values (${BIZ}, ${needs.review}::uuid, 'quote', 'A reply waiting for review.', null, 'pending')`.execute(x);
      needs.held = await buyer(x, BIZ, 'Held Buyer', { wrote: 60 * 24 * 38, last: 'outbound', assigned: 'owner' });
      // Everyone else: the assistant's, newer, half of them still waiting for an answer.
      zhang = await buyer(x, BIZ, 'Zhang Wei', { wrote: 3, last: 'inbound', channel: 'instagram' });
      dubai = await buyer(x, BIZ, 'Omar Haddad', { wrote: 4, last: 'outbound', phone: '+971501234567' });
      bag = await buyer(x, BIZ, 'Lena Brandt', { wrote: 5, last: 'outbound', product: PROD });
      const noise: string[] = [];
      for (let i = 0; i < NOISE - 3; i++) {
        noise.push(await buyer(x, BIZ, `Noise ${String(i).padStart(2, '0')}`, { wrote: 10 + i, last: i % 2 ? 'inbound' : 'outbound' }));
      }
      everyone.push(needs.waiting, needs.review, needs.held, zhang, dubai, bag, ...noise);
    });
    // Another workspace with a buyer of the same name: a search never crosses over.
    await as(OTHER, (x) => buyer(x, OTHER, 'Zhang Wei', { wrote: 1, last: 'inbound' }));

    app = Fastify({ logger: false });
    const code = `merged-${RUN}`;
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

  it('the fixture really is past one page', async () => {
    const { BUYERS_PAGE } = await import('../../src/db/buyersList.js');
    expect(everyone.length).toBe(NOISE + 3);
    expect(everyone.length).toBeGreaterThan(BUYERS_PAGE);
    expect(everyone.length).toBeLessThanOrEqual(2 * BUYERS_PAGE);
  });

  it('everyone who needs the owner is on the FIRST page of All, ahead of everyone who does not', async () => {
    const r = await get('/app/inbox?filter=all');
    expect(r.statusCode).toBe(200);
    const ids = listed(r.body);
    expect(ids).toHaveLength(50);
    expect(ids.slice(0, 3).sort()).toEqual([needs.waiting, needs.review, needs.held].sort());
    // the order is the groups': waiting for a person, a reply to review, a person here holds it
    expect(ids.indexOf(needs.waiting)).toBeLessThan(ids.indexOf(needs.review));
    expect(ids.indexOf(needs.review)).toBeLessThan(ids.indexOf(needs.held));
    // …and the counts are of everything, not of the page
    expect(r.body).toContain('Needs you (3)</a>');
    expect(r.body).toContain('1–50 of 61');
  });

  it('…and Needs you opens by itself, holds exactly those three, and needs no second page', async () => {
    const r = await get('/app/inbox');
    expect(r.body).toContain('<a class="tab on" aria-current="page" href="/app/inbox?filter=pending">');
    expect(listed(r.body).sort()).toEqual([needs.waiting, needs.review, needs.held].sort());
    expect(r.body).not.toContain('class="pager"');
  });

  it('paging forward and back by the page\'s own doors: every buyer once, nobody twice', async () => {
    const first = await get('/app/inbox?filter=all');
    const one = listed(first.body);
    expect(door(first.body, 'back')).toBeNull();
    const next = door(first.body, 'deeper');
    expect(next).toMatch(/^\/app\/inbox\?filter=all&after=[0-7]_(n|-?\d+)_[0-9a-f-]{36}$/);

    const second = await get(next!);
    expect(second.statusCode).toBe(200);
    const two = listed(second.body);
    expect(two).toHaveLength(everyone.length - 50);
    expect(second.body).toContain(`51–${everyone.length} of ${everyone.length}`);
    expect(door(second.body, 'deeper'), 'the last page has no Next').toBeNull();
    expect([...one, ...two].sort()).toEqual([...everyone].sort());
    expect(new Set([...one, ...two]).size).toBe(everyone.length);

    // Back: the page before the second is the first, at its own address.
    const prev = door(second.body, 'back');
    expect(prev).toBe('/app/inbox?filter=all');
    expect(listed((await get(prev!)).body)).toEqual(one);
  });

  it('a page further in is paged back by cursor, and still loses nobody', async () => {
    const { readBuyersPage } = await import('../../src/db/buyersList.js');
    // Pages of 20 over the same list: forward to the end, then back to the start.
    const size = 20;
    const forward: string[][] = [];
    let after: string | null = null;
    let prev: { cursor: string | null } | null = null;
    do {
      const p = await as(BIZ, (x) => readBuyersPage(x, { filter: 'all', q: '', after, size }));
      forward.push([...p.ids]);
      after = p.next;
      prev = p.prev;
    } while (after);
    expect(forward.map((p) => p.length)).toEqual([20, 20, 20, 1]);
    expect(forward.flat().sort()).toEqual([...everyone].sort());
    // back from the last page, one page at a time, by the cursors it hands out
    const backward: string[][] = [forward.at(-1)!];
    while (prev) {
      const at: { cursor: string | null } = prev;
      const p = await as(BIZ, (x) => readBuyersPage(x, { filter: 'all', q: '', ...(at.cursor ? { before: at.cursor } : {}), size }));
      backward.unshift([...p.ids]);
      prev = p.prev;
    }
    expect(backward).toEqual(forward);
  });

  it('a cursor that names no place is the first page — never an error, never an empty page', async () => {
    const first = listed((await get('/app/inbox?filter=all')).body);
    for (const bad of ['nonsense', '9_1_x', `6_1_${randomUUID()}`, `0_n_${randomUUID()}`]) {
      for (const dir of ['after', 'before']) {
        const r = await get(`/app/inbox?filter=all&${dir}=${bad}`);
        expect(r.statusCode, `${dir}=${bad}`).toBe(200);
        expect(listed(r.body).length, `${dir}=${bad}`).toBeGreaterThan(0);
      }
    }
    // a cursor past the end of the list (the lowest possible place) comes back to the first page
    const r = await get(`/app/inbox?filter=all&after=7_n_00000000-0000-4000-8000-000000000000`);
    expect(listed(r.body)).toEqual(first);
  });

  it('the search finds a buyer by name — in this workspace only, and across every tab', async () => {
    const r = await get('/app/inbox?q=zhang');
    expect(r.statusCode).toBe(200);
    expect(listed(r.body)).toEqual([zhang]);
    expect(r.body).toContain('1 found for “zhang”');
    expect(r.body).toContain('value="zhang"');
    // a search with no tab looks at everyone, though buyers are waiting on Needs you
    expect(r.body).toContain('<a class="tab on" aria-current="page" href="/app/inbox?filter=all">');
    // the other workspace's Zhang Wei is not here: one row, and it is this workspace's
    expect(r.body.match(/<b><bdi>Zhang Wei<\/bdi><\/b>/g)?.length).toBe(1);
  });

  it('…and by number, however it is typed, and by the product asked about', async () => {
    expect(listed((await get(`/app/inbox?q=${encodeURIComponent('+971 50 123 4567')}`)).body)).toEqual([dubai]);
    expect(listed((await get('/app/inbox?q=501234')).body)).toEqual([dubai]);
    expect(listed((await get(`/app/inbox?q=${encodeURIComponent(`harbour tote ${RUN}`)}`)).body)).toEqual([bag]);
    expect(listed((await get(`/app/inbox?q=${encodeURIComponent('海港')}`)).body)).toEqual([bag]);
  });

  it('a search that finds nobody says so, and a LIKE wildcard is a character, not a wildcard', async () => {
    for (const q of ['nobody-by-this-name', '%', '_']) {
      const r = await get(`/app/inbox?q=${encodeURIComponent(q)}`);
      expect(r.statusCode, q).toBe(200);
      expect(listed(r.body), q).toEqual([]);
      expect(r.body, q).toContain('Nobody found for');
    }
  });

  it('the search pages too, and its doors carry it', async () => {
    const r = await get('/app/inbox?q=noise');
    expect(listed(r.body)).toHaveLength(50);
    const next = door(r.body, 'deeper');
    expect(next).toMatch(/^\/app\/inbox\?filter=all&q=noise&after=/);
    const two = listed((await get(next!)).body);
    expect(two).toHaveLength(NOISE - 3 - 50);
    expect(new Set([...listed(r.body), ...two]).size).toBe(NOISE - 3);
  });

  it('/app/conversations answers with the one list, the search carried; a stranger is sent to sign in', async () => {
    const all = await get('/app/conversations');
    expect(all.statusCode).toBe(302);
    expect(all.headers['location']).toBe('/app/inbox?filter=all');
    const q = await get('/app/conversations?q=Zhang');
    expect(q.headers['location']).toBe('/app/inbox?q=Zhang');
    const zh = await get(`/app/conversations?q=${encodeURIComponent('张三')}`);
    expect(zh.headers['location']).toBe(`/app/inbox?q=${encodeURIComponent('张三')}`);
    expect(listed((await get(String(q.headers['location']))).body)).toEqual([zhang]);
    const stranger = await app.inject({ method: 'GET', url: '/app/conversations' });
    expect(stranger.statusCode).toBe(302);
    expect(stranger.headers['location']).toBe('/login');
  });

  it('/app/conversations/<id> is still the buyer\'s page, lit as Buyers, one door from the conversation', async () => {
    const page = await get(`/app/conversations/${zhang}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Zhang Wei');
    expect(page.body).toContain('About this customer');
    expect(page.body).toContain('<a class="back" href="/app/inbox">');
    expect(page.body).toMatch(/href="\/app\/inbox" class="navlink active" aria-current="page"/);
    const conversation = await get(`/app/inbox/${zhang}`);
    expect(conversation.body).toContain(`href="/app/conversations/${zhang}"`);
    const missing = await get(`/app/conversations/${randomUUID()}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toContain('Customer not found');
  });

  it('the row carries what Customers did: the channel, who wrote last, the last contact', async () => {
    const { formatShortWhen } = await import('../../src/core/owner/i18n/format.js');
    // The last contact as the business's clock says it: minutes ago is
    // "Yesterday" in the first minutes after its midnight (CI hit 00:01
    // Shanghai on 2026-09-30), so the words are the formatter's for the row's
    // own instant, never a fixed "Today".
    const lastContact = async (conv: string) => formatShortWhen('en', await as(BIZ, (x) => sql<{ at: Date }>`
      select max(sent_at) as at from messages where conversation_id = ${conv}::uuid`.execute(x).then((q) => q.rows[0]!.at)), new Date(), 'Asia/Shanghai');
    const r = await get('/app/inbox?q=zhang');
    const row = /<a class="crow is-\w+ unanswered" href="\/app\/inbox\/[0-9a-f-]{36}#latest">([\s\S]*?)<\/a>/.exec(r.body)?.[1] ?? '';
    expect(row, 'Zhang wrote last and is still waiting').not.toBe('');
    // UI-PASS 5: the row is the customer's name already; who wrote last is said only when it is not them.
    // Phase 1 — the time in its fixed place at the end of the first line, the channel before it.
    expect(row).toContain(`<span class="cr-when">Instagram · ${await lastContact(zhang)}</span>`);
    const omar = /<a class="crow is-\w+" href="\/app\/inbox\/[0-9a-f-]{36}#latest">([\s\S]*?)<\/a>/.exec((await get('/app/inbox?q=Omar')).body)?.[1] ?? '';
    expect(omar).toContain(`<span class="cr-when">WhatsApp · ${await lastContact(dubai)}</span>`);
    // the assistant wrote last: its mark is on the row (as the holder's mark, or before the message)
    expect(omar).toContain('✦');
  });

  it('in Arabic the list is right to left, and says where the page sits in its own words', async () => {
    const r = await get('/app/inbox?filter=all', '; yf_locale=ar');
    expect(r.body).toContain('<html lang="ar" dir="rtl"');
    // Each figure isolated (the design pass §9); the words, read without the marks.
    expect(withoutIsolates(r.body)).toContain('1 إلى 50 من 61');
    expect(unisolatedFigures(r.body.slice(r.body.indexOf('<main')))).toEqual([]);
    expect(listed(r.body).slice(0, 3).sort()).toEqual([needs.waiting, needs.review, needs.held].sort());
  });
});
