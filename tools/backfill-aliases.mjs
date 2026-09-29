#!/usr/bin/env node
/**
 * T3 — make ONE workspace's products findable by their own names.
 *
 *   MIGRATE_DATABASE_URL=<admin url> node tools/backfill-aliases.mjs --business <uuid>         # dry run: what it would add
 *   MIGRATE_DATABASE_URL=<admin url> node tools/backfill-aliases.mjs --business <uuid> --yes   # add it
 *
 * WHY. A customer's words reach a product only through `product_aliases`, and
 * the import wrote none before T3 — so a product imported before it can never
 * be found, offered or quoted (`src/core/onboard/aliases.ts`). From T3 on the
 * import and the owner's edit write them; this adds them for what came before.
 *
 * WHAT IT DOES. For each product of the one business: its name and its
 * Chinese name, cleaned exactly as the app cleans them (`tools/lib/aliases.mjs`,
 * held equal to the app's by a test), added where the product is not already
 * found by that name. Nothing else: no customer names are invented, nothing
 * is removed or changed, and a second run adds nothing. Dry run unless --yes;
 * with --yes, one transaction.
 *
 * On the live workspace ONLY with the owner's yes, and after a backup younger
 * than the day (CLAUDE.md §2) — it writes what customers' words are matched
 * against.
 *
 * Exit 0 done · 1 refusal or failure · 2 bad usage.
 */
import { toolClient } from './lib/db.mjs';
import { aliasRowsFor } from './lib/aliases.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const has = (name) => args.includes(`--${name}`);
const usage = (msg) => {
  console.error(`${msg}\n\n  MIGRATE_DATABASE_URL=<admin url> node tools/backfill-aliases.mjs --business <uuid> [--yes]\n`);
  process.exit(2);
};

const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) usage('MIGRATE_DATABASE_URL is not set.');
const business = flag('business');
if (!business || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(business)) usage('--business must be a uuid.');
const write = has('yes');

const client = toolClient(url, { replyTimeoutMs: 60_000 });
await client.connect().catch((e) => { console.error(`\n✗  ${e.message}\n`); process.exit(1); });
try {
  const role = (await client.query(
    'select rolsuper or rolbypassrls as sees_all from pg_roles where rolname = current_user')).rows[0];
  if (!role?.sees_all) {
    console.error('\n✗  Refusing: this role is filtered by row security, so it would see no product and write nothing true.\n'
      + '   Run it with the admin role (MIGRATE_DATABASE_URL). Nothing was written.\n');
    process.exit(1);
  }
  const biz = (await client.query('select name from businesses where id = $1', [business])).rows[0];
  if (!biz) { console.error(`\n✗  No business ${business}. Nothing was written.\n`); process.exit(1); }

  const products = (await client.query(
    `select p.id::text as id, p.name, p.name_zh, p.is_active,
            coalesce(array_agg(lower(a.alias)) filter (where a.alias is not null), '{}') as have
       from products p left join product_aliases a on a.product_id = p.id
      where p.business_id = $1
      group by p.id order by p.name`, [business])).rows;

  const plan = [];
  for (const p of products) {
    const have = new Set(p.have);
    const add = aliasRowsFor([p.name, p.name_zh]).filter((r) => !have.has(r.alias.toLowerCase()));
    if (add.length > 0) plan.push({ product: p, add, found: p.have.length > 0 });
  }

  console.log(`\n  ${biz.name}: ${products.length} product${products.length === 1 ? '' : 's'}.`);
  const unfound = plan.filter((x) => !x.found).length;
  console.log(`  ${unfound} can be found by no name at all today; ${plan.length} would gain a name.\n`);
  for (const x of plan) {
    console.log(`    ${x.found ? '·' : '✗'} ${x.product.name}${x.product.is_active ? '' : '  (not offered)'}  +  ${x.add.map((r) => `“${r.alias}”`).join(', ')}`);
  }
  if (plan.length === 0) {
    console.log('  Nothing to add.\n');
  } else if (!write) {
    console.log('\n  Dry run: nothing was written. Add --yes to write these names.\n');
  } else {
    await client.query('begin');
    let wrote = 0;
    for (const x of plan) {
      for (const r of x.add) {
        await client.query(
          'insert into product_aliases (product_id, alias, language, alias_type) values ($1, $2, $3, $4)',
          [x.product.id, r.alias, r.language, r.aliasType]);
        wrote++;
      }
    }
    await client.query('commit');
    console.log(`\n✓  ${wrote} name${wrote === 1 ? '' : 's'} written for ${plan.length} product${plan.length === 1 ? '' : 's'}. Nothing was removed.\n`);
  }
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error(`\n✗  ${e instanceof Error ? e.message : String(e)}\n   Nothing was written.\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
