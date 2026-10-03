/**
 * CH4 — WHERE NOMI STANDS WITH META, said the same to every workspace.
 *
 * Before Meta approves Nomi's app, a connected Page or Instagram account
 * receives messages only from people added to the app on Meta's side; after
 * it, from anyone. A connection looks the same either way, so the Channels
 * page says which it is — set by the operator, once, in one variable:
 *
 *   META_APP_REVIEW=approved:2026-11-20     Meta approved Nomi on that day
 *   (unset, or anything else)               Meta is reviewing Nomi
 *
 * No customer's message is hidden or held back by it (the owner's instruction:
 * every Meta path is built as if approval had passed). It says where things
 * stand — and, since the warmth run's phase 8, it opens WhatsApp as the way
 * the two notifications reach an owner on the default (`ownerWhatsAppOpen`,
 * src/core/owner/alertChannel.ts): before approval they go by e-mail, unless
 * the owner chose WhatsApp where their alert number is on a live channel.
 */
export type MetaReview = { readonly state: 'approved'; readonly on: Date } | { readonly state: 'reviewing' };

export function metaReviewFrom(env: Record<string, string | undefined>): MetaReview {
  const m = /^approved:(\d{4})-(\d{2})-(\d{2})$/.exec(env['META_APP_REVIEW']?.trim() ?? '');
  if (!m) return { state: 'reviewing' };
  const on = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // A date that is not a day of the calendar (2026-13-01, 2026-02-30) is not a date.
  const real = on.getUTCFullYear() === Number(m[1]) && on.getUTCMonth() === Number(m[2]) - 1 && on.getUTCDate() === Number(m[3]);
  return real ? { state: 'approved', on } : { state: 'reviewing' };
}
