/**
 * S7 — THE GREETING FOR A TELEGRAM /start (the owner, 2026-10-22). A buyer who opens a business's start link and hears
 * nothing thinks the bot is broken, so the start is answered — but only in words a reader signed, like every sentence
 * Nomi sends on its own: sent in a language only once its reader signed this exact sentence (`SIGNED`, by name, in the
 * same commit). It is the first automated message of the conversation, so the AI disclosure goes in front of it.
 * Nobody has signed it yet: until then a /start is answered by silence — a known gap, waiting on that signature, not
 * a decision. Pure.
 */
export const GREETING_LOCALES = ['en', 'zh', 'ar', 'es', 'fr'] as const;
export type GreetingLocale = (typeof GREETING_LOCALES)[number];

const TEXT: Readonly<Record<GreetingLocale, string>> = {
  en: 'Welcome to {business} on Telegram. Write your question here, and you will get an answer.',
  zh: '欢迎通过 Telegram 联系{business}。请在这里留下您的问题，我们会回复您。',
  // No gender, no plural address (rule 6): a greeting and «يكفي», never an imperative.
  ar: 'أهلًا وسهلًا في {business} على تيليغرام. يكفي كتابة السؤال هنا ليصل الرد.',
  es: 'Te damos la bienvenida a {business} en Telegram. Escribe aquí tu pregunta y recibirás respuesta.',
  fr: 'Bienvenue chez {business} sur Telegram. Écrivez votre question ici : une réponse vous sera donnée.',
};
const SIGNED: Readonly<Partial<Record<GreetingLocale, { readonly text: string; readonly by: string }>>> = {};

export type GreetingSigned = Readonly<Partial<Record<GreetingLocale, string>>>;
export const GREETING_SIGNED: GreetingSigned = Object.freeze(Object.fromEntries(
  GREETING_LOCALES.flatMap((l) => (SIGNED[l]?.text === TEXT[l] ? [[l, TEXT[l]]] : []))) as GreetingSigned);

/** The greeting as written, for its reader (and the tests). */
export const greetingText = (l: GreetingLocale): string => TEXT[l];

/** The greeting in the buyer's language, or null: no language known, none of the five, or not signed. */
export function greetingFor(language: string | null | undefined, business: string, signed: GreetingSigned = GREETING_SIGNED):
  { readonly locale: GreetingLocale; readonly text: string } | null {
  const head = (language ?? '').slice(0, 2).toLowerCase();
  const locale = GREETING_LOCALES.find((l) => l === head);
  const name = business.replace(/\s+/g, ' ').trim();
  if (!locale || !name) return null;
  const text = signed[locale];
  return text ? { locale, text: text.split('{business}').join(name) } : null;
}
