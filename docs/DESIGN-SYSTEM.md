# Nomi design system: the Split Today

For anyone building or reviewing a Nomi page in this look. The one page drawn in it so far is **Today**, as a preview: on
branch `design-split-today`, behind `SPLIT_TODAY=on`. With the flag off, nothing here is reached.

| What | Where |
|---|---|
| Tokens | `SPLIT_TOKENS` in `src/core/owner/tokens.ts` |
| Rules | `src/api/web/splitStyle.ts`, linked only by a page drawn with `body.split` |
| The page | `src/api/web/splitToday.ts` |
| Its figures | `src/db/splitToday.ts` |
| Tests | `tests/parity/split-today.test.ts`, `tests/integration/split-today.test.ts` |
| Screenshots | `docs/design/split-today/` |

To see it locally: `npm run build`, start the app with `SPLIT_TODAY=on`, then `node tools/split-preview.mjs seed` and
`shots` (the tool's header has the variables). It refuses any database but a local one.

## Tokens

### Colour

Each colour has one job. A colour used for anything else is a defect.

| Token | Value | Its job |
|---|---|---|
| paper | `#F7F3EE` | The page |
| surface | `#FFFDFA` | A panel |
| ink | `#25201C` | Text |
| washInk, washHalo | `#9C4F52`, `#B8767A` | The header's wash, nothing else |
| secondary | `#665D55` | Quieter text; the edge of an outlined button |
| border | `#E8E1D8` | Hairlines |
| neutral | `#EDE7DF` | A customer's initial; a plain chip; the rail's current page |
| jade | `#3F6B5C` | Money in, done. `jadeWash` `#E6EDE9` behind a chip |
| ochre | `#B8862F` | Waiting, overdue: marks, and the bold "1 overdue" |
| ochreText | `#7C5A14` | Waiting, overdue: any smaller text. `ochreWash` `#F6EEDC` behind a chip |
| wine | `#5A0A2E` | **The mark only** |
| magenta | `#9A0F5E` | **Send only**, with `onSend` `#FFFFFF` on it |

Contrast, measured:

| Pair | Ratio | Enough for |
|---|---|---|
| ink on paper | 14.60 | Any text |
| secondary on surface | 6.34 | Any text |
| secondary on neutral | 5.24 | Any text |
| jade on surface | 5.96 | Any text |
| jade on jadeWash | 5.09 | Any text |
| ochreText on surface | 6.21 | Any text |
| ochreText on paper | 5.71 | Any text |
| ochreText on ochreWash | 5.46 | Any text |
| white on magenta | 8.06 | Any text |
| ochre on surface | 3.19 | Marks, and bold text of 19 px or more. **Not small text** |

`ochreText` exists because of that last row: `#B8862F` is too pale for a 13 px line. It is the same hue, darker.

### Type

Two voices, both under the SIL Open Font License and served by the product (`assets/fonts/`, vendored by
`tools/fonts-split.mjs`). A page never fetches a font from anyone else.

| Voice | Latin | Arabic | Chinese | Used for |
|---|---|---|---|---|
| Serif | Newsreader | Noto Naskh Arabic | Noto Serif SC | Headings and big numbers: "Today", panel headings, a customer's name on the decision, the question, big money |
| Sans | Noto Sans | Noto Sans Arabic | Noto Sans SC | Everything else |

| Size (px) | Token | Used for |
|---|---|---|
| 44 (36 on a phone) | `title`, `titlePhone` | The page's title |
| 40 (34 on a phone) | `money`, `moneyPhone` | The one big figure, profit |
| 26 | `question` | The question on the decision card |
| 20 | `name` | Panel and section headings, a customer's name |
| 17 | `base` | Body |
| 15 | `small` | Rows, buttons, sub-headings |
| 13 | `caption` | Labels, days, "goes on Instagram" |

### Spacing and radius

Spacing is 4, 8, 12, 16, 20, 24, 32. There are no others.

Radius: panel 14, control 10, thumbnail 8, chip fully round.

## Panels

- A panel is a heading on the paper (a Solar icon, the serif name, "View all ›"), then **one flat sheet**.
- The sheet is the surface colour with a 1 px hairline. No shadow.
- Parts of a sheet are ruled apart by a hairline, never boxed apart.
- Desktop: Sales on the left, Books on the right, from 1100 px up. Below that, one column.
- A person who may not see the books gets Sales alone, in one column. So does a workspace with books off.

## The wash

Rose ink brushed on rice paper, behind "Today" (`inkWashDataUri` in `src/core/owner/brand.ts`; the owner's reference,
2026-11-04). It hangs from the top edge with a torn, watery foot, and fades to nothing downward and away to the far side.

- It appears once per page and runs edge to edge. It is 176 px tall and keeps its own proportions. Squeezed into the
  header, it turns into streaks.
- Right to left, it is mirrored so it stays behind the title. It is decoration; a time chart never is (see The trend).
- It is drawn from `washInk` and `washHalo`, a rose of its own. Wine stays the mark's and magenta stays Send's.
- It stays faint enough for AA. `tools/split-preview.mjs shots` hides the text and prints the worst pixel behind the
  title, the subtitle and the panel headings. The title and subtitle are ink, never secondary.

## Rows

One customer, one line, one door to the conversation: photo, name, product thumbnail, stage chip, value, days, chevron.

- The columns are fixed, so thumbnails and chips line up down the list.
- With no product photo, the thumbnail's place stays empty. A grey box looks like a picture that failed.
- With no value, the value's place stays empty. Never "$0".
- On a phone, a row takes two lines: name and value, then chip and days.
- The customer on the decision card is not listed again under it.

**Recent entries** (Books) use the same row: photo or initial, who, status chip, amount, date, chevron, opening the
invoice. It lists issued invoices and payments, newest first. A payment's chip says "Payment"; an invoice's says where it
stands. Green is settled, ochre is overdue, the rest are plain.

On a wide screen both columns end level. The sheets stretch to the taller one, and Recent entries shows as many whole rows
as the column has room for, at least five. Keyboard focus inside the list reveals the rest, so focus never lands on a
hidden row. Below 1101 px, where the panels stack, it shows five.

## Chips

A chip names a state in words. Never colour alone.

| Chip | Colour |
|---|---|
| Order | Jade on jadeWash |
| Waiting | ochreText on ochreWash |
| Asked, Price given, Sample | Secondary on neutral |

## Buttons

Nomi's rule stands: **a button changes something, a door goes somewhere.** A door is words with an arrow, never a box,
and `tests/parity/buttons-and-doors.ts` holds it. The one exception is a GET form with a button, for a move that is
drawn as a button: "New message" and "Remind".

| Kind | Look | Where |
|---|---|---|
| Send | Filled magenta, white words | **Once per screen**, and only for sending |
| Outlined | Surface, a secondary edge, ink words | Edit, Hand to me, New message |
| Outlined, small | The same at 36 px | Remind |

Every control is at least 44 px tall, except the small button. A focused control shows a 2 px ink outline.

## Avatars

- A customer's photo, when their channel gave one (`face()` in `src/api/web/faces.ts`).
- Otherwise a neutral initial: one colour for everyone, so no colour says anything about a person.
- Round, at 72 px on the decision (56 on a phone), 36 in a row, 32 beside an overdue customer.
- A name is never replaced by a photo. Both are always there.

Product thumbnails come from the catalogue's own photos (`product_images`). Square with a radius of 8, at 36 px on the
decision and 28 in a row.

## Stage strip

Asked → Price given → Sample → Order, this month, in the workspace's time zone.

- Each stage shows a dot, its word, its count, and its value where it has one.
- **Filled jade** means there is some. **An ochre ring** means one waits on someone. **An empty ring** means none.
  State is in the shape as well as the colour.
- Counted from real rows. A conversation marked "this is me testing" counts for nothing.
- **Sample** appears only for a business that sells by quantity, or where a customer really asked for one. Most shops
  have no samples.
- Right to left, the strip runs from the right.

## The trend

One line, one colour, no legend: profit so far this fiscal year, by month. Jade, 2 px, with a faint wash under it and
the latest month marked. Each point names its month and figure on hover, and the whole chart has a text label.

**A time chart never flips.** Time runs left to right on every page, Arabic included, with the newest month on the right.
Mirrored, a year of rising profit reads as a fall. The chart carries `dir="ltr"` and no transform; tests hold it. The stage
strip is a sequence, not a time chart, and does run from the right.

## The mark

The square seal from `assets/brand/`, reading "nomi", its "o" a cash coin. Inked in wine. It sits in the rail, and at the
head of the page on a phone, where the rail is gone. Use `markSmall` or `markDetail` (`src/core/owner/brand.ts`); never
redraw it.

## Phone

From 720 px down: Sales first, Books below, a tab bar at the foot.

- Five tabs: Today, Customers, Calendar, Books, Settings. Advisor moves to a door at the page's foot.
- With books hidden, Advisor keeps its tab.
- The rail's one number stays, on Customers.
- The page leaves room for the tab bar, so nothing is ever under it.

## Right to left

Arabic mirrors the whole page by logical properties alone. Two exceptions: the trend stays left to right, because time
charts never flip, and the wash is mirrored by hand to stay behind the title.

- Every figure goes through `show.*`, which isolates it (`src/api/web/values.ts`).
- A customer's name goes in `<bdi>`, not `dir="auto"`, so a Latin name still lines up with the page's edge.
- Arabic addresses nobody in a gender. Buttons are verbal nouns: إرسال, تعديل, التحويل إليّ.

## Do and don't

**Do**

- Show the words that will be sent. The owner decides on the reply itself, not on a summary.
- Keep every safety on the page: Hand to me, "How your assistant read this", the channel's time limit, every held notice.
- Say what a figure counts. "$7,250" on a summary is fine; the reply keeps "$7,250.00" exactly as written.
- Drop cents only where they are zero. "$1.45" stays.
- Read a screen as a cosmetics brand would, and as an online clothing store would.

**Don't**

- Don't flip a time chart right to left.
- Don't use serif for running text. It's for what a person says, headings and big numbers.
- Don't use a second magenta on a screen, or magenta on anything but Send.
- Don't use wine on anything but the mark.
- Don't use red. Overdue is ochre.
- Don't add a drop shadow, a watermark stamp or a repeating seal.
- Don't put a badge or stage in colour without its word.
- Don't invent a figure. A stage with nothing says nothing, and a panel with no data is left out.
- Don't let a button claim what it doesn't do. "Remind" opens the place to remind from; it sends nothing itself.
- Don't let a bell, a greeting or a tile back in without a page behind it.
