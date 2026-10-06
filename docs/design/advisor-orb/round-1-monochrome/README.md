# The advisor's thinking orb — listening or composing

Taken 2026-10-07 on a local instance: the demo workspace (synthetic data), Chromium. The advisor was scripted to take 20 s to answer, so the waiting state could be seen. No model was asked.

**Pick one.** The two candidates differ only in the motion. Size, place, ink and line are the same.

- `listening`: a waveform rolling through the latitude rings of a dotted sphere.
- `composing`: an undulating multi-band sash.

## What to look at

1. `compare-frames.png`: both states side by side at the real size, one frame every 0.3 s. The dashed frame is what a reader who asked for less motion sees, held still.
2. `{state}-desktop-en.mp4` and `{state}-phone-en.mp4`: 3.4 s of a real question being sent, recorded while the answer was still on its way.
3. `{state}-{desktop|phone}-{en|zh|ar|es|fr}.png`: the waiting state in each language and width, as it appears at 1280 and 390 px (device scale 2).
4. `{state}-{desktop|phone}-en-reduced-motion.png`: the same with the browser set to reduce motion.

## How it behaves (the same for either state)

- **When it moves.** Only on the advisor's page, and only once a question is sent. The question goes up as asked. Under it, on the page's paper where the answer will land, appear the orb and a calm line: «Looking through your records…» / 正在查看你的记录…… / «جارٍ البحث في سجلاتك…» / «Buscando en tus registros…» / «Recherche dans vos données…». The answer's page replaces both. Nothing moves before the question is sent, or while the owner reads or types.
- **Size and colour.** 64 px, the library's own chat size. At 32 and 20 px the waves turned to mush. The ink is the page's own `#25201C`, read from the page's variable, fading toward the paper. Measured on the paper `#F7F3EE`:
  - no pixel is lighter than the paper;
  - the darkest is the ink itself (allowing for edge smoothing);
  - no magenta and no `#000`;
  - light mode pinned, never auto.
- **Reduced motion.** One still frame, and no animation frame asked for. This was measured in the page: two captures 0.9 s apart are identical, and 0 frame requests followed the question, at both widths for both states. In a real recording the orb's pixels changed by at most 2 grey levels (video noise) against 139–210 when moving.
- **First paint.** The orb is not fetched while the page is drawn: no request on load (first paint 28 ms, load 37 ms locally). It is fetched once the question box is focused (565 ms, 26,541 bytes, then cached for good). If it cannot be had, the line stays alone, and with scripting off the page works as before.
- **Every shot was checked by script:**
  - exactly one canvas on the page, 64 px, on screen;
  - the requested state drawn;
  - nothing wider than its screen;
  - Arabic right to left;
  - moving in the normal shots and still in the reduced ones.

**How the stills were taken.** Playwright cannot take a screenshot while a page's navigation is pending. So for the stills, the harness held the question in the page right after the product's script had drawn the waiting state. The videos are the real thing: a question really sent, with its answer on its way.

## The library

[`thinking-orbs`](https://www.npmjs.com/package/thinking-orbs) 0.3.2, MIT (Jakub Antalik). Only its drawing core is used: no React, and no build step. It is vendored byte for byte in `assets/vendor/thinking-orbs/0.3.2/`, whose README gives its provenance, digests and size (7,059 bytes gzipped).
