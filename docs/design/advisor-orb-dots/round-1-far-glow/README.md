# The advisor's orb, with nothing solid behind the dots

Rendered 2026-10-09 in Brave (Chromium; device scale 2) from the app's own pages, on a local instance with the
demo workspace. The model was scripted (it answers after 8 seconds, so the thinking orb can be caught). Nothing
reached a real model or production data.

## What changed

The owner's brief: "Remove the filled sphere surface entirely. Only the library's dots render. Every dot the
library draws must be visible, including the ones across the middle — nothing occludes them. Keep the magenta
glow behind, exactly as it is now."

- **Gone:** the body (a disc of the glow at 88 % strength, lighter at its top-left and darker at its rim), the
  base falling into shadow, and the soft shadow on the paper under the orb.
- **Kept exactly:** the halo behind the orb:
  - the glow (#A1127A) at three quarters, from the middle out to 0.55 of the orb's radius;
  - then falling to nothing at 1.42 radii.

  The lit field round the resting orb, deepest (#A1127A itself) at the orb's centre, and the small pool beside
  the bar are untouched.
- **The library's drawing is unchanged:** the `composing` state, 566 dots, the same positions, sizes, order and
  timing. The test that compares every call with the library's own painter still passes.

## What the renders show: the middle is still magenta, and why

The dots across the middle are drawn, and nothing is in front of them. But **about half of them cannot be seen**,
and it is not the body that hid them.

The page draws each dot on a ramp:
- a **near** dot gets the light end, `--color-surface` #FFFDFA;
- a **far** dot gets the glow itself, #A1127A;
- in between, a mix by its depth.

So a far dot is the glow's own colour, and in the middle it sits on the glow's own deepest point. Measured over
four frames (566 dots each), against #A1127A:

| Dots | Below 1.1:1 (invisible) | Below 1.5:1 | Median contrast |
|---|---|---|---|
| Across the middle (inside 0.6 of the radius) | 5 % | **53 %** | 1.45:1 |
| All dots | 5 % | 16 % | 2.14:1 |

- **The light dots do not wash out.** The nearest dots reach 4.3–5.3:1 against the deepest glow. The light end
  itself would be 7.2:1.
- **The far dots do.** With the body gone they sit on the field and the halo, which are the same colour.

That is why the middle still reads as a magenta disc. The fix is a different far end for the ramp (for example
the ink, as the library's own black was, or a deeper magenta), and the brief says to ask before inventing a new
ramp. **Not changed here: the owner's call.**

## Files

- `empty-{desktop,phone}-{en,zh,ar,es,fr}.png`: the empty page, resting orb 192 px (144 on a phone).
  `…-orb.png` is the orb alone, close.
- `thinking-{desktop,phone}-{en,zh,ar,es,fr}.png`: just after a question, the 64 px orb beside the bar.
  `…-orb.png` is the orb and its pool, close.
- `empty-desktop-en-orb-not-fetched.png`: the orb's file blocked. What stays is the glow alone: no dots, no
  sphere, nothing moves.

## Guards, each broken on purpose

Every guard of the orb (2026-10-07) and of the redesign (2026-10-08) was broken again against this branch, one at
a time, and failed its own test. So did this batch's own:
- a body comes back (solid, or as a second gradient);
- a shadow comes back;
- the glow behind is shallower, shorter or gone;
- the ground takes the ink.

The list and its results are in the PR.
