# The advisor's orb: nothing solid behind the dots, the far dots in ink

Rendered 2026-10-09 in Brave (Chromium; device scale 2) from the build itself, on a local instance with the demo
workspace. The model was scripted (it answers after 8 seconds, so the thinking orb can be caught). Nothing reached
a real model or production data. Round one, with the far dots still in the glow, is in `round-1-far-glow/` with
its own notes.

## What changed

- **Nothing solid.** Gone: the body (with its rim and base shading) and the shadow under the orb.
- **The glow behind is exactly as it was:**
  - the halo;
  - the lit field round the resting orb, #A1127A at the orb's centre;
  - the pool beside the bar.
- **The far dots are drawn in ink #25201C** (the owner's decision), where they were drawn in the glow. A dot's
  colour now runs from the light end (near) to the ink (far), as the library's own runs from white to black.
- **The library's drawing is unchanged:** the `composing` state, 566 dots, the same positions, sizes, order,
  opacity and timing.

## What it does to legibility, measured

Each dot's colour, at the opacity the library gives it, compared with the glow's deepest point (#A1127A), over four
frames (566 dots each):

| Across the middle (inside 0.6 of the radius) | Far end = the glow (round one) | Far end = the ink (now) |
|---|---|---|
| Luminance contrast below 1.1:1 | 5 % | 33 % |
| Luminance contrast below 1.5:1 | 53 % | 55 % |
| Colour difference (ΔE2000), median | 9.3 | 7.7 |
| Colour difference below 5 (barely seen) | 12 % | 10 % |

**The ink does not make the middle readable.** The reason:
- **The back dots are faint by design.** 53 in 100 dots across the middle are at the back of the sphere, and the
  library draws them at under half opacity: its depth cue.
- **A half-transparent dot is half the ground.** Over the glow's deepest point it takes half the glow's colour,
  whatever its own: in ink it is a darker magenta, in the glow it was the same magenta.
- **Grey matches magenta in lightness.** Part-way along the ramp, a grey dot is as light as the glow, so the
  luminance figure drops further, though the eye still sees grey against magenta.

**What the eye sees:** the light dots, now neutral white to grey rather than white to pink, and the middle still
mostly magenta.

What would change the middle, all outside this brief, so not done:
- a lighter glow at the orb's centre (the brief keeps it exactly as it is);
- the library's back-dot opacity (the brief keeps its drawing unchanged);
- a dark ground, which the library was made for.

## Files

- `empty-{desktop,phone}-{en,zh,ar,es,fr}.png`: the empty page, the resting orb at 192 px (144 on a phone).
  `…-orb.png` is the orb alone, close.
- `thinking-{desktop,phone}-{en,zh,ar,es,fr}.png`: just after a question, the 64 px orb beside the bar.
  `…-orb.png` is the orb and its pool, close.
