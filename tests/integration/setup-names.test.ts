import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * Row 13 in onboarding, as the owner corrected it (2026-10-14, on #344): "require a name only for a language the owner
 * actually serves — the ones they selected, or the ones their buyers have actually written in. Everything else is a
 * suggestion, not an undone step." Real rows; the profile's own save; the list's and the product page's marks from the
 * loaders the routes use.
 *
 *   · the default list (en, zh, ar), nobody's choice, no buyer yet: the step is done; Chinese and Arabic are suggested;
 *   · a buyer who wrote in Arabic: Arabic is required — the step waits — Chinese still only suggested;
 *   · the owner's own test conversation in Chinese does not count;
 *   · the owner changes the list on the profile (0160): what they ticked is required, Russian included;
 *   · a name in the script — the Chinese name field, or one of the names customers use — answers it.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `dd750000-0000-4000-8000-${RUN}0001`;
const PID = randomUUID();
const QUIET = randomUUID();                            // deactivated, English only: never counted

d('setting up asks for a name in a language the owner chose or a buyer wrote in (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
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
  const langs = (w: readonly { lang: string }[] | undefined) => (w ?? []).map((x) => x.lang);
  const alias = (a: string, language: string) => as((t) => sql`
    insert into product_aliases (product_id, alias, language, alias_type)
    values (${PID}::uuid, ${a}, ${language}, ${language === 'zh' || language === 'ar' ? language : 'common'})`.execute(t));
  const listed = async () => {
    const { loadProductList } = await import('../../src/api/web/products.js');
    const p = (await loadProductList(db, BIZ)).find((x) => x.id === PID)!;
    return { wanted: p.namesWanted, suggested: p.namesSuggested };
  };
  const page = async () => {
    const { loadProductDetail } = await import('../../src/api/web/products.js');
    const p = (await loadProductDetail(db, BIZ, PID))!;
    return { wanted: p.namesWanted, suggested: p.namesSuggested };
  };
  /** A buyer of this workspace whose messages the analysis read as `language`; `testing`: the owner's own test. */
  const buyer = (language: string, testing = false) => as(async (t) => {
    const client = (await sql<{ id: string }>`insert into clients (business_id, phone, display_name, preferred_language)
      values (${BIZ}, ${`+9665${Math.floor(Math.random() * 9e7 + 1e7)}`}, 'Buyer', ${language}) returning id::text as id`.execute(t)).rows[0]!.id;
    await sql`insert into conversations (business_id, client_id, channel, owner_testing)
              values (${BIZ}, ${client}, 'whatsapp', ${testing})`.execute(t);
  });
  /** The profile's own save, as the form posts it. */
  const saveLanguages = async (languagesServed: string[]) => {
    const { saveBusinessProfile: saveProfile } = await import('../../src/api/web/settings.js');
    const r = await saveProfile(db, BIZ, {
      name: `Names ${RUN}`, description: 'canvas bags', location: 'Yiwu', workingHours: '',
      contactEmail: 'owner@example.com', contactPhone: '', languagesServed,
    }, 'owner');
    expect(r.code).toBe('saved');
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

  it('THE DEFAULT LIST, nobody\'s choice, no buyer yet: the step is done — Chinese and Arabic only suggested', async () => {
    const b = await as((t) => sql<{ s: string[]; chosen: Date | null }>`
      select languages_served as s, languages_chosen_at as chosen from businesses where id = ${BIZ}`.execute(t));
    expect(b.rows[0]).toEqual({ s: ['en', 'zh', 'ar'], chosen: null });
    expect(await productsDone()).toBe(true);
    expect(langs((await progress()).names)).toEqual([]);
    expect(langs((await progress()).suggested)).toEqual(['zh', 'ar']);
    expect(await listed()).toEqual({ wanted: [], suggested: ['zh', 'ar'] });
    expect(await page()).toEqual({ wanted: [], suggested: ['zh', 'ar'] });
  });

  it('the owner\'s own test conversation in Chinese is not a buyer: still nothing required', async () => {
    await buyer('zh', true);
    expect(await productsDone()).toBe(true);
    expect(langs((await progress()).names)).toEqual([]);
  });

  it('A BUYER WROTE IN ARABIC: Arabic is required — the step waits, the product is marked — Chinese still suggested', async () => {
    await buyer('ar');
    expect(await productsDone()).toBe(false);
    expect((await progress()).names).toEqual([{ lang: 'ar', missing: 1, of: 1 }]);
    expect(langs((await progress()).suggested)).toEqual(['zh']);
    expect(await listed()).toEqual({ wanted: ['ar'], suggested: ['zh'] });
    await alias('حقيبة قماشية', 'ar');
    expect(await productsDone()).toBe(true);
  });

  it('THE OWNER CHOOSES on the profile (0160): what they ticked is required, Russian included; the choice is kept', async () => {
    await saveLanguages(['en', 'zh', 'ru']);
    const b = await as((t) => sql<{ chosen: Date | null }>`select languages_chosen_at as chosen from businesses where id = ${BIZ}`.execute(t));
    expect(b.rows[0]!.chosen).not.toBeNull();
    expect(await productsDone()).toBe(false);
    // Chinese and Russian ticked; Arabic, no longer on the list, stays required because a buyer wrote in it — and has its name.
    expect(langs((await progress()).names)).toEqual(['zh', 'ru']);
    await as((t) => sql`update products set name_zh = '帆布手提袋' where id = ${PID}::uuid`.execute(t));
    await alias('холщовая сумка', 'ru');
    expect(await productsDone()).toBe(true);
    expect(await page()).toEqual({ wanted: [], suggested: [] });
  });

  it('a profile saved without changing the list is not a choice', async () => {
    const other = `dd750000-0000-4000-8000-${RUN}0002`;
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { saveBusinessProfile: saveProfile } = await import('../../src/api/web/settings.js');
    const b = parseBusinessId(other); if (!b.ok) throw new Error('fixture');
    await withTenantTx(db, b.value, (t) => sql`insert into businesses (id, name, engine) values (${other}, ${`Other ${RUN}`}, 'service')`.execute(t));
    const saved = await saveProfile(db, other, { name: `Other ${RUN}`, description: 'bags', location: 'Yiwu', workingHours: '',
      contactEmail: 'o@example.com', contactPhone: '', languagesServed: ['en', 'zh', 'ar'] }, 'owner');
    expect(saved.code).toBe('saved');
    const r = await withTenantTx(db, b.value, (t) => sql<{ chosen: Date | null }>`
      select languages_chosen_at as chosen from businesses where id = ${other}`.execute(t));
    expect(r.rows[0]!.chosen).toBeNull();
  });
});
