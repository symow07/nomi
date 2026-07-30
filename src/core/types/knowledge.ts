/**
 * Factory Knowledge Foundation (M13) — descriptive product/business knowledge.
 *
 * THE RULE THIS FILE KEEPS: knowledge is what the employee answers FROM, never
 * a new commitment authority. Committing claims (certifications, incoterms, …)
 * live in claims_policy; numbers still pass guardNumerals (a knowledge number
 * is sayable only because it traces to an active row of the identified
 * product). So `certification` is deliberately absent from KnowledgeKind.
 */

export type KnowledgeKind =
  | 'specification'
  | 'material'
  | 'production_note'
  | 'faq'
  | 'buyer_answer'
  | 'usage'
  | 'restriction';

/** Confidence tier — owner_confirmed > owner_corrected > system_seed. */
export type KnowledgeSource = 'owner_confirmed' | 'owner_corrected' | 'system_seed';

export const SOURCE_RANK: Record<KnowledgeSource, number> = {
  owner_confirmed: 3,
  owner_corrected: 2,
  system_seed: 1,
};

/** A retrieved knowledge row, scoped to the identified product + business-level. */
export type KnowledgeSnippet = {
  readonly id: string;
  /** null = business-level knowledge (its numbers are NOT sourced for numerals). */
  readonly productId: string | null;
  readonly kind: KnowledgeKind;
  readonly label: string;
  readonly content: string;
  readonly source: KnowledgeSource;
  /** 0..1 match score for this turn's query. */
  readonly relevance: number;
};

/** The two kinds that can drive a deterministic, owner-authored reply. */
export const ANSWER_KINDS: ReadonlySet<KnowledgeKind> = new Set(['faq', 'buyer_answer']);
