/**
 * Block 4.3 — "WHAT NOMI DID FOR YOU": the monthly e-mail, the Results tab, and the notices after the month page's two
 * owner-only forms (the minutes per reply, the e-mail switch). The backend's keys; the page's own are
 * `monthReport.` (./monthReport.ts, the frontend's). English only, for every owner (new owner text is English only):
 * spread into every locale's catalogue through REDESIGN_EN. The words are the design spec's
 * (docs/design/block4/month-report.md §4.2).
 *
 * The e-mail names no customer and carries one address, the month's page. `monthMail.off` and `monthMail.flash.mailOn`
 * are kept by the switch on that page (POST /app/results/month/mail) and the 1st-of-month job (src/pipeline/monthMail.ts).
 */
export const MONTH_MAIL_EN = {
  'monthMail.tab': 'Monthly report',
  'monthMail.subject': '{business} · What Nomi did for you in {month}',
  'monthMail.opening': 'Here is {month} at {business}.',
  'monthMail.answered': 'Customers answered: {n}',
  'monthMail.alone': 'Replies {name} sent alone: {n}',
  'monthMail.asWritten': 'Drafts you sent as written: {n}',
  'monthMail.edited': 'Drafts you edited, then sent: {n}',
  'monthMail.notSent': 'Drafts not sent: {n}',
  'monthMail.median': 'Median time to first reply: {time}, from {n} customers',
  'monthMail.medianOne': 'Median time to first reply: {time}, from 1 customer',
  'monthMail.medianNone': 'Median time to first reply: no first replies to measure',
  'monthMail.orders': 'Orders confirmed: {n} ({totals})',
  'monthMail.ordersBare': 'Orders confirmed: {n}',
  'monthMail.invoices': 'Invoices paid in full: {n} ({totals})',
  'monthMail.invoicesBare': 'Invoices paid in full: {n}',
  'monthMail.handed': 'Hand-offs to you: {n}',
  'monthMail.handedReason': '{reason}: {n}',
  // A hand-off whose reason has no words of its own (the page's `monthReport.handed.other`, said the same way).
  'monthMail.handedOther': 'Another reason',
  'monthMail.estimate': 'Time saved, an estimate: {replies} replies × {minutes} min = {hours} h',
  'monthMail.open': 'See the month in Nomi: {url}',
  'monthMail.off': 'This e-mail comes on the 1st of each month. You can stop it at the foot of that page.',
  'monthMail.flash.mailOff': 'The monthly e-mail is stopped. Nothing more will be sent.',
  'monthMail.flash.mailOn': 'The monthly e-mail is on. The next one comes on the 1st.',
  'monthMail.flash.minutesSaved': 'Saved. The estimate now uses {minutes} minutes a reply.',
  'monthMail.flash.minutesCleared': 'Removed. The page no longer shows an estimate.',
  'monthMail.flash.minutesInvalid': 'Type a whole number from 1 to 60, or leave it empty. Nothing was changed.',
  'monthMail.flash.ownerOnly': 'Only the owner can change this. Nothing was changed.',
} as const;
