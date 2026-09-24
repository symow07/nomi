# V1 · The visual design pass — brief for Symow

Written 2026-09-24, after D shipped. Roadmap entry: `docs/ROADMAP.md` §2b, V1.

This is the inventory you asked the implementer to hand you before you decide
anything: what the system is today, where the styling actually lives, which
surfaces exist, and what the screenshots show. It contains **no design
decisions**. The five you own are listed at the end, each with the shape the
implementer needs your answer in. Everything here was read from the code and
from screenshots of the running product on 2026-09-24; nothing is from memory.

---

## 1 · How V1 works

- **You direct the look.** References, type, colour, density, what a row is.
- **Claude Code implements:** tokens, components, the tests that hold them,
  screenshots at every step for your review. It makes no visual decision on
  its own and defends none.
- **Order once the decisions land:** decisions → tokens → the components on
  one owner-only page under Setup (every state, in one place, for review and
  screenshots) → the shell → the inbox → the rest, page by page. One PR per
  step, against the full verification set, screenshots attached.
- **Why V1 is before A:** A merges Buyers and Customers into one list with
  search and paging. Styling that list once, not twice.

---

## 2 · The system as it stands

One token file, `src/core/owner/tokens.ts` (`DESIGN_TOKENS`), rendered to CSS
custom properties by `cssVariables()` in `src/core/owner/css.ts`, consumed as
`var(--…)` by the shell in `src/api/web/layout.ts`.

### Type

| Token | Value |
|---|---|
| family | `-apple-system, "PingFang SC", "Noto Sans SC", sans-serif` |
| voice (serif; only for what a person said) | `ui-serif, Georgia, "Songti SC", "Noto Serif SC", "Noto Naskh Arabic", serif` |
| sizes | micro 12 · caption 13 · note 14 · small 15 · **base 17** · title 20 · numeral 22 · display 26 (px) |
| line-height | 1.6, one value for all three scripts |

The base of 17 was chosen for "45+ eyes". There is **one scale for Latin,
Chinese and Arabic**; nothing adjusts per script.

### Colour (light · dark)

| Meaning | Light | Dark |
|---|---|---|
| ink / ink secondary | `#1A1A1A` · `#5C5C5C` | `#F2F1EE` · `#A3A29E` |
| surface / surface alt | `#FFFFFF` · `#F6F5F2` | `#161514` · `#211F1D` |
| paper (raised) / paper sunk (inputs) | `#FBFAF7` · `#F0EDE7` | `#1C1B19` · `#100F0E` |
| border | `#E4E2DD` | `#33312E` |
| jade (the one accent = ok) / deep / wash / line | `#0F7B3E` · `#0A5A2C` · `#EDF4EF` · `#C6DCCE` | `#4ADE80` · `#22C55E` · `#13251B` · `#1F3E2C` |
| ok / waiting / warn / highlight | `#0F7B3E` · `#B45309` · `#B42318` · `#8A6D00` | `#4ADE80` · `#FBBF24` · `#F87171` · `#FACC15` |
| each state also has a wash and a line | e.g. waiting `#F5E7DD` · `#E5C3A9` | e.g. waiting `#2A1F12` · `#4A3418` |

Rules already in force: colour is spent on **state only** (M49); the accent is
the same green as "ok"; one accent per screen. Dark mode exists as tokens and
a `prefers-color-scheme` block; it has never been reviewed by eye.

### Space, measure, shape, motion

| Token | Value |
|---|---|
| spacing | 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 px (named by value: `--space-24`) |
| measure | column 1040px · prose 62ch · form 40ch — every width derives from these three |
| radius | card 12 · chip 999 |
| shadow | card, raised, lift1, lift2 (subtle, warm-grey) |
| motion | fast 120 · normal 200 · max 300 ms, all skippable |

### What the tests already hold (V1 inherits these)

- Every colour and size is a token; nothing declares a literal (`tests/parity/shell.test.ts`).
- A state colour needs a **state-named class** (`.ok`, `.waiting`, `.warn`…).
- Serif is for what a person said; sans for what the product says (M49, tested).
- One column, one rhythm: the layout test (`tests/parity/m49-layout.test.ts`).
- Owner-facing HTML never contains `%` (no scores, no percentages), and never
  "AI" / 机器人 / 系统 / 模型; the banned-terms tests scan rendered pages and
  **inline CSS comments too**.
- Three locales, RTL, every surface. Nobody is gendered in copy.

---

## 3 · Where the styling actually lives — the fact that shapes V1

The token file is one. The stylesheets are forty.

| Measured 2026-09-24 in `src/api/web/` | Count |
|---|---|
| files carrying their own `<style>` block | 28 |
| `<style>` blocks in total (shell included) | 40 |
| CSS classes defined | 345 |
| classes used in markup | 409 |
| classes **defined in more than one file** | 37 |

The 37 defined twice or more include the ones every page uses: `block`,
`card`, `btn`, `chip`, `pill`, `tag`, `stat`, `note`, `muted`, `sub`, `fld`,
`pform`, `replyform`, `editform`, `ok`, `stop`. Each page re-declares the
shape it needs, from the same tokens, with small differences.

Most-used classes (how many files use each): `muted` 27 · `block` 25 ·
`btn` 24 · `page` 23 · `send` 19 · `pill` 14 · `inline` 14 · `empty` 13 ·
`fld` 12 · `who` 11 · `pform` 10 · `ok` 9 · `card` 7.

**What this means for V1.** The tokens can change in one place. The
components cannot, today: a button is `.btn` in the shell and something
slightly different in a dozen pages. So the implementation's first real
step, after your decisions, is **one stylesheet** — the component set defined
once — and page-level `<style>` blocks retired as each page is restyled.
Until that, a change to "the button" is twenty-four changes.

---

## 4 · The component inventory, by what exists

Grouped by function, named by the classes that exist today. This is the list
your decision 4 will replace, not extend.

| Family | Today's classes | Where |
|---|---|---|
| Shell: top nav (5 entries), the hub strip (`hubFor()` in `layout.ts`), language pill, log out | `nav.side`, `.navcount` (the Setup badge), `.locale`, `.logout` | every page |
| Doors (links deeper into a hub) and back links | `.deeper`, `.doors`, `.back` | hubs, My business, the assistant's page |
| Page title | `h1.page` | every page |
| Section / card | `.block`, `.card`, `.sub` (sub-heading), `.foot` | every page |
| Stat (number + label) | `.stat`, `.stats`, `.v`, `.l` | Today, Results, the assistant's page |
| Status chips | `.pill`, `.chip`, `.tag`, with state classes `.ok .waiting .warn .off` | inbox rows, buyer rows, channels, people |
| Buttons | `.btn`, `.send` (primary), `.ghost`, `.danger`, `.stop`, `.go` | forms, cards |
| Forms | `.pform`, `.fld`, `.flabel`, `.frow`, `.perr` (error), `.replyform`, `.editform` | settings, products, prices, reply |
| Notice after an action | `.flash` with a tone class (decided once in `flashTone.ts`) | any page after a POST |
| Empty state | `.empty`, `.empty-p` | lists with nothing in them |
| Tabs | `.tabs`, `.tab.on` | inbox, Results |
| Transcript | `.bubble`, `.voice` (serif), `.ts` (time), `.who` | conversation, sandbox |
| Insight rows (sentence + one action) | `.insights`, `.go` | Today |
| Setup progress | `.setup`, `.setup-line`, the `3/5` badge | nav, Today, Setup |
| Muted / secondary text | `.muted`, `.note` | everywhere |

Not styled by any class today and drawn by the browser: the hand-to `select`,
`details/summary` on the login page, `textarea`.

---

## 5 · The surfaces

27 owner pages, walked by `node tools/screenshots.mjs` at 390 / 820 / 1280
px in en · zh · ar (234 screenshots; the full set is regenerated by that one
command against a local instance and is not committed). Eleven are committed
beside this brief in `docs/design/v1-before/` as the reference set.

| Page | Path | Reference |
|---|---|---|
| Login | `/login` | `login-ar-phone` |
| Today | `/app` | `today-zh-phone`, `today-en-desktop` |
| Buyers (inbox: Needs you / All / Mine) | `/app/inbox` | `inbox-zh-phone` |
| A conversation | `/app/inbox/:id` | `conversation-en-phone` |
| Customers (all buyers) | `/app/conversations` | `buyers-en-desktop` |
| A buyer, an order | `/app/conversations/:id`, `/app/orders/:id` | — |
| My business, prices, products, a product, teach | `/app/factory`, `/app/factory/prices`, `/app/products`, `/app/products/:id`, `/app/products/add` | `factory-ar-phone`, `products-en-tablet` |
| What the assistant knows | `/app/knowledge` | — |
| Setup and its doors: people, terms, samples, closures, forbidden, rate, channels, data | `/app/settings/*`, `/app/channels` | `settings-zh-desktop` |
| The assistant | `/app/employee` | `employee-en-phone` |
| Getting ready, Practice | `/app/onboarding`, `/app/sandbox` | — |
| Results | `/app/analytics` | `analytics-zh-phone` |
| Outreach area (contacts, prospects, sequences) | 404 unless the workspace has it on | — |

The workspace in the screenshots is the usability workspace
(`docs/USABILITY-SCRIPT.md`): 71 conversations, one handed to a colleague,
one draft waiting, an order, a sample.

---

## 6 · What the screenshots show

Observations, for you to weigh. Not proposals.

1. **The phone shell spends its first ~200 px on two bands** — the five-entry
   nav, then the assistant's name, the language pill and Log out — before any
   content. On Today (390 × 844) the first thing worth reading starts a
   quarter of the way down. (`today-zh-phone`, `inbox-zh-phone`)
2. **Lists are one column with a right-aligned chip and no density control.**
   Customers at 1280 px is a single column ten thousand pixels tall, each
   buyer three lines and a chip; the width to the right is empty.
   (`buyers-en-desktop`)
3. **The inbox row today**: flag + name + country, product · quantity ·
   price, one line of the last message in serif, a time, a chip
   ("看看这条回复", "陈莉 在管"). It is a card, not a row; two of them fill a
   phone screen. Your decision 5 starts from here. (`inbox-zh-phone`)
4. **The conversation page puts the draft above the buyer's words.** Ownership
   card, then "Review your assistant's reply" with three buttons and an edit
   box, then the quote, then the transcript at the bottom. This is F7 in the
   usability script and the one layout question the script is written to
   test. (`conversation-en-phone`)
5. **Today stacks six sections of different rhythm** — insight rows with a
   button each, count cards, the setup card, a learning card, three stats, a
   footer notice — each in its own idiom. (`today-zh-phone`, `today-en-desktop`)
6. **Arabic pages mix Latin product names into RTL lines** ("Travel Cosmetic
   Bag · Reusable Shopping Trolley Bag…") and the numbers sit LTR inside RTL
   sentences; the type is the same size and leading as Latin. The one scale
   for three scripts is visible here. (`factory-ar-phone`)
7. **Colour is already restrained**: jade on the primary action and the brand
   mark, state colours on chips and the ownership line, everything else ink
   on paper. M49's rule held. The question left is not "less colour" but what
   the one accent should be and where state colour is allowed to sit.
8. **Serif for a person's words is in place** and reads as intended in the
   transcript; on a list row it makes the preview the loudest thing in the
   row. (`inbox-zh-phone`, `conversation-en-phone`)
9. **The Setup badge "3/5" floats** at the end of the nav, above and apart
   from the word Setup, at every width. (`today-zh-phone`, `settings-zh-desktop`)
10. **Chinese and English pages differ in weight**: PingFang at 17 px reads
    heavier and wider than the Latin, so the same line budget wraps
    differently; Chinese buttons ("进入工作台") are visibly bolder than
    their English twins. (`inbox-zh-phone` vs `conversation-en-phone`)
11. **Dark mode exists and nobody has looked at it.** The screenshot set is
    light only; the tokens for dark are there.

---

## 7 · The five decisions, and the shape of each answer

The implementer can start the moment these exist, in any order; tokens first
is the natural one. **Symow answered 1–4 on 2026-09-24; §8 records them.
5 is deferred until after the usability session.**

| # | Decision | What the implementer needs from you |
|---|---|---|
| 1 | **Type scale**, and how Arabic and Chinese sit on it | A size list (any names), a line-height per script or a rule for it, the two families (product voice, person voice) per script, and a weight rule for CJK at small sizes. A reference screenshot or two is worth more than a paragraph. |
| 2 | **Spacing scale and density per surface** | The scale (values), and one word per surface — dense / open / narrow — for: lists, forms, reading pages, the transcript, Today. |
| 3 | **Colour** | Ink and paper (light and dark), the one accent, and the three state colours with their wash and line. Say whether dark mode is in scope for V1 or explicitly out. |
| 4 | **The component set, with states** | For each: rest, hover, focus, disabled, and what mirrors in RTL. The list in §4 is what exists; yours replaces it. A Figma frame per component, or a marked-up screenshot, is enough. |
| 5 | **The row** | The message row (inbox): which fields, in what order, which one is the tag, how a category reads, what a row does when it is waiting on a person. The buyer row (Customers, and after A the merged list): the same questions. |

Two constraints that are not yours to decide, so you can plan around them:
tests assert **structure** (tokens, classes, provenance), never literal CSS
values, so any value is fine as long as it is a token; and every surface
ships in three locales with RTL, so a component that works in one script
only does not ship.

---

## 8 · Decided — Symow, 2026-09-24

Decisions 1–4, in his words, each followed by what it means for the
implementer. Decision 5 is **deliberately deferred** until after the
usability session: F7 in the script is written to test the row and the
conversation page, and the answer waits for what the participants do. It is
recorded as pending; nothing is guessed in its place.

### 1 · Type — decided

> Keep base 17. Drop the one-scale-for-three-scripts rule: sizes
> 13/15/17/20/26/34; line-height 1.5 Latin, 1.7 Chinese, 1.75 Arabic. CJK
> never below weight 400 at 15px and under. Two families: system sans for
> product voice, the existing serif for the buyer's own words.

What it means:
- The scale loses 12, 14 and 22 and gains 34. Today's tokens `micro` (12),
  `note` (14) and `numeral` (22) are used 34, 86 and 7 times across ~25
  files; each use is remapped to a neighbour on the new scale (12 → 13,
  14 → 15). Where a 22 goes — 20 or 26 — is a per-use call the implementer
  proposes in the tokens PR, with screenshots.
- Line-height becomes a token **per script**, set from `html[lang]`, which
  the shell already writes. The one `--line-height` becomes three values.
- No weight below 400 exists anywhere today (measured: zero), so the CJK
  rule is a guard to add, not a change to make.
- Families unchanged: the sans stack and the serif voice stay as they are.

### 2 · Spacing and density — decided

> Scale 4/8/12/16/24/32/48. Density per surface: lists dense, forms open,
> reading pages narrow, transcript open, Today dense. Fix observation 1 in
> the same pass — ~200px of chrome before content at 390px is the worst
> single problem in the brief; the nav and name band should collapse on
> scroll.

What it means:
- The scale loses 64 (used nowhere today), so the token change is a
  deletion. The density words are per-surface defaults for the stylesheet:
  a dense list row, an open form field, a narrow reading measure, an open
  transcript, a dense Today.
- The shell collapses its two bands on scroll. The shell ships no script
  today; this is either the first script in the shell (small, and the page
  must read correctly without it) or a CSS scroll-driven animation. The
  implementer chooses in the shell PR and says why. **Whichever it is, the
  shell must be fully usable with the script absent or failed — the nav
  reachable, nothing stuck collapsed — and that PR says how this was
  verified** (the owner, 2026-09-24).

**Step three, shipped (2026-09-24).** No script. On a phone the nav is
`position: sticky` and compacts over the first 160 px of scroll through a
CSS scroll-driven animation (inside `@supports (animation-timeline:
scroll())` and `prefers-reduced-motion: no-preference`); the name band
below it is ordinary content and scrolls away. The state is a pure function
of scroll position, so nothing can be stuck, and with scripting off nothing
changes. Measured in Chromium at 390 px (`docs/design/v1-step3/`): nav 80 →
60 px (en), 85 → 65 (zh), 87 → 67 (ar) while scrolled, at the top of the
viewport, all five entries the element under their own centre; with motion
reduced — the same path an unsupporting browser takes — the nav stays at
full size, still sticky and reachable; the band's bottom edge is off-screen
in every case and everything returns at scroll 0. At rest the chrome above
content is 162–201 px (was ~200): the band lost the avatar and the stage
line and fits one row. The mark left the assistant's band and sits at the
product's nav on phones — the brand's **small cut** (reversed, on a solid
disc, 28 px, no word), because below 40 px the pale disc would not read;
the desktop keeps the detail cut beside the word. The header shows the name
and nothing beside it; `EMPLOYEE_AVATAR` is no longer read. The Setup count sits
beside its word, and wraps under it where the cell is too narrow.

### 3 · Colour — decided

> Jade stays as the one accent. State colour stays confined to chips and
> the ownership line. Dark mode is explicitly OUT of V1 — say so in the doc;
> the tokens stay but go unreviewed.

What it means:
- No colour token changes. The rule "state colour only on chips and the
  ownership line" becomes a test: a state class outside those two families
  fails.
- **Dark mode is out of V1.** The `colorDark` tokens and the
  `prefers-color-scheme` block stay as they are and are not reviewed,
  screenshotted or styled in this pass. Nothing in V1 may depend on them.

### 4 · Components — decided

> Don't invent a replacement set: define what already exists, once, in one
> stylesheet, and retire page-level style blocks as each page is restyled.
> Bring the browser-drawn controls IN (the hand-to select, the login
> details/summary, textarea). Doors vs buttons: buttons do things, doors go
> places — never both styles for one pattern. The brand mark stays, but it
> belongs to the product, not the assistant; the assistant has the owner's
> chosen name, not a face.

What it means:
- The component set is §4's list, defined once in one stylesheet. The 40
  page-level `<style>` blocks are retired page by page, each retirement a
  PR with screenshots; a test counts the blocks that remain and the count
  may only fall.
- `select`, `details/summary` and `textarea` join the set with states.
- One rule, to enforce as pages are restyled: a `<button>` or a form action
  wears the button style; a link that changes the page wears the door style.
  Not tested yet — 24 links wear the button style today (measured
  2026-09-24), so the test lands with the page that clears the last one.
- The brand mark moves to the product's name (Nomi) and leaves the
  assistant's header band; the assistant is named, never drawn.

**Step two, shipped (2026-09-24).** The shared families are in the shell
once — `tests/parity/v1-one-stylesheet.test.ts` refuses a class defined in
two files — and the homonyms (`.acts`, `.certs`, `.tag`, `.prow`, `.phead`,
`.pr`, `.foot`, `.gmeta`, `.gq`, `.voice` on one page each) were renamed
where they meant something else. The `<style>` count starts its ratchet at
40 (`tools/style-baseline.json`) and falls as pages are restyled. The
components page is `/app/settings/components`, a door on Setup. It is
**signed-in, not owner-only**: the owner-only list is six business actions
pinned by a test, and a page of buttons is not one of them. Two things
changed visibly and are yours to keep or reverse: the conversation and
Customers pages had a bare `.ok` rule that made every ok pill 17 px bold by
accident — those pills are now the shell's pill; and the "all calm" line
(`.ok-line`) is one body on all three pages that had it. The hover and
focus states are shown through `.is-hover` / `.is-focus` twins; disabled is
the attribute, styled quiet — the one new state style, for your review.

**Step four, first batch (2026-09-24).** Ten small pages retired their
blocks — Results, Today's insight rows, Your data, the Page picker, Price
limits, Prospects, an order, People, the assistants' section, Connect —
and the `<style>` count fell 40 → 30. What they each drew for themselves
is named once in the shell: `.rows`/`.row` (a list of hairline rows, dense
as decision 2 says of lists — 8 px, where pages had 8, 10 and 12), `.row
lines` / `.row top`, `.grow`, `.who` (the column that names someone),
`.caption` and `.small` (two sizes, where eight page names said the same),
`ul.chips`, `.pill.stop`, `.issued .code` (the one-time staff code, kept
under its old class because seventeen tests read it), `.choices` (a fieldset of
checkboxes). Two page copies of the input style were dead since step two
and went. Visible changes, small and listed in the PR: row spacing on
those lists is now uniform, Results' deal value uses the "stated large"
figure, and three caption lines that were 15 px are 13. Still carrying a
block: the eight big pages (Today, Buyers, a conversation, Customers, My
business, products, the assistant, Practice, channels, knowledge, Getting
ready, Setup, contacts, sequences, proof) and the two public pages (legal,
unsubscribe), which have no shell and keep their own document.

**Step four, Today (2026-09-24).** Today's block is gone (30 → 29). Its
count lines were the shell's stat rows under another name and are stat
rows now; its "Needs you" cards are stat rows you can tap — `a.stat.need`,
figure at 20 px, hairline rows instead of a bordered card each — which is
the dense Today decision 2 asked for and one idiom fewer of the six the
brief's observation 5 counted; its "quiet" line is muted text; its
not-live footer is a block. The calm state — a short rule and one
sentence — is Today's own idiom and moved to the shell under its names.
Visible: the needs list lost its card borders and its 26 px desktop
figure (20 everywhere now), and the count lines sit 1 px tighter.

**Step four, the batch (2026-09-24).** Every remaining page that does not
wait on decision 5 retired its block: Setup, Getting ready, the assistant's
page, My business, products, channels, knowledge and its insights,
contacts, sequences, Practice — 299 rules moved into the shell whole,
under a section per page, page-specific names defined once; four exact
duplicates of `.pill.stop` and the input style dropped; the stat override
on knowledge's insights became a `big` modifier so it cannot leak into
every stat row. The three public pages — legal, unsubscribe, proof — share
one `publicDocument()` in the shell (same tokens, one base stylesheet, a
page's own rules passed in). The count is **6**: the shell's own three
(shell, login door, public document), Buyers' two and Customers' one —
those wait on decision 5. The cost, measured: an owner page carries the
whole stylesheet now — 60 KB of HTML where the shell alone was 32 — so
about 28 KB more per page, uncompressed; the login door and the public
documents carry the base rules only and kept their size (the door: 32 KB
before and after). The pages that dissolve their sections into families as
V1 designs them bring the shell's number back down.

### 5 · The row — PENDING

Deferred until the usability session has run (F7 tests exactly this).
Until then the inbox row and the buyer row keep their current shape, and
the inbox step of V1 waits behind this answer.

---

## 9 · Questions the inventory raised

Answer them whenever; none blocks decision 1.

- Base 17 px was set for "45+ eyes". Keep that premise? — **Kept** (decision 1).
- Is 820 px (tablet) a target, or do phone and desktop cover it? — open.
- The assistant has a brand mark (the green figure) and a name chosen by the
  owner; is the mark part of V1? — **The mark stays and belongs to the
  product, not the assistant** (decision 4).
- Doors (`›` links deeper into a hub) versus buttons: today both exist on the
  same pages. One pattern, or two with a rule? — **Two, with the rule:
  buttons do things, doors go places** (decision 4).
- The `select` for "hand to" and the login `details` are browser-drawn. In or
  out of the component set? — **In** (decision 4).

---

## 11 · Proposal — the phone chrome at rest, under 120 px

Asked by the owner on 2026-09-24, after step three: the chrome above content
at rest is 162–201 px, and most of it is the two bands themselves. Nothing
below is built. Each option was prototyped by injecting CSS on the running
product and measured where `main` begins on a 390 px phone, on Today, in
three languages; the screenshots are in `docs/design/v1-chrome/`
(`<option>-<locale>.png`, the top 300 px).

| Option | What changes | en | zh | ar | Every control ≥ 44 px |
|---|---|---|---|---|---|
| current | — | 191 | 162 | 201 | yes |
| **A** · one band | the name band goes; language and log out move to Setup (the login page keeps its switcher) | **80** | **85** | **87** | yes (56) |
| B · both bands shrink | nav 60–67, band 59–87; all controls kept at 44 | 147 | 124 | 126 | yes |
| **C** · one band, six cells | the name band goes; a sixth cell "More" holds language and log out | **80** | **85** | **87** | yes (56) |
| E · controls-only band | the name leaves the band (it is already the nav entry); language and log out stay in a 59 px row | 139 | 144 | 146 | yes |

**What the numbers say.** Two bands cannot get under 120 while every
control stays a 44 px target and the nav keeps two-line labels: the nav
alone is 60–87 px, and the thinnest honest band is 59. B fails in English
because "Your assistant · English 中文 العربية · Log out" wraps to two rows.
Under 120 means one band.

**A — recommended.** The nav row is the chrome: mark, five entries, the
Setup count. The two things the band carried go where they are used
rarely: the language switch and log out become the first two rows on
Setup, and the login page already has its switcher, so a new owner still
chooses a language before signing in. The assistant's name is not lost — it
is the nav entry once the owner has chosen it (decision 4). Cost: switching
language becomes two taps instead of one, and log out likewise; the
"Probation · you're mentoring…" stage line, already hidden on phones,
would go from the desktop band too or move to the assistant's page. Chrome
at rest: 80–87 px.

**C — the alternative if language must stay one tap away.** Same 80–87 px,
but six cells at 390 px are 52 px each with two-line labels (`C-en.png`);
Arabic is the tightest. It buys one tap at the cost of a permanently
crowded row.

**Not proposed.** Hiding the nav until scrolled, or a hamburger menu: both
put the five destinations behind a tap, which the usability script's task
one and task four are written to catch.

**A — built (2026-09-24, the PR after #69).** The band is gone on every width; the switcher and log out are Setup's first rows; `header.stage` retired (the assistant's page already states the stage); the `EMPLOYEE_AVATAR`-era header CSS deleted. Measured after the build: see the PR.

**If A (as proposed):** one PR against the shell and Setup — the band removed on every
width, the switcher and log-out rendered by Setup, `header.stage` retired
or moved, the shell tests updated deliberately (the "every header control is
44 px" test loses its subject), screenshots before and after. Half a day.
It touches no send path and no data.

---

## 10 · How to look at everything yourself

```bash
bash .claude/skills/run-nomi/smoke.sh                                  # local instance, ~1 min
MIGRATE_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/nomi node tools/seed-usability.mjs
node tools/screenshots.mjs --no-boot                                   # 234 shots → screenshots/index.html
```

The contact sheet lays every page out at three widths in three languages,
for looking at together. It is the review surface for every V1 step too.
