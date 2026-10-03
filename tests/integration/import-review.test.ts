import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant, flashSaid } from './tenant.js';
import { pasteList, submitReview, rowKey, importAt, postPhotos, formFields } from './importReview.js';
import type { PageTranscriber } from '../../src/llm/ports.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * K1 · K2 · K3 · K7 — the kept import review, through the real routes and into
 * real rows (the onboarding plan, Stage 2; 0094).
 *
 * The parity file holds each rule. Only Postgres can hold the promises made to
 * the owner: what she changed on the review is what was written, nothing she
 * left out reached her catalogue, each product says where it came from, a
 * discount becomes a floor only where she ticked it — and nobody else's
 * workspace can see or touch her list.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd940000-0000-4000-8000-${RUN}0001`;
const OTHER = `dd940000-0000-4000-8000-${RUN}0002`;
const CODE = 'import-review-owner-code';
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('K1 · the kept import review (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  let transcript = '';

  const transcriber: PageTranscriber = {
    transcribe: async () => ({ text: transcript, unreadable: false, promptVersion: 'test', modelId: 'test', usage: { inputTokens: 1, outputTokens: 1 } }),
  };

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>, biz = BIZ): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const product = (name: string) => tx((t) => sql<{ id: string; unit: string; moq: number | null; price: string | null; active: boolean; line: string | null; imp: string | null }>`
    select id::text as id, unit, moq, price_usd_per_unit as price, is_active as active, source_line as line, source_import_id::text as imp
      from products where business_id = ${BIZ} and name = ${name}`.execute(t).then((r) => r.rows[0]));
  const aliases = (id: string) => tx((t) => sql<{ alias: string }>`
    select alias from product_aliases where product_id = ${id}::uuid order by alias`.execute(t).then((r) => r.rows.map((x) => x.alias)));
  const audits = (action: string) => tx((t) => sql<{ detail: Record<string, unknown> }>`
    select detail from channel_audit where business_id = ${BIZ} and action = ${action} order by id`.execute(t).then((r) => r.rows.map((x) => x.detail)));
  const stateOf = (at: string) => tx((t) => sql<{ state: string }>`
    select state from catalog_imports where id = ${at.split('/').pop()!}::uuid`.execute(t).then((r) => r.rows[0]?.state));
  const count = (table: string) => tx((t) => sql<{ n: number }>`
    select count(*)::int as n from ${sql.table(table)} where business_id = ${BIZ}`.execute(t).then((r) => r.rows[0]!.n));

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    // An online shop in the US: it counts in "item" (RT) and sells in dollars.
    await tx((t) => sql`insert into businesses (id, name, kind, country) values (${BIZ}, 'Kept Review Shop', 'online_shop', 'US')
                        on conflict (id) do nothing`.execute(t));
    await tx((t) => sql`insert into businesses (id, name) values (${OTHER}, 'Someone Else')
                        on conflict (id) do nothing`.execute(t), OTHER);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', factsTtlMs: 0,
      secureCookie: false, messagingEnabled: false, pageTranscriber: transcriber,
      kickOutbound: async () => {}, kickDrive: async () => {},
      // Practice's box is drawn where live practice can queue a message (K6 fills it).
      enqueueInbound: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  let kept = '';
  it('A PASTED LIST IS KEPT: every visit shows it as she left it, and her changes last', async () => {
    kept = await pasteList(app, cookie, 'Tote bag $12.00\nSilk scarf $20 MOQ 10\nOld sample $1');
    const first = await get(kept);
    expect(first.body).toContain('We read 3 lines.');
    // The add page offers to go back to it.
    expect((await get('/app/products/add')).body).toContain(`/app/products/import/${kept.split('/').pop()}`);
    const tote = rowKey(first.body, 'Tote bag');
    const sample = rowKey(first.body, 'Old sample');
    const { res } = await submitReview(app, cookie, kept, {
      next: 'save',
      set: { [`name:${tote}`]: 'Canvas tote', [`unit:${tote}`]: 'pair', [`names:${tote}`]: 'shopper, 帆布袋', [`remove:${sample}`]: 'on' },
    });
    expect(res.statusCode).toBe(302);
    const again = await get(kept);
    expect(again.body).toContain('value="Canvas tote"');
    // The names box is a textarea since phase 9 (one name a line); her words are kept in it.
    expect(again.body).toMatch(/<textarea name="names:[^"]+"[^>]*>shopper(?:, |\n)帆布袋<\/textarea>/);
    expect(again.body).toContain(t('en', 'import.row.removed'));
    expect(await count('products')).toBe(0);
  });

  it('ADDED AS IT STANDS: her name, unit and names customers use; the row she left out is nowhere; each says where it came from', async () => {
    const { res } = await submitReview(app, cookie, kept);
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toMatch(/^\/app\/products\?import=[0-9a-f-]{36}$/);
    const tote = (await product('Canvas tote'))!;
    expect(tote).toMatchObject({ unit: 'pair', moq: null, active: false, line: 'Tote bag $12.00' });
    expect(Number(tote.price)).toBe(12);
    expect(kept.endsWith(tote.imp!)).toBe(true);
    // T3 — found by its own name and by the ones she typed.
    expect(await aliases(tote.id)).toEqual(['Canvas tote', 'shopper', '帆布袋']);
    // RT — a shop's row she did not touch counts in "item"; its minimum is the line's.
    expect(await product('Silk scarf')).toMatchObject({ unit: 'item', moq: 10 });
    expect(await product('Old sample')).toBeUndefined();
    // K3 — one audit row per product, one for the list.
    const added = await audits('product_imported');
    expect(added.map((a) => a['name']).sort()).toEqual(['Canvas tote', 'Silk scarf']);
    expect(added.find((a) => a['name'] === 'Canvas tote')).toMatchObject({ line: 'Tote bag $12.00', edited: true, names: ['shopper', '帆布袋'] });
    const list = await audits('import_confirmed');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'paste', lines: 3, removed: 1, added: 2 });
    expect(await stateOf(kept)).toBe('confirmed');
    // A confirmed list is not added twice.
    const twice = await submitReview(app, cookie, kept).catch(() => null);
    expect(twice).toBeNull();                       // its review has no form any more
    expect((await get(kept)).body).toContain(t('en', 'import.gone'));
    // The product's page says where it came from.
    expect((await get(`/app/products/${tote.id}`)).body).toContain('Tote bag $12.00');
    // K6 — the list she lands on offers to ask about three of them in Practice…
    const landed = await get(String(res.headers['location']));
    const id = kept.split('/').pop()!;
    expect(landed.body).toContain(`href="/app/sandbox?from=${id}"`);
    // …and Practice opens with those questions, the first already in the box.
    const practice = await get(`/app/sandbox?from=${id}`);
    expect(practice.body).toContain(t('en', 'practice.ask.price', { product: 'Canvas tote' }));
    expect(practice.body).toContain(t('en', 'practice.ask.price', { product: 'Silk scarf' }));
    expect(practice.body).toMatch(/<textarea id="buyer" name="text"[^>]*>How much is the (Canvas tote|Silk scarf)\?<\/textarea>/);
    // Another list's questions are not hers to ask: an unknown import asks nothing.
    expect((await get(`/app/sandbox?from=${randomUUID()}`)).body).not.toContain(t('en', 'practice.ask.title'));
  });

  it('A FLAGGED ROW NEEDS HER TICK: without it nothing is added, and she is told what is left', async () => {
    const at = await pasteList(app, cookie, 'Hoodie S-M $40 / L-XL $45\nWool cap $8');
    const { res } = await submitReview(app, cookie, at);           // no ticks
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('1 row still needs your tick.');
    expect(res.body).toContain('Two prices on this line');
    expect(await product('Wool cap')).toBeUndefined();
    const { res: ok } = await submitReview(app, cookie, at, { tickAll: true });
    expect(ok.statusCode).toBe(302);
    expect(await product('Wool cap')).toBeDefined();
  });

  it('K2 · THE DISCOUNT: each new product\'s lowest price with its own tick, written through the one save', async () => {
    const at = await pasteList(app, cookie, 'Linen shirt $20\nLeather belt $15');
    const bad = await submitReview(app, cookie, at, { set: { discount: '150' } });
    expect(bad.res.statusCode).toBe(400);
    expect(bad.res.body).toContain(t('en', 'import.discount.invalid'));
    const { res } = await submitReview(app, cookie, at, { set: { discount: '10' } });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(`${at}/floors`);
    const floors = await get(`${at}/floors`);
    expect(floors.body).toContain('$18.00');
    expect(floors.body).toContain('$13.50');
    const fields = formFields(floors.body, `${at}/confirm`);
    expect([...fields.keys()].filter((k) => k.startsWith('floor:'))).toEqual([]);   // none ticked for her
    const shirtKey = /name="floor:([^"]+)"[\s\S]*?Linen shirt/.exec(floors.body)![1]!;
    const done = await app.inject({ method: 'POST', url: `${at}/confirm`, headers: { cookie, ...FORM }, payload: `floor:${shirtKey}=on` });
    expect(done.statusCode).toBe(302);
    expect(flashSaid(done, SECRET)).toContain(t('en', 'import.flash.floorsSet', { n: 1 }));
    const shirt = (await product('Linen shirt'))!;
    const belt = (await product('Leather belt'))!;
    expect(shirt.active).toBe(true);
    expect(belt.active).toBe(false);
    const rules = await tx((t) => sql<{ product: string; floor: string; max: string; ask: string }>`
      select product_id::text as product, floor_price_usd as floor, max_discount_pct as max, human_required_above_pct as ask
        from pricing_policy where business_id = ${BIZ}`.execute(t).then((r) => r.rows));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ product: shirt.id });
    expect([Number(rules[0]!.floor), Number(rules[0]!.max), Number(rules[0]!.ask)]).toEqual([18, 10, 10]);
    // …through savePriceRules, so the rule has its own audit row (rule 11).
    expect((await audits('price_rules_set')).filter((a) => a['productId'] === shirt.id)).toHaveLength(1);
  });

  it('K7 · A PHOTO: typed differently from what was read — every row is checked again before anything is added', async () => {
    transcript = ['Denim jacket $60', 'Cotton tee $15', 'Beanie $9', 'Socks $5'].join('\n');
    const at = importAt(await postPhotos(app, cookie, [{ bytes: Buffer.from('jpeg') }]));
    const { res } = await submitReview(app, cookie, at, { typeFromPaper: () => '99', next: 'save' });
    expect(res.statusCode).toBe(302);
    const page = await get(at);
    expect(page.body).toContain(t('en', 'import.checkEvery'));
    expect(page.body).toContain(t('en', 'import.flag.challenge_mismatch'));
    // Every row now has its own tick box, and none is ticked.
    const ticks = (formFields(page.body, `${at}/save`).get('ticks') ?? '').split(',').filter(Boolean);
    expect(ticks).toHaveLength(4);
    const blocked = await submitReview(app, cookie, at);
    expect(blocked.res.statusCode).toBe(400);
    expect(blocked.res.body).toContain('4 rows still need your tick.');
    expect(await product('Socks')).toBeUndefined();
    const { res: ok } = await submitReview(app, cookie, at, { tickAll: true });
    expect(ok.statusCode).toBe(302);
    expect((await product('Socks'))!.imp).toBe(at.split('/').pop());
  });

  it('A LIST READ IN ONE CURRENCY IS NOT ADDED IN ANOTHER', async () => {
    const at = await pasteList(app, cookie, 'Travel mug $11');
    await tx((t) => sql`update businesses set currency = 'AED' where id = ${BIZ}`.execute(t));
    const { res } = await submitReview(app, cookie, at, { tickAll: true });
    await tx((t) => sql`update businesses set currency = 'USD' where id = ${BIZ}`.execute(t));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('this list was read in USD');
    expect(await product('Travel mug')).toBeUndefined();
  });

  it('READ AGAIN replaces the rows; START AGAIN sets the list aside and adds nothing', async () => {
    const at = await pasteList(app, cookie, 'Straw hat $14');
    await app.inject({ method: 'POST', url: `${at}/reread`, headers: { cookie, ...FORM }, payload: `text=${encodeURIComponent('Sun hat $16\nBucket hat $12')}` });
    const page = await get(at);
    expect(page.body).toContain('We read 2 lines.');
    expect(page.body).toContain('value="Sun hat"');
    expect(page.body).not.toContain('Straw hat');
    const drop = await app.inject({ method: 'POST', url: `${at}/drop`, headers: { cookie, ...FORM }, payload: '' });
    expect(flashSaid(drop, SECRET)).toBe(t('en', 'import.flash.dropped'));
    expect(await stateOf(at)).toBe('dropped');
    expect(await product('Sun hat')).toBeUndefined();
  });

  it('THE OLD CONFIRM ADDRESS lands on a kept review — nothing is added without its ticks', async () => {
    const res = await app.inject({ method: 'POST', url: '/app/products/add/confirm', headers: { cookie, ...FORM }, payload: `text=${encodeURIComponent('Rain coat $45')}` });
    importAt(res);
    expect(await product('Rain coat')).toBeUndefined();
  });

  it('ANOTHER WORKSPACE\'S LIST is not there: not its review, not its photo, not its save', async () => {
    const theirs = await tx(async (t) => {
      const id = (await sql<{ id: string }>`
        insert into catalog_imports (business_id, kind, currency, source_text, rows, created_by)
        values (${OTHER}, 'photo', 'USD', null, '[]'::jsonb, 'owner') returning id::text as id`.execute(t)).rows[0]!.id;
      await sql`insert into catalog_import_photos (business_id, import_id, position, media_type, bytes, transcript)
                values (${OTHER}, ${id}::uuid, 1, 'image/jpeg', ${Buffer.from('their-photo')}, 'x')`.execute(t);
      return id;
    }, OTHER);
    const at = `/app/products/import/${theirs}`;
    // The warmth run, phase 9 (w4-products-knowledge-16) — another business's list is not here: said as that, 404.
    const theirsPage = await get(at);
    expect(theirsPage.statusCode).toBe(404);
    expect(theirsPage.body).toContain(t('en', 'import.notFound'));
    expect((await get(`${at}/photo/1`)).statusCode).toBe(404);
    const save = await app.inject({ method: 'POST', url: `${at}/save`, headers: { cookie, ...FORM }, payload: 'next=add' });
    expect(save.headers['location']).toBe('/app/products/add');
    const still = await tx((t) => sql<{ state: string }>`select state from catalog_imports where id = ${theirs}::uuid`.execute(t).then((r) => r.rows[0]!.state), OTHER);
    expect(still).toBe('open');
  });
});
