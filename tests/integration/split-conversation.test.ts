import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { buttonsAndDoors } from '../parity/buttons-and-doors.js';
import { unisolatedFigures, withoutIsolates } from '../parity/isolates.js';
import { sheetLinks } from '../parity/linked-css.js';

/**
 * A CONVERSATION IN THE SPLIT LOOK, over Postgres and the owner's routes (the owner, 2026-11-05).
 *
 *   - the flag off, the page is what it was;
 *   - the head is read from rows: a price worked out and never given stays "Asked", with no figure;
 *   - every act the plain page offers is on this one, and pressing the real ones does what it always did;
 *   - the reply the owner holds has the one magenta Send; another workspace's conversation is not there.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `5c0a0000-0000-4000-8000-${RUN}0001`;
const OTHER = `5c0a0000-0000-4000-8000-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const CODE = `conv-${RUN}`;

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('a conversation in the Split look (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let plain: import('fastify').FastifyInstance;
  let cookie = '';
  let plainCookie = '';
  let otherConv = '';
  const conv: Record<string, string> = {};
  const draftOf: Record<string, string> = {};
  const kicked: { conversationId: string; text: string }[] = [];

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
      provider: 'disabled', messagingEnabled: true, splitToday, kickOutbound: async (_b: string, c: string, text: string) => { kicked.push({ conversationId: c, text }); }, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await f.ready();
    return f;
  };
  const login = async (f: import('fastify').FastifyInstance) =>
    String((await f.inject({ method: 'POST', url: '/login', payload: `code=${CODE}`, headers: FORM })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const open = async (key: string, locale?: string, who = cookie, f = app) =>
    (await f.inject({ method: 'GET', url: `/app/inbox/${conv[key]}`, headers: { cookie: locale ? `${who}; yf_locale=${locale}` : who } }));
  const page = async (key: string, locale?: string) => (await open(key, locale)).body;
  const plainPage = async (key: string) => (await open(key, undefined, plainCookie, plain)).body;
  const post = (url: string, form: Record<string, string>) =>
    app.inject({ method: 'POST', url, headers: { ...FORM, cookie }, payload: new URLSearchParams(form).toString() });
  const headOf = (html: string): string => html.split('<header class="sp-head sc-head">')[1]!.split('</header>')[0]!;
  const seed = async (key: string, name: string, assigned: string | null, draft: string | null) => {
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    return tx(BIZ, async (x) => {
      const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
      const c = await ensureConversation(x, b.value, `ig-${key}-${RUN}`, name, 'instagram');
      conv[key] = c.conversationId;
      await sql`update client_channels set last_inbound_at = now() - interval '1 minute' where client_id = ${c.clientId}::uuid`.execute(x);
      await sql`update conversations set assigned_to = ${assigned} where id = ${c.conversationId}::uuid`.execute(x);
      await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
                values (${c.conversationId}::uuid, ${`m-${key}-${RUN}`}, 'inbound', 'text', 'How much for 3 of the serum?', now() - interval '1 hour')`.execute(x);
      if (draft) {
        draftOf[key] = (await sql<{ id: string }>`insert into drafts (business_id, conversation_id, capability, draft_text, status)
          values (${BIZ}, ${c.conversationId}, 'quote', ${draft}, 'pending') returning id::text as id`.execute(x)).rows[0]!.id;
      }
      return c;
    });
  };
  /** What the page lets the owner do: every form it posts, every button's other address, every named command. */
  const acts = (html: string): string[] => {
    const main = html.split('<main')[1] ?? html;
    return [...new Set([
      ...[...main.matchAll(/<form[^>]*method="post"[^>]*action="([^"]+)"/g)].map((m) => `form ${m[1]}`),
      ...[...main.matchAll(/formaction="([^"]+)"/g)].map((m) => `form ${m[1]}`),
      ...[...main.matchAll(/name="command" value="([^"]+)"/g)].map((m) => `command ${m[1]}`),
    ])].sort();
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    db = createDb(DATABASE_URL!);
    await tx(BIZ, (x) => sql`insert into businesses (id, name, owner_locale, timezone, currency, kind) values (${BIZ}, 'Serum Shop', 'en', 'UTC', 'USD', 'online_shop')`.execute(x));
    await tx(OTHER, (x) => sql`insert into businesses (id, name, owner_locale, timezone, currency) values (${OTHER}, 'Other Shop', 'en', 'UTC', 'USD')`.execute(x));
    otherConv = await tx(OTHER, async (x) => {
      const b = parseBusinessId(OTHER); if (!b.ok) throw new Error('fixture');
      return (await ensureConversation(x, b.value, `ig-other-${RUN}`, 'Someone Else', 'instagram')).conversationId;
    });
    await seed('draft', 'Dana Draft', null, 'The serum is 13 each, 39 for 3. Shall I put that together?');
    await seed('handto', 'Hani Handto', null, 'Hello from the assistant');
    await seed('noreply', 'Nora Noreply', null, 'Hello again');
    await seed('held', 'Tariq Team', 'owner', null);
    await seed('asked', 'Asma Asked', null, null);
    // A price worked out and given: a line left after it. And one worked out that never left.
    const product = await tx(BIZ, async (x) => (await sql<{ id: string }>`insert into products (business_id, sku, name, unit, is_active) values (${BIZ}, ${`S-${RUN}`}, 'Rose Serum', 'item', true) returning id::text as id`.execute(x)).rows[0]!.id);
    const quote = (key: string, total: number) => tx(BIZ, (x) => sql`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, discount_pct, total_usd, requires_human, applied_rules, engine_version, created_at)
      values (${BIZ}, ${conv[key]}::uuid, ${product}::uuid, 3, '{}'::jsonb, ${total / 3}, 0, ${total}, false, '{}', 'conv-test', now() - interval '50 minutes')`.execute(x));
    await seed('given', 'Priya Price', null, null);
    await quote('given', 39);
    await tx(BIZ, (x) => sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
      values (${conv['given']}::uuid, ${`out-${RUN}`}, 'outbound', 'text', 'That is $39.', now() - interval '40 minutes')`.execute(x));
    await seed('notgiven', 'Nadia Notgiven', null, null);
    await quote('notgiven', 297);
    app = await compose(true);
    plain = await compose(false);
    cookie = await login(app);
    plainCookie = await login(plain);
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await plain?.close(); await db?.destroy(); });

  it('the flag off: the page is what it was', async () => {
    const html = await plainPage('draft');
    expect(html).not.toContain('class="sp sc"');
    expect(html).toContain('class="panes');
    expect(html).toContain('class="approve');
    expect(sheetLinks(html).some((h) => h.includes('/split.'))).toBe(false);
  });

  it('the flag on: the Split sheet, one heading, the customer\'s name in the head, the chat with its ids for the live line', async () => {
    const html = await page('draft');
    expect(html).toContain('class="sp sc"');
    expect(sheetLinks(html).some((h) => h.includes('/split.'))).toBe(true);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(headOf(html)).toContain('<bdi>Dana Draft</bdi>');
    expect(html).toContain('id="latest"');
    expect(html).toContain('id="approve"');
    expect(html).toContain('class="msg inbound');
    // The customer panel, and the door to it for a screen too small to show it.
    expect(html).toContain('id="customer"');
    expect(html).toContain('file-door');
  });

  it('the head is read from rows: given is "Price given" with its figure; worked out and never given stays "Asked", no figure', async () => {
    const given = withoutIsolates(headOf(await page('given')));
    expect(given).toContain('class="sc-value">$39');
    const never = withoutIsolates(headOf(await page('notgiven')));
    expect(never).toContain('>Asked<');
    expect(never).not.toContain('sc-value');
    expect(never).not.toContain('297');
  });

  it('every act of the plain page is on this one, draft and held alike', async () => {
    for (const key of ['draft', 'held', 'asked', 'given']) {
      const split = acts(await page(key));
      // The list pane's own forms are not in `acts`: it searches by GET. Nothing here is the list's.
      expect(split, key).toEqual(acts(await plainPage(key)));
      expect(split.length, key).toBeGreaterThan(0);
    }
    expect(acts(await page('draft'))).toEqual(expect.arrayContaining(['command send', 'command 不回', `form /app/inbox/${conv['draft']}/act`, `form /app/inbox/${conv['draft']}/takeover`]));
  });

  it('the draft: the box with its own words, one magenta Send, Edit, Hand to me, and where each figure came from, open', async () => {
    const html = await page('draft');
    const card = html.split('id="approve"')[1]!.split('</section>')[0]!;
    expect(card).toContain('The serum is 13 each, 39 for 3.');
    expect(card.match(/sp-send/g)).toHaveLength(1);
    expect(html.match(/sp-send/g)).toHaveLength(1);
    expect(card).toContain(`<label class="sp-btn" for="reply">`);
    expect(card).toContain(`formaction="/app/inbox/${conv['draft']}/takeover"`);
    expect(card).toContain('name="draftId"');
    expect(card).toContain('data-keep=');
    expect(card).toContain('data-confirm=');
    expect(card).toContain('<details class="reading" open>');
    expect(html.match(/name="edit"/g)).toHaveLength(1);
  });

  it('pressing Send as it is sends the draft\'s own words through the approval path', async () => {
    const html = await page('draft');
    const words = html.split('id="reply"')[1]!.split('>')[1]!.split('</textarea')[0]!;
    const r = await post(`/app/inbox/${conv['draft']}/act`, { draftId: draftOf['draft']!, command: 'send', edit: words });
    expect(r.statusCode).toBe(302);
    const row = await tx(BIZ, async (x) => (await sql<{ status: string }>`select status from drafts where id = ${draftOf['draft']}::uuid`.execute(x)).rows[0]!);
    expect(row.status).toBe('approved');
    expect(kicked).toEqual([{ conversationId: conv['draft'], text: 'The serum is 13 each, 39 for 3. Shall I put that together?' }]);
    // The card has gone with it.
    expect(await page('draft')).not.toContain('id="approve"');
  });

  it('pressing Hand to me takes it over and sends nothing; the reply box is then the one with Send', async () => {
    const r = await post(`/app/inbox/${conv['handto']}/takeover`, { draftId: draftOf['handto']! });
    expect(r.statusCode).toBe(302);
    await tx(BIZ, async (x) => {
      expect((await sql<{ assigned_to: string | null }>`select assigned_to from conversations where id = ${conv['handto']}::uuid`.execute(x)).rows[0]!.assigned_to).not.toBeNull();
    });
    expect(kicked.filter((k) => k.conversationId === conv['handto'])).toEqual([]);
    const html = await page('handto');
    expect(html.match(/sp-send/g)).toHaveLength(1);
    expect(html).toContain('class="sp-btn sp-send" type="submit"');
  });

  it('pressing No reply needed sends nothing and clears the card', async () => {
    const r = await post(`/app/inbox/${conv['noreply']}/act`, { draftId: draftOf['noreply']!, command: '不回', edit: 'Hello again' });
    expect(r.statusCode).toBe(302);
    await tx(BIZ, async (x) => {
      expect((await sql<{ status: string }>`select status from drafts where id = ${draftOf['noreply']}::uuid`.execute(x)).rows[0]!.status).not.toBe('pending');
    });
    expect(kicked.filter((k) => k.conversationId === conv['noreply'])).toEqual([]);
    expect(await page('noreply')).not.toContain('id="approve"');
  });

  it('a conversation the owner holds: one magenta Send, on the reply box', async () => {
    const html = await page('held');
    expect(html.match(/sp-send/g)).toHaveLength(1);
    expect(html).toContain('class="sp-btn sp-send"');
  });

  it('another workspace\'s conversation is not there', async () => {
    const r = await app.inject({ method: 'GET', url: `/app/inbox/${otherConv}`, headers: { cookie } });
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain('Someone Else');
  });

  it('in Arabic: right to left, every figure isolated, buttons do things and doors go places', async () => {
    for (const key of ['handto', 'held', 'given', 'notgiven', 'asked']) {
      const html = await page(key, 'ar');
      expect(html, key).toContain('dir="rtl"');
      expect(unisolatedFigures(html), key).toEqual([]);
      expect(buttonsAndDoors(html), key).toEqual([]);
    }
  });

  it('no raw catalogue key on the page, in any language', async () => {
    for (const l of ['en', 'zh', 'ar', 'es', 'fr']) {
      const body = (await page('given', l)).split('<main')[1]!;
      expect(body, l).not.toMatch(/>\s*(?:inbox|buyers|split|card)\.[a-zA-Z.]+\s*</);
    }
  });
});
