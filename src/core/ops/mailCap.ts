/**
 * MAIL's daily caps (rule 70; the counting is src/db/mailCaps.ts): how a sender wrapped by `cappedMail`
 * (src/channels/email/httpsMail.ts) says a cap held a message back — "daily_cap: <which cap>" — and how a reader
 * tells that from a failure. Pure and in core, so the conversation path (the monthly e-mail's job,
 * src/pipeline/monthMail.ts) can read it without reaching the mail transport even by a type
 * (tests/parity/c5-prospects.test.ts walks imports).
 */
const PREFIX = 'daily_cap:';

/** The error a capped sender answers with: "daily_cap: address_cap", "daily_cap: installation_cap". */
export const capRefusal = (which: string): string => `${PREFIX} ${which}`;

/** True when a send was held back by a cap, not refused by the provider: nothing left, and nothing is wrong. */
export const refusedByCap = (r: { readonly ok: boolean; readonly error?: string }): boolean => !r.ok && (r.error ?? '').startsWith(PREFIX);
