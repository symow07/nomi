#!/usr/bin/env node
/**
 * A1 — make ONE invitation a factory can sign itself up with.
 *
 *   MIGRATE_DATABASE_URL=<admin url> node tools/invite-factory.mjs "who it is for" [days]
 *
 * WHAT THIS IS. The operator's half of SIGNUP_MODE=invite (the default). It
 * writes one row in `signup_invites` and prints the link to send. The factory
 * opens it, types its name, an e-mail and a password, and its workspace exists
 * — no redeploy, no PILOT_BUSINESS_ID, nobody copying a UUID by hand.
 *
 * WHY IT NEEDS ADMIN ACCESS. To the application role `signup_invites` does not
 * exist: no grant, no policy (migration 0055). The web app can only ask whether
 * a ticket is still good and spend it while creating the tenant. So a ticket
 * cannot be minted by anything that faces the internet.
 *
 * A TICKET IS SPENT ONCE and lapses by itself (14 days unless told otherwise).
 * With SIGNUP_MODE=open no ticket is needed and this tool has nothing to do.
 */
import pg from 'pg';

const url = process.env.MIGRATE_DATABASE_URL;
const note = (process.argv[2] ?? '').trim();
const days = Number(process.argv[3] ?? '14');
const base = (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');

const die = (msg) => { console.error(`\n  ${msg}\n`); process.exit(2); };
const usage = '  usage: MIGRATE_DATABASE_URL=<admin url> node tools/invite-factory.mjs "who it is for" [days]';

if (!url) die(`MIGRATE_DATABASE_URL is required — invitations are made with admin access only.\n${usage}`);
if (!note) die(`Say who it is for, in your own words. It is never shown to them.\n${usage}`);
if (!Number.isInteger(days) || days < 1 || days > 90) die(`Days must be a whole number from 1 to 90 (got "${process.argv[3]}").`);

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const r = await client.query(
    `insert into signup_invites (note, expires_at) values ($1, now() + ($2 || ' days')::interval)
     returning id::text as id, expires_at`,
    [note.slice(0, 200), String(days)],
  );
  const { id, expires_at: expiresAt } = r.rows[0];
  console.log(`\n  ✓ Invitation made for: ${note}`);
  console.log(`    good until ${new Date(expiresAt).toISOString().slice(0, 10)}, and for one workspace only.\n`);
  console.log('  Send them this link:\n');
  console.log(`      ${base || 'https://<your PUBLIC_BASE_URL>'}/signup?invite=${id}\n`);
  if (!base) console.log('  (PUBLIC_BASE_URL is not set here, so put your own address in front.)\n');
} catch (e) {
  console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}`);
  console.error('    Is migration 0055 applied? Run tools/migrate.mjs first.\n');
  process.exitCode = 1;
} finally {
  await client.end();
}
