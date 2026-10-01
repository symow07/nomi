import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MODEL } from './provider.js';
import type { Speaker } from '../core/owner/assistants.js';
import { readFileSync } from 'node:fs';
import type { Analyzer, ReplyWriter, VisionDescriber, PageTranscriber, DraftTranslator, PageFactsReader } from './ports.js';
import { parseFactsAnswer } from '../core/owner/pageFacts.js';
import type { CatalogExtractor } from '../core/onboard/catalogImport.js';
import { parseExtractorAnswer } from '../core/onboard/extract.js';
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

/**
 * How long ONE analysis request may take before it is given up — 2026-09-28,
 * when the analysis started deciding whether a buyer wants a person.
 *
 * The SDK's default is ten minutes, and the call is made inside the turn's
 * transaction, holding the conversation's lock, on a worker that takes one
 * message at a time (pg-boss's default): one hung request held every buyer's
 * message for up to half an hour (ten minutes, retried twice). An answer takes
 * a few seconds (Haiku writes this JSON in under five; a slower provider in
 * well under thirty), so thirty seconds, and ONE quick retry for a request
 * that failed outright (the SDK's own backoff, for an overloaded or
 * rate-limited moment): a hung request gives up within about a minute and the
 * turn fails into the queue's retry (message.inbound: three more tries, about
 * 10–20 s, 20–40 s and 40–80 s apart). When those are spent too, the dead
 * letter hands the conversation to a person as `not_answered`
 * (src/worker/main.ts).
 */
const ANALYSIS_REQUEST = { timeout: 30_000, maxRetries: 1 } as const;
/**
 * EXT — a page read or a closer reading the owner waits for on a page: never
 * longer than ninety seconds, one retry. Found 2026-10-01, when the provider
 * stopped answering: without a limit the owner's request waited the SDK's ten
 * minutes. A read that times out is refused as unreadable / failed.
 */
const OWNER_READ_REQUEST = { timeout: 90_000, maxRetries: 1 } as const;

export function anthropicAnalyzer(client: Anthropic, model: string = MODEL, extra: RequestExtras = {}): Analyzer {
  const prompt = loadPrompt('analysis.txt');

  return {
    async analyze({ text, state, candidates, recentMessages, priceFirst }) {
      // RETRIEVAL, NOT THE CATALOG: only the top-k candidates enter the prompt.
      const catalog = candidates
        // 0081 — a product with no minimum says so; never "MOQ:null".
        .map((c) => `${c.productId}|${c.sku}|${c.name}|${c.category ?? ''}|${c.moq === null ? 'no minimum' : `MOQ:${c.moq}`}`)
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
            `CLIENT MESSAGE:\n${text || '[no text]'}\n\nCURRENT PHASE: ${state.phase}` +
            // RT — a shop or a brand gives its price first: no quantity is needed to reach it.
            (priceFirst ? '\n\nSELLING: price first' : ''),
        }],
      }, ANALYSIS_REQUEST);

      const block = firstText(res.content);
      const raw = block?.type === 'text' ? stripFences(block.text) : '{}';

      let analysis: Analysis;
      try {
        analysis = parseAnalysis(JSON.parse(raw), state.phase);
      } catch {
        // Unknown intent, stay put — the n8n parser's fallback — and one thing
        // it never had to say: whether the buyer asked for a person is NOT
        // known. It used to answer as if they had asked an ordinary question;
        // `null` hands the turn to a person as `not_answered` instead.
        analysis = {
          language: { detected: 'en', replyIn: state.preferredLanguage ?? 'en' },
          intent: {
            primary: 'inquiry', productCandidate: null, quantityMentioned: null,
            nextLogicalQuestion: null, missingFields: ['product'],
          },
          recommendedPhase: state.phase,
          wantsPerson: null,
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
    // "Wants a person", layer 2. Only a real boolean is an answer: a missing
    // key, "true" in quotes, null or anything else is an answer that cannot be
    // read, and hands off (core/scoring/detect.ts).
    wantsPerson: typeof j['wants_person'] === 'boolean' ? j['wants_person'] : null,
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
    async write({ state, text, quote, replyLanguage, nextQuestion, retryAfterViolation, knowledge, options, sampleNote, closureNote, speaker, priceFirst }) {
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
          // 0081 — a minimum only where she stated one. Absent is absent: no
          // key, so nothing for the writer to put a "minimum" sentence around.
          ...(quote.moq !== null ? { moq: quote.moq } : {}),
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
        // VAR — the identified product's options, whole. Absent when it has none.
        ...(options?.length ? { options: options.map((o) => ({ name: o.name, values: o.values })) } : {}),
        next_question: nextQuestion,
        product_confirmed: state.product?.confirmedByClient ?? false,
        // RT — present only for a business that gives its price first.
        ...(priceFirst ? { selling: { price_first: true } } : {}),
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
            { type: 'text', text: caption ? `Customer caption: ${caption}` : 'No caption.' },
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
      // EXT — a PDF is a document block, and may hold several pages: more room
      // to write them, and a read that still runs out is refused as cut off.
      const pdf = mediaType === 'application/pdf';
      const res = await client.messages.create({
        model,
        ...extra,
        max_tokens: pdf ? 8000 : 2000,
        // T5 — a transcription has one right answer: no sampling.
        temperature: 0,
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
            pdf
              ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } }
              : { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: pdf ? 'Transcribe every page of this document, in order.' : 'Transcribe this page.' },
          ],
        }],
      }, OWNER_READ_REQUEST);
      const block = firstText(res.content);
      const text = block?.type === 'text' ? block.text.trim() : '';
      return {
        text: text === 'UNREADABLE' ? '' : text,
        unreadable: text === 'UNREADABLE' || text.length === 0,
        // T5 — the read stopped at its limit, mid-page: never passed on as the page.
        cutOff: res.stop_reason === 'max_tokens',
        promptVersion: PROMPT_VERSION,
        modelId: model,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
      };
    },
  };
}

/** G10 — the owner's own reading of a draft in a language they may not read. Never sent. */
export function anthropicDraftTranslator(client: Anthropic, model: string = MODEL, extra: RequestExtras = {}): DraftTranslator {
  return {
    async translate({ text, toLanguage }) {
      const res = await client.messages.create({
        model,
        ...extra,
        max_tokens: 1500,
        temperature: 0,
        system:
          'You translate a reply a business is about to send to its customer, so the business owner can check what it says. ' +
          `Translate it into ${toLanguage}. Keep every number, price, unit, date, product name and person's name exactly as written. ` +
          'Do not add, explain, soften or correct anything. Output only the translation.',
        messages: [{ role: 'user', content: text }],
      });
      const block = firstText(res.content);
      const out = block?.type === 'text' ? block.text.trim() : '';
      if (!out || res.stop_reason === 'max_tokens') return null;
      return { text: out, modelId: model, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
    },
  };
}

/**
 * EXT — the catalogue extractor, for the lines a price list's parser could
 * not read, asked only by the owner. It may only COPY what a line holds: the
 * line, the name and the figures exactly as written, a confidence per field;
 * `containExtracted` then throws away anything a line does not hold, and every
 * surviving row waits for her own tick. Temperature 0: one right reading.
 */
export function anthropicCatalogExtractor(client: Anthropic, model: string = MODEL, extra: RequestExtras = {}): CatalogExtractor {
  const PROMPT_VERSION = 'catalog-extract-1';
  return {
    async extract({ lines, currency }) {
      const res = await client.messages.create({
        model,
        ...extra,
        max_tokens: 4000,
        temperature: 0,
        system:
          'You read lines from a business\'s price list that a simple parser could not read. ' +
          'For each line that names ONE product with its price, return that product; skip headings, notes, and lines naming several products. ' +
          'Copy the line exactly as given into "line". "name" is the product name exactly as written on the line. ' +
          '"price" is the price exactly as written on the line, digits and separators only, no currency sign, or null if the line has none. ' +
          '"unit" is the unit word written on the line (pcs, kg, box...) or null. "moq" is the minimum order quantity only if the line states one, as an integer, else null. ' +
          'Never invent, correct, convert or complete a value: if it is not written on the line, it is null. ' +
          'Give your confidence from 0 to 1 for each field. Reply with JSON only: ' +
          '{"products":[{"line":"","name":"","price":"","unit":"","moq":null,"confidence":{"name":0,"price":0,"unit":0,"moq":0}}]}',
        messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ currency, lines }) }] }],
      }, OWNER_READ_REQUEST);
      const block = firstText(res.content);
      return {
        items: parseExtractorAnswer(block?.type === 'text' ? block.text : ''),
        promptVersion: PROMPT_VERSION,
        modelId: model,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
      };
    },
  };
}

/**
 * EXT — the page-facts reader: a page of the owner's own site into short facts
 * a customer might ask about, each quoting the sentence it came from, word for
 * word. Never a fact the page does not state; `containFacts` checks the quote.
 */
export function anthropicPageFactsReader(client: Anthropic, model: string = MODEL, extra: RequestExtras = {}): PageFactsReader {
  const PROMPT_VERSION = 'page-facts-1';
  return {
    async read({ text }) {
      const res = await client.messages.create({
        model,
        ...extra,
        max_tokens: 3000,
        temperature: 0,
        system:
          'You read a page from a shop\'s own website: shipping, returns, payment, care or similar. ' +
          'List the facts a customer might ask the shop about, at most 20, each in one short plain sentence in the page\'s own language. ' +
          'For each fact, copy into "quote" the exact sentence of the page it comes from, word for word. ' +
          'Only facts the page states: never add, generalise, or complete one. Skip navigation, menus and marketing. ' +
          'Reply with JSON only: {"facts":[{"fact":"","quote":""}]}',
        messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      }, OWNER_READ_REQUEST);
      const block = firstText(res.content);
      return {
        facts: parseFactsAnswer(block?.type === 'text' ? block.text : ''),
        promptVersion: PROMPT_VERSION,
        modelId: model,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
      };
    },
  };
}
