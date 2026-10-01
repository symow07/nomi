/**
 * WHAT SHE SAYS BEFORE A MESSAGE NOBODY APPROVED REACHES A BUYER.
 *
 * The rule, in the owner's own words: any message sent WITHOUT human approval
 * carries a short AI disclosure on the first message of a conversation. A
 * message the owner read and pressed send on does not need one — a person is
 * answering, through her.
 *
 * So this is not a banner and not a footer on everything. It is the one
 * sentence a buyer is owed before an unsupervised machine starts talking to
 * them, said once, at the top, and then never again in that conversation.
 *
 * ── WHY THIS IS NOT IN THE OWNER CATALOGUE ──────────────────────────────────
 *
 * `core/owner/i18n/messages.ts` is what the OWNER reads, and it is governed by
 * a vocabulary rule that bans the word "AI" outright — for good reasons that
 * have nothing to do with this. This text is read by a BUYER, in the BUYER's
 * language, which is chosen by what they wrote rather than by what the owner
 * set her workspace to. Two different audiences, two different languages, two
 * different rules; putting them in one table would eventually get one of them
 * wrong. It lives beside the other deterministic outbound text instead.
 *
 * ── THE WORDING IS THE OWNER'S, VERBATIM ────────────────────────────────────
 *
 * It says the team will reply "as soon as they can" and never "any time" or
 * "right away". A solo owner sleeps, and a disclosure that promises otherwise
 * has replaced one dishonesty with another.
 *
 * zh and ar were read and signed off by the owner on 2026-09-28 (below).
 */

/** The languages the disclosure is written in. Anything else falls back to en. */
export const DISCLOSURE_LOCALES = ['en', 'zh', 'ar', 'es', 'fr', 'pt'] as const;
export type DisclosureLocale = (typeof DISCLOSURE_LOCALES)[number];

const TEXT: Readonly<Record<DisclosureLocale, string>> = {
  en: "Hi, I'm {name}, {business}'s AI assistant. If you'd like a person from our team, just say so and they'll reply as soon as they can.",
  // Signed off by the owner, 2026-09-28, unchanged: 人工服务 is the term a
  // Chinese buyer expects, and the register is right.
  zh: '您好，我是{name}，{business}的AI助手。如需人工服务请告诉我，同事会尽快回复您。',
  // Signed off by the owner, 2026-09-28, with two changes: «مساعد آلي» (an
  // automated assistant) for «المساعد الذكي» ("the smart assistant"), which
  // named a quality rather than a kind and is the ordinary marketing phrase
  // for any chatbot; and the buyer is no longer addressed in a gender — rule 6:
  // «فأخبرني» (tell me) was a masculine imperative, so the clause now says
  // "to speak with a person from our team, asking is enough, and the reply
  // comes as soon as possible", addressing nobody.
  ar: 'مرحبًا، أنا {name}، مساعد آلي لدى {business}. للتحدث مع شخص من فريقنا يكفي طلب ذلك، ويصل الرد في أقرب وقت ممكن.',
  // 2026-09-29 — Spanish and French, for the customers the EU AI Act already
  // covers, who were told in English. Translated to carry the English
  // sentence's meaning; NOT yet read by a native speaker (the gate below).
  // Neither genders the assistant: no article before «asistente de IA», and
  // «l'IA» elides it. The customer is addressed as the English does — plainly,
  // and in no gender.
  es: 'Hola, soy {name}, asistente de IA de {business}. Si prefieres hablar con una persona de nuestro equipo, solo tienes que decirlo y te responderá en cuanto pueda.',
  fr: "Bonjour, je suis {name}, l'IA de {business}. Pour parler à une personne de notre équipe, il suffit de le demander : on vous répondra dès que possible.",
  // 2026-10-01 — Portuguese (the pt pack), as Brazil writes it («equipe»).
  // NOT yet read by a native speaker (the gate below). «assistente de IA»
  // without an article genders nobody; the customer is addressed through the
  // verb («preferir», «pedir»), in no gender.
  pt: 'Olá, sou {name}, assistente de IA de {business}. Se preferir falar com uma pessoa da nossa equipe, é só pedir e responderemos assim que possível.',
};

const isDisclosureLocale = (v: string): v is DisclosureLocale =>
  (DISCLOSURE_LOCALES as readonly string[]).includes(v);

/**
 * WHICH OF THESE HAS BEEN READ BY SOMEONE WHO SPEAKS IT.
 *
 * The English sentence was written by the owner. The Chinese and Arabic ones
 * were translated to carry the same meaning, and nobody who speaks them has
 * signed them off yet. This is the ONE sentence in the product whose job is to
 * tell a buyer the truth about what is answering him: a translation that is
 * merely close is not good enough for it, and "we will check later" is how a
 * placeholder ships.
 *
 * So it is a gate, not a note — and, since 2026-09-30, a gate PER LANGUAGE
 * (the owner: "a language becomes auto-capable only when a native reader has
 * signed its disclosure off"). A reply goes out alone only to a customer whose
 * language has a signed-off sentence here; in any other language — one of
 * these still unread, or one with no sentence at all — every reply waits for
 * the owner, and the draft says why (`autonomyReleasedFor`). The same for
 * every workspace: the text does not become correct for one business and
 * wrong for another.
 *
 * Until 2026-09-30 it was ONE answer for the whole product: adding es and fr
 * unread (#124) stopped every workspace sending alone, Westlake's included,
 * which nobody had decided (docs/PROGRESS.md, "The owner's questions").
 *
 * LIFTED for zh and ar 2026-09-28: the owner read the `zh` and `ar` strings
 * above, changed one phrase in the Arabic, and the flags were set in the same
 * commit. The Arabic's second clause was rewritten the same day (#118) and the
 * owner has not read that version — PROGRESS quotes both for him. A locale
 * added to DISCLOSURE_LOCALES later starts false: its customers get drafts.
 */
export const DISCLOSURE_NATIVE_REVIEW: Readonly<Record<DisclosureLocale, boolean>> = {
  en: true,
  zh: true,   // the owner, 2026-09-28
  ar: true,   // the owner, 2026-09-28
  // Awaiting a native reader (the owner's instruction, 2026-09-29). Never set
  // true by an assistant: a reviewer reads the sentence above, and the flag
  // flips in the same commit that names them.
  es: false,
  fr: false,
  pt: false,
};

/** The locales still waiting for a native reading, in order. */
export const disclosureAwaitingReview = (): readonly DisclosureLocale[] =>
  DISCLOSURE_LOCALES.filter((l) => !DISCLOSURE_NATIVE_REVIEW[l]);

/**
 * Where a customer's language stands, for sending alone:
 *   · `reviewed`   — one of the five, and read by a native speaker: may go alone;
 *   · `unreviewed` — one of the five, not read yet (es, fr today): drafts;
 *   · `unwritten`  — none of the five: there is no sentence to say, and one is
 *     never machine-translated for the occasion — that would defeat the
 *     reading. Drafts, always, until a reviewed sentence is added here.
 * No language detected reads as English, as the sentence itself falls back.
 */
export type DisclosureStanding = 'reviewed' | 'unreviewed' | 'unwritten';
export function disclosureStanding(detected: string | null | undefined): DisclosureStanding {
  const head = (detected ?? '').slice(0, 2).toLowerCase() || 'en';
  if (!isDisclosureLocale(head)) return 'unwritten';
  return DISCLOSURE_NATIVE_REVIEW[head] ? 'reviewed' : 'unreviewed';
}

/** May a reply to a customer writing in this language go out alone? */
export const autonomyReleasedFor = (detected: string | null | undefined): boolean =>
  disclosureStanding(detected) === 'reviewed';

/**
 * May a capability be SET to auto at all? While any language's sentence is
 * signed off (English always is): what it may then do is decided per reply,
 * by the customer's language, above.
 */
export const autonomyReleased = (): boolean => DISCLOSURE_LOCALES.some((l) => DISCLOSURE_NATIVE_REVIEW[l]);

/** The languages whose customers get replies sent alone, in order. */
export const disclosureReviewed = (): readonly DisclosureLocale[] =>
  DISCLOSURE_LOCALES.filter((l) => DISCLOSURE_NATIVE_REVIEW[l]);

/**
 * The buyer's language, from the conversation's detected language, falling
 * back to English. Only the first two letters are read: "zh-Hans" and "ar-EG"
 * are the same sentence as "zh" and "ar".
 */
export function disclosureLocale(detected: string | null | undefined): DisclosureLocale {
  const head = (detected ?? '').slice(0, 2).toLowerCase();
  return isDisclosureLocale(head) ? head : 'en';
}

/**
 * The sentence itself.
 *
 * `name` is the assistant's, from the `assistants` row the owner confirmed in
 * Getting ready — which is why that step is a gate. With no name and no
 * business name there is nothing honest to substitute, so the caller gets
 * null and sends nothing rather than a sentence with a hole in it.
 */
export function disclosureFor(input: {
  readonly detected: string | null | undefined;
  readonly name: string | null;
  readonly business: string | null;
}): string | null {
  const name = input.name?.trim();
  const business = input.business?.trim();
  if (!name || !business) return null;
  return TEXT[disclosureLocale(input.detected)]
    .replace('{name}', name)
    .replace('{business}', business);
}

/**
 * Wordings the sentence had before, recognised but never said again: a message
 * queued before a wording changed still tells the buyer what it tells him.
 */
const EARLIER: readonly string[] = [
  // ar until 2026-09-28 («المساعد الذكي», and «فأخبرني» addressed him as a man).
  'مرحبًا، أنا {name}، المساعد الذكي لدى {business}. إذا أردت التحدث مع شخص من فريقنا فأخبرني، وسيرد عليك في أقرب وقت.',
  // ar for a few hours on 2026-09-28 (#117: «مساعد آلي», the old clause after it).
  'مرحبًا، أنا {name}، مساعد آلي لدى {business}. إذا أردت التحدث مع شخص من فريقنا فأخبرني، وسيرد عليك في أقرب وقت.',
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Each wording as a pattern: the words as written, any name and business in
 * the holes — up to 300 characters each, past the profile's 200 for a business
 * name and the assistant's 40.
 */
const SHAPES: readonly RegExp[] = [...DISCLOSURE_LOCALES.map((l) => TEXT[l]), ...EARLIER].map((w) =>
  new RegExp(w.split(/\{name\}|\{business\}/)
    .map((part) => escapeRe(part).replace(/\s+/g, '\\s+'))
    .join('[\\s\\S]{1,300}?')));

/**
 * 0079 — does this text TELL the buyer what is answering him: does it carry
 * the disclosure sentence, in any language it is written in, with whatever
 * name and business it was said with? The send path asks it of every message
 * the provider accepts — a reply sent alone, the sentence sent when he asked,
 * a draft or a reply of the owner's that carries it — because "has he been
 * told" is a fact about what reached him, not about which mode sent it.
 */
export const carriesDisclosure = (text: string): boolean => SHAPES.some((re) => re.test(text));

/**
 * The disclosure in front of what she was going to say anyway.
 *
 * A blank line between them: it is a separate statement, not a clause of the
 * answer, and a buyer skimming on a phone should be able to tell where one
 * stops and the other starts.
 */
export const withDisclosure = (disclosure: string, reply: string): string =>
  `${disclosure}\n\n${reply}`;
