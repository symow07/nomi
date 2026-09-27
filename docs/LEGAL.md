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
  platform identifier, the time; for e-mail, the address and the thread.
- Who sees it: the business; Meta (carriage); Anthropic (drafting); Railway
  (hosting); Google or Microsoft when a mailbox is connected. Nobody else.
- How long: until the business asks for its records to be deleted, or the
  person asks for theirs.
- Deletion (CC-02a, 2026-09-27): the person asks the business — a message from
  the account they used — or writes to `LEGAL_CONTACT_EMAIL`, and **the
  operator passes it on to that business**. The business records it on the
  buyer's page (`/app/conversations/:id`), which writes a `deletion_requests`
  row (`scope = 'buyer'`). **The operator carries it out by hand within 30
  days of it being recorded.** When the row is closed as done, the business
  sees it on the buyer's page and on Your data and can tell the person; the
  product sends the person nothing, and the page says so.
- What is deleted: their identities on every channel; every message to or
  from them; drafts, quotes and sample requests written for them; notes and
  signals about their conversations; the conversations, except what an order
  needs. What is kept: their orders (items, prices, status history) detached
  from contact details and messages; a do-not-contact note if they asked not
  to be written to; the record that they asked and when it was done; Meta's
  own copies; anything the business keeps outside Nomi (its mailbox, files it
  exported); and copies inside backups until those backups are deleted.

`tests/parity/deletion-page.test.ts` holds every item above in all three
locales, holds the old promises out ("the same channel", a confirmation, an
instant or automatic deletion), and ties the 30 days to `DELETION_DAYS` and to
migration 0073. Change one, change all three.

### The deadline, and who hears of it

- The day a business records a request, a notice goes to `LEGAL_CONTACT_EMAIL`
  (ids and dates only — never the note, never the buyer's name).
- Every morning at 07:00 UTC the app asks `deletion_requests_due()` (0073, a
  definer function: business name, scope, asked-at, nothing else) for every
  open request within 7 days of its 30, or past them, across all businesses,
  and sends ONE `deletion_due` operator alert — by e-mail to the pilot owner's
  sign-in address always, by WhatsApp too where a channel is live. It repeats
  daily until each request is closed.

## Keeping the deletion promise

Nothing in the product deletes a person's data — by design, the app role holds
no `DELETE` on any product table (G20), so a deletion is an operator's act
with the migrate role, done once per request:

1. Find the person: `clients` (and `client_channels`, keyed by channel and the
   platform identifier) for the business that received the request.
2. Delete their `conversations`. Nearly everything hangs off a conversation
   with `on delete cascade` — messages, drafts, turns, events, outbound rows,
   signals, samples — so this is the bulk of it.
3. Delete the raw webhook payloads: `channel_events` rows whose
   `conversation_external_id` names the identifier (`<channel>:<sender>:<account>`).
4. Delete the `client_channels` and `clients` rows. `contacts` and
   `suppressions` rows for an e-mail address go too, unless the person asked to
   be left alone — a suppression is the record that keeps that promise, and
   the page says so.
5. Take a backup before, verify after (`docs/BACKUP-RESTORE.md`), then close
   the request (`state = 'done'`, `closed_at`, `closed_by`). The business
   sees it done and tells the person; the product does not write to them.

What stays, and the page says so: an invoice or order the business must keep
by law (leave `orders` rows for a confirmed order; the conversation they came
from may still go), and anything Meta holds on its own side.

## Publishing the app (Meta)

`App settings → Basic` needs: Privacy policy URL `https://app.nomidoes.com/privacy`,
Data deletion instructions URL `https://app.nomidoes.com/data-deletion`, a
category, and an icon. Then App Mode → Live. In Live mode with standard
access, only people with a role on the app can message it until App Review
grants `instagram_manage_messages` / `pages_messaging` for everyone.
