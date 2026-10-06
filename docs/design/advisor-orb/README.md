# The advisor's orb, as shipped

Taken 2026-10-07 on a local instance: the demo workspace (synthetic data), Chromium at device scale 2, 1280 and 390 px. The advisor was scripted to take 20 s to answer, so thinking could be seen. No model was asked.

**The owner's picks:**
- the `listening` wave (round one, `round-1-monochrome/`);
- the assistant's magenta `#BE2D6E`, resting at 192 px on desktop and 144 px on phone (round two, `round-2-candidates/`).

The advisor is Nomi talking to the owner, so it wears the assistant's colour.

## The library's own orb; only the colour is ours

`matches-the-library.png` puts three versions side by side:
1. the library drawn by its own painter, in stock grey;
2. the library drawn by its own painter with its own tint option;
3. ours as shipped.

The geometry, dot count, dot sizes, draw order and timing are the library's, unchanged. The script carries the library's painter line for line, with one change: its depth ramp ends at the page's paper `#F7F3EE` instead of white.

The proof: with the paper set to white, ours and the library's painter put down identical pixels. 0 of 524,288 channel values differ across 8 frames, and `tests/parity/advisor-orb.test.ts` asserts the same call for call.

The resting orb is the same 64 px orb drawn at 3× (2.25× on a phone). It is shown larger, not redrawn.

## The two states, both on the advisor's page only

- **Resting:** `resting-{desktop|phone}-{en|zh|ar|es|fr}.png`. While nothing has been asked, the orb sits centred at the head of the page and moves at half the thinking pace. It is centred within 2 px of the page's column.
- **Thinking:** `thinking-{desktop|phone}-{lang}.png`. Once a question is sent, the resting orb gives way. The question goes up, and under it sit the 64 px orb and «Looking through your records…» (in the owner's language) until the answer arrives.
- **Real flow:** `resting-to-thinking-{desktop|phone}-en.mp4`, 5.4 s. A question is really sent while its answer is on its way. Measured on the frames, as the average change in grey level between frames:
  - resting moves at 12.6–14.9;
  - thinking moves at 7.3–8.0 on desktop and 10.9–11.3 on phone.

## Every behaviour, checked

- **Colour.** Every pixel of either orb lies on the line from `#BE2D6E` to the paper. None is the ink, black, or the deep "needs you" `#6E0C44`. This was checked in the page, in all 20 shots.
- **Reduced motion:** `*-en-reduced-motion.png` and `resting-to-thinking-desktop-en-reduced-motion.mp4`. Neither state moves.
  - In the page: one still frame each, and 0 animation frames requested, on both widths.
  - In the recording: resting changes by 0.06–0.09 and thinking by 0–0.05, which is video noise.
- **Hidden tab.** When the page reports itself hidden (the browser's own visibility event), no frame is requested and the orb holds still. Shown again, it moves.
- **First paint.** The page is painted (first paint at 40 ms locally) before the orb's file is requested (47.5 ms). The script asks for it once the page has loaded.
- **Scripts off:** `resting-desktop-en-scripts-off.png`. The resting space is given up (`@media (scripting: none)`). No orb, no gap, and nothing moves later.
- **The orb's file cannot be had:** `resting-desktop-en-orb-not-fetched.png`. The space stays, empty. Nothing is drawn, nothing shifts and there is no error.
- **On every shot:** nothing wider than its screen, Arabic right to left, no script error.

The stills were taken with the question held in the page after the script drew the thinking state. Playwright cannot photograph a page whose navigation is pending; the clips are the real thing.
