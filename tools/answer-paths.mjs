#!/usr/bin/env node
/**
 * N1 — who answered her buyers: her own rules and memory, or a model?
 *
 *   MIGRATE_DATABASE_URL=<admin url> node tools/answer-paths.mjs [--days 30] [--business <uuid>]
 *
 * WHAT THIS IS. The measurement the "own power" work starts from. For every
 * turn since migration 0060 it reads WHO worded the reply, how many model calls
 * the turn made and whether the first of them bought anything, and prints:
 *
 *   · the share of replies she worded herself (no model wrote them);
 *   · model calls and tokens by path, with an ESTIMATED cost from list prices;
 *   · analyser calls that were avoidable — the turn paid to understand a
 *     message her own rules then answered from what she already had.
 *
 * It reads across businesses, so it needs admin access; nothing it prints is a
 * message, a name or a number a buyer was told. Turns from before 0060 say
 * nothing about themselves and are counted apart, never as free.
 *
 * Build first (`npm run build`): the sums are the tested ones in dist/, not a
 * second copy here.
 */
import pg from 'pg';

const die = (msg) => { console.error(`\n  ${msg}\n`); process.exit(2); };
const usage = '  usage: MIGRATE_DATABASE_URL=<admin url> node tools/answer-paths.mjs [--days 30] [--business <uuid>]';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : (args[i + 1] ?? ''); };
const days = Number(flag('--days') ?? '30');
const business = flag('--business');
const url = process.env.MIGRATE_DATABASE_URL;

if (!url) die(`MIGRATE_DATABASE_URL is required — this reads every business's turns.\n${usage}`);
if (!Number.isInteger(days) || days < 1 || days > 366) die(`--days must be a whole number from 1 to 366.\n${usage}`);
if (business !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(business)) die(`--business must be a business id.\n${usage}`);

let core;
try { core = await import('../dist/core/conversation/answerPath.js'); }
catch { die('Build first: npm run build (this tool uses the tested sums in dist/).'); }
const { summarizePaths, ANSWER_PATHS, wordedByHer } = core;

const pct = (n, of) => (of === 0 ? '—' : `${Math.round((n / of) * 100)}%`);
const money = (m) => (m === null ? 'unknown (a model with no listed price was used)' : `${m.amount.toFixed(m.amount < 0.01 ? 6 : m.amount < 1 ? 4 : 2)} ${m.currency}`);

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const r = await client.query(
    `select answer_path as path, model_id, coalesce(llm_calls, 0) as llm_calls,
            coalesce(input_tokens, 0) as input_tokens, coalesce(output_tokens, 0) as output_tokens,
            coalesce(analyser_avoidable, false) as analyser_avoidable,
            decision->'action'->>'kind' as kind
       from turns
      where created_at > now() - ($1 || ' days')::interval
        and ($2::uuid is null or business_id = $2::uuid)`,
    [String(days), business],
  );
  // Practice's scripted stand-ins (src/api/web/sandbox.ts) record themselves as
  // model 'scripted': no model was asked and no buyer wrote. Counted apart —
  // left in, their unlisted "price" would make every estimate unknown.
  const scripted = r.rows.filter((x) => x.model_id === 'scripted').length;
  // A message that arrived while the assistant was stopped or silenced is a
  // turn too (2026-09-30), held: nobody answered it, so it is no path's.
  const held = r.rows.filter((x) => x.kind === 'held').length;
  const measured = r.rows.filter((x) => x.path !== null && x.model_id !== 'scripted' && x.kind !== 'held').map((x) => ({
    path: x.path, modelId: x.model_id, llmCalls: Number(x.llm_calls),
    inputTokens: Number(x.input_tokens), outputTokens: Number(x.output_tokens),
    analyserAvoidable: x.analyser_avoidable === true,
  }));
  const unmeasured = r.rows.length - measured.length - scripted - held;
  const s = summarizePaths(measured);

  console.log(`\n  Who answered, last ${days} day${days === 1 ? '' : 's'}${business ? ` · business ${business}` : ' · every business'}`);
  console.log(`  ${s.turns} measured turn${s.turns === 1 ? '' : 's'}${unmeasured ? ` · ${unmeasured} from before the measurement began (not counted)` : ''}${scripted ? ` · ${scripted} scripted Practice turn${scripted === 1 ? '' : 's'} (no model asked; not counted)` : ''}${held ? ` · ${held} held while the assistant was stopped or silenced (not counted)` : ''}\n`);
  if (s.turns === 0) {
    console.log('  Nothing measured yet. Turns are measured from migration 0060 on.\n');
  } else {
    console.log('  path             turns   share   model calls   worded by');
    for (const p of ANSWER_PATHS) {
      const row = s.byPath[p];
      if (!row) continue;
      console.log(`  ${p.padEnd(16)} ${String(row.turns).padStart(5)}   ${pct(row.turns, s.turns).padStart(5)}   ${String(row.llmCalls).padStart(11)}   ${wordedByHer(p) ? 'her' : 'a model'}`);
    }
    console.log(`\n  ✓ Replies she worded herself: ${s.repliesWordedByHer} of ${s.replies} (${pct(s.repliesWordedByHer, s.replies)})`);
    console.log(`    Model calls: ${s.llmCalls} · tokens in ${s.inputTokens} · out ${s.outputTokens}`);
    console.log(`    Estimated cost at list prices: ${money(s.estimatedCost)}${s.estimatedCost !== null && s.turns ? ` · about ${money({ amount: (s.estimatedCost.amount / s.turns) * 1000, currency: s.estimatedCost.currency })} per 1,000 buyer messages` : ''}`);
    console.log(`    Analyser calls that bought nothing: ${s.avoidableAnalyserCalls} (${pct(s.avoidableAnalyserCalls, s.llmCalls)} of all model calls)`);
    // T7 — the first per-turn figures: every measured turn, a silent one included.
    const one = s.perTurn;
    console.log(`  ✓ Per turn: about ${one.inputTokens} tokens in · ${one.outputTokens} out · ${money(one.cost)} at list prices\n`);
  }
  // T7 — the ledger counts every paid call, not only a turn's: a customer's
  // photo, a voice note, a catalogue page, live Practice, and a turn that
  // failed after paying. Complete from 2026-09-29 on; before that it missed them.
  const g = (await client.query(
    `select coalesce(sum(turns), 0)::int as turns, coalesce(sum(llm_calls), 0)::int as calls,
            coalesce(sum(input_tokens), 0)::bigint as input, coalesce(sum(output_tokens), 0)::bigint as output
       from usage_ledger
      where day > (now() at time zone 'UTC')::date - $1::int
        and ($2::uuid is null or business_id = $2::uuid)`,
    [days, business],
  )).rows[0];
  console.log(`  The ledger, same days (UTC): ${g.turns} turn${g.turns === 1 ? '' : 's'} · ${g.calls} model call${g.calls === 1 ? '' : 's'} · tokens in ${g.input} · out ${g.output}`);
  console.log(`    ${Math.max(0, g.calls - s.llmCalls)} of those calls were outside a measured turn (photos, voice notes, catalogue pages, Practice, turns that failed)\n`);
  // N2a — her own reading of each message beside the model's. A shadow: this
  // only says how often her rules would have been right, per field.
  const a = (await client.query(
    `select count(*)::int as n,
            count(*) filter (where (own_understanding->'agrees'->>'language') = 'true')::int as language,
            count(*) filter (where (own_understanding->'agrees'->>'language') is null
                                or (own_understanding->'agrees'->>'language') = 'null')::int as language_unsure,
            count(*) filter (where (own_understanding->'agrees'->>'quantity') = 'true')::int as quantity,
            count(*) filter (where (own_understanding->'agrees'->>'product') = 'true')::int as product,
            count(*) filter (where (own_understanding->'agrees'->>'complaint') = 'true')::int as complaint,
            count(*) filter (where (own_understanding->'agrees'->>'phase') = 'true')::int as phase,
            count(*) filter (where (own_understanding->>'onEverything') = 'true')::int as everything
       from turns
      where created_at > now() - ($1 || ' days')::interval
        and ($2::uuid is null or business_id = $2::uuid)
        and own_understanding is not null`,
    [String(days), business],
  )).rows[0];
  if (a.n > 0) {
    console.log(`  Her own reading of the message, beside the model's — ${a.n} turn${a.n === 1 ? '' : 's'} where both ran:`);
    console.log(`    language   ${pct(a.language, a.n - a.language_unsure).padStart(4)} agree${a.language_unsure ? ` · could not tell on ${a.language_unsure}` : ''}`);
    for (const f of ['quantity', 'product', 'complaint']) console.log(`    ${f.padEnd(10)} ${pct(a[f], a.n).padStart(4)} agree`);
    console.log(`    stage      ${pct(a.phase, a.n).padStart(4)} agree`);
    console.log(`  ✓ Right about all of it: ${a.everything} of ${a.n} (${pct(a.everything, a.n)}) — the turns that would not have needed a model to be understood\n`);
  } else if (s.turns > 0) {
    console.log('  Her own reading beside the model\'s: nothing to compare yet (no model analysed a message in this range).\n');
  }
} catch (e) {
  console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}`);
  console.error('    Are migrations 0060 and 0061 applied? Run tools/migrate.mjs first.\n');
  process.exitCode = 1;
} finally {
  await client.end();
}
