#!/usr/bin/env node
/**
 * THE VOICE, ON THE MODEL THIS INSTALLATION REALLY USES (Block 3 PR 1; 0228).
 *
 * WHY IT EXISTS. The owner chooses a tone, a length and an emoji rule on the assistant's page, and the writer's prompt
 * takes them as fixed instructions (prompts/response.txt, VOICE). No test may reach a model (`offlineModels()`), so
 * whether a real model follows them is proven here and nowhere else — and the owner reads the samples.
 *
 * WHAT IT ASKS. One customer message, twelve times: every tone (plain, warm, formal) × every length (short, normal) ×
 * every emoji rule (never, like the customer), with the same CONTEXT.quote (one price) and the same speaker. For each
 * reply it prints the words, how many sentences, whether an emoji appears, and every figure the reply holds that is
 * not the quote's — the figure guard's own job in the turn, counted here so a voice that invents is seen. It touches
 * no database and prints no secret: only the provider's kind and the model's name.
 *
 * THE SAMPLES are written to ~/nomi-private/voice-samples-<UTC day>.md (outside the repository, the owner's folder),
 * so they can be read later without asking again. EXIT 0 only when all twelve answered and no reply holds a figure
 * the quote does not.
 *
 * TWELVE PAID CALLS. Run it only with the owner's yes, from a build, inside the service's environment so the key never
 * appears in a command line:
 *
 *   npm run build && railway run --service nomi -- node tools/check-voice.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const { llmProviderFrom, llmClient, requestExtrasFor } = await import('../dist/llm/provider.js');
const { anthropicReplyWriter } = await import('../dist/llm/anthropic.js');
const { modelEnvFor } = await import('./lib/model-env.mjs');

const modelEnv = modelEnvFor(process.argv, process.env);
if (!modelEnv) { console.error('--fallback: LLM_FALLBACK_BASE_URL, LLM_FALLBACK_API_KEY and LLM_FALLBACK_MODEL are not all set.'); process.exit(2); }
const provider = llmProviderFrom(modelEnv, process.env['ANTHROPIC_API_KEY'] ?? '');
if (!provider.apiKey) { console.error('No model key in this environment. Run it inside: railway run --service nomi -- …'); process.exit(2); }
const writer = anthropicReplyWriter(llmClient(provider), provider.model, requestExtrasFor(provider));
console.log(`provider: ${provider.name} · model: ${provider.model}\n`);

const MESSAGE = 'Hi! Do you have the rose lip oil in a smaller size? 😊 And how much is it?';
const state = {
  aiDisclosedAt: null, aiDisclosureDeliveredAt: null,
  conversationId: 'd0000000-0000-0000-0000-000000000001', businessId: 'a0000000-0000-0000-0000-000000000001', clientId: 'c0000000-0000-0000-0000-000000000001',
  phase: 'commercial_discussion', turnCount: 2, scores: { problem: 0, lead: 0 },
  product: { productId: 'b0000000-0000-0000-0000-000000000001', confirmedByClient: true }, quantity: null,
  contact: { email: null }, pendingQuestion: null, assignedTo: null, preferredLanguage: 'en', contextSummary: null,
};
const quote = { unitPrice: { currency: 'USD', amount: '12.00' }, discountPct: 0, total: { currency: 'USD', amount: '12.00' }, moq: null, leadTimeDays: null, productId: state.product.productId, quantity: 1 };
const options = [{ name: 'Size', values: ['Regular'] }];
const business = { name: 'Rosa Beauty', kind: 'brand', country: 'US', description: 'Lip and skin care' };
const TONES = ['plain', 'warm', 'formal']; const LENGTHS = ['short', 'normal']; const EMOJI = ['never', 'like_customer'];
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const figures = (s) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).filter((f) => !['12', '12.00', '12,00'].includes(f));

const lines = [`# Voice samples — ${new Date().toISOString()}`, '', `provider: ${provider.name} · model: ${provider.model}`, '', `Customer: ${MESSAGE}`, `Quote: 12.00 USD · options: Size: Regular`, ''];
let answered = 0, invented = 0;
for (const tone of TONES) for (const length of LENGTHS) for (const emoji of EMOJI) {
  const speaker = { name: 'Noor', role: 'sales', note: null, voice: { tone, length, emoji }, business };
  const t0 = Date.now();
  let reply = null;
  try { reply = (await writer.write({ state, text: MESSAGE, quote, replyLanguage: 'en', nextQuestion: null, retryAfterViolation: false, speaker, options, knowledge: [], priceFirst: true })).reply; }
  catch (e) { reply = null; console.log(`  XX ${tone}/${length}/${emoji}: the call failed (${e?.constructor?.name ?? 'error'})`); }
  const ms = Date.now() - t0;
  if (reply) answered++;
  const sentences = reply ? (reply.match(/[.!?。！？](\s|$)/g) ?? []).length : 0;
  const extra = reply ? figures(reply) : [];
  if (extra.length) invented++;
  const head = `${tone.padEnd(6)} ${length.padEnd(6)} ${emoji.padEnd(13)} · ${sentences} sentences · emoji ${reply && EMOJI_RE.test(reply) ? 'yes' : 'no '} · ${ms} ms${extra.length ? ` · FIGURES NOT IN THE QUOTE: ${extra.join(' ')}` : ''}`;
  console.log(`  ${reply ? (extra.length ? 'XX' : 'ok') : 'XX'} ${head}`);
  console.log(`     ${JSON.stringify(reply)}`);
  lines.push(`## ${tone} · ${length} · ${emoji}`, '', head, '', reply ?? '(no reply)', '');
}
const dir = join(homedir(), 'nomi-private'); mkdirSync(dir, { recursive: true });
const file = join(dir, `voice-samples-${new Date().toISOString().slice(0, 10)}.md`);
writeFileSync(file, lines.join('\n'));
console.log(`\n${answered} of 12 answered; ${invented} held a figure the quote does not. Samples: ${file}`);
process.exit(answered === 12 && invented === 0 ? 0 : 1);
