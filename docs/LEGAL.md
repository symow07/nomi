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
- How long: while the business uses the product; sooner on request.
- Deletion: a request from the account used, or to `LEGAL_CONTACT_EMAIL`;
  **removal within 30 days**, confirmed on the same channel; what the law
  makes the business keep (an invoice) and Meta's own copies stay.

A parity test (`tests/parity/legal-pages.test.ts`) pins the thirty days in
all three locales to the number written here. Change one, change both.

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
5. Take a backup before, verify after (`docs/BACKUP-RESTORE.md`), and confirm
   to the person on the channel they asked on.

What stays, and the page says so: an invoice or order the business must keep
by law (leave `orders` rows for a confirmed order; the conversation they came
from may still go), and anything Meta holds on its own side.

## Publishing the app (Meta)

`App settings → Basic` needs: Privacy policy URL `https://app.nomidoes.com/privacy`,
Data deletion instructions URL `https://app.nomidoes.com/data-deletion`, a
category, and an icon. Then App Mode → Live. In Live mode with standard
access, only people with a role on the app can message it until App Review
grants `instagram_manage_messages` / `pages_messaging` for everyone.
