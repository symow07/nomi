# The legal pages, and what they oblige the operator to do

Three public pages live at `/privacy`, `/data-deletion` and `/terms`
(`src/api/web/legal.ts`, strings under `legal.*` in the catalogue, three
locales). The terms are the BUSINESS's — what it accepts by using the product,
which is who Meta's "Terms of Service URL" is about — and say in their first
paragraph that the people who write in are covered by the privacy page instead. They exist because Meta reads both before an app may leave
development mode — and Instagram messages are delivered only to a published
app — and because a person who writes to a business through this product is
owed a plain answer to "what do you keep about me, and how do I make you stop".

They speak to **the people who write in** (buyers), not to the business that
runs the product. The draft terms for the business itself are in
`docs/legal/` (Chinese, pilot-era; it still names Supabase, which
`docs/SUPABASE-EXIT-AUDIT.md` records leaving) and are not served anywhere.

## What the pages promise

- What is kept: the message, attachments, the sender's display name and
  platform identifier, the time; for e-mail, the address and the thread; for
  an Instagram or Messenger customer, their profile photo as the platform
  shows it (0123 `client_faces`, looked at again every 30 days), so the
  business sees their face.
- Who sees it: the business; Meta (carriage); Anthropic (drafting); Railway
  (hosting); Google or Microsoft when a mailbox is connected. Nobody else.
- How long (0126, the owner's direction of 2026-10-04): for as long as the
  business uses Nomi; deleted when the person asks the business, or when the
  business closes its workspace, which erases everything in it. Never "after
  90 days": RET (0116) is retired.
- Deletion (0126): the person asks the business — a message from the account
  they used — or writes to `LEGAL_CONTACT_EMAIL`, and **the operator passes it
  on to that business**. **The business deletes it, at once and for good**:
  "Delete this customer's data now" on the customer's page or Your data
  records the request and erases in one transaction (`erase_customer`). There
  is no public form, and the page says why: only the business knows which
  conversation is the asker's, and a form anyone could fill in could erase
  someone else. The product sends the person nothing, and the page says so.
  A request recorded before 0126 and still open is carried out the same way
  by the owner, or by the operator (`tools/erase-buyer.mjs`).
- What is deleted: their identities on every channel; their profile photo;
  every message to or
  from them; drafts, quotes and sample requests written for them; notes and
  signals about their conversations; the conversations, except what an order
  needs. What is kept: their orders (items, prices, status history) detached
  from contact details and messages; a do-not-contact note if they asked not
  to be written to; the record that they asked and when it was done; Meta's
  own copies; anything the business keeps outside Nomi (its mailbox, files it
  exported); and copies inside backups until those backups are deleted (the
  owner's sentence, public-missed-21, unchanged). And: if the service is ever
  restored from a backup, every deletion made since is carried out again
  before it runs (`erasure_ledger`, `tools/replay-erasures.mjs`,
  `docs/BACKUP-RESTORE.md` "Restore" step 5).
- A closed workspace (0126): the owner types its name on Your data; everything
  in it is erased at once (`close_workspace`) and everyone is signed out; an
  ids-only line in `erasure_ledger` is all that is left.

`tests/parity/deletion-page.test.ts` holds every item above in all five
locales, and holds the old promises out ("the same channel", a confirmation,
an automatic deletion, an operator by hand within 30 days). The 30 days are now
only the operator's safety net for a request still open (`DELETION_DAYS`,
migration 0073), never a promise on any page.

### The deadline, and who hears of it

- Each erasure the owner carries out mails its ledger line to
  `LEGAL_CONTACT_EMAIL` (ids only — never the note, never the buyer's name):
  keep those mails, they are a copy of the ledger outside the database.
- The installation's own workspace asking to be erased: a notice goes to
  `LEGAL_CONTACT_EMAIL` the day it is asked (ids and dates only).
- Every morning at 07:00 UTC the app asks `deletion_requests_due()` (0073, a
  definer function: business name, scope, asked-at, nothing else) for every
  open request within 7 days of its 30, or past them, across all businesses,
  and sends ONE `deletion_due` operator alert — by e-mail to the pilot owner's
  sign-in address always, by WhatsApp too where a channel is live. It repeats
  daily until each request is closed.

## Keeping the deletion promise

Since 0126 the product keeps it itself, and the app role still holds no
`DELETE` on any product table (G20): the owner's two buttons call two definer
functions (`erase_customer`, `close_workspace`) that take the workspace from
the transaction, check that the person is its owner, and carry out exactly the
contract the operator's tools carry out — the tools call the same functions.
What goes and what stays, table by table, is `tools/erase-buyer.mjs`'s RULES,
which the database states as `customer_erasure_contract()`; a table nobody
classified stops every erasure by name (`customer_erasure_problems()`).
`docs/DATA-DELETION-RUNBOOK.md` is the operator's part: a request still open
from before 0126, the installation's own workspace, and the replay after a
restore.

## Publishing the app (Meta)

`App settings → Basic` needs: Privacy policy URL `https://app.nomidoes.com/privacy`,
Data deletion instructions URL `https://app.nomidoes.com/data-deletion`, a
category, and an icon. Then App Mode → Live. In Live mode with standard
access, only people with a role on the app can message it until App Review
grants `instagram_manage_messages` / `pages_messaging` for everyone.
