import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * VAR (0111, decision 31) — A PRODUCT'S OPTIONS, OVER POSTGRES. The owner's
 * edit saves them whole (one bad line refuses them all, nothing written) and
 * on the audit trail; the turn's repository reads them, a practice copy reads
 * its live product's, and no other workspace reads them at all. A question
 * about stock is a signal and a hand-off reason the database accepts.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);

d('VAR · options (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let BIZ = '';
  let OWNER = '';
  const PID = randomUUID();
  const q = (text: string, args: unknown[]) => admin.query(text, args);
  const optionsAs = async (business: string, product: string) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(business); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, (tx) => tenantRepos(tx, b.value).catalog.productOptions(product));
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const m = await import('../../src/db/client.js');
    db = m.createDb(DATABASE_URL!);
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const made = await provisionAccount(db, {
      factory: `VAR Threads ${RUN}`, language: 'en', ownerName: 'Lea', email: `var-${RUN}@threads.example`,
      passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
      profile: { kind: 'brand', sells: 'dresses', country: 'AE', website: null, teamSize: '1', channels: [] },
    });
    if (made.code !== 'created') throw new Error(made.code);
    BIZ = made.businessId; OWNER = made.personId;
    await q(`insert into products (id, business_id, sku, name, unit, is_active) values ($1, $2, $3, 'Wrap dress', 'item', true)`, [PID, BIZ, `WD-${RUN}`]);
  }, 60_000);
  afterAll(async () => { await admin?.end(); await db?.destroy(); });

  it('THE OWNER SAVES THEM, whole, and on the audit trail', async () => {
    const { updateProduct, loadProductDetail } = await import('../../src/api/web/products.js');
    const r = await updateProduct(db, BIZ, PID, OWNER, { options: 'Size: S, M, L\nColour: red, navy' });
    expect(r).toEqual({ ok: true, changed: ['options'] });
    const want = [{ name: 'Size', values: ['S', 'M', 'L'] }, { name: 'Colour', values: ['red', 'navy'] }];
    expect((await q(`select options from products where id = $1`, [PID])).rows[0].options).toEqual(want);
    expect((await loadProductDetail(db, BIZ, PID))?.options).toEqual(want);
    const audit = (await q(`select detail from channel_audit where business_id = $1 and action = 'product_edited' order by at desc limit 1`, [BIZ])).rows[0].detail;
    expect(audit.changes.options).toEqual({ from: '', to: 'Size: S, M, L · Colour: red, navy' });
  });

  it('ONE BAD LINE refuses them all, and nothing is written', async () => {
    const { updateProduct } = await import('../../src/api/web/products.js');
    expect(await updateProduct(db, BIZ, PID, OWNER, { options: 'Size: S, M\nred, navy' })).toEqual({ ok: false, errors: { options: 'no_name' } });
    expect((await q(`select options from products where id = $1`, [PID])).rows[0].options).toHaveLength(2);
  });

  it('THE TURN READS THEM; a practice copy reads its live product\'s; no other workspace reads them', async () => {
    expect(await optionsAs(BIZ, PID)).toEqual([{ name: 'Size', values: ['S', 'M', 'L'] }, { name: 'Colour', values: ['red', 'navy'] }]);
    const COPY = randomUUID();
    const COPY_P = randomUUID();
    await q(`insert into businesses (id, name, practice_of) values ($1, $2, $3)`, [COPY, `VAR practice ${RUN}`, BIZ]);
    await q(`insert into products (id, business_id, sku, name, unit, is_active, source_id) values ($1, $2, $3, 'Wrap dress', 'item', true, $4)`, [COPY_P, COPY, `WD-${RUN}`, PID]);
    expect((await optionsAs(COPY, COPY_P)).map((o) => o.name)).toEqual(['Size', 'Colour']);
    const OTHER = randomUUID();
    await q(`insert into businesses (id, name) values ($1, $2)`, [OTHER, `VAR other ${RUN}`]);
    expect(await optionsAs(OTHER, PID)).toEqual([]);
  });

  it('A QUESTION ABOUT STOCK is a signal and a hand-off reason the database accepts', async () => {
    const c = (await q(`insert into clients (business_id, display_name) values ($1, 'Rana') returning id`, [BIZ])).rows[0].id;
    const conv = (await q(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'instagram') returning id`, [BIZ, c])).rows[0].id;
    await q(`insert into conversation_signals (business_id, conversation_id, kind) values ($1, $2, 'stock_asked')`, [BIZ, conv]);
    expect((await q(`select count(*)::int as n from conversation_signals where conversation_id = $1 and kind = 'stock_asked'`, [conv])).rows[0].n).toBe(1);
  });
});
