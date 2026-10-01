import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * R3 (0107) — THE FIRST QUOTE OF EACH PRODUCT, OVER POSTGRES. In a workspace
 * that signed itself up a product starts unvetted; the OWNER's approval of a
 * draft that quotes it vets it (staff's does not); any change to its price —
 * a tier added, changed or removed, the product's own price or currency —
 * unvets it, by trigger; a practice copy answers for its live product; a
 * workspace the operator made, or opened as a pilot, is always vetted.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);

d('R3 · the first quote (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let bid: import('../../src/core/types/ids.js').BusinessId;
  let BIZ = '';
  let OWNER = '';
  let STAFF = '';
  let CONV = '';
  const PRODUCT = randomUUID();
  const OTHER = randomUUID();
  const q = (text: string, args: unknown[]) => admin.query(text, args);
  const asBusiness = async (business: string, product: string) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(business); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, async (tx) =>
      (await sql<{ v: boolean }>`select quote_vetted(${product}::uuid) as v`.execute(tx)).rows[0]!.v);
  };
  const vetted = (product = PRODUCT) => asBusiness(BIZ, product);
  /** A pending draft of `product`'s quote, as commitTurn leaves it. */
  const quoteDraft = async (product: string | null) => {
    const id = (await q(`insert into drafts (business_id, conversation_id, capability, draft_text) values ($1, $2, 'quote', 'That one is $12.00.') returning id::text as id`, [BIZ, CONV])).rows[0].id;
    await q(`insert into conversation_events (business_id, conversation_id, type, payload) values ($1, $2, 'draft_pending', $3)`,
      [BIZ, CONV, JSON.stringify({ draftId: id, capability: 'quote', ...(product ? { productId: product } : {}), withheld: { reason: 'first_quote' } })]);
    return id;
  };
  const decide = async (draftId: string, decidedBy: string, rawReply = '发送') => {
    const { applyOwnerCommand } = await import('../../src/pipeline/approve.js');
    return applyOwnerCommand({ db, now: () => new Date(), kickOutbound: async () => {} }, { businessId: bid, draftId, rawReply, decidedBy });
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const m = await import('../../src/db/client.js');
    db = m.createDb(DATABASE_URL!);
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const made = await provisionAccount(db, {
      factory: `R3 Lip Oils ${RUN}`, language: 'en', ownerName: 'Noor', email: `r3-${RUN}@lips.example`,
      passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
      profile: { kind: 'online_shop', sells: 'lip oils', country: 'AE', website: null, teamSize: '1', channels: [] },
    });
    if (made.code !== 'created') throw new Error(made.code);
    BIZ = made.businessId; OWNER = made.personId;
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const p = parseBusinessId(BIZ); if (!p.ok) throw new Error('fixture'); bid = p.value;
    STAFF = (await q(`insert into people (business_id, name, is_owner) values ($1, 'Sam', false) returning id::text as id`, [BIZ])).rows[0].id;
    for (const [id, sku] of [[PRODUCT, 'ROSE'], [OTHER, 'MINT']] as const) {
      await q(`insert into products (id, business_id, sku, name, unit, is_active, price_usd_per_unit, currency) values ($1, $2, $3, $4, 'item', true, 12, 'USD')`, [id, BIZ, `${sku}-${RUN}`, `${sku} lip oil`]);
      await q(`insert into price_tiers (product_id, min_qty, unit_price_usd, currency) values ($1, 1, 12, 'USD')`, [id]);
    }
    const c = (await q(`insert into clients (business_id, display_name) values ($1, 'Maya') returning id`, [BIZ])).rows[0].id;
    CONV = (await q(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'instagram') returning id::text as id`, [BIZ, c])).rows[0].id;
  }, 60_000);
  afterAll(async () => { await admin?.end(); await db?.destroy(); });

  it('A NEW PRODUCT is unvetted in a workspace that signed itself up', async () => {
    expect(await vetted()).toBe(false);
    expect(await vetted(OTHER)).toBe(false);
  });

  it('STAFF approving the quote does not vet the price', async () => {
    expect((await decide(await quoteDraft(PRODUCT), STAFF)).outcome).toBe('sent');
    expect(await vetted()).toBe(false);
  });

  it('THE OWNER approving it does — that product only — and a draft that names no product vets nothing', async () => {
    expect((await decide(await quoteDraft(null), OWNER)).outcome).toBe('sent');
    expect(await vetted()).toBe(false);
    expect((await decide(await quoteDraft(PRODUCT), OWNER)).outcome).toBe('sent');
    expect(await vetted()).toBe(true);
    expect(await vetted(OTHER)).toBe(false);
  });

  it('the owner\'s EDITED quote vets too; a rejected one does not', async () => {
    const rejected = await quoteDraft(OTHER);
    await q(`update drafts set status = 'rejected', decided_at = now() where id = $1`, [rejected]);
    expect(await vetted(OTHER)).toBe(false);
    const r = await decide(await quoteDraft(OTHER), OWNER, '改：That one is $11.50.');
    expect(r.outcome).toBe('edited_sent');
    expect((await q(`select status from drafts where conversation_id = $1 order by created_at desc limit 1`, [CONV])).rows[0].status).toBe('edited');
    expect(await vetted(OTHER)).toBe(true);
  });

  it('ANY CHANGE TO ITS PRICE unvets it, whoever writes it: a tier changed, added or removed; its own price; its currency', async () => {
    const vet = () => q(`update products set quote_vetted_at = now() where id = $1`, [PRODUCT]);
    await q(`update products set name = 'Rose lip oil, 8 ml' where id = $1`, [PRODUCT]);
    expect(await vetted()).toBe(true);
    const changes = [
      `update price_tiers set unit_price_usd = 13 where product_id = $1`,
      `insert into price_tiers (product_id, min_qty, unit_price_usd, currency) values ($1, 10, 11, 'USD')`,
      `delete from price_tiers where product_id = $1 and min_qty = 10`,
      `update products set price_usd_per_unit = 14 where id = $1`,
      `update products set currency = 'AED' where id = $1`,
    ];
    for (const change of changes) {
      await vet();
      expect(await vetted(), change).toBe(true);
      await q(change, [PRODUCT]);
      expect(await vetted(), change).toBe(false);
    }
    // The other product's price is its own.
    expect(await vetted(OTHER)).toBe(true);
  });

  it('A PRACTICE COPY answers for its live product', async () => {
    const COPY = randomUUID();
    const COPY_PRODUCT = randomUUID();
    await q(`insert into businesses (id, name, practice_of) values ($1, $2, $3)`, [COPY, `R3 practice ${RUN}`, BIZ]);
    await q(`insert into products (id, business_id, sku, name, unit, is_active, source_id) values ($1, $2, $3, 'Mint lip oil', 'item', true, $4)`, [COPY_PRODUCT, COPY, `MINT-${RUN}`, OTHER]);
    expect(await asBusiness(COPY, COPY_PRODUCT)).toBe(true);
    await q(`update price_tiers set unit_price_usd = 9 where product_id = $1`, [OTHER]);
    expect(await asBusiness(COPY, COPY_PRODUCT)).toBe(false);
  });

  it('A WORKSPACE THE OPERATOR MADE is always vetted: the ramp does not bind it', async () => {
    const OP = randomUUID();
    const OP_PRODUCT = randomUUID();
    await q(`insert into businesses (id, name) values ($1, $2)`, [OP, `R3 operator-made ${RUN}`]);
    await q(`insert into products (id, business_id, sku, name, unit, is_active) values ($1, $2, $3, 'Tote', 'item', true)`, [OP_PRODUCT, OP, `TOTE-${RUN}`]);
    expect(await asBusiness(OP, OP_PRODUCT)).toBe(true);
    // Another business's product is never this one's to vouch for.
    expect(await asBusiness(BIZ, OP_PRODUCT)).toBe(false);
  });

  it('A PILOT THE OPERATOR OPENED is vetted too, as earned_rung() treats it; the ramp\'s own stamp is not that', async () => {
    const NEW = randomUUID();
    await q(`insert into products (id, business_id, sku, name, unit, is_active) values ($1, $2, $3, 'Peach lip oil', 'item', true)`, [NEW, BIZ, `PEACH-${RUN}`]);
    await q(`update businesses set auto_earned_by = 'ramp', auto_earned_at = now() where id = $1`, [BIZ]);
    expect(await vetted(NEW)).toBe(false);
    await q(`update businesses set auto_earned_by = 'operator' where id = $1`, [BIZ]);
    expect(await vetted(NEW)).toBe(true);
  });
});
