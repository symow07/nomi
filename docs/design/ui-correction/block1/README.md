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
  The sign-in pages (sign in, access code, sign up, forgotten password) are not among them: they share the app's
  tokens and took the new canvas, field edge and corners with it (see the second fix round).

## The fix round (same day)

- **The invoice's total while it is filled** ([after](invoice-new-total-desktop-after.png)): the form asks a preview route as its
  lines change (400 ms after the last change, one question at a time) and shows Before tax, Tax and Total with the
  currency. The route reads the form exactly as Save does and answers from the one function Save uses for a line's
  figures; it writes nothing. A form Save would send back for its lines reads "cannot be worked out yet". Without
  script the form reads as before. `tests/integration/books-invoice-pages.test.ts` holds the preview equal to what the
  database stores after the same form is saved (tax, several lines, a tax that rounds).
- **Send on a phone**: Send and Hand to me rest just above the tab bar while any part of the reply is on the screen.
  390×844: [top of the page](conversation-phone-390-top-after.png) Send 721–767, [newest message](conversation-phone-390-latest-after.png)
  597–643, bar at 775; no scroll position puts them under the bar. 320×568: [newest message](conversation-phone-320-latest-after.png)
  445–491, bar at 499; at the [top of the page](conversation-phone-320-top-after.png) the reply is still below the screen.
  While scrolling at 320 px the reply's head emerges from behind the bar for about 120 px, as all content does.
- `node tools/pre-pilot.mjs --scripted`: 14 of 14 on `84cb4580` and 14 of 14 on this branch.

## The second fix round (after an independent test of `44835003`)

Seven failures were found by the tester and fixed here; each line gives the measure before and after, taken in the
running app (Chromium emulation; no physical phone). `fix2-*` images are the "after".

- **The stuck Send row covered the reply.** Before: the row hid 54 of the box's 131 px at the top of the page on
  390×844, left 29 px readable at the newest message on 320×568, and hid 54 of 77 px at 200 % zoom (82 % at worst).
  Now what the reply is, why it waits, the reply and its two answers are one block that rests whole above the tab bar,
  as a chat's writing box does; the head and the thread scroll above it. After: 0 px of the box under the row at every
  scroll position at all three sizes; Send under the bar at 0 of 49, 0 of 94 and 0 of 69 positions (320 and 200 % had
  11 each); at the newest message nothing is under the block at any of the three; the desk is unchanged.
  [390 top](fix2-f1-conversation-390-top.png) · [390 newest](fix2-f1-conversation-390-latest.png) ·
  [390 typing](fix2-f1-conversation-390-typing.png) · [390 Arabic](fix2-f1-conversation-390-latest-ar.png) ·
  [320 top](fix2-f1-conversation-320-top.png) · [320 newest](fix2-f1-conversation-320-latest.png) ·
  [200 % top](fix2-f1-conversation-zoom200-top.png) · [200 % newest](fix2-f1-conversation-zoom200-latest.png) ·
  [desk](fix2-conversation-desktop.png).
  **Still open:** the block rests over whatever of the page is behind it, as a chat's writing box does, and the page
  scrolls to show it. At the very top of the page that can be the end of the head or of the thread: at 320×568 and
  at 200 % zoom the head is taller than the room above the block, so its lower rows and the first message are under
  the block until the page is scrolled 100–190 px; at 390×844 in Arabic the newest message's time line is. Landing on
  the newest message (as the Inbox's rows do) shows the message, the block and nothing under it at all three sizes.
  Tapping the box scrolls the page to the block's own place (the browser's doing).
- **A control's edge under 3:1.** Hand to me and No reply needed, Today's reply box, the Inbox's search field and Ask
  Nomi's question box were 1.27:1 (1.22:1); each is the control edge now (3.5:1 on white, 3.3:1 on the canvas). A
  sweep by computed style over 47 signed-in pages at 1440 and 390 found 5 before and 0 after.
  [Today](fix2-f2-today-reply-box.png) · [Inbox](fix2-f2-inbox-search.png) · [Ask Nomi](fix2-f2-ask-box.png).
- **Disabled looked enabled.** A button that cannot be pressed is the recess's sand with a faint edge, its word in the
  secondary ink (5.8:1 — readable, not faded by opacity) and the not-allowed cursor, on every signed-in page.
  [The invoice form with no customer](fix2-f3-invoice-no-customer-desktop.png) · [its Save](fix2-f3-save-disabled.png).
- **A waiting button grew.** Send 90 → 106 px and Save the draft 140 → 157 px while a request was held; now 90 → 90
  and 140 → 140 (the dots sit in the button's own padding), one request for three presses.
  [Send, waiting](fix2-f4-pending-send.png).
- **A price or quantity below zero.** Before: the total read `$-10.00` and Save answered an error page. After: the
  total "cannot be worked out yet", Save comes back with "Line 1: the price cannot be below zero." and every typed
  value kept, nothing written. The form refuses exactly what the table refuses (a quantity must be above zero; a
  price may be zero). [the form sent back](fix2-f5-negative-422.png) · [before saving](fix2-f5-negative-preview.png).
- **The Advanced entry's account name was cut** ("6330 · Clients et comp" in 140–155 px of room; a seven-figure
  amount clipped in 58–63 px). Each line is now a labelled group at every width, the account on its own line; a
  choice still wider than its box is written out in full under it. After, English and Arabic, at 1440 / 1280 / 1024 /
  820 / 390 / 320 / 200 %: account room 906 / 746 / 698 / 494 / 320 / 250 / 650 px, amounts 114–308 px of room for
  101 px of figures, page overflow 0, nothing scrolling sideways.
  English [1440](fix2-f6-entry-en-1440.png) · [1280](fix2-f6-entry-en-1280.png) · [1024](fix2-f6-entry-en-1024.png) ·
  [820](fix2-f6-entry-en-820.png) · [390](fix2-f6-entry-en-390.png) · [320](fix2-f6-entry-en-320.png) ·
  [200 %](fix2-f6-entry-en-zoom200.png); Arabic [1440](fix2-f6-entry-ar-1440.png) · [820](fix2-f6-entry-ar-820.png) ·
  [390](fix2-f6-entry-ar-390.png) · [320](fix2-f6-entry-ar-320.png).
- **The sign-in pages.** These notes said they kept their tokens; they did not. They take the app's new tokens, and
  that is accepted as the direction. Checked at 1440×900 and 390×844 in English and Arabic (sign in, access code,
  sign up, forgotten password, and a wrong code): no text under AA, no control edge under 3:1, every focus stop
  ringed at 2 px (7.1:1 at least), no sideways overflow.
  [sign in](fix2-f7-door-en-1440-login.png) · [access code](fix2-f7-door-en-1440-login-with-code.png) ·
  [a wrong code](fix2-f7-door-en-1440-login-with-code-wrong-code.png) · [sign up](fix2-f7-door-en-1440-signup.png) ·
  [forgotten password](fix2-f7-door-en-1440-login-forgot.png) · phone [sign in](fix2-f7-door-en-390-login.png) ·
  [sign up](fix2-f7-door-en-390-signup.png) · Arabic [sign in](fix2-f7-door-ar-1440-login.png) ·
  [phone](fix2-f7-door-ar-390-login.png) · [a wrong code](fix2-f7-door-ar-390-login-with-code-wrong-code.png) ·
  [sign up](fix2-f7-door-ar-390-signup.png) · [forgotten password](fix2-f7-door-ar-390-login-forgot.png).
  The website and the four legal pages are byte for byte what `84cb4580` serves, in five languages (25 of 25).
- Also: buttons answer the pointer ([Send](fix2-hover-send.png), [Hand to me](fix2-hover-hand-to-me.png)); the
  conversation head's "More" is in the owner's language ([Arabic](fix2-more-ar-390.png)).

## Not done here

- Phone keyboard and touch behaviour on a physical device.
- The Advanced entry's long phone page and its mid-width table scroll: with the accounting tables, in the Books block.
- Every other page: its own block.
