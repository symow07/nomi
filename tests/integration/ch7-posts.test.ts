import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID, createHmac } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * CH7 — a post or a story of the shop's, through the REAL composition: the
 * signed webhook, the worker, the caption read with the Page token, the turn.
 * Meta and the model are faked; nothing else is.
 *
 *   · a post shared with no words whose caption names one product: a turn
 *     runs about it — the line marked as what the customer did — and the
 *     timeline names the product;
 *   · "price?" on a story naming one product: the turn reads which; the
 *     timeline keeps the customer's words alone;
 *   · a caption naming none, or several, or a post Meta will not show (another
 *     account's): nothing guessed — no words go to a person with the caption,
 *     words are answered as before.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `cc700000-0000-4000-8000-${RUN}0001`;
const SCARF = `cc700000-0000-4000-8000-${RUN}0011`;
const HAT = `cc700000-0000-4000-8000-${RUN}0012`;
const BAG = `cc700000-0000-4000-8000-${RUN}0013`;
const APP_SECRET = `meta-app-secret-${RUN}`;
const IG_ACCOUNT = `1785${runDigits(RUN, 10)}`;
const PAGE_ID = `1021${runDigits(RUN, 10)}`;
const buyer = (who: string) => `IGSID_${who}_${RUN}`;

/** The shop's own media, as Meta would answer for its token. Anything else: an error, as for another account's post. */
const CAPTIONS: Record<string, string> = {
  [`post1${runDigits(RUN, 8)}`]: 'New in: our hand-rolled Silk Scarf, in five colours. Link in bio!',
  [`story1${runDigits(RUN, 8)}`]: 'The wool hat is back for winter',
  [`post2${runDigits(RUN, 8)}`]: 'Spring is here. Come and see us this weekend.',
  [`post3${runDigits(RUN, 8)}`]: 'Pair the silk scarf with our canvas tote — two favourites.',
};
const ids = Object.keys(CAPTIONS);
const asked: string[] = [];

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 30_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

const metaFetch: import('../../src/channels/meta/messaging.js').MetaFetch = async (url, init) => {
  const u = new URL(url);
  if (init.method === 'GET' && u.searchParams.get('fields') === 'caption') {
    const id = decodeURIComponent(u.pathname.split('/').pop() ?? '');
    asked.push(id);
    const caption = CAPTIONS[id];
    return { status: caption ? 200 : 400, text: async () => JSON.stringify(caption ? { caption, id } : { error: { code: 100 } }) };
  }
  return { status: 400, text: async () => JSON.stringify({ error: { message: 'not a real token' } }) };
};

d('CH7 · a post or a story of the shop\'s, matched to a product (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let cookie = '';
  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = ['It is lovely — shall I tell you the colours?'];

  const tx = async <R>(fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };

  /** One Instagram message, signed the way Meta signs it. */
  const send = (sender: string, message: Record<string, unknown>) => {
    const mid = `mid.${randomUUID()}`;
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{ id: IG_ACCOUNT, time: Date.now(), messaging: [{
        sender: { id: sender }, recipient: { id: IG_ACCOUNT }, timestamp: Date.now(), message: { mid, ...message },
      }] }],
    });
    return prod.app.inject({
      method: 'POST', url: '/webhook/instagram', payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex')}` },
    }).then((r) => { expect(r.statusCode).toBe(200); return mid; });
  };
  const messageOf = (mid: string) => tx((x) => sql<{ conv: string; text: string | null; ai: Record<string, unknown> | null }>`
    select conversation_id::text as conv, text_content as text, ai_analysis as ai from messages where external_id = ${mid}`.execute(x).then((r) => r.rows[0]));
  const signalOf = (conv: string) => tx((x) => sql<{ kind: string; payload: Record<string, unknown> | null }>`
    select kind, payload from conversation_signals where conversation_id = ${conv}::uuid and kind = 'media_unreadable'`.execute(x).then((r) => r.rows[0]));

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    process.env['OWNER_ACCESS_CODE'] = `ch7-${RUN}`;
    process.env['META_PAGE_ACCESS_TOKEN'] = 'page-token-not-real';
    process.env['META_PAGE_ID'] = PAGE_ID;
    process.env['META_IG_ACCOUNT_ID'] = IG_ACCOUNT;
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: `SIM_PNID_c7${RUN}`,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: APP_SECRET,
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'c7-verify-token',
      CREDENTIAL_KEY: 'c'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { models: { analyzer, replyWriter }, adapter: whatsappSimulator([], { tag: `c7${RUN}` }).adapter, logger: false, metaFetch });

    await tx((x) => sql`insert into businesses (id, name, kind) values (${BIZ}, 'CH7 Boutique', 'online_shop') on conflict (id) do nothing`.execute(x));
    await tx(async (x) => {
      await sql`insert into products (id, business_id, sku, name, unit, moq, is_active) values
        (${SCARF}, ${BIZ}, ${`SC-${RUN}`}, 'Silk scarf', 'pcs', null, true),
        (${HAT}, ${BIZ}, ${`HT-${RUN}`}, 'Winter beanie', 'pcs', null, true),
        (${BAG}, ${BIZ}, ${`BG-${RUN}`}, 'Canvas tote', 'pcs', null, true)`.execute(x);
      // T3 — the name customers use: the hat is "the wool hat" on Instagram.
      await sql`insert into product_aliases (product_id, alias, language, alias_type) values (${HAT}, 'wool hat', 'en', 'common')`.execute(x);
    });
    const login = await prod.app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(prod.ownerAccessCode)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    const r = await prod.app.inject({ method: 'POST', url: '/app/channels/instagram/connect', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
    expect(r.statusCode).toBe(302);
  }, 90_000);

  afterAll(async () => {
    delete process.env['META_PAGE_ACCESS_TOKEN'];
    delete process.env['META_PAGE_ID'];
    delete process.env['META_IG_ACCOUNT_ID'];
    await prod?.close();
  });

  it('A POST SHARED WITH NO WORDS, its caption naming one product: a turn about it, and the timeline says which', async () => {
    const mid = await send(buyer('share'), { attachments: [{ type: 'ig_post', payload: { ig_post_media_id: ids[0], url: 'https://www.instagram.com/p/abc/', title: 'anything' } }] });
    const line = '[shared your post about: Silk scarf]';
    await until(async () => (analyzer.texts.includes(line) ? true : undefined), 'the turn about the scarf');
    expect(asked).toContain(ids[0]);
    const m = await until(() => messageOf(mid), 'the share on the timeline');
    expect(m.text).toBeNull();
    expect(m.ai).toMatchObject({ received: 'shared_post', about: 'Silk scarf' });
    expect(await signalOf(m.conv)).toBeUndefined();
    const page = await prod.app.inject({ method: 'GET', url: `/app/inbox/${m.conv}`, headers: { cookie } });
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    expect(page.body).toContain(t('en', 'received.about', { name: 'Silk scarf' }));
  }, 60_000);

  it('"PRICE?" ON A STORY naming one product by its alias: the turn reads which; the timeline keeps the words alone', async () => {
    const mid = await send(buyer('story'), { text: 'price?', reply_to: { story: { id: ids[1], url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1' } } });
    const line = 'price?\n[replied to your story about: Winter beanie]';
    await until(async () => (analyzer.texts.includes(line) ? true : undefined), 'the turn about the beanie');
    const m = await until(() => messageOf(mid), 'the words on the timeline');
    expect(m.text).toBe('price?');
  }, 60_000);

  it('NOTHING GUESSED: a caption naming none, or two, or another account\'s post — no words go to a person, with the caption', async () => {
    const none = await send(buyer('none'), { attachments: [{ type: 'ig_post', payload: { ig_post_media_id: ids[2], url: 'https://www.instagram.com/p/def/' } }] });
    const two = await send(buyer('two'), { attachments: [{ type: 'ig_reel', payload: { reel_video_id: ids[3], url: 'https://www.instagram.com/reel/ghi/' } }] });
    const theirs = await send(buyer('theirs'), { attachments: [{ type: 'ig_post', payload: { ig_post_media_id: '99999999', url: 'https://www.instagram.com/p/xyz/' } }] });
    for (const [mid, caption] of [[none, CAPTIONS[ids[2]!]], [two, CAPTIONS[ids[3]!]], [theirs, undefined]] as const) {
      const m = await until(() => messageOf(mid), 'the share on the timeline');
      const s = await until(() => signalOf(m.conv), 'the hand-off');
      expect(s.payload).toMatchObject({ received: 'shared_post' });
      expect(s.payload?.['caption']).toBe(caption);
      expect(m.ai?.['about']).toBeUndefined();
    }
    expect(asked).toContain('99999999');
    expect(analyzer.texts.some((x) => x.includes('Spring is here') || x.includes('[shared your post about: Canvas tote]'))).toBe(false);
    const conv = (await messageOf(none))!.conv;
    const page = await prod.app.inject({ method: 'GET', url: `/app/inbox/${conv}`, headers: { cookie } });
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { esc } = await import('../../src/api/web/layout.js');
    expect(page.body).toContain(esc(t('en', 'unreadable.caption', { caption: CAPTIONS[ids[2]!]! })));
  }, 60_000);

  it('WORDS ON A STORY THAT NAMES NOTHING are answered as before, with no line added', async () => {
    await send(buyer('words'), { text: 'do you ship to Dubai?', reply_to: { story: { id: '88888888', url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=2' } } });
    await until(async () => (analyzer.texts.includes('do you ship to Dubai?') ? true : undefined), 'the ordinary turn');
  }, 60_000);
});
