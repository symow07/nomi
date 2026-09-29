import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * T3 — FINDABILITY (the one-month build order, 2026-09-29), against Postgres.
 *
 * A customer's words reach a product only through `product_aliases`, and a
 * product the retrieval did not return is dropped from the turn. The import
 * wrote no alias, so no imported product could ever be found or quoted — and
 * only the inactive case was ever tested. Real turns on real repos, only the
 * model faked (it names the product, as a model reading the candidates would):
 *
 *   · an imported product, once offered, is found by its own name and quoted;
 *   · the same product as the import left it before T3 (no alias) is dropped
 *     from the same turn — and the backfill tool, dry run first, makes it
 *     findable and quoted;
 *   · a rename moves the name customers find it by; names customers use add;
 *   · "ready", on the list and in Setup, only for what can be found.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd730000-0000-4000-8000-${RUN}0001`;
const OLD = `dd730000-0000-4000-8000-${RUN}0002`;      // a product as the import left it before T3
const LONE = `dd730000-0000-4000-8000-${RUN}0003`;     // a workspace whose only product is that shape

type Run = { code: number | null; out: string; err: string };
const tool = (args: string[], url = MIGRATE_URL): Run => {
  const r = spawnSync(process.execPath, ['tools/backfill-aliases.mjs', ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, MIGRATE_DATABASE_URL: url ?? '' },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

d('T3 · an imported product is found and quoted (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let db: import('../../src/db/client.js').Db;
  let conv = '';
  let imported = '';

  const as = async <T>(biz: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const aliasesOf = (pid: string) => as(BIZ, (t) => sql<{ alias: string }>`
    select alias from product_aliases where product_id = ${pid}::uuid`.execute(t).then((r) => r.rows.map((x) => x.alias).sort()));
  const found = (biz: string, words: string) => as(biz, (t) => sql<{ id: string }>`
    select product_id::text as id from retrieve_products(${biz}::uuid, ${words}::text, null, 5)`
    .execute(t).then((r) => r.rows.map((x) => x.id)));

  /** One real turn, computed AND committed as the worker does it; the model names `pid`. */
  const turn = async (pid: string, text: string) => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { hybridRetriever } = await import('../../src/retrieval/hybrid.js');
    const { computeTurn, commitTurn } = await import('../../src/pipeline/turn.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    const analyzer = new FakeAnalyzer();
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: {
        primary: 'inquiry',
        productCandidate: { productId: pid as never, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
        quantityMentioned: { value: 1000, unit: 'pcs' }, nextLogicalQuestion: null, missingFields: [],
      },
      recommendedPhase: 'commercial_discussion',
    };
    const writer = new FakeReplyWriter();
    writer.replies = ['Here is the price for 1,000.'];
    const req = { conversationId: conv as never, messageId: `t3-${randomUUID()}`, text };
    return as(BIZ, async (t) => {
      const ports = { tenant: tenantRepos(t, b.value), retriever: hybridRetriever(t, b.value), analyzer, replyWriter: writer, now: () => new Date() };
      const r = await computeTurn(ports, req);
      await commitTurn(ports, req, r, Date.now());
      return r;
    });
  };
  const newConversation = async () => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    conv = await as(BIZ, async (t) => {
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name) values (${BIZ}, ${`+97153${RUN}${Math.floor(Math.random() * 90 + 10)}`}, 'Maya')
        returning id::text as id`.execute(t)).rows[0]!.id;
      return (await tenantRepos(t, b.value).conversations.create(client as never, 'whatsapp')).conversationId;
    });
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    for (const [id, name] of [[BIZ, 'Findable Shop'], [LONE, 'Old Import Shop']] as const) {
      await as(id, async (t) => {
        await sql`insert into businesses (id, name, engine) values (${id}, ${name}, 'service') on conflict (id) do nothing`.execute(t);
        // D1 — the owner's answer for everything: a priced line above it arrives offered.
        await sql`insert into pricing_policy (business_id, product_id, floor_price_usd, currency, max_discount_pct, human_required_above_pct)
                  values (${id}, null, 1.00, 'USD', 10, 7)`.execute(t);
      });
    }
    // Exactly what the import wrote before T3: offered, priced, and no alias.
    for (const [biz, sku] of [[BIZ, `OLD-${RUN}`], [LONE, `LONE-${RUN}`]] as const) {
      await as(biz, async (t) => {
        const id = biz === BIZ ? OLD : randomUUID();
        await sql`insert into products (id, business_id, sku, name, name_zh, unit, moq, price_usd_per_unit, currency, is_active)
                  values (${id}, ${biz}, ${sku}, 'Linen apron', '亚麻围裙', 'pcs', 100, 3.10, 'USD', true)`.execute(t);
        await sql`insert into price_tiers (product_id, min_qty, unit_price_usd, currency) values (${id}, 1, 3.10, 'USD')`.execute(t);
      });
    }
    await newConversation();
  }, 60_000);

  afterAll(async () => { await db?.destroy(); });

  it('the import writes the names it is found by, and calls a product ready only when it can be found', async () => {
    const { confirmImport } = await import('../../src/api/web/products.js');
    const r = await confirmImport(db, BIZ, 'Canvas tote bag $2.40 MOQ 500');
    expect(r).toMatchObject({ added: 1, withPrice: 1, ready: 1 });
    imported = await as(BIZ, (t) => sql<{ id: string }>`
      select id::text as id from products where business_id = ${BIZ} and name = 'Canvas tote bag'`.execute(t).then((x) => x.rows[0]!.id));
    expect(await aliasesOf(imported)).toEqual(['Canvas tote bag']);
  });

  it('…so a customer\'s words find it, and the turn QUOTES it', async () => {
    expect(await found(BIZ, 'Hi, do you have canvas tote bags? I need 1000')).toContain(imported);
    const r = await turn(imported, 'Hi, do you have canvas tote bags? I need 1000');
    expect(r.analysis?.intent.productCandidate?.productId).toBe(imported);
    expect(r.quote?.unitPrice.amount).toBe(2.4);
  });

  it('a product as the import left it before T3 is never found, and the same turn drops it — nothing is quoted', async () => {
    await newConversation();
    expect(await aliasesOf(OLD)).toEqual([]);
    expect(await found(BIZ, 'Do you sell a linen apron?')).not.toContain(OLD);
    const r = await turn(OLD, 'Do you sell a linen apron? 1000 pieces');
    expect(r.analysis?.intent.productCandidate).toBeNull();
    expect(r.quote).toBeNull();
  });

  it('the list and Setup say so: never "ready" while it cannot be found', async () => {
    const { loadProductList } = await import('../../src/api/web/products.js');
    const { setupProgress } = await import('../../src/db/setup.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const list = await loadProductList(db, BIZ);
    expect(list.find((p) => p.id === imported)?.status).toBe('learned');
    expect(list.find((p) => p.id === OLD)?.status).toBe('not_findable');
    const lone = parseBusinessId(LONE); if (!lone.ok) throw new Error('fixture');
    const steps = await as(LONE, (t) => setupProgress(t, lone.value));
    expect(steps.steps.find((s) => s.step === 'products')?.done).toBe(false);
  });

  it('the backfill tool: refuses a role row security filters, a dry run writes nothing, --yes writes the names once', async () => {
    const appRole = tool(['--business', BIZ], DATABASE_URL);
    expect(appRole.code).toBe(1);
    expect(appRole.err).toContain('filtered by row security');

    const dry = tool(['--business', BIZ]);
    expect(dry.code, dry.err).toBe(0);
    expect(dry.out).toContain('1 can be found by no name at all today');
    expect(dry.out).toContain('✗ Linen apron  +  “Linen apron”, “亚麻围裙”');
    expect(dry.out).toContain('Dry run: nothing was written.');
    expect(await aliasesOf(OLD)).toEqual([]);

    const yes = tool(['--business', BIZ, '--yes']);
    expect(yes.code, yes.err).toBe(0);
    expect(yes.out).toContain('2 names written for 1 product');
    expect(await aliasesOf(OLD)).toEqual(['Linen apron', '亚麻围裙']);
    expect(tool(['--business', BIZ, '--yes']).out).toContain('Nothing to add.');
    expect(tool(['--business', BIZ]).out).not.toContain('can be found by no name at all today\n    ✗');
  });

  it('…and the product it made findable is found and quoted', async () => {
    await newConversation();
    const r = await turn(OLD, 'Do you sell a linen apron? 1000 pieces');
    expect(r.analysis?.intent.productCandidate?.productId).toBe(OLD);
    expect(r.quote?.unitPrice.amount).toBe(3.1);
  });

  it('a rename moves the name customers find it by; names customers use are added; the trail says so', async () => {
    const { updateProduct } = await import('../../src/api/web/products.js');
    const r = await updateProduct(db, BIZ, imported, 'owner', { name: '  Canvas   shopper ', nameZh: '帆布购物袋', customerNames: 'beach bag\n帆布包' });
    expect(r).toEqual({ ok: true, changed: ['name', 'nameZh', 'customerNames'] });
    expect(await aliasesOf(imported)).toEqual(['beach bag', 'Canvas shopper', '帆布包', '帆布购物袋'].sort());
    expect(await found(BIZ, 'price for the canvas shopper please')).toContain(imported);
    expect(await found(BIZ, '帆布包多少钱')).toContain(imported);
    const name = await as(BIZ, (t) => sql<{ name: string }>`select name from products where id = ${imported}::uuid`.execute(t).then((x) => x.rows[0]!.name));
    expect(name).toBe('Canvas shopper');
    const trail = await as(BIZ, (t) => sql<{ detail: { changes: Record<string, { from: unknown; to: unknown }> } }>`
      select detail from channel_audit where business_id = ${BIZ} and action = 'product_edited' order by at desc limit 1`
      .execute(t).then((x) => x.rows[0]!.detail.changes));
    expect(trail).toMatchObject({ name: { from: 'Canvas tote bag', to: 'Canvas shopper' }, customerNames: { to: ['beach bag', '帆布包'] } });
  });

  it('a refused name changes nothing: empty, too long, too many', async () => {
    const { updateProduct } = await import('../../src/api/web/products.js');
    expect(await updateProduct(db, BIZ, imported, 'owner', { name: '   ' })).toEqual({ ok: false, errors: { name: 'empty' } });
    expect(await updateProduct(db, BIZ, imported, 'owner', { name: 'x'.repeat(121) })).toEqual({ ok: false, errors: { name: 'too_long' } });
    const many = Array.from({ length: 21 }, (_, i) => `name ${i}`).join('\n');
    expect(await updateProduct(db, BIZ, imported, 'owner', { customerNames: many })).toEqual({ ok: false, errors: { customerNames: 'too_many' } });
    expect(await aliasesOf(imported)).toEqual(['beach bag', 'Canvas shopper', '帆布包', '帆布购物袋'].sort());
    // the same names again: nothing new, no change reported
    expect(await updateProduct(db, BIZ, imported, 'owner', { name: 'Canvas shopper', customerNames: 'Beach Bag' })).toEqual({ ok: true, changed: [] });
  });
});
