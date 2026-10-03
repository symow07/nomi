# Type and icons: what actually renders

Measured 2026-10-04 on the local instance of `origin/main` at `d3a7cdca`, in Chromium 153 on this Mac. These are observations only. Nothing in the code was changed, and no new font is proposed here.

## The answer

1. **Noto really is served, but only to the signed-in app and the sign-in/sign-up door.** On those surfaces every language's own letters are drawn by the Noto file the product sends: English, Spanish and French by Noto Sans, Chinese by Noto Sans SC, Arabic by Noto Sans Arabic. CDP reports `isCustomFont: true` for over 99 % of those glyphs.
2. **The public pages (site, privacy, terms, data deletion) load no font at all.** They fall back to the device. On this Mac that means SF Pro for Latin, SF Arabic for Arabic and PingFang SC for Chinese. The first page a stranger sees is set in a different typeface from the app it leads to.
3. **The app draws only two weights, Regular 400 and SemiBold 600.** Every "700" in the CSS renders as 600, and every "500" renders as 400. Page titles, row labels and the brand name are all the same SemiBold.
4. **Sizes stay on the six tokens, but the hierarchy is flat.** 54 % of the app's characters are 15 px, 25 % are 17 px and 20 % are 13 px. The page title is 20 px, only 1.18× the body. On Today, a section heading (26 px) is bigger than the page title (20 px).
5. **Icons come from four different sources:**
   - hand-drawn SVG line icons;
   - signal marks typed as text: ○ ✓ in SF Pro Bold, ✦ in **Zapf Dingbats**, a 1990s ornament font the browser reaches only by fallback;
   - text chevrons › ‹ in Noto;
   - one Apple Color Emoji flag.

   The same meaning is drawn in different styles (the assistant: an outline sparkle in menus, a filled Zapf ✦ beside its words). Line icons are drawn at five sizes, from 14 px to 22 px, so their strokes run from 1.05 px to 2.11 px on screen.
6. The note in CLAUDE.md §6 ("English renders in PingFang SC because the stack starts with -apple-system") is **out of date**. The stack now starts with "Noto Sans" (`src/core/owner/tokens.ts:90`). No Latin letter rendered in PingFang anywhere in the crawl. PingFang now draws only Chinese characters on non-Chinese pages, and all text on the public Chinese pages.

---

## 1. Fonts

### 1.1 What the code asks for

- **Sans stacks** (`src/core/owner/tokens.ts:89-93`):
  - en: `"Noto Sans", "Noto Sans SC", "Noto Sans Arabic", system-ui, sans-serif`
  - zh: `"Noto Sans SC", "Noto Sans", system-ui, sans-serif`
  - ar: `"Noto Sans Arabic", "Noto Sans", system-ui, sans-serif`
  - es and fr have no entry. They get the English stack from `:root`, and only zh and ar are overridden (`src/core/owner/css.ts:50, 71-74`).
- **"Voice" (serif) stacks** for anything a person said (`tokens.ts:100-104`): Noto Serif, Noto Serif SC and Noto Naskh Arabic.
- **Vendored files** (`tools/fonts.mjs:36-43`, `assets/fonts/faces.json`, 342 woff2 files, 9.1 MB on disk):
  - Noto Sans 400 and 600
  - Noto Sans Arabic 400 and 600
  - Noto Sans SC 400 and 600
  - Noto Serif, Noto Naskh Arabic and Noto Serif SC at **400 only**
  - No 700 and no italic for any family.
- **Who links the type sheet:**
  - The shell links it (`src/api/web/layout.ts:2621`) and so does the door (`layout.ts:2765`). A Chinese page links the larger sheet with the SC faces (`src/api/web/type.ts:17-20, 46`).
  - `publicDocument()` links no font, on purpose: "no script, no stylesheet, no font" (`layout.ts:2347`, `2389`).
- `font-display: swap` (`type.ts:37`). On a first visit text is drawn in the system font and then redrawn in Noto. This comes from the code and was not filmed.
- No `Content-Security-Policy` header is sent on any page measured, so nothing blocks the font files. All files are served from `/assets/` on the same origin. No Google or other third-party font host is contacted.

### 1.2 What actually drew the glyphs (1280 px, all pages of each surface)

Glyph counts come from `CSS.getPlatformFontsForNode` on every visible text element.

| Surface | Lang | Files fetched | Glyphs drawn by (largest first) | Noto? |
|---|---|---|---|---|
| Owner app (12 pages) | en | noto-sans latin 400/600, latin-ext 400, serif latin 400, **noto-sans-arabic *symbols* 400/600** | NotoSans-Regular 16,673 · NotoSans-SemiBold 4,359 · NotoSerif-Regular 280 · PingFangSC (Chinese names) 100 · **ZapfDingbats 44** · **SF Pro Bold 31** · AppleColorEmoji 1 | Yes for the page's language. No for symbols and Chinese |
| Owner app | es / fr | same as en | NotoSans-Regular 16,930 / 18,402 · SemiBold ~4,700–4,800 · same fallbacks as en | Yes |
| Owner app | zh | ~43 Noto Sans SC slices (400 and 600), Noto Serif SC latin, Noto Sans latin-ext | Noto Sans SC Regular 10,351 (Latin letters included) · Noto Sans SC SemiBold 2,389 · Noto Serif SC 280 · **ZapfDingbats 44** · AppleColorEmoji 1 | Yes, and Latin on a Chinese page is drawn by the Chinese face, as designed |
| Owner app | ar | noto-sans-arabic arabic/latin/latin-ext/symbols, noto-naskh-arabic latin | NotoSansArabic-Regular 17,837 (Latin included) · SemiBold 5,000 · NotoNaskhArabic 280 · PingFangSC (Chinese names) 100 · **ZapfDingbats 44** · SF Pro Bold 31 | Yes |
| Door (/login, /signup) | en / es / fr | noto-sans latin 400/600, noto-sans-arabic arabic 400 (for the word العربية in the switch) | NotoSans-Regular 944–1,193 · SemiBold 103–135 · PingFangSC 4 (the word 中文) | Yes |
| Door | zh | 17 Noto Sans SC slices | Noto Sans SC 436 · **GeezaPro 14** (the word العربية: the zh stack names no Arabic family) | Yes, except Arabic |
| Door | ar | noto-sans-arabic arabic/latin 400/600 | NotoSansArabic ~1,260 · PingFangSC 4 | Yes |
| Public (/site, /privacy, /terms, /data-deletion) | en / es / fr | **none** | SF Pro (.SFNS) ~10,700–13,400 · SF Arabic 40 · PingFang 10 · ZapfDingbats 2 | **No: named in the stack, never loaded** |
| Public | zh | **none** | PingFang SC ~3,100 · SF Pro ~960 (Latin) · SF Arabic 40 · ZapfDingbats 2 | **No** |
| Public | ar | **none** | SF Arabic ~7,900 · SF Pro ~1,980 (Latin, digits) · PingFang 10 | **No** |

Notes on reading the table:

- **Chinese faces report "Thin" in their names.** CDP gives the Chinese faces as `NotoSansSCThin-Regular` and `NotoSerifSCExtraLight-Regular`. That is only the name stored inside the vendored files. The ink is regular: the same twelve characters at 40 px cover 6,759 ink units in "Noto Sans SC" 400 and 6,466 in PingFang SC Regular.
- **Noto is not installed on this Mac** (fontconfig lists only minority-script Noto families). So every Noto glyph above came from the product's own files.
- **WebKit (Safari) was not measured.** Only Playwright's Chromium is installed here, and nothing was installed for this report.

### 1.3 Where it falls back without saying so

1. **Every public page.** See the table. The site's headline is SF Pro Bold 34 px. One click on "Sign in" and the same brand is Noto Sans.
2. **Chinese characters on a non-Chinese page** go to PingFang SC: the business name 义乌宏发日用品厂 in the rail, and customer names such as 陈莉. This is by design (`type.ts:17-20`), but it means the rail's first line mixes Noto Sans SemiBold "(demo)" with PingFang Semibold Chinese.
3. **Arabic on the Chinese door** (the language switch) is drawn by Geeza Pro.
4. **Symbols.**
   - ○ and ✓ are drawn by SF Pro Bold on en, es, fr and ar pages, and by Noto Sans SC on zh pages, so the shapes differ by language.
   - ✦ is drawn by Zapf Dingbats in every language and on every surface.
   - 🇦🇪 is drawn by Apple Color Emoji.
5. **A wasted download.**
   - The Noto Sans Arabic "symbols" slice declares `U+25A0-27BF` (`assets/fonts/faces.json`), so it covers ○ ✓ ✦. Every en, es and fr owner page therefore downloads it at 400 and 600 (about 4.7 KB each).
   - The glyphs are still drawn by SF Pro and Zapf Dingbats after it loads. The slice does not contain them.

### 1.4 What the stacks would do on other devices (inferred from the stacks, NOT measured)

| | iPhone (Safari) | Android (Chrome) | Windows (Chrome/Edge) |
|---|---|---|---|
| App and door, the page's own language | Noto (served), same as here | Noto (served) | Noto (served) |
| Chinese name on a non-Chinese page | PingFang SC | the system CJK font (Noto Sans CJK) | Microsoft YaHei |
| Public pages, Latin | SF Pro | Roboto | Segoe UI |
| Public pages, Arabic | SF Arabic / Geeza Pro | the system Arabic font (Noto) | Segoe UI |
| Public pages, Chinese | PingFang SC | Noto Sans CJK | Microsoft YaHei |
| ✦ ○ ✓ | Apple's symbol fallbacks | Noto Symbols / Roboto | Segoe UI Symbol |
| 🇦🇪 flag | Apple emoji | Noto Color Emoji | two letters "AE" (Windows draws no flag emoji) |

So the public pages look different on every platform, and the app's signal marks change shape from device to device.

---

## 2. Type scale

### 2.1 Sizes

Token scale: 13 / 15 / 17 / 20 / 26 / 34 (`tokens.ts:105`). **No size outside the tokens renders anywhere** (owner, door, public; 1280 and 390 px; five languages).

Share of visible characters by size, English, 1280 px:

| Surface | 13 | 15 | 17 | 20 | 26 | 34 |
|---|---|---|---|---|---|---|
| Owner app | 20.2 % | **54.3 %** | 24.8 % | 0.5 % | 0.2 % | – |
| Door | 91.4 % | 5.2 % | – | 3.4 % | – | – |
| Public | 2.8 % | 4.4 % | **87.5 %** | 3.4 % | 1.5 % | 0.5 % |

The 390 px owner split is 25.6 / 49.9 / 23.6 / 0.9 %. The token called "base" (17) is not the app's body size: most reading text is 15.

What each size does in the app (English, 1280 px):

| Size / requested weight | Used for |
|---|---|
| 26 / 600 | Today's "✦ Today your assistant handled 4 conversations" (`h2.td-head`, `layout.ts:809`). The only 26 in the app, and **larger than the page's own 20 px title** |
| 20 / 700 (renders 600) | every page title `h1.page` (`layout.ts:552`, weight is the browser's default bold); door "Sign in"; Today's count figures; face initials |
| 17 / 600–700 | section `h2` (same size as body, `layout.ts:559`); brand name in the rail (17 / 700, letter-spacing 0.3 px, `layout.ts:482-483`); customer name in a conversation; ✓ ○ marks; doors › |
| 17 / 400 | prose paragraphs, calendar entries, the serif bubbles |
| 15 / 600 | menu row labels, names in lists, buttons, tabs, the active rail item |
| 15 / 400 | rail items, list previews, links "Follow up ›", most body text |
| 13 / 400–700 | times, captions, group headings (13 / 600), the rail count "1 waiting" (13 / 700), the door's labels and switch |

Distinct size/weight/line-height combinations per page (English, 1280 px): 5–6 on the door and legal pages, 8–14 on owner pages, 12 on /site. Across the app in five languages there are 63 combinations, mostly the English set repeated with each script's line height.

### 2.2 Weights: requested versus drawn

| Requested | App and door draw | Evidence |
|---|---|---|
| 400 | Noto Regular | 55,786 Latin + 18,830 Arabic + 10,668 Chinese glyphs |
| 500 (`.brand small`, `layout.ts:490`, door tagline) | **Regular** | `w500 -> NotoSans-Regular` 382 glyphs |
| 600 | Noto SemiBold | 12,114 Latin glyphs |
| 700 (19 declarations, plus the browser's default bold on `h1`, `b`) | **SemiBold** | `w700 -> NotoSans-SemiBold` 2,395 glyphs. At 40 px the ink of Noto Sans 600 and 700 is identical (7,287 = 7,287) |
| any weight in the serif voice | only a 400 face exists | Asking 600 of Noto Serif gives +9 % ink at an unchanged width (5,744 → 6,282, 608 px both): the browser fakes bold. No serif text is currently set above 400, so this is latent |

**The app has exactly two visible weights.** The public pages, drawn by the system font, show three (SF Regular, variable 600, Bold). They are actually richer than the app.

### 2.3 Line heights (measured, owner and door)

| Script | 13 px | 15 px | 17 px | 20 px title | 26 px heading |
|---|---|---|---|---|---|
| en / es / fr | 1.5 | 1.5 | 1.5 | 1.5 (30 px) | 1.5 (39 px) |
| zh | 1.7 | 1.7 | 1.7 | 1.7 | 1.7 |
| ar | 1.75 | 1.75 | 1.75 | 1.75 | 1.75 |

- Matches `tokens.ts:107`. es and fr fall back to `:root`'s 1.5, which equals their token value.
- **Headings never tighten in the app:** a 26 px heading gets a 39 px line in English and 45.5 px in Arabic. The public pages do tighten (h1 26 px at 1.25, site h1 34 px at 1.2).
- Face initials and a few chips use 1.0.
- Letter-spacing appears in three places:
  - 0.3 px on the brand name (`layout.ts:483`, applied to Chinese characters too);
  - −0.34 px on the site's 34 px h1;
  - 0.3 px on "Nomi" on the door.

### 2.4 Form controls next to the type

- **The autonomy radios on Your assistant** are the browser's own 13×13 px control, with its 13.33 px default font, beside 17 px labels (`input[type=radio]`, `accent-color` only, `layout.ts:628`).
- **Text inputs use two sizes:** 15 px or 17 px depending on the form (both occur on Knowledge; search, Practice and Your data use 17). Their labels are 13 or 15 px.
- **Selects and date/time inputs** keep `appearance: auto`, so they are drawn by the system.

---

## 3. Icons

### 3.1 Inventory: SVG line icons (`src/api/web/icons.ts`)

All 44 icons are drawn on a 24-unit grid with `stroke-width="1.8"`, round caps, `fill="none"`, in the text colour (`icons.ts:99-101`). What changes is the size they are drawn at, and so the stroke on screen:

| Where | CSS | Rendered box → drawn | Stroke on screen |
|---|---|---|---|
| Rail and phone nav (Today, Inbox, Calendar, Assistant, Settings) | `nav.side .ni` 22 px (`layout.ts:517`) | 22 | 1.65 px; **2.11 px on the active item** (`layout.ts:530`) |
| Rail group head "Customers" | `.navhead .ni` **16 px** (`layout.ts:481`) | **22**: the 16 px rule loses to `nav.side .ni` | 1.65 px |
| Settings, Setup, My business, Your assistant menu rows | `.sr-menu > .ni` 22 px (`layout.ts:726`) | 22 | 1.65 px |
| Your data downloads | `.dl-get > .ni` 18 px (`layout.ts:1164`) | 18 | 1.35 px |
| Calendar: date kind as a badge on the face | `.dl-who .kind-icon` 18 px, padding 2 (`layout.ts:1696`) | 18 → **14** | **1.05 px** |
| Calendar: date kind in the face's place | 20 px (`layout.ts:1700`) | 20 | 1.5 px (from the CSS; not present in the seed) |
| Calendar month cell | 24 px, padding 3 (`layout.ts:1754`) | 24 → 18 | 1.35 px (from the CSS; not present in the seed) |
| Inbox "regular customer" mark | `.ir-reg .ni` 1.1em (`layout.ts:1868`) | **14.3** | **1.07 px** |
| Brand mark (filled silhouette, not a line icon) | — | 28 / 32 / 40 | filled |

**No `<img>` icons and no icon font are used.**

### 3.2 Inventory: glyph marks (text characters doing an icon's job)

| Glyph | Meaning | Sizes rendered | Drawn by (measured) | Where |
|---|---|---|---|---|
| ✦ U+2726 | the assistant did this | 13, 15, 17, 20, 26 px | **ZapfDingbats**, every language, app and site | `span.as`, `.pill.as::before`; `tokens.ts:276`, `layout.ts:250-262`, `calendar.ts:521`, `inbox.ts:1243`, `panes.ts:166` |
| ○ U+25CB | a customer waits for you (magenta), or a chore (grey) | 13, 15, 17 px, at 600–700 | **SF Pro Bold** (en/es/fr/ar), **Noto Sans SC SemiBold** (zh) | `signalMark`, `todoMark` (`layout.ts:232-241`), `::before` on pills and values (`layout.ts:250-268`), rail count |
| ✓ U+2713 | it went / it is on | 13, 15, 17 px | SF Pro Bold / Noto Sans SC (zh) | same mechanism |
| ✕ U+2715 | failed | (no failure in the seed) | — | `tokens.ts:276` |
| › U+203A | a door: opens something | 17 px (doors); 15 px (fold markers) | Noto Sans / Noto Sans Arabic / Noto Sans SC | `layout.ts:177`, `.go` 17 px (`layout.ts:683`), `summary::before` (`layout.ts:1028`) |
| ‹ U+2039 | back | 17 px | Noto | `layout.ts:195` |
| ⌄ U+2304 | an open fold | (no fold open in the crawl) | — | `layout.ts:1029` |
| ● • | you / them in the timeline | — | — | `conversations.ts:298`, `panes.ts:167` |
| 🇦🇪 (any country) | the customer's country | text size | **Apple Color Emoji** | `inbox.ts:88`, `inbox.ts:1091` |
| 📎 🎤 🖼️ | received file, voice note, photo | (not in the seed) | would be colour emoji | `inbox.ts:388, 491, 502`; `sandbox.ts:443` |
| ▭ swatch | "from a conversation" (calendar key) | CSS box | — | `calendar.ts:519` |

### 3.3 Inconsistencies, with measurements

1. **One meaning, two styles.**
   - The assistant is an outline two-star sparkle SVG in the rail and menus (`icons.ts:44`). Beside everything it wrote, it is a filled four-point ✦ from Zapf Dingbats.
   - "Done" is a ✓ text glyph in SF Pro Bold, but a circled-check SVG in the assistant's menu (`icons.ts:58`, used at `employee.ts:689`), and a shield-check for promises (`icons.ts:79`).
2. **One drawing, several meanings.**
   - The sliders icon means "Settings" in the rail and "One kind at a time" (`employee.ts:681`).
   - The checklist icon means "Setup"/"Checklist" and "Each kind of reply" (`employee.ts:679`).
   - The calendar icon means "Calendar" and "This month" (`employee.ts:694`).
   - The sparkle means "Assistant" and "Name" (`employee.ts:676`).
   - The `coins` icon for "Your price limits" (`factory.ts:769`) is three stacked ellipses, which reads as a database cylinder (see the My business screen).
3. **Near-duplicate drawings for different things.**

   | Pair | Lines | What differs |
   |---|---|---|
   | `regular` / `date-followup` | `icons.ts:41`, `icons.ts:67` | the same turning arrow; radius 8 vs 7 |
   | `box` / `date-sample` | `icons.ts:77`, `icons.ts:63` | the same cube |
   | `play` / `guide` | `icons.ts:59`, `icons.ts:91` | the same circled triangle, offset by 0.2 units |
   | `talk` / `chat` / `date-reply` | `icons.ts:54`, `75`, `66` | three speech bubbles with slightly different tails |
   | `tag` / `date-price` | `icons.ts:62`, `icons.ts:65` | two different price tags; `tag` is used for "What you do", not for a price (`factory.ts:731`) |

4. **Sizes in one product.**
   - Line icons render at 14, 14.3, 18, 22 px (and 20, 24 by CSS), so the on-screen stroke ranges from 1.05 to 2.11 px.
   - The "Customers" heading icon was meant to be smaller (16 px) but renders at 22 px, so the non-clickable heading carries the same icon weight as the links under it.
   - ✦ alone appears at five sizes (13/15/17/20/26).
5. **Glyphs from other fonts sit beside the text.**
   - ○ and ✓ are SF Pro Bold inside Noto Sans lines (13.72 px ink height at 17 px).
   - On Chinese pages the same ○ is Noto Sans SC: larger and thinner, 15.3 px tall at 17 px, and 13.5 vs 12.1 px at 15 px. It looks visibly different from the SemiBold Chinese word beside it.
   - ✦ is Zapf Dingbats everywhere.
6. **Chevrons are small text, not icons.**
   - › at 17 px has 7.06 px of ink: a third of the 22 px row icon at the other end of the same row. It is set 2 px larger than the 15 px row label (`layout.ts:683`), and its ink centre sits 1.6 px below the cap-height centre of the text.
   - In right-to-left it is flipped with `scaleX(-1)` (`layout.ts:684`).
7. **Vertical alignment** (SVG centre minus the label's line-box centre, measured on every row):
   - **One-line rows:** within 0.13–0.75 px in every language. This is good.
   - **Two-line rows** (a title over a description, e.g. "Products", "Each kind of reply", "This month"): the icon is centred on the pair and sits **11.5 px below the title's centre**.
   - **Rail "Inbox" with its count beneath:** the icon sits **10.5–10.6 px below the word "Inbox"**.
   - So a column of menu rows mixes icons level with their label and icons a full line lower.
8. **The rail's left edges.**
   - Labels start at three x positions: 58 px (top-level), 54 px (the 13 px "Customers" heading, gap 8 instead of 12) and 70 px (Inbox and Calendar, indented). Icons start at two (24 and 36 px).
   - Row heights come in three sizes: 38, 44 and 59.3 px.
9. **Missing icons.** No menu row lacks its icon (every `.srow` on Settings, Setup, My business, Your assistant, Your data and Getting started has one). Icons are absent wherever a **state** is shown: the state uses a font glyph instead. "✓ WhatsApp" and "○ 3 of 5 steps done" sit at the end of rows that start with an SVG. The only list mixing icon and no-icon rows is the Inbox, where one regular customer carries the 14.3 px mark, by design.
10. **Emoji survive.** The country flag (`inbox.ts:88`) renders as an Apple Color Emoji beside the customer's name. 📎, 🎤 and 🖼️ are still in the source of the conversation and Practice bubbles (`inbox.ts:388, 491, 502`; `sandbox.ts:443`). `icons.ts:7` says V1 removed emoji because they "drew differently on every device".

---

## 4. What reads as cheap (measured)

1. **Only two weights render in the app.** 700 draws the SemiBold 600 face (identical ink, 7,287 vs 7,287), and 500 draws Regular. A 20 px page title, a 15 px row label and the 17 px brand are all the same SemiBold, so emphasis comes from size alone.
2. **Flat scale.**
   - 54 % of app text is 15 px, and titles are 20 px (×1.18 over 17, ×1.33 over 15).
   - Section `h2` is 17 px, the same as body.
   - On Today the 26 px section heading is bigger than the 20 px page title.
3. **Headings keep body line height:** 1.5/1.7/1.75. A 26 px heading sits in a 39 px line (45.5 px in Arabic), so wrapped headings look loose.
4. **✦, the assistant's own mark, is drawn by Zapf Dingbats** at five sizes, on every page and in every language. It is filled, while the assistant's menu icon is an outline.
5. **○ and ✓ are SF Pro Bold glyphs inside Noto text.** On Chinese pages ○ switches to Noto Sans SC: 1.6 px taller at 17 px and thinner. The waiting mark looks different per language.
6. **Line-icon strokes vary 2:1 on screen** (1.05 px on calendar badges and the Inbox regular mark, 1.65 px in menus, 2.11 px on the active rail item), because one 1.8-unit stroke is scaled to 14–22 px boxes.
7. **Door chevrons › are 7 px of ink** at the end of rows whose leading icon is 22 px. They are also 2 px larger than the row's own label.
8. **Two-line menu rows and the rail's Inbox drop the icon 10.5–11.5 px below the label** they belong to, while one-line rows sit within 0.75 px.
9. **The rail has three label left edges (54/58/70 px) and three row heights (38/44/59.3 px).** The "Customers" heading's icon renders at 22 px instead of its intended 16 px, so a heading looks like a link.
10. **The site and legal pages are not in the product's typeface.** They are SF Pro, SF Arabic and PingFang on this Mac, and Roboto or Segoe UI elsewhere (inferred). The step from the site to "Sign in" changes the font.
11. **Chinese names on non-Chinese pages are PingFang** (system) next to Noto Latin in the same line, as in the rail's business name.
12. **Native 13 px radio buttons sit beside 17 px SemiBold labels** on Your assistant. Inputs alternate between 15 and 17 px text.
13. **One emoji flag remains** (Apple Color Emoji; on Windows it shows as the letters "AE", inferred). Three more emoji are in the source.
14. **The same icon is reused for unrelated rows** (sliders, checklist, calendar, sparkle), and near-identical icons are used for different things (cube, turning arrow, circled play). Icon meaning does not carry from page to page.

---

## 5. Method

- **Browser:**
  - Playwright 1.63 Chromium headless shell 153.0.8010.12, on macOS (Darwin 25.6). WebKit is not installed, so Safari was not measured. Nothing was installed for this report.
  - No Noto Sans / Sans SC / Sans Arabic / Serif / Naskh is installed locally (checked with `fc-list`), so every Noto glyph came from the served files.
- **Instance:** `http://127.0.0.1:8787` (the `v6-inv` worktree, `d3a7cdca`), signed in with the local demo access code, language set by the `yf_locale` cookie.
- **Pages:**
  - door `/login`, `/signup`;
  - public `/site`, `/privacy`, `/terms`, `/data-deletion`;
  - owner `/app`, `/app/inbox`, one conversation, `/app/calendar` (list, week, day, month), `/app/settings`, `/app/settings/setup`, `/app/business`, `/app/employee`, `/app/products`, `/app/knowledge`, `/app/sandbox`, `/app/guide`, `/app/settings/data`, `/app/onboarding`.
  - Each was measured in en, zh, ar, es and fr at 1280 and 390 px: 216 page loads.
- **Fonts:**
  - The network log of font and stylesheet responses, and `document.fonts`.
  - `CSS.getPlatformFontsForNode` (CDP) on every visible text element and every `::before`/`::after`, at 1280 px.
  - Every symbol glyph was wrapped in its own span to ask which font drew that character alone.
- **Type scale:**
  - Every element with visible text was read through `getComputedStyle`: size, weight, line height, letter-spacing, family and style. Counts were kept by element and by character.
  - Weight rendering was checked by ink coverage: the same string drawn on a canvas at 40 px per family and weight.
- **Icons:**
  - Every visible `<svg>`: box, viewBox, computed stroke, colour and container. Vertical offsets were taken against the nearest label's line box and cap height.
  - Symbol glyphs: ink height and ink centre from `measureText`.
  - Rail and menu x positions from bounding boxes.
  - Crops were looked at by eye to confirm (not committed).
- **Scratch files** (scripts and raw JSON) live outside the repo, in the session scratchpad under `v6/inv-type/`.
