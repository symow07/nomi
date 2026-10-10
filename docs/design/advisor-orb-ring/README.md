# The advisor's orb: the light as a ring, lighter behind the dots

Rendered 2026-10-09 in Brave (Chromium; device scale 2) from the build itself, on a local instance with the demo
workspace. **Not merged: waiting for the owner.**

The owner's brief: "Lighten the glow at the orb's centre. Deepest in a ring AROUND the orb, lighter directly behind
it, so the far dots read against it. Keep the fall-off perfectly smooth, no bands, no visible ring edge. Do NOT
touch the library's opacity or drawing."

## What changed

The library's drawing and opacity are untouched. Only the light behind the dots changed. Measured in the radius of
the dots' sphere:

| | Before | Now |
|---|---|---|
| Directly behind the middle | the glow itself, #A1127A | 22 in 100 of the way from the paper to the glow, out to 0.3 of the radius |
| Deepest | at the centre | **#A1127A itself, in a ring at 1.25**, just outside the dots, all the way round |
| Halo | deep from the middle out, gone at 1.42 | a ring too: nothing behind the middle, three quarters at 1.25, gone at 1.6 |
| Field's reach | 2.6 orb radii across, 2.1 up and down | unchanged |

The pool beside the bar (the thinking orb) has the same ring and the same light middle.

Every join (middle to ring, ring to fall, fall to paper) is the smootherstep, flat at both ends, so the light has
no corner anywhere.

## The far dots against it, measured

Each dot of the middle, at the library's own opacity, against what is now behind it (ΔE2000, the four frames used
before):

| | Before (deepest at the centre) | Now (the ring) |
|---|---|---|
| Middle dots below ΔE 10 | 55 % | **22 %** |
| Middle dots, median ΔE | 8.1 | **12.4** |

The near (light) dots stay clear against the lighter middle. The far ink dots can be seen where they were lost.

## Smoothness and bands, measured

- **The steepest step in lightness** is about 1.5 times the old light's:
  - in the test's own page, 2.29 levels of green per device pixel, against 1.32;
  - on screen, 1.7 L* per CSS pixel, against 1.15.
  
  The light has to fall a long way from the light middle to the ring in a short distance; the brief keeps the ring
  round the orb. Of the shapes tried, this one gains the most legibility for the least steepness.
- **Bands:** on every slope no colour holds for more than 4 device pixels. The longest run of one colour (7 px) is
  on the ring's flat top, the glow itself, which is not a step.
- **No corners:** the guard checks how fast the slope itself changes along a line out of the orb, at two scales.
  - The finer one finds a corner where a straight rise meets the flat, which the eye picks out as an edge: 0.083
    here, 0.042 before, and 0.153 for a straight rise, which fails.
  - A hard-edged middle fails both.
- **Guards, broken on purpose:** 64 breaks, each failing its own test. They are every earlier guard of the orb, the
  redesign and the nav mark, plus this branch's own, and the four limits below:
  - the middle as deep as the ring;
  - the middle a hard disc;
  - the ring inside the dots;
  - the halo deep behind the middle, or cornered with three stops;
  - the field forgetting the ring;
  - a straight, cornered rise.

## Bigger: the column lit (the owner, 2026-10-10)

The first tint was too faint. The owner: "the only visible change is a slight pinkness above the orb … Push the tint
much harder … Carry it to all four edges of the column."

- **The centre and the ring are exactly as before:**
  - the same light middle (22 in 100 of the glow);
  - the same #A1127A ring just outside the dots;
  - the same quick fall close round the orb.
- **Under it, the tint:** a second light, laid on whatever the first leaves.
  - **Flat:** at 0.32 of the glow across most of the column.
  - **Fading at the edges:** only in the last 40 % of its reach, which runs to the column's sides, the page's top
    and the composer.
  - **Not behind the middle:** it rises with the ring, so the middle keeps its light.
- **One continuous fall:** every join is the smootherstep, and no pixel is off the line from the paper to the glow (a
  guard).

**How lit the column is**, as depth from the orb's centre toward each edge (0 is paper, 100 the glow), on a desktop:

| | Halfway to the edge | Three quarters | Column lit more than 0.1 |
|---|---|---|---|
| The faint tint (before) | 10–16 | about 1 | 22 % |
| Now | 32–35 | about 20 (8 toward the composer, which is near) | 51 % |

**"Hello" against the light behind it, at worst:** 3.9:1 on a desktop and 3.3:1 on a phone, so no hold-back behind it
was needed. (Stretching the one light instead was tried and rejected earlier: the deep magenta spread and "Hello" sat
on it at 2.2:1.)

**Two shapes, the same strength — the owner's pick.** Both are in `ring-tint-compare-{desktop,phone}-en.png`, side by
side with the faint tint at the same size.
- **A, a rounded box** (`candidate-a-box-empty-page-*`): reaches into the column's corners, but reads as a pink panel
  with straight sides.
- **B, an oval** (the `ring-*` files, and the code on this branch): reaches all four sides of the column and reads as
  light, not a panel. **My pick.** One line changes it to A.

**A bug found and fixed on the way:** the smootherstep could return a hair above 1 at the light's edge. Raised to a
fractional power, that made two black pixels. It is clamped now, and the paper-to-glow guard holds it.

## Where the light stops, measured in a real browser

The owner's two limits: the wash stops before the composer, and never reaches the nav. Read from the light's own
pixels, the outermost a hair from paper:

| | Short of the rail (desktop) or the nav row (phone) | Above the composer |
|---|---|---|
| Desktop, 1280 × 800 | 24 px | 40 px |
| 13-inch laptop, 1280 × 720 | 24 px | 40 px |
| Phone, 390 wide | 24 px | 12 px |
| Phone, 360 wide | 24 px | 12 px |

What holds it:
- **At the sides:** the light ends 8 px inside its canvas, which is main's own box, and main sits beside the rail.
- **At the top:** it ends 8 px under the page's top, which is below the nav row on a phone.
- **At the bottom:** every pixel from the bar's line down is clear.

The guards hold all of it (a 360 px phone included).

No share of the page is counted. The owner: judge it by whether the page feels lit with the theme and stays calm.

## Files

- **Start here:**
  - `ring-tint-compare-{desktop,phone}-en.png`: the faint tint, A and B, side by side at the same size.
  - `ring-empty-page-{desktop,phone}-en.png`: the whole empty page with B, as the code on this branch draws it.
  - `ring-resting-{desktop,phone}-en-closeup.png`: the resting orb, close up.
- `candidate-a-box-empty-page-{desktop,phone}-en.png`: the same page with A.
- `faint-tint-empty-page-{desktop,phone}-en.png`: the faint tint (before this round).
- `ring-resting-{desktop,phone}-en-wide.png`: the orb and its light with room round them (B).
- `ring-light-alone-desktop-en.png`: the light alone (B; the orb's file blocked: no dots).
- `ring-thinking-{desktop,phone}-en-closeup.png`: the thinking orb beside the bar, in its pool (no tint there).
- `before-tint-ring-*`: the ring before any tint (2026-10-09).
- `before-ring-resting-desktop-en-closeup.png`: before the ring (#266).

The `empty-*` files in `../advisor-orb-dots/` are #266's, before the ring.
