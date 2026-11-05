#!/usr/bin/env node
/**
 * Block 1 #9 (the finishing roadmap, 2026-11-06) — THE 59 WORKSPACES MADE BEFORE SIGN-UP ASKED.
 *
 *   MIGRATE_DATABASE_URL=<admin url> node tools/backfill-zones.mjs            # dry run: what it would change, workspace by workspace
 *   MIGRATE_DATABASE_URL=<admin url> node tools/backfill-zones.mjs --yes      # change it, in one transaction
 *
 * WHY. Until 0151 every workspace was born with Asia/Shanghai, and until 0092 with USD — nobody was asked. Sign-up asks
 * now; the workspaces from before still carry both. This reads each one's country and:
 *   · ZONE — where the country keeps ONE zone (`onlyZoneOf`), sets it (Africa/Casablanca for Morocco, Asia/Dubai for the
 *     Emirates…); where it keeps several, or the country is unknown, changes nothing and lists the workspace as FLAGGED —
 *     its profile page says the zone was set before Nomi asked (`settings.zone.unconfirmed`), and the owner picks;
 *   · CURRENCY — where the country's own money is on Nomi's list (`currencyOfCountry`) and the workspace has NO price yet
 *     (a product price, a band, a quote, an order: the same facts the profile page checks before letting a currency
 *     change), sets it; a workspace with prices keeps USD, because those prices are in it.
 * NEVER: the live workspace (Westlake, on the send path — PROGRESS 2026-10-02; `--include-live` is deliberately not an
 * option: the owner changes it on its profile page if at all), a practice copy (it follows its workspace at the next
 * refresh), a workspace that signed itself up (it was asked), or one whose zone is already not Shanghai (somebody set
 * it). Dry run unless --yes. Exit 0 done · 1 refusal or failure · 2 bad usage.
 */
import { toolClient } from './lib/db.mjs';
// The app's own tables, read from their sources (no build needed): held equal to the app by tests/parity/backfill-zones.test.ts.
import { onlyZoneOf, zonesOf, currencyOfCountry } from './lib/zoneTable.mjs';

/** The live workspace: never touched here (CLAUDE.md §4; the owner changes it on its profile page if at all). */
export const LIVE_WORKSPACE = '7dc89f42-852e-465a-920f-8af170dc83cd';

const args = process.argv.slice(2);
const write = args.includes('--yes');
const url = process.env['MIGRATE_DATABASE_URL'];
const isMain = process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].split('/').pop());
if (isMain && !url) { console.error('MIGRATE_DATABASE_URL is not set.\n\n  MIGRATE_DATABASE_URL=<admin url> node tools/backfill-zones.mjs [--yes]\n'); process.exit(2); }

/** The plan for one workspace, from its row alone. */
export function planFor(row) {
  const country = (row.country ?? '').trim().toUpperCase() || null;
  const zone = country ? onlyZoneOf(country) : null;
  const several = country ? zonesOf(country).length > 1 : false;
  const currency = country && row.currency === 'USD' && !row.has_prices ? currencyOfCountry(country) : null;
  return {
    id: row.id, name: row.name, country,
    zone: zone && zone !== row.timezone ? zone : null,
    flagged: !zone,                                   // several zones, or no country on record: the owner chooses
    why: !country ? 'no country' : several ? 'several zones' : null,
    currency: currency && currency !== row.currency ? currency : null,
    keptCurrency: row.has_prices ? 'has prices' : country && !currencyOfCountry(country) ? 'currency not on the list' : null,
  };
}

if (isMain) await main();
async function main() {
const client = toolClient(url, { replyTimeoutMs: 60_000 });
await client.connect().catch((e) => { console.error(`\n✗  ${e.message}\n`); process.exit(1); });
try {
  const role = (await client.query('select rolsuper or rolbypassrls as sees_all from pg_roles where rolname = current_user')).rows[0];
  if (!role?.sees_all) {
    console.error('\n✗  Refusing: this role is filtered by row security, so it would see no workspace and write nothing true.\n'
      + '   Run it with the admin role (MIGRATE_DATABASE_URL). Nothing was written.\n');
    process.exit(1);
  }
  const rows = (await client.query(`
    select b.id::text as id, b.name, b.country, b.timezone, b.currency,
           (exists (select 1 from products p where p.business_id = b.id and p.price_usd_per_unit is not null)
            or exists (select 1 from price_tiers t join products p on p.id = t.product_id where p.business_id = b.id)
            or exists (select 1 from quotes q where q.business_id = b.id)
            or exists (select 1 from orders o where o.business_id = b.id)) as has_prices
      from businesses b
     where b.practice_of is null
       and b.signed_up_at is null
       and b.timezone = 'Asia/Shanghai'
       and b.id <> $1::uuid
     order by b.created_at`, [LIVE_WORKSPACE])).rows;
  const plans = rows.map(planFor);
  console.log(`${write ? 'CHANGING' : 'DRY RUN'} — ${plans.length} workspace(s) made before sign-up asked (Asia/Shanghai, not the live one, not a copy, not self-served)\n`);
  for (const p of plans) {
    const zone = p.zone ? `zone → ${p.zone}` : p.flagged ? `zone FLAGGED on its profile page (${p.why})` : 'zone already right';
    const cur = p.currency ? `currency USD → ${p.currency}` : `currency kept${p.keptCurrency ? ` (${p.keptCurrency})` : ''}`;
    console.log(`  ${p.id}  ${(p.name ?? '').slice(0, 32).padEnd(32)}  ${(p.country ?? '—').padEnd(2)}  ${zone}; ${cur}`);
  }
  const changes = plans.filter((p) => p.zone || p.currency);
  console.log(`\n${changes.length} would change; ${plans.filter((p) => p.flagged).length} flagged for the owner; ${plans.length - changes.length - plans.filter((p) => p.flagged && !p.currency).length} already right.`);
  if (!write) { console.log('\nDry run: nothing was written. Add --yes to write it.'); process.exit(0); }
  await client.query('begin');
  for (const p of changes) {
    if (p.zone) await client.query(`update businesses set timezone = $2 where id = $1::uuid and timezone = 'Asia/Shanghai'`, [p.id, p.zone]);
    if (p.currency) await client.query(`update businesses set currency = $2 where id = $1::uuid and currency = 'USD'`, [p.id, p.currency]);
  }
  await client.query('commit');
  console.log(`\n✓  ${changes.length} workspace(s) changed, in one transaction.`);
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error(`\n✗  ${e.message}\n`);
  process.exit(1);
} finally {
  await client.end().catch(() => undefined);
}
}
