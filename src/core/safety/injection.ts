/**
 * Prompt-injection screen. Runs BEFORE any AI call.
 *
 * A blocklist is not a security boundary and is not treated as one here. The
 * real defence is architectural: the LLM has no authority to quote a price,
 * apply a discount, or confirm an order (see commerce/quote.ts,
 * commerce/confirmable.ts, safety/numerals.ts). This filter exists to cheaply
 * discard the obvious, not to be the wall.
 *
 * HISTORY, because it matters. The n8n filter was:
 *
 *     /ignore (all |previous |your |the )?instructions/
 *
 * The qualifier group matches exactly ONE word, so it caught "ignore all
 * instructions" but NOT "ignore all previous instructions" — two qualifiers.
 * That is the single most common injection string in existence, and it is the
 * literal text of the project's own test case TC-012. The security test was
 * guaranteed to fail. The qualifier group below repeats.
 */

const QUALIFIER = '(?:all\\s+|previous\\s+|prior\\s+|the\\s+|your\\s+|above\\s+|earlier\\s+)*';

const PATTERNS: readonly RegExp[] = [
  new RegExp(`ignore\\s+${QUALIFIER}(?:instructions|prompts?|rules|context)`, 'i'),
  new RegExp(`disregard\\s+${QUALIFIER}(?:instructions|prompts?|rules|everything|context)`, 'i'),
  new RegExp(`forget\\s+${QUALIFIER}(?:instructions|prompts?|rules|everything)`, 'i'),
  /you are now/i,
  /act as (?:a |an )?(?:different|new|unrestricted)/i,
  /pretend (?:you are|to be)/i,
  /jailbreak/i,
  /system prompt/i,
  /reveal your (?:instructions|prompt|rules)/i,
];

export type InjectionVerdict =
  | { readonly detected: false }
  | { readonly detected: true; readonly pattern: string };

export function detectInjection(text: string): InjectionVerdict {
  const t = text ?? '';
  for (const p of PATTERNS) {
    if (p.test(t)) return { detected: true, pattern: p.source };
  }
  return { detected: false };
}

/** Returned instead of an AI reply. Costs nothing and reveals nothing. */
export const SAFE_FALLBACK_REPLY =
  'Thanks for your message — what products are you looking to source today?';
