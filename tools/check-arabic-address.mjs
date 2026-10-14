#!/usr/bin/env node
/**
 * Rule 6, asked of the model this installation really uses: does an Arabic
 * reply address the buyer as a man or a woman?
 *
 * WHY IT EXISTS. On 2026-10-13 a Practice reply asked «هل تبحث عن مقاس معين؟»
 * ("are you [a man] looking for a size?"). The writer's prompt now says how to
 * write instead, and the guard (src/core/safety/address.ts) rewrites, then
 * hands to a person, whatever still does. No test may reach a model
 * (`offlineModels()`), so no test can say how often the writer does it, or
 * whether the prompt changed that. This one asks the real one.
 *
 * WHAT IT ASKS. Twelve Arabic buyer messages across the phases — a greeting, a
 * vague need, sizes and colours, a price, a discount, a "yes", a manager, "are
 * you a bot?" — each written `--repeats` times (default 5) by the real reply
 * writer (dist/llm/anthropic.js) with the prompt in prompts/. Every reply is
 * printed with what the guard read in it, so a reader can find what the guard
 * missed. `--retry` does what the turn does when the guard catches one: writes
 * it again, told why, and counts what is still caught — each of those would
 * go to a person, never to the buyer.
 *
 * `--through-the-turn` (the owner, 2026-10-14: "confirm those … went to hand-over and not to silence: a buyer who
 * gets nothing is not a pass") runs the same messages through the REAL engine instead (computeTurn + commitTurn, the
 * golden scenarios' world, every capability on auto, the real analyser and writer) and says, for every reply the
 * guard caught, what reached the buyer: rewritten and sent, handed to a person with the buyer told, held as a draft
 * (the buyer waits), or nothing. Exit 1 if any caught reply ends in a held draft or in nothing.
 *
 * It touches no database and prints no secret: only the provider's kind, the
 * model's name and the prompt's version.
 *
 *   npm run build && railway run --service nomi -- node tools/check-arabic-address.mjs --retry
 *   npm run build && railway run --service nomi -- node tools/check-arabic-address.mjs --through-the-turn
 */
const { llmProviderFrom, llmClient, requestExtrasFor } = await import('../dist/llm/provider.js');
const { anthropicReplyWriter } = await import('../dist/llm/anthropic.js');
const { addressesInGender } = await import('../dist/core/safety/address.js');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const REPEATS = Math.max(1, Math.min(20, Number(arg('--repeats', '5')) || 5));
const RETRY = process.argv.includes('--retry');
const THROUGH = process.argv.includes('--through-the-turn');

const provider = llmProviderFrom(process.env, process.env['ANTHROPIC_API_KEY'] ?? '');
if (!provider.apiKey) {
  console.error('No model key in this environment. Run it inside: railway run --service nomi -- …');
  process.exit(2);
}
const writer = anthropicReplyWriter(llmClient(provider), provider.model, requestExtrasFor(provider));

const usd = (amount) => ({ amount, currency: 'USD' });
const tote = { productId: 'p1', confidence: 0.9, confirmedByClient: false, matchMethod: 'text' };
const QUOTE_500 = {
  unitPrice: usd(3.8), discountPct: 0, total: usd(1900), moq: 100, leadTimeDays: 12,
  quantity: { value: 500, unit: 'pcs' },
};
const SIZES = [{ name: 'Size', values: ['30x40 cm', '38x42 cm'] }, { name: 'Colour', values: ['natural', 'black'] }];
const speaker = {
  name: 'Lily', role: 'sales', note: null,
  business: { name: 'Linden Totes', kind: 'shop', country: null, description: 'canvas tote bags' },
};

/** [label, phase, the buyer's words, extra input] */
const CASES = [
  ['greeting', 'warm_intake', 'مرحبا، عندكم حقائب قماش؟', {}],
  ['shop owner', 'warm_intake', 'السلام عليكم، أبحث عن أكياس تسوق لمحلي', {}],
  ['vague need', 'warm_intake', 'أحتاج شيئًا لهدايا الشركة', {}],
  ['sizes', 'clarification', 'أريد حقيبة قماش، ما المقاسات المتوفرة؟', { product: tote, options: SIZES }],
  ['colour', 'clarification', 'هل يوجد لون أسود؟', { product: tote, options: SIZES }],
  ['confirmed', 'qualification', 'نعم هذه هي الحقيبة المطلوبة', { product: { ...tote, confirmedByClient: true } }],
  ['price early', 'qualification', 'كم السعر؟', { product: { ...tote, confirmedByClient: true } }],
  ['price', 'commercial_discussion', 'كم سعر 500 حقيبة؟', { product: { ...tote, confirmedByClient: true }, quote: QUOTE_500 }],
  ['discount', 'commercial_discussion', 'هل يمكن تخفيض السعر قليلاً؟', { product: { ...tote, confirmedByClient: true }, quote: QUOTE_500 }],
  ['yes', 'confirmation', 'تمام، أريد 500 قطعة', { product: { ...tote, confirmedByClient: true }, quote: QUOTE_500 }],
  ['manager', 'escalated', 'أريد التحدث مع المدير', {}],
  ['bot?', 'warm_intake', 'هل أنت روبوت؟', {}],
];

const write = async ([, phase, text, extra], violation) => {
  const state = {
    phase, product: extra.product ?? null, quantity: null, contact: { email: null }, pendingQuestion: null,
  };
  try {
    const w = await writer.write({
      state, text, quote: extra.quote ?? null, replyLanguage: 'ar', nextQuestion: null,
      retryAfterViolation: violation !== undefined, ...(violation ? { violation } : {}),
      knowledge: [], ...(extra.options ? { options: extra.options } : {}), speaker,
    });
    return { reply: w.reply, version: w.promptVersion };
  } catch (e) {
    return { reply: null, failed: String(e?.status ?? e?.name ?? 'error') };
  }
};

if (THROUGH) {
  const { evaluateScenario } = await import('../dist/trust/harness.js');
  const { SCENARIOS, TRUST_PRODUCT_ID, bags, candidate } = await import('../dist/trust/scenarios.js');
  const { CAPABILITIES } = await import('../dist/core/conversation/autonomy.js');
  const { anthropicAnalyzer } = await import('../dist/llm/anthropic.js');
  const analyzer = anthropicAnalyzer(llmClient(provider), provider.model, requestExtrasFor(provider));
  const base = SCENARIOS.find((x) => x.id === 'auto-qualify-grant-sends');
  const told = { aiDisclosedAt: new Date('2026-07-14T11:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-07-14T11:00:05Z') };
  const theBag = (confirmed) => ({ productId: TRUST_PRODUCT_ID, confidence: 0.9, confirmedByClient: confirmed, matchMethod: 'text' });
  /** The engine's own state for each case's phase. */
  const stateFor = (phase) => ({
    phase, ...told,
    ...(phase === 'warm_intake' ? {} : { product: theBag(phase !== 'clarification') }),
    ...(phase === 'commercial_discussion' || phase === 'confirmation' ? { quantity: { value: 5000, unit: 'pcs' } } : {}),
    ...(phase === 'confirmation' ? { pendingQuestion: 'order_confirmation' } : {}),
  });
  const ends = { sent: 0, told: 0, held: 0, nothing: 0 };
  let turns = 0, caught = 0, failed = 0, leaked = 0;
  console.log(`provider: ${provider.name} · model: ${provider.model} · repeats: ${REPEATS} · through the turn, every capability on auto`);
  for (const c of CASES) {
    console.log(`\n${c[0]} (${c[1]}) — ${c[2]}`);
    const scenario = {
      ...base, id: `arabic-${c[0]}`, catalog: [bags()], candidates: [candidate(bags())], analysis: undefined,
      grants: CAPABILITIES.map((capability) => ({ capability, mode: 'auto', timeWindow: null })),
      state: stateFor(c[1]),
    };
    for (let i = 0; i < REPEATS; i++) {
      let outcome;
      try {
        ({ outcome } = await evaluateScenario(scenario, { text: c[2], analyzer, replyWriter: writer }));
      } catch (e) { failed++; console.log(`  failed (${String(e?.status ?? e?.name ?? 'error')})`); continue; }
      turns++;
      const { result, effects } = outcome;
      const end = effects.outbound ? (result.decision.action.kind === 'handoff' ? 'told' : 'sent')
        : effects.draftCreated ? 'held' : 'nothing';
      const words = result.genderedAddress;
      if (words) { caught++; ends[end]++; }
      const said = effects.outbound?.reply ?? result.reply ?? '';
      // What reached the buyer, read again by the guard: a rewrite it passed is still checked here, in full.
      const still = effects.outbound ? addressesInGender(said) : null;
      if (still) leaked++;
      console.log(`  ${words ? `CAUGHT «${words}» → ${end.padEnd(7)}` : `ok · ${end.padEnd(14)}`}${still ? ` STILL «${still}»` : ''} ${said.replace(/\s+/g, ' ')}`);
    }
  }
  console.log(`\nturns: ${turns} · failed: ${failed} · caught by the guard: ${caught}`);
  console.log(`of those caught — rewritten and sent: ${ends.sent} · handed to a person, buyer told: ${ends.told} · held as a draft: ${ends.held} · nothing: ${ends.nothing}`);
  console.log(`sent and still read as gendered by the guard: ${leaked}`);
  process.exit(failed > 0 || ends.held > 0 || ends.nothing > 0 || leaked > 0 ? 1 : 0);
}

console.log(`provider: ${provider.name} · model: ${provider.model} · repeats: ${REPEATS}${RETRY ? ' · with the retry' : ''}`);
let total = 0, caught = 0, failed = 0, stillCaught = 0, version = '';
for (const c of CASES) {
  console.log(`\n${c[0]} (${c[1]}) — ${c[2]}`);
  for (let i = 0; i < REPEATS; i++) {
    const first = await write(c);
    if (first.reply === null) { failed++; console.log(`  failed (${first.failed})`); continue; }
    version = first.version;
    total++;
    const words = addressesInGender(first.reply);
    if (words !== null) caught++;
    console.log(`  ${words ? `CAUGHT «${words}»` : 'ok    '}  ${first.reply.replace(/\s+/g, ' ')}`);
    if (words !== null && RETRY) {
      const again = await write(c, 'gendered_address');
      const still = again.reply === null ? 'failed' : addressesInGender(again.reply);
      if (still !== null) stillCaught++;
      console.log(`    again: ${still ? `CAUGHT «${still}» → a person` : 'ok    '}  ${(again.reply ?? '').replace(/\s+/g, ' ')}`);
    }
  }
}
console.log(`\nprompt: ${version}`);
console.log(`replies: ${total} · caught on the first writing: ${caught} (${total ? Math.round((100 * caught) / total) : 0}%) · failed: ${failed}`);
if (RETRY) console.log(`caught again after the retry (would go to a person): ${stillCaught}`);
process.exit(failed > 0 ? 1 : 0);
