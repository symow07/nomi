# The advisor's orb: one light

Rendered 2026-10-11 in Brave (Chromium; device scale 2) from the build itself, on a local instance with the demo
workspace. **Not merged: waiting for the owner.**

The owner's brief: "Seen live at real size: the glow shows visible rings — a darker band, then the lighter oval around
it, and the outer edge doesn't fade fully into the paper … Rework to a SINGLE continuous fall-off: one gradient, centre
out to nothing, no second layer creating a seam … Keep the lighter centre so the far dots still read, and keep the
magenta spread across the column that I approved — just make it seamless."

## What was making the bands

Three lights were laid on each other (`before-*`):
- **the halo** on the orb's own canvas: the glow at three quarters, in a ring just outside the dots;
- **the near field** on the page: the glow itself (100 in 100) in the same ring, falling steeply;
- **the tint** under both: a flat third of the glow out to 0.6 of the column, then fading.

The steep fall landed on the flat third about 190 px out: that was the darker band, and the lighter oval round it. The
tint's fade then began 330 px out, where the flat stopped: that was the edge.

## What it is now

**One curve, drawn once** (`wash`, `src/api/web/liveScript.ts`):

  light = SPREAD × (1 − s^FALL)³ × rise

- **s** is the distance out to the column's edge, 0 at the orb and 1 at the column's sides, the page's top and the bar
  (an oval).
- **The fall** comes down the whole way from the orb, with no flat stretch. It and its slope are both 0 where it ends,
  so it meets the paper without an edge.
- **The rise** keeps the middle light: 22 in 100 of the glow behind the dots, lifting to the light's full depth by their
  edge.
- **No halo** on the orb's canvas, and no second layer anywhere. The pool round the small orb beside the bar is the
  same curve.

**How deep, in hundredths of the glow** (desktop, 1280 × 800, every 10 px to the right of the orb's centre):

| | Behind the dots | Just outside them | Halfway to the side | Three quarters | The side |
|---|---|---|---|---|---|
| Before | 22 | **100** (the ring) | 32 (the flat tint) | 30 (still flat) | fading |
| Now | 22 | **45** | 32 | 18 | 0 |

The spread the owner approved, a third of the glow halfway to each side, is kept. From there the light keeps falling
instead of holding flat and then dropping.

## Smoothness, measured

- **The steepest step on screen:** 0.4 L* per CSS px. Before, 1.7.
- **The tests' own measures**, along the line out of the orb, before → now:

  | | Before | Now |
  |---|---|---|
  | Steepest step (green levels per device px) | 2.29 | 0.71 |
  | Bend at ±8 px | 0.054 | 0.018 |
  | Bend at ±4 px | 0.083 | 0.056 |

  New limits sit between the two, so the ring and the tint would fail them.
- **No plateau:** past the dots, the light falls by at least a level every 40 px all the way to the paper, on all four
  lines.
- **No bands:** the dither stays. No colour holds for more than 6 device px.

## Where it stops (unchanged)

- 24 px short of the rail on a desktop; 49 px short of the nav row on a phone.
- 40 px above the composer on a desktop; 12 px on a phone.
- 8 px inside its canvas at the sides.

## Files

- `one-empty-page-{desktop,phone}-en.png`: the whole empty page.
- `one-resting-{desktop,phone}-en-closeup.png`: the resting orb, close up; the far dots against the lighter middle.
- `one-thinking-{desktop,phone}-en-closeup.png`: the small orb beside the bar, in its pool.
- `before-*`: the ring and the tint, as live today.
