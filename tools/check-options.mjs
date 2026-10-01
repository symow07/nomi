#!/usr/bin/env node
/**
 * VAR — "DO YOU HAVE IT IN M, IN BLACK?", asked of the model this installation
 * really uses.
 *
 * WHY IT EXISTS. Since 0111 the reply writer is given the identified product's
 * options whole (`CONTEXT.options`), and the prompt says to answer a size or
 * colour only from them, to name what it does come in when the one asked for
 * is not listed, and never to say anything is in stock. No test may reach a
 * model (`offlineModels()`), so only this run can show the model does it.
 *
 * WHAT IT ASKS. In en, zh, ar and es: an option that is listed (the reply
 * names it), one that is not (the reply names one that is), and a request to
 * send today (the reply claims no stock). Through the real reply writer
 * (dist/llm/anthropic.js, prompts/response.txt). It prints every reply. It
 * touches no database and prints no secret: only the provider's kind and the
 * model's name.
 *
 * EXIT 0 only when every reply does as the prompt asks.
 *
 * RUN IT after changing the reply prompt, from a build, inside the service's
 * environment:
 *
 *   npm run build && railway run --service nomi -- node tools/check-options.mjs
 */
const { llmProviderFrom, llmClient, requestExtrasFor } = await import('../dist/llm/provider.js');
const { anthropicReplyWriter } = await import('../dist/llm/anthropic.js');

const provider = llmProviderFrom(process.env, process.env['ANTHROPIC_API_KEY'] ?? '');
if (!provider.apiKey) {
  console.error('No model key in this environment. Run it inside: railway run --service nomi -- …');
  process.exit(2);
}
const writer = anthropicReplyWriter(llmClient(provider), provider.model, requestExtrasFor(provider));
console.log(`provider: ${provider.name} · model: ${provider.model}\n`);

const state = {
  conversationId: 'c', businessId: 'b', clientId: 'k', phase: 'clarification', turnCount: 2,
  scores: { problem: 0, lead: 0 },
  product: { productId: 'b0000000-0000-4000-8000-00000000c002', confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
  quantity: null, contact: { email: null }, pendingQuestion: null, assignedTo: null,
  preferredLanguage: null, contextSummary: null,
};
const speaker = { name: null, role: null, note: null, business: { name: 'Rose & Oak', kind: 'brand', country: null, description: 'dresses' } };

/**
 * [language, options, the customer's words, what the reply must name (any of), what it must not claim].
 * The values are the owner's, as she typed them; a reply may translate them.
 */
const OPTIONS = { en: [{ name: 'Size', values: ['S', 'M', 'L'] }, { name: 'Colour', values: ['black', 'white'] }],
  zh: [{ name: '尺码', values: ['S', 'M', 'L'] }, { name: '颜色', values: ['黑色', '白色'] }],
  ar: [{ name: 'المقاس', values: ['S', 'M', 'L'] }, { name: 'اللون', values: ['أسود', 'أبيض'] }],
  es: [{ name: 'Talla', values: ['S', 'M', 'L'] }, { name: 'Color', values: ['negro', 'blanco'] }] };
const STOCK_WORDS = /in stock|available (?:right )?now|有现货|有货|متوفر(?:ة)? (?:حاليا|الآن)|en stock|disponible (?:ahora|ya)/i;
const CASES = [
  ['en', 'Do you have it in M, in black?', /black/i], ['en', 'Do you have it in green?', /black|white/i], ['en', 'Can you send the black M today?', null],
  ['zh', '有M码的黑色吗？', /黑/], ['zh', '有绿色的吗？', /黑|白/], ['zh', '黑色M码今天能发吗？', null],
  ['ar', 'هل يوجد مقاس M باللون الأسود؟', /أسود|الأسود/], ['ar', 'هل يوجد باللون الأخضر؟', /أسود|أبيض|الأسود|الأبيض/], ['ar', 'هل يمكن إرسال الأسود مقاس M اليوم؟', null],
  ['es', '¿Lo tienen en M, en negro?', /negro/i], ['es', '¿Lo tienen en verde?', /negro|blanco/i], ['es', '¿Pueden enviar el negro en M hoy?', null],
];

let bad = 0;
for (const [lang, text, mustName] of CASES) {
  const w = await writer.write({
    state, text, quote: null, replyLanguage: lang, nextQuestion: null, retryAfterViolation: false,
    knowledge: [], options: OPTIONS[lang], speaker,
  });
  const named = mustName === null || mustName.test(w.reply);
  const stock = STOCK_WORDS.test(w.reply);
  const ok = named && !stock;
  if (!ok) bad++;
  console.log(`${ok ? 'ok ' : 'NO '} [${lang}]${named ? '' : ' · DOES NOT NAME AN OPTION'}${stock ? ' · CLAIMS STOCK' : ''}\n     ${text}\n  →  ${w.reply}\n`);
}
console.log(bad === 0 ? 'every option answered from the list, and no stock claimed' : `${bad} not as the prompt asks`);
process.exit(bad === 0 ? 0 : 1);
