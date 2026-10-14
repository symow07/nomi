import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';

/**
 * Two products the words fit about equally: the assistant asks which, never guesses (the owner, 2026-10-14). Real
 * repos, the real catalogue search (`retrieve_products`, `alias_match`), and a model faked to do the dangerous thing —
 * pick the FIRST product confidently and give a quantity, so a turn that trusted it would price it.
 *
 *   · «无纺布袋多少钱？» with «无纺布购物袋» and «无纺布手提袋» (0.400 each): asked which, by name; nothing priced;
 *   · «无纺布购物袋多少钱» in the same shop (1.0 against 0.4): priced, no question;
 *   · «无纺布袋多少钱？» in a shop with «无纺布购物袋» and «帆布袋» only (0.40 against 0.25): priced, no question;
 *   · "how much are the shopping bags?" with a non-woven and a canvas shopping bag: asked; "…the non-woven shopping
 *     bag?": priced.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BOTH = `dd740000-0000-4000-8000-${RUN}0001`;    // 无纺布购物袋, 无纺布手提袋, 帆布袋
const CLEAR = `dd740000-0000-4000-8000-${RUN}0002`;   // 无纺布购物袋, 帆布袋
const THREE = `dd740000-0000-4000-8000-${RUN}0003`;   // 无纺布购物袋, 无纺布手提袋, 无纺布背心袋 (the owner, on #343)

const CATALOGUE = {
  shopping: { name: 'Non-woven shopping bag', zh: '无纺布购物袋', price: 0.45 },
  tote: { name: 'Non-woven tote bag', zh: '无纺布手提袋', price: 0.60 },
  canvas: { name: 'Canvas shopping bag', zh: '帆布袋', price: 1.20 },
  vest: { name: 'Non-woven vest bag', zh: '无纺布背心袋', price: 0.30 },
} as const;

d('which product — ask when two fit about equally, never guess (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let db: import('../../src/db/client.js').Db;
  const ids: Record<string, Record<string, string>> = { [BOTH]: {}, [CLEAR]: {}, [THREE]: {} };

  const as = async <T>(biz: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };

  /** One real turn; the model confidently names `pick` and 1,000 pieces — what the turn must not simply trust. */
  const turn = async (biz: string, pick: string, text: string) => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { hybridRetriever } = await import('../../src/retrieval/hybrid.js');
    const { computeTurn, commitTurn } = await import('../../src/pipeline/turn.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    const conv = await as(biz, async (t) => {
      const client = (await sql<{ id: string }>`insert into clients (business_id, phone, display_name)
        values (${biz}, ${`+86139${RUN.replace(/\D/g, '').padEnd(4, '1').slice(0, 4)}${Math.floor(Math.random() * 9000 + 1000)}`}, 'Chen')
        returning id::text as id`.execute(t)).rows[0]!.id;
      return (await tenantRepos(t, b.value).conversations.create(client as never, 'whatsapp')).conversationId;
    });
    const analyzer = new FakeAnalyzer();
    analyzer.next = {
      language: { detected: 'zh', replyIn: 'zh' },
      intent: {
        primary: 'price_request',
        productCandidate: { productId: pick as never, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
        quantityMentioned: { value: 1000, unit: 'pcs' }, nextLogicalQuestion: null, missingFields: [],
      },
      recommendedPhase: 'commercial_discussion',
    };
    const writer = new FakeReplyWriter();
    writer.replies = ['Here is the price for 1,000.'];
    const req = { conversationId: conv as never, messageId: `wp-${randomUUID()}`, text };
    return as(biz, async (t) => {
      const ports = { tenant: tenantRepos(t, b.value), retriever: hybridRetriever(t, b.value), analyzer, replyWriter: writer, now: () => new Date() };
      const r = await computeTurn(ports, req);
      await commitTurn(ports, req, r, Date.now());
      return { r, writerAsked: writer.calls };
    });
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { aliasRowsFor } = await import('../../src/core/onboard/aliases.js');
    db = createDb(DATABASE_URL!);
    for (const [biz, keys] of [[BOTH, ['shopping', 'tote', 'canvas']], [CLEAR, ['shopping', 'canvas']],
                               [THREE, ['shopping', 'tote', 'vest']]] as const) {
      await as(biz, async (t) => {
        await sql`insert into businesses (id, name, engine) values (${biz}, ${`Bags ${RUN}`}, 'service') on conflict (id) do nothing`.execute(t);
        await sql`insert into pricing_policy (business_id, product_id, floor_price_usd, currency, max_discount_pct, human_required_above_pct)
                  values (${biz}, null, 0.10, 'USD', 10, 7)`.execute(t);
        for (const k of keys) {
          const p = CATALOGUE[k];
          const id = randomUUID();
          ids[biz]![k] = id;
          await sql`insert into products (id, business_id, sku, name, name_zh, unit, moq, price_usd_per_unit, currency, is_active)
                    values (${id}, ${biz}, ${`${k}-${RUN}`}, ${p.name}, ${p.zh}, 'pcs', 100, ${p.price}, 'USD', true)`.execute(t);
          await sql`insert into price_tiers (product_id, min_qty, unit_price_usd, currency) values (${id}, 1, ${p.price}, 'USD')`.execute(t);
          for (const a of aliasRowsFor([p.name, p.zh])) {
            await sql`insert into product_aliases (product_id, alias, language, alias_type)
                      values (${id}, ${a.alias}, ${a.language}, ${a.aliasType})`.execute(t);
          }
        }
      });
    }
  }, 60_000);
  afterAll(async () => { await db?.destroy(); });

  it('GENUINELY AMBIGUOUS — «无纺布袋多少钱？», 无纺布购物袋 and 无纺布手提袋: asked which, by their Chinese names; nothing priced', async () => {
    const { r, writerAsked } = await turn(BOTH, ids[BOTH]!['shopping']!, '无纺布袋多少钱？');
    expect(r.reply).toContain('无纺布购物袋');
    expect(r.reply).toContain('无纺布手提袋');
    expect(r.reply).toMatch(/哪一款/);
    expect(r.quote, 'no price worked out').toBeNull();
    expect(r.decision.product).toBeNull();
    expect(writerAsked, 'the writer is not asked to answer it').toBe(0);
  });

  it('NOT AMBIGUOUS — the whole name, in the same shop: priced, no question', async () => {
    const { r } = await turn(BOTH, ids[BOTH]!['shopping']!, '无纺布购物袋多少钱');
    expect(r.reply ?? '').not.toMatch(/哪一款/);
    expect(r.quote?.unitPrice.amount).toBe(0.45);
  });

  it('NOT AMBIGUOUS — «无纺布袋多少钱？» where only 无纺布购物袋 is non-woven (帆布袋 trails): priced, no question', async () => {
    const { r } = await turn(CLEAR, ids[CLEAR]!['shopping']!, '无纺布袋多少钱？');
    expect(r.reply ?? '').not.toMatch(/哪一款/);
    expect(r.quote?.unitPrice.amount).toBe(0.45);
  });

  it('THREE CLOSE — «无纺布袋多少钱？» with 无纺布购物袋, 无纺布手提袋 and 无纺布背心袋: all three named; nothing priced', async () => {
    const { r, writerAsked } = await turn(THREE, ids[THREE]!['shopping']!, '无纺布袋多少钱？');
    for (const name of ['无纺布购物袋', '无纺布手提袋', '无纺布背心袋']) expect(r.reply, name).toContain(name);
    expect(r.reply).toMatch(/哪一款/);
    expect(r.quote).toBeNull();
    expect(writerAsked).toBe(0);
  });

  it('English too: "the shopping bags" fits a non-woven and a canvas one — asked; "the non-woven shopping bag" — priced', async () => {
    const asked = await turn(BOTH, ids[BOTH]!['shopping']!, 'how much are the shopping bags?');
    expect(asked.r.quote).toBeNull();
    expect(asked.r.reply).toMatch(/Non-woven shopping bag|Canvas shopping bag/);
    const priced = await turn(BOTH, ids[BOTH]!['shopping']!, 'how much is the non-woven shopping bag?');
    expect(priced.r.quote?.unitPrice.amount).toBe(0.45);
  });
});
