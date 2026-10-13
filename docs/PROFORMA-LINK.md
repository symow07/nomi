# The proforma link (Phase 2c, migration 0151)

An order's proforma, as a page the customer opens. The owner makes the link from the conversation (beside the
order) or from the order's page. Making it sends nothing: the whole link appears for the owner to copy into the
conversation. The customer opens `/pi/<token>` with no sign-in, in the language they write in.

Code: `src/api/web/proforma.ts` (the page), `src/db/proformaLinks.ts` (the one writer), the routes in
`src/api/web/app.ts` (`/pi/:token`, `/app/orders/:id/proforma-link[/off]`). Tests:
`tests/parity/proforma-link.test.ts`, `tests/integration/proforma-link.test.ts`, and the kept order in
`tests/integration/erase-buyer.test.ts`.

The template was approved by the owner at the Phase 2c stop-gate on 2026-10-13, with the decisions below.

## What the page shows, and what it never shows

- **Shows:** the seller's name, and the postal address from the business profile (the one already printed on
  marketing e-mail, 0133) when there is one; the order's reference and date; "Bill to" with the customer's name;
  the product, its own article number, quantity, unit price and amount; the total; the sample credit as two lines
  (less the sample already paid, then the amount due), as on the text proforma; the delivery term; the payment
  terms in the owner's own words; one sentence saying it is not a tax invoice; where to ask questions.
- **Never shows:** the customer's e-mail, the order's notes, status history or tracking numbers, the
  conversation, any id, the pricing policy, or anything of Nomi (no mark, no colour, no link into the app). The
  renderer receives `ProformaView` and nothing else, and that type has no field for any of these.

## No bank details: on purpose, and staying that way

The page carries **no payment details**: no bank name, account number, IBAN, SWIFT/BIC, routing number or
payment link. The payment terms are words only ("30% deposit, 70% before shipment"). Nomi holds no bank details,
and none should be added here, however helpful it looks.

The reason is invoice fraud. The page is made to be forwarded: to whoever pays, to an accountant, into an
e-mail thread. Altered bank details on an intercepted quote or invoice are one of the most common B2B scams: the
fraudster copies the document, swaps the account, and the buyer pays the wrong party. A forwardable page that
carries payment details invites exactly that. Without them, the customer gets the account from the seller
through a channel they already trust, and confirms it with the seller directly.

`tests/parity/proforma-link.test.ts` holds it: the view has no payment-detail field, and no page in any language
names one. Changing this is the owner's decision, not a code change.

## Never indexed

The link is unguessable (32 random bytes), and it must never reach a search index even if it is posted
somewhere public. The page sends both `<meta name="robots" content="noindex, nofollow">` and the
`X-Robots-Tag: noindex, nofollow` header, plus `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
The parity test checks the meta tag and the route's headers; the integration test checks the headers on a real
response. This is the price link's rule (M35, `/p/:token`).

## Two proformas, two language rules (known; to align later)

- The **text proforma** on the order page (copy, or download as `.txt`) is in **English**, "as most buyers
  expect it" (`order.invoice.english`).
- The **link page** follows the **customer's language**: the language the analyser remembered for them, else the
  language of their latest message (`buyerLocale`, as the price page does).

The same order can therefore have an English text proforma and, say, an Arabic page. This can confuse someone
comparing the two. The owner's decision (2026-10-13): keep both as they are for now, and align them later, not in
Phase 2c. Whoever aligns them changes one rule in one place and updates this section.

## The rest of the rules

- **One live link per order** (`orders.proforma_token`). Making it is idempotent: a second tap returns the same
  link. Turning it off clears the token, and the page answers 404, byte for byte the page of a link that never
  existed. Making it again gives a new link. Both actions are written on the conversation's trail
  (`proforma_link_made`, `proforma_link_off`).
- **Fails closed.** The page exists only while the order has what a proforma needs, exactly as
  `proformaText` decides: a price, the owner's payment terms and a delivery term. An order that loses one stops
  opening (404), and its link is left as it was.
- **Who can make it.** Anyone who can see the order, like the `.txt` download: the figures are the order's own,
  already confirmed, and nothing about a price or going live changes.
- **Erasure.** A customer's erasure keeps their orders (0126) and clears the link with their e-mail and notes
  (0151's `erase_customer_rows`; `orders.proforma_token` is in the contract's `clear` list and in
  `tools/erase-buyer.mjs`).
- **Words.** The page's strings (`pi.*`) are in all five languages, and the zh/ar/es/fr lines are on
  `docs/NATIVE-REVIEW-UI.md` (not a gate).

## Not built (owner's decision, 2026-10-13)

How the link reaches the customer beyond the owner copying it: a "send it in the chat" button (the owner's own
message), or the assistant's order-confirmed reply carrying the link in place of "We'll send you the invoice
next" (a send-path change). Decide later.
