/**
 * The books' launch blockers (docs/LAUNCH-CHECKLIST.md), as tools/books-area.mjs applies them — kept here, apart from
 * the tool, so the rule is a function a test can call. Remove an item in the commit that builds it.
 *
 * BLOCKERS hold for every workspace ("Before the books are switched on for ANY workspace"); MOROCCO_BLOCKERS for a
 * workspace in Morocco ("Before the books are switched on for a MOROCCAN workspace"): its FEC is not finished while
 * the file's name was not the one the DGI requires — that left with R2 (0209): none is published, so the name is a
 * configurable default. (The business's ICE, IF and RC left with E2, 0206.) The list is empty, and kept for the next.
 */
export const BLOCKERS = [];

// R2 (0209, 2026-10-23) — the FEC's file name left: none is published, so it is a configurable default. Empty now.
export const MOROCCO_BLOCKERS = [];

/** What stands between this workspace and its books: the blockers for all, and Morocco's for a Moroccan one. */
export function blockersFor(country) {
  return [...BLOCKERS, ...(String(country ?? '').toUpperCase() === 'MA' ? MOROCCO_BLOCKERS : [])];
}
