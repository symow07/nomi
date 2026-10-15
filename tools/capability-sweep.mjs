#!/usr/bin/env node
/**
 * Does the kind of reply chosen depend on the language the buyer wrote in?
 *
 * WHY IT EXISTS (the owner, 2026-10-14, before Arabic may join the pilot). In
 * Practice the same question was read as "understanding needs" (`qualify`) in
 * Arabic and "recommending" (`recommend`) in English — and in that workspace
 * one of the two went out alone and the other waited. Whether a reply waits for
 * the owner must not depend on the language it was asked in. This runs every
 * golden scenario (src/trust/scenarios.ts) in en, zh and ar
 * (tools/capability-sweep.languages.mjs) and reports where it does.
 *
 * TWO LAYERS, because two things stand between the words and the choice:
 *
 *  1. the model's reading — the scenario's own world (its catalogue, grants,
 *     history, the candidates its search returned), with the REAL analyser
 *     (dist/llm/anthropic.js, the prompt in prompts/) in place of the stub, and
 *     the buyer's words in each language. Each scenario is run `--repeats`
 *     times per language (default 3), so a language that only wobbles is told
 *     from one that differs;
 *  2. the catalogue search — before any model, a product is found only through
 *     its names (`retrieve_products`: `alias_match` over `product_aliases`,
 *     kept above 0.15 — trigrams, and a Chinese name by its character pairs
 *     since 0156). For the scenarios about the pilot
 *     product, this asks whether ITS names — "Non-woven shopping bag",
 *     "无纺布购物袋" and the two customer names the Practice sandbox gives it,
 *     as a workspace that typed English and Chinese names has — are found from
 *     each language's words, using the database's own `alias_match()` — the
 *     function production calls (a local database at 156 or later). Where they are not,
 *     the scenario is run again with nothing found, as production would.
 *
 * WHAT IT REPORTS, per scenario and layer: the kind of reply (greet / qualify
 * / recommend / quote / confirm_order) and the decision (a reply, a hand-off,
 * silence) per language, and whether the reply would go out ALONE or WAIT for
 * the owner under three policies — the scenario's own grants (the turn's real
 * effect), "talks" and "sells" (src/core/conversation/autonomyLevel.ts), each
 * after the turn's own holds. LOUDEST: a scenario whose reply goes out alone in
 * one language and waits in another, under any of the three.
 *
 * It touches no Nomi database: the model is asked through the service's
 * environment, and Postgres is asked only `alias_match()` of two strings, on a
 * LOCAL database named by SWEEP_TRGM_URL (refused unless it is this machine).
 * It prints no secret: the provider's kind and the model's name only.
 *
 *   npm run build && SWEEP_TRGM_URL=postgresql://postgres@127.0.0.1:55451/nomi \
 *     railway run --service nomi -- node tools/capability-sweep.mjs --json sweep.json
 *
 * Options: --repeats N (1–10, default 3) · --only id,id · --concurrency N (default 6)
 *          · --fallback (0166: the fallback provider alone, LLM_FALLBACK_*, for its numbers beside the primary's)
 * · --json <file> (every run, for the report page) · --no-catalogue (layer 1 only).
 */
// The words: the one list the parity test holds complete.
import { SCENARIO_LANGUAGES } from './capability-sweep.languages.mjs';

const { llmProviderFrom, llmClient, requestExtrasFor } = await import('../dist/llm/provider.js');
const { anthropicAnalyzer } = await import('../dist/llm/anthropic.js');
const { evaluateScenario } = await import('../dist/trust/harness.js');
const { SCENARIOS, TRUST_PRODUCT_ID, candidate } = await import('../dist/trust/scenarios.js');
const { modesFor } = await import('../dist/core/conversation/autonomyLevel.js');
const { aliasRowsFor } = await import('../dist/core/onboard/aliases.js');
const { writeFileSync } = await import('node:fs');

const LANGS = ['en', 'zh', 'ar'];
const POLICIES = ['own', 'talks', 'sells'];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const REPEATS = Math.max(1, Math.min(10, Number(arg('--repeats', '3')) || 3));
const CONCURRENCY = Math.max(1, Math.min(12, Number(arg('--concurrency', '6')) || 6));
const ONLY = arg('--only', '')?.split(',').filter(Boolean) ?? [];
const JSON_OUT = arg('--json', null);
const CATALOGUE = !process.argv.includes('--no-catalogue');

// 0166 — `--fallback`: the same run against the fallback provider alone (LLM_FALLBACK_*), so its numbers sit beside the primary's.
const { fallbackAsPrimary } = await import('../dist/llm/provider.js');
const modelEnv = process.argv.includes('--fallback') ? fallbackAsPrimary(process.env) : process.env;
if (!modelEnv) { console.error('--fallback: LLM_FALLBACK_BASE_URL, LLM_FALLBACK_API_KEY and LLM_FALLBACK_MODEL are not all set.'); process.exit(2); }
if (process.argv.includes('--fallback')) console.log(`Against the FALLBACK: ${modelEnv['LLM_MODEL']}`);
const provider = llmProviderFrom(modelEnv, process.env['ANTHROPIC_API_KEY'] ?? '');
if (!provider.apiKey) {
  console.error('No model key in this environment. Run it inside: railway run --service nomi -- …');
  process.exit(2);
}
const analyzer = anthropicAnalyzer(llmClient(provider), provider.model, requestExtrasFor(provider));

// ── layer 2: does the catalogue search find the pilot product from these words? ──
/** The pilot product's names, as a workspace that typed them in English and Chinese has them. */
const PRODUCT_NAMES = aliasRowsFor(['Non-woven shopping bag', '无纺布购物袋', 'shopping bag', 'non woven bag']).map((a) => a.alias);
/** `retrieve_products` keeps an alias whose `alias_match` is above this (0007, 0156). */
const KEEP_ABOVE = 0.15;

let similarityOf = null;
let db = null;
if (CATALOGUE) {
  const url = process.env['SWEEP_TRGM_URL'] ?? '';
  let host = '';
  try { host = new URL(url).hostname; } catch { /* not a URL */ }
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
    console.error('Layer 2 asks a LOCAL Postgres for alias_match(): set SWEEP_TRGM_URL to one on this machine, or pass --no-catalogue.');
    process.exit(2);
  }
  const { toolClient } = await import('./lib/db.mjs');
  db = toolClient(url, { replyTimeoutMs: 10_000 });
  await db.connect();
  similarityOf = async (text) => Number((await db.query(
    'select coalesce(max(alias_match(a, $1)), 0)::float8 as r from unnest($2::text[]) a',
    [text, PRODUCT_NAMES])).rows[0].r);
}

// ── the runs ──
const scenarios = SCENARIOS.filter((s) => ONLY.length === 0 || ONLY.includes(s.id));
const missing = scenarios.filter((s) => !SCENARIO_LANGUAGES[s.id]);
if (missing.length) {
  console.error(`No en/zh/ar words for: ${missing.map((s) => s.id).join(', ')} (tools/capability-sweep.languages.mjs).`);
  process.exit(2);
}

const goldenCandidates = (s) => (s.candidates === 'none' ? [] : s.candidates ?? (s.catalog?.map(candidate) ?? []));
const aboutThePilotProduct = (s) => goldenCandidates(s).some((c) => c.productId === TRUST_PRODUCT_ID);

/** What the turn did, as this report reads it. */
function verdicts(outcome) {
  const { result, effects, capability } = outcome;
  const action = result.decision.action.kind;
  const held = Boolean(result.hold || effects.heldBack);
  const replyKind = action === 'generate_reply' || action === 'canned_reply' || action === 'confirm_order';
  const under = (level) => {
    if (!replyKind) return action === 'handoff' ? 'hand-off' : action;
    if (held) return 'waits';
    return modesFor(level)[capability] === 'auto' ? 'alone' : 'waits';
  };
  const own = !replyKind ? (action === 'handoff' ? 'hand-off' : action)
    : outcome.appliedMode === 'auto' ? 'alone' : outcome.appliedMode === 'draft' ? 'waits' : 'nothing';
  return {
    capability, action, held: result.hold ?? effects.heldBack ?? null,
    product: result.decision.product?.productId ? 'found' : 'none', quote: result.quote !== null,
    wantsPerson: result.analysis?.wantsPerson ?? null,
    own, talks: under('talks'), sells: under('sells'),
  };
}

async function runOne(task) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { outcome } = await evaluateScenario(task.scenario, {
        text: task.text, analyzer, ...(task.candidates ? { candidates: task.candidates } : {}),
      });
      return verdicts(outcome);
    } catch (e) {
      if (attempt === 1) return { error: String(e?.status ?? e?.name ?? 'error') };
    }
  }
  return { error: 'unreachable' };
}

const tasks = [];
const found = {};
for (const s of scenarios) {
  for (const lang of LANGS) {
    const text = SCENARIO_LANGUAGES[s.id][lang];
    for (let r = 0; r < REPEATS; r++) tasks.push({ scenario: s, lang, layer: 'model', rep: r, text });
    if (similarityOf && aboutThePilotProduct(s)) {
      const sim = await similarityOf(text);
      found[`${s.id}|${lang}`] = sim;
      // Found: the search returns the product, as the golden scenario says — layer 1 already ran it.
      if (sim <= KEEP_ABOVE) {
        for (let r = 0; r < REPEATS; r++) tasks.push({ scenario: s, lang, layer: 'catalogue', rep: r, text, candidates: [] });
      }
    }
  }
}

console.log(`provider: ${provider.name} · model: ${provider.model} · ${scenarios.length} scenarios × ${LANGS.length} languages × ${REPEATS} · ${tasks.length} turns`);
const runs = new Array(tasks.length);
let next = 0, done = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < tasks.length) {
    const i = next++;
    const t = tasks[i];
    runs[i] = { id: t.scenario.id, lang: t.lang, layer: t.layer, rep: t.rep, ...(await runOne(t)) };
    if (++done % 25 === 0) console.error(`  ${done}/${tasks.length}`);
  }
}));

// ── the report ──
const mode = (xs) => {
  const n = new Map();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]);
};
const show = (xs) => mode(xs).map(([k, c]) => (c === xs.length ? k : `${k}×${c}`)).join(' / ');
const majority = (xs) => mode(xs)[0]?.[0];

const findings = [];
for (const s of scenarios) {
  for (const layer of ['model', 'catalogue']) {
    const per = {};
    for (const lang of LANGS) {
      // The catalogue layer: where the product was found, the model layer's runs are this language's runs too.
      const mine = runs.filter((r) => r.id === s.id && r.lang === lang && r.layer === layer);
      per[lang] = layer === 'catalogue' && mine.length === 0
        ? runs.filter((r) => r.id === s.id && r.lang === lang && r.layer === 'model')
        : mine;
    }
    if (layer === 'catalogue' && !runs.some((r) => r.id === s.id && r.layer === 'catalogue')) continue;
    const ok = (lang) => per[lang].filter((r) => !r.error);
    const row = { id: s.id, layer, langs: {} };
    for (const lang of LANGS) {
      const rs = ok(lang);
      row.langs[lang] = {
        capability: show(rs.map((r) => r.capability)), action: show(rs.map((r) => r.action)),
        own: show(rs.map((r) => r.own)), talks: show(rs.map((r) => r.talks)), sells: show(rs.map((r) => r.sells)),
        product: show(rs.map((r) => r.product)), errors: per[lang].length - rs.length,
        ...(found[`${s.id}|${lang}`] !== undefined ? { similarity: Number(found[`${s.id}|${lang}`].toFixed(3)) } : {}),
        steady: new Set(rs.map((r) => `${r.capability}|${r.action}`)).size <= 1,
      };
    }
    const m = (lang, key) => majority(ok(lang).map((r) => r[key]));
    const differs = (key) => new Set(LANGS.map((l) => m(l, key))).size > 1;
    row.capabilityDiffers = differs('capability');
    row.actionDiffers = differs('action');
    row.aloneVsWaits = POLICIES.filter((p) => {
      const v = new Set(LANGS.map((l) => m(l, p)));
      return v.has('alone') && v.has('waits');
    });
    row.wobbles = LANGS.filter((l) => !row.langs[l].steady);
    findings.push(row);
  }
}

const line = (r) => LANGS.map((l) => `${l}: ${r.langs[l].capability} (${r.langs[l].action}; own ${r.langs[l].own}, talks ${r.langs[l].talks}, sells ${r.langs[l].sells})`).join('\n      ');
const loud = findings.filter((r) => r.aloneVsWaits.length);
const capDiff = findings.filter((r) => !r.aloneVsWaits.length && (r.capabilityDiffers || r.actionDiffers));
const wobble = findings.filter((r) => !r.aloneVsWaits.length && !r.capabilityDiffers && !r.actionDiffers && r.wobbles.length);

console.log(`\n!!! ALONE IN ONE LANGUAGE, WAITS IN ANOTHER — ${loud.length}`);
for (const r of loud) console.log(`  [${r.layer}] ${r.id} — under ${r.aloneVsWaits.join(', ')}\n      ${line(r)}`);
console.log(`\nThe kind of reply (or the decision) differs by language, same send-or-wait — ${capDiff.length}`);
for (const r of capDiff) console.log(`  [${r.layer}] ${r.id}\n      ${line(r)}`);
console.log(`\nSame majority in every language, but a language wobbles between runs — ${wobble.length}`);
for (const r of wobble) console.log(`  [${r.layer}] ${r.id} — ${r.wobbles.join(', ')}\n      ${line(r)}`);
const same = findings.filter((r) => !loud.includes(r) && !capDiff.includes(r) && !wobble.includes(r));
console.log(`\nThe same in every language, every run — ${same.length}`);
for (const r of same) console.log(`  [${r.layer}] ${r.id}: ${r.langs.en.capability} (${r.langs.en.action}; own ${r.langs.en.own})`);
if (Object.keys(found).length) {
  console.log('\nLayer 2 — the pilot product found from the words (similarity > 0.15):');
  for (const [k, v] of Object.entries(found)) console.log(`  ${v > KEEP_ABOVE ? 'found    ' : 'NOT FOUND'} ${v.toFixed(3)}  ${k.replace('|', ' · ')}`);
}
await db?.end();
const errors = runs.filter((r) => r.error).length;
console.log(`\nturns: ${runs.length} · failed twice: ${errors}`);

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    at: new Date().toISOString(), provider: provider.name, model: provider.model, repeats: REPEATS,
    productNames: PRODUCT_NAMES, keepAbove: KEEP_ABOVE, found, findings, runs,
  }, null, 2));
  console.log(`every run: ${JSON_OUT}`);
}
process.exit(errors > 0 ? 1 : 0);
