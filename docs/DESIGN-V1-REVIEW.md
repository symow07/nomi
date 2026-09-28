# V1 · a designer's pass over the result — 2026-09-24

Every owner page, first screen, at 390 and 1280 px, in en · zh · ar, on the
usability workspace (71 conversations, one handed, one draft). Looked at as
a reviewer, not as the person who built it; ranked by how much it hurts.
Nothing here is fixed yet. Screenshots in `docs/design/v1-review/`.

## 1 · The buyer's name stacks into three lines — on the three pages that matter most

`1-stacked-header-conversation-en-desktop.png`, `1b-stacked-header-buyers-zh-phone.png`

On Buyers, Customers and the conversation page the flag sits alone on a line,
the name on the next, and "· Nigeria" dangles on a third with a separator
leading it. Every width, every language. It is a regression from step four:
the People page's `.who` — a column that names someone — became a shell
family and the inbox, which used the same class name for an inline line, got
the column. I would have defended the family; the name collision is the
bug, and it hits the two pages the usability script opens first.

## 2 · The assistant's page shouts its caveat, and still has a face

`2-assistant-page-loud-caveat-and-face.png`

Two whole paragraphs in the waiting colour at title size — the disclosure
gate notice — are the loudest text on the page, louder than the choice they
qualify, with "Open" glued to the end of the second one as a link. Above
them, an emoji face in a jade circle, on the one page decision 4 says the
assistant is named, never drawn. Step three took the face out of the header
and left it here.

## 3 · Products: twelve cards, each mostly empty, each with the same two green marks

`3-products-twelve-cards-two-green-marks.png`

At 1280 px each product is a full-width card 120 px tall with 700 px of
nothing to the right; on a phone the twelve cards are a wall. Every card
carries "Learned ✓" and "Recognizable by photo" in the ok colour: a state
every item has is decoration, twenty-four times. Decision 2 says lists are
dense; this is the least dense list in the product.

## 4 · The stat row at desktop width: a figure, a word and a chevron a thousand pixels apart

`4-rows-stretched-at-desktop-today.png`

Today's "needs you" rows, the knowledge counts and Results all use the row
family, which has no measure of its own: at 1280 px the chevron sits at the
far right edge of a hairline that runs the whole column, and the label
floats a fixed distance from the figure. It reads as accidental. Today also
has no page title — its first heading is "Worth your attention", and
"Today" appears as a section heading halfway down, unlike every other page.

## 5 · An English draft right-aligned inside the Arabic page

`5-english-draft-right-aligned-in-arabic.png`

The proposal block isolates direction with `<bdi>` but inherits the page's
alignment, so a Latin sentence sits right-aligned against a right-hand
hairline. The same happens to a buyer's English bubble on the Arabic
transcript. A person's words should keep their own direction and edge.

## Noted, not ranked

- Setup's second row is "Log out", styled as a door between the language
  switch and Getting ready — arbitrary placement for the one action that
  ends the session.
- Knowledge shows four zero counts at 26 px: loud for nothing.
- Channels' four "not set up here" pills trail their labels at four
  different x positions.
- Practice and Knowledge have no page title; My business mixes a card-door
  with text doors.
- Two idioms of pill on People (jade "you", jade "online").

## Fixed — 2026-09-24, the same day

The owner's call on the five and the plainly-wrong ones:

1. The stacked header: the People column is `.person` now; `.who` is inline again everywhere.
2. The assistant's page: no face at all; the two caveats sit under the choice they qualify, as muted small text.
3. Products: a dense list of hairline rows, not cards; a mark appears only when something is NOT in order ("Needs a price", "Not recognizable by photo yet") — an absent mark means fine.
4. Rows and count lists keep the prose measure at 1280 px; Today has its title first and its insight rows under it.
5. A person's words keep their own direction: `dir="auto"` on every bubble and proposal.

Also: Practice and Knowledge have page titles; the four knowledge counts are the stat size; My business has one door idiom, the next step marked `next`.

Left, on purpose: "Log out" on Setup and channels' trailing pills wait on decision 5.

## Closed — 2026-09-28, the V1 close-out

Decision 5 was settled by the owner — the row stays as it is — and the two
left items went with the rest of the close-out. Screenshots in
`docs/design/v1-closeout/`.

- **Log out on Setup** — the last thing on the page, alone under a hairline,
  and a button (`btn ghost`, a form that posts to `/logout`): it ends the
  session, so it does something rather than going somewhere (decision 4).
  The language switch stays Setup's first row. `setup-*-phone.png`.
- **Channels' trailing pills** — the cause was the row family, not the page:
  `.row.lines` is a grid, and the row's `space-between` shrank its one column
  to the widest line, so each state sat wherever its name ended. The column
  is the row's width now and a spreading header reaches the row's end, so the
  four states line up at one edge in every language (`channels-accounts-*`).
- **The calendar's kind** — first built as the row's tag in its neutral form,
  then made its own choice the same day (Symow asked for one rather than a
  copy of the row): the first word of the entry's own line, "Negotiation ·
  Price worked out: …", after the name, never a pill (a pill in V1 is a state),
  and left out under a category tab. `docs/design/calendar-kind/`.
- **Buyers and Customers are one list** (A), in the row as it is; Buyers',
  Customers' and the conversation page's stylesheets are the shell's now.
