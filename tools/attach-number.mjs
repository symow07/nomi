#!/usr/bin/env node
/**
 * Decision 1 (A), 2026-10-14 — attach a SECOND WhatsApp number from Nomi's own account to a workspace that exists.
 *
 *   npm run build && railway run --service nomi -- node tools/attach-number.mjs <business-id> <phone-number-id>
 *       [--register]    Meta says the number is not on the Cloud API yet: register it, with a new two-step PIN
 *       [--yes]         write it; without, it shows what it would do and changes nothing
 *       [--by "<name>"] who is attaching it, for the audit trail (default: the operator)
 *
 * WHY IT EXISTS. The deployment connects ONE configured number (META_WHATSAPP_PHONE_NUMBER_ID, Westlake's), and a
 * workspace connects its own only through Embedded Signup, from its own Meta account. The pilot's boss keeps his
 * working number where it is (the owner's decision): a spare number, in Nomi's account, is attached to his workspace.
 *
 * A NUMBER BELONGS TO EXACTLY ONE WORKSPACE. This writes the rows Embedded Signup writes — a `whatsapp_accounts` row
 * (the number, and the installation's token sealed with CREDENTIAL_KEY, never printed) and the credential that
 * routes it — so the workspace's customers' messages to that number reach it, and its replies leave FROM that number.
 * Not a credential alone: a workspace with no account row of its own would be answered from the installation's
 * number, which is another workspace's (the outbound worker now refuses that too — src/main.ts `installationNumber`).
 * tests/integration/attach-number.test.ts holds the boundary both ways: two workspaces, two numbers, no crossing.
 *
 * IT REFUSES, and changes nothing, when: the business does not exist, is switched off, is the practice sandbox or a
 * practice copy; the number is the installation's own; Meta does not list it in Nomi's account
 * (META_WHATSAPP_BUSINESS_ACCOUNT_ID); it is not on the Cloud API and --register was not given; ANY other workspace's
 * credential or live account holds it (named — switched off or not: a credential's number is unique for good); the
 * workspace already has a WhatsApp number (named: one number per workspace); the role is filtered by row security.
 *
 * Connecting is not going live: the owner activates WhatsApp on My business, as for any number.
 * Reads MIGRATE_DATABASE_URL (admin), CREDENTIAL_KEY, META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_BUSINESS_ACCOUNT_ID,
 * META_WHATSAPP_PHONE_NUMBER_ID, META_GRAPH_API_VERSION — all inside `railway run`, none on a command line.
 * Exit 0 done or shown · 1 refused or failed · 2 bad usage.
 */
import { pathToFileURL } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NUMBER_ID = /^\d{6,20}$/;
/** Must match src/demo/sandbox.ts. */
const SANDBOX_BUSINESS_ID = '5a4d0000-0000-4000-8000-0000000000b1';
const FIELDS = 'id,display_phone_number,verified_name,name_status,platform_type,status';
const ACTOR = 'tools/attach-number.mjs';

/** What Meta says about the number, when it is in Nomi's account; null when it is not. Never the token. */
async function numberInAccount({ fetchImpl, token, wabaId, phoneNumberId, graphVersion }) {
  const get = async (path) => {
    const r = await fetchImpl(`https://graph.facebook.com/${graphVersion}/${path}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    let body = {};
    try { body = JSON.parse(await r.text()); } catch { /* not JSON */ }
    if (r.status !== 200 || body.error) throw new Error(`Meta refused (HTTP ${r.status}, code ${body.error?.code ?? '?'}). Nothing was changed.`);
    return body;
  };
  const listed = (await get(`${wabaId}/phone_numbers?fields=id`)).data ?? [];
  if (!listed.some((n) => n?.id === phoneNumberId)) return null;
  const n = await get(`${phoneNumberId}?fields=${FIELDS}`);
  return {
    display: typeof n.display_phone_number === 'string' ? n.display_phone_number.slice(0, 40) : null,
    verifiedName: typeof n.verified_name === 'string' ? n.verified_name.slice(0, 200) : null,
    nameStatus: typeof n.name_status === 'string' ? n.name_status.slice(0, 40) : null,
    onCloudApi: n.platform_type === 'CLOUD_API',
    status: typeof n.status === 'string' ? n.status : null,
  };
}

/**
 * The whole job, for the command line below and for the integration test (which hands it a fake Meta and the test
 * database): `client` is a connected pg client with an admin role; `seal` / `fingerprint` / `newPin` come from the
 * build (dist/security/credentials.js, dist/channels/whatsapp/embeddedSignup.js). Returns what it did or would do;
 * throws `Refused` with the reason when it will not.
 */
export class Refused extends Error {}

export async function attachNumber({
  client, fetchImpl, env, businessId, phoneNumberId, register = false, write = false, by = 'the operator',
  seal, fingerprint, newPin,
}) {
  const refuse = (msg) => { throw new Refused(msg); };
  if (!UUID.test(businessId)) refuse(`"${businessId}" is not a business id (a UUID).`);
  if (!NUMBER_ID.test(phoneNumberId)) refuse(`"${phoneNumberId}" is not a phone number id (Meta's digits, not the phone number).`);
  if (businessId === SANDBOX_BUSINESS_ID) refuse('That is the practice sandbox: no customer ever writes to it.');
  const token = env.META_WHATSAPP_ACCESS_TOKEN ?? '';
  const wabaId = env.META_WHATSAPP_BUSINESS_ACCOUNT_ID ?? '';
  const graphVersion = env.META_GRAPH_API_VERSION || 'v23.0';
  if (token.length < 20) refuse('META_WHATSAPP_ACCESS_TOKEN is not set: run this inside `railway run --service nomi -- …`.');
  if (!NUMBER_ID.test(wabaId)) refuse('META_WHATSAPP_BUSINESS_ACCOUNT_ID is not set: the number must be in Nomi\'s own account.');
  if (phoneNumberId === env.META_WHATSAPP_PHONE_NUMBER_ID) {
    refuse('That is the installation\'s own number (META_WHATSAPP_PHONE_NUMBER_ID). It serves the workspace it is connected to, and no other.');
  }

  const role = (await client.query('select rolsuper or rolbypassrls as sees_all from pg_roles where rolname = current_user')).rows[0];
  if (!role?.sees_all) refuse('This role is filtered by row security, so it would see no other workspace\'s number. Use the admin role (MIGRATE_DATABASE_URL).');

  // Everything that can refuse, read before Meta is asked anything and again under the lock below.
  const check = async () => {
    const biz = (await client.query(
      'select id, name, is_active, practice_of::text as practice_of from businesses where id = $1 for update', [businessId])).rows[0];
    if (!biz) refuse(`No business ${businessId}.`);
    if (biz.practice_of) refuse(`${businessId} is the practice copy of ${biz.practice_of}: attach the number to the workspace itself.`);
    if (!biz.is_active) refuse(`${biz.name} (${businessId}) is switched off.`);
    const held = (await client.query(
      `select c.business_id::text as business_id, b.name, c.is_active from channel_credentials c join businesses b on b.id = c.business_id
        where c.channel = 'whatsapp' and c.external_ref = $1`, [phoneNumberId])).rows[0];
    if (held && held.business_id !== businessId) {
      refuse(`Number ${phoneNumberId} belongs to another workspace — ${held.name} (${held.business_id})${held.is_active ? '' : ', switched off there'}. A number belongs to exactly one workspace.`);
    }
    const live = (await client.query(
      `select a.business_id::text as business_id, b.name from whatsapp_accounts a join businesses b on b.id = a.business_id
        where a.phone_number_id = $1 and a.archived_at is null`, [phoneNumberId])).rows[0];
    if (live && live.business_id !== businessId) refuse(`Number ${phoneNumberId} is the live number of another workspace — ${live.name} (${live.business_id}).`);
    const own = (await client.query(
      `select external_ref, is_active from channel_credentials where business_id = $1 and channel = 'whatsapp'`, [businessId])).rows[0];
    if (own && own.external_ref !== phoneNumberId) {
      refuse(`${biz.name} already has a WhatsApp number (${own.external_ref}${own.is_active ? '' : ', switched off'}). One number per workspace.`);
    }
    const mine = (await client.query(
      'select 1 from whatsapp_accounts where business_id = $1 and archived_at is null', [businessId])).rows[0];
    if (mine) {
      refuse(own?.is_active
        ? `${biz.name} already has ${phoneNumberId}, connected. Nothing to do.`
        : `${biz.name} has a live WhatsApp account with no switched-on credential (a connection that did not finish). Archive it first.`);
    }
    return biz;
  };

  await client.query('begin');
  try {
    const biz = await check();
    await client.query('rollback');

    const number = await numberInAccount({ fetchImpl, token, wabaId, phoneNumberId, graphVersion });
    if (!number) refuse(`Meta does not list ${phoneNumberId} in Nomi's account (${wabaId}). Add it in WhatsApp Manager first.`);
    if (!number.onCloudApi && !register) {
      refuse(`${number.display ?? phoneNumberId} is in Nomi's account but not on the Cloud API yet (${number.status ?? 'no status'}). Run again with --register.`);
    }
    const plan = {
      business: { id: businessId, name: biz.name },
      number: { id: phoneNumberId, display: number.display, verifiedName: number.verifiedName, nameStatus: number.nameStatus },
      registers: !number.onCloudApi,
    };
    if (!write) return { done: false, ...plan };

    let pin = null;
    let registered = false;
    if (!number.onCloudApi) {
      pin = newPin();
      const r = await fetchImpl(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/register`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
      });
      if (r.status !== 200) refuse(`Meta refused to register the number (HTTP ${r.status}).`);
      registered = true;
    }

    await client.query('begin');
    try {
      await check();
    } catch (e) {
      // Meta has registered it; only this side is unchanged. Said, so the next run is not a surprise.
      if (registered && e instanceof Refused) throw new Refused(`${e.message} (Meta registered the number on the Cloud API; nothing was written here.)`);
      throw e;
    }
    // Any account this workspace had for the number before (disconnected) stays archived; this one is new.
    const account = (await client.query(
      `insert into whatsapp_accounts (business_id, waba_id, phone_number_id, display_phone, verified_name, name_status,
                                      token_ciphertext, fingerprint, pin_ciphertext, connected_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id::text as id`,
      [businessId, wabaId, phoneNumberId, number.display, number.verifiedName, number.nameStatus,
        seal(token), fingerprint(token), pin === null ? null : seal(pin), `${ACTOR}: ${by}`])).rows[0];
    const secretRef = `whatsapp_accounts:${account.id}`;
    const cred = (await client.query(
      `insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
       values ($1, 'whatsapp', $2, $3, 'service')
       on conflict (channel, external_ref) do update set secret_ref = excluded.secret_ref, is_active = true
         where channel_credentials.business_id = excluded.business_id
       returning id::text as id`, [businessId, phoneNumberId, secretRef])).rows[0];
    if (!cred) refuse(`Number ${phoneNumberId} was taken by another workspace while this ran.`);
    const channel = (await client.query(
      `insert into channels (business_id, kind, status, credential_id, display_phone, connected_at, disconnected_at, updated_at)
       values ($1, 'whatsapp', 'connected', $2::uuid, $3, now(), null, now())
       on conflict (business_id, kind) do update
         set status = 'connected', credential_id = excluded.credential_id, display_phone = excluded.display_phone,
             connected_at = now(), disconnected_at = null, updated_at = now()
       returning id::text as id`, [businessId, cred.id, number.display])).rows[0];
    await client.query(
      `insert into channel_audit (business_id, channel_id, action, actor, detail) values ($1, $2::uuid, 'connect', $3, $4::jsonb)`,
      [businessId, channel.id, `${ACTOR}: ${by}`, JSON.stringify({ channel: 'whatsapp', number: phoneNumberId, via: 'operator' })]);
    await client.query('commit');
    return { done: true, ...plan };
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  }
}

// ── The command line ───────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const usage = '  usage: railway run --service nomi -- node tools/attach-number.mjs <business-id> <phone-number-id> [--register] [--yes] [--by "<name>"]';
  const die = (msg, code = 1) => { console.error(`\n  ${msg}\n`); process.exit(code); };
  const positional = [];
  const flags = { register: false, yes: false, by: 'the operator' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--register') flags.register = true;
    else if (a === '--yes') flags.yes = true;
    else if (a === '--by') flags.by = (argv[++i] ?? '').trim();
    else if (a.startsWith('--')) die(`Unknown option ${a}.\n${usage}`, 2);
    else positional.push(a);
  }
  if (positional.length !== 2) die(`Give the business id and the phone number id, in that order.\n${usage}`, 2);
  if (!flags.by) die('--by needs a name.', 2);
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) die(`MIGRATE_DATABASE_URL is required — a number is attached with admin access only.\n${usage}`, 2);
  if (!process.env.CREDENTIAL_KEY) die('CREDENTIAL_KEY is not set: the token is sealed with it, as the app reads it.', 2);

  const { toolClient } = await import('./lib/db.mjs');
  const { deriveKey, encryptSecret, credentialFingerprint } = await import('../dist/security/credentials.js');
  const { newPin } = await import('../dist/channels/whatsapp/embeddedSignup.js');
  const key = deriveKey(process.env.CREDENTIAL_KEY);
  const client = toolClient(url, { replyTimeoutMs: 60_000 });
  await client.connect().catch((e) => die(`✗ ${e.message}`));
  try {
    const r = await attachNumber({
      client, env: process.env, businessId: positional[0].trim().toLowerCase(), phoneNumberId: positional[1].trim(),
      register: flags.register, write: flags.yes, by: flags.by,
      fetchImpl: async (u, init) => {
        const res = await fetch(u, { ...init, signal: AbortSignal.timeout(20_000) });
        return { status: res.status, text: () => res.text() };
      },
      seal: (plain) => encryptSecret(plain, key), fingerprint: credentialFingerprint, newPin,
    });
    const n = r.number;
    const name = `${n.display ?? n.id}${n.verifiedName ? ` "${n.verifiedName}"` : ''} (name ${n.nameStatus ?? 'unknown'})`;
    if (!r.done) {
      console.log(`\n  Would attach ${name} to ${r.business.name} (${r.business.id})${r.registers ? ', registering it on the Cloud API first' : ''}.`);
      console.log('  Nothing was changed. Run again with --yes to do it.\n');
    } else {
      console.log(`\n  ✓ ${name} is attached to ${r.business.name} (${r.business.id}).`);
      console.log('    Its customers\' messages reach that workspace only, and its replies leave from this number.');
      console.log('    Going live is still the owner\'s step: WhatsApp on My business. Then the round trip (docs/LIVE-VERIFICATION.md §3).\n');
    }
  } catch (e) {
    console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}${e instanceof Refused ? ' Nothing was changed.' : ''}\n`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}
