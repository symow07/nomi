/**
 * WA-S — REOPENING A CUSTOMER'S CLOSED 24 HOURS. Pure.
 *
 * WhatsApp lets a business write freely only within 24 hours of the
 * customer's last message; after that, only a message template Meta approved.
 * Nomi asks Meta, for each business that connected its own number, to approve
 * ONE template — "a reply is waiting; answer this message to see it" — in the
 * languages below. When the owner sends or approves a reply after the 24 hours,
 * the outbound worker sends that template instead, and the owner's words wait
 * in the reply box for the customer's answer, which opens the window again.
 *
 * It says only what is true whoever wrote the reply: the business has a
 * reply, and answering shows it. It names the business ({{1}}), never the
 * assistant, and claims nothing about who is writing. A row nobody approved
 * (an automated follow-up) is never reopened this way: rule 3's disclosure
 * cannot ride on a template.
 */
export const REOPEN_TEMPLATE = 'nomi_reply_waiting';

/** The languages the template is written in, by the code Meta files each under. */
export const REOPEN_LANGUAGES = {
  en: 'en', es: 'es', pt: 'pt_BR', fr: 'fr', ar: 'ar', zh: 'zh_CN',
} as const;
export type ReopenLanguage = (typeof REOPEN_LANGUAGES)[keyof typeof REOPEN_LANGUAGES];

/** Each language's body; {{1}} is the business's name. Fixed sentences, never translated for the occasion. */
export const REOPEN_BODY: Readonly<Record<ReopenLanguage, string>> = {
  en: 'Hello, this is {{1}}. We have a reply to your message. Answer this message to see it.',
  es: 'Hola, te escribimos de {{1}}. Tenemos una respuesta a tu mensaje. Contesta a este mensaje para verla.',
  pt_BR: 'Olá, aqui é {{1}}. Temos uma resposta para a sua mensagem. Responda a esta mensagem para vê-la.',
  fr: 'Bonjour, ici {{1}}. Nous avons une réponse à votre message. Répondez à ce message pour la voir.',
  ar: 'مرحبًا، هنا {{1}}. لدينا رد على رسالتك. يُرجى الرد على هذه الرسالة لرؤيته.',
  zh_CN: '您好，这里是{{1}}。您的消息我们已经有了回复，回复这条消息即可查看。',
};

export const isReopenLanguage = (v: string): v is ReopenLanguage => v in REOPEN_BODY;

/** A language code (en, es-MX, pt-BR, zh-Hans…) → the template's language for it, or null. */
export function reopenLanguageOf(code: string | null | undefined): ReopenLanguage | null {
  const primary = (code ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return primary in REOPEN_LANGUAGES ? REOPEN_LANGUAGES[primary as keyof typeof REOPEN_LANGUAGES] : null;
}

/**
 * Which approved language this customer gets: their own, then the
 * business's, then English, then any approved one. Null when nothing is
 * approved — and then nothing reopens.
 */
export function pickReopenLanguage(
  approved: readonly string[], customer: string | null | undefined, business: string | null | undefined,
): ReopenLanguage | null {
  const ok = new Set(approved.filter(isReopenLanguage));
  for (const c of [reopenLanguageOf(customer), reopenLanguageOf(business), 'en' as const]) {
    if (c && ok.has(c)) return c;
  }
  return [...ok][0] ?? null;
}

/** The template as the customer reads it, for the transcript. */
export const renderReopen = (language: ReopenLanguage, businessName: string): string =>
  REOPEN_BODY[language].split('{{1}}').join(businessName);

/** Meta's limit on a parameter; a business name longer than this is cut, never refused. */
export const reopenParam = (businessName: string): string => businessName.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Nomi';
