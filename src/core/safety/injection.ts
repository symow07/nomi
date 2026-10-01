import type { FixedLanguage } from '../conversation/gateLanguage.js';
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
  // Spanish and French (2026-09-29) — the same attempts in the customers' words.
  /\b(?:ignora|ignore|olvida|olvide|descarta)\s+(?:todas\s+)?(?:las\s+|tus\s+|sus\s+)?(?:instrucciones|reglas|indicaciones)(?:\s+(?:anteriores|previas))?\b/i,
  /\bahora\s+eres\s+(?:un|una|otro|otra)\b/i,
  /\b(?:finge|finja|haz\s+como\s+si)\s+(?:ser|que\s+eres|fueras)\b/i,
  /\b(?:revela|muestra|mu[eé]strame|dime)\s+(?:tus|sus)\s+(?:instrucciones|reglas|prompt)\b/i,
  /\b(?:ignore|ignorez|oublie|oubliez)\s+(?:toutes\s+)?(?:les\s+|tes\s+|vos\s+)?(?:instructions|r[èe]gles|consignes)(?:\s+(?:pr[ée]c[ée]dentes|ant[ée]rieures))?\b/i,
  /\b(?:tu\s+es|vous\s+[êe]tes)\s+(?:maintenant|d[ée]sormais)\s+(?:un|une)\b/i,
  /\b(?:fais|faites)\s+semblant\s+d['’][êe]tre\b/i,
  /\b(?:r[ée]v[èe]le|r[ée]v[ée]lez|montre|montrez)[-\s](?:moi\s+)?(?:tes|vos)\s+(?:instructions|r[èe]gles|consignes|prompt)\b/i,
  /prompt\s+(?:del\s+)?sistema|prompt\s+syst[èe]me/i,
  // Portuguese (the pt pack, 2026-10-01). "Você é um robô?" is a question
  // about what answers (the identity guard's), never an attempt: a new role
  // needs «agora» or «a partir de agora».
  /\b(?:ignore|ignora|ignorem|esque[çc]a|esquece|esque[çc]am)\s+(?:todas\s+)?(?:as\s+)?(?:suas\s+)?(?:instru[çc][õo]es|regras)(?:\s+(?:anteriores|acima))?\b/i,
  /\b(?:agora\s+voc[eê]\s+[eé]|a\s+partir\s+de\s+agora\s+voc[eê]\s+[eé])\s+(?:um|uma|outro|outra)\b/i,
  /\b(?:finja|finge|fa[çc]a\s+de\s+conta)\s+(?:ser|que\s+(?:[eé]|voc[eê]\s+[eé]))\b/i,
  /\b(?:revele|mostre|me\s+mostre|me\s+diga)\s+(?:as\s+)?(?:suas|tuas)\s+(?:instru[çc][õo]es|regras|prompt)\b/i,
  /prompt\s+do\s+sistema/i,
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

/**
 * Returned instead of an AI reply. Costs nothing and reveals nothing. LG — in
 * the customer's language where it is one of Nomi's three (`fixedLanguage`).
 */
export const SAFE_FALLBACK_REPLIES: Readonly<Record<FixedLanguage, string>> = {
  en: 'Thanks for your message — what are you looking for today?',
  zh: '谢谢你的消息——今天想找什么呢？',
  ar: 'شكرًا على الرسالة — ما المطلوب اليوم؟',
  es: 'Gracias por tu mensaje. ¿Qué estás buscando hoy?',
  fr: "Merci pour votre message. Que recherchez-vous aujourd'hui ?",
  pt: 'Agradecemos a mensagem. O que você procura hoje?',
};
