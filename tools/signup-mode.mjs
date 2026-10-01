#!/usr/bin/env node
/**
 * BOT (0114) — the operator's sign-up switch, read by the app on every request.
 *
 *   railway run --service nomi -- node tools/signup-mode.mjs                                # what is set
 *   railway run --service nomi -- node tools/signup-mode.mjs closed --by "<you>" --yes      # nobody signs up, at once
 *   railway run --service nomi -- node tools/signup-mode.mjs deployment --by "<you>" --yes  # follow SIGNUP_MODE again
 *
 * open | invite | closed | deployment. The switch wins over the deployment's
 * SIGNUP_MODE. Open still needs the app's own sender and a bot check: without
 * a sender it reads as closed, without a check as invite (signupModeInForce).
 * Dry run unless --yes. Reads MIGRATE_DATABASE_URL.
 */
import { toolClient } from './lib/db.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const mode = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined;
const by = arg('--by'); const yes = process.argv.includes('--yes');
const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) { console.error('✗  MIGRATE_DATABASE_URL must be set. Nothing was changed.'); process.exit(2); }
const { readSignupSwitch, setSignupSwitch, SIGNUP_SWITCH } = await import('./lib/operator.mjs');
// Names only: whether this environment has the three bot-check variables, never their values.
const hasCheck = ['BOT_CHECK_PROVIDER', 'BOT_CHECK_SITE_KEY', 'BOT_CHECK_SECRET'].every((k) => (process.env[k] ?? '').trim() !== '');
const client = toolClient(url, { replyTimeoutMs: 30_000 });
await client.connect();
try {
  const now = await readSignupSwitch(client);
  console.log(`Switch: ${now.mode ?? 'not set — the deployment\'s SIGNUP_MODE decides'}${now.setBy ? ` (set by ${now.setBy}, ${new Date(now.setAt).toISOString()})` : ''}.`);
  console.log(`SIGNUP_MODE here: ${process.env['SIGNUP_MODE'] ?? '(unset: invite)'} · bot check variables: ${hasCheck ? 'all three set' : 'not all set — open reads as invite'}.`);
  if (mode === undefined) process.exit(0);
  if (!SIGNUP_SWITCH.includes(mode)) { console.error(`Usage: ${SIGNUP_SWITCH.join(' | ')} --by "<you>" --yes. Nothing was changed.`); process.exit(2); }
  if (!yes) { console.log(`Dry run: would set the switch to ${mode}. Add --by "<you>" --yes.`); process.exit(0); }
  const r = await setSignupSwitch(client, { mode, by });
  if (r === 'invalid') { console.error('Say who you are: --by "<you>". Nothing was changed.'); process.exit(2); }
  console.log(`✓ the switch is ${mode === 'deployment' ? 'cleared: SIGNUP_MODE decides' : mode}, from the next request.`);
} finally {
  await client.end().catch(() => undefined);
}
