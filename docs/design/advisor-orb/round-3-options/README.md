# The advisor's orb, round three: pick one

Rendered 2026-10-07 in a real browser (Brave, which is Chromium; device scale 2), from the app's own page on a local instance with the demo workspace. The advisor was scripted to take 20 s to answer, so thinking could be seen. No model was asked.

## What changed from the shipped orb

1. **The state is now `composing`.** It is the library's own multi-band sash wrapped round a sphere, which reads as vertical stripes. Its geometry, dot count, placement and timing are the library's, unchanged.
2. **The light end of the library's own ramp.** The orb is drawn by the library's painter in its dark-page mode: a near dot is light, a far one recedes. The only change is the two ends: the light end (`#FFFDFA`) and the glow it recedes into, where the library has white and black. `matches-the-library.png` shows the proof: given the library's own ends, ours puts down identical pixels (0 of 1,179,648 channel values differ across 8 frames).
3. **A ground under it (ours), drawn first and never over the library's dots:**
   - a deep magenta halo bleeding into the paper;
   - a body light in the middle, darkening toward its rim;
   - its base falling into shadow;
   - a soft contact shadow on the paper beneath.

   The canvas is half as large again as the orb, so the halo and shadow have room. That margin takes no space in the page: the resting orb still occupies 192 px (144 on a phone), and thinking still 64 px.

## The choice: one colour, one strength

`options.png` shows all six side by side, resting at 192 px and thinking at 64 px, with the reserved "needs you" chip underneath for comparison.

| | Colour | ΔE₀₀ from "needs you" `#6E0C44` | ΔE₀₀ from the assistant `#BE2D6E` |
|---|---|---|---|
| **Brand** | `#9A0F5E`, already in the palette | 8.9 | 9.2 |
| **New deep magenta** | `#A1127A`, its own value, a touch toward violet | 12.5 | 10.3 |

ΔE₀₀ above about 10 reads as a clearly different colour at a glance. The orb never uses `#6E0C44`. In the "deep" strength, the darkest part of the rim comes close to that tone; the glow itself never does.

| Strength | Halo | Rim and base darkening | Contact shadow |
|---|---|---|---|
| soft | light | light | faint |
| medium | fuller | moderate | soft |
| deep | strongest | strongest | firm |

## Files

- `resting-{brand|new}-{soft|medium|deep}-{desktop|phone}.png`: the page before a question.
- `thinking-{brand|new}-{soft|medium|deep}-{desktop|phone}.png`: the page while an answer is awaited. For these stills, the question was held in the page right after the script drew the thinking state.
- `clip-{brand|new}-{soft|medium|deep}-desktop.mp4` and `clip-{brand|new}-medium-phone.mp4`: 5.4 s of the real flow. About 2.5 s of resting, then a question really sent, then thinking while its answer is on its way. They were recorded through the browser's own screencast.
- `options.png`, `matches-the-library.png`: as described above.

**Every shot was checked by script:**
- the resting orb is 192 px (144 on a phone) and moving;
- once asked, it is gone, and the 64 px thinking orb is moving;
- nothing is wider than the screen;
- no script errors.

The rest is verified after the pick, as before:
- 5 languages;
- reduced motion;
- pausing in a hidden tab;
- scripts off;
- a failed orb file;
- the guards, each broken on purpose.
