import type { Analysis } from '../core/conversation/decide.js';
import type { ConversationState } from '../core/types/conversation.js';
import type { Quote } from '../core/types/commerce.js';
import type { RetrievedProduct } from '../retrieval/ports.js';

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
  }): Promise<{ reply: string; promptVersion: string; modelId: string;
    usage: { inputTokens: number; outputTokens: number } }>;
}
