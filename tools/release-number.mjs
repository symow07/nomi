#!/usr/bin/env node
/**
 * The isolation sweep's item 11 (the owner, 2026-10-15: "if the operator tool attaches the spare SIM wrongly and I
 * disconnect to retry, am I locked out… If there isn't [a path to release it], build one — a release, not a
 * redesign.") — FREE A WHATSAPP NUMBER THAT A WORKSPACE NO LONGER USES.
 *
 *   MIGRATE_DATABASE_URL=<admin url> node tools/release-number.mjs <business-id> <phone-number-id>
 *       [--yes]         write it; without, it shows what it would do and changes nothing
 *       [--by "<name>"] who is releasing it, for the audit trail (default: the operator)
 *
 * WHY IT EXISTS. `channel_credentials` is unique on (channel, external_ref) for good, switched-off rows included
 * (0005), and disconnecting only switches the row off. So a number attached to the wrong workspace and then
 * disconnected there could never be attached anywhere else: `tools/attach-number.mjs` refuses it ("belongs to another
 * workspace, switched off there") and a self-serve connect gets "number taken".
 *
 * WHAT IT DOES. The switched-off credential keeps its row (nothing is deleted: it is the record of where the number
 * was) and gives up the number: its `external_ref` becomes `released:<credential id>:<number>`, which routes nothing
 * and holds nothing. One `channel_audit` row says who released it and when. Then the number can be attached to the
 * right workspace (`tools/attach-number.mjs`), and the workspace it left can connect another (its own connect
 * re-points its row; the attach tool ignores a released one).
 *
 * IT REFUSES, and changes nothing, when: the ids are malformed; the role is filtered by row security; that workspace
 * holds no credential for the number (and who does, if anyone); the credential is still switched on, or a live
 * WhatsApp account for the number is still there — disconnect it on My business first: this frees only a number
 * nobody uses.
 *
 * Reads MIGRATE_DATABASE_URL only, never on a command line. Exit 0 done or shown · 1 refused or failed · 2 bad usage.
 */
import { pathToFileURL } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NUMBER_ID = /^\d{6,20}$/;
const ACTOR = 'tools/release-number.mjs';
/** What a released credential's number becomes: it can match no number Meta sends. */
export const releasedRef = (credentialId, phoneNumberId) => `released:${credentialId}:${phoneNumberId}`;

export class Refused extends Error {}

/**
 * The whole job, for the command line below and for the integration test: `client` is a connected pg client with an
 * admin role. Returns what it did or would do; throws `Refused` with the reason when it will not.
 */
export async function releaseNumber({ client, businessId, phoneNumberId, write = false, by = 'the operator' }) {
  const refuse = (msg) => { throw new Refused(msg); };
  if (!UUID.test(businessId)) refuse(`"${businessId}" is not a business id (a UUID).`);
  if (!NUMBER_ID.test(phoneNumberId)) refuse(`"${phoneNumberId}" is not a phone number id (Meta's digits, not the phone number).`);
  const role = (await client.query('select rolsuper or rolbypassrls as sees_all from pg_roles where rolname = current_user')).rows[0];
  if (!role?.sees_all) refuse('This role is filtered by row security, so it would see no other workspace\'s number. Use the admin role (MIGRATE_DATABASE_URL).');

  await client.query('begin');
  try {
    const biz = (await client.query('select id, name from businesses where id = $1', [businessId])).rows[0];
    if (!biz) refuse(`No business ${businessId}.`);
    const cred = (await client.query(
      `select id::text as id, is_active from channel_credentials
        where channel = 'whatsapp' and external_ref = $1 and business_id = $2 for update`, [phoneNumberId, businessId])).rows[0];
    if (!cred) {
      const held = (await client.query(
        `select c.business_id::text as business_id, b.name from channel_credentials c join businesses b on b.id = c.business_id
          where c.channel = 'whatsapp' and c.external_ref = $1`, [phoneNumberId])).rows[0];
      refuse(held
        ? `${biz.name} holds no credential for ${phoneNumberId}: ${held.name} (${held.business_id}) does. Release it from the workspace that holds it.`
        : `No workspace holds ${phoneNumberId}: it is free already.`);
    }
    if (cred.is_active) {
      refuse(`${phoneNumberId} is switched on in ${biz.name}. Disconnect it there first (My business → WhatsApp → Disconnect): this frees only a number nobody uses.`);
    }
    const live = (await client.query(
      `select 1 from whatsapp_accounts where business_id = $1 and phone_number_id = $2 and archived_at is null`, [businessId, phoneNumberId])).rows[0];
    if (live) refuse(`${biz.name} still has a live WhatsApp account for ${phoneNumberId}. Disconnect it there first.`);

    const plan = { business: { id: businessId, name: biz.name }, number: phoneNumberId, credential: cred.id };
    if (!write) { await client.query('rollback'); return { done: false, ...plan }; }

    await client.query(`update channel_credentials set external_ref = $1 where id = $2::uuid`, [releasedRef(cred.id, phoneNumberId), cred.id]);
    const channel = (await client.query(
      `select id::text as id from channels where business_id = $1 and kind = 'whatsapp'`, [businessId])).rows[0];
    await client.query(
      `insert into channel_audit (business_id, channel_id, action, actor, detail) values ($1, $2::uuid, 'disconnect', $3, $4::jsonb)`,
      [businessId, channel?.id ?? null, `${ACTOR}: ${by}`,
        JSON.stringify({ channel: 'whatsapp', number: phoneNumberId, via: 'operator', released: true, credential: cred.id })]);
    await client.query('commit');
    return { done: true, ...plan };
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  }
}

// ── The command line ───────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const usage = '  usage: MIGRATE_DATABASE_URL=<admin url> node tools/release-number.mjs <business-id> <phone-number-id> [--yes] [--by "<name>"]';
  const die = (msg, code = 1) => { console.error(`\n  ${msg}\n`); process.exit(code); };
  const positional = [];
  const flags = { yes: false, by: 'the operator' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes') flags.yes = true;
    else if (a === '--by') flags.by = (argv[++i] ?? '').trim();
    else if (a.startsWith('--')) die(`Unknown option ${a}.\n${usage}`, 2);
    else positional.push(a);
  }
  if (positional.length !== 2) die(`Give the business id and the phone number id, in that order.\n${usage}`, 2);
  if (!flags.by) die('--by needs a name.', 2);
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) die(`MIGRATE_DATABASE_URL is required — a number is released with admin access only.\n${usage}`, 2);

  const { toolClient } = await import('./lib/db.mjs');
  const client = toolClient(url, { replyTimeoutMs: 60_000 });
  await client.connect().catch((e) => die(`✗ ${e.message}`));
  try {
    const r = await releaseNumber({
      client, businessId: positional[0].trim().toLowerCase(), phoneNumberId: positional[1].trim(), write: flags.yes, by: flags.by,
    });
    if (!r.done) {
      console.log(`\n  Would release ${r.number} from ${r.business.name} (${r.business.id}): its switched-off credential keeps its row and gives up the number.`);
      console.log('  Nothing was changed. Run again with --yes to do it.\n');
    } else {
      console.log(`\n  ✓ ${r.number} is released from ${r.business.name} (${r.business.id}). No workspace holds it now.`);
      console.log('    Attach it where it belongs with tools/attach-number.mjs.\n');
    }
  } catch (e) {
    console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}${e instanceof Refused ? ' Nothing was changed.' : ''}\n`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}
