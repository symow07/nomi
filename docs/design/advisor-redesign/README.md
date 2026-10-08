# The advisor's page, redesigned

Rendered 2026-10-08 in a real browser (Brave, which is Chromium; device scale 2), from the app's own pages on a
local instance with the demo workspace.

**What reached nothing outside:**
- **The model was scripted.** It answers after 8 seconds, so the glide and the thinking moment can be seen.
- **The history was sealed** with a throwaway key made on this machine.
- **No real model and no production data** were used.

**The greeting says "Hello" alone in these shots.** The demo's owner signs in with the access code, and that
owner's record was born with the business's name. That is not a person's name, so the page greets nobody by
it. A person with their own name on record (every sign-up asks for it) gets "Hello, {name}". The tests hold
both cases.

## The owner's four changes (second round)

Re-rendered on desktop after the owner's four changes:

- **`empty-desktop-en.png`** — the light is softer and closer. #A1127A is still its deepest point, at the orb's
  centre, but it falls three times as fast and reaches only 2.6 orb-radii across and 2.1 up and down. Less
  than a tenth of the page is lit more than a tenth of the way to the glow.
- **`answered-desktop-en.png`** — the page as it opens after two questions:
  - **At its end:** the newest answer's last line is 105 px above the composer. Before, the page opened at
    the top and the answer ran under the composer.
  - **"Ask a follow-up" in the box**, never "Your question". The hidden label for screen readers still says
    "Your question".
- **`answered-short-desktop-en.png`** — after one short answer: the same wide block as a long one.
- **`answered-desktop-en-whole.png`** — the whole conversation: both answers 603 px wide.

**Why no extra padding:** the composer sits in the page's flow, so the end of the page already keeps its
height free. Bottom padding as well would have left an empty band the composer's size. The page opening at
its end is what keeps the last line clear of it.

**The pool beside the small orb is now the glow made thin, never paper.** Before, an answer passing under the
bar showed a pale arc above the orb.

**Banding on the new light:** the longest run of one colour is 3–4 device px on straight lines and 5 on
diagonals. At six times the contrast there are no rings.

**Not yet redone:** the other files below (phone, the other languages, gliding, thinking, the clips) still
show the first round's light. They will be rendered again once these are confirmed.

## Files

- **`empty-{desktop,phone}-{en,zh,ar,es,fr}.png`** — the empty page:
  - the lit field and the orb (192 px; 144 on a phone);
  - the greeting;
  - the bar, its placeholder caught mid-typing;
  - "Earlier conversations" at the top right.
- **`gliding-*`** — just after a question: the orb on its way down beside the bar, the field gathering into it.
- **`thinking-*`** — the orb (64 px) beside the bar, thinking, in its small pool of light. The bar is on clean paper.
- **`answered-*`** — the answer in the conversation, the orb still beside the bar, calm. "New conversation" and
  "Earlier conversations" are at the top right.
- **`card-*`** — the opt-in card (D6), quietly in the conversation after the first answer.
- **`laptop13-{rest,chat}-en.png`** — 1280 × 720. The orb and the bar are both in view, in both states.
- **`*-reduced-motion.png`** — less motion: both states still. The field stays, still; nothing types.
- **`empty-desktop-en-scripts-off.png`** — scripts off: plain paper, the greeting and the bar.
  No orb, no field, no gap.
- **`empty-desktop-en-orb-not-fetched.png`** — the orb's file blocked: the still ground stays; nothing moves.
- **Clips:**
  - `ask-desktop-en.mp4`, `ask-phone-en.mp4` — a question sent for real: the typed placeholder, the glide, the
    thinking.
  - `ask-desktop-en-reduced-motion.mp4` — the same with less motion: the orb is simply beside the bar.

## Banding

Measured on the rendered screenshots, along lines out of the orb until the field meets the paper:

| | Longest run of one colour (straight lines) | Diagonals | Colours along one line |
|---|---|---|---|
| Desktop | 4 device px (2 CSS px) | 6 | 205–399 |
| Phone | 3–5 device px | 4–8 | 100–164 |

Diagonals read a little higher only because a diagonal walk visits some pixels twice.

A crop of the fall boosted to six times its contrast shows grain and no rings. The field's darkest stop is the
orb's glow (#A1127A); it never reaches the "needs you" magenta (#6E0C44), and a test holds that.

## Checked by script

- Every language and view:
  - the orb and the bar are in view;
  - Arabic is right to left;
  - nothing is wider than the screen;
  - no script errors.
- After a question: the orb sits beside the bar; the pool fades before the box's edge.
- The placeholder:
  - it types all three questions;
  - focus clears it at once;
  - the box's text stays empty;
  - it never types while the tab is hidden.
- **The box never changes height while it types.** It was sampled through a whole round in every language,
  desktop and phone: one height each, and the orb never moves.
- With the tab hidden: no frames are drawn; shown again, it resumes.
- Other pages (Home, Inbox, Settings): no canvas, and the orb's file is never asked for.

## Each guard broken on purpose

Twenty-two breaks, one at a time. Each made its own test fail, and the code was restored after each.

- **Less motion:**
  - the orb glides;
  - the orb moves;
  - the placeholder types.
- **The orb's file fails, and the orb glides anyway.**
- **The typing:**
  - focus does not stop it;
  - a hidden tab types;
  - the placeholder becomes the box's text;
  - the box is not held at one height.
- **The light:**
  - no dither;
  - the field reaches the bar;
  - the pool reaches the box.
- **A hidden tab draws frames.**
- **Another page gets the orb.**
- **Scripts off:** the orb, the field or the slot shows.
- **The hidden label:** it is shown, or gone.
- **The greeting names the business.**
- **The second round:**
  - the field spreads, or falls, as before;
  - the pool paints paper;
  - a talking page opens at the top;
  - a short answer is sized to its words;
  - after an answer the box says "Your question".

## Choices worth a look

1. **The field runs under the main column's side padding**, so it fades out rather than ending at an edge.
2. **The field stops 24 px above the bar** and keeps close to the orb: 2.6 orb-radii across and 2.1 up and
   down. So it is wider than it is tall, on a phone too.
3. **The pool beside the bar** is lighter (60 %), drawn as the glow made thin, and stops 4 px short of the
   box's edge.
4. **The glide takes 560 ms**, longer than the app's other motion, because it is the orb's own movement. The bar
   makes room for the orb over the same 560 ms.
5. **The bar has a soft top** (16 px of paper fading in), so a conversation that scrolls under it fades instead
   of being cut.
6. **On a phone the box is two lines tall from the start** in English, Spanish, French and Arabic. One of the
   three questions takes two lines there, and the box keeps that height rather than growing as it types.
7. **Earlier conversations** have their own page (`/app/advisor/earlier`), and deleting one returns there.
