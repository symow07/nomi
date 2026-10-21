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
 * B0 — and every DOCUMENT (0174): its sealed bytes in `document_blobs`, or its
 * file in a directory store (DOCUMENT_STORES, read from the environment as
 * the app reads it). A document only the previous key opens is sealed again
 * with the current one: the blobs in the same transaction as the tokens; the
 * files after it commits, each written beside the old one and renamed over
 * it, and each checked to open first. Nothing it prints is a document.
 *
 * Exit 0 done · 1 refusal or failure · 2 bad usage.
 */
import { toolClient } from './lib/db.mjs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deriveKey, open, seal, SEALED } from './lib/sealed.mjs';
import { directoryStores, documentKey, openDocument, sealDocument } from './lib/documentSeal.mjs';

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
  const docCurrent = documentKey(current);
  const docPrevious = previous ? documentKey(previous) : null;
  let dirs;
  try { dirs = directoryStores(process.env['DOCUMENT_STORES']); } catch { fail(2, 'DOCUMENT_STORES is not JSON: give it exactly as the app has it.'); }

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

    // B0 — the documents (0174), wherever their store keeps the sealed bytes.
    const docPlan = [];
    let docsCurrent = 0;
    const docRows = (await client.query(`
      select d.id::text as id, d.business_id::text as business_id, d.store, d.residency, b.sealed
        from documents d left join document_blobs b on b.document_id = d.id order by d.created_at`)).rows;
    for (const d of docRows) {
      let sealed = d.sealed;
      let file = null;
      if (d.store === 'directory') {
        const path = dirs.get(d.residency);
        if (!path) { unreadable.push(`documents ${d.id} (its directory store "${d.residency}" is not in DOCUMENT_STORES)`); continue; }
        file = join(path, d.business_id, `${d.id}.sealed`);
        sealed = await readFile(file).catch(() => null);
        if (!sealed) { unreadable.push(`documents ${d.id} (its file cannot be read here: run this where "${d.residency}"'s directory is mounted)`); continue; }
      }
      if (!sealed) { unreadable.push(`documents ${d.id} (its sealed bytes are missing)`); continue; }
      if (openDocument(sealed, docCurrent, d.business_id, d.id)) { docsCurrent++; continue; }
      const bytes = docPrevious ? openDocument(sealed, docPrevious, d.business_id, d.id) : null;
      if (!bytes) { unreadable.push(`documents ${d.id}`); continue; }
      docPlan.push({ id: d.id, businessId: d.business_id, file, sealed, bytes });
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
    console.log(previous
      ? `  Documents: ${docsCurrent} already under the current key · ${docPlan.length} under the previous key.`
      : `  Documents: ${docsCurrent} open with the current key.`);
    for (const u of unreadable) {
      // a document whose bytes could not be read here says why itself; anything else was read and not opened
      if (u.endsWith(')')) console.log(`    ✗ ${u} — left as it is`);
      else console.log(`    ✗ ${u}: ${previous ? 'neither key opens it' : 'the current key does not open it'} — left as it is (the app cannot read it either)`);
    }

    if (!previous) {
      console.log('\n  Nothing was written.\n');
    } else if (plan.length === 0 && docPlan.length === 0) {
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
      // The documents kept in this database, in the same transaction.
      const blobs = docPlan.filter((p) => p.file === null);
      let blobsDone = 0;
      for (const p of blobs) {
        const again = sealDocument(p.bytes, docCurrent, p.businessId, p.id);
        const r = await client.query('update document_blobs set sealed = $1 where document_id = $2::uuid and sealed = $3',
          [again, p.id, p.sealed]);
        blobsDone += r.rowCount ?? 0;
      }
      for (const p of blobs) {
        const now1 = (await client.query('select sealed from document_blobs where document_id = $1::uuid', [p.id])).rows[0]?.sealed;
        if (!now1 || !openDocument(now1, docCurrent, p.businessId, p.id)) throw new Error(`documents ${p.id} does not open with the current key after re-sealing`);
      }
      // Proof before commit: every token the plan named now opens with the current key.
      for (const s of SEALED) {
        const rows = (await client.query(`select id::text as id, ${s.column} as sealed from ${s.table} where ${s.column} is not null`)).rows;
        for (const r of rows) {
          if (plan.some((p) => p.s === s && p.id === r.id) && !open(r.sealed, current)) throw new Error(`${s.table} ${r.id} does not open with the current key after re-sealing`);
        }
      }
      await client.query('commit');
      // The documents in a directory store: after the commit (a file is not in the transaction), each written beside
      // the old one, checked, and renamed over it. One that fails is left as it was; the previous key still opens it.
      let files = 0;
      const stuck = [];
      for (const p of docPlan.filter((x) => x.file !== null)) {
        try {
          const again = sealDocument(p.bytes, docCurrent, p.businessId, p.id);
          if (!openDocument(again, docCurrent, p.businessId, p.id)) throw new Error('the new seal does not open');
          await writeFile(`${p.file}.rekey`, again, { flag: 'w' });
          await rename(`${p.file}.rekey`, p.file);
          files++;
        } catch (e) { stuck.push(`documents ${p.id}: ${e instanceof Error ? e.message : String(e)}`); }
      }
      if (stuck.length) {
        console.error(`\n✗  The database part is done; ${stuck.length} document file${stuck.length === 1 ? '' : 's'} could not be sealed again`
          + ` (left as ${stuck.length === 1 ? 'it was' : 'they were'}; the previous key still opens them — keep CREDENTIAL_KEY_PREVIOUS and run it again):`);
        for (const s of stuck) console.error(`    ${s}`);
        process.exitCode = 1;
      }
      console.log(`\n✓  ${done} token${done === 1 ? '' : 's'} re-sealed with the current key. Run it again: it should find nothing to do.`);
      console.log(`✓  ${blobsDone + files} document${blobsDone + files === 1 ? '' : 's'} re-sealed with the current key (${blobsDone} in the database, ${files} in a directory store).`);
      if (!stuck.length) console.log('   Then remove CREDENTIAL_KEY_PREVIOUS in Railway and redeploy.\n');
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
