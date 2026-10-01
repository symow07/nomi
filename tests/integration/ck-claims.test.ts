import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * CK (0110) — CLAIMS BY PRODUCT CATEGORY, OVER POSTGRES. A workspace that
 * signed itself up has every product claim refused until the owner switches
 * it on through How you sell, which also keeps what the shop sells; one the
 * operator made and nobody categorised keeps saying what it said before,
 * until its owner picks a category; a practice copy answers as its workspace.
 * Read through the tenant repository the turn uses.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);

d('CK · claims by product category (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let SELF = '';
  const OP = randomUUID();
  const q = (text: string, args: unknown[]) => admin.query(text, args);
  const asBiz = async <T,>(business: string, fn: (tx: import('../../src/db/client.js').Tx, bid: import('../../src/core/types/ids.js').BusinessId) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(business); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, (tx) => fn(tx, b.value));
  };
  /** Would a reply that says `text` pass the claims guard, for this workspace, as the turn asks it? */
  const passes = async (business: string, text: string) => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { guardClaims } = await import('../../src/core/safety/claims.js');
    return asBiz(business, async (tx, bid) => guardClaims({ reply: text, policy: await tenantRepos(tx, bid).catalog.claimsPolicy() }).ok);
  };
  /** How you sell's "What you sell", answered and every line saved, as the route does. */
  const answer = async (business: string, body: Record<string, string>) => {
    const { parseAnswer, linesFor } = await import('../../src/core/owner/howYouSell.js');
    const { loadSellingState, applyLines } = await import('../../src/db/howYouSell.js');
    const r = parseAnswer('product_claims', body, { profile: 'retail', pricesToOwner: false });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    await asBiz(business, async (tx, bid) => {
      const lines = linesFor(r.answer, await loadSellingState(tx, bid));
      await applyLines(tx, bid, 'product_claims', lines, 'owner', { label: 'x', language: 'en' });
    });
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const m = await import('../../src/db/client.js');
    db = m.createDb(DATABASE_URL!);
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const made = await provisionAccount(db, {
      factory: `CK Glow ${RUN}`, language: 'en', ownerName: 'Mina', email: `ck-${RUN}@glow.example`,
      passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
      profile: { kind: 'brand', sells: 'skincare', country: 'AE', website: null, teamSize: '1', channels: [] },
    });
    if (made.code !== 'created') throw new Error(made.code);
    SELF = made.businessId;
    await q(`insert into businesses (id, name) values ($1, $2)`, [OP, `CK operator-made ${RUN}`]);
  }, 60_000);
  afterAll(async () => { await admin?.end(); await db?.destroy(); });

  it('A SELF-SERVE WORKSPACE: every product claim refused until switched on', async () => {
    expect(await passes(SELF, 'Yes, this serum is vegan.')).toBe(false);
    expect(await passes(SELF, 'It is safe during pregnancy.')).toBe(false);
    expect(await passes(SELF, 'It comes in three sizes.')).toBe(true);
  });

  it('HOW YOU SELL: the category kept, the ticked claims allowed, the rest of its pack refused', async () => {
    await answer(SELF, { category: 'cosmetics', 'attr:vegan': 'on', 'attr:cruelty_free': 'on' });
    expect((await q(`select product_category from businesses where id = $1`, [SELF])).rows[0].product_category).toBe('cosmetics');
    expect(await passes(SELF, 'Yes, this serum is vegan and cruelty-free.')).toBe(true);
    expect(await passes(SELF, 'It is halal.')).toBe(false);
    const rows = (await q(`select claim_key, allowed from claims_policy where business_id = $1 and kind = 'product_attribute' order by claim_key`, [SELF])).rows;
    expect(rows.filter((r) => r.allowed).map((r) => r.claim_key)).toEqual(['cruelty_free', 'vegan']);
    // Answered again without vegan: switched off.
    await answer(SELF, { category: 'cosmetics', 'attr:cruelty_free': 'on' });
    expect(await passes(SELF, 'This serum is vegan.')).toBe(false);
  });

  it('AN OPERATOR-MADE WORKSPACE nobody categorised keeps what it said before — until its owner picks', async () => {
    expect(await passes(OP, 'The tote is 100% cotton and waterproof.')).toBe(true);
    await answer(OP, { category: 'apparel', 'attr:cotton_100': 'on' });
    expect(await passes(OP, 'The tote is 100% cotton.')).toBe(true);
    expect(await passes(OP, 'The tote is waterproof.')).toBe(false);
  });

  it('A PRACTICE COPY answers as its workspace', async () => {
    const COPY = randomUUID();
    await q(`insert into businesses (id, name, practice_of) values ($1, $2, $3)`, [COPY, `CK practice ${RUN}`, SELF]);
    expect(await passes(COPY, 'It is hypoallergenic.')).toBe(false);
  });
});
