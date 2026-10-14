#!/usr/bin/env node
/**
 * 0159 — hold a language out of ONE workspace, or release it (the owner, 2026-10-14).
 *
 * "Arabic joins the pilot automatically once BOTH are true: the boss's products carry Arabic names, and a fresh
 * 60-turn Arabic run against the REAL product set comes back with nothing gendered sent, nothing held silent, and no
 * split against English or Chinese (tools/check-language-release.mjs). If it fails, Arabic stays out."
 *
 * A language's release is the product's (DISCLOSURE_NATIVE_REVIEW). A held language is not answered alone in this
 * workspace: a buyer writing in it is handed to a person (`language_held`) and hears the ordinary hand-off sentence.
 * There is deliberately no owner-facing switch: this is the operator's decision, made here.
 *
 *   MIGRATE_DATABASE_URL=… node tools/language-hold.mjs --business <uuid>                 # show what is held
 *   MIGRATE_DATABASE_URL=… node tools/language-hold.mjs --business <uuid> --hold ar       # hold Arabic
 *   MIGRATE_DATABASE_URL=… node tools/language-hold.mjs --business <uuid> --release ar    # answer it again
 *
 * The next buyer message reads it; nothing already sent or handed over changes. Exit 0 done · 1 refusal or
 * failure · 2 bad usage.
 */
import { toolClient } from './lib/db.mjs';

/** The languages a workspace may serve — `SERVED_LANGUAGES` (src/core/owner/i18n/locale.ts); a parity test holds them equal. */
export const HOLDABLE = ['en', 'zh', 'ar', 'es', 'fr', 'pt', 'de', 'tr', 'ru'];

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const has = (name) => args.includes(`--${name}`);
const usage = (msg) => {
  console.error(`${msg}\n\n  node tools/language-hold.mjs --business <uuid> [--hold <lang> | --release <lang>]\n`);
  process.exit(2);
};

const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) usage('MIGRATE_DATABASE_URL is not set.');
const business = flag('business');
if (!business || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(business)) usage('--business must be a uuid.');
if (has('hold') && has('release')) usage('--hold or --release, not both.');
const lang = flag('hold') ?? flag('release');
if ((has('hold') || has('release')) && (!lang || !HOLDABLE.includes(lang))) usage(`The language must be one of: ${HOLDABLE.join(', ')}.`);
const hold = has('hold');

const client = toolClient(url, { replyTimeoutMs: 60_000 });
await client.connect().catch((e) => { console.error(`\n✗  ${e.message}\n`); process.exit(1); });
try {
  const biz = (await client.query(
    'select id::text as id, name, languages_held as held, languages_served as served from businesses where id = $1', [business])).rows[0];
  if (!biz) { console.error(`\n✗  No business ${business}.\n`); process.exit(1); }
  const say = (held) => (held.length ? held.join(', ') : 'nothing');
  if (!lang) {
    console.log(`\n  ${biz.name}: held — ${say(biz.held)} · serves — ${(biz.served ?? []).join(', ')}\n`);
  } else if (biz.held.includes(lang) === hold) {
    console.log(`\n  ${biz.name}: ${lang} is already ${hold ? 'held' : 'answered'}. Nothing changed.\n`);
  } else {
    const next = (await client.query(
      hold ? 'update businesses set languages_held = array_append(languages_held, $2) where id = $1 returning languages_held as held'
        : 'update businesses set languages_held = array_remove(languages_held, $2) where id = $1 returning languages_held as held',
      [business, lang])).rows[0].held;
    console.log(`\n✓  ${biz.name}: ${lang} ${hold ? 'HELD — a buyer writing in it goes to a person, and is told so' : 'RELEASED — answered as the workspace answers every signed language'}.`);
    console.log(`   Held now: ${say(next)}. The next message reads it; nothing already sent changes.\n`);
  }
} catch (e) {
  console.error(`\n✗  ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
