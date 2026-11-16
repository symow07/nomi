# Corrections after the first full run

The main 186 pairs and 88 state images remain the evidence at `70b34c16`. This supplement contains **54 whole-image-reviewed views** for the subsequent corrections, with [source/image hashes](manifest.json) and [measurements](checks.json).

The first full four at `70b34c16` had seven check failures, trust 41/41 scenarios (44 tests) passing, build passing, and isolated integration 2,619 passed / two failed / zero skipped in 333 files. The integration runner stopped and removed its cluster. Failed results are retained by the team.

Four product causes were corrected without weakening their pins:

- The order-history timestamp referenced undeclared `--color-muted`; it now uses `--color-ink-secondary`, measured `rgb(94,94,90)`.
- The customer Orders door used a typed arrow; it now uses the shared Solar `GO`, including its Arabic mirror.
- The sequence marker used a raw radius; `--radius-chip` keeps the same 8×8 circle.
- The customer overview changed `pc-wait` to `ca-wait`, losing the shared waiting-dot and neutral-text treatment. Restoring `pc-wait` restores that treatment. `warmth-faces` is unchanged and passes 5/5.

Two pins changed with reasons written in the tests and supervisor approval:

- `w5-customers.test.ts`, `w4-customers-14`: the mark key is in F40's connected context before the agenda, rather than after its first entry. Existing shown-mark and outside-disclosure assertions remain.
- `o2-long-reference.test.ts`: open `#record-prices` through its summary and require the reference visible. Preserve the complete text, document/body/viewport containment and unchanged desktop layout; also check the actual content region. Its bad-rule control now measures that region's overflow. Before, all three unchanged repeats failed deterministically at en/360/37: the reference reached x=465–467 but the document stayed 360px. After, all three repeats pass, 12 cases each. The bad rule still overflows: 458–467px for 37-character references and 812–820px for 80-character references. The known Arabic desktop timing case was not this failure.

The five corrected parity files pass 139/139 assertions; the corrected build passes. Standard overview geometry passes 50 views. Waiting-state geometry passes another 24 views, with one shared marker on each and the product above the tab row on short screens. Two synthetic pending drafts were inserted only in the owned fixture and removed afterward. These views cover all five locales at 320/720 and English/Arabic at 1440. The 30 other views cover closed/open customer records, Orders links, order history and sequence markers in English/Arabic at 1440/320/720. All are local no-script browser views.

## F15 decision still for design review

On the customer record, the order reference is **not visible at rest in the overview**. Product, stage, value/count and a generic Orders door are there; the selected reference appears only when Products and price is opened. The separate order page still shows its reference near the top. The six `customer-rest` and six `prices` images document this behavior. The test correction does not decide whether the overview should also expose the reference. That remains open for designer/owner review.

A fresh full four and scripted pre-pilot are next on the commit containing these corrections. Focused passes are not a substitute for those checks or independent review.
