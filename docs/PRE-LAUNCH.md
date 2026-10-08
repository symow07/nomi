# Pre-launch: the hardening batch

The owner's list, given in chat on 2026-10-08 from a video analysis. It is written here so that it is not
only in a conversation. Work it in this order. Update the status column as each item ships, with the PR.

## The rules for this batch

- **Report what is found before fixing anything that changes the send path.** That covers anything that
  decides, builds or delivers a message to a customer: the turn, the approval path, the outbound worker and
  the channel adapters. Report it, then wait for the owner's word.
- **Items 1–4 are launch-blockers.** Items 5–8 come next.
- **Not in this batch.** These are worth doing, but as their own batch after this one. Do not fold them in.
  - Messaging policy: WhatsApp, Messenger and Instagram's 24-hour window, opt-in and opt-out, templates, the
    AI disclosure.
  - Data protection: what the privacy and data-deletion pages promise, checked against the code.
- Nor is the provider batch (the advisor's provider list and the owner's own key, D9) part of this one.

## The list

| # | What | Kind | Status |
|---|---|---|---|
| 0 | **IDOR audit.** Every route that takes an id or a token: can one business, or one person, reach another's? | First | Open |
| 1 | **Age at sign-up (COPPA).** An age field on the sign-up form. | Launch-blocker | Open |
| 2 | **Third-party browser requests.** The fonts are already served by Nomi. Still open: stored product-photo addresses, and the addresses passed to Meta on sends (the send path: report first). | Launch-blocker | Open |
| 3 | **E-mails.** An unsubscribe link and a postal address on every outbound e-mail, launch and marketing mail included. | Launch-blocker | Open |
| 4 | **Stripe.** The renewal terms shown next to the subscribe button. | Launch-blocker | Open |
| 5 | **Policy pages.** Privacy, terms, cookies and refunds, each in all five languages. | Next | Open |
| 6 | **Accessibility.** Alt text, contrast and keyboard navigation. | Next | Open |
| 7 | **No dark patterns and no hidden fees.** | Next | Open |
| 8 | **A copyright agent for what people upload.** | Next | Open |

**And two items found earlier, not yet fixed (both on the send path: report first):**

| # | What | Status |
|---|---|---|
| F1 | **Product-photo addresses passed to Meta on sends.** The same thing as the second half of item 2. | Open |
| F2 | **Stop pressed while a customer's batch is still waiting.** The hold path fails because `markFragmentsProcessed` writes `processed_in`, which references `turns`, and the hold path writes no turn. The job dead-letters, and the customer reaches "Needs you" as `not_answered` about five minutes later instead of as "stopped". | Open |
