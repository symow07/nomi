# UI correction — Block 1: the direction, on four pages

Block 1 of the UI/UX correction (the owner's direction of 2026-11-13): the shared foundations and the four priority
findings (F12, F18, F21, F29). Later blocks carry the system through every other page. The findings table and the
every-page inventory are kept in the owner's private notes, not in this repository.

All images are a local instance with synthetic data only (the demo workspace plus `tools/split-preview.mjs seed`, and
three synthetic customer messages for Knowledge). No provider was contacted for them; nothing was sent. English owner
UI. Desktop is 1440×900, phone is 390×844 (browser emulation, not a physical phone). "before" is `84cb4580`; "after" is
this branch. `SPLIT_TODAY` changes nothing since the redesign (no renderer reads it), so both flag states draw these
same pages; the instance ran with it off.

| Page | Desktop | Phone |
|---|---|---|
| Inbox | [before](inbox-desktop-before.png) · [after](inbox-desktop-after.png) | [before](inbox-phone-before.png) · [after](inbox-phone-after.png) |
| Conversation, a reply waiting (F12) | [before](conversation-desktop-before.png) · [after](conversation-desktop-after.png) | [before](conversation-phone-before.png) · [after](conversation-phone-after.png) · [after, landing on the newest message as the Inbox's rows do](conversation-phone-latest-after.png) |
| Books home | [before](books-home-desktop-before.png) · [after](books-home-desktop-after.png) | [before](books-home-phone-before.png) · [after](books-home-phone-after.png) |
| New invoice (F18) | [before](invoice-new-desktop-before.png) · [after](invoice-new-desktop-after.png) · whole page [before](invoice-new-desktop-full-before.png) · [after](invoice-new-desktop-full-after.png) · [a saved draft's edit form](invoice-edit-desktop-after.png) | [before](invoice-new-phone-before.png) · [after](invoice-new-phone-after.png) · whole page [before](invoice-new-phone-full-before.png) · [after](invoice-new-phone-full-after.png) |
| Advanced entry (F21) | [before](entry-new-desktop-before.png) · [after](entry-new-desktop-after.png) · [after, an account chosen](entry-new-chosen-desktop-after.png) | [before](entry-new-phone-before.png) · [after](entry-new-phone-after.png) |
| Knowledge, a long message (F29) | [before](knowledge-desktop-before.png) · [after](knowledge-desktop-after.png) · whole page [before](knowledge-desktop-full-before.png) · [after](knowledge-desktop-full-after.png) | [before](knowledge-phone-before.png) · [after](knowledge-phone-after.png) · whole page [before](knowledge-phone-full-before.png) · [after](knowledge-phone-full-after.png) |

## Measured

| | Before | After |
|---|---|---|
| Knowledge, page wider than the window (1440 / 390) | 5,639 px / 6,153 px | 0 / 0 |
| New invoice, page height (1440 / 390) | 4,151 px / 5,623 px | 1,001 px / 1,428 px |
| Conversation, the draft's box from the top (1440) | 643 px | 435 px; Send at 519 px; the page itself no longer scrolls |
| Conversation on a phone, landing on the newest message | — | draft 449–580 px, Send and Hand to me 588–634 px, above the tab bar (775 px) |
| Advanced entry, narrowest account / currency select (1440) | 40–68 px (the audit's measure) | 179 px / 74 px, no scrolling; from 1280 px down the table scrolls inside its own frame |
| Advanced entry on a phone | a 1,234 px table in a 389 px form | one labelled group per line, 346 px fields, no sideways scroll; the page is long (5,433 px for eight lines) |

## The foundation

- Canvas `#FAFAF9`, surfaces `#FFFFFF`, ink `#171717`, secondary ink `#5E5E5A`, separators `#E4E4E1`, a quiet recess
  `#F1F1EF`, a control's edge `#8A8A86`. Contrast (WCAG): ink on surface 17.9:1, on canvas 17.2:1, on the recess 15.9:1;
  secondary ink 6.5:1, 6.2:1 and 5.8:1; a control's edge 3.5:1 on surface and 3.3:1 on canvas; the accent `#9A0F5E`
  8.1:1 and 7.7:1; the green `#3F6B5C` 6.0:1 (`tests/parity/warmth-pass.test.ts`
  and `palette.test.ts` compute them).
- Magenta is the seal, the small dot before what waits, and the rail's count. Links, chosen tabs, where you are, focus
  rings, selections, fields and the assistant's draft are ink and neutral.
- One sans (the vendored Noto set, per-language order unchanged) for titles, names and what people say. One page-title
  role: 26 px semibold, 24 px on a phone. Figures are tabular on every signed-in page.
- Buttons: the primary act is the one ink fill; a secondary is white with a 1 px edge; a consequential act has a heavy
  ink edge and weight. No red.
- Corners: control 8, card 12, panel 16. Rail icons 20 px in a 48 px target.
- The public pages (website, legal, customer documents, web chat) keep their previous tokens until their own block.

## Not done here

- A running total while typing a new invoice: the form says the total is worked out on save, and a saved draft's edit
  form shows the figures the books saved. A live total needs either the books' tax arithmetic repeated in the page or a
  preview route — a decision, not made in this block.
- The pending state's label and size during a slow save were not observed (one request left for two presses was).
- Phone keyboard and touch behaviour on a physical device.
- Every other page: its own block.
