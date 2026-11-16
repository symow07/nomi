# Block 3 — fix round 1

Baseline `3c7c268a`. Product revision `b06c6fca6c1d8d6a1639bc77e6bfbfba2bad5301`. This supplement follows the original Block 3 evidence and the Block 2 fix 3 merge at `2b2d16cb`; it does not rewrite either history.

## Scoped corrections

| Item | Change and evidence |
| --- | --- |
| 1 — latest order | The overview shows the latest reference and its own status below Bought. With one order this replaces the generic Orders door; with several, both remain; with none, neither appears. All statuses count, including shipped and cancelled. Same tenant-scoped read, no migration. Five locales and isolated RTL reference. |
| 2 — calendar names | Owner decision: grid names use at most two lines, with complete accessible name/title and the uncut agenda. Crowded week 349.02 → 298.34 px; empty week 127.50 px and next week 159.67 px remain. The earlier no-cut grid decision in the original README is superseded only for the grid. |
| 3 — legend | The overdue cross now appears in the legend when the calendar draws it; the still-owed group dot remains. No promised-date or edge meaning changes. |
| 4 — native date | At 320 px the field grows to 288 px and the action moves to its own row. All five native date fields fit; 390 and desktop widths stay unchanged. |
| 5 — Arabic options | Each customer option uses value isolation, including script-off. The tester's four-case probe changes from 0/4 to 4/4. |
| 6 — disclosure motion | A real 1 ms reduced-motion margin transition could move boxes by 12 px between readings. The record-summary transition is disabled inside the existing reduced-motion block. The long-reference assertion and negative control are unchanged. The older Arabic width-changing failure family remains unproven and is not claimed fixed. |
| 7 — small polish | Related overview facts stay together; order facts top-align and stages read vertically; order customer link joins the reference; sequence pills align at the edge; replies sort naturally and five populated languages use a compact label; labels, counts and actions are readable; month navigation retains three destinations in one row. |

Named pin changes: `tests/parity/calendar-week.test.ts` and `tests/parity/warmth-calendar.test.ts` replace the superseded no-cut grid expectation with the owner's two-line rule, with reasons in the tests. No motion or long-reference pin changed in this round.

## Coverage and limits

At product revision `b06c6fca`, the serial full four passed: check 10,213 assertions (483 files; 2,617 database assertions intentionally skipped here), trust 44/44, build, and isolated integration 2,622/2,622 (333 files, none skipped; 1,843.51 seconds). Integration covers the database checks. The unchanged o2-long-reference test passed both assertions. Scripted pre-pilot passed 14/14. Each stage logged uptime; the network guard was enabled with NOMI_NETWORK_LOG. The guard emitted no attempt log. Owned servers were stopped after evidence capture.

The initial `9fa92805` run had one phase5-motion failure: the reduced-motion override introduced a second, compactly spelled media block. Its integration still passed 2,622/2,622. The correction moves the same selector into the existing shared reduced-motion block; no test pin changed. All four were then rerun on the corrected product revision above.

Inventory: 300 owner/staff cases per revision, 14,070 → 14,050 entries, no unexpected changes. Forms, fields, buttons and disclosures are identical. The 60 changed cases are exactly the approved single-order link replacement, zero-order door removal and compact reply labels with the same destinations. See [inventory summary](final-inventory-summary.json).

Freeze: 72 baseline + 115 final + 52 detail images. All baseline and final images and 32 distinct details were inspected whole; the other 20 details are byte-identical to reviewed final images. See [image index](IMAGES.md), [hash manifest](images.json) and [detail review](final-supplement-review.json). Final captures measured no horizontal overflow of the real content region. Legend coverage passed 6/6; final reduced-motion probes had zero animations and unchanged positions in English and Arabic.

The final inventory compares both owner and staff across five locales, 1440 and 320, on fifteen routes. It records DOM contracts; it is not execution of every business command. The same synthetic data backs baseline and head. No real provider or delivery worker runs.

Phone captures show the real content scroll region, not every item at rest. Expanded/scrolled states supplement them. The 720×450 scale-2 capture is a 200% desktop layout equivalent, not a physical keyboard test. Existing functional provider copy remains unchanged. Some inherited catalogue strings remain English in other locales.

Deferred designer polish: a shared timing-prose rewrite; a sticky Save bar requiring keyboard/scroll design; More-chevron placement requiring a shared disclosure decision; calendar studio/title ordering requiring shell/accessibility coordination; and replacement of the owner-selected shared promise quote icon. These are open, not accepted or waived.

Builder verification and independent tester/designer acceptance are separate. No main merge, deployment or release sign-off is included.
