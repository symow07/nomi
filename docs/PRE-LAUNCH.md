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
| 0 | **IDOR audit.** Every route that takes an id or a token: can one business, or one person, reach another's? | First | Done (#255); R1 fixed (#260, 0132), R2 fixed (#261) |
| 1 | **Age at sign-up (COPPA).** An age field on the sign-up form. | Launch-blocker | Done (#256, migration 0131) |
| 2 | **Third-party browser requests.** The fonts are already served by Nomi. Still open: stored product-photo addresses, and the addresses passed to Meta on sends (the send path: report first). | Launch-blocker | Done: browser side (D7), send side F1 (#262) |
| 3 | **E-mails.** An unsubscribe link and a postal address on every outbound e-mail, launch and marketing mail included. | Launch-blocker | Customer mail done (#263, 0133). Nomi's own mail to owners waits on the owner: Nomi's postal address |
| 4 | **Stripe.** The renewal terms shown next to the subscribe button. | Launch-blocker | Done (#257) |
| 5 | **Policy pages.** Privacy, terms, cookies and refunds, each in all five languages. | Next | Done: privacy, terms, cookies (#258) and refunds (#264, 0134), each in all five |
| 6 | **Accessibility.** Alt text, contrast and keyboard navigation. | Next | Done (#257) |
| 7 | **No dark patterns and no hidden fees.** | Next | Nothing found. Cancelling on Stripe's page is set in code now (#264) |
| 8 | **A copyright agent for what people upload.** | Next | Waits on the owner: the agent's details and registration |

**And two items found earlier (both on the send path):**

| # | What | Status |
|---|---|---|
| F1 | **Product-photo addresses passed to Meta on sends.** The same thing as the second half of item 2. | Fixed (#262): a picture is sent only from Nomi's own https address |
| F2 | **Stop pressed while a customer's batch is still waiting.** The hold path fails because `markFragmentsProcessed` writes `processed_in`, which references `turns`, and the hold path writes no turn. The job dead-letters, and the customer reaches "Needs you" as `not_answered` about five minutes later instead of as "stopped". | Already fixed on 2026-09-30 ("the hold is a turn"), guarded by `tests/integration/assistant-stop.test.ts`. This list had it wrong |

## Item 0, the IDOR audit: what was found

**No route lets one business reach another's rows.** Every route binds the workspace from the signed session,
every database pool is the row-security-bound app role, and every table has row security. Every security-definer
function that takes an id either reads the workspace from the transaction or is keyed by a credential.

**Fixed in #255** (each guard broken on purpose fails its own test):
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

**Reported, then fixed on the owner's word (2026-10-09):**
- **R1 · An inbound e-mail reply is matched by the quoted message id and the From line,** and From can be forged.
  Someone holding a message id Nomi sent could add a message to that conversation, record e-mail consent and
  hand it to a person. Nothing is sent to anyone by it. This is the inbound mail path. **Fixed (#260, 0132):** a
  mail counts as its sender's only when the receiving server's own verdict confirms the From domain (DMARC, or
  an aligned DKIM or SPF pass); anything else is kept, marked, and handed to a person as `email_unconfirmed`.
- **R2 · The approve/edit route checks the window and the allowlist for the conversation in the address, not
  the draft's own.** It only matters inside one workspace, and the send gate still refuses anything that may not
  go. This is the approval path. **Fixed (#261):** a draft is acted on only from its own conversation's page,
  and the approval path refuses another conversation's draft too.

**Small, left as they are:** `advisor_may_keep` is granted to the app role without need (only a trigger calls
it; removing the grant is a migration). Quote-proof tokens are stored in clear, as their own key (256 bits).
The Meta webhook's set-up handshake compares its token with `===`. Kept edits and conversations are shared
within a workspace by design.

**The owner's, not code:** production's `OWNER_ACCESS_CODE` is 11 characters. A code of 20 or more random
characters makes guessing hopeless even with no limit. Paste a new one into Railway (nomi service); the old
one stops working at the next deploy.

## Items 2–8: what was found (2026-10-08)

### 2 · Third-party browser requests
- **The browser side is done.** Since 7 October a product's page draws only photos Nomi serves itself
  (`mayLoad`, D7), and the fonts are Nomi's own. A stored photo on another host is never fetched by the
  owner's browser.
- **The send side was F1, fixed (#262).** An image message would pass the stored photo address to Meta, which
  fetches it. Now a picture goes only from Nomi's own public https address (`servedByNomi`); anything else is
  refused as `media_unsupported`. Production holds no product photos and has never sent an image message.

### 3 · E-mails: an unsubscribe link and a postal address on every one
Nomi can send **14 kinds of e-mail**. None carries an unsubscribe link in its text, and none carries a postal
address. There is no launch or marketing mail feature.
- **Nomi's own postal address is not recorded anywhere.** PROGRESS has listed the operator's legal name, country
  and postal address as waiting on the owner. Every e-mail footer, the terms and item 8 need it.
- **The mail to the owner and the operator** (codes, password links, alerts, account and billing letters,
  operator notices) is transactional. With the address in hand, each can carry a footer:
  - Nomi's postal address;
  - for alerts, where to choose which alerts come by e-mail.

  This is not the send path.
- **The mail to a business's customers is the send path:** first e-mails, follow-ups and replies.
  - First e-mails and follow-ups carry the one-click unsubscribe headers and are refused without them.
  - None has a link in its text.
  - None carries the business's postal address, which businesses are never asked for. They have only a
    free-text "Location".

  **Fixed (#263, 0133):**
  - **The address:** a postal-address field on Settings, Business profile, written once by the owner. Its help
    says the business is the sender and owns the duty, and Nomi sends on its behalf.
  - **The footer:** every first e-mail and follow-up carries the business's name and postal address, and a
    visible per-recipient unsubscribe link, in the reader's language. The header stays.
  - **Refusals:** with no address, the mail is refused (`no_postal_address`) and Settings says what to add.
  - **Replies** get no footer.
  - **Unsubscribing:** an unsubscribe stops the follow-ups and any new first mail to that person.
  - **In production (2026-10-09):** no business has entered its address yet. The one workspace with the outreach
    area on sends no first e-mail or follow-up until it does. Nothing was waiting to go: no live sequence.
- **The privacy page said more than the code did.** It said every e-mail carries a link that stops more, and
  it was only a header. Since #263 it says what is true: every first e-mail and follow-up carries the
  business's postal address and the link, and a reply carries neither.
- **An unsubscribe stops first e-mails and follow-ups, not replies** to someone who wrote in. This looks
  intended; it is recorded here so it is a decision, not an accident.

### 4 · Stripe: the renewal terms beside the subscribe button — done
- **Beside the button,** in plain text and five languages:
  - the plan renews automatically, every month or year as shown, at its price, until cancelled;
  - it can be cancelled at any time under "Card and invoices".
- **Since #264 the line says monthly, and that a cancelled plan runs to the end of the month paid for.** This is
  true in code: Stripe's page opens only with Nomi's own portal configuration (cancel at period end, nothing
  prorated, no plan changes there), never the account's default.

### 5 · Policy pages in all five languages
- **Privacy and terms** exist in all five languages.
- **Cookies** have a page of their own, `/cookies` (#258), linked from the site's foot. It is the privacy page's
  own cookie section: the one table from the one cookie register, so the two pages cannot differ.
- **Refunds** have a page, `/refunds` (#264), in five languages, linked beside the subscribe button and from
  the site's foot. Its five clauses are the owner's:
  - the free trial;
  - cancelling;
  - part-used months;
  - if Nomi fails;
  - charged by mistake.

  **Monthly terms only.** The database refuses any other plan period (0134), and the operator's tool refuses a
  yearly price. Who provides Nomi is a code constant (`src/core/legal/operator.ts`), empty until the owner gives
  it; nothing stands in its place.
- **The trial on that page.** The trial clause is drawn from `self_serve_trial_days` and left out while it is
  empty.
  - **Empty in production** (2026-10-09), so the page shows no trial clause.
  - **The intended trial is one the customer requests.** That is `tools/billing.mjs grant-trial <business-id>
    --days N`, which writes `workspace_billing.trial_days` for one workspace. It is not the setting the page
    reads; confirm which one the page should draw from when the time comes.

### 6 · Accessibility — done
- **A sweep of every owner page as rendered** (180 pages, English and Arabic) found:
  - no image without alt text;
  - no control without a name;
  - no text under its contrast minimum;
  - no duplicate id.
- **Tabbing through the pages** showed a visible focus on every control. The faces' ring is on the face itself.
- **One field had only a placeholder:** the reply box on a conversation a person holds. It now has a name.

### 7 · No dark patterns, no hidden fees
- **Nothing found.**
  - No tick-box is ticked for anyone; each is ticked only when the person ticked it before.
  - No pressing or shaming words.
  - Prices are shown before a card is saved, and the trial is stated.
  - Saving a card charges nothing.
  - No tax is added by the code at checkout.
- **Cancelling is set in code since #264.** Stripe's page opens only with Nomi's own configuration, so the
  dashboard's settings no longer decide it. If Stripe refuses to open the page because the portal settings
  were never saved, the owner saves them once in the dashboard.

### 8 · A copyright agent for what people upload
- **What people upload:** product photos and price-sheet pages, voice notes, and files customers send.
- **What is needed:**
  - a designated agent, with a name and a postal address, registered with the US Copyright Office;
  - a "Copyright" section in the terms saying how to send a notice to that agent.
- **What waits on the owner:** the agent's details and the registration, which only the owner can do. The
  section is then written in five languages.

### The found-not-fixed items
- **F2 was already fixed on 2026-09-30** ("the hold is a turn"): the hold path writes a turn of its own, and the
  customer reaches "Needs you" at once, as "stopped". `tests/integration/assistant-stop.test.ts` holds it. This
  list carried it as open by mistake.
