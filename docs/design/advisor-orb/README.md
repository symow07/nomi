# The advisor's orb, round two: which magenta, and how big at rest

Taken 2026-10-07 on a local instance: the demo workspace (synthetic data), Chromium. The advisor was scripted to take 20 s to answer, so thinking could be seen. No model was asked.

The motion is `listening`, your pick from round one (`round-1-monochrome/`). The orb now has two states, both on the advisor's page only:

- **Resting.** While nothing has been asked, a large orb sits centred at the head of the page, moving gently, at half the thinking pace.
- **Thinking.** Once a question is sent, the resting orb gives way. The question goes up, and under it sit the 64 px orb and «Looking through your records…» until the answer arrives.

## Pick two things

1. **The magenta.** It is the same for both states.
   - Assistant `#BE2D6E`.
   - Brand `#9A0F5E`.
2. **The resting size**, by optical balance against the page:
   - desktop: 144, 192 or 240 px;
   - phone: 112, 144 or 176 px.

   My eye says **192 on desktop and 144 on phone**. At those sizes the orb is about the height of the opening line plus its three examples. It leads the page without pushing the question box below the first screen on a phone.

## What to look at

1. `palette.png`: the two magentas side by side on our paper. Each shows the resting orb (192 px) and six thinking frames (64 px). The reserved "needs you" deep magenta is shown underneath for comparison.
2. `resting-to-thinking-{assistant|brand}-{desktop|phone}.mp4`: 5.4 s each. About 2.5 s of the resting orb, then a real question sent and thinking while its answer is on its way.
3. `resting-{assistant|brand}-{desktop|phone}-{size}.png`: every resting candidate in place.
4. `thinking-{assistant|brand}-{desktop|phone}.png`: thinking in each magenta.

## How the colour is made

The geometry is the vendored core's. The colour is ours: our own painter takes each dot's depth and blends the magenta toward the page's paper `#F7F3EE`, never toward white. The library's grey ink is not used, nor its painter. The near dots carry the full magenta and the far ones fade into the paper. No ink, no `#000`, and never the deep "needs you" `#6E0C44`.

Larger than its tuned 64 px, the orb is drawn at its own size with more dots (the core's own density scaler, size ÷ 80). It is not stretched: a stretched 64 px orb looked coarse at 160 px. The thinking orb stays exactly the library's tuned 64 px design.

## Checked by script, every shot

- the candidate magenta drawn;
- the resting orb at the requested size and moving;
- once a question is sent, the resting orb gone and one 64 px thinking orb moving;
- nothing wider than the screen;
- no script error.

Still to come, after your pick:
- the five languages;
- reduced motion, verified in the page and in a recording;
- the pause while the tab is hidden;
- the guards, and the deliberate breakages that prove them.
