/**
 * CC-02a — the deadline a deletion request carries.
 *
 * /data-deletion states it to every buyer: Nomi's operator carries a deletion
 * out within 30 days of the business recording the request. The owner's pages
 * show the date that makes (asked + 30 days), and once a day the operator is
 * told of every open request whose 30 days end within the next 7 or have
 * already ended — `deletion_requests_due()` in migration 0073 asks that
 * question across every business, with the same two numbers written in SQL.
 * tests/parity/deletion-page.test.ts holds the page, this file and the
 * migration to one another, so none of the three can move alone.
 *
 * Pure, so the arithmetic is tested without a database or a clock.
 */
export const DELETION_DAYS = 30;

const DAY_MS = 86_400_000;

/** The day a request asked at `askedAt` must be carried out by. */
export const deletionDueBy = (askedAt: Date): Date => new Date(askedAt.getTime() + DELETION_DAYS * DAY_MS);

/** Past its deadline at `now` — the operator's alert says so of each one. */
export const deletionOverdue = (askedAt: Date, now: Date): boolean =>
  deletionDueBy(askedAt).getTime() < now.getTime();
