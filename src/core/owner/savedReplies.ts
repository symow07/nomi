/**
 * S1 (Phase 5, item 18) — SAVED REPLIES: words a workspace's people reuse when they answer a buyer themselves. A
 * saved reply is a title and its text in one or more of the five languages the app speaks. It NEVER sends: it is put
 * in the reply box of a conversation a person holds, after what is already there, and the reply goes the one way an
 * owner's reply goes, through every guard of that way (the send window, the allowlist, a stop, a frozen workspace,
 * the kept words of CC-24).
 *
 * Pure: the rules the page, the route and the database share (0195 checks the same shape).
 */
export const SAVED_REPLY_LANGUAGES = ['en', 'zh', 'ar', 'es', 'fr'] as const;
export type SavedReplyLanguage = (typeof SAVED_REPLY_LANGUAGES)[number];
export type SavedReplyTexts = Readonly<Partial<Record<SavedReplyLanguage, string>>>;
export const SAVED_REPLY_TITLE_MAX = 80;
export const SAVED_REPLY_TEXT_MAX = 2000;

/** What is wrong with a saved reply as written; null when it can be kept (0195's checks, said first). */
export function savedReplyProblem(title: string, texts: SavedReplyTexts): 'title' | 'texts' | 'too_long' | null {
  const t = title.trim();
  if (t.length < 1 || t.length > SAVED_REPLY_TITLE_MAX) return 'title';
  const given = Object.entries(texts).filter(([, v]) => typeof v === 'string' && v.trim() !== '');
  if (given.length === 0) return 'texts';
  if (given.some(([, v]) => v!.trim().length > SAVED_REPLY_TEXT_MAX)) return 'too_long';
  return null;
}

/** Only the languages with words, each trimmed, in the app's order. */
export function savedReplyTexts(raw: Readonly<Record<string, string | undefined>>): SavedReplyTexts {
  return Object.fromEntries(SAVED_REPLY_LANGUAGES.map((l) => [l, (raw[l] ?? '').trim()] as const).filter(([, v]) => v !== ''));
}

/**
 * The words for this buyer: in the language they write in when the reply has it; else in the language of the person
 * answering; else the first the reply has, in the app's order. Null when it has none.
 */
export function savedReplyFor(texts: SavedReplyTexts, buyerLanguage: string | null, personLocale: string): { readonly language: SavedReplyLanguage; readonly text: string } | null {
  const has = (l: string | null): l is SavedReplyLanguage => l !== null && (SAVED_REPLY_LANGUAGES as readonly string[]).includes(l) && Boolean(texts[l as SavedReplyLanguage]?.trim());
  const language = has(buyerLanguage) ? buyerLanguage : has(personLocale) ? personLocale : SAVED_REPLY_LANGUAGES.find((l) => has(l)) ?? null;
  return language ? { language, text: texts[language]!.trim() } : null;
}

/** The box after a saved reply is put in it: what was there first, kept, then the saved words. */
export function boxWithSaved(box: string, saved: string): string {
  return box.trim() === '' ? saved : `${box.replace(/\s+$/, '')}\n\n${saved}`;
}
