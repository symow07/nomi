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
| 0 | **IDOR audit.** Every route that takes an id or a token: can one business, or one person, reach another's? | First | Done (the IDOR PR, 2026-10-08); two findings reported, below |
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

## Item 0, the IDOR audit: what was found

**No route lets one business reach another's rows.** Every route binds the workspace from the signed session,
every database pool is the row-security-bound app role, and every table has row security. Every security-definer
function that takes an id either reads the workspace from the transaction or is keyed by a credential.

**Fixed in the IDOR PR** (each guard broken on purpose fails its own test):
1. **The owner's access code skipped the login limit**, so a right guess got in at any rate. A caller past the
   limit is now refused before any code is compared. The owner's own sign-ins are never counted.
2. **"What {name} may promise" showed staff the price floor and the price rules.** These are the owner's, like
   the price page they come from.
3. **The language switch's `next=` could send a browser to another site** (`/\host`, or one hidden behind a
   tab). One rule, `localPath`, now allows only a path on this site.
4. **The language switch set the owner's alert language for anyone signed in, and from a link on another
   site.** Now only the owner can set it, and never from another site.
5. **Any workspace's owner could claim the installation's own WhatsApp number, Page or Instagram account.**
   They are now the installation's own workspace's alone.
6. **Teaching a fact took any product id**, because a foreign key looks past row security. The product must now
   be this workspace's.

**Reported, not fixed: the owner decides.**
- **R1 · An inbound e-mail reply is matched by the quoted message id and the From line,** and From can be forged.
  Someone holding a message id Nomi sent could add a message to that conversation, record e-mail consent and
  hand it to a person. Nothing is sent to anyone by it. This is the inbound mail path. The fix is to require
  the mail provider's SPF/DKIM pass, or a signed reply-to address per send.
- **R2 · The approve/edit route checks the window and the allowlist for the conversation in the address, not
  the draft's own.** It only matters inside one workspace, and the send gate still refuses anything that may not
  go. This is the approval path. The fix is to tie the draft to the conversation in the address.

**Small, left as they are:** `advisor_may_keep` is granted to the app role without need (only a trigger calls
it; removing the grant is a migration). Quote-proof tokens are stored in clear, as their own key (256 bits).
The Meta webhook's set-up handshake compares its token with `===`. Kept edits and conversations are shared
within a workspace by design.

**The owner's, not code:** production's `OWNER_ACCESS_CODE` is 11 characters. A code of 20 or more random
characters makes guessing hopeless even with no limit. Paste a new one into Railway (nomi service); the old
one stops working at the next deploy.
