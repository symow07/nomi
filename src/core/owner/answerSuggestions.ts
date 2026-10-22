import { asksForDeletion, promisesDeletion } from '../safety/deletion.js';
import { asksForPerson } from '../scoring/detect.js';

/**
 * S5 (Phase 5, item 17) — ANSWERS PEOPLE GAVE, as suggestions for the owner. Pure.
 *
 * Only a person's own words are ever suggested: a reply they typed in a conversation they held, or a draft they
 * rewrote before it went. The assistant's words — sent alone, or approved as written — never are. The same question
 * asked by several buyers is ONE suggestion, found by word matching: the same words, whatever their order, capitals,
 * accents, punctuation or a plural "s"; Chinese, written without spaces, by its pairs of characters. A question of
 * fewer than two words that matter is no question to keep, and neither is one asking for a person or for a buyer's
 * data to go, nor an answer that promises the data is gone (those are a person's, every time).
 *
 * Nothing here becomes an answer: the owner decides, on the knowledge page.
 */
export type HumanAnswer = { readonly question: string; readonly answer: string; readonly at: Date };
export type AnswerSuggestion = {
  /** The question's words, folded and sorted: what makes two questions the same. */
  readonly key: string;
  /** The newest wording a buyer used, and the newest answer a person gave to it. */
  readonly question: string; readonly answer: string;
  readonly asks: number; readonly lastAt: Date;
};

export const QUESTION_MAX = 280;
export const ANSWER_MAX = 2000;

/** Small words that never tell one question from another, in the languages the owners and their buyers write. */
const STOP = new Set([
  // en
  'a', 'an', 'the', 'is', 'are', 'am', 'was', 'be', 'do', 'does', 'did', 'can', 'could', 'would', 'will', 'shall',
  'you', 'your', 'yours', 'we', 'our', 'us', 'i', 'me', 'my', 'it', 'its', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'and', 'or', 'please', 'pls', 'hi', 'hello', 'hey', 'dear', 'thanks', 'thank', 'there', 'this', 'that', 'these',
  'those', 'have', 'has', 'any', 'some', 'so', 'just', 'ok', 'okay',
  // fr
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'est', 'vous', 'votre', 'vos', 'nous', 'je', 'j',
  'il', 'ce', 'ca', 'pour', 'avec', 'en', 'au', 'aux', 'sur', 'bonjour', 'merci', 'svp', 'l', 'd', 'qu', 'que',
  // es
  'el', 'los', 'las', 'unos', 'unas', 'del', 'y', 'o', 'es', 'son', 'usted', 'ustedes', 'su', 'sus', 'para', 'con',
  'por', 'hola', 'gracias', 'favor', 'lo', 'al',
  // ar (after the folding below)
  'في', 'من', 'علي', 'عن', 'هل', 'ما', 'ماذا', 'مع', 'الي', 'انا', 'نحن', 'انت', 'لكم', 'لديكم', 'عندكم', 'و', 'يا',
  'مرحبا', 'شكرا', 'السلام', 'عليكم', 'لو', 'سمحت', 'فضلك', 'هذا', 'هذه',
]);
/** Chinese characters that carry no question of their own: particles, "please", "you", "we". */
const ZH_STOP = /[的了吗呢吧啊呀嘛么请问您你我们是]/gu;
const CJK_RUN = /[぀-ヿ㐀-䶿一-鿿가-힯]+/gu;

function foldArabic(s: string): string {
  return s.replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}

/** The words of a question that tell it from another. */
export function questionWords(text: string): readonly string[] {
  const folded = foldArabic(text.normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFKC').toLowerCase());
  const words: string[] = [];
  // Chinese, Japanese, Korean: no spaces, so pairs of characters stand for words.
  for (const run of folded.match(CJK_RUN) ?? []) {
    const chars = [...run.replace(ZH_STOP, '')];
    if (chars.length === 1) words.push(chars[0]!);
    for (let i = 0; i + 1 < chars.length; i++) words.push(chars[i]! + chars[i + 1]!);
  }
  for (let w of folded.replace(CJK_RUN, ' ').split(/[^\p{L}\p{N}]+/u)) {
    if (!w || STOP.has(w)) continue;
    // Arabic's article, and a Latin plural: "the samples" and "sample" are the same word here.
    if (/^ال\p{L}{3,}$/u.test(w)) w = w.slice(2);
    else if (/^\p{Script=Latin}{4,}s$/u.test(w) && !w.endsWith('ss')) w = w.slice(0, -1);
    if (!STOP.has(w)) words.push(w);
  }
  return words;
}

/** What makes two questions the same; null when there is too little to tell. */
export function questionKey(text: string): string | null {
  const words = [...new Set(questionWords(text))].sort();
  return words.length >= 2 ? words.join(' ') : null;
}

/** Is this a pair worth suggesting at all? */
function keepable(p: HumanAnswer): boolean {
  const q = p.question.trim(), a = p.answer.trim();
  if (!q || !a || q.length > QUESTION_MAX || a.length > ANSWER_MAX) return false;
  return !asksForPerson(q) && asksForDeletion(q) === null && promisesDeletion(a) === null;
}

/** The answers people gave, one per question, the most asked first (then the newest). */
export function suggestionsFrom(pairs: readonly HumanAnswer[]): readonly AnswerSuggestion[] {
  const groups = new Map<string, { question: string; answer: string; asks: number; lastAt: Date }>();
  for (const p of pairs) {
    if (!keepable(p)) continue;
    const key = questionKey(p.question);
    if (key === null) continue;
    const g = groups.get(key);
    if (!g) { groups.set(key, { question: p.question.trim(), answer: p.answer.trim(), asks: 1, lastAt: p.at }); continue; }
    g.asks += 1;
    if (p.at.getTime() > g.lastAt.getTime()) { g.question = p.question.trim(); g.answer = p.answer.trim(); g.lastAt = p.at; }
  }
  return [...groups.entries()].map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => b.asks - a.asks || b.lastAt.getTime() - a.lastAt.getTime() || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
