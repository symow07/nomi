import { type Result, ok, err } from '../types/result.js';

/**
 * M37.5 — the words she may never say.
 *
 * `claims_policy` governs what may be CLAIMED. This governs what may be SAID.
 * Same shape, same default-deny instinct, a different axis — and the same
 * reason: a sentence that reaches a buyer cannot be taken back.
 *
 * ── THIS IS NOT `BANNED_OWNER_TERMS`, AND THE TWO WILL BE CONFLATED ────────
 *
 * `core/owner/vocabulary.ts` → BANNED_OWNER_TERMS governs what the PRODUCT
 * shows the OWNER: no "model", no "confidence", no "系统". It is about OUR
 * register when we speak to HER, it is one global list, and it is enforced by
 * tests over the i18n catalogue.
 *
 * THIS list governs what SHE says to a BUYER. It is per-tenant, free text in
 * whatever language the owner types, and enforced at reply time against a live
 * table. Two lists, two audiences, two enforcement points. They share no
 * contents and must never share an implementation: merging them would either
 * leak software vocabulary into buyer messages or let a tenant switch off the
 * product's own register.
 *
 * ── THE FLOOR ─────────────────────────────────────────────────────────────
 *
 * A short list she can EXTEND but never REMOVE: never curse, never insult a
 * buyer. Enforced, not advisory. A tenant that could switch off "do not abuse
 * the customer" is a tenant that will, by accident, on the day someone pastes a
 * competitor's phrasing into the catalogue and it comes back out of a reply.
 *
 * Pure per ADR-0002: matching only. Loading the tenant's own terms is the
 * caller's job.
 */

/**
 * The floor, in the three languages the product speaks plus the ones a Yiwu
 * buyer writes in. Deliberately SHORT: this is a floor, not a moderation
 * service. Anything subtler is the owner's judgement to add.
 *
 * Kept as data, by language, so the runtime check, the page that lists it and
 * any test read the same list.
 *
 * 2026-10-03 (V1-504) — matching respects word edges now, so a word no longer
 * catches its own longer forms the way a substring did ("fucking" from
 * "fuck", "idiota" from "idiot"). Each form the floor must still catch is
 * listed, as a word of its own. Chinese: 滚 catches 滚 standing alone, and the
 * insults built on it are listed too (滚出去, 滚开, 滚蛋). Arabic: the words a
 * prefix or an ending cannot make are listed (أغبياء, حمقاء, حمقى); the ones they
 * can (الغبي, كذابين) are caught by the Arabic edge rule below.
 */
export const FLOOR_BY_LANGUAGE: readonly { readonly language: string; readonly words: readonly string[] }[] = [
  { language: 'en', words: ['fuck', 'fucks', 'fucked', 'fucking', 'fucker', 'fuckers', 'motherfucker', 'motherfuckers',
    'shit', 'shits', 'shitty', 'bullshit', 'bastard', 'bastards', 'idiot', 'idiots', 'idiotic',
    'stupid', 'moron', 'morons', 'moronic', 'liar', 'liars'] },
  { language: 'zh', words: ['傻逼', '白痴', '蠢货', '滚', '滚出去', '滚开', '滚蛋', '骗子'] },
  { language: 'ar', words: ['غبي', 'أغبياء', 'كذاب', 'أحمق', 'حمقاء', 'حمقى'] },
  // Español (2026-09-29)
  { language: 'es', words: ['mierda', 'estúpido', 'estúpida', 'estúpidos', 'estúpidas', 'imbécil', 'imbéciles', 'idiota', 'idiotas',
    'mentiroso', 'mentirosa', 'mentirosos', 'mentirosas', 'cabrón', 'cabrona', 'cabrones', 'gilipollas',
    'pendejo', 'pendeja', 'pendejos', 'pendejas'] },
  // Français ('idiot' and 'idiots' are English's too, above)
  { language: 'fr', words: ['merde', 'putain', 'connard', 'connards', 'connasse', 'connasses', 'menteur', 'menteurs', 'menteuse', 'menteuses',
    'crétin', 'crétins', 'crétine', 'crétines', 'salaud', 'salauds', 'idiote', 'idiotes', 'imbécile'] },
  // Português (the pt pack, 2026-10-01; 'idiota' and the 'mentiros-' forms are Spanish's too, above)
  { language: 'pt', words: ['merda', 'porra', 'caralho', 'babaca', 'babacas', 'otário', 'otária', 'otários', 'otárias', 'imbecil', 'imbecis',
    'cretino', 'cretina', 'cretinos', 'cretinas', 'vagabundo', 'vagabunda', 'vagabundos', 'vagabundas'] },
];
/** The floor as one list, in the order above: what the guard reads. */
export const FORBIDDEN_FLOOR: readonly string[] = FLOOR_BY_LANGUAGE.flatMap((g) => g.words);

/**
 * Chinese has no spaces, and the platform's word dictionary (ICU) both keeps
 * some innocent compounds whole and splits others: it splits 滚轮 (a wheel)
 * into 滚|轮, so 滚 would stand as a word of its own there. The words a floor
 * term sits inside innocently, where the dictionary does not already keep
 * them whole, are named here; an occurrence inside one of them is not the term.
 */
export const INNOCENT_COMPOUNDS: Readonly<Record<string, readonly string[]>> = {
  '滚': ['滚轮', '滚筒', '滚珠', '滚动', '滚轴', '滚子', '滚刀', '滚针', '滚花', '滚边', '滚压', '滚烫', '滚圆',
    '滚梯', '滚装', '滚落', '滚滚', '翻滚', '打滚', '滚雪球', '滚瓜烂熟'],
};

export type ForbiddenTerm = {
  /** The term itself, as the owner typed it. */
  readonly term: string;
  /** Whether it came from the immutable floor or from her own list. */
  readonly source: 'floor' | 'owner';
};

export type ForbiddenViolation = {
  readonly kind: 'forbidden_word';
  /** Every term that matched, so the owner is told WHICH word stopped it. */
  readonly terms: readonly ForbiddenTerm[];
};

/**
 * The tenant's effective list: her terms, plus the floor she cannot remove.
 *
 * The floor is appended AFTER hers and de-duplicated, so an owner who types a
 * floor word into her own list changes nothing rather than shadowing it — there
 * is no ordering by which her row can win.
 */
export function effectiveForbidden(ownerTerms: readonly string[]): readonly ForbiddenTerm[] {
  const seen = new Set<string>();
  const out: ForbiddenTerm[] = [];
  for (const t of ownerTerms) {
    const norm = t.trim().toLowerCase();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push({ term: t.trim(), source: 'owner' });
  }
  for (const t of FORBIDDEN_FLOOR) {
    const norm = t.toLowerCase();
    if (seen.has(norm)) continue;   // she typed it too; it is still the floor's
    seen.add(norm);
    out.push({ term: t, source: 'floor' });
  }
  return out;
}

/**
 * Does this reply contain a forbidden term — AS A WORD?
 *
 * 2026-10-03 (V1-504, the owner's decision) — a term is caught where it stands
 * as a word, never inside a longer one: "liar" no longer stops "familiar", nor
 * 滚 "滚筒". It used to be case-insensitive substring matching, because a word
 * edge means something different in each script. It now means, by script:
 *
 *   · A spaced script (Latin, Cyrillic, Greek, Hebrew, Arabic…): the letter
 *     before the term and the letter after it are not letters of the same
 *     script. Punctuation, a space, an apostrophe ("l'idiot"), a digit's edge,
 *     a letter of another script ("你是idiot") all end a word.
 *   · Arabic, also: the prefixes and endings written onto a word — و ف ب ك ل,
 *     ال and their joins, يا; ة ه ها ي ين ون ان ات and the pronouns — do not make
 *     it a longer word ("الغبي", "كذابين" are the term); any other letter does
 *     ("إحرام" is not "حرام"). Letters are compared with hamza, alef maqsura and
 *     ta marbuta folded and the vowel marks removed.
 *   · An unspaced script (Chinese, Japanese, Thai…): the term starts and ends
 *     where the platform's word dictionary (Intl.Segmenter) puts word edges —
 *     it may span several words ("傻逼" is 傻|逼) — and is not inside one of
 *     its innocent compounds (INNOCENT_COMPOUNDS).
 *
 * Everything is compared with accents and case folded ("estupido" is
 * "estúpido"). The floor lists the longer forms it must still catch, since
 * "fuck" no longer catches "fucking" by containing it.
 */
export function findForbidden(
  reply: string, terms: readonly ForbiddenTerm[],
): readonly ForbiddenTerm[] {
  const text = fold(reply);
  let edges: ReadonlySet<number> | null = null;   // the dictionary's word edges, read once, only if needed
  const edgesOf = (): ReadonlySet<number> => (edges ??= wordEdges(text));
  return terms.filter((t) => {
    const term = fold(t.term);
    if (term.length === 0) return false;
    for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + 1)) {
      if (standsAsWord(text, term, at, at + term.length, edgesOf)) return true;
    }
    return false;
  });
}

/** Case, accents and vowel marks off; the Arabic letters that are written several ways, one way. */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').toLowerCase()
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ـ/g, '');

type ScriptKey = 'latin' | 'cyrillic' | 'greek' | 'hebrew' | 'arabic' | 'unspaced' | 'letter';
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
/** Which script a word-forming character belongs to, or null when it ends a word (space, punctuation). */
function scriptOf(ch: string | undefined): ScriptKey | 'digit' | null {
  if (ch === undefined) return null;
  if (/\p{Nd}/u.test(ch)) return 'digit';
  if (!/\p{L}/u.test(ch)) return null;
  if (UNSPACED.test(ch)) return 'unspaced';
  if (/\p{Script=Latin}/u.test(ch)) return 'latin';
  if (/\p{Script=Arabic}/u.test(ch)) return 'arabic';
  if (/\p{Script=Cyrillic}/u.test(ch)) return 'cyrillic';
  if (/\p{Script=Greek}/u.test(ch)) return 'greek';
  if (/\p{Script=Hebrew}/u.test(ch)) return 'hebrew';
  return 'letter';
}
/** Does `ch` carry on a word whose edge letter is of `script`? A digit carries on a spaced word. */
const carriesOn = (ch: string | undefined, script: ScriptKey): boolean => {
  const k = scriptOf(ch);
  return k !== null && (k === script || (k === 'digit' && script !== 'unspaced'));
};

const ARABIC_PREFIXES = new Set(['و', 'ف', 'ب', 'ك', 'ل', 'ال', 'وال', 'فال', 'بال', 'كال', 'لل', 'ولل', 'فلل', 'وب', 'فب', 'ول', 'فل', 'وك', 'فك', 'يا']);
const ARABIC_ENDINGS = new Set(['ه', 'ها', 'هم', 'هن', 'هما', 'ك', 'كم', 'كن', 'نا', 'ي', 'ين', 'ون', 'ان', 'ات', 'يه', 'يين', 'يون']);

function standsAsWord(text: string, term: string, from: number, to: number, edgesOf: () => ReadonlySet<number>): boolean {
  const first = scriptOf(term[0]);
  const last = scriptOf(term[term.length - 1]);
  // The start edge, by the script of the term's first letter.
  if (first === 'unspaced') {
    if (!edgesOf().has(from)) return false;
  } else if (first !== null && first !== 'digit' && carriesOn(text[from - 1], first)) {
    if (first !== 'arabic') return false;
    let k = from; while (k > 0 && carriesOn(text[k - 1], 'arabic')) k--;
    if (!ARABIC_PREFIXES.has(text.slice(k, from))) return false;
  }
  // The end edge, by the script of its last letter.
  if (last === 'unspaced') {
    if (!edgesOf().has(to)) return false;
  } else if (last !== null && last !== 'digit' && carriesOn(text[to], last)) {
    if (last !== 'arabic') return false;
    let k = to; while (k < text.length && carriesOn(text[k], 'arabic')) k++;
    if (!ARABIC_ENDINGS.has(text.slice(to, k))) return false;
  }
  // Chinese: not inside one of its innocent compounds.
  for (const word of INNOCENT_COMPOUNDS[term] ?? []) {
    const w = fold(word);
    for (let p = text.indexOf(w, Math.max(0, to - w.length)); p !== -1 && p <= from; p = text.indexOf(w, p + 1)) {
      if (p + w.length >= to) return false;
    }
  }
  return true;
}

/** Where the platform's word dictionary puts word edges in this text: each word's start and end. */
function wordEdges(text: string): ReadonlySet<number> {
  const out = new Set<number>([0, text.length]);
  for (const s of new Intl.Segmenter('zh', { granularity: 'word' }).segment(text)) {
    out.add(s.index);
    out.add(s.index + s.segment.length);
  }
  return out;
}

/** The guard, shaped exactly like `guardClaims`: Result, never a side effect. */
export function guardForbidden(input: {
  reply: string;
  ownerTerms: readonly string[];
}): Result<string, ForbiddenViolation> {
  const hits = findForbidden(input.reply, effectiveForbidden(input.ownerTerms));
  if (hits.length === 0) return ok(input.reply);
  return err({ kind: 'forbidden_word', terms: hits });
}
