import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * D1 — the first thing every new business hit. She pasted a price list,
 * answered "what is the least you would accept?" ONCE for everything, as the
 * page invites — and her catalogue stayed switched off, every product reading
 * "Needs a price" beside its price, with the per-product forms gone. Found
 * setting up a demo business on the live site (docs/SITE-REVIEW-2026-09-18.md).
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `d1550000-0000-4000-8000-${RUN}0001`;
const sku = (n: string) => `D1-${RUN}-${n}`.toUpperCase();

d('D1 · her answer for everything covers everything it can (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  const tx = async <R>(fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const states = async () => {
    const { loadProductList } = await import('../../src/api/web/products.js');
    return Object.fromEntries((await loadProductList(db, BIZ)).map((p) => [p.sku, p.status]));
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    await tx((x) => sql`insert into businesses (id, name) values (${BIZ}, ${`Imported ${RUN}`}) on conflict (id) do nothing`.execute(x));
  }, 60_000);
  afterAll(async () => { await db?.destroy(); });

  it('an import with no answer yet is still switched off — and says WHICH thing each line is missing', async () => {
    const { confirmImport } = await import('../../src/api/web/products.js');
    const r = await confirmImport(db, BIZ, [
      `${sku('tote')} Canvas tote $1.05 MOQ 500`,
      `${sku('cheap')} Sticker $0.30 MOQ 1000`,
      `${sku('hers')} Jute bag $2.00 MOQ 500`,
      `${sku('tbd')} Mystery item MOQ 100`,
    ].join('\n'));
    expect(r).toMatchObject({ added: 4, withPrice: 3, ready: 0 });
    expect(await states()).toEqual({
      [sku('tote')]: 'needs_limits', [sku('cheap')]: 'needs_limits', [sku('hers')]: 'needs_limits', [sku('tbd')]: 'needs_price',
    });
  });

  it('SHE ANSWERS ONCE, FOR EVERYTHING — and what it covers is switched on; what it cannot cover, and what she decided herself, is not', async () => {
    const { savePriceRules } = await import('../../src/api/web/priceRules.js');
    // One she has already decided about: touched after the import, and off.
    await tx((x) => sql`update products set updated_at = created_at + interval '1 second', is_active = false
                         where business_id = ${BIZ} and sku = ${sku('hers')}`.execute(x));

    const saved = await savePriceRules(db, BIZ, 'owner', { productId: null, floor: '0.40', maxDiscountPct: '10', askAbovePct: '5' });
    expect(saved).toMatchObject({ ok: true, activated: true, activatedCount: 1 });
    expect(await states()).toEqual({
      [sku('tote')]: 'learned',            // priced, at or above her floor, untouched → on
      [sku('cheap')]: 'not_offered',       // her floor is ABOVE its price: her answer cannot cover it
      [sku('hers')]: 'not_offered',        // she switched it off herself; an answer does not switch it back
      [sku('tbd')]: 'needs_price',
    });

    const again = await savePriceRules(db, BIZ, 'owner', { productId: null, floor: '0.40', maxDiscountPct: '10', askAbovePct: '5' });
    expect(again, 'saving the same answer again switches nothing else on').toMatchObject({ ok: true, activatedCount: 0 });

    const audit = await tx((x) => sql<{ detail: { scope: string; activatedCount: number } }>`
      select detail from channel_audit where business_id = ${BIZ} and action = 'price_rules_set' order by at asc limit 1`.execute(x));
    expect(audit.rows[0]!.detail).toMatchObject({ scope: 'business_default', activatedCount: 1 });
  });

  it('WHAT HER ANSWER COVERS STAYS ON THE PAGE, and what it cannot cover still asks for its own', async () => {
    const { loadPriceRules, renderPriceRules } = await import('../../src/api/web/priceRules.js');
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const html = renderPriceRules(await loadPriceRules(db, BIZ), 'en', null, {}, { productId: null });
    expect(html).toContain(t('en', 'prices.inherited.title'));
    const covered = html.slice(html.indexOf(t('en', 'prices.inherited.title')));
    expect(covered).toContain('Canvas tote');
    expect(covered).toContain(t('en', 'prices.inherited.own'));
    expect(covered, 'a covered product offers a link, not an open form').not.toContain(`name="productId" value=`);
    const needing = html.slice(0, html.indexOf(t('en', 'prices.inherited.title')));
    expect(needing, 'the one her floor is above still needs an answer of its own').toContain('Sticker');
  });

  it('A LATER IMPORT ARRIVES READY where her answer already covers it, and says so', async () => {
    const { confirmImport, importFlash } = await import('../../src/api/web/products.js');
    const r = await confirmImport(db, BIZ, `${sku('pouch')} Zipper pouch $0.90 MOQ 800`);
    expect(r).toMatchObject({ added: 1, withPrice: 1, ready: 1 });
    expect((await states())[sku('pouch')]).toBe('learned');
    expect(importFlash(r).map((p) => t('en', p.key, p.params)).join(' ')).toContain('1 are ready');

    const low = await confirmImport(db, BIZ, `${sku('pin')} Badge pin $0.10 MOQ 2000`);
    expect(low).toMatchObject({ added: 1, withPrice: 1, ready: 0 });
    expect((await states())[sku('pin')], 'below her floor: never switched on by an import').toBe('not_offered');
    expect(importFlash(low).map((p) => t('en', p.key, p.params)).join(' ')).not.toContain('ready');
  });
});
