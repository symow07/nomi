import { type Result, ok, err } from '../types/result.js';

/**
 * The claims guard — the numeral guard's sibling. (Priority 4)
 *
 * "CE certified", "we ship DDP", "full refund guarantee", "delivery before
 * Ramadan" contain no digits, but each is a commitment a B2B buyer will hold
 * the business to. The numeral guard cannot see them; this guard can.
 *
 * Same architecture, same rule: DETERMINISTIC detection, DEFAULT-DENY against
 * policy rows. A claim class instance the business has not explicitly allowed
 * in `claims_policy` may never reach a customer — the model does not get a
 * vote. Detection is intentionally high-recall / pattern-based: a false
 * positive costs one regeneration; a false negative is a binding promise.
 */

export type ClaimKind =
  | 'certification'
  | 'incoterm'
  | 'payment_terms'
  | 'guarantee'
  | 'shipping_method'
  | 'compliance'
  | 'delivery_promise';

export type AllowedClaim = {
  readonly kind: ClaimKind;
  readonly claimKey: string;   // canonical key, e.g. 'CE', 'DDP', 'deposit_30_70'
  readonly allowed: boolean;
};

export type DetectedClaim = {
  readonly kind: ClaimKind;
  readonly claimKey: string;
  readonly matchedText: string;
};

export type ClaimViolation = {
  readonly kind: 'unsourced_claim';
  readonly claims: readonly DetectedClaim[];
  readonly reply: string;
};

type Pattern = { kind: ClaimKind; key: string; re: RegExp };

/**
 * Detection patterns. Canonical keys on the left are what claims_policy rows
 * use. Grown from guard-violation logs, like the injection corpus.
 */
const PATTERNS: readonly Pattern[] = [
  // certifications / compliance — high-risk, always default-deny
  { kind: 'certification', key: 'CE', re: /\bCE[- ](?:certified|marked|certification|approved)\b/i },
  { kind: 'certification', key: 'FDA', re: /\bFDA[- ](?:approved|certified|registered|compliant)\b/i },
  { kind: 'certification', key: 'RoHS', re: /\bRoHS(?:[- ](?:compliant|certified))?\b/i },
  { kind: 'certification', key: 'ISO9001', re: /\bISO[- ]?9001\b/i },
  { kind: 'certification', key: 'BSCI', re: /\bBSCI\b/i },
  { kind: 'certification', key: 'food_grade', re: /\bfood[- ](?:grade|safe)\b/i },
  { kind: 'certification', key: 'BPA_free', re: /\bBPA[- ]free\b/i },
  { kind: 'compliance', key: 'REACH', re: /\bREACH[- ](?:compliant|certified)\b/i },
  { kind: 'compliance', key: 'CPSIA', re: /\bCPSIA\b/i },

  // incoterms — a shipping-cost commitment in three letters
  { kind: 'incoterm', key: 'EXW', re: /\bEXW\b/i },
  { kind: 'incoterm', key: 'FOB', re: /\bFOB\b/i },
  { kind: 'incoterm', key: 'CIF', re: /\bCIF\b/i },
  { kind: 'incoterm', key: 'CFR', re: /\bCFR\b/i },
  { kind: 'incoterm', key: 'DDP', re: /\bDDP\b|\bdelivered duty paid\b/i },
  { kind: 'incoterm', key: 'DDU', re: /\bDDU\b/i },
  { kind: 'incoterm', key: 'DAP', re: /\bDAP\b/i },
  { kind: 'incoterm', key: 'FCA', re: /\bFCA\b/i },

  // payment terms
  { kind: 'payment_terms', key: 'letter_of_credit', re: /\bletter of credit\b|\bL\/C\b|\bLC at sight\b/i },
  { kind: 'payment_terms', key: 'net_terms', re: /\bnet[- ]?(?:15|30|45|60|90)\b/i },
  { kind: 'payment_terms', key: 'deposit_30_70', re: /\b30%\s*deposit\b|\b70%\s*(?:balance|before shipment)\b/i },
  { kind: 'payment_terms', key: 'open_account', re: /\bopen account\b/i },

  // guarantees / warranties / refunds
  { kind: 'guarantee', key: 'refund', re: /\b(?:full |money[- ]back )?refund\b/i },
  { kind: 'guarantee', key: 'warranty', re: /\bwarrant(?:y|ee)\b|\bguarante+d?\b/i },
  { kind: 'guarantee', key: 'free_replacement', re: /\bfree replacement\b/i },

  // shipping methods (capability claims)
  { kind: 'shipping_method', key: 'air_freight', re: /\bair (?:freight|shipping)\b/i },
  { kind: 'shipping_method', key: 'sea_freight', re: /\bsea (?:freight|shipping)\b|\b(?:LCL|FCL)\b/i },
  { kind: 'shipping_method', key: 'express', re: /\b(?:DHL|FedEx|UPS|express courier)\b/i },

  // delivery promises tied to events/dates (day-counts are the numeral guard's job)
  { kind: 'delivery_promise', key: 'event_deadline',
    re: /\b(?:before|by|in time for)\s+(?:ramadan|eid|christmas|chinese new year|cny|black friday|easter)\b/i },
  { kind: 'delivery_promise', key: 'guaranteed_delivery', re: /\bguaranteed delivery\b|\bdelivery (?:is )?guaranteed\b/i },
];

/**
 * G6 — the delivery terms this guard knows, from the SAME table it detects
 * with. The owner's proforma names exactly one of these, so the term on her
 * document and the term the guard recognises in a reply cannot drift apart.
 */
export const INCOTERM_KEYS: readonly string[] =
  PATTERNS.filter((p) => p.kind === 'incoterm').map((p) => p.key);

export function detectClaims(text: string): DetectedClaim[] {
  const out: DetectedClaim[] = [];
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) out.push({ kind: p.kind, claimKey: p.key, matchedText: m[0] });
  }
  return out;
}

/**
 * Default-deny: every detected claim must have an `allowed: true` policy row.
 * A missing row is a violation — silence in the policy is "no", never "yes".
 *
 * `clientText` matters here too, but differently than for numerals: a client
 * ASKING "can you do DDP?" does not license the reply to SAY yes — only a
 * policy row does. So unlike guardNumerals, nothing is allowlisted from the
 * client's message.
 */
export function guardClaims(input: {
  reply: string;
  policy: readonly AllowedClaim[];
}): Result<string, ClaimViolation> {
  const detected = detectClaims(input.reply);
  if (detected.length === 0) return ok(input.reply);

  const allowed = new Set(
    input.policy.filter((p) => p.allowed).map((p) => `${p.kind}:${p.claimKey}`),
  );
  const violations = detected.filter((d) => !allowed.has(`${d.kind}:${d.claimKey}`));

  return violations.length === 0
    ? ok(input.reply)
    : err({ kind: 'unsourced_claim', claims: violations, reply: input.reply });
}
