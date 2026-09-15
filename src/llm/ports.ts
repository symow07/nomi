import type { Analysis } from '../core/conversation/decide.js';
import type { ConversationState } from '../core/types/conversation.js';
import type { Quote } from '../core/types/commerce.js';
import type { RetrievedProduct } from '../retrieval/ports.js';
import type { KnowledgeSnippet } from '../core/types/knowledge.js';

/**
 * LLM ports. The pipeline depends on these, never on a vendor SDK — which is
 * what lets every pipeline test run with fakes, and what makes the analyzer
 * swappable per-tenant later without touching the engine.
 */

export interface Analyzer {
  analyze(input: {
    text: string;
    state: ConversationState;
    candidates: readonly RetrievedProduct[];   // top-k retrieval, NEVER the catalog
    recentMessages: readonly { direction: string; text: string }[];
  }): Promise<{
    analysis: Analysis;
    promptVersion: string;   // provenance for the turns table (ADR-0010 Q1)
    modelId: string;
    usage: { inputTokens: number; outputTokens: number };
  }>;
}

export interface VisionDescriber {
  /**
   * Image → short retrieval text. The model DESCRIBES; it never names a
   * catalog product — matching happens in retrieval, so the containment rule
   * (candidates only from the tenant's own catalog) holds for photos exactly
   * as it does for text.
   */
  describe(input: {
    imageBase64: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    caption: string | null;
  }): Promise<{
    searchText: string;                 // e.g. "canvas tote bag cotton shopping bag"
    attributes: readonly string[];      // e.g. ['canvas', 'tote', 'natural color']
    promptVersion: string;
    modelId: string;
    usage: { inputTokens: number; outputTokens: number };
  }>;
}

export interface ReplyWriter {
  /**
   * Prose only. Every commercially meaningful figure available to the model is
   * already IN the quote it is handed; the caller runs guardNumerals on the
   * output and regenerates/falls back on violation. The writer cannot commit
   * the business to anything — that authority lives in core/commerce.
   */
  write(input: {
    state: ConversationState;
    text: string;
    quote: Quote | null;
    replyLanguage: string;
    nextQuestion: string | null;
    /** second attempt after a numeral violation — be stricter */
    retryAfterViolation: boolean;
    /** M13: the identified product's facts + business-level knowledge to answer
     *  FROM. Prose only — numbers are still gated by guardNumerals (which now
     *  sources the identified product's knowledge numbers). */
    knowledge?: readonly KnowledgeSnippet[];
    /**
     * M45 — what the OWNER said about samples, already turned into a sentence
     * by `sampleAnswerContext`. ABSENT when she has stated nothing, so the
     * model is given nothing to work from rather than being asked to be careful
     * — and `guardNumerals` refuses any sample price either way, because the
     * allow-set only grows from a row she wrote.
     */
    sampleNote?: string;
    /**
     * G5 — present only when a closure of HERS withheld the lead time, from
     * `closureNote`. It tells the buyer why no date came. The lead time itself
     * is already null on the quote, and `guardNumerals` refuses any date.
     */
    closureNote?: string;
  }): Promise<{ reply: string; promptVersion: string; modelId: string;
    usage: { inputTokens: number; outputTokens: number } }>;
}

/**
 * M37 — reading a PAGE, which is not the same job as describing an IMAGE.
 *
 * A SEPARATE PORT ON PURPOSE. `VisionDescriber` describes a photo so retrieval
 * can match it against the owner's catalogue, and its containment rule is that
 * it must NEVER name a product — the catalogue decides what the photo is.
 * This transcribes a printed price sheet, and its containment rule is the
 * opposite: it must never INVENT a line, and the page decides what the
 * catalogue becomes.
 *
 * One interface serving both contracts is how those leak into each other: a
 * describer that has learned to read prices starts naming products, and a
 * transcriber that has learned to describe starts filling in the blurred row.
 *
 * ABSENT IS A LEGITIMATE STATE, exactly as with M34's transcriber. If no page
 * reader is configured, photographing a price list refuses honestly and says
 * why; image MATCHING keeps working, because it is a different port.
 */
export interface PageTranscriber {
  /**
   * Photograph → the lines that are on it, verbatim, one per line.
   *
   * Returns null when the page cannot be read at all. It never returns a
   * partial page: half a price sheet is worse than none, because the owner
   * cannot tell which half she is missing.
   */
  transcribe(input: {
    imageBase64: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  }): Promise<{
    /** The page's text, newline-separated, in reading order. */
    text: string;
    /** The model's own statement that it could not read the page. */
    unreadable: boolean;
    promptVersion: string;
    modelId: string;
    usage: { inputTokens: number; outputTokens: number };
  }>;
}
