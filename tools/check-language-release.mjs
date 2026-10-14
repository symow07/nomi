#!/usr/bin/env node
/**
 * MAY THIS WORKSPACE ANSWER A LANGUAGE IT HOLDS? (the owner, 2026-10-14, pre-approved and conditional)
 *
 * "Arabic joins the pilot automatically once BOTH are true:
 *   a. the boss's products carry Arabic names, and
 *   b. a fresh 60-turn Arabic run against the REAL product set — not the fixtures — comes back with nothing gendered
 *      sent, nothing held silent, and no split against English or Chinese.
 *  If (b) fails, Arabic stays out and you tell me what failed. If it passes, turn it on and say so."
 *
 * This is (a) and (b). It never changes the workspace: releasing is `tools/language-hold.mjs --release`, by hand,
 * after a pass.
 *
 * STEP 1 — read the workspace's catalogue, READ ONLY (products, prices, names, price limits; no buyer, no message):
 *
 *   railway run --service Postgres -- sh -c \
 *     'CATALOGUE_DATABASE_URL="$DATABASE_PUBLIC_URL" node tools/check-language-release.mjs --export --business <uuid> --out <file>'
 *
 * STEP 2 — the run: the catalogue laid into a LOCAL, throwaway database as an operator-made workspace with every
 * capability on auto (nothing else holds a reply, so whatever holds one is the language's), and four conversations a
 * buyer really has (tools/check-language-release.words.mjs) held through the real engine — computeTurn + commitTurn,
 * the real catalogue search, the real analyser and writer of this installation — in the language under test and in
 * English and Chinese, until the language has had at least 60 turns. Every reply in it is printed in full.
 *
 *   npm run build && RELEASE_CHECK_DB=postgresql://nomi_app:nomi_app@127.0.0.1:<port>/nomi \
 *     railway run --service nomi -- node tools/check-language-release.mjs --catalogue <file> [--language ar] [--json <out>]
 *
 * RELEASE_CHECK_DB must be this machine's (it is refused otherwise), migrated to this build's schema. Every other
 * database address in the environment is removed before anything is imported: under `railway run` the service's
 * own would otherwise be there. It prints no secret: the provider's kind and the model's name only.
 *
 * Exit 0 pass · 1 the run failed (a), (b) or a turn · 2 bad usage · 3 condition (a) not met.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { CONVERSATIONS, WORDS, verdict } from './check-language-release.words.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const has = (name) => args.includes(`--${name}`);
const usage = (msg) => { console.error(`${msg}\n\n  --export --business <uuid> --out <file>   |   --catalogue <file> [--language ar] [--json <out>]\n`); process.exit(2); };

const SCRIPT = { ar: /\p{Script=Arabic}/u, zh: /\p{Script=Han}/u };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── STEP 1: export, read only ────────────────────────────────────────────────
if (has('export')) {
  const business = flag('business');
  const out = flag('out');
  if (!business || !UUID.test(business)) usage('--business must be a uuid.');
  if (!out) usage('--out <file> is needed.');
  const url = process.env['CATALOGUE_DATABASE_URL'];
  if (!url) usage('CATALOGUE_DATABASE_URL is not set (see the header: it is the database the catalogue is read from).');
  const { toolClient } = await import('./lib/db.mjs');
  const client = toolClient(url, { replyTimeoutMs: 60_000 });
  await client.connect().catch((e) => { console.error(`\n✗  ${e.message}\n`); process.exit(1); });
  try {
    await client.query('begin transaction read only');
    const q = async (text, params) => (await client.query(text, params)).rows;
    const [biz] = await q(`select name, kind, description, languages_served as served, languages_held as held,
                                  (select name from assistants a where a.business_id = b.id and a.is_default limit 1) as assistant
                             from businesses b where id = $1`, [business]);
    if (!biz) { console.error(`\n✗  No business ${business}.\n`); process.exit(1); }
    const products = await q(`select id::text as id, sku, name, name_zh, category, unit, moq, lead_time_days, customizable,
                                     options, price_usd_per_unit::text as price, currency
                                from products where business_id = $1 and is_active order by name`, [business]);
    const ids = products.map((p) => p.id);
    const tiers = await q(`select product_id::text as product_id, min_qty, max_qty, unit_price_usd::text as unit_price, currency
                             from price_tiers where product_id = any($1::uuid[])`, [ids]);
    const aliases = await q(`select product_id::text as product_id, alias, language, alias_type
                               from product_aliases where product_id = any($1::uuid[])`, [ids]);
    const policies = await q(`select product_id::text as product_id, floor_price_usd::text as floor, currency, max_discount_pct,
                                     human_required_above_pct from pricing_policy where business_id = $1`, [business]);
    await client.query('commit');
    writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), business: { id: business, ...biz }, products, tiers, aliases, policies }, null, 1));
    console.log(`\n✓  ${biz.name}: ${products.length} active products, ${tiers.length} price tiers, ${aliases.length} names, ${policies.length} price limits → ${out}`);
    console.log(`   Serves ${(biz.served ?? []).join(', ')} · holds ${(biz.held ?? []).join(', ') || 'nothing'}. Nothing was written.\n`);
  } catch (e) {
    console.error(`\n✗  ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
  process.exit(process.exitCode ?? 0);
}

// ── STEP 2: the run ──────────────────────────────────────────────────────────
const file = flag('catalogue');
if (!file) usage('--catalogue <file> (from --export) is needed.');
const LANG = flag('language') ?? 'ar';
if (!WORDS[LANG] || LANG === 'en') usage('--language must be one with its own words: ar or zh.');
const AGAINST = ['en', 'zh', 'ar'].filter((l) => l !== LANG);
const LOCAL = process.env['RELEASE_CHECK_DB'];
if (!LOCAL) usage('RELEASE_CHECK_DB is not set: a local database, migrated to this build.');
let host = '';
try { host = new URL(LOCAL).hostname; } catch { usage('RELEASE_CHECK_DB is not a database address.'); }
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) usage('RELEASE_CHECK_DB must be a database on this machine.');
// Under `railway run` the service's own database address is in the environment: removed before anything is imported.
for (const k of Object.keys(process.env)) if (/DATABASE|PGHOST|PGPASSWORD|PGUSER/i.test(k) && k !== 'RELEASE_CHECK_DB') delete process.env[k];

const cat = JSON.parse(readFileSync(file, 'utf8'));
const namesOf = (p) => [p.name, p.name_zh, ...cat.aliases.filter((a) => a.product_id === p.id).map((a) => a.alias)].filter(Boolean);
const nameIn = (p, l) => l === 'en' ? p.name : namesOf(p).find((n) => SCRIPT[l].test(n)) ?? null;

// (a) — every product carries a name in the language.
const unnamed = cat.products.filter((p) => !nameIn(p, LANG));
if (cat.products.length === 0 || unnamed.length > 0) {
  console.log(`\n✗  (a) not met: ${unnamed.length} of ${cat.products.length} active products of ${cat.business.name} have no ${LANG} name.`);
  for (const p of unnamed.slice(0, 20)) console.log(`   · ${p.name}`);
  console.log(`   ${LANG} stays held. Nothing was run.\n`);
  process.exit(3);
}

const { llmProviderFrom, llmClient, requestExtrasFor } = await import('../dist/llm/provider.js');
const { anthropicAnalyzer, anthropicReplyWriter } = await import('../dist/llm/anthropic.js');
const provider = llmProviderFrom(process.env, process.env['ANTHROPIC_API_KEY'] ?? '');
if (!provider.apiKey) { console.error('No model key in this environment. Run it inside: railway run --service nomi -- …'); process.exit(2); }
const analyzer = anthropicAnalyzer(llmClient(provider), provider.model, requestExtrasFor(provider));
const writer = anthropicReplyWriter(llmClient(provider), provider.model, requestExtrasFor(provider));
const { createDb, withTenantTx } = await import('../dist/db/client.js');
const { parseBusinessId } = await import('../dist/core/types/ids.js');
const { tenantRepos } = await import('../dist/db/repos.js');
const { hybridRetriever } = await import('../dist/retrieval/hybrid.js');
const { computeTurn, commitTurn } = await import('../dist/pipeline/turn.js');
const { CAPABILITIES } = await import('../dist/core/conversation/autonomy.js');
const { addressesInGender } = await import('../dist/core/safety/address.js');
const { sql } = await import('kysely');

const db = createDb(LOCAL);
const BIZ = randomUUID();
const bid = parseBusinessId(BIZ);
if (!bid.ok) throw new Error('uuid');
const as = (fn) => withTenantTx(db, bid.value, fn);

// The catalogue, laid in as an operator-made workspace (no ramp), every capability on auto, its name chosen.
const idOf = new Map(cat.products.map((p) => [p.id, randomUUID()]));
await as(async (t) => {
  await sql`insert into businesses (id, name, engine, kind, description, languages_served)
            values (${BIZ}, ${`${cat.business.name} — release check ${new Date().toISOString().slice(0, 16)}`}, 'service',
                    ${cat.business.kind}, ${cat.business.description}, ${cat.business.served ?? ['en', 'zh', 'ar']})`.execute(t);
  for (const p of cat.products) {
    await sql`insert into products (id, business_id, sku, name, name_zh, category, unit, moq, lead_time_days, customizable, options,
                                    price_usd_per_unit, currency, is_active)
              values (${idOf.get(p.id)}, ${BIZ}, ${p.sku}, ${p.name}, ${p.name_zh}, ${p.category}, ${p.unit}, ${p.moq}, ${p.lead_time_days},
                      ${p.customizable}, ${p.options === null ? null : JSON.stringify(p.options)}::jsonb, ${p.price}, ${p.currency}, true)`.execute(t);
  }
  for (const r of cat.tiers) {
    await sql`insert into price_tiers (product_id, min_qty, max_qty, unit_price_usd, currency)
              values (${idOf.get(r.product_id)}, ${r.min_qty}, ${r.max_qty}, ${r.unit_price}, ${r.currency})`.execute(t);
  }
  for (const a of cat.aliases) {
    await sql`insert into product_aliases (product_id, alias, language, alias_type)
              values (${idOf.get(a.product_id)}, ${a.alias}, ${a.language}, ${a.alias_type}) on conflict do nothing`.execute(t);
  }
  for (const r of cat.policies) {
    await sql`insert into pricing_policy (business_id, product_id, floor_price_usd, currency, max_discount_pct, human_required_above_pct)
              values (${BIZ}, ${r.product_id === null ? null : idOf.get(r.product_id)}, ${r.floor}, ${r.currency}, ${r.max_discount_pct},
                      ${r.human_required_above_pct})`.execute(t);
  }
  for (const capability of CAPABILITIES) {
    await sql`insert into autonomy_policy (business_id, capability, mode) values (${BIZ}, ${capability}, 'auto')
              on conflict (business_id, capability) do update set mode = 'auto'`.execute(t);
  }
  await sql`insert into assistants (business_id, name, is_default) values (${BIZ}, ${cat.business.assistant ?? 'Lily'}, true)`.execute(t);
  await sql`insert into onboarding_state (business_id, assistant_named_at) values (${BIZ}, now())
            on conflict (business_id) do update set assistant_named_at = now()`.execute(t);
});

// The products a buyer asks about: those with a name in every language compared, else in the language and English.
const named = cat.products.filter((p) => ['en', ...AGAINST, LANG].every((l) => nameIn(p, l)));
const pool = named.length ? named : cat.products;
const against = named.length ? AGAINST : ['en'];
const qtyOf = (p) => Math.max(500, Number(p.moq ?? 0) * 2 || 0);

let phones = 0;
async function conversation(lang) {
  return as(async (t) => {
    const client = (await sql`insert into clients (business_id, phone, display_name)
      values (${BIZ}, ${`+9665${String(Date.now()).slice(-6)}${String(++phones).padStart(3, '0')}`}, 'Release check')
      returning id::text as id`.execute(t)).rows[0].id;
    return (await tenantRepos(t, bid.value).conversations.create(client, 'whatsapp')).conversationId;
  });
}
async function turn(conv, text) {
  return as(async (t) => {
    const messageId = `rc-${randomUUID()}`;
    await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
              values (${conv}::uuid, ${messageId}, 'inbound', 'text', ${text}, clock_timestamp())`.execute(t);
    const ports = { tenant: tenantRepos(t, bid.value), retriever: hybridRetriever(t, bid.value), analyzer, replyWriter: writer, now: () => new Date() };
    const req = { conversationId: conv, messageId, text };
    const r = await computeTurn(ports, req);
    const fx = await commitTurn(ports, req, r, Date.now());
    // What was sent is in the history the next turn reads, as the send path would leave it.
    if (fx.outbound) {
      await sql`insert into messages (conversation_id, direction, input_type, text_content, sent_at)
                values (${conv}::uuid, 'outbound', 'text', ${fx.outbound.reply}, clock_timestamp())`.execute(t);
    }
    const end = fx.outbound ? (r.decision.action.kind === 'handoff' ? 'told' : 'sent') : fx.draftCreated ? 'held' : 'nothing';
    return { end, kind: r.decision.action.kind, said: fx.outbound?.reply ?? r.reply ?? '', signals: r.signals.map((s) => s.kind) };
  });
}

console.log(`provider: ${provider.name} · model: ${provider.model} · ${cat.business.name}: ${cat.products.length} products, ${pool.length} asked about`);
console.log(`language: ${LANG} · compared with: ${against.join(', ')}${named.length ? '' : ` (no product has a ${AGAINST.filter((l) => l !== 'en').join('/')} name)`}\n`);
const runs = [];
let failed = 0;
for (let round = 0; round < 10 && runs.filter((r) => r.lang === LANG).length < 60; round++) {
  const p = pool[round % pool.length];
  const q = qtyOf(p);
  for (const lang of [LANG, ...against]) {
    for (const [name, steps] of CONVERSATIONS) {
      const conv = await conversation(lang);
      for (let i = 0; i < steps.length; i++) {
        const text = WORDS[lang][steps[i]](nameIn(p, lang), q);
        const step = `${name}#${i + 1}`;
        let out;
        try { out = await turn(conv, text); } catch (e) {
          failed++;
          console.log(`  ${lang} ${step.padEnd(8)} FAILED ${String(e?.message ?? e).slice(0, 160)}`);
          break;
        }
        const gendered = lang === 'ar' && (out.end === 'sent' || out.end === 'told') ? addressesInGender(out.said) : null;
        runs.push({ lang, step, end: out.end, gendered, kind: out.kind, signals: out.signals, text, said: out.said, product: p.name });
        if (lang === LANG) {
          console.log(`  ${lang} ${step.padEnd(8)} ${out.end.padEnd(7)}${gendered ? ` GENDERED «${gendered}»` : ''} ${text}\n${' '.repeat(20)}→ ${out.said.replace(/\s+/g, ' ')}`);
        }
        if (out.kind === 'handoff') break;   // a person has it now: the worker runs no further turn
      }
    }
  }
}

const v = verdict(runs, { lang: LANG, against, failed });
console.log(`\n${LANG} turns: ${v.turns} · failed: ${v.failed}`);
console.log(`(b) nothing gendered sent: ${v.gendered.length === 0 ? 'yes' : `NO — ${v.gendered.length}`}`);
for (const g of v.gendered) console.log(`    ${g.step} «${g.gendered}» ${g.said}`);
console.log(`(b) nothing held silent:   ${v.silent.length === 0 ? 'yes' : `NO — ${v.silent.length}`}`);
for (const s of v.silent) console.log(`    ${s.step} ${s.end} — ${s.text} [${s.signals.join(', ')}]`);
console.log(`(b) no split against ${against.join(' or ')}: ${v.splits.length === 0 ? 'yes' : `NO — ${v.splits.length}`}`);
for (const s of v.splits) console.log(`    ${JSON.stringify(s)}`);
console.log(`\n${v.pass ? `PASS — ${LANG} may be released: tools/language-hold.mjs --business ${cat.business.id} --release ${LANG}` : `FAIL — ${LANG} stays held.`}\n`);
const out = flag('json');
if (out) writeFileSync(out, JSON.stringify({ business: cat.business.name, language: LANG, against, provider: provider.name, model: provider.model, verdict: v, runs }, null, 1));
await db.destroy();
process.exit(v.pass ? 0 : 1);
