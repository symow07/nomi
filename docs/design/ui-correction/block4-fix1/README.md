# Block 4 fix1 — price and floor on the first screen at 200 %

Base: `ee30979e` (main after #473). Fix: `c2633226` on `ui-block4-fix1`. All data is the synthetic demo workspace.

**The owner's decision (2026-11-18):** at 200 % of 1440×900 the product page's price and lowest price must be on the
first screen in every language. Measured strictly here: a figure counts only if its whole block (label, figure and
the line under it) ends above the top of the fixed phone tab bar (y 381 of 450 at 200 %).

## What was wrong

At the base, at 200 %, the figures ended under the tab bar in **all five languages**, not only es/fr (en 395, ar 417,
zh 409, es/fr 472). At 320 the owner's lowest price was under the bar in every language. Causes:

1. In es/fr the product tabs wrap to two rows: the "?" keeps 52 px clear at the row's end, leaving 636 px; French
   needs 652, Spanish 671 (647 even with 16 px between tabs). The wrap stays; its cost is made smaller.
2. The product's name kept the page title's 24 px below it: the 8 px rule meant for it never applied (the name is a
   grid child of the header, not of the block the rule named).
3. The other-name line had a default 13 px top margin.
4. The other name, code, status and the photo note stood between the name and the figures.

## The fix

- Price and floor follow the name directly; the other name, code, status and the photo note follow them.
- The name keeps its intended 8 px; the other-name line has no top margin.
- The product tabs: 8 px padding (45 px tall, over 44), 8 px between wrapped rows (as the shell's own section tabs),
  24 px below the row.
- Below 600 px the name spans the header; the photo stands beside price and floor.

No type size changed, nothing hidden, nothing specific to a language. The tabs are the product area's own
(`.pa-nav`, built in `productArea.ts` only); below 600 px they are a chooser, so 390 and 320 keep theirs.

## Evidence

- **First screen, strict, owner and staff × en/ar/es/fr/zh × 720×450@2, 1440, 390, 320:** the demo tote bag 25/40 →
  **40/40**; a fixture whose name (and Chinese name) takes two lines at 200 % 20/40 → **40/40**. Staff see no
  lowest price, as before. Rows for 200 % and 320 below.
- **Matched screenshots:** 151 before (`before/`, main's build) and 151 after (`after/`), same names; every after image
  was looked at whole. [Measurements](measurements.md): 147 shots, all 200, no horizontal overflow, **none taller**
  than before.
- **Nothing lost:** forms, fields, buttons and links of 10 product-area pages (the catalogue included), owner and
  staff, against main: 20/20 identical.
- **Guarantees** (44 px targets, overflow, contrast, rule 38, reduced motion, under the bar): 15 product-area pages
  (the catalogue and the fixture included) × 5 languages × 1440, 200 %, 390, 320 × owner and staff = 600 views: 0
  non-200, 0 overflow, 0 low contrast, 0 rule 38, 0 motion, 0 under the bar. **Small targets: 520, all on the
  WhatsApp catalogue page**, its "Open product" links (23 px; 36 in Arabic) — the same at main (unchanged by this
  fix; that page was not in Block 4's sweep). Reported as an open finding, not waived.

The fixture (`Organic Cotton Canvas Tote Bag with Inner Zip Pocket 38x40cm`, Chinese name
有机棉帆布手提袋，内侧带拉链口袋，三十八乘四十厘米, price 1.25, lowest price 0.95) was added through the app's own add page,
Details form and price-limits form, in the local demo database.

### Where the figures end at 200 % and 320 (y; bar top in the third column)

| Product | State | Bar | Figures end, before → after | Before → after |
| --- | --- | --- | --- | --- |
| demo tote | owner en 720 | 381 | 395 → 279 | OUT → in |
| demo tote | owner en 320 | 499 | 521 → 380 | OUT → in |
| demo tote | owner ar 720 | 381 | 417 → 297 | OUT → in |
| demo tote | owner ar 320 | 499 | 534 → 407 | OUT → in |
| demo tote | owner es 720 | 381 | 472 → 332 | OUT → in |
| demo tote | owner es 320 | 499 | 545 → 404 | OUT → in |
| demo tote | owner fr 720 | 381 | 472 → 332 | OUT → in |
| demo tote | owner fr 320 | 499 | 521 → 380 | OUT → in |
| demo tote | owner zh 720 | 381 | 409 → 291 | OUT → in |
| demo tote | owner zh 320 | 499 | 509 → 362 | OUT → in |
| demo tote | staff en 720 | 381 | 395 → 279 | OUT → in |
| demo tote | staff en 320 | 499 | 449 → 308 | in → in |
| demo tote | staff ar 720 | 381 | 417 → 297 | OUT → in |
| demo tote | staff ar 320 | 499 | 456 → 330 | in → in |
| demo tote | staff es 720 | 381 | 395 → 279 | OUT → in |
| demo tote | staff es 320 | 499 | 449 → 308 | in → in |
| demo tote | staff fr 720 | 381 | 395 → 279 | OUT → in |
| demo tote | staff fr 320 | 499 | 449 → 308 | in → in |
| demo tote | staff zh 720 | 381 | 409 → 291 | OUT → in |
| demo tote | staff zh 320 | 499 | 433 → 287 | in → in |
| two-line fixture | owner en 720 | 381 | 426 → 310 | OUT → in |
| two-line fixture | owner en 320 | 499 | 667 → 411 | OUT → in |
| two-line fixture | owner ar 720 | 381 | 454 → 335 | OUT → in |
| two-line fixture | owner ar 320 | 499 | 707 → 483 | OUT → in |
| two-line fixture | owner es 720 | 381 | 503 → 363 | OUT → in |
| two-line fixture | owner es 320 | 499 | 691 → 435 | OUT → in |
| two-line fixture | owner fr 720 | 381 | 503 → 363 | OUT → in |
| two-line fixture | owner fr 320 | 499 | 667 → 411 | OUT → in |
| two-line fixture | owner zh 720 | 381 | 444 → 326 | OUT → in |
| two-line fixture | owner zh 320 | 499 | 636 → 432 | OUT → in |
| two-line fixture | staff en 720 | 381 | 426 → 310 | OUT → in |
| two-line fixture | staff en 320 | 499 | 595 → 339 | OUT → in |
| two-line fixture | staff ar 720 | 381 | 454 → 335 | OUT → in |
| two-line fixture | staff ar 320 | 499 | 630 → 406 | OUT → in |
| two-line fixture | staff es 720 | 381 | 426 → 310 | OUT → in |
| two-line fixture | staff es 320 | 499 | 595 → 339 | OUT → in |
| two-line fixture | staff fr 720 | 381 | 426 → 310 | OUT → in |
| two-line fixture | staff fr 320 | 499 | 595 → 339 | OUT → in |
| two-line fixture | staff zh 720 | 381 | 444 → 326 | OUT → in |
| two-line fixture | staff zh 320 | 499 | 561 → 357 | OUT → in |
