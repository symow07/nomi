import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MODEL } from './provider.js';
import type { Speaker } from '../core/owner/assistants.js';
import { readFileSync } from 'node:fs';
import type { Analyzer, ReplyWriter, VisionDescriber, PageTranscriber } from './ports.js';
import type { Analysis } from '../core/conversation/decide.js';
import type { Phase, ProductMatch } from '../core/types/conversation.js';
import { parseProductId } from '../core/types/ids.js';

/**
 * Anthropic implementations of the LLM ports.
 *
 * THE MODEL IS PINNED, and the pin is a decision with a date. Until 2026-09-18
 * it was claude-sonnet-4-6, for parity with the n8n engine during the shadow
 * phase (a diff between engines must not conflate engine and model). Cutover
 * is long done; on the day the first real Instagram and Messenger messages
 * arrived, the owner chose Haiku 4.5 on cost — roughly a third of Sonnet's
 * price per buyer message — over the newer, cheaper-than-4.6 Sonnet 5.
 *
 * What that trades: every figure and claim a reply can carry is still gated
 * downstream (guardNumerals, the claims policy, draft-first), so a smaller
 * model cannot invent a price; what it can do is write a worse sentence. The
 * check that decides whether the trade holds is the LEARNING-PLAN's "would you
 * send this?" test on real threads, not the scripted trust scenarios, which
 * never call a model. Haiku 4.5 takes no adaptive thinking and no `effort`;
 * none is sent here.
 */
const MODEL = DEFAULT_MODEL;

/**
 * Prompts are versioned by content hash so the turns table records provenance.
 *
 * M27 — resolved relative to THIS MODULE, not the working directory. It used to
 * read `prompts/<file>`, which resolves against `process.cwd()`: correct only
 * while the process happens to start in the repository root. Any change to the
 * start command's directory would have thrown ENOENT on the FIRST buyer message
 * — after the webhook, after tenant resolution, at the one moment there is a
 * real person waiting. It had never been exercised in production, because
 * messaging has never been on.
 *
 * `dist/` mirrors `src/`, so `../../prompts/` is the repository root from both
 * `src/llm/` under tsx and `dist/llm/` under node.
 */
const PROMPT_DIR = new URL('../../prompts/', import.meta.url);

function loadPrompt(file: string): { text: string; version: string } {
  const text = readFileSync(new URL(file, PROMPT_DIR), 'utf8').trim();
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return { text, version: `${file}@${(h >>> 0).toString(16)}` };
}

/**
 * What a provider needs added to every request. Anthropic's pinned model takes
 * nothing; a provider whose model thinks by default is told not to — her
 * analysis and her replies are short, and paying to think about "do you sell
 * tote bags?" quadruples the tokens and the wait for the same sentence.
 */
export type RequestExtras = { readonly thinking?: { readonly type: 'disabled' } };

/**
 * N6a.1 — the answer is the first TEXT block, wherever it sits.
 *
 * This read `content[0]`, which is the text only for a provider that does not
 * think out loud. DeepSeek's endpoint puts a `thinking` block first, so every
 * analysis and every reply would have been read as empty: the analyser's JSON
 * unparseable, the writer's words replaced by the stand-in sentence. Found with
 * one real call the day the owner switched, before a buyer met it.
 */
const firstText = (content: readonly { readonly type: string }[]): { type: 'text'; text: string } | undefined =>
  content.find((b): b is { type: 'text'; text: string } => b.type === 'text');

const stripFences = (s: string): string =>
  s.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

const PHASES_SET = new Set<Phase>([
  'warm_intake', 'clarification', 'qualification',
  'commercial_discussion', 'confirmation', 'escalated', 'closed',
]);

export function anthropicAnalyzer(client: Anthropic, model: string = MODEL, extra: RequestExtras = {}): Analyzer {
  const prompt = loadPrompt('analysis.txt');

  return {
    async analyze({ text, state, candidates, recentMessages }) {
      // RETRIEVAL, NOT THE CATALOG: only the top-k candidates enter the prompt.
      const catalog = candidates
        .map((c) => `${c.productId}|${c.sku}|${c.name}|${c.category ?? ''}|MOQ:${c.moq}`)
        .join('\n');
      const history = recentMessages
        .map((m) => `[${m.direction === 'inbound' ? 'CLIENT' : 'US'}] ${m.text || '[media]'}`)
        .join('\n');

      const res = await client.messages.create({
        model,
        ...extra,
        max_tokens: 1200,
        temperature: 0.2,
        system: prompt.text,
        messages: [{
          role: 'user',
          content:
            `PRODUCT CATALOG:\n${catalog}\n\nCONVERSATION HISTORY:\n${history}\n\n` +
            `CLIENT MESSAGE:\n${text || '[no text]'}\n\nCURRENT PHASE: ${state.phase}`,
        }],
      });

      const block = firstText(res.content);
      const raw = block?.type === 'text' ? stripFences(block.text) : '{}';

      let analysis: Analysis;
      try {
        analysis = parseAnalysis(JSON.parse(raw), state.phase);
      } catch {
        // Same safe fallback the n8n parser used: unknown intent, stay put.
        analysis = {
          language: { detected: 'en', replyIn: state.preferredLanguage ?? 'en' },
          intent: {
            primary: 'inquiry', productCandidate: null, quantityMentioned: null,
            nextLogicalQuestion: null, missingFields: ['product'],
          },
          recommendedPhase: state.phase,
        };
      }
      return { analysis, promptVersion: prompt.version, modelId: model,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
    },
  };
}

/** Defensive parse: the model's JSON is a claim, not a fact. Validate every field. */
function parseAnalysis(j: Record<string, unknown>, currentPhase: Phase): Analysis {
  const lang = (j['language'] ?? {}) as Record<string, unknown>;
  const intent = (j['intent'] ?? {}) as Record<string, unknown>;
  const phase = (j['phase'] ?? {}) as Record<string, unknown>;

  const rawCandidate = (intent['product_candidates'] as unknown[] | undefined)?.[0] as
    | Record<string, unknown>
    | undefined;

  let productCandidate: ProductMatch | null = null;
  if (rawCandidate && typeof rawCandidate['product_id'] === 'string') {
    // The model may hallucinate a UUID. Parse it; the pipeline later verifies it
    // exists in THIS tenant's catalog before it is ever acted on.
    const pid = parseProductId(rawCandidate['product_id']);
    if (pid.ok) {
      productCandidate = {
        productId: pid.value,
        confidence: Math.max(0, Math.min(1, Number(rawCandidate['confidence'] ?? 0))),
        confirmedByClient: false,   // the model does not get to assert this
        matchMethod: 'text',
      };
    }
  }

  const qty = Number(intent['quantity_mentioned']);
  const recommended = String(phase['recommended_phase'] ?? currentPhase) as Phase;

  return {
    language: {
      detected: String(lang['detected'] ?? 'en'),
      replyIn: String(lang['reply_in'] ?? lang['detected'] ?? 'en'),
    },
    intent: {
      primary: String(intent['primary_intent'] ?? 'inquiry'),
      productCandidate,
      quantityMentioned:
        Number.isFinite(qty) && qty > 0
          ? { value: qty, unit: String(intent['quantity_unit'] ?? 'pcs') }
          : null,
      nextLogicalQuestion:
        typeof intent['next_logical_question'] === 'string'
          ? intent['next_logical_question']
          : null,
      missingFields: Array.isArray(intent['missing_fields'])
        ? intent['missing_fields'].map(String)
        : [],
    },
    recommendedPhase: PHASES_SET.has(recommended) ? recommended : currentPhase,
  };
}

/**
 * A5.3 — what the writer is told about who it is. Exported so a test can read
 * exactly what reaches the model without a network call. A key is present only
 * when the owner said something: the model is given nothing to reason around.
 */
export function speakerContext(speaker: Speaker | null | undefined): Record<string, unknown> {
  if (!speaker) return {};
  const b = speaker.business;
  const business = {
    name: b.name,
    ...(b.kind ? { kind: b.kind } : {}),
    ...(b.country ? { country: b.country } : {}),
    ...(b.description ? { what_it_sells: b.description } : {}),
  };
  const who = speaker.name
    ? { speaker: {
        name: speaker.name,
        ...(speaker.role ? { job: speaker.role } : {}),
        ...(speaker.note ? { how_to_sound: speaker.note } : {}),
      } }
    : {};
  return { business, ...who };
}

export function anthropicReplyWriter(client: Anthropic, model: string = MODEL, extra: RequestExtras = {}): ReplyWriter {
  const prompt = loadPrompt('response.txt');

  return {
    async write({ state, text, quote, replyLanguage, nextQuestion, retryAfterViolation, knowledge, sampleNote, closureNote, speaker }) {
      const context = {
        phase: state.phase,
        reply_language: replyLanguage,
        ...speakerContext(speaker),
        // The ONLY numbers the model ever sees are the quote's + the identified
        // product's taught facts. (ADR-0006 + M13; guardNumerals enforces it.)
        quote: quote && {
          // The currency is named for the model rather than implied by a key,
          // so a reply cannot be written in dollars because the field said so.
          currency: quote.unitPrice.currency,
          unit_price: quote.unitPrice.amount,
          discount_pct: quote.discountPct,
          total: quote.total.amount,
          moq: quote.moq,
          lead_time_days: quote.leadTimeDays,
        },
        // M45 — her sample policy, when she has stated one. Absent is absent:
        // no key, no sentence, nothing for the model to reason around.
        ...(sampleNote ? { sample_policy: sampleNote } : {}),
        // G5 — her closure withheld the date; this is why, for the buyer.
        ...(closureNote ? { closure_note: closureNote } : {}),
        // Taught knowledge to answer FROM (specs/materials/notes/answers).
        // Certifications are NOT here — those stay in claims_policy.
        knowledge: (knowledge ?? []).map((k) => ({ kind: k.kind, about: k.label, fact: k.content })),
        next_question: nextQuestion,
        product_confirmed: state.product?.confirmedByClient ?? false,
      };

      const guard = retryAfterViolation
        ? '\n\nSTRICT: your previous draft contained a number not present in ' +
          'CONTEXT.quote or CONTEXT.knowledge. Use ONLY figures from those, or no figures at all.'
        : '';

      const res = await client.messages.create({
        model,
        ...extra,
        max_tokens: 600,
        temperature: 0.3,
        system: prompt.text + guard,
        messages: [{
          role: 'user',
          content: `CONTEXT:\n${JSON.stringify(context, null, 2)}\n\nCLIENT MESSAGE:\n${text || '[media]'}`,
        }],
      });

      const block = firstText(res.content);
      const raw = block?.type === 'text' ? stripFences(block.text) : '';
      let reply: string;
      try {
        reply = String((JSON.parse(raw) as Record<string, unknown>)['reply_text'] ?? raw);
      } catch {
        reply = raw || 'Thanks for your message — let me get back to you shortly.';
      }
      return { reply, promptVersion: prompt.version, modelId: model,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
    },
  };
}

export function anthropicVision(client: Anthropic, model: string = MODEL, extra: RequestExtras = {}): VisionDescriber {
  const prompt = loadPrompt('image_analysis.txt');

  return {
    async describe({ imageBase64, mediaType, caption }) {
      const res = await client.messages.create({
        model,
        ...extra,
        max_tokens: 500,
        temperature: 0,
        system: prompt.text,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: caption ? `Buyer caption: ${caption}` : 'No caption.' },
          ],
        }],
      });

      const block = firstText(res.content);
      const raw = block?.type === 'text' ? stripFences(block.text) : '{}';
      let searchText = '';
      let attributes: string[] = [];
      try {
        const parsed = JSON.parse(raw) as {
          product_candidates?: { description?: string; visual_attributes?: Record<string, unknown> }[];
          image_quality?: string;
        };
        if (parsed.image_quality !== 'unusable') {
          const top = parsed.product_candidates?.[0];
          searchText = String(top?.description ?? '');
          const va = top?.visual_attributes ?? {};
          attributes = ['material', 'color_dominant', 'size_estimate']
            .map((k) => String(va[k] ?? ''))
            .filter((v) => v && v !== 'unknown');
        }
      } catch { /* unparseable vision output = no description; caller falls back */ }

      return { searchText, attributes, promptVersion: prompt.version, modelId: model,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
    },
  };
}

/**
 * M37 — the page transcriber.
 *
 * TRANSCRIBE, DO NOT INTERPRET. The prompt asks for the lines that are on the
 * page and nothing else: no summarising, no tidying, no filling a blurred row
 * from what the surrounding rows suggest. A price the model completed from
 * context, confirmed by a tired owner at the end of a long import, becomes her
 * catalogue and then her quotes.
 *
 * The extraction happens afterwards, in `parsePriceLines`, over the text this
 * returns. That split is the containment rule: the model produces TEXT, and a
 * deterministic parser produces PRODUCTS. No price can exist that no line
 * contains, because the parser only ever reads lines.
 */
export function anthropicPageTranscriber(client: Anthropic, model: string = MODEL, extra: RequestExtras = {}): PageTranscriber {
  const PROMPT_VERSION = 'page-transcribe-1';
  return {
    async transcribe({ imageBase64, mediaType }) {
      const res = await client.messages.create({
        model,
        ...extra,
        max_tokens: 2000,
        system:
          'You transcribe printed pages. Output ONLY the text that is visibly ' +
          'printed on the page, one line per printed line, in reading order. ' +
          'Do NOT summarise, reformat, translate, correct, or complete anything. ' +
          'If a value is blurred, cut off, or unreadable, write the rest of the ' +
          'line and omit that value — never guess it from the other rows. ' +
          'If you cannot read the page at all, reply with exactly: UNREADABLE',
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: 'Transcribe this page.' },
          ],
        }],
      });
      const block = firstText(res.content);
      const text = block?.type === 'text' ? block.text.trim() : '';
      return {
        text: text === 'UNREADABLE' ? '' : text,
        unreadable: text === 'UNREADABLE' || text.length === 0,
        promptVersion: PROMPT_VERSION,
        modelId: model,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
      };
    },
  };
}
