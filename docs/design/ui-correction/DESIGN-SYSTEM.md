# Nomi's design system, as shipped

Written at the end of the UI correction (Block 9) from the code on `ui-block9-finish`, not from a brief. Each section
names the files it was read from. When this page and the code disagree, the code is right and this page is out of date.

The values live in `src/core/owner/tokens.ts`. `src/core/owner/css.ts` (`cssVariables()`) turns them into CSS custom
properties, and every stylesheet uses them as `var(--…)`. Two palettes ship:

- `DESIGN_TOKENS` for every signed-in (owner) page.
- `PUBLIC_TOKENS` for the door, the legal pages and the site.

A literal colour in `src/api/web/*.ts` fails the parity tests.

## 1 · Values

**Colour (owner pages)**

| Name | Value | Use |
|---|---|---|
| `--color-ink` | `#171717` | Text, the primary act's fill, the focus ring |
| `--color-ink-secondary` | `#5E5E5A` | Captions, labels, a state's sentence |
| `--color-surface` | `#FFFFFF` | Working surfaces, secondary buttons |
| `--color-paper` | `#FAFAF9` | The canvas |
| `--color-sand` | `#F1F1EF` | Quiet panels (a state block, a fact cell) |
| `--color-border` | `#E4E4E1` | Separators |
| `--color-control-line` | `#8A8A86` | A field's or a quiet button's edge (3.5:1 on surface) |
| `--color-ok` | `#3F6B5C` | Success, always with its tick and its word |
| `--color-brand` / `--color-needs` | `#9A0F5E` | A sparse accent: the seal, the dot before something that waits, the rail's one count |

- On owner pages `--color-brand` resolves to the ink (`colorRole`), so the primary button is near-black.
- Magenta is never a link, a fill, a wash or a border.
- There is no red: a consequential act is told apart by weight and edge, not hue.
- Measured contrast pairs are in the comment above `color` in `tokens.ts`; `warmth-pass.test.ts` holds them.

**Type.** One family order per language: Noto Sans, Noto Sans SC or Noto Sans Arabic first, then the other two, then
`system-ui`. The voice (anything a person says: a draft, a customer's quoted words) is the matching Noto Serif or Noto
Naskh Arabic. The type pass on 2026-10-04 set which role wears which size:

| Size | Role |
|---|---|
| caption 13 | Times, captions (secondary ink) |
| small 15 | Labels, rows, buttons |
| base 17 | Reading text and fields |
| title 20 | Section headings, a state's heading (semibold) |
| display 26 | Every page title (semibold, since F01); 24 on a phone |
| hero 34 | Not used on owner pages |

- Weights: 300 for large quiet figures only (20 px and up), 400, 500, 600 and 700. Nothing under 400 at 15 px or
  smaller.
- Line height is set per script: en / es / fr 1.6, zh 1.7, ar 1.75.
- Headings use a tight line height: 1.2, 1.35 and 1.45 respectively.
- Latin headings track in by -0.02em; Chinese and Arabic never take tracking.

**Space, measure and corners**

- Space: `--space-4 … --space-48`, named by value (4 8 12 16 20 24 32 40 48).
- Measure: column 1040px, prose 62ch, form 40ch.
- Corners: `--radius-control` 8, `--radius-card` 12, `--radius-panel` 16 and `--radius-chip` 999. They are the only
  corners allowed. The public palette uses 12 / 16 / 20.
- No shadows: `lift1` and `lift2` are `none`.

## 2 · Buttons and links (`layout.ts` `.btn`; audit F06)

Three acts, told apart in greyscale. Every one is at least 44 px tall.

- **Primary** `.btn.send`: the one filled button, ink with a white label, semibold. A page has at most one.
- **Secondary** `.btn`: white, with a 1 px `--color-control-line` edge, medium weight. On hover it turns sand with an
  ink edge.
- **Consequential** `.btn.danger` (remove, stop, close): white with a 1.5 px ink edge and semibold. It is never filled
  and never red. It asks first (`data-confirm`).
- **Quiet** `.btn.ghost` has no edge. `.deeper` is a link that opens a page.
- A link inside a sentence may be shorter than 44 px (WCAG 2.5.8's inline exception). A standalone link may not.
- **Focus**: every focusable thing on an owner page shows a 2 px solid ink outline offset by 2 px
  (`.owner-shell :focus-visible`, `splitStyle.ts`). `auto` and coloured rings fail the sweep.

## 3 · Fields and controls

- Text fields, selects and textareas: white, a 1 px `--color-control-line` edge, `--radius-control` corners,
  ink text, and the page's font.
- Checkboxes and radios use the accent colour. Their 44 px target is the label that wraps them.
- In right-to-left pages every `<option>` is isolated (`isolateOptions`, `values.ts`).
- A field's error is announced as an alert and kept beside its field; the submitted words stay in the form.

## 4 · Filters (`filterBar.ts`, `filterBarStyle.ts`; F07)

Every filtered list uses the one bar (`.fbar`).

- Each field is a `<label>` that wraps its words and its control, so the two can never part.
- Every control and both actions are 44 px tall, bottom-aligned on one line.
- The search is always in view. The other filters sit in `details.fbar-more`:
  - on a desk it is open and its summary is not drawn;
  - on a phone a "Filters" button opens it, with the number of filters that are on;
  - without the script nothing is hidden.
- "Show results" is a secondary act; a filter is never the page's primary act.

## 5 · Long lists (`listsStyle.ts`, `rows.ts`; F09)

- Customers, Products, Orders and Invoices name their columns once, above the rows, from 1100 px up.
- Figures are end-aligned in tabular digits.
- Each row keeps its keys for a screen reader. On a phone it shows them, and a row is two or three lines.
- A figure's column is as wide as its widest figure, and the other cells wrap beside it, so a long amount is never
  drawn over a date. Up to 600 px an invoice card has two columns: what it is on the start side, its figures on the
  end side, one per line.
- A pager link is 44 px both ways, above the list and below it.
- A list longer than one page has its pager above and below.
- A page with nothing on it draws no range: never "0–0 of 0" (F47).

## 6 · Records: read first, change on purpose (`editFold.ts`, `editFoldStyle.ts`; F10)

- A record's independent parts each read as a short list of facts (`factList`; an empty value reads "Not given yet").
- A part's form sits behind its own "Change …" fold, with the part's own Save and a Cancel.
- A fold is open at rest only when the part still needs something, or when a save was refused (the words are kept).
- Cancel puts the form back as drawn, closes it and returns focus to its summary.
- Escape closes the fold and keeps what was typed.
- Without the script there is no Cancel: it stays `hidden` until the script shows it, so no button does nothing. The
  summary still opens and closes the fold, and Save still saves.
- An optional creation form is closed at rest.

## 7 · States (`stateBlock.ts`, `stateBlockStyle.ts`; F47)

A page in a state draws `section.state[data-state=<kind>]`: one heading, one sentence of why and one next step (a link
or a button, 44 px).

- **Kinds**: `empty`, `nomatch`, `loading`, `error`, `forbidden` and `unavailable`.
- **Where each is drawn**:
  - `empty` and `nomatch`: Customers, Orders, Products, Saved replies, Invoices, Labels, the advisor's history, the
    gaps, the bank lines and the reports.
  - `unavailable`: Billing, a channel this installation does not offer, a record that is not here (`missingPage`),
    a product that is not here (`renderProductMissing`), a mistyped `/app` address while signed in
    (`notFoundInside`), and an address that leads nowhere (`errorPage`, `notfound`).
  - `error`: a page that broke (`errorPage`, `crash`, with its reference).
  - The two door pages carry the kind on their card (`main.card[data-state]`). They keep the door's own sheet,
    because they may reach someone with no session.
- **Kinds no page uses, and why**:
  - `loading`: the pages are drawn on the server and arrive complete. No part of a page is fetched after it
    arrives, so nothing on a page is ever "on its way". The live line only says that something new came in.
    Work under way after a press is a busy button (`aria-busy`). The kind stays defined for the first part that is
    drawn in later.
  - `forbidden`: no page draws it. What a team member meets instead, as the browser shows it:
    - A part kept for the owner says so in place (`staff.ownerDecides`, "The owner decides this.") and keeps the
      rest of the page.
    - An owner-only page (`/app/settings/people`, `/app/settings/billing`, `/app/customers/import`) or an action
      that is not theirs (`ownerOnly` in `app.ts`) sends them back to a page they may see with the notice
      `staff.notAllowed`: "Only the owner can do that."
    - **OPEN (the same at aa752c3c):** a team member who opens the books (`/app/books/invoices`) lands on Today with
      no words. The notice "The books are the owner's and the accountant's." is painted later, on a page after that.
      The routing was not changed in Block 9.
    - **The accountant** at those owner-only pages (`/app/settings/people`, `/app/settings/billing`,
      `/app/customers/import`) is sent to `/app/books` with **no notice**, on that page or the next.
      **OPEN (the same at aa752c3c):** a refusal the accountant cannot read. The routing was not changed in Block 9.
    - The kind stays defined for a page that is someone else's to decide as a whole.
- **Marks**: each kind carries a mark of its own shape beside its heading (round, dashed round, open round, a diamond,
  a filled square, a dashed square), so the kinds differ by more than colour.
- **Announcing**: `nomatch` and `loading` are announced (`role="status"`).
- **Distinct headings**: two kinds never share a heading.
- **Money**: a state never stands in for an amount. A missing figure is never shown as zero.
- **Other states the system has**, each with a heading, a sentence and a way on:
  - a team member's refusal is a redirect plus a notice (`staff.notAllowed`); the accountant's is a redirect to
    the books with no notice (OPEN, above);
  - work under way is a working line or a busy button (`aria-busy`);
  - a fault or a missing page is `errorPage` or `missingPage`.

## 8 · Motion (`layout.ts` `MOTION_CSS`; F44)

Durations: fast 160 ms, normal 220 ms, max 250 ms. The ease is `cubic-bezier(0.25, 0.46, 0.45, 0.94)`.

- Everything sits inside `@media (prefers-reduced-motion: no-preference)`. Under reduce, the reduce block sets
  `animation-name:none` and `transition-property:none` on everything: 0 running animations.
- **Routine pages arrive still.** No card, row or group rises on load. Moving between pages moves nothing: no page
  opts into a cross-document view transition (removed 2026-11-27: it could only start after the next page arrived, and
  drew the page body over the bars while it ran). The icon of the page you land on settles into its place.
- **What moves is what a person did:**
  - a fold opening, a transition on `::details-content` (when closing, the hiding waits with `allow-discrete`);
  - a pressed button (scale 0.97);
  - a notice after a save (`.flash` rises);
  - a new draft when a conversation is drawn again in place (`main[data-drawn-again] #approve`);
  - a dialog or a sheet;
  - the working dots.
- The words being typed, focus and scroll survive a live redraw (`liveScript.ts`).

## 9 · Right to left (rules 38 and 65; Block 5)

- Arabic pages set `dir="rtl"` and `html[lang="ar"]`. Layout uses logical properties (`inline` / `block`, `start` /
  `end`) only.
- **Every value is isolated:** a figure, a date, a name, a SKU, a code and every bare digit run. The isolate is
  `<bdi>` or the FSI / PDI marks (`isolate()` in `values.ts`), so "12" and "$5" never reorder with the words around
  them. The sweep's rule-38 probe fails any digit run outside an isolate.
- Arabic headings keep room for their marks (line height 1.45) and never take tracking.

## 10 · The shell

- **Desk:** the rail (`nav.side`) on the start side.
- **Phone (720 px and under):** the same nav becomes a fixed tab bar at the end of the screen, inside the safe area.
  - The content keeps 88 px clear above it, and the page scroll keeps 100 px.
  - At 390×844 a page's primary act sits above the tab bar. Nothing is drawn under it, at the top of the page or at
    the end.
- **Breakpoints in use:** 560, 600 and 720 (phone), 721 (desk starts), 1100 (column headings).
- **Static files:** one content-hashed stylesheet per surface (`/assets/app.<hash>.css`), and one shared script
  (`liveScript.ts`) whose size is capped by a test.
