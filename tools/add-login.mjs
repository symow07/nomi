#!/usr/bin/env node
/**
 * 0078 — give a workspace that EXISTS a login, and a link to choose its password.
 *
 *   MIGRATE_DATABASE_URL=<admin url> node tools/add-login.mjs <business-id> <e-mail>
 *       [--replace]        the owner already has a login: archive it, use this e-mail instead
 *       [--reset]          the e-mail IS the owner's login: a fresh link to choose a new password
 *       [--name "<name>"]  only when the workspace has no owner on record: who the owner is
 *       [--hours N]        how long the link stays good (default 72, at most 168)
 *
 * WHY IT EXISTS. A login came to exist in one way only: signing up, which makes
 * a NEW business. tools/invite-factory.mjs mints a ticket for a new workspace
 * and tools/provision-factory.mjs makes a new tenant; neither can attach a login
 * to a business that is already there. The pilot's workspace was provisioned
 * before logins existed and had none, and an owner whose only login is lost had
 * nothing to go to but hand-written SQL — the thing provision-factory.mjs was
 * written to end.
 *
 * WHAT IT MAKES — the rows sign-up makes, and nothing sign-up would not:
 *   · the login belongs to the workspace's OWNER (`people.is_owner`, one per
 *     business). If none is on record, it is made the way sign-up makes one: a
 *     name and `is_owner`. Sign-up only ever gives a login to an owner, so this
 *     does too — a staff member's way in stays their access code.
 *   · the e-mail is stored the way sign-up stores it (trimmed, lower case) and
 *     must pass sign-up's own shape check;
 *   · the password hash is scrypt with sign-up's exact parameters
 *     (src/security/password.ts) — of 32 random bytes that are thrown away the
 *     moment they are hashed, so the login cannot be signed in to until the
 *     owner chooses a password;
 *   · one row in `login_setups`: the SHA-256 of a random 32-byte token.
 *
 * A LINK, NOT A PASSWORD. It prints `/login/set-password?t=…`. The owner opens
 * it and chooses a password on the door; nobody else ever knows it, and it never
 * passes through a command line, a shell history or a chat. A printed temporary
 * password would be worse on each count: it sits in the terminal's scrollback
 * and in whatever it is pasted into, it stays good until someone remembers to
 * change it, and whoever ran the tool knows it. The link works ONCE, lapses by
 * itself, and a newer one closes the older ones. Opening it spends nothing (a
 * messenger drawing a preview fetches it too); saving the password does. After
 * that the owner signs in on the ordinary door — so the e-mailed code for a
 * browser never seen before (A3) still applies.
 *
 * WHY IT NEEDS ADMIN ACCESS — the reason the other two tools do. To the
 * application role `login_setups` does not exist, and `logins` is behind row
 * security: nothing that faces the internet can give a workspace a way in. The
 * tool refuses a role that row security filters, which would see no workspace
 * and no clash.
 *
 * IT REFUSES, and changes nothing, when: the business does not exist or is
 * switched off; it is the practice sandbox or a workspace's practice copy
 * (0086); the e-mail is another workspace's
 * login; the workspace already has a login (unless --replace — said out loud,
 * with what is there); the e-mail is already this workspace's (unless --reset).
 */
import { randomBytes, scrypt as scryptCb, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { toolClient } from './lib/db.mjs';

/** Must match src/demo/sandbox.ts — the one tenant nobody signs in to. */
const SANDBOX_BUSINESS_ID = '5a4d0000-0000-4000-8000-0000000000b1';

// src/security/password.ts — the same parameters, so the row is one sign-up
// would write (tests/parity/add-login.test.ts holds the two together).
const N = 32768;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
const MAX_MEM = 128 * N * R * 2;
// src/core/owner/signup.ts — the same shape check and the same normal form.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normalizeEmail = (raw) => raw.trim().toLowerCase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const scrypt = promisify(scryptCb);
/** src/security/password.ts `hashPassword`, of a secret nobody will ever hold. */
async function unguessableHash() {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(randomBytes(32).toString('base64url').normalize('NFKC'), salt, KEY_LEN, { N, r: R, p: P, maxmem: MAX_MEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
/** src/security/setupLink.ts — 32 random bytes; only the SHA-256 is stored. */
const newToken = () => randomBytes(32).toString('base64url');
const tokenHash = (token) => createHash('sha256').update(token, 'utf8').digest('hex');

const usage = '  usage: MIGRATE_DATABASE_URL=<admin url> node tools/add-login.mjs <business-id> <e-mail>'
  + ' [--replace] [--reset] [--name "<owner name>"] [--hours N]';
const die = (msg, code = 1) => { console.error(`\n  ${msg}\n`); process.exit(code); };

// ── The command line ───────────────────────────────────────────────────────
const positional = [];
const flags = { replace: false, reset: false, name: null, hours: 72 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--replace') flags.replace = true;
  else if (a === '--reset') flags.reset = true;
  else if (a === '--name') flags.name = argv[++i] ?? '';
  else if (a === '--hours') flags.hours = Number(argv[++i]);
  else if (a.startsWith('--')) die(`Unknown option ${a}.\n${usage}`, 2);
  else positional.push(a);
}
const url = process.env.MIGRATE_DATABASE_URL;
const base = (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
if (!url) die(`MIGRATE_DATABASE_URL is required — a login is given with admin access only.\n${usage}`, 2);
if (positional.length !== 2) die(`Give the business id and the e-mail, in that order.\n${usage}`, 2);
const businessId = positional[0].trim().toLowerCase();
const email = normalizeEmail(positional[1]);
if (!UUID.test(businessId)) die(`"${positional[0]}" is not a business id (a UUID).\n${usage}`, 2);
if (email.length > 254 || !EMAIL.test(email)) die(`"${positional[1]}" is not an e-mail address sign-up would accept.`, 2);
if (flags.replace && flags.reset) die('--replace and --reset are two different things; choose one.', 2);
if (flags.name !== null && flags.name.trim() === '') die('--name needs the owner\'s name.', 2);
if (!Number.isInteger(flags.hours) || flags.hours < 1 || flags.hours > 168) die('--hours must be a whole number from 1 to 168.', 2);
if (businessId === SANDBOX_BUSINESS_ID) {
  die('Refusing: that is the practice sandbox. Nobody signs in to it — it is where Practice runs.');
}

// ── The database ───────────────────────────────────────────────────────────
const client = toolClient(url, { replyTimeoutMs: 60_000 });
await client.connect().catch((e) => die(`✗ ${e.message}`));
const refuse = async (msg) => { await client.query('rollback').catch(() => undefined); await client.end(); die(msg); };
const when = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'never');
try {
  const role = (await client.query(
    'select rolsuper or rolbypassrls as sees_all from pg_roles where rolname = current_user')).rows[0];
  if (!role?.sees_all) {
    await refuse('Refusing: this role is filtered by row security, so it would see no workspace and no clash.\n'
      + '  A login is given with the admin role (MIGRATE_DATABASE_URL), like invite-factory and provision-factory.');
  }
  await client.query('begin');

  // The business, held for the length of the change so two runs cannot race.
  const biz = (await client.query('select id, name, is_active, practice_of::text as practice_of from businesses where id = $1 for update', [businessId])).rows[0];
  if (!biz) await refuse(`Refusing: no business ${businessId}. Nothing was changed.`);
  if (biz.practice_of) await refuse(`Refusing: ${businessId} is the practice copy of ${biz.practice_of}. Nobody signs in to a copy — give the login to the workspace itself. Nothing was changed.`);
  if (!biz.is_active) await refuse(`Refusing: ${biz.name} (${businessId}) is switched off, and nobody can sign in to it. Nothing was changed.`);

  const owner = (await client.query(
    'select id, name from people where business_id = $1 and is_owner and archived_at is null', [businessId])).rows[0] ?? null;
  const live = (await client.query(
    `select l.id, l.email, l.created_at, l.last_login_at, l.locked_until, p.id as person_id, p.name, p.is_owner
       from logins l join people p on p.id = l.person_id
      where l.business_id = $1 and l.archived_at is null
      order by l.created_at`, [businessId])).rows;
  const taken = (await client.query(
    `select l.id, l.business_id, b.name from logins l join businesses b on b.id = l.business_id
      where l.email = $1 and l.archived_at is null`, [email])).rows[0] ?? null;

  if (taken && taken.business_id !== businessId) {
    await refuse(`Refusing: ${email} is already the login of another workspace — ${taken.name} (${taken.business_id}).\n`
      + '  An e-mail signs in to one workspace only. Nothing was changed.');
  }

  let loginId;
  let what;
  if (taken) {
    // The e-mail is this workspace's own login.
    if (!flags.reset) {
      await refuse(`${email} is already this workspace's login. Nothing was changed.\n`
        + '  If they cannot sign in with it, re-run with --reset: a fresh link to choose a new password\n'
        + '  (the old password keeps working until the new one is saved).');
    }
    loginId = taken.id;
    what = `A fresh link for ${email}, the existing login of ${biz.name}. Any older link for it is closed.`;
  } else {
    if (flags.reset) await refuse(`--reset needs the e-mail of a login this workspace already has; ${email} is not one. Nothing was changed.`);
    const others = live.map((l) => `      ${l.email} — ${l.name}${l.is_owner ? ' (owner)' : ''}, made ${when(l.created_at)}, last sign-in ${when(l.last_login_at)}`
      + (l.locked_until && new Date(l.locked_until) > new Date() ? `, locked until ${when(l.locked_until)}` : ''));
    if (live.length > 0 && !flags.replace) {
      await refuse(`${biz.name} already has a login:\n${others.join('\n')}\n\n`
        + '  Nothing was changed. The owner has one login at a time. To archive it and give the owner\n'
        + `  ${email} instead, re-run with --replace — the old e-mail then stops signing in.\n`
        + '  If it is only the password that is lost, use --reset with the e-mail above.');
    }
    let person = owner;
    if (!person) {
      if (!flags.name) {
        await refuse(`${biz.name} has no owner on record. Nothing was changed.\n`
          + '  Say who the owner is with --name "<their name>" — the name sign-up would have asked for.');
      }
      person = (await client.query(
        'insert into people (business_id, name, is_owner) values ($1, $2, true) returning id, name',
        [businessId, flags.name.trim()])).rows[0];
    }
    const replaced = live.filter((l) => l.person_id === person.id);
    for (const l of replaced) {
      await client.query('update logins set archived_at = now() where id = $1', [l.id]);
      await client.query('update login_setups set used_at = now() where login_id = $1 and used_at is null', [l.id]);
    }
    loginId = (await client.query(
      'insert into logins (business_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id',
      [businessId, person.id, email, await unguessableHash()])).rows[0].id;
    what = `A login for ${person.name}, the owner of ${biz.name}: ${email}.`
      + (owner ? '' : ` (${person.name} was put on record as the owner.)`)
      + (flags.name && owner ? ` (--name was not used: ${owner.name} is already the owner on record.)` : '')
      + (replaced.length ? `\n    Archived: ${replaced.map((l) => l.email).join(', ')} — it no longer signs in.` : '');
  }

  // PWR2 (0129) — the operator wrote this address in by hand: it is vouched
  // for, so "Forgot your password?" may send a link to it later.
  await client.query('update logins set email_verified_at = coalesce(email_verified_at, now()) where id = $1', [loginId]);
  // The link. A newer one closes any older one still open for this login.
  const token = newToken();
  await client.query('update login_setups set used_at = now() where login_id = $1 and used_at is null', [loginId]);
  const link = (await client.query(
    `insert into login_setups (business_id, login_id, token_hash, expires_at, made_by)
     values ($1, $2, $3, now() + make_interval(hours => $4), 'tools/add-login.mjs') returning expires_at`,
    [businessId, loginId, tokenHash(token), flags.hours])).rows[0];
  await client.query('commit');

  console.log(`\n  ✓ ${what}`);
  console.log(`\n  Send them this link. It works once, until ${when(link.expires_at)}:\n`);
  console.log(`      ${base || 'https://<your PUBLIC_BASE_URL>'}/login/set-password?t=${token}\n`);
  if (!base) console.log('  (PUBLIC_BASE_URL is not set here, so put your own address in front.)\n');
  console.log('  Opening it spends nothing; saving a password does. Then they sign in with that e-mail and password.');
  console.log('  The link is shown only this once and cannot be read back — if it is lost, run this again.\n');
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}`);
  console.error('    Nothing was changed. Is migration 0078 applied? Run tools/migrate.mjs first.\n');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
