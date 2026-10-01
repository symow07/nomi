#!/usr/bin/env node
/**
 * KS5 — the installation's daily spend ceiling (0113): read it, or change it.
 *
 *   railway run --service nomi -- node tools/spend-ceiling.mjs                              # today against the ceiling
 *   railway run --service nomi -- node tools/spend-ceiling.mjs --tokens 40000000 --calls 40000 --by "<you>" --yes
 *
 * Past the ceiling, workspaces that signed themselves up wait for their owners
 * until midnight UTC; the pilots keep running. Dry run unless --yes. Reads
 * MIGRATE_DATABASE_URL.
 */
import { toolClient } from './lib/db.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const num = (v) => (v === undefined ? undefined : Number(v));
const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) { console.error('✗  MIGRATE_DATABASE_URL must be set. Nothing was changed.'); process.exit(2); }
const { readSpendCeiling, setSpendCeiling } = await import('./lib/operator.mjs');
const tokens = num(arg('--tokens')); const calls = num(arg('--calls')); const by = arg('--by'); const yes = process.argv.includes('--yes');
const client = toolClient(url, { replyTimeoutMs: 30_000 });
await client.connect();
try {
  const now = await readSpendCeiling(client);
  console.log(`Today: ${now.tokens} tokens, ${now.calls} model calls · ceiling: ${now.maxTokens} tokens, ${now.maxCalls} calls${
    now.tokens >= now.maxTokens || now.calls >= now.maxCalls ? ' · PAST IT: the beta waits' : ''}.`);
  if (tokens === undefined && calls === undefined) process.exit(0);
  if (!yes) { console.log(`Dry run: would set the ceiling to ${tokens ?? now.maxTokens} tokens, ${calls ?? now.maxCalls} calls. Add --by "<you>" --yes.`); process.exit(0); }
  const r = await setSpendCeiling(client, { tokens, calls, by });
  if (r === 'invalid') { console.error('Usage: --tokens <whole number> and/or --calls <whole number>, --by "<you>", --yes. Nothing was changed.'); process.exit(2); }
  console.log(`✓ the ceiling is ${tokens ?? now.maxTokens} tokens and ${calls ?? now.maxCalls} calls a day.`);
} finally {
  await client.end().catch(() => undefined);
}
