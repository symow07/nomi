#!/usr/bin/env node
/**
 * "Wants a person", layer 2, asked of the model this installation really uses.
 *
 * WHY IT EXISTS. Since 0077 the analysis answers `wants_person` on every turn
 * the word list (layer 1, core/scoring/detect.ts) does not settle, and an
 * answer that cannot be read hands the buyer to a person as `not_answered`
 * ("ambiguous means hand off"). A model or provider that stopped answering it
 * would hand EVERY analysed turn over — and no test can see that, because no
 * test may reach a model (`offlineModels()`). This one asks the real one.
 *
 * WHAT IT ASKS. The sentences the owner named on 2026-09-28, both ways, in
 * en / zh / ar, a few ordinary questions, and the 45 passing mentions of
 * deletion (tests/parity/deletion-corpus.ts) — each through layer 1 and the
 * real analyser (dist/llm/anthropic.js), with the prompt in prompts/. It
 * prints every answer, how many could not be read, and the median time. It
 * touches no database and prints no secret: only the provider's kind and the
 * model's name.
 *
 * EXIT 0 only when no answer was unreadable and every named sentence came back
 * the way the prompt asks. The passing mentions are listed, not judged: on
 * 2026-09-28 (four runs, deepseek-flash) «أرسل رقمي إلى المندوب» ("send my
 * number to the rep") came back as asking for a person every time, and
 * 把我的号码加到群里 ("add my number to the group") three times in four —
 * the prompt doing what it says: only a person on the seller's side can do
 * either, and unsure means hand off. A change in that list is worth reading.
 *
 * RUN IT before and after changing LLM_MODEL / LLM_BASE_URL (or the analysis
 * prompt), from a build, inside the service's environment so the key never
 * appears in a command line (Node 22.18+: it reads the corpus's TypeScript):
 *
 *   npm run build && railway run --service nomi -- node tools/check-person-model.mjs
 */
const { llmProviderFrom, llmClient, requestExtrasFor } = await import('../dist/llm/provider.js');
const { anthropicAnalyzer } = await import('../dist/llm/anthropic.js');
const { asksForPerson } = await import('../dist/core/scoring/detect.js');
const { NOT_REQUESTS } = await import('../tests/parity/deletion-corpus.ts');

const provider = llmProviderFrom(process.env, process.env['ANTHROPIC_API_KEY'] ?? '');
if (!provider.apiKey) {
  console.error('No model key in this environment. Run it inside: railway run --service nomi -- …');
  process.exit(2);
}
const analyzer = anthropicAnalyzer(llmClient(provider), provider.model, requestExtrasFor(provider));
console.log(`provider: ${provider.name} · model: ${provider.model}\n`);

/** [what the prompt asks for, the buyer's words] — true: a person on the seller's side. */
const NAMED = [
  [true, 'Can I talk to someone?'],
  [true, "I'd like to speak with a person please"],
  [true, 'Let me talk to someone'],
  [true, 'Is there anyone there who can actually help me?'],
  [true, 'please call me'],
  [true, 'Am I talking to a real person? I want a human'],
  [true, '我要找你们经理'],
  [true, '转人工'],
  [true, '有没有人能帮我？'],
  [true, '能不能让你们老板跟我谈'],
  [true, 'أريد التحدث مع مديركم'],
  [true, 'أريد أحدًا يساعدني'],
  [true, 'ممكن أكلم موظف؟'],
  [false, 'Do you have human hair wigs?'],
  [false, "I'll ask someone in my team and get back to you"],
  [false, 'You can call me Ahmed'],
  [false, 'My manager approved it, please send the PI'],
  [false, 'Are you a bot?'],
  [false, 'How much for 500 tote bags?'],
  [false, '我们在找人工成本低的工厂'],
  [false, '我们经理会确认价格'],
  [false, '我问一下经理再回复你'],
  [false, '叫我小王就行'],
  [false, '这个包有什么颜色？'],
  [false, 'اريد احدث موديل'],
  [false, 'مديري وافق على السعر'],
  [false, 'أحتاج التحدث مع شخص في شركتي أولاً'],
  [false, 'اسمي أحمد'],
  [false, 'كم سعر ٥٠٠ حقيبة؟'],
];

/**
 * Q1 (2026-09-29) — the analyser now sees the last six messages. The ones
 * that matter: a request for a person EARLIER in the history, already
 * answered by a person and handed back, must not hand every later turn over
 * again; and a short answer is read with the question it answers.
 * [what the prompt asks for, the history (oldest first), the buyer's words]
 */
const C = (text) => ({ direction: 'inbound', text });
const U = (text) => ({ direction: 'outbound', text });
const WITH_HISTORY = [
  [false, [C('Can I talk to someone?'), U('Of course — a colleague will reply here shortly.'), U('Hi, this is Sara from the team. The 12oz totes are $2.40 each.')],
    'Great, and how much for 1000?'],
  [false, [C('转人工'), U('好的，同事马上回复您。'), U('您好，我是销售小李。12盎司帆布袋每个2.40美元。')], '好的，1000个多少钱？'],
  [false, [C('أريد التحدث مع موظف'), U('سيتواصل معك أحد الزملاء قريبًا.'), U('مرحبًا، أنا سارة من الفريق. سعر الحقيبة 2.40 دولار.')], 'شكرًا، كم سعر ١٠٠٠ حقيبة؟'],
  [false, [C('Do you make canvas totes?'), U('Yes — 12oz, natural or black.')], 'natural, 500 of those please'],
  [true, [C('Is the price negotiable for 5000?'), U('Would you like our sales manager to call you about it?')], 'Yes please'],
];

const state = { phase: 'clarification', preferredLanguage: null };
const candidates = [
  { productId: 'p1', sku: 'TOTE-01', name: 'Canvas tote bag', category: 'bags', moq: 100 },
  { productId: 'p2', sku: 'WIG-02', name: 'Human hair wig', category: 'hair', moq: 10 },
];
const times = [];
const ask = async (text, recentMessages = []) => {
  const t0 = Date.now();
  try {
    const r = await analyzer.analyze({ text, state, candidates, recentMessages });
    times.push(Date.now() - t0);
    return r.analysis.wantsPerson;
  } catch (e) {
    return `failed (${String(e?.status ?? e?.name ?? 'error')})`;
  }
};

let unreadable = 0, wrong = 0;
console.log('The sentences the owner named — layer 2 answers each, whatever layer 1 says:');
for (const [expected, text] of NAMED) {
  const got = await ask(text);
  if (got !== true && got !== false) unreadable++;
  else if (got !== expected) wrong++;
  const mark = got === expected ? 'ok ' : 'XX ';
  console.log(`  ${mark} layer 1 ${asksForPerson(text) ? 'hands off' : '—        '} · layer 2 ${String(got).padEnd(5)} (asked for ${expected})  ${JSON.stringify(text)}`);
}

console.log('\nWith what was said before (Q1) — the latest message decides:');
for (const [expected, history, text] of WITH_HISTORY) {
  const got = await ask(text, history);
  if (got !== true && got !== false) unreadable++;
  else if (got !== expected) wrong++;
  const mark = got === expected ? 'ok ' : 'XX ';
  console.log(`  ${mark} layer 2 ${String(got).padEnd(5)} (asked for ${expected})  after ${history.length} · ${JSON.stringify(text)}`);
}

console.log('\nThe 45 passing mentions of deletion — none is a deletion request; these would hand off as asking for a person:');
let mentions = 0, handed = 0;
for (const [lang, texts] of Object.entries(NOT_REQUESTS)) {
  for (const text of texts) {
    mentions++;
    const l1 = asksForPerson(text);
    const got = await ask(text);
    if (got !== true && got !== false) unreadable++;
    if (l1 || got !== false) {
      handed++;
      console.log(`  ${lang} · layer 1 ${l1 ? 'hands off' : '—'} · layer 2 ${String(got)}  ${JSON.stringify(text)}`);
    }
  }
}
if (handed === 0) console.log('  (none)');

const sorted = [...times].sort((a, b) => a - b);
const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
console.log(`\nNamed and with history: ${NAMED.length + WITH_HISTORY.length} asked, ${wrong} answered the other way.`
  + ` Passing mentions: ${mentions} asked, ${handed} would hand off.`
  + ` Unreadable or failed: ${unreadable}. Median answer: ${median} ms.`);
process.exit(unreadable === 0 && wrong === 0 ? 0 : 1);
