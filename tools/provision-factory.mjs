#!/usr/bin/env node
/**
 * M23 — provision ONE factory tenant.
 *
 *   MIGRATE_DATABASE_URL=<admin url> node tools/provision-factory.mjs "Factory Co., Ltd" [zh]
 *
 * WHAT THIS IS. A transcription-error remover. The procedure it replaces was
 * hand-written SQL with a hand-generated UUID that then had to be copied
 * exactly into PILOT_BUSINESS_ID — and a single wrong character produces an
 * orphan tenant whose owner sees an empty factory and cannot add a product.
 * That is not hypothetical: live production had no factory at all, and
 * PILOT_BUSINESS_ID pointed at a business that did not exist.
 *
 * WHAT THIS IS NOT. Not a signup flow, not a route, not a permission change.
 * Creating a tenant requires ADMIN database access and always will: the
 * application role is blocked by RLS from inserting into `businesses`
 * (`with check (id = current_business_id())`). That is a security property, and
 * this tool does not weaken it — it uses MIGRATE_DATABASE_URL, exactly as
 * migrate.mjs does, and refuses to run without it.
 *
 * A NEW FACTORY STARTS EMPTY. No products, no knowledge, no claims, no
 * conversations, no channel row. Every readiness item is false and stays false
 * until the owner does the work; M15 readiness derives from real rows, so a
 * seeded head start would be a lie the product then reports as progress.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/** Must match src/demo/sandbox.ts — the one tenant a factory may never be. */
const SANDBOX_BUSINESS_ID = '5a4d0000-0000-4000-8000-0000000000b1';

const url = process.env.MIGRATE_DATABASE_URL;
const name = process.argv[2];
const language = process.argv[3] ?? 'en';

const die = (msg) => { console.error(`\n  ${msg}\n`); process.exit(1); };

if (!url) {
  die('MIGRATE_DATABASE_URL is required.\n' +
      '  Creating a tenant needs admin access — the application role is refused by RLS.\n' +
      '  usage: MIGRATE_DATABASE_URL=<admin url> node tools/provision-factory.mjs "Factory name" [en|zh|ar]');
}
if (!name || !name.trim()) {
  die('A factory name is required.\n' +
      '  usage: MIGRATE_DATABASE_URL=<admin url> node tools/provision-factory.mjs "Factory name" [en|zh|ar]');
}
if (!['en', 'zh', 'ar'].includes(language)) {
  die(`Language must be en, zh or ar (got "${language}"). The owner can change it later.`);
}

// The id is GENERATED here, never accepted as input: an operator who can pass
// an id is an operator who can pass the sandbox's id, which is the exact
// mistake this tool exists to make impossible.
const id = randomUUID();
if (id === SANDBOX_BUSINESS_ID) die('Refusing: generated id collided with the practice sandbox.');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('begin');

  // Never overwrite an existing tenant. Two factories may share a name; they
  // may not share a row.
  const clash = await client.query('select id, name from businesses where id = $1', [id]);
  if (clash.rowCount > 0) die(`Refusing: ${id} already exists (${clash.rows[0].name}).`);

  await client.query(
    `insert into businesses (id, name, timezone, default_language, engine)
     values ($1, $2, 'Asia/Shanghai', $3, 'service')`,
    [id, name.trim(), language],
  );

  // No channels row on purpose: "not connected" is the ABSENCE of a connected
  // channel, derived by the read model (M20.3.1). Inserting one here would
  // manufacture a lifecycle state the owner never chose.

  const readiness = await client.query(
    `select
       coalesce((select (description is not null and location is not null
                         and (contact_email is not null or contact_phone is not null))
                 from businesses where id = $1), false)                         as profile,
       exists(select 1 from products where business_id = $1 and is_active
                and price_usd_per_unit is not null)                             as products,
       exists(select 1 from product_knowledge where business_id = $1 and status = 'active'
                and source in ('owner_confirmed','owner_corrected'))            as knowledge,
       exists(select 1 from claims_policy where business_id = $1 and allowed)   as claims,
       exists(select 1 from channels where business_id = $1 and kind = 'whatsapp'
                and status = 'connected')                                       as channel,
       exists(select 1 from pilot_allowlist where business_id = $1
                and archived_at is null)                                        as allowlist`,
    [id],
  );

  await client.query('commit');

  const r = readiness.rows[0];
  const mark = (v) => (v ? '✓' : '○');
  const allEmpty = Object.values(r).every((v) => v === false);

  console.log(`\n  Factory provisioned: ${name.trim()}\n`);
  console.log('  Set this in the deployment environment, exactly:\n');
  console.log(`      PILOT_BUSINESS_ID=${id}\n`);
  console.log('  It starts empty, and every item below is derived from real rows —');
  console.log('  nothing here can be ticked on the owner\'s behalf:\n');
  console.log(`      ${mark(r.profile)} business profile`);
  console.log(`      ${mark(r.products)} products with prices`);
  console.log(`      ${mark(r.knowledge)} taught knowledge`);
  console.log(`      ${mark(r.claims)} claims reviewed`);
  console.log(`      ${mark(r.allowlist)} pilot allowlist`);
  console.log(`      ${mark(r.channel)} WhatsApp connected   (needs Meta — see GO-LIVE.md)\n`);

  if (!allEmpty) {
    console.error('  WARNING: a freshly provisioned factory reported something as done.');
    console.error('  That should be impossible. Investigate before handing this to an owner.\n');
    process.exit(1);
  }

  console.log('  Next: docs/FIRST-FACTORY-WORKFLOW.md — stage 0 is verifying tenant identity.');
  console.log('  The deployment will REFUSE to boot until PILOT_BUSINESS_ID names this row,');
  console.log('  and refuses outright if it ever names the practice sandbox.\n');
} catch (e) {
  await client.query('rollback').catch(() => {});
  throw e;
} finally {
  await client.end();
}
