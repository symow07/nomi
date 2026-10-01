import { SCRIPTS, STOPWORDS } from './understand.js';

/**
 * LG (decision 16) — WHICH LANGUAGE THE GATE READS, decided by fixed rules.
 *
 * Whether a reply may go out alone depends on the customer's language: only a
 * language whose disclosure a native reader signed off may (`autonomyReleasedFor`).
 * Until LG that language was the analysis's word for it — a model's guess,
 * read as English whenever it said nothing. Here it is decided from the text:
 *
 *   · A script decides by itself: a third of the letters in Arabic, Chinese,
 *     Cyrillic… script is that language. Kana anywhere is Japanese (its kanji
 *     would otherwise read as Chinese); Arabic script with the letters only
 *     Urdu or Persian use, or Persian's own small words, is Urdu or Persian.
 *   · Latin script does not: English, Arabizi, Hinglish, Taglish, romanised
 *     Malay and pinyin are all written in it. Latin text is a language only
 *     when the analysis says so AND its small words agree; a romanised marker
 *     (below) makes it undetermined whatever else it holds.
 *   · A message with no evidence at all ("ok", "200 pcs?", a thumbs-up) is
 *     read by the customer's earlier messages, newest first; none at all is
 *     undetermined.
 *
 * Undetermined is `und` (BCP 47), and it always drafts: there is no sentence
 * that says who is answering in a language nobody can name.
 */

/** BCP 47's "undetermined". Every reply to it waits for the owner. */
export const UNDETERMINED = 'und';

/**
 * The languages Nomi's fixed sentences are written in (LG's packs; es, fr and
 * pt with their packs, 2026-10-01). Written is not released: a reply goes
 * alone only where the language's disclosure was signed off.
 */
export const FIXED_LANGUAGES = ['en', 'zh', 'ar', 'es', 'fr', 'pt'] as const;
export type FixedLanguage = (typeof FIXED_LANGUAGES)[number];

/** A fixed sentence's language for a customer: theirs where one is written, else English (and that reply drafts). */
export const fixedLanguage = (language: string | null | undefined): FixedLanguage => {
  const head = (language ?? '').slice(0, 2).toLowerCase();
  return (FIXED_LANGUAGES as readonly string[]).includes(head) ? head as FixedLanguage : 'en';
};

const KANA = /[\u3040-\u30ff]/u;
const HAN = /[\u4e00-\u9fff]/gu;
/** understand.ts's scripts other than Han, tested one word at a time. */
const OTHER_SCRIPTS: readonly (readonly [RegExp, string])[] = SCRIPTS
  .filter(([, lang]) => lang !== 'zh')
  .map(([re, lang]) => [new RegExp(re.source, 'u'), lang] as const);
/** Letters Urdu writes and Arabic does not: ٹ ڈ ڑ ں ہ ے ۓ. */
const URDU_LETTERS = /[\u0679\u0688\u0691\u06ba\u06c1\u06d2\u06d3]/u;
/** Letters Persian writes and Arabic does not: پ ژ. (چ and گ are not here: Gulf and Iraqi Arabic write them.) */
const PERSIAN_LETTERS = /[\u067e\u0698]/u;
/** Persian's own small words, in Persian spelling (ی, ک); Arabic's ي and ك are read as those first. */
const PERSIAN_WORDS = new Set(['است', 'برای', 'شما', 'دارید', 'هست', 'هستید', 'خیلی', 'ممنون', 'چقدر', 'میخوام', 'میخواهم', 'چطور']);

/**
 * ROMANISED LANGUAGES WRITTEN IN LATIN LETTERS. Each word is one no English
 * sentence uses, so one is enough to say "not English"; a word English shares
 * ("fee", "ana", "po" — a purchase order —, "hai", "yuan") is left out on
 * purpose. tests/parity/lg-language.test.ts holds a corpus, each line with its
 * reason; a new word goes there first.
 */
export const ROMANISED: Readonly<Record<'arabizi' | 'hinglish' | 'taglish' | 'malay' | 'pinyin', readonly string[]>> = {
  arabizi: ['shu', 'shou', 'shoo', 'kif', 'kifak', 'kifik', 'shlonak', 'shlonik', 'shlon', 'abi', 'abgha', 'bkam', 'bikam', 'kam',
    'mafi', 'mesh', 'msh', 'enta', 'enti', 'inta', 'inti', 'tayeb', 'tamam', 'kteer', 'ktir', 'izzay', 'ezay', 'khalas', 'wayed', 'ahlain'],
  hinglish: ['kya', 'kitna', 'kitne', 'kitni', 'chahiye', 'chahie', 'nahi', 'nahin', 'aap', 'mujhe', 'mera', 'meri', 'bhai', 'bhaiya',
    'kaise', 'kahan', 'hoga', 'karo', 'dijiye', 'bataiye', 'batao', 'theek', 'thik', 'accha', 'acha', 'haan', 'hain', 'rupaye', 'wala', 'wali'],
  taglish: ['magkano', 'naman', 'yung', 'mga', 'salamat', 'pwede', 'opo', 'meron', 'wala', 'ilan', 'gusto', 'paano', 'kayo', 'ninyo'],
  // Not Indonesian's small words (berapa, harga, saya…): those name it by the list below, where the analysis agrees.
  malay: ['boleh', 'nak', 'awak', 'mau', 'sudah', 'belum', 'hantar', 'tolong'],
  pinyin: ['duoshao', 'nihao', 'xiexie', 'zenme', 'shenme', 'meiyou', 'keyi', 'jiage', 'haode', 'qian', 'kuai'],
};
const ROMANISED_WORDS = new Set(Object.values(ROMANISED).flat());

/**
 * ARABIZI'S DIGITS: Arabic sounds Latin has no letter for, written as figures
 * inside a word — 3 (ع), 7 (ح), 2 (ء), 5 (خ), 6 (ط), 9 (ق/ص), 8 (غ). "a7la",
 * "ma3a", "3ndkom", "7abibi". Not a size or a count ("3pcs", "2nd", "b2b").
 */
const NOT_ARABIZI = new Set(['b2b', 'b2c', 'c2c', 'p2p', 'h2o', 'y2k', 'e2e']);
const COUNT_SUFFIX = /^(pcs?|pieces?|units?|items?|sets?|packs?|pairs?|boxes|cartons?|rd|th|nd|st|kg|g|ml|l|cm|mm|m|ft|oz|lbs?|gb|mb|tb|xl|xxl|xxxl|hrs?|days?|weeks?|months?|colou?rs?|sizes?)$/;
function arabiziDigits(token: string): boolean {
  if (NOT_ARABIZI.has(token)) return false;
  const inside = /\p{L}[2356789]\p{L}/u.test(token);
  const leading = /^[37]\p{L}{2,}$/u.exec(token);
  if (leading && COUNT_SUFFIX.test(token.slice(1))) return false;
  return inside || leading !== null;
}

/**
 * THE WORD LIST THE ANALYSIS MUST AGREE WITH: the shared small words
 * (understand.ts) and, for the languages a customer here most writes in, the
 * common words of a sales chat. Words the Romance languages share ("de",
 * "la", "en", "tu") may sit in several lists: they tie those languages, and
 * the analysis picks among the tied. A word English shares with one of them is
 * left out of English ("real", "service", "message", "team", "was", "will",
 * "plus", "non"): an English reading must be English's alone.
 */
const MORE: Readonly<Record<string, readonly string[]>> = {
  en: ['i', 'my', 'it', 'this', 'that', 'have', 'has', 'with', 'want', 'much', 'many', 'are', 'to', 'of', 'yes', 'thanks', 'thank',
    'send', 'order', 'there', 'any', 'would', 'like', 'available', 'cost', 'colour', 'color', 'size', 'anyone', 'someone', 'somebody',
    'everyone', 'nobody', 'talk', 'speak', 'person', 'human', 'call', 'back', 'help', 'from', 'about', 'could', 'be', 'not', 'get',
    'give', 'know', 'just', 'when', 'where', 'which', 'who', 'why', 'them', 'they', 'our', 'us', 'here', 'now', 'today', 'tomorrow',
    'good', 'great', 'sure', 'ship', 'shipping', 'delivery', 'deliver', 'payment', 'pay', 'discount', 'sample', 'samples', 'quote',
    'buy', 'looking', 'interested', 'quantity', 'best', 'live', 'customer', 'owner', 'boss', 'connect', 'put', 'through', 'rather',
    'instead', 'were', 'been', 'did', 'does', 'if', 'all', 'some', 'more', 'less', 'very', 'too', 'only', 'again', 'first', 'last',
    'next', 'same', 'other', 'one', 'two', 'three', 'time', 'day', 'week', 'month', 'year', 'number', 'address', 'phone', 'reply',
    'answer', 'sorry', 'thing', 'still', 'should', 'these', 'those', 'its', 'whats', 'hey', 'morning', 'afternoon',
    'evening', 'cheaper', 'cheap', 'expensive', 'wholesale', 'retail', 'free', 'fast', 'soon', 'long', 'take', 'make', 'made'],
  es: ['hay', 'alguien', 'quiero', 'quisiera', 'hablar', 'persona', 'favor', 'buenos', 'buenas', 'días', 'tardes', 'noches', 'tiene',
    'tienen', 'tienes', 'cuesta', 'cuál', 'cual', 'dónde', 'donde', 'muestra', 'descuento', 'sí', 'también', 'pero', 'muy', 'más',
    'esto', 'este', 'eso', 'está', 'están', 'atendiendo', 'algún', 'alguna', 'nadie', 'ustedes', 'usted', 'puedo', 'puede', 'pueden',
    'llamar', 'llámame', 'correo', 'envían', 'enviar', 'hacen', 'tengo', 'quiere', 'cuantos', 'cuántos', 'cuantas', 'cuántas',
    'queremos', 'ser', 'somos', 'nuestro', 'nuestra', 'nuestros', 'nuestras', 'mañana', 'me', 'mi', 'te', 'nos', 'su', 'sus', 'tu',
    'estás', 'estoy', 'ahí', 'aquí', 'venden', 'vende', 'del', 'al', 'un', 'en', 'la', 'lo', 'le'],
  fr: ['quelqu', 'parler', 'avec', 'voudrais', 'veux', 'pouvez', 'peux', 'ce', 'cette', 'ces', 'sont', 'avez', 'avons', 'bonsoir',
    'salut', 'livraison', 'commande', 'échantillon', 'remise', 'où', 'aussi', 'très', 'rien', 'quoi', 'oui', 'appeler',
    'rappeler', 'numéro', 'courriel', 'des', 'du', 'au', 'aux', 'sur', 'dans', 'chez', 'encore', 'déjà', 'beaucoup', 'votre', 'vos',
    'notre', 'nos', 'mon', 'ma', 'mes', 'elle', 'ils', 'avoir', 'être', 'faire', 'disponibles', 'coûte', 'quel', 'quelle',
    'moi', 'toi', 'appelez', 'appelle', 'allô', 'allo', 'là', 'il', 'un', 'en', 'ligne', 'qui', 'mais', 'tu', 'te', 'me', 'se',
    // Elided articles and pronouns: l'article, d'accord, j'ai, qu'il, c'est, n'est, s'il.
    'l', 'd', 'j', 'qu', 'c', 'n', 's', 'supprimez', 'supprimer', 'article', 'articles', 'svp'],
  pt: ['tem', 'têm', 'alguém', 'quero', 'gostaria', 'falar', 'pessoa', 'atendente', 'vocês', 'obrigada', 'oi', 'bom', 'boa', 'dia',
    'noite', 'custa', 'qual', 'onde', 'amostra', 'desconto', 'sim', 'também', 'mas', 'muito', 'isso', 'nao', 'pode', 'posso',
    'podem', 'ligar', 'meu', 'minha', 'seu', 'sua', 'vocé', 'entrega', 'frete', 'tudo', 'bem', 'mais', 'um', 'em', 'no', 'na', 'do', 'da'],
};
const WORDS: Readonly<Record<string, ReadonlySet<string>>> = Object.fromEntries(
  Object.entries(STOPWORDS).map(([lang, list]) => [lang, new Set([...list, ...(MORE[lang] ?? [])])]));

function arabicScript(text: string): string {
  if (URDU_LETTERS.test(text)) return 'ur';
  if (PERSIAN_LETTERS.test(text)) return 'fa';
  const words = text.replace(/\u064a/gu, '\u06cc').replace(/\u0643/gu, '\u06a9').match(/[\u0600-\u06ff]+/gu) ?? [];
  return words.some((w) => PERSIAN_WORDS.has(w)) ? 'fa' : 'ar';
}

/**
 * What ONE message says about its language: a language, `und`, or null when
 * it says nothing (no letters, or Latin letters with no word of any list).
 * `analysed` is the analysis's reading of the customer (two letters or null).
 * `pattern` is the language of a first-line pattern that caught this message
 * before any model read it (a request for a person): for Latin text, it
 * decides where the analysis does not contradict it.
 */
export function languageEvidence(text: string, analysed: string | null | undefined, pattern: string | null = null): string | null {
  const t = (text ?? '').normalize('NFKC');
  // Counted in words: each Han character is one, every other run of letters
  // is one. Counted in letters, "删除logo" read as Latin (2 of 6).
  const han = t.match(HAN)?.length ?? 0;
  const rest = t.replace(HAN, ' ').match(/[\p{L}\p{M}]+/gu) ?? [];
  const units = han + rest.length;
  if (units === 0) return null;
  if (KANA.test(t)) return 'ja';
  if (han / units >= 0.34) return 'zh';
  for (const [re, lang] of OTHER_SCRIPTS) {
    if (rest.filter((w) => re.test(w)).length / units >= 0.34) return lang === 'ar' ? arabicScript(t) : lang;
  }
  const lower = t.toLowerCase();
  const tokens = lower.match(/[\p{L}\d]+/gu) ?? [];
  if (tokens.some((w) => ROMANISED_WORDS.has(w) || arabiziDigits(w))) return UNDETERMINED;
  const head = (analysed ?? '').slice(0, 2).toLowerCase();
  if (pattern) return !head || head === pattern ? pattern : UNDETERMINED;
  const words = lower.match(/\p{L}+/gu) ?? [];
  const top = Math.max(0, ...Object.values(WORDS).map((list) => words.filter((w) => list.has(w)).length));
  if (top === 0) return null;
  // The analysis's language must be among the list's best — a word two
  // languages share ("de", "la") ties them, and the analysis may pick between
  // them; one the list ranks lower, or a tie the analysis is not in, is
  // nobody's to say.
  const mine = head ? words.filter((w) => WORDS[head]?.has(w)).length : 0;
  if (head && mine === top) return head;
  return UNDETERMINED;
}

/**
 * The gate's language for a turn: the first message, newest first, that says
 * anything — this turn's text, then the customer's earlier ones. Never null.
 */
export function gateLanguage(texts: readonly string[], analysed: string | null | undefined): string {
  // Earlier messages were read by their own turns; no pattern speaks for them here.
  for (const text of texts) {
    const e = languageEvidence(text, analysed);
    if (e !== null) return e;
  }
  return UNDETERMINED;
}
