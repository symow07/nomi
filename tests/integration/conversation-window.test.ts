import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * CC-25 — the conversation page always shows the newest messages (2026-09-27).
 *
 * The audit: "The conversation page puts the draft and take-over cards above
 * the transcript, and shows the oldest messages first — so she approves a
 * reply with the buyer's question off-screen." Worse, the page read
 * `order by sent_at asc limit 200`: past two hundred messages the newest were
 * not on it at all. The owner's decision: the page always shows the newest.
 *
 * Over Postgres and the owner's routes, on a thread of 450 messages:
 *
 *   - the page opens on the newest fifty, the newest at the bottom, marked
 *     `latest`, and the reply waiting for approval directly under it;
 *   - "Earlier messages", followed to the end, visits every message exactly
 *     once and in order — across two messages stamped with the same instant
 *     (the id breaks the tie) and across two stamped inside one millisecond
 *     (the window is bounded by the row's own stamp, not the cursor's
 *     milliseconds);
 *   - a malformed, stale or foreign cursor is the newest window;
 *   - another business's conversation is not found, cursor or not;
 *   - Arabic renders right-to-left, doors included;
 *   - a short conversation has no door at all;
 *   - the buyer file's history is the recent part, with a door to the whole.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `cc250000-0000-4000-8000-${RUN}0001`;
const OTHER = `cc250000-0000-4000-8000-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
/** The long thread's message ids sort with their number, so the tie below has one order. */
const ID_PREFIX = `cc25${RUN.slice(0, 4)}-${RUN.slice(4, 8)}-4000-8000-`;
const TOTAL = 450;
const ALL = Array.from({ length: TOTAL }, (_, i) => `m-${String(i + 1).padStart(3, '0')}`);

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('CC-25 · the conversation page always shows the newest messages (requires DATABASE_URL)', () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let cookie = '';
  let long = '';      // 450 messages and a reply waiting
  let short = '';     // three messages
  let foreign = '';   // another business's conversation
  /** A cursor naming a message of ANOTHER conversation, with that message's real stamp. */
  let shortCursor = '';
  let foreignCursor = '';

  const tx = async <R>(biz: string, fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const get = (url: string, locale = 'en') =>
    app.inject({ method: 'GET', url, headers: { cookie: `${cookie}; yf_locale=${locale}` } });
  const page = async (url: string, locale = 'en'): Promise<string> => {
    const r = await get(url, locale);
    expect(r.statusCode, url).toBe(200);
    return r.body;
  };
  /** The transcript's words, in the order the page prints them. */
  // The transcript's bubbles only: the approval card quotes the newest question again (the design pass).
  const said = (html: string) => [...html.matchAll(/class="bubble(?: by-as)?"><bdi>(m-\d{3})<\/bdi>/g)].map((m) => m[1]!);
  /** Where "Earlier messages" goes, without the fragment the browser keeps to itself. */
  const earlierOf = (html: string, conv: string) =>
    new RegExp(`href="(/app/inbox/${conv}\\?before=[^"#]+)#latest"`).exec(html)?.[1] ?? null;
  /**
   * The transcript's "Latest messages" door. CC-26 — the live line's door goes to
   * the same address (inert in its template until something new arrives), and it
   * wears its own class (`deeper live-door`), so this names the transcript's alone.
   */
  const latestDoor = (conv: string) => `<a class="deeper" href="/app/inbox/${conv}#latest"`;
  /** The message `id="latest"` sits on. */
  const markedLatest = (html: string) => /id="latest" class="msg (?:inbound|outbound)">\s*(?:<div class="msg-by">.*?<\/div>\s*)?<div dir="auto" class="bubble(?: by-as)?"><bdi>(m-\d{3})<\/bdi>/.exec(html)?.[1] ?? null;
  /** The cursor the page hands out for the window before this one. */
  const cursorOf = (html: string, conv: string) => /before=([^"#&]+)/.exec(earlierOf(html, conv) ?? '')?.[1] ?? '';
  /** What the owner reads and taps — the page without its stylesheets, whose `width:100%` is layout. */
  const shown = (html: string) => html.slice(html.indexOf('<body')).replace(/<style>[\s\S]*?<\/style>/g, '');

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    for (const [biz, name] of [[BIZ, 'Window Works'], [OTHER, 'Someone Else']] as const) {
      await tx(biz, (x) => sql`insert into businesses (id, name, owner_locale) values (${biz}, ${name}, 'en')
                               on conflict (id) do nothing`.execute(x));
    }
    await tx(BIZ, async (x) => {
      const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
      long = (await ensureConversation(x, b.value, `ig-cc25-long-${RUN}`, 'Long Thread', 'instagram')).conversationId;
      short = (await ensureConversation(x, b.value, `ig-cc25-short-${RUN}`, 'Short Thread', 'instagram')).conversationId;
      await sql`update conversations set assigned_to = null where id in (${long}::uuid, ${short}::uuid)`.execute(x);
      // 450 messages, alternating buyer and reply, a minute apart — except:
      //   m-400 and m-401 carry the SAME instant (the first window's edge);
      //   m-350 and m-351 sit inside ONE millisecond, 500 µs apart (the second's).
      await sql`
        insert into messages (id, conversation_id, direction, input_type, text_content, sent_at)
        select (${ID_PREFIX} || lpad(to_hex(i), 12, '0'))::uuid, ${long}::uuid,
               case when i % 2 = 1 then 'inbound' else 'outbound' end, 'text',
               'm-' || lpad(i::text, 3, '0'),
               case when i = 401 then timestamptz '2026-08-01 00:00:00.000321+00' + 400 * interval '1 minute'
                    when i = 351 then timestamptz '2026-08-01 00:00:00.000821+00' + 350 * interval '1 minute'
                    else timestamptz '2026-08-01 00:00:00.000321+00' + i * interval '1 minute' end
          from generate_series(1, ${TOTAL}::int) as i`.execute(x);
      await sql`
        insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
        values (${BIZ}, ${long}, 'quote', 'We can do 500 pcs at 2.40 each.', null, 'pending')`.execute(x);
      const s1 = (await sql<{ id: string; sent_at: Date }>`
        insert into messages (conversation_id, direction, input_type, text_content, sent_at)
        select ${short}::uuid, case when i % 2 = 1 then 'inbound' else 'outbound' end, 'text',
               's-' || i, now() - (4 - i) * interval '1 minute'
          from generate_series(1, 3) as i
        returning id::text as id, sent_at`.execute(x)).rows[0]!;
      shortCursor = `${s1.sent_at.getTime()}_${s1.id}`;
    });
    await tx(OTHER, async (x) => {
      const b = parseBusinessId(OTHER); if (!b.ok) throw new Error('fixture');
      foreign = (await ensureConversation(x, b.value, `ig-cc25-other-${RUN}`, 'Not Yours', 'instagram')).conversationId;
      const f1 = (await sql<{ id: string; sent_at: Date }>`
        insert into messages (conversation_id, direction, input_type, text_content, sent_at)
        values (${foreign}::uuid, 'inbound', 'text', 'm-999', now()) returning id::text as id, sent_at`.execute(x)).rows[0]!;
      foreignCursor = `${f1.sent_at.getTime()}_${f1.id}`;
    });

    app = Fastify({ logger: false });
    const code = `cc25-${RUN}`;
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: true,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${code}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 120_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('opens on the newest fifty, the newest at the bottom and marked, the reply waiting directly under it', async () => {
    const html = await page(`/app/inbox/${long}`);
    expect(said(html)).toEqual(ALL.slice(TOTAL - 50));          // m-401 … m-450, in order
    expect(said(html)).not.toContain('m-400');
    expect(said(html)).not.toContain('m-001');
    expect(markedLatest(html)).toBe('m-450');
    const newest = html.indexOf('<bdi>m-450</bdi>');
    const draft = html.indexOf('class="card draft"');
    const takeover = html.indexOf('class="card takeover');
    expect(draft).toBeGreaterThan(newest);
    expect(takeover).toBe(-1);   // the fix wave (w4-conversation-03): no second card under the draft
    expect(html.slice(newest, draft)).not.toContain('class="card');   // nothing between the question and the approval
    expect(earlierOf(html, long)).not.toBeNull();
    expect(html).toContain('Earlier messages');
    expect(html).not.toContain(latestDoor(long));
    expect(shown(html)).not.toContain('%');
  });

  it('"Earlier messages", followed to the end, visits every message exactly once, in order', async () => {
    const windows: string[][] = [];
    let url: string | null = `/app/inbox/${long}`;
    while (url) {
      const html = await page(url);
      const words = said(html);
      windows.push(words);
      expect(markedLatest(html), url).toBe(words.at(-1));
      if (windows.length > 1) {
        // a window further back is for reading: the way home, and nothing to act on
        expect(html, url).toContain(latestDoor(long));
        expect(html, url).toContain('Latest messages');
        expect(html, url).not.toContain('class="card draft"');
        expect(html, url).not.toContain('class="card takeover');
        expect(html, url).not.toContain('No messages yet');
      }
      expect(shown(html), url).not.toContain('%');
      url = earlierOf(html, long);
      expect(windows.length, 'a door that never ends').toBeLessThan(20);
    }
    expect(windows).toHaveLength(9);
    expect(windows.every((w) => w.length === 50)).toBe(true);
    const everything = windows.slice().reverse().flat();
    expect(new Set(everything).size).toBe(TOTAL);                  // no message twice
    expect(everything).toEqual(ALL);                               // none lost, in order
  });

  it('the two edges that break a careless cursor: one instant shared, one millisecond shared', async () => {
    const first = await page(`/app/inbox/${long}`);
    const toSecond = earlierOf(first, long);
    expect(toSecond, 'the newest window has a door back').not.toBeNull();
    const second = await page(toSecond!);
    expect(said(first)[0]).toBe('m-401');
    expect(said(second).at(-1)).toBe('m-400');   // same instant as m-401: the id decides, nothing repeats or vanishes
    const toThird = earlierOf(second, long);
    expect(toThird, 'the second window has a door back').not.toBeNull();
    const third = await page(toThird!);
    expect(said(second)[0]).toBe('m-351');
    expect(said(third).at(-1)).toBe('m-350');    // 500 µs before m-351, inside the millisecond the cursor names
  });

  it('a malformed, stale or foreign cursor is the newest window', async () => {
    const good = cursorOf(await page(`/app/inbox/${long}`), long);
    expect(good).toMatch(/^\d+_[0-9a-f-]{36}$/);
    const [ms, id] = good.split('_') as [string, string];
    const cursors = [
      // malformed
      'garbage', '', '123', `${ms}_not-a-uuid`, `0${ms}_${id}`, `${ms}_${id.toUpperCase()}`,
      `${ms}_${id}x`, `${ms}__${id}`, `${ms}.0_${id}`, '%27%3B%20select%201',
      // stale: the right message, the wrong stamp
      `${Number(ms) + 1}_${id}`, `-${ms}_${id}`,
      // foreign, each with its message's REAL stamp — so only where it lives refuses it
      shortCursor,                                                 // another conversation of this business
      foreignCursor,                                               // another business's message
    ];
    for (const c of cursors) {
      const html = await page(`/app/inbox/${long}?before=${encodeURIComponent(c)}`);
      expect(said(html), c).toEqual(ALL.slice(TOTAL - 50));
      expect(html, c).toContain('class="card draft"');
      expect(html, c).not.toContain(latestDoor(long));
    }
    // twice over, as an array
    const twice = await page(`/app/inbox/${long}?before=${good}&before=${good}`);
    expect(said(twice)).toEqual(ALL.slice(TOTAL - 50));
    // and the real one still pages
    expect(said(await page(`/app/inbox/${long}?before=${good}`))).toEqual(ALL.slice(TOTAL - 100, TOTAL - 50));
  });

  it('another business’s conversation is not found — with a cursor or without; an address that names nothing is not found', async () => {
    for (const url of [`/app/inbox/${foreign}`, `/app/inbox/${foreign}?before=${foreignCursor}`]) {
      const r = await get(url);
      expect(r.statusCode, url).toBe(404);
      expect(r.body).not.toContain('m-999');
      expect(r.body).not.toContain('Not Yours');
    }
    const junk = await get('/app/inbox/not-a-conversation');
    expect(junk.statusCode).toBe(404);
    expect(junk.body).toContain('Conversation not found');
  });

  it('Arabic: right to left, doors included', async () => {
    const first = await page(`/app/inbox/${long}`, 'ar');
    expect(first).toContain('<html lang="ar" dir="rtl"');
    expect(first).toContain('رسائل أقدم');
    expect(said(first).at(-1)).toBe('m-450');
    const older = await page(earlierOf(first, long)!, 'ar');
    expect(older).toContain('<html lang="ar" dir="rtl"');
    expect(older).toContain('أحدث الرسائل');
    expect(older).toContain(latestDoor(long));
  });

  it('a short conversation has no door at all, and its newest message is marked', async () => {
    const html = await page(`/app/inbox/${short}`);
    expect(html).toContain('<bdi>s-3</bdi>');
    expect(html).toMatch(/id="latest" class="msg (?:inbound|outbound)">\s*(?:<div class="msg-by">.*?<\/div>\s*)?<div dir="auto" class="bubble(?: by-as)?"><bdi>s-3<\/bdi>/);
    expect(html).not.toContain('?before=');
    expect(html).not.toContain(latestDoor(short));
  });

  it('the buyer file’s history is the recent part — the newest words — with a door to the whole conversation', async () => {
    const html = await page(`/app/conversations/${long}`);
    expect(html).toContain('m-450');
    expect(html).not.toContain('m-001');
    expect(html).toContain(latestDoor(long));
    expect(html).toContain('The whole conversation');
  });
});
