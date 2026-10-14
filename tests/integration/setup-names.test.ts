import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * Row 13 in onboarding (the owner, 2026-10-14): the products step of setting up waits until every active product has
 * a name in each served language written in its own script. Real rows, the real `~` over the same pattern the page
 * reads; the list's and the product page's marks from the same loaders the routes use.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `dd750000-0000-4000-8000-${RUN}0001`;    // serves en, zh, ar — the default
const PID = randomUUID();
const QUIET = randomUUID();                            // deactivated, English only: not counted

d('setting up waits for a name in each script the buyers write (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let db: import('../../src/db/client.js').Db;

  const as = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const progress = async () => {
    const { setupProgress } = await import('../../src/db/setup.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return as((t) => setupProgress(t, b.value));
  };
  const productsDone = async () => (await progress()).steps.find((s) => s.step === 'products')!.done;
  const alias = (pid: string, a: string, language: string) => as((t) => sql`
    insert into product_aliases (product_id, alias, language, alias_type) values (${pid}::uuid, ${a}, ${language}, ${language === 'zh' || language === 'ar' ? language : 'common'})`.execute(t));
  const listed = async () => {
    const { loadProductList } = await import('../../src/api/web/products.js');
    return (await loadProductList(db, BIZ)).find((p) => p.id === PID)!.namesWanted;
  };
  const page = async () => {
    const { loadProductDetail } = await import('../../src/api/web/products.js');
    return (await loadProductDetail(db, BIZ, PID))!.namesWanted;
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    await as(async (t) => {
      await sql`insert into businesses (id, name, engine) values (${BIZ}, ${`Names ${RUN}`}, 'service') on conflict (id) do nothing`.execute(t);
      for (const [id, active] of [[PID, true], [QUIET, false]] as const) {
        await sql`insert into products (id, business_id, sku, name, unit, moq, price_usd_per_unit, currency, is_active)
                  values (${id}, ${BIZ}, ${`CT-${RUN}-${active}`}, 'Canvas tote', 'pcs', 100, 1.20, 'USD', ${active})`.execute(t);
        await sql`insert into product_aliases (product_id, alias, language, alias_type) values (${id}, 'canvas tote', 'und', 'common')`.execute(t);
      }
    });
  }, 60_000);
  afterAll(async () => { await db?.destroy(); });

  it('the default languages (en, zh, ar), a product named only in English: the step waits, and says for which', async () => {
    const served = await as((t) => sql<{ s: string[] }>`select languages_served as s from businesses where id = ${BIZ}`.execute(t));
    expect(served.rows[0]!.s).toEqual(['en', 'zh', 'ar']);
    expect(await productsDone()).toBe(false);
    expect((await progress()).names).toEqual([{ lang: 'zh', missing: 1, of: 1 }, { lang: 'ar', missing: 1, of: 1 }]);
    expect(await listed()).toEqual(['zh', 'ar']);
    expect(await page()).toEqual(['zh', 'ar']);
  });

  it('its Chinese name — the field — answers Chinese; Arabic still waits', async () => {
    await as((t) => sql`update products set name_zh = '帆布袋' where id = ${PID}::uuid`.execute(t));
    expect(await productsDone()).toBe(false);
    expect((await progress()).names).toEqual([{ lang: 'ar', missing: 1, of: 1 }]);
    expect(await listed()).toEqual(['ar']);
  });

  it('an Arabic name among the names customers use: the step is done, nothing is marked', async () => {
    await alias(PID, 'حقيبة قماشية', 'ar');
    expect(await productsDone()).toBe(true);
    expect((await progress()).names).toEqual([]);
    expect(await listed()).toEqual([]);
    expect(await page()).toEqual([]);
  });

  it('Russian served too: Cyrillic is asked for; a Chinese name is no Russian one', async () => {
    await as((t) => sql`update businesses set languages_served = array['en','zh','ar','ru'] where id = ${BIZ}`.execute(t));
    expect(await productsDone()).toBe(false);
    expect((await progress()).names).toEqual([{ lang: 'ru', missing: 1, of: 1 }]);
    await alias(PID, 'холщовая сумка', 'ru');
    expect(await productsDone()).toBe(true);
  });

  it('a workspace that serves only Latin-script languages asks for nothing; a name in its own Chinese alias counts as well', async () => {
    await as((t) => sql`update businesses set languages_served = array['en','es','fr'] where id = ${BIZ}`.execute(t));
    expect((await progress()).names).toEqual([]);
    await as((t) => sql`update businesses set languages_served = array['en','zh'] where id = ${BIZ}`.execute(t));
    await as((t) => sql`update products set name_zh = null where id = ${PID}::uuid`.execute(t));
    expect(await productsDone()).toBe(false);
    await alias(PID, '帆布手提袋', 'zh');
    expect(await productsDone()).toBe(true);
  });
});
