#!/usr/bin/env node
/**
 * The advisor, asked of the model this installation really uses.
 *
 * WHY IT EXISTS. The advisor's two calls (src/llm/anthropic.ts `anthropicAdvisorModel`) are the only part of
 * it no test reaches: tests use a scripted model (`offlineModels()` — no test may reach a real one). A model
 * that routes questions to the wrong entry answers the wrong question with true facts; one whose sentences
 * keep failing the check (src/advisor/check.ts) leaves the owner reading bare facts. This asks the real one.
 *
 * WHAT IT ASKS. Synthetic questions and facts only — no database is touched, no customer's data is sent:
 *   1. ROUTING: questions in en / zh / ar / es / fr for fourteen entries (and one nobody can answer), each
 *      against the whole catalogue (src/advisor/catalogue.ts). Each must come back as the expected entry,
 *      with the period, the customer or the order reference the question names.
 *   2. WORDING: five answers per language from facts built the way src/advisor/reads.ts builds them (the
 *      catalogue's own sentences, the product's own number, money and date formats), each put through the
 *      product's check. A sentence that fails is safe — the owner then reads the facts themselves — but
 *      it is counted, and printed with why.
 * It prints every answer and the median time; only the provider's kind and the model's name, no secret.
 *
 * EXIT 0 only when every question routed as expected, nothing came back unreadable, and at least half of
 * the sentences passed the check. Run it before and after changing LLM_MODEL / LLM_BASE_URL or the
 * advisor's prompts, from a build, inside the service's environment so the key never appears in a command
 * line — and never while the integration suite runs:
 *
 *   npm run build && railway run --service nomi -- node tools/check-advisor-model.mjs
 */
const { llmProviderFrom, llmClient, requestExtrasFor } = await import('../dist/llm/provider.js');
const { anthropicAdvisorModel } = await import('../dist/llm/anthropic.js');
const { CATALOGUE, entryOf } = await import('../dist/advisor/catalogue.js');
const { checkPhrasing } = await import('../dist/advisor/check.js');
const { t } = await import('../dist/api/web/say.js');
const show = await import('../dist/api/web/values.js');
const { moneyFromRow } = await import('../dist/core/types/money.js');

const provider = llmProviderFrom(process.env, process.env['ANTHROPIC_API_KEY'] ?? '');
if (!provider.apiKey) {
  console.error('No model key in this environment. Run it inside: railway run --service nomi -- …');
  process.exit(2);
}
const model = anthropicAdvisorModel(llmClient(provider), provider.model, requestExtrasFor(provider));
console.log(`provider: ${provider.name} · model: ${provider.model}\n`);

const LANGUAGE = { en: 'English', zh: 'Simplified Chinese', ar: 'Arabic', es: 'Spanish', fr: 'French' };
const entries = CATALOGUE.map((e) => ({ id: e.id, ask: e.ask }));
const times = [];
const timed = async (fn) => { const t0 = Date.now(); try { return await fn(); } finally { times.push(Date.now() - t0); } };

/** [expected entry, what it must also carry, the question in en, zh, ar, es, fr]. */
const ROUTES = [
  ['A1', {}, ['How many customers do I have?', '我有多少客户？', 'كم عدد عملائي؟', '¿Cuántos clientes tengo?', 'Combien de clients ai-je ?']],
  ['B1', {}, ['Who is waiting for me?', '谁在等我回复？', 'من ينتظر ردي الآن؟', '¿Quién me está esperando?', 'Qui m’attend ?']],
  ['B8', {}, ['How fast do we reply to customers?', '我们回复客户有多快？', 'ما سرعة الرد على العملاء؟', '¿Qué tan rápido respondemos a los clientes?', 'En combien de temps répondons-nous aux clients ?']],
  ['C1', {}, ['Which customers have gone quiet?', '哪些客户不回复了？', 'أي العملاء توقفوا عن الرد؟', '¿Qué clientes dejaron de responder?', 'Quels clients ne répondent plus ?']],
  ['D1', { period: 'month' }, ['How much did we sell this month?', '这个月卖了多少？', 'كم بلغت مبيعاتنا هذا الشهر؟', '¿Cuánto vendimos este mes?', 'Combien avons-nous vendu ce mois-ci ?']],
  ['D6', {}, ['What is my conversion rate?', '我的转化率是多少？', 'ما معدل التحويل لدي؟', '¿Cuál es mi tasa de conversión?', 'Quel est mon taux de conversion ?']],
  ['D8', {}, ['What are my sales converted at my exchange rate?', '按我的汇率换算，销售额是多少？', 'كم مبيعاتي بعد التحويل بسعر الصرف الذي حددته؟', '¿Cuánto son mis ventas convertidas a mi tipo de cambio?', 'Combien font mes ventes converties à mon taux de change ?']],
  ['D9', {}, ['Has Amira Haddad paid?', 'Amira Haddad付款了吗？', 'هل وصل الدفع من Amira Haddad؟', '¿Ya pagó Amira Haddad?', 'Le paiement d’Amira Haddad est-il arrivé ?']],
  ['D11', { reference: 'ADV-1042' }, ['Where is order ADV-1042?', '订单ADV-1042到哪了？', 'أين وصل الطلب ADV-1042؟', '¿Dónde está el pedido ADV-1042?', 'Où en est la commande ADV-1042 ?']],
  ['E1', { period: 'today' }, ['What is on the calendar today?', '今天日程上有什么？', 'ما المقرر في الجدول اليوم؟', '¿Qué hay en la agenda hoy?', 'Qu’y a-t-il au programme aujourd’hui ?']],
  ['A3', { customer: 'Amira' }, ['Tell me about Amira Haddad.', '说说客户Amira Haddad。', 'أخبرني عن العميل Amira Haddad.', 'Háblame de Amira Haddad.', 'Parle-moi d’Amira Haddad.']],
  ['I3', {}, ['Who should I follow up with first?', '我应该先跟进谁？', 'من الأولى بالمتابعة أولًا؟', '¿A quién debería hacer seguimiento primero?', 'Qui devrais-je relancer en premier ?']],
  ['F5', {}, ['How much stock do I have left?', '我还有多少库存？', 'كم تبقّى في المخزون؟', '¿Cuánto inventario me queda?', 'Combien de stock me reste-t-il ?']],
  ['I6', {}, ['What are my competitors doing?', '我的竞争对手在做什么？', 'ماذا يفعل المنافسون؟', '¿Qué está haciendo mi competencia?', 'Que font mes concurrents ?']],
  [null, {}, ['What will the weather be tomorrow?', '明天天气怎么样？', 'كيف سيكون الطقس غدًا؟', '¿Qué tiempo hará mañana?', 'Quel temps fera-t-il demain ?']],
];

let misrouted = 0; let unreadable = 0;
console.log('— routing —');
for (const [want, carry, questions] of ROUTES) {
  for (const [i, q] of questions.entries()) {
    const l = ['en', 'zh', 'ar', 'es', 'fr'][i];
    let got;
    try { got = await timed(() => model.recognise({ question: q, entries })); } catch (e) { got = undefined; console.log(`  ✗ ${l} ${q}  → error ${e.message}`); unreadable++; continue; }
    if (got === null) { if (want !== null) { unreadable++; console.log(`  ✗ ${l} ${q}  → unreadable`); } else console.log(`  ✓ ${l} ${q}  → unknown (unreadable)`); continue; }
    const id = entryOf(got.id) ? got.id : null;
    const carried = Object.entries(carry).every(([k, v]) => (got[k] ?? '').toLowerCase().includes(v.toLowerCase()));
    const ok = id === want && carried;
    if (!ok) misrouted++;
    console.log(`  ${ok ? '✓' : '✗'} ${l} ${q}  → ${got.id}${got.period ? ` period=${got.period}` : ''}${got.customer ? ` customer=${got.customer}` : ''}${got.reference ? ` reference=${got.reference}` : ''}${ok ? '' : `   (expected ${want ?? 'unknown'}${Object.keys(carry).length ? ` ${JSON.stringify(carry)}` : ''})`}`);
  }
}

/** The facts as the reads would write them, in the owner's language. */
const FACTS = (l) => {
  const L = (k, p = {}) => t(l, k, p);
  const n = (x) => show.count(l, x);
  const day = (iso) => show.date(l, new Date(iso));
  const usd = (x) => show.money(l, moneyFromRow(x, 'USD'));
  const median = show.timeLeft(l, 2 * 3_600_000 + 5 * 60_000);
  return [
    { q: ROUTES[0][2], facts: [L('advisor.k.customers', { n: n(12) })], names: [] },
    { q: ROUTES[4][2], facts: [L('advisor.period.month', { since: show.dayMonth(l, '2026-10-01') }), L('advisor.k.orders', { n: n(3) }), L('advisor.k.sales', { amount: usd(1250) })], names: [] },
    { q: ROUTES[2][2], facts: [L('advisor.period.week', { since: show.dayMonth(l, '2026-10-05') }), L('advisor.k.replyMedian', { time: median }), L('advisor.k.replyMeasured', { n: n(14) }), L('advisor.k.replyUnanswered', { n: n(6) })],
      names: [], must: [median, n(14), n(6)] },
    { q: ROUTES[3][2], facts: [L('advisor.k.quiet.quote', { name: 'Amira Haddad', when: day('2026-09-29T10:00:00Z') }), L('advisor.k.quiet.reply', { name: 'Bao Lin', when: day('2026-09-30T15:00:00Z') })],
      names: ['Amira Haddad', 'Bao Lin'] },
    { q: ROUTES[11][2], opinion: true, facts: [L('advisor.k.quiet.quote', { name: 'Amira Haddad', when: day('2026-09-29T10:00:00Z') }), L('advisor.k.quiet.regular', { name: 'Bao Lin', when: day('2026-08-20T10:00:00Z') }), L('advisor.k.spent', { name: 'Bao Lin', amount: usd(9400) })],
      names: ['Amira Haddad', 'Bao Lin'] },
  ];
};
const KNOWN = ['Amira Haddad', 'Bao Lin', 'Carlos Mendes', 'Canvas tote', 'Linen apron'];

let passed = 0; let worded = 0;
console.log('\n— wording (checked by src/advisor/check.ts) —');
for (const [i, l] of ['en', 'zh', 'ar', 'es', 'fr'].entries()) {
  for (const f of FACTS(l)) {
    const question = f.q[i];
    let text;
    try { text = await timed(() => model.phrase({ question, language: LANGUAGE[l], facts: f.facts, opinion: !!f.opinion })); } catch (e) { text = null; console.log(`  ✗ ${l} ${question}  → error ${e.message}`); }
    worded++;
    if (!text) { unreadable++; console.log(`  ✗ ${l} ${question}  → nothing`); continue; }
    const c = checkPhrasing(text, { facts: f.facts, names: f.names, known: KNOWN, must: f.must ?? [], locale: l });
    if (c.ok) passed++;
    console.log(`  ${c.ok ? '✓' : '✗'} ${l} ${question}\n      ${text.replace(/\n/g, ' ')}${c.ok ? '' : `\n      (thrown away: ${c.why})`}`);
  }
}

const sorted = [...times].sort((a, b) => a - b);
console.log(`\nrouted: ${ROUTES.length * 5 - misrouted}/${ROUTES.length * 5} · unreadable: ${unreadable} · sentences that passed the check: ${passed}/${worded} · median ${sorted[Math.floor(sorted.length / 2)]} ms`);
process.exit(misrouted === 0 && unreadable === 0 && passed * 2 >= worded ? 0 : 1);
