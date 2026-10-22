/**
 * The books' launch blockers (docs/LAUNCH-CHECKLIST.md), as tools/books-area.mjs applies them — kept here, apart from
 * the tool, so the rule is a function a test can call. Remove an item in the commit that builds it.
 *
 * BLOCKERS hold for every workspace ("Before the books are switched on for ANY workspace"); MOROCCO_BLOCKERS for a
 * workspace in Morocco ("Before the books are switched on for a MOROCCAN workspace"): its FEC is not finished while
 * the file's name is not the one the DGI requires. (The business's ICE, IF and RC left with E2, 0206.)
 */
export const BLOCKERS = [
  'the public pages (/privacy, /data-deletion) describe the books: what is kept at closure, how long, why, and that the owner has their copy; and /privacy names the shop\'s own systems the books read from (Odoo; Google Sheets is held at boot by D18), and that the model provider reads a receipt or bill when the owner asks it to (D6)',
];

export const MOROCCO_BLOCKERS = [
  'the Moroccan FEC named as the DGI requires (the DGI has published no name as of 2026-10-22; the Avis sets none; the French convention is not assumed)',
];

/** What stands between this workspace and its books: the blockers for all, and Morocco's for a Moroccan one. */
export function blockersFor(country) {
  return [...BLOCKERS, ...(String(country ?? '').toUpperCase() === 'MA' ? MOROCCO_BLOCKERS : [])];
}
