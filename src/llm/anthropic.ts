import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import type { Analyzer, ReplyWriter, VisionDescriber } from './ports.js';
import type { Analysis } from '../core/conversation/decide.js';
import type { Phase, ProductMatch } from '../core/types/conversation.js';
import { parseProductId } from '../core/types/ids.js';

/**
 * Anthropic implementations of the LLM ports.
 *
 * MODEL PARITY NOTE: claude-sonnet-4-6 is pinned DELIBERATELY — it is the model
 * the n8n engine uses. During the shadow phase both engines must run the same
 * model, or the diff conflates engine differences with model differences.
 * Upgrading the model is a separate experiment, run after cutover, measured by
 * the same decision metrics.
 */
const MODEL = 'claude-sonnet-4-6';

/** Prompts are versioned by content hash so the turns table records provenance. */
function loadPrompt(file: string): { text: string; version: string } {
  const text = readFileSync(`prompts/${file}`, 'utf8').trim();
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return { text, version: `${file}@${(h >>> 0).toString(16)}` };
}

const stripFences = (s: string): string =>
  s.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

const PHASES_SET = new Set<Phase>([
  'warm_intake', 'clarification', 'qualification',
  'commercial_discussion', 'confirmation', 'escalated', 'closed',
]);

export function anthropicAnalyzer(client: Anthropic): Analyzer {
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
        model: MODEL,
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

      const block = res.content[0];
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
      return { analysis, promptVersion: prompt.version, modelId: MODEL,
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

export function anthropicReplyWriter(client: Anthropic): ReplyWriter {
  const prompt = loadPrompt('response.txt');

  return {
    async write({ state, text, quote, replyLanguage, nextQuestion, retryAfterViolation, knowledge }) {
      const context = {
        phase: state.phase,
        reply_language: replyLanguage,
        // The ONLY numbers the model ever sees are the quote's + the identified
        // product's taught facts. (ADR-0006 + M13; guardNumerals enforces it.)
        quote: quote && {
          unit_price_usd: quote.unitPriceUsd,
          discount_pct: quote.discountPct,
          total_usd: quote.totalUsd,
          moq: quote.moq,
          lead_time_days: quote.leadTimeDays,
        },
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
        model: MODEL,
        max_tokens: 600,
        temperature: 0.3,
        system: prompt.text + guard,
        messages: [{
          role: 'user',
          content: `CONTEXT:\n${JSON.stringify(context, null, 2)}\n\nCLIENT MESSAGE:\n${text || '[media]'}`,
        }],
      });

      const block = res.content[0];
      const raw = block?.type === 'text' ? stripFences(block.text) : '';
      let reply: string;
      try {
        reply = String((JSON.parse(raw) as Record<string, unknown>)['reply_text'] ?? raw);
      } catch {
        reply = raw || 'Thanks for your message — let me get back to you shortly.';
      }
      return { reply, promptVersion: prompt.version, modelId: MODEL,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
    },
  };
}

export function anthropicVision(client: Anthropic): VisionDescriber {
  const prompt = loadPrompt('image_analysis.txt');

  return {
    async describe({ imageBase64, mediaType, caption }) {
      const res = await client.messages.create({
        model: MODEL,
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

      const block = res.content[0];
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

      return { searchText, attributes, promptVersion: prompt.version, modelId: MODEL,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
    },
  };
}
