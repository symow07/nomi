import { sql } from 'kysely';
import type { Tx } from './client.js';
import { aliasRow, aliasRowsFor, cleanName, MAX_ALIAS_LENGTH } from '../core/onboard/aliases.js';
import type { CatalogueEntry } from '../core/conversation/sharedPost.js';

/**
 * T3 — the names a product is found by, written where a product gets or
 * changes a name: the import's confirm, and the owner's edit
 * (`src/core/onboard/aliases.ts` says why it matters).
 *
 * The app role may insert and update `product_aliases`, never delete (0005:
 * this system archives, it does not erase). So a name the owner changes is
 * REWRITTEN in place — the old name's row becomes the new name — and the
 * names customers use are added, never taken away here.
 */

/** Adds the names this product is not yet found by. Returns how many were written. */
export async function addAliases(tx: Tx, productId: string, names: readonly (string | null | undefined)[]): Promise<number> {
  const have = new Set((await sql<{ k: string }>`
    select lower(alias) as k from product_aliases where product_id = ${productId}::uuid`.execute(tx)).rows.map((r) => r.k));
  let wrote = 0;
  for (const row of aliasRowsFor(names)) {
    if (have.has(row.alias.toLowerCase())) continue;
    await sql`insert into product_aliases (product_id, alias, language, alias_type)
              values (${productId}::uuid, ${row.alias}, ${row.language}, ${row.aliasType})`.execute(tx);
    have.add(row.alias.toLowerCase());
    wrote++;
  }
  return wrote;
}

/**
 * A name changed from `from` to `to`: the row that said the old name now says
 * the new one. Already found by the new name — the old row is left as a name
 * customers may still use. No row for the old name (an import from before T3)
 * — the new name is added.
 */
export async function renameAlias(tx: Tx, productId: string, from: string | null, to: string | null): Promise<void> {
  const next = cleanName(to);
  if (next === null || next.length > MAX_ALIAS_LENGTH) return;
  const prev = cleanName(from);
  if (prev === next) return;
  // Another row already says the new name (a name customers use, say): nothing to move.
  const already = (await sql<{ n: number }>`
    select count(*)::int as n from product_aliases
     where product_id = ${productId}::uuid and lower(alias) = lower(${next})
       and (${prev}::text is null or lower(alias) <> lower(${prev}::text))`.execute(tx)).rows[0]!.n > 0;
  if (already) return;
  const row = aliasRow(next);
  const moved = prev === null ? 0 : Number((await sql`
    update product_aliases set alias = ${row.alias}, language = ${row.language}, alias_type = ${row.aliasType}
     where product_id = ${productId}::uuid and lower(alias) = lower(${prev})`.execute(tx)).numAffectedRows ?? 0);
  if (moved === 0) await addAliases(tx, productId, [next]);
}

/**
 * CH7 — every active product with the names it is found by: its name, its
 * Chinese name, its aliases. Read inside the tenant's transaction (aliases
 * reach the tenant through their product).
 */
export async function catalogueNames(tx: Tx, businessId: string): Promise<CatalogueEntry[]> {
  const rows = (await sql<{ id: string; name: string; name_zh: string | null; aliases: string[] | null }>`
    select p.id::text as id, p.name, p.name_zh,
           array_agg(a.alias) filter (where a.alias is not null) as aliases
      from products p left join product_aliases a on a.product_id = p.id
     where p.business_id = ${businessId}::uuid and p.is_active
     group by p.id, p.name, p.name_zh`.execute(tx)).rows;
  return rows.map((r) => ({ productId: r.id, name: r.name, names: [...(r.name_zh ? [r.name_zh] : []), ...(r.aliases ?? [])] }));
}
