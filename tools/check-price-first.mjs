#!/usr/bin/env node
/**
 * RT — "A SHOP'S PRICE QUESTION GETS A PRICE", asked of the model this
 * installation really uses.
 *
 * WHY IT EXISTS. A shop or a brand gives its price first (0095, the owner's
 * correction of 2026-10-01): the turn quotes the price of one as soon as the
 * product is known, and the writer is told `CONTEXT.selling.price_first`. The
 * prompt says to give that price and never to ask how many first — and no
 * test may reach a model (`offlineModels()`), so only this run can show the
 * model does it. The control is a factory: no price, no figure, the quantity
 * asked for.
 *
 * WHAT IT ASKS. Four shop questions (en, zh, ar, es), each with a quote in the
 * shop's own currency, through the real reply writer and the real analyser
 * (dist/llm/anthropic.js, the prompts in prompts/); one factory question with
 * no quote. It prints every reply. It touches no database and prints no
 * secret: only the provider's kind and the model's name.
 *
 * EXIT 0 only when every shop reply states its price and asks no quantity,
 * every shop analysis needs no quantity, and the factory reply states no
 * figure.
 *
 * RUN IT before and after changing the reply or analysis prompt, from a
 * build, inside the service's environment:
 *
 *   npm run build && railway run --service nomi -- node tools/check-price-first.mjs
 */
const { llmProviderFrom, llmClient, requestExtrasFor } = await import('../dist/llm/provider.js');
const { anthropicAnalyzer, anthropicReplyWriter } = await import('../dist/llm/anthropic.js');

const provider = llmProviderFrom(process.env, process.env['ANTHROPIC_API_KEY'] ?? '');
if (!provider.apiKey) {
  console.error('No model key in this environment. Run it inside: railway run --service nomi -- …');
  process.exit(2);
}
const client = llmClient(provider);
const writer = anthropicReplyWriter(client, provider.model, requestExtrasFor(provider));
const analyzer = anthropicAnalyzer(client, provider.model, requestExtrasFor(provider));
console.log(`provider: ${provider.name} · model: ${provider.model}\n`);

const PID = 'b0000000-0000-4000-8000-00000000c001';
const state = (phase) => ({
  conversationId: 'c', businessId: 'b', clientId: 'k', phase, turnCount: 1,
  scores: { problem: 0, lead: 0 },
  product: { productId: PID, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
  quantity: null, contact: { email: null }, pendingQuestion: null, assignedTo: null,
  preferredLanguage: null, contextSummary: null,
});
const quote = (amount, currency) => ({
  unitPrice: { amount, currency }, total: { amount, currency }, discountPct: 0, moq: null, leadTimeDays: null,
});
const speaker = (kind, name) => ({ name: null, role: null, note: null, business: { name, kind, country: null, description: null } });

/** [language, the customer's words, the product, the price, its currency, words that ask how many]. */
const SHOP = [
  ['en', 'How much is the rose lip oil?', 'Rose lip oil', 12, 'AED', /how many|quantit/i],
  ['zh', '玫瑰唇油多少钱？', '玫瑰唇油', 88, 'CNY', /多少(?:个|件|支|瓶)|数量/],
  ['ar', 'كم سعر زيت الشفاه بالورد؟', 'زيت الشفاه بالورد', 45, 'SAR', /كم عدد|الكمية|كم قطعة/],
  ['es', '¿Cuánto cuesta el aceite de labios de rosa?', 'Aceite de labios de rosa', 250, 'MXN', /cu[aá]nt[oa]s|cantidad/i],
];

const hasFigure = (reply, n) => new RegExp(`(?<![\\d.])${n}(?![\\d])`).test(reply.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)));
let bad = 0;

for (const [lang, text, name, price, currency, asksHowMany] of SHOP) {
  const a = await analyzer.analyze({
    text, state: state('clarification'),
    candidates: [{ productId: PID, sku: 'LIP-1', name, category: null, moq: null, relevance: 0.9 }],
    recentMessages: [], priceFirst: true,
  });
  const needsQty = a.analysis.intent.missingFields.includes('quantity');
  const w = await writer.write({
    state: state(a.analysis.recommendedPhase), text, quote: quote(price, currency), replyLanguage: lang,
    nextQuestion: null, retryAfterViolation: false, knowledge: [], speaker: speaker('online_shop', 'Rose & Oak'),
    priceFirst: true,
  });
  const gave = hasFigure(w.reply, price);
  const asked = asksHowMany.test(w.reply);
  const ok = gave && !asked && !needsQty;
  if (!ok) bad++;
  console.log(`${ok ? 'ok ' : 'NO '} [${lang}] phase ${a.analysis.recommendedPhase}${needsQty ? ' · analysis wants a quantity' : ''}${gave ? '' : ' · NO PRICE'}${asked ? ' · ASKS HOW MANY' : ''}\n     ${text}\n  →  ${w.reply}\n`);
}

// The control: a factory that asks how many first, with no quote yet.
{
  const text = 'How much for your canvas tote bags?';
  const w = await writer.write({
    state: state('qualification'), text, quote: null, replyLanguage: 'en',
    nextQuestion: null, retryAfterViolation: false, knowledge: [], speaker: speaker('manufacturer', 'Tianhe Bags'),
  });
  const figure = /\d/.test(w.reply);
  if (figure) bad++;
  console.log(`${figure ? 'NO ' : 'ok '} [factory] no quote, no figure${/how many|quantit/i.test(w.reply) ? ' · asks the quantity' : ''}\n     ${text}\n  →  ${w.reply}\n`);
}

console.log(bad === 0 ? 'every shop question got its price, and the factory gave none' : `${bad} not as the prompt asks`);
process.exit(bad === 0 ? 0 : 1);
