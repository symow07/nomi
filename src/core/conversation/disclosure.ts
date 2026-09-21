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
