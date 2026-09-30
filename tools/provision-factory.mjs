#!/usr/bin/env node
/**
 * M23 — provision ONE factory tenant.
 *
 *   MIGRATE_DATABASE_URL=<admin url> node tools/provision-factory.mjs "Factory Co., Ltd" [zh] --zone=Asia/Shanghai --currency=CNY
 *
 * TZ (2026-09-30) — the workspace's time zone is REQUIRED: every "today", every
 * time the owner reads and the daily send ceiling are in it. It used to be
 * Shanghai for every tenant, a leftover of the export positioning. The owner
 * can change it later on the profile page.
 *
 * CUR (2026-09-30) — and its ONE currency, just as required: every price the
 * owner sets and every figure a customer is quoted is in it, and nothing
 * converts. It was USD for every tenant. The owner can change it on the
 * profile page until the first price is set.
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
import { toolClient } from './lib/db.mjs';

/** Must match src/demo/sandbox.ts — the one tenant a factory may never be. */
const SANDBOX_BUSINESS_ID = '5a4d0000-0000-4000-8000-0000000000b1';

const url = process.env.MIGRATE_DATABASE_URL;
// Positional: the name, then the language. The zone is a named flag, so no
// position can ever be read as an id (see below).
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const name = positional[0];
const language = positional[1] ?? 'en';
const zone = (process.argv.slice(2).find((a) => a.startsWith('--zone=')) ?? '').slice('--zone='.length);
const currency = (process.argv.slice(2).find((a) => a.startsWith('--currency=')) ?? '').slice('--currency='.length).toUpperCase();
/** Must match CURRENCIES in src/core/types/money.ts (and 0092's check). */
const CURRENCIES = ['USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR'];
const USAGE = 'usage: MIGRATE_DATABASE_URL=<admin url> node tools/provision-factory.mjs "Factory name" [en|zh|ar] --zone=<IANA zone, e.g. Europe/London> --currency=<USD|CNY|AED|SAR|BRL|MXN|INR|IDR>';

const die = (msg) => { console.error(`\n  ${msg}\n`); process.exit(1); };

if (!url) {
  die('MIGRATE_DATABASE_URL is required.\n' +
      '  Creating a tenant needs admin access — the application role is refused by RLS.\n' +
      `  ${USAGE}`);
}
if (!name || !name.trim()) {
  die('A factory name is required.\n' +
      `  ${USAGE}`);
}
if (!['en', 'zh', 'ar'].includes(language)) {
  die(`Language must be en, zh or ar (got "${language}"). The owner can change it later.`);
}
const isZone = (z) => {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(z)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch { return false; }
};
if (!CURRENCIES.includes(currency)) {
  die(`The business's currency is required, one of ${CURRENCIES.join(', ')} (got "${currency}").\n` +
      '  Every price is in it and nothing converts; the owner can change it until the first price is set.\n' +
      `  ${USAGE}`);
}
if (!isZone(zone)) {
  die(`The business's time zone is required, as an IANA name (got "${zone}").\n` +
      '  Every "today" and every time the owner reads is in it; the owner can change it later.\n' +
      `  ${USAGE}`);
}

// The id is GENERATED here, never accepted as input: an operator who can pass
// an id is an operator who can pass the sandbox's id, which is the exact
// mistake this tool exists to make impossible.
const id = randomUUID();
if (id === SANDBOX_BUSINESS_ID) die('Refusing: generated id collided with the practice sandbox.');

const client = toolClient(url, { replyTimeoutMs: 60_000 });
await client.connect().catch((e) => die(`✗ ${e.message}`));
try {
  await client.query('begin');

  // Never overwrite an existing tenant. Two factories may share a name; they
  // may not share a row.
  const clash = await client.query('select id, name from businesses where id = $1', [id]);
  if (clash.rowCount > 0) die(`Refusing: ${id} already exists (${clash.rows[0].name}).`);

  await client.query(
    `insert into businesses (id, name, timezone, currency, default_language, engine)
     values ($1, $2, $3, $4, $5, 'service')`,
    [id, name.trim(), zone, currency, language],
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
