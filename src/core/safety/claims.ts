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

  // Spanish and French (2026-09-29): the same claims, under the same keys, so
  // what the owner allowed in English is allowed here and nothing else is.
  { kind: 'certification', key: 'CE', re: /\b(?:certificado|certificaci[oó]n|marcado|marca)\s+CE\b|\bCE\s+(?:certificado|homologu[ée]|certifi[ée])\b|\b(?:certifi[ée]|homologu[ée]|marquage)\s+CE\b/i },
  { kind: 'certification', key: 'FDA', re: /\b(?:aprobado|certificado|registrado)\s+por\s+la\s+FDA\b|\b(?:approuv[ée]|certifi[ée]|enregistr[ée])\s+(?:par\s+la\s+)?FDA\b/i },
  { kind: 'certification', key: 'food_grade', re: /\b(?:grado|apto\s+para\s+uso)\s+aliment(?:icio|ario)\b|\bapto\s+para\s+alimentos\b|\b(?:qualit[ée]|contact)\s+alimentaire\b/i },
  { kind: 'certification', key: 'BPA_free', re: /\b(?:sin|libre\s+de)\s+BPA\b|\bsans\s+BPA\b/i },
  { kind: 'guarantee', key: 'refund', re: /\breembolso\b|\bdevoluci[oó]n\s+del\s+dinero\b|\brembours(?:ement|[ée])\b/i },
  { kind: 'guarantee', key: 'warranty', re: /\bgarant[ií]as?\b|\bgarantizad[oa]s?\b|\bgarantie\b|\bgaranti(?:e|s|es)?\b/i },
  { kind: 'guarantee', key: 'free_replacement', re: /\b(?:reemplazo|cambio|reposici[oó]n)\s+(?:gratis|gratuit[oa])\b|\bremplacement\s+gratuit\b/i },
  { kind: 'shipping_method', key: 'air_freight', re: /\b(?:env[ií]o|flete|transporte)\s+a[ée]reo\b|\bfret\s+a[ée]rien\b|\benvoi\s+par\s+avion\b/i },
  { kind: 'shipping_method', key: 'sea_freight', re: /\b(?:env[ií]o|flete|transporte)\s+mar[ií]timo\b|\bfret\s+maritime\b/i },
  { kind: 'delivery_promise', key: 'event_deadline',
    re: /\b(?:antes\s+de|para)\s+(?:navidad|ramad[aá]n|el\s+a[ñn]o\s+nuevo\s+chino|black\s+friday|semana\s+santa)\b|\b(?:avant|pour)\s+(?:no[ëe]l|le\s+ramadan|le\s+nouvel\s+an\s+chinois|le\s+black\s+friday|p[âa]ques)\b/i },
  { kind: 'delivery_promise', key: 'guaranteed_delivery', re: /\bentrega\s+garantizada\b|\blivraison\s+garantie\b/i },

  // RT (2026-10-01) — what a shop promises: returns, free shipping, and the
  // refund, warranty and replacement words in Chinese and Arabic, under the
  // same keys, so what the owner allows on How you sell is allowed in every
  // language and nothing else is. A "free returns" promise was caught in no
  // language before this. Precision is held by tests/parity/rt-claims.test.ts
  // (each pattern both ways); a new phrasing goes there with its reason.
  { kind: 'guarantee', key: 'returns', re: /\b(?:free|easy|hassle[- ]free)\s+returns?\b|\breturns?\s+(?:are\s+|is\s+)?(?:accepted|free|welcome)\b|\b(?:return|exchange)\s+(?:it|them|any\s+item)?\s*(?:within|in)\s+\d+\s+days\b|\b\d+[- ]day\s+returns?\b|\byou\s+(?:can|may)\s+(?:return|exchange)\s+(?:it|them)\b/i },
  { kind: 'guarantee', key: 'returns', re: /包退|退货|无理由退|退换|可以退回/ },
  { kind: 'guarantee', key: 'returns', re: /إرجاع|استرجاع|الاسترجاع|ترجيع/ },
  { kind: 'guarantee', key: 'returns', re: /\bdevoluci[oó]n(?:es)?\b|\bpuedes?\s+devolverl[oa]s?\b|\bretours?\s+(?:gratuits?|offerts?)\b|\bretour\s+gratuit\b|\bvous\s+pouvez\s+(?:le\s+|la\s+|les\s+)?retourner\b/i },
  { kind: 'guarantee', key: 'refund', re: /退款|退钱|全额退/ },
  { kind: 'guarantee', key: 'refund', re: /استرداد\s+(?:المبلغ|الأموال|المال|النقود)|(?:إعادة|رد)\s+المبلغ/ },
  { kind: 'guarantee', key: 'warranty', re: /保修|质保|包换/ },
  // Whole words, with و/ب and the article: «بضمان سنة» is a warranty, «لضمان» ("to make sure") is not.
  { kind: 'guarantee', key: 'warranty', re: /(?<![\u0621-\u064a])(?:[وب]?(?:ال)?ضمان|مضمون[ةه]?|(?:ال)?كفالة)(?![\u0621-\u064a])/ },
  { kind: 'guarantee', key: 'free_replacement', re: /免费换|免费更换/ },
  { kind: 'guarantee', key: 'free_replacement', re: /استبدال\s+مجاني|الاستبدال\s+مجان/ },
  { kind: 'shipping_method', key: 'free_shipping', re: /\bfree\s+(?:shipping|delivery)\b|\benv[ií]o\s+(?:gratis|gratuito)\b|\blivraison\s+(?:gratuite|offerte)\b/i },
  { kind: 'shipping_method', key: 'free_shipping', re: /包邮|免运费|免费配送|免费送货/ },
  { kind: 'shipping_method', key: 'free_shipping', re: /(?:الشحن|شحن|التوصيل|توصيل)\s+مجان/ },
  { kind: 'shipping_method', key: 'express', re: /顺丰|特快|加急快递|شحن\s+سريع|توصيل\s+سريع/ },
];

/**
 * RT — the promises a shop makes that the owner may allow on How you sell:
 * one switch each, in every language the patterns above read.
 */
export const SHOP_PROMISES: readonly { readonly kind: ClaimKind; readonly key: string }[] = [
  { kind: 'guarantee', key: 'refund' },
  { kind: 'guarantee', key: 'returns' },
  { kind: 'guarantee', key: 'warranty' },
  { kind: 'guarantee', key: 'free_replacement' },
  { kind: 'shipping_method', key: 'free_shipping' },
  { kind: 'shipping_method', key: 'express' },
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
