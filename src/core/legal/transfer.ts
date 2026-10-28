/**
 * A BUSINESS IN THE EU, THE EEA OR THE UK WAITS AT SIGN-UP (the owner, 2026-10-28; docs/LAUNCH-CHECKLIST.md, "Before
 * any customer or workspace in the EU or UK").
 *
 * Replies, pictures and the documents an owner asks Nomi to read go to the model provider, outside those countries.
 * The GDPR (art. 13(1)(f)) and the UK GDPR ask the privacy page to say on what basis and with what safeguards; counsel
 * has not confirmed one, and the page does not say one. Until then sign-up does not open a workspace for a business
 * there: it says so plainly, before a code is sent, and again when a code comes back.
 *
 * The countries are the GDPR's, not only the EU's: the EU's 27, the EEA's three (Iceland, Liechtenstein, Norway
 * apply it in full) and the United Kingdom's own copy of it. Switzerland, the Crown Dependencies and Gibraltar have
 * laws of their own and are not on the list.
 *
 * One switch, `EU_UK_SIGNUP`: `open` (exactly) lets them sign up, flipped by the owner once counsel's line is
 * cleared; anything else, or nothing, holds them. A customer writing from one of these countries cannot be held this
 * way: no customer's country is recorded. That is said beside the checklist line.
 */
export const GDPR_COUNTRIES: ReadonlySet<string> = new Set([
  // the European Union
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // the European Economic Area
  'IS', 'LI', 'NO',
  // the United Kingdom
  'GB',
]);

/** `EU_UK_SIGNUP`: only `open` lifts the hold. */
export const euUkSignupOpenFrom = (raw: string | undefined): boolean => (raw ?? '').trim() === 'open';

/** Is a sign-up from this (canonical, ISO alpha-2) country held? */
export const signupHeldForTransfer = (country: string, open: boolean): boolean => !open && GDPR_COUNTRIES.has(country);
