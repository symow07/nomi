# Block 4 — matched builder evidence

Baseline: `fed20578` (main after #472). Source checkpoints: F26 `d06e0292` + `79e265c2` (its labels in five
languages), F27 `0785a480`, F28 `786763ce` + `a4880ade`, then the after-set's corrections (the product area in
five languages, three style corrections).

There are **156 matched before/after images** (`before/`, `after/`, same file names). Every after image was
opened whole. [Measurements](measurements.md) lists the 120 shots that carry a measure: status, document height
and horizontal overflow, before → after. Every after shot answers 200 with no horizontal overflow.

All data is the synthetic demo workspace; nothing in these images is a real person or business.

## What changed

| Finding | Matched measurement and behaviour |
| --- | --- |
| F26 — product page | English at 1440: 4476 → 1884 px; at 390: 4916 → 2258; without a photo at 1440: 3931 → 1747. A header with the photo, name, price and (owner only) lowest price; then Details, Pricing, History. Each group is edited on purpose, in its own form with one Save; a group's form changes only the fields it drew. Photo Save and Remove stand apart. Staff at 1440: 2046 → 1497, still with no form. |
| F27 — add products and import | Add at 1440: 3061 → 1060 px; at 390: 3419 → 1204. One way in open at a time; every form stays in the page and works without script; `?method=`, a refusal, and an older bare `#paste`/`#photo`/`#store`/`#file` link each open their own way. A steps line on add, columns, check and confirm. Columns at 1440: 1565 → 921 (preview beside the mapping, optional columns folded). Check at 1440: 2761 → 2725 (each line as written beside what was read); at 390: 3290 → 3471, the line as written now shown above each row. Confirm at 1440: 900 → 944 (the steps line). |
| F28 — price limits | English at 1440: 3424 → 3027 px. A table: photo, name, price, lowest price, the most that may come off, and where the owner is asked first, aligned across rows; the policy is said once above; each row's door sits under its name; an opened product's form is its own row, named by its product. When the page is narrower than the table, each figure sits under the name with its label: at 390, 3933 → 4725 (English) and 3790 → 4561 (Arabic). The phone page is taller because each figure is labelled; reported as a trade-off. |

## Nothing lost

Owner and staff action contracts (forms, fields, buttons, links) measured against the baseline on every page of
the block. Zero lost, with one ruling: on the add page the four in-page jump links (`#paste`, `#photo`, `#store`,
`#file`) are **replaced, mapped**, each to the chooser title that reaches the same form, proven by keyboard with
script off.

## Coverage and limits

- Main matrix: 7 pages × English/Arabic × 1440×900, 390×844, 320×568, 720×450 at scale 2, 980×900, plus full
  pages at 1440 and 390. Spanish, French and Chinese at 320 and 980 for every page. Staff views of the product and
  add pages in English and Arabic at 1440 and 390.
- Phone full-page images draw the fixed tab bar where the viewport ended; the before-set shows the same.
- "WhatsApp catalogue" stays English in every language: the code marks it `lang="en"` on purpose.
- The rail's "Customers" and "Assistant" in English on other languages' pages are outside this block.
