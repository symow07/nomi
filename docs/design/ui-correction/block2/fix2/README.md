# Block 2 · fix round 2 capture checkpoint

74 whole viewport images, opened and inspected by the frontend: 64 after and 10 before. The final owner-copy update replaces six order views and adds fourteen views; see [owner-copy/README.md](owner-copy/README.md). All customer, conversation and order data are synthetic. Source commits and image hashes are listed individually in [images.csv](images.csv). Captures made immediately before an item commit use that commit when its source is identical to the captured build.

## What changed

- **B2-V01:** the two existing warning lines sit directly above the reply band; the existing product, quantity, unit price and total sit above the order band. No duplicate warnings, figures or commands. The copied arrival probe failed all 80 baseline cases and passes all 80 corrected cases: five locales, 320×568 and 720×450 at device scale 2, script on/off, plain URL/`#latest`, reply/order. The latter viewport is the established 200% equivalent, not a physical device. At 320×568 the warning context adds 96 px to the unchanged 232 px reply band; the four figures add 184 px to the unchanged 104 px order band. At 720×450 those additions are 64 and 128 px. Every required warning/figure and primary action is whole in the sampled cases.
- **B2-V02/V03:** native Back restores the opener, reading position and unsent draft after the browser's fragment navigation. Reduced-motion visibility changes finish before focus returns. Focused Back checks pass 80/80 across eight sizes, five locales and both motion preferences; Escape passes 40/40, plus 15/15 repeated 1280 px cases.
- **F13:** the opener is replaced by the pane's return door at 1440 px. Its label/icon disappear in the same frame, including loading/error. The draft stays at its original vertical coordinate. The failed request supplies an explicit retry button and a full-page link. Return is an anchor with the existing back icon. All 20 focused cases pass, including retained words and restored focus. At 1440 px the measured draft coordinates stay 610.5 px in English and 606 px in Arabic (baseline shifts were −36.80/−43.25 px with these fixtures). The designer's earlier fixture measured −22/−62 px; those are separate fixtures.
- **N1:** phone labels use their complete word width, with no inside-word break. Only French `nav.books` changes: “Comptabilité” → “Comptes”. The full old French set did not fit at 320 px; type remains 13 px. All 20 locale/active-page cases pass with zero horizontal overflow.
- **N2:** the date column takes its text width. French date/chevron gap was −19.05 px in 9 of 11 rows; it is now 12 px in every sampled row in all five locales.

## Reading the images

- `f13-{en,ar}-{320,390,1280,1440}-{closed,loading,error,open}.png`: all 32 final pane states at source `e51f28a7`.
- `arrival-final-{en,ar,fr}-{phone320,zoom200eq}-{draft,order}.png`: 12 arrival examples: reply source `d198eefa`, order source `6c81b12b` after the owner copy decision; four matched baseline phone examples are included. Final arrival positions were re-measured in the full R-1 matrix at `6c81b12b`.
- `n1-{en,ar,es,fr,zh}-320.png`: five complete phone tab bars. The matched French baseline is `design-before-fr-phone320-inbox.png`.
- `n2-before-fr-1440.png` and `n2-after-fr-1440.png`: date and chevron spacing.
- `design-before-{en,ar}-1440-{closed,open}.png`: matched pane baseline.

The review checks the entire viewport, including the return control, labels, draft, warning/figure context, action band and tab bar. Content at a scroll region's edge remains scrollable; these viewport images do not claim that every page section fits at once. The inherited English strings/RTL gaps on Arabic pages remain open. The pane's short loading/error background and 1280 px content indentation remain deferred design items. No physical phone keyboard or touch behavior is claimed.

This is a capture record, not independent acceptance. Final builder R-1 at `6c81b12b` passes 1,760 arrivals, 4,400 scroll samples and 34,324 reachability targets; all 80 contextual arrivals pass. Fresh Back 80/80 and Escape 40/40 also pass. Full-suite and merge results belong to the final handoff. The owner approved the order hints and accepted ruling(a), the script-off tall reply box, on 2026-11-16. Inherited Arabic gaps, Knowledge French at 280, deferred polish and physical-phone coverage remain OPEN.

The final builder inventory compares 560 cases per build against `c4983f7e`: all 43,310 original entries retained, zero missing. The 440 additions are the explicit retry button and full-page recovery link across conversation cases. Existing form commands, fields, confirmation prompts and placeholders are unchanged.
