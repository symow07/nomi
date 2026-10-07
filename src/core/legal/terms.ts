/**
 * G1 — WHICH TERMS AN OWNER AGREED TO. The terms page is drawn from these
 * keys, in this order; the version is a digest of their English text
 * (`TERMS_VERSION`, beside the page in `src/api/web/legal.ts`: core stays
 * free of node:crypto), so it changes exactly when the words do, and a
 * sign-up records the one it saw (`businesses.terms_version`). The "what may not be sold or said" section is
 * the acceptable-use part: a draft until counsel's text replaces it (LEGAL).
 * The advisor's history (2026-10-07) added one sentence to "What Nomi does",
 * so the version moved with it.
 */
export const TERMS_KEYS = [
  'legal.terms.title', 'legal.terms.intro',
  'legal.terms.service.title', 'legal.terms.service.body', 'legal.terms.service.advisor',
  'legal.terms.yours.title', 'legal.terms.yours.you1', 'legal.terms.yours.you2', 'legal.terms.yours.you3',
  'legal.terms.use.title', 'legal.terms.use.use1', 'legal.terms.use.use2', 'legal.terms.use.use3', 'legal.terms.use.use4', 'legal.terms.use.after',
  'legal.terms.ours.title', 'legal.terms.ours.we1', 'legal.terms.ours.we2', 'legal.terms.ours.we3', 'legal.terms.ours.we4',
  'legal.terms.fees.title', 'legal.terms.fees.body',
  'legal.terms.liability.title', 'legal.terms.liability.body',
  'legal.terms.changes.title', 'legal.terms.changes.body',
] as const;
