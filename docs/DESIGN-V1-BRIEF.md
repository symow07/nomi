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
is the natural one.

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

## 8 · Questions the inventory raised

Answer them whenever; none blocks decision 1.

- Base 17 px was set for "45+ eyes". Keep that premise?
- Is 820 px (tablet) a target, or do phone and desktop cover it?
- The assistant has a brand mark (the green figure) and a name chosen by the
  owner; is the mark part of V1?
- Doors (`›` links deeper into a hub) versus buttons: today both exist on the
  same pages. One pattern, or two with a rule?
- The `select` for "hand to" and the login `details` are browser-drawn. In or
  out of the component set?

---

## 9 · How to look at everything yourself

```bash
bash .claude/skills/run-nomi/smoke.sh                                  # local instance, ~1 min
MIGRATE_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/nomi node tools/seed-usability.mjs
node tools/screenshots.mjs --no-boot                                   # 234 shots → screenshots/index.html
```

The contact sheet lays every page out at three widths in three languages,
for looking at together. It is the review surface for every V1 step too.
