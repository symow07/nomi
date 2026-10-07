#!/usr/bin/env node
/**
 * REKEY — re-seal every stored token with the current CREDENTIAL_KEY after a
 * rotation (docs/SECRET-ROTATION.md, "Rotating CREDENTIAL_KEY").
 *
 *   dry run (what it would do):
 *     … node tools/rekey.mjs
 *   do it:
 *     … node tools/rekey.mjs --yes
 *
 * It reads three things from the ENVIRONMENT, never from the command line:
 *   ADMIN_DATABASE_URL       the admin role (it reads every workspace's tokens);
 *                            MIGRATE_DATABASE_URL when that is not set
 *   CREDENTIAL_KEY           the key now in force (the app seals with it)
 *   CREDENTIAL_KEY_PREVIOUS  the key it replaced (the app still reads with it)
 * The doc gives the one command that supplies all three from Railway.
 *
 * Without CREDENTIAL_KEY_PREVIOUS it only checks: how many tokens the current
 * key opens, and which it does not. Nothing is written.
 *
 * WHAT IT DOES. For every sealed column (SEALED below): a token the current
 * key opens is left alone; one only the previous key opens is re-sealed with
 * the current key (its version + 1), in ONE transaction; one neither opens is
 * named by table and id and left as it is. Nothing it prints is a token,
 * sealed or open. Dry run unless --yes. A second run finds nothing to do.
 *
 * Exit 0 done · 1 refusal or failure · 2 bad usage.
 */
import { toolClient } from './lib/db.mjs';
import { deriveKey, open, seal, SEALED } from './lib/sealed.mjs';

const run = async () => {
  const write = process.argv.slice(2).includes('--yes');
  const unknown = process.argv.slice(2).filter((a) => a !== '--yes');
  const fail = (code, msg) => { console.error(`\n✗  ${msg}\n`); process.exit(code); };
  if (unknown.length) fail(2, `Unknown argument: ${unknown[0]}. The keys come from the environment, never the command line.`);
  const url = process.env['ADMIN_DATABASE_URL'] || process.env['MIGRATE_DATABASE_URL'];
  const now = process.env['CREDENTIAL_KEY'];
  const was = process.env['CREDENTIAL_KEY_PREVIOUS'] || null;
  if (!url) fail(2, 'ADMIN_DATABASE_URL (or MIGRATE_DATABASE_URL) is not set: the admin role, which reads every workspace\'s tokens.');
  if (!now || !/^[0-9a-f]{64}$/i.test(now)) fail(2, 'CREDENTIAL_KEY is not set, or is not 64 hex characters.');
  if (was !== null && !/^[0-9a-f]{64}$/i.test(was)) fail(2, 'CREDENTIAL_KEY_PREVIOUS is not 64 hex characters.');
  if (was !== null && now.toLowerCase() === was.toLowerCase()) fail(2, 'CREDENTIAL_KEY and CREDENTIAL_KEY_PREVIOUS are the same key: nothing to re-seal.');
  if (was === null && write) fail(2, 'CREDENTIAL_KEY_PREVIOUS is not set: there is no rotation to finish, and nothing to re-seal with --yes.');
  const current = deriveKey(now);
  const previous = was === null ? null : deriveKey(was);

  const client = toolClient(url, { replyTimeoutMs: 60_000 });
  await client.connect().catch((e) => fail(1, e.message));
  try {
    const role = (await client.query('select rolsuper or rolbypassrls as sees_all from pg_roles where rolname = current_user')).rows[0];
    if (!role?.sees_all) fail(1, 'Refusing: this role is filtered by row security, so it would see some tokens and not others.\n   Run it with the admin role (MIGRATE_DATABASE_URL). Nothing was written.');

    const plan = [];
    const unreadable = [];
    let alreadyCurrent = 0;
    for (const s of SEALED) {
      const rows = (await client.query(
        `select id::text as id, ${s.column} as sealed from ${s.table} where ${s.column} is not null`)).rows;
      for (const r of rows) {
        if (open(r.sealed, current)) { alreadyCurrent++; continue; }
        const old = previous ? open(r.sealed, previous) : null;
        if (!old) { unreadable.push(`${s.table} ${r.id}`); continue; }
        plan.push({ s, id: r.id, sealed: r.sealed, plain: old.plain, version: old.keyVersion + 1 });
      }
    }

    console.log('\n  The advisor\'s history (ADVISOR_KEY) is not this tool\'s: the app seals it again as each conversation is opened,'
      + '\n  and no tool opens it. Keep ADVISOR_KEY_PREVIOUS set until the app\'s boot line no longer counts any row behind.');
    console.log(previous
      ? `\n  Sealed tokens: ${alreadyCurrent} already under the current key · ${plan.length} under the previous key · ${unreadable.length} neither key opens.`
      : `\n  No rotation in progress (CREDENTIAL_KEY_PREVIOUS is not set). Sealed tokens: ${alreadyCurrent} open with the current key · ${unreadable.length} do not.`);
    for (const s of SEALED) {
      const n = plan.filter((p) => p.s === s).length;
      if (n) console.log(`    ${s.table}.${s.column}: ${n} to re-seal`);
    }
    for (const u of unreadable) console.log(`    ✗ ${u}: ${previous ? 'neither key opens it' : 'the current key does not open it'} — left as it is (the app cannot read it either)`);

    if (!previous) {
      console.log('\n  Nothing was written.\n');
    } else if (plan.length === 0) {
      console.log('\n  Nothing to re-seal. CREDENTIAL_KEY_PREVIOUS can be removed.\n');
    } else if (!write) {
      console.log('\n  Dry run: nothing was written. Add --yes to re-seal them.\n');
    } else {
      await client.query('begin');
      let done = 0;
      for (const p of plan) {
        const again = seal(p.plain, current, p.version);
        // Only if the row still holds what was read: a token the app re-sealed
        // meanwhile (a reconnect) is newer than this plan, and is left alone.
        const r = p.s.version
          ? await client.query(`update ${p.s.table} set ${p.s.column} = $1, ${p.s.version} = $3 where id = $2::uuid and ${p.s.column} = $4`,
            [again, p.id, p.version, p.sealed])
          : await client.query(`update ${p.s.table} set ${p.s.column} = $1 where id = $2::uuid and ${p.s.column} = $3`,
            [again, p.id, p.sealed]);
        done += r.rowCount ?? 0;
      }
      // Proof before commit: every token the plan named now opens with the current key.
      for (const s of SEALED) {
        const rows = (await client.query(`select id::text as id, ${s.column} as sealed from ${s.table} where ${s.column} is not null`)).rows;
        for (const r of rows) {
          if (plan.some((p) => p.s === s && p.id === r.id) && !open(r.sealed, current)) throw new Error(`${s.table} ${r.id} does not open with the current key after re-sealing`);
        }
      }
      await client.query('commit');
      console.log(`\n✓  ${done} token${done === 1 ? '' : 's'} re-sealed with the current key. Run it again: it should find nothing to do.`);
      console.log('   Then remove CREDENTIAL_KEY_PREVIOUS in Railway and redeploy.\n');
    }
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.error(`\n✗  ${e instanceof Error ? e.message : String(e)}\n   Nothing was written.\n`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
};

await run();
