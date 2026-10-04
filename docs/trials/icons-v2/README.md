# Nav icons, second round (branch `trial/icons-v2`, not merged)

This is a throwaway preview of the nav icons only. The font is parked: every word is the app's Noto, through the app's own stylesheet.

The preview lives at one address, `/dev/trial2`:
- nothing links to it;
- it exists only on a local instance started with `TRIAL_ROUTES=on` (never in production);
- it needs a signed-in owner.

## Run it
1. `TRIAL_ROUTES=on bash .claude/skills/run-nomi/smoke.sh`
2. Optional: `MIGRATE_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/nomi node tools/seed-usability.mjs`
3. Open `http://127.0.0.1:8787/login?with=code` and sign in with the code `smoke-code`.
4. Open `http://127.0.0.1:8787/dev/trial2`.

## What it shows
- **The real nav, six times:** A and B side by side, once for each Today candidate. Every other icon stays the same within a family.
- **A close-up** of the six Today rows, at twice the size (1.2 times on a phone).

| | A — Phosphor 2.1.1, regular | B — Solar (480 Design), Linear |
|---|---|---|
| Today 1, a calendar with today marked | calendar-dot | calendar-mark |
| Today 2, a rounded house | house-simple | home-2 |
| Today 3, a soft ring | circle | record |
| Customers (heading) | users (bold, 18 px) | users-group-rounded (18 px) |
| Inbox | tray | inbox |
| Calendar | calendar-dots | calendar |
| Assistant | user-circle | user-circle |
| Settings | gear-six | settings |

**Calendar** uses the drawing with a grid of dates in both sets. If it were also a plain calendar, it would read the same as Today 1's calendar with a dot.

**Today 3 is a ring, not a filled disc.** In this app a solid disc already means "needs you".

## Measured on the served page (Chromium, 1280 and 390 px)

- **The six navs and their words:** all six render; every word is in Noto Sans.
- **Size and line:** every icon is 28 px, 15 per cent over the rail's 24, with a 1.75 px line in both sets.
  - Phosphor regular is 16 of 256 units.
  - Solar is 1.5 of 24 units.
  - Phosphor's light weight would be 1.3 px, and its bold 2.6 px.
  - The words' stems are 1.59 px at 500 and 1.9 px at 600.
- **Colour:**
  - At rest every icon is ink `#25201C`.
  - The entry you are on keeps the app's white pill, and its icon turns deep magenta `#6E0C44`, as a line, never filled.
- **Level:**
  - On desktop each icon's centre is 0.6 px from the centre of its word's capitals.
  - On a phone each icon is centred over its word.
- **Rounding:**
  - Solar Linear has round line ends and soft corners.
  - Phosphor has no rounding switch in its package: its regular weight already rounds every line end, joint and box corner. It is shown unchanged.
- **Air:**
  - On desktop each entry is 52 px tall (the app's are 44), with 16 px between icon and word (12 in the app) and 8 px between entries.
  - On a phone each tile is 64 px tall, with 8 px between icon and word.

## Screenshots (2× pixel density)
| What | Desktop | Phone |
|---|---|---|
| The two nav sets with each Today option (the whole page) | `nav-sets-desktop.png` | `nav-sets-phone.png` |
| The Today options, close up | `today-options-desktop.png` | `today-options-phone.png` |

## Licences
- **Phosphor:** MIT (`assets/icons/PHOSPHOR-LICENSE.txt`, already in the app).
- **Solar** by 480 Design: CC BY 4.0, per `@iconify-json/solar` 1.2.13.
  - It allows commercial use and a public repository, with credit, a link to the licence and a note of changes.
  - All three are in `assets/icons/SOLAR-LICENSE.txt`.
  - The one change: the line width is set by the page instead of in each drawing.
