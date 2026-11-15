# Block 3 — matched builder evidence

Baseline: `c4983f7eaf71d4451dfa73242ec93454fa86cafb`. Source checkpoints: F15 `444bd2b8`, F16 `e266fa71`, F40 `6483b487`, F41 `344a7eed`. The visual corrections in this evidence commit follow those checkpoints. No PR, merge or deployment is included.

There are **186 matched before/after pairs and 88 additional state images**. Every retained image was opened whole, including replacements after the final visual corrections. [Image index](images.md), [image/source hashes](manifest.json), [capture measurements](measurements.json), [action comparison](action-comparison.json), and [browser checks](browser-checks.json) make the evidence traceable.

## What changed

| Finding | Matched measurement and behavior |
| --- | --- |
| F15 — records | English customer page at 1440: 2833 → 939 px document height; order: 1471 → 900 px. Identity, current stage, relevant product and the main action fit the first viewport in the measured five-language 320/720 cases. Profile, activity, prices, privacy, order updates, recorded history and proforma remain reachable through native disclosures. Urgent deletion remains open; staff retain their narrower permissions. Order value stays explicitly separate from money received. |
| F16 — saved replies | English browser at 1440: 2151 → 1528 px. The permanent creation form is replaced by an explicit create page; search includes title and all five language texts, including archived replies. Save, Cancel and Archive/Restore are grouped. Actual create/edit/archive/restore and proforma download checks pass with and without script. Saving a reply sends nothing. |
| F40 — Calendar | Month, date selection, filters and the mark key share one context header. The full names wrap; each week grows only for its own content. English and Arabic at 1440 have week heights **127.50 / 127.50 / 349.02 / 159.67 / 127.50 / 127.50 px**. A crowded week is taller by design. The existing three events, or two plus a count when crowded, remains: this fixture's ten entries show two and “+8”, opening all ten in the agenda. |
| F41 — follow-ups | English first contact moves from y=690.16 → 424.56 at 1440, and y=770.38 → 513.98 at 390. The two-email draft page moves from 2378 → 1103 px at 1440. Saved steps read as a timeline; a blank next editor opens only on request. Recipient/channel, consent wording, suppression, approval ownership, frozen approved text, ten-step limit and confirmation controls remain. |

The calendar agenda has space for full text independently of translated action buttons. The 320 px Arabic body measured 0 → 174 px in the diagnostic before/fix probe. Order avatars no longer shrink under the heading (390 px heading starts at x=72 after a 44 px avatar and 12 px gap). Contacts Search and Clear wrap within the content edge in all five languages.

At short widths the scoped pages scroll in a region above the natural-height tab row. Native keyboard focus receives enough scroll margin to reveal reply fields with script disabled. Stopped/archived rows keep explicit state labels and readable contrast; calendar date, face, count and remove targets have a 44 px minimum.

## Calendar decision retained for owner review

The older rule 26 text describes retired week/day/list views. The recorded 2026-10-04 owner correction and current code use one month-plus-agenda screen. Supervisor direction preserves that screen and every legacy redirect; `CLAUDE.md` is unchanged.

The earlier product decision that no name is cut also remains. An intermediate equal-fraction week layout made all six weeks 349.02 px; removing the shared sizing restored independent heights listed above. That intermediate layout is not the c4983f7e baseline. The owner may later choose compact cells. This block does not make that change. The existing narrow-screen grid keeps names accessible with faces and shows the complete names in the leading agenda.

Solid conversation edges, dashed owner-added edges, promised-date source/column meaning, Today and the neutral selected-day ring are retained. No-script checks at 1440/320/720 in English and Arabic verify aligned columns, the ten-entry overflow door, date choice and filters. The narrow month grid scrolls inside its shaded frame to retain usable targets.

## Coverage and limits

- Main capture matrix: 15 pages × English/Arabic × 1440×900, 390×844, 320×568, 720×450 at scale 2, and 980×900 = 150 pairs. Six length-sensitive pages × Spanish/French/Chinese × 320/980 = 36 more pairs.
- `zoom200` is the 200% layout equivalent of a 1440×900 viewport, using desktop Chromium emulation. It is not a physical phone or operating-system keyboard test.
- Phone images show the viewport of the content scroll region. They are not a claim that all content fits without scrolling. Additional state images show the expanded forms, privacy controls, history, send explanations and sequence confirmations.
- The same synthetic fixture backed both revisions, with owned Postgres, one local app and one fresh headless browser at a time. No worker or real provider ran. The existing directory integration name, cost guidance and help link remain functional copy. Some existing catalogue strings are still English in other locales.
- Action inventory: 15 pages × owner/staff, before and after. The old list/create form maps to the union of the new list and create pages. Owner contracts 334 → 338; staff 314 → 318; **zero lost**. Added entries are search form, query field, Search button and editor Cancel. This compares DOM contracts, not execution of every business command.
- Final state checks: **60/60**, owner English and staff Arabic, script on/off, 320 px. Corrected flow checks: **8/8**, including native form association, archive confirmation, download matching the on-page document, configured/unreadable directory, and eight outreach-off routes returning 404.
- Rest quality sweep: **225 views** (15 pages × five languages × 1440/320/720), zero measured contrast, root overflow, horizontal control clipping or tab-row overlap issues. It found two instances of one 39.05 px Chinese count link; the corrected 44 px minimum passes both targeted rechecks. Expanded-control sweep: **120/120** views without those issues. These are computed-style/geometry probes plus whole-image review, not a claim of complete assistive-technology certification.
- Earlier failed probe evidence is retained privately. Corrections: use `category`/canonical `who` on legacy Calendar URLs; staff privacy anchor is `#opt-out`; click the app's archive dialog; use an unreadable ciphertext with the schema's required prefix. A real script-off focus issue was reproduced and corrected. Invalid saved-reply and sequence POSTs still do not retain unsaved fields; this existing limitation is unchanged.

The focused tests passed before this evidence freeze. Two existing design pins changed with reasons written in the tests: the permanent saved-reply editor expectation, and the calendar legend's old below-content position. No other pin was loosened.

**Verification at this freeze:** full check/trust/build/isolated integration and scripted pre-pilot are next in the supervisor-granted quiet slot. Independent verification and owner review remain separate and pending. Their results will be appended against the exact tested revision.

## Corrections after the first full run

The original capture revision is `70b34c16`. Its full four exposed product token/icon/radius/waiting-marker defects and two obsolete test assumptions. [The correction supplement](check-corrections/README.md) records the causes, named pin changes, three-repeat O2 evidence and **54 additional images**, all opened whole. Its source hashes keep the later visuals separate from the original 460 images. The customer overview's order reference remains only inside Products and price; that is explicitly open for design review. A fresh full four and pre-pilot follow on the correction commit.
