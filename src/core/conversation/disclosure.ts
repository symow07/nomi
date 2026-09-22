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
 * zh and ar are PENDING NATIVE REVIEW.
 */

/** The languages the disclosure is written in. Anything else falls back to en. */
export const DISCLOSURE_LOCALES = ['en', 'zh', 'ar'] as const;
export type DisclosureLocale = (typeof DISCLOSURE_LOCALES)[number];

const TEXT: Readonly<Record<DisclosureLocale, string>> = {
  en: "Hi, I'm {name}, {business}'s AI assistant. If you'd like a person from our team, just say so and they'll reply as soon as they can.",
  // pending native review
  zh: '您好，我是{name}，{business}的AI助手。如需人工服务请告诉我，同事会尽快回复您。',
  // pending native review
  ar: 'مرحبًا، أنا {name}، المساعد الذكي لدى {business}. إذا أردت التحدث مع شخص من فريقنا فأخبرني، وسيرد عليك في أقرب وقت.',
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
 * So it is a gate, not a note. While any of these is false, no capability can
 * be turned on — `autonomyReleased()` below is what the owner's page and the
 * route that saves her choice both ask, and it is deliberately a single answer
 * for the whole product rather than per workspace: the text does not become
 * correct for one business and wrong for another.
 *
 * TO LIFT IT: have a native speaker read the `zh` and `ar` strings above, fix
 * what they say to fix, and set the flag in the same commit. Nothing else.
 */
export const DISCLOSURE_NATIVE_REVIEW: Readonly<Record<DisclosureLocale, boolean>> = {
  en: true,
  zh: false,
  ar: false,
};

/** The locales still waiting for a native reading, in order. */
export const disclosureAwaitingReview = (): readonly DisclosureLocale[] =>
  DISCLOSURE_LOCALES.filter((l) => !DISCLOSURE_NATIVE_REVIEW[l]);

/**
 * May ANY capability be set to auto anywhere in this installation?
 *
 * False while a disclosure locale is unreviewed. A buyer does not choose which
 * language the product was checked in, and a workspace that only ever writes
 * English today can take an Arabic message tomorrow.
 */
export const autonomyReleased = (): boolean => disclosureAwaitingReview().length === 0;

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
 * The disclosure in front of what she was going to say anyway.
 *
 * A blank line between them: it is a separate statement, not a clause of the
 * answer, and a buyer skimming on a phone should be able to tell where one
 * stops and the other starts.
 */
export const withDisclosure = (disclosure: string, reply: string): string =>
  `${disclosure}\n\n${reply}`;
