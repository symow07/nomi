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
| 0 | **IDOR audit.** Every route that takes an id or a token: can one business, or one person, reach another's? | First | Done (#255); two findings reported, below |
| 1 | **Age at sign-up (COPPA).** An age field on the sign-up form. | Launch-blocker | Done (#256, migration 0131) |
| 2 | **Third-party browser requests.** The fonts are already served by Nomi. Still open: stored product-photo addresses, and the addresses passed to Meta on sends (the send path: report first). | Launch-blocker | Browser side done (D7); the send side is F1, reported |
| 3 | **E-mails.** An unsubscribe link and a postal address on every outbound e-mail, launch and marketing mail included. | Launch-blocker | Waits on the owner: Nomi's postal address. Customer mail is the send path, reported |
| 4 | **Stripe.** The renewal terms shown next to the subscribe button. | Launch-blocker | Done (#257) |
| 5 | **Policy pages.** Privacy, terms, cookies and refunds, each in all five languages. | Next | Privacy, terms and cookies done in all five (cookies: #258); the refund policy waits on the owner |
| 6 | **Accessibility.** Alt text, contrast and keyboard navigation. | Next | Done (#257) |
| 7 | **No dark patterns and no hidden fees.** | Next | Nothing found; the owner confirms Stripe's portal allows cancelling |
| 8 | **A copyright agent for what people upload.** | Next | Waits on the owner: the agent's details and registration |

**And two items found earlier, not yet fixed (both on the send path: report first):**

| # | What | Status |
|---|---|---|
| F1 | **Product-photo addresses passed to Meta on sends.** The same thing as the second half of item 2. | Reported; dormant (no photos, no image sends) |
| F2 | **Stop pressed while a customer's batch is still waiting.** The hold path fails because `markFragmentsProcessed` writes `processed_in`, which references `turns`, and the hold path writes no turn. The job dead-letters, and the customer reaches "Needs you" as `not_answered` about five minutes later instead of as "stopped". | Reported; the fix is proposed |

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

## Items 2–8: what was found (2026-10-08)

### 2 · Third-party browser requests
- **The browser side is done.** Since 7 October a product's page draws only photos Nomi serves itself
  (`mayLoad`, D7), and the fonts are Nomi's own. A stored photo on another host is never fetched by the
  owner's browser.
- **The send side is F1.** An image message would pass the stored photo address to Meta, which fetches it.
  Production holds **no product photos** and has **never sent an image message**, so this is dormant, not live.
  The fix is on the send path: only send a photo Nomi serves. The owner decides.

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

  The fix: a postal-address field for the business, and a footer with the unsubscribe link and that address
  on first e-mails and follow-ups. The owner decides.
- **The privacy page says more than the code does.** It says every e-mail the business sends carries a link
  that stops further mail. Today it is a header, not a link. This goes with the data-protection batch, or with
  the fix above.
- **An unsubscribe stops first e-mails and follow-ups, not replies** to someone who wrote in. This looks
  intended; it is recorded here so it is a decision, not an accident.

### 4 · Stripe: the renewal terms beside the subscribe button — done
- **Beside the button,** in plain text and five languages:
  - the plan renews automatically, every month or year as shown, at its price, until cancelled;
  - it can be cancelled at any time under "Card and invoices".
- **Whether a cancelled plan runs to the end of its period** is set on Stripe's own portal, and nothing here
  promises either.

### 5 · Policy pages in all five languages
- **Privacy and terms** exist in all five languages.
- **Cookies** have a page of their own, `/cookies` (#258), linked from the site's foot. It is the privacy page's
  own cookie section: the one table from the one cookie register, so the two pages cannot differ.
- **There is no refund policy.** What is refunded, when and how is the owner's to decide. It is then written in
  five languages and linked beside the subscribe button.

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
- **For the owner to confirm:** that Stripe's customer portal lets an owner cancel. It is set in Stripe's
  dashboard, under the customer portal's settings, not in this code.

### 8 · A copyright agent for what people upload
- **What people upload:** product photos and price-sheet pages, voice notes, and files customers send.
- **What is needed:**
  - a designated agent, with a name and a postal address, registered with the US Copyright Office;
  - a "Copyright" section in the terms saying how to send a notice to that agent.
- **What waits on the owner:** the agent's details and the registration, which only the owner can do. The
  section is then written in five languages.

### The found-not-fixed items
- **F2, Stop pressed while a customer's batch is waiting,** still dead-letters to `not_answered`. This is the
  send path.
  - The fix: the hold path writes a turn row of its own, so `processed_in` has something to point at.
  - The customer then reaches "Needs you" at once, as "stopped".
  - The owner decides.
