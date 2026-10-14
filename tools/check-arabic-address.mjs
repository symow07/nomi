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
 * It touches no database and prints no secret: only the provider's kind, the
 * model's name and the prompt's version.
 *
 *   npm run build && railway run --service nomi -- node tools/check-arabic-address.mjs --retry
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
