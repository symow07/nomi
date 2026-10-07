# The advisor's orb: composing, on its glow

**The owner's pick (2026-10-07):**
- the library's `composing` state, drawn exactly as it ships;
- a magenta glow behind the sphere, `#A1127A`, at medium strength;
- a soft shadow under it.

These were rendered in a real browser (Brave, which is Chromium; device scale 2), from the app's own page on a local instance with the demo workspace. The advisor was scripted to take 20 s to answer, so the thinking state could be seen. No model was asked.

## What is the library's, and what is ours

**The library's, unchanged.** This is `thinking-orbs` 0.3.2, the newest release, in its `composing` state at its tuned 64 px preset:
- 12 lanes of 44 dots in a sash round a sphere, plus 38 faint dots for the sphere behind: 566 dots, and no lines;
- read together, they look like dotted columns, even at the library's own 64 px;
- its geometry, count, placement and timing are the library's own.

With white and black as its two ends, the script makes exactly the calls the library's own painter makes. `tests/parity/advisor-orb.test.ts` holds that.

**Ours:**
1. **The two ends of the depth ramp.** A near dot is the paper's light end, `#FFFDFA`; a far one recedes into the glow.
2. **The ground**, drawn first and never over a dot:
   - a halo of the glow bleeding into the paper;
   - a body light in the middle, shaded to its rim and base;
   - a soft shadow on the paper beneath.

The canvas is half as large again as the orb, so the halo and shadow have room. That margin takes no space in the page: the resting orb still occupies 192 px (144 on a phone), and thinking 64 px.

## The colour

`#A1127A` is the palette's `orbGlow`. It is **decorative and the advisor orb's alone**: never a button, chip, pill, state, text or border. `tests/parity/palette.test.ts` holds that:
- it is named only by the orb's form;
- no stylesheet rule paints with it;
- it is never a colour role;
- four magentas is the ceiling: brand, needs, assistant and `orbGlow`.

**"Needs you" `#6E0C44` is never used by the orb**, in any colour stop or any dot. The glow is ΔE₀₀ 12.5 from it.

**The darkest pixels come closest to it, at ΔE₀₀ 4.3–4.5.** Those are at the rim and base, where the medium shading deepens the glow toward the ink (`#6E2154` on desktop). The difference is visible side by side, but the shades are related. Lighter shading would move them away, at the cost of some depth.

## Files

**At rest:** `resting-{desktop|phone}-{en|zh|ar|es|fr}.png`.

**Thinking:** `thinking-{desktop|phone}-{en|zh|ar|es|fr}.png`. For these stills, the question was held in the page right after the script drew the thinking state.

**Reduced motion:** `resting-{desktop|phone}-en-reduced-motion.png` and `thinking-…-reduced-motion.png`.

**With the script off, or the orb's file blocked:** `resting-desktop-en-scripts-off.png` and `resting-desktop-en-orb-not-fetched.png`.

**Clips.** Each records the real flow: resting for about 2.5 s, then a question really sent, then thinking while its answer is on its way. They were recorded through the browser's own screencast.
- `resting-to-thinking-desktop-en.mp4`;
- `resting-to-thinking-phone-en.mp4`;
- `resting-to-thinking-desktop-en-reduced-motion.mp4`. Here the browser sent only 5 frames in 2.6 s, because nothing moved.

## Checked by script, in the browser

| Check | Result |
|---|---|
| 5 languages × desktop and phone | resting 192 px (144 on phone) and moving; thinking 64 px and moving; resting gone once asked; centred; Arabic right to left; nothing wider than the screen; no script errors |
| Reduced motion | both states drawn and still; no animation frame ever asked for |
| Hidden tab | moving before; no frame while hidden; resumed when shown |
| First paint | the orb's file is asked for only after the page's load |
| Scripts off | no orb row, no space kept, nothing moves later |
| The orb's file blocked | the still ground stays in its kept space; no dot, nothing moves, nothing shifts |
| Other pages (Home, Inbox, Settings) | no canvas, and the orb's file never asked for |

**Every guard was broken on purpose, and each failure failed a test (14 of 14):**
- frames while hidden;
- reduced motion ignored;
- the ground drawn over the dots;
- a raw colour accepted for the glow;
- shading toward "needs you";
- the library's geometry changed;
- the file asked for before load;
- a failed canvas removed;
- scripts off keeping the space;
- the glow set to "needs you";
- the glow painting a button;
- a fifth magenta;
- the page script animating outside the orb;
- another page carrying the orb.

## Earlier rounds

- `round-1-monochrome/`, `round-2-candidates/` and `round-3-options/` record each pick.
- `round-2-shipped-listening/` is the listening wave that shipped in #244 before this.
