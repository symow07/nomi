/**
 * Block 4.3 — the monthly e-mail, "What Nomi did for you", and the flash lines of the minutes-per-reply form.
 * English only, registered in the explicit redesign fallback. Placeholder wording until the designer's
 * docs/design/block4/month-report.md lands; the figures always come from the one MonthReport (src/core/report/month.ts).
 */
export const MONTH_MAIL_EN = {
  'monthMail.subject': 'What Nomi did for you in {month}',
  'monthMail.flash.minutesSaved': 'Saved. The estimate now uses {minutes} minutes per reply.',
  'monthMail.flash.minutesCleared': 'Cleared. No estimate is shown.',
  'monthMail.flash.minutesInvalid': 'Type a whole number of minutes from 1 to 60, or leave it empty.',
} as const;
