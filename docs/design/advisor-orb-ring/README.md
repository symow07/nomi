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

## Where the light stops, measured in a real browser

The owner's two limits (2026-10-09): the wash stops before the composer, and never reaches the nav. Read from the
light's own pixels on the empty page:

| | Short of the rail (desktop) or the nav row (phone) | Above the composer |
|---|---|---|
| Desktop, 1280 × 800 | 287 px | 132 px |
| 13-inch laptop, 1280 × 720 | 287 px | 92 px |
| Phone, 390 wide | 184 px | 150 px |
| Phone, 360 wide | 132 px | 98 px |

On a phone the column's own sides stop it, 8 px inside the screen. The guards hold all of it:
- the wash clear 8 px inside its canvas on both sides and at the top (a 360 px phone included);
- that canvas exactly main's own box;
- every pixel from the bar's line down clear.

No share of the page is counted. The owner: judge it by whether the middle dots are visible and the page still
looks calm.

## My read

- **The middle dots are visible.** The far ink dots, lost before, show against the lighter middle.
- **Calm is the owner's call.** The ring is a larger, more saturated magenta mass than the old light. On a phone
  "Hello" sits just under its fading edge. If it should be quieter, the ring can be narrower or less deep; the
  middle keeps its light either way.

## Files

- **Start here:**
  - `ring-resting-{desktop,phone}-en-closeup.png`: the resting orb, close up (192 px; 144 on a phone).
  - `ring-empty-page-{desktop,phone}-en.png`: the whole empty page.
- `ring-resting-{desktop,phone}-en-wide.png`: the orb and its ring with room round them.
- `ring-thinking-{desktop,phone}-en-closeup.png`: the thinking orb beside the bar, in its pool.
- `ring-light-alone-desktop-en.png`: the light alone (the orb's file blocked: no dots), to judge the ring itself.
- `before-ring-resting-desktop-en-closeup.png`: the same close-up before this change (#266).

The `empty-*` files in `../advisor-orb-dots/` are #266's, before the ring.
