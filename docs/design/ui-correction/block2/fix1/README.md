# Block 2 fix round 1 — matched builder evidence

Before: `73a4cd39` (Block 1 CI fix merged, before this fix round).
After: `f18fc5bf` (items 1–7 implemented). Captured 2026-11-15.
The baseline copy matched all 651 tracked source files at its stated commit.
Both local apps used the same synthetic fixture, including the same Today draft.
No message, order, or question was submitted during these captures.

There are 64 before/after pairs and two additional one-column Today views.
Each of the 130 retained images was opened whole during builder review.
[manifest.json](manifest.json) records dimensions and SHA-256 for every image.
This set records visual changes; the full five-language, script-on/off R-1 sweep,
final full four, pre-pilot, and independent verification remain pending.
The waiting-reply conversation band will receive its final state coverage with R-1.

## Reading the images

- `1440`: 1440×900, with whole-page captures for Today, Inbox, Ask and Practice.
  In the whole Practice capture, the fixed sidebar reflects the scrolled card position.
- `390`: 390×844; `320`: 320×568.
- `zoom200`: 720×450 CSS pixels at device scale factor 2, the 200% layout equivalent
  of a 1440×900 viewport. Desktop Chromium emulation, not a real phone keyboard check.
- `focus`: Today after focusing its reply box. The changed scroll margin leaves the
  box and decision controls above the bottom navigation.
- `mail-open`: the same long message opened using its native summary; the original
  body remains intact. Native scrolling and focus can change the captured scroll offset.
- `order-other`: scrolled to the separate takeover action, so both “Hand to me”
  actions and their different consequence lines can be reviewed together.

The Practice fixture deliberately combines an injected pending draft with a
model-unavailable handoff. It shows styling, not proof of a real contradictory state.
Arabic screenshots retain existing untranslated catalogue strings. The Ask paragraph
now gives those English strings their own direction and preserves punctuation.

## Observations and limits

Practice now has one primary decision action, secondary alternatives, and an outlined
consequential reset. Folded email text uses the same 17 px size as its opened body and
ordinary messages. At 320 px, all five tab labels are complete. Phone headings,
search placeholders, select height, quiet stage facts, and Today focus placement
show the scoped polish. Both order actions remain and have their own explanations.

No horizontal page overflow was measured in the 48 main after cases. The order's
figures and warnings are not all visible on arrival at short viewports; that existing
review item stays open. These captures do not establish the R-1 result or owner acceptance.

## Action inventory

[The comparison](action-comparison.json) covers six pages × two languages × four sizes.
It compares multisets of all forms, fields, buttons and links inside `main`, including
form methods/targets, hidden values, required/max/pattern constraints, button commands,
form overrides, disabled/confirmation flags, and link targets. Hidden controls count too.
Button and link labels normalize whitespace and retain their first 80 characters.

All 48 cases retain every inventoried entry. Only the localized non-submit “Show less”
button at the end of the whole email is added (one per email case; eight cases).
This is DOM preservation evidence, not a claim that each business action was executed.
Navigation visibility, focus, script-off behavior and all conversation states remain
part of the final R-1 and independent checks.

## Matched images

| View | English before | English after | Arabic before | Arabic after |
| --- | --- | --- | --- | --- |
| today · 1440 | [before](before/en/today-en-1440-full.png) | [after](after/en/today-en-1440-full.png) | [before](before/ar/today-ar-1440-full.png) | [after](after/ar/today-ar-1440-full.png) |
| today · 390 | [before](before/en/today-en-390.png) | [after](after/en/today-en-390.png) | [before](before/ar/today-ar-390.png) | [after](after/ar/today-ar-390.png) |
| today · 320 | [before](before/en/today-en-320.png) | [after](after/en/today-en-320.png) | [before](before/ar/today-ar-320.png) | [after](after/ar/today-ar-320.png) |
| today · zoom200 | [before](before/en/today-en-zoom200.png) | [after](after/en/today-en-zoom200.png) | [before](before/ar/today-ar-zoom200.png) | [after](after/ar/today-ar-zoom200.png) |
| inbox · 1440 | [before](before/en/inbox-en-1440-full.png) | [after](after/en/inbox-en-1440-full.png) | [before](before/ar/inbox-ar-1440-full.png) | [after](after/ar/inbox-ar-1440-full.png) |
| inbox · 390 | [before](before/en/inbox-en-390.png) | [after](after/en/inbox-en-390.png) | [before](before/ar/inbox-ar-390.png) | [after](after/ar/inbox-ar-390.png) |
| inbox · 320 | [before](before/en/inbox-en-320.png) | [after](after/en/inbox-en-320.png) | [before](before/ar/inbox-ar-320.png) | [after](after/ar/inbox-ar-320.png) |
| inbox · zoom200 | [before](before/en/inbox-en-zoom200.png) | [after](after/en/inbox-en-zoom200.png) | [before](before/ar/inbox-ar-zoom200.png) | [after](after/ar/inbox-ar-zoom200.png) |
| ask · 1440 | [before](before/en/ask-en-1440-full.png) | [after](after/en/ask-en-1440-full.png) | [before](before/ar/ask-ar-1440-full.png) | [after](after/ar/ask-ar-1440-full.png) |
| ask · 390 | [before](before/en/ask-en-390.png) | [after](after/en/ask-en-390.png) | [before](before/ar/ask-ar-390.png) | [after](after/ar/ask-ar-390.png) |
| ask · 320 | [before](before/en/ask-en-320.png) | [after](after/en/ask-en-320.png) | [before](before/ar/ask-ar-320.png) | [after](after/ar/ask-ar-320.png) |
| ask · zoom200 | [before](before/en/ask-en-zoom200.png) | [after](after/en/ask-en-zoom200.png) | [before](before/ar/ask-ar-zoom200.png) | [after](after/ar/ask-ar-zoom200.png) |
| practice · 1440 | [before](before/en/practice-en-1440-full.png) | [after](after/en/practice-en-1440-full.png) | [before](before/ar/practice-ar-1440-full.png) | [after](after/ar/practice-ar-1440-full.png) |
| practice · 390 | [before](before/en/practice-en-390.png) | [after](after/en/practice-en-390.png) | [before](before/ar/practice-ar-390.png) | [after](after/ar/practice-ar-390.png) |
| practice · 320 | [before](before/en/practice-en-320.png) | [after](after/en/practice-en-320.png) | [before](before/ar/practice-ar-320.png) | [after](after/ar/practice-ar-320.png) |
| practice · zoom200 | [before](before/en/practice-en-zoom200.png) | [after](after/en/practice-en-zoom200.png) | [before](before/ar/practice-ar-zoom200.png) | [after](after/ar/practice-ar-zoom200.png) |
| mail · 1440 | [before](before/en/mail-en-1440.png) | [after](after/en/mail-en-1440.png) | [before](before/ar/mail-ar-1440.png) | [after](after/ar/mail-ar-1440.png) |
| mail · 390 | [before](before/en/mail-en-390.png) | [after](after/en/mail-en-390.png) | [before](before/ar/mail-ar-390.png) | [after](after/ar/mail-ar-390.png) |
| mail · 320 | [before](before/en/mail-en-320.png) | [after](after/en/mail-en-320.png) | [before](before/ar/mail-ar-320.png) | [after](after/ar/mail-ar-320.png) |
| mail · zoom200 | [before](before/en/mail-en-zoom200.png) | [after](after/en/mail-en-zoom200.png) | [before](before/ar/mail-ar-zoom200.png) | [after](after/ar/mail-ar-zoom200.png) |
| mail-open · 1440 | [before](before/en/mail-open-en-1440.png) | [after](after/en/mail-open-en-1440.png) | [before](before/ar/mail-open-ar-1440.png) | [after](after/ar/mail-open-ar-1440.png) |
| mail-open · 390 | [before](before/en/mail-open-en-390.png) | [after](after/en/mail-open-en-390.png) | [before](before/ar/mail-open-ar-390.png) | [after](after/ar/mail-open-ar-390.png) |
| mail-open · 320 | [before](before/en/mail-open-en-320.png) | [after](after/en/mail-open-en-320.png) | [before](before/ar/mail-open-ar-320.png) | [after](after/ar/mail-open-ar-320.png) |
| mail-open · zoom200 | [before](before/en/mail-open-en-zoom200.png) | [after](after/en/mail-open-en-zoom200.png) | [before](before/ar/mail-open-ar-zoom200.png) | [after](after/ar/mail-open-ar-zoom200.png) |
| order · 1440 | [before](before/en/order-en-1440.png) | [after](after/en/order-en-1440.png) | [before](before/ar/order-ar-1440.png) | [after](after/ar/order-ar-1440.png) |
| order · 390 | [before](before/en/order-en-390.png) | [after](after/en/order-en-390.png) | [before](before/ar/order-ar-390.png) | [after](after/ar/order-ar-390.png) |
| order · 320 | [before](before/en/order-en-320.png) | [after](after/en/order-en-320.png) | [before](before/ar/order-ar-320.png) | [after](after/ar/order-ar-320.png) |
| order · zoom200 | [before](before/en/order-en-zoom200.png) | [after](after/en/order-en-zoom200.png) | [before](before/ar/order-ar-zoom200.png) | [after](after/ar/order-ar-zoom200.png) |
| order-other · 1440 | [before](before/en/order-other-en-1440.png) | [after](after/en/order-other-en-1440.png) | [before](before/ar/order-other-ar-1440.png) | [after](after/ar/order-other-ar-1440.png) |
| order-other · 390 | [before](before/en/order-other-en-390.png) | [after](after/en/order-other-en-390.png) | [before](before/ar/order-other-ar-390.png) | [after](after/ar/order-other-ar-390.png) |
| focus · 320 | [before](before/en/focus-en-320.png) | [after](after/en/focus-en-320.png) | [before](before/ar/focus-ar-320.png) | [after](after/ar/focus-ar-320.png) |
| focus · zoom200 | [before](before/en/focus-en-zoom200.png) | [after](after/en/focus-en-zoom200.png) | [before](before/ar/focus-ar-zoom200.png) | [after](after/ar/focus-ar-zoom200.png) |

## One-column Today

[English](after/today-one-column-en-1440.png) · [Arabic](after/today-one-column-ar-1440.png).
The owned fixture briefly had Books disabled for these two captures and was restored
before the matched set. The 44 px help target stays within the 840 px content column
in both directions; neither case had horizontal overflow.

The earlier [F13 pane set](../fix1-pane/README.md) records closed/loading/open/error
at 1440, 1280, 390 and 320 from `22bd0cb9`, before the final polish commit. Its source
head is intentionally distinguished from this set.
