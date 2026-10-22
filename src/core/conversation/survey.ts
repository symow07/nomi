/**
 * S6 (Phase 5, item 20; 0202) — HOW DID WE DO? One question, after an order the owner confirmed. Pure.
 *
 * It is a sentence the buyer reads, sent without anyone pressing send, so it is held exactly as the disclosure is:
 * written here, and sent in a language only once a reader of that language has signed THAT sentence (`SIGNED`, by
 * name and date, in the same commit). Change one letter and the language stops being asked until it is signed again.
 * Nobody has signed one yet: until the owner (English) and native readers (the rest) do, no buyer is asked anything,
 * whatever the switch says.
 *
 * Asked only where it is free (the owner, 2026-10-21): on a chat channel inside the buyer's own 24 hours — free-form
 * there costs nothing, and outside it only a paid template could reach them, which a survey never is. E-mail is free
 * too, but a letter needs a subject the reader signs as well; it waits for that sentence.
 */
export const SURVEY_LOCALES = ['en', 'zh', 'ar', 'es', 'fr'] as const;
export type SurveyLocale = (typeof SURVEY_LOCALES)[number];

const TEXT: Readonly<Record<SurveyLocale, string>> = {
  en: 'Thank you for your order with {business}. How did we do? Reply with a number from 1 (poor) to 5 (excellent).',
  zh: '感谢您在{business}下单。您对这次的服务满意吗？请回复 1（很差）到 5（很好）之间的数字。',
  // No gender for the buyer (rule 6): a noun phrase and «يكفي», never an imperative.
  ar: 'شكرًا على الطلب من {business}. ما تقييم التجربة معنا؟ يكفي الرد برقم من 1 (ضعيف) إلى 5 (ممتاز).',
  es: 'Gracias por tu pedido a {business}. ¿Qué tal lo hicimos? Responde con un número del 1 (mal) al 5 (excelente).',
  fr: 'Merci pour votre commande chez {business}. Votre avis nous intéresse : répondez par un chiffre de 1 (mauvais) à 5 (excellent).',
};

/**
 * The sentences a reader signed, by language: the exact text and who signed it. Written here only in the commit that
 * names the reader; never by an assistant.
 */
const SIGNED: Readonly<Partial<Record<SurveyLocale, { readonly text: string; readonly by: string }>>> = {};

/** Which languages may be asked, and in which words: the signed sentence that is still the one written above. */
export type SurveySigned = Readonly<Partial<Record<SurveyLocale, string>>>;
export const SURVEY_SIGNED: SurveySigned = Object.freeze(Object.fromEntries(
  SURVEY_LOCALES.flatMap((l) => (SIGNED[l]?.text === TEXT[l] ? [[l, TEXT[l]]] : []))) as SurveySigned);

/** The sentence as written, for a reader to sign (and for the tests). */
export const surveyText = (l: SurveyLocale): string => TEXT[l];

/** The question in the buyer's language, or null: no language known, none of the five, or not signed. */
export function surveyFor(language: string | null | undefined, business: string, signed: SurveySigned = SURVEY_SIGNED):
  { readonly locale: SurveyLocale; readonly text: string } | null {
  const head = (language ?? '').slice(0, 2).toLowerCase();
  const locale = SURVEY_LOCALES.find((l) => l === head);
  const name = business.replace(/\s+/g, ' ').trim();
  if (!locale || !name) return null;
  const text = signed[locale];
  return text ? { locale, text: text.split('{business}').join(name) } : null;
}

/** The channels a survey may be asked on: chat, where inside the buyer's 24 hours a message costs nothing. */
export const SURVEY_CHANNELS: ReadonlySet<string> = new Set(['whatsapp', 'instagram', 'messenger']);
/** Asked with an hour of the window to spare, so the answer has room and the send never meets a shut window. */
export const SURVEY_MARGIN_MS = 3_600_000;
const WINDOW_MS = 24 * 3_600_000;

/** Free to ask now? A chat channel, and the buyer wrote within their 24 hours, with the margin to spare. */
export function freeToAsk(channel: string, lastInboundAt: Date | null, now: Date): boolean {
  if (!SURVEY_CHANNELS.has(channel) || lastInboundAt === null) return false;
  return now.getTime() - lastInboundAt.getTime() <= WINDOW_MS - SURVEY_MARGIN_MS;
}

/** How long after the order the question waits, so the confirmation goes first. */
export const SURVEY_DELAY_MS = 10 * 60_000;
/** How long an answer is taken as one: the buyer's 24 hours after the question. */
export const SURVEY_ANSWER_MS = WINDOW_MS;

const DIGITS: Readonly<Record<string, number>> = {
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
  '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5,
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
};
/** What may follow the number and still be only the number: "/5", "分", "stars", "étoiles", «نجوم»… */
const AFTER = /^(?:\/\s*5|分|星|颗星|stars?|étoiles?|estrellas?|نجوم|نجمة|نجمات)?[\s.!。！]*$/u;

/**
 * Is this message ONLY a score from 1 to 5? A number alone (Western, Arabic-Indic, Persian, full-width, Chinese),
 * with at most "/5", "分" or the word for stars after it, or one to five stars and nothing else. Anything more is a
 * message, and goes to the assistant as any other: "5 more pieces please" is an order, not a score.
 */
export function surveyScore(text: string): 1 | 2 | 3 | 4 | 5 | null {
  const t = text.normalize('NFKC').trim().toLowerCase();
  if (!t) return null;
  const stars = /^(?:⭐|★|🌟)+$/u.exec(t.replace(/\s+/g, '').replace(/️/g, ''));
  if (stars) {
    const n = [...stars[0]].length;
    return n >= 1 && n <= 5 ? (n as 1 | 2 | 3 | 4 | 5) : null;
  }
  const first = [...t][0]!;
  const n = DIGITS[first];
  if (n === undefined) return null;
  const rest = t.slice(first.length).trim();
  // "50", "1.5", "5000": a second figure is not a score.
  if (/^[.,]?\p{N}/u.test(rest)) return null;
  return AFTER.test(rest) ? (n as 1 | 2 | 3 | 4 | 5) : null;
}
