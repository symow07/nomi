# Motion: what actually moves when Nomi is used

Measured 2026-10-04 on the current code (origin/main `d3a7cdca`), in Chromium (Playwright's build of Chrome), at 1280 px and 390 px, with motion allowed and with reduced motion. Production sends exactly the same stylesheet and script (same file hashes, checked below), so what is measured here is what production sends.

## The answer

- **Motion is wired and it does fire.** The three timings resolve in the browser to 120, 200 and 250 ms, and real elements use all three.
- **Most of it is too small and too quick to notice.** Most of it is an 8 px rise (4 px on a fold) on a curve that finishes about 90% of the change in the first 100 ms. It plays while a page is still appearing, so it reads as "the page loaded", not as movement.
- **Only one thing moves far enough to see clearly.** That is the profile card: it springs up 48 px over 200 ms when you press a face. The other noticeable motions need an event at that moment: the assistant answering (three pulsing dots), a new customer starting to wait while a page is open (a small card rising at the foot of the screen, up to 20 s later), or a slow network (a pulsing "…" on a pressed button).
- **Nine of the twelve kinds of page animate nothing at all when they load.** That covers the Inbox, the calendar, Settings, My business, the assistant, Products, Knowledge, the buyer page and the door. Only Today, a conversation with a pending draft, and Practice while the assistant is at work move on load (and any page carrying a notice after an action). Nothing animates when anything closes or leaves. Moving between pages has no transition.
- **Reduced motion on this Mac is not the cause.** It is off. The default browser is Brave, which uses the same engine measured here.
- **Some claimed motion never happens.** "Menus opening" does not exist: Settings "menus" are lists of links. Nothing ever scrolls the "face row" smoothly. "Today redrawing in place" is deliberately still. The test that "holds" motion only checks that the stylesheet's text contains the rules (`tests/parity/phase5-motion.test.ts:45-84`); it never renders a page.

## How this was checked

- **Recorder.** A script ran in every page before the page's own code (`scratchpad/v6/inv-motion/recorder.js`). It logged:
  - every `animationstart` and `transitionrun` event;
  - every entry in `document.getAnimations()` on every frame, with its duration, delay, easing and keyframes;
  - the paint timing (first contentful paint);
  - a frame-by-frame trace of opacity, transform and position on the elements the motion rules target.
- **Runs.**
  - Page loads: 34 addresses × 2 widths × 2 motion settings (`loads.mjs`).
  - Interactions: hovering every rule family, pressing a button, opening up to three folds per page, a `data-confirm` button, and a face, on 22 pages (`interact.mjs`).
  - Events: the toast, Today drawn again, a busy button, phone scrolling, the face row, click navigation, and the draft drawn again (`events.mjs`).
  - A notice after saving a form unchanged (`flash.mjs`).
  - The door pages (`door.mjs`).
  - Raw results are in `scratchpad/v6/inv-motion/out/*.json`.
- **Toast and redraw.** To cause the rail toast and the Today redraw, conversation `…0303` in the local demo database was set to waiting (`assigned_to='unclaimed'`, `assigned_at=now()`) for about 25 s, five times. Each time it was put back to `null/null`. It was checked to be back to `null/null` at the end.
- **Production files.** Production's `/assets/app.827f844e7af5d29f.css`, `/assets/live.5ef485345ed252e5.js` and `/assets/door.1d256bc876a3329f.css` are byte-identical to the local instance's. The first two are served with `immutable`, so they are production's current build.
- **"Fires" means** a CSS animation or transition started and drew frames: an `animationstart` or `transitionrun` event, plus frame samples showing the values changing.

## Page by page

Every address listed was loaded at both widths. "Phone nav" means the scroll-linked nav compaction described under Components; it exists on every signed-in page at 390 px only.

### Today `/app`

| Defined | 1280 | 390 | Does not fire / why | Checked by |
|---|---|---|---|---|
| `.tw, .td` rise (`layout.ts:308`, `.td` delayed 120 ms `:311`), on the two sections (`operations.ts:398`, `:418`) | Fires on every load. Top section: 8 px + fade, 200 ms. Second section: same, starting 120 ms later. | Same | It fires, but the first frame after paint already shows 10% opacity, 50% by about 50 ms and 88% by 100 ms. It reads as the page appearing. | Frame trace on `goto` and on a click from the Inbox: first painted frame at opacity 0.10 |
| `.td-row { scroll-behavior:smooth }` (`layout.ts:312`) | Never | Never | It only affects scrolls made by script, keyboard or a link. No script scrolls `.td-row` (the script's `toToday` scrolls `.wk-scroll`, `liveScript.ts:432`). With the demo's 4 faces the row overflows by 0 px (1280) and 2 px (390). Tabbing through the faces: scrollLeft stayed 0. A sideways wheel: jumped 0→2 in one frame. | `events.mjs scroll` |
| Today drawn again in place when news arrives (`liveScript.ts:239-260`) | Content swaps; nothing animates | Same | Deliberately still: `main[data-drawn-again] .tw, .td { animation:none }` (`layout.ts:310`). Redraw seen at 20.07 s with no new animation. | `events.mjs toast` |
| Face → profile card | See Components | | | |

### Inbox `/app/inbox`, `?lens=value`, `?filter=all`

| Defined | 1280 | 390 | Does not fire / why | Checked by |
|---|---|---|---|---|
| Nothing on load | No animation on load | Phone nav only | The Inbox has no load motion of its own | `loads.mjs` |
| `.irow` background fade (`layout.ts:1858`) | Hover: 120 ms, transparent → #F5F4F6 | Same with a mouse; a phone has no hover | — | `interact.mjs` |
| `.arow` background fade (`layout.ts:1858`) | Never | Never | No hover rule changes `.arow`'s background, so there is nothing to fade | `interact.mjs` |
| `.tab` and `.deeper` in the colour transition list (`layout.ts:291`) | Never | Never | `.tab` has no hover change. `.deeper` hover only underlines (`layout.ts:681`), which is not in the transition list. | `interact.mjs` |
| "Earlier" fold (`details.attn-more`) | 4 px + fade, 120 ms | Same | See Folds | `interact.mjs` |
| Live line (`.flash.live-line`) when something new arrives | 8 px + fade, 200 ms | not run | Fires about 20 s after the change (the poll) | `events.mjs toast` |

### A conversation with a pending draft `/app/inbox/<id>`

| Defined | 1280 | 390 | Does not fire / why | Checked by |
|---|---|---|---|---|
| `#approve` rise (`layout.ts:296`, card `inbox.ts:2185`) | Every load: 8 px + fade, 200 ms | Same; the page lands at `#latest` with the card in view | After a click from a row, the first painted frame already shows 41% opacity (1280) or 10% (390). It reads as the page loading. | `loads.mjs`, `events.mjs clicknav` |
| Draft drawn again after the assistant finishes (`liveScript.ts:239`) | The new `#approve` rises again, 200 ms (the `data-drawn-again` exception covers only `.tw/.td`) | not run | Replayed by hand (the script's fetch-and-swap steps run in the page). Locally the assistant never finishes, because the instance has no model provider. | `events.mjs redraw`: `animationstart` at 767 ms, `animationend` at 967 ms |
| `.working` line + dots (`inbox.ts:2429`) | Only while the assistant is answering this conversation (`live.ts:247-260`, window 15 min) | Same | Not present on this conversation; see Practice | — |
| "Why this reply" fold (`details.reading`) | 4 px + fade, 120 ms | Same | — | `interact.mjs` |
| `data-confirm` buttons | Ask dialog, see Components | Same | — | `interact.mjs` |

### Practice `/app/sandbox`

| Defined | 1280 | 390 | Does not fire / why | Checked by |
|---|---|---|---|---|
| `.working` rise + three dots (`layout.ts:296-299`, `sandbox.ts:477`) | Line rises 8 px / 200 ms; dots pulse 0.25↔1 every 250 ms, forever, staggered 0 / 120 / 200 ms | Same | The local Practice copy stayed "at work" all session because the local instance answers nothing. In production the dots show only between a practice message and its answer. | `loads.mjs`: `animationstart` at 74, 191 and 273 ms |
| Checks fold (`details.pchecks`) | 4 px + fade, 120 ms | Same | — | `interact.mjs` |
| Ask dialog | Fires | Fires | — | `interact.mjs` |

### Calendar `/app/calendar` (list), `?view=week`, `?view=month`, `?view=day`

| Defined | 1280 | 390 | Does not fire / why | Checked by |
|---|---|---|---|---|
| Nothing on load | No animation in any view | Phone nav only | No load motion is defined for the calendar | `loads.mjs` |
| Tools fold and "earlier" fold | 4 px + fade, 120 ms | Same | — | `interact.mjs` |
| `.btn` and `.tab` hover | Nothing | Nothing | Their hover leaves every transitioned property unchanged here | `interact.mjs` |
| Week/month opening on today (`liveScript.ts:432`) | An instant jump of `scrollLeft` | Same | No `scroll-behavior` is set on `.wk-scroll`, so it is never smooth | Code |
| Faces → profile card | Fires in every view | Fires | See Components | `interact.mjs` |

### Settings `/app/settings` and its screens

Screens checked: setup, business, people, alerts, language, data, closures, forbidden, profile.

| Defined | 1280 | 390 | Does not fire / why | Checked by |
|---|---|---|---|---|
| Nothing on load | No animation on any of the ten | Phone nav only | — | `loads.mjs` |
| "Menus" | Not a motion: each row (`.srow`, `layout.ts:700`) is a link to another page | Same | No menu opens. Choosing a row is a full page load with no transition (no View Transitions anywhere in `src/`). | `interact.mjs`, code |
| `.srow` hover (`layout.ts:291`) | 120 ms, transparent → #F5F4F6 | Same with a mouse | — | `interact.mjs` |
| People: action folds | 4 px + fade, 120 ms | Same | — | `interact.mjs` |
| Notice after saving ("Profile saved.") | `.flash` rises 8 px / 200 ms on the page it lands on | Same | First painted frame already shows 10% opacity | `flash.mjs` |
| Data: the red delete button (`data-confirm`) | No dialog | No dialog | The form's required name field is empty, so the browser's "fill this in" shows instead (by design, `liveScript.ts:478-481`) | `interact.mjs` |

### My business `/app/business` and its screens

Screens checked: prices, channels, how-you-sell, selling, ready.

| Defined | 1280 | 390 | Does not fire / why | Checked by |
|---|---|---|---|---|
| Nothing on load | No animation on any of the six | Phone nav only | — | `loads.mjs` |
| `.srow` hover | 120 ms background fade | Same with a mouse | — | `interact.mjs` |
| Prices: add fold (`details.pr-fold`) | 4 px + fade, 120 ms | Same | — | `interact.mjs` |
| Primary `.btn.send` hover | 120 ms shadow fade | Same | — | `interact.mjs` |

### The assistant `/app/employee` and its screens

Screens checked: talk, replies, learning. (`/app/employee/autonomy` answers 404.)

| Defined | 1280 | 390 | Does not fire / why | Checked by |
|---|---|---|---|---|
| Nothing on load | No animation on any of the four | Phone nav only | — | `loads.mjs` |
| `.srow` and `.btn` hover | 120 ms fades | Same | — | `interact.mjs` |
| `data-confirm` (red button) | Ask dialog | Ask dialog | — | `interact.mjs` |

### Products `/app/products`, `/app/products/add`; Knowledge `/app/knowledge`

| Defined | 1280 | 390 | Does not fire / why | Checked by |
|---|---|---|---|---|
| Nothing on load | No animation | Phone nav only | — | `loads.mjs` |
| Knowledge: teach fold | 4 px + fade, 120 ms on the textarea | Same | — | `interact.mjs` |
| Hovers | `.srow` / `.btn` fades only | Same | — | `interact.mjs` |

### The door `/login`, `/login?with=code`, `/signup`

| Defined | 1280 | 390 | Does not fire / why | Checked by |
|---|---|---|---|---|
| The whole motion block (the door sheet is `STYLE + DOOR_STYLE`, `layout.ts:2731`) | Nothing, ever | Nothing | No element matches any motion selector. The buttons have no `.btn` class, and their hover shadow (`layout.ts:2695`) has no transition. No script is linked, so there is no dialog or busy state. | `loads.mjs`, `door.mjs` |

## Components

| Component | Defined | What fires (1280 / 390) | Would a person notice? | Checked by |
|---|---|---|---|---|
| **Profile card** (face on Today, Inbox, a conversation, all calendar views) | `dialog.sheet[open]` spring (`layout.ts:304`), backdrop fade (`:306`), opened by `liveScript.ts:528-562` | Rises 48 px and scales 0.97→1 over 200 ms, overshooting by 1.4 px about 130 ms in; the page behind dims over 120 ms. 1280: a centred card 389 px wide. 390: a bottom sheet the full width. | **Yes.** About 85% of the 48 px travel happens in the first 70 ms, but the distance is large enough to see. This is the clearest motion in the product. | Frame trace: 48 → 34 → 23 → 14 → 7.6 → 3.2 → 0.4 → −1.0 → −1.4 → 0 px |
| **Face "opening" pulse** | `.face-link[aria-busy] .face` breathe (`layout.ts:305`), set at `liveScript.ts:539` | **Never started.** The face was busy for 8–44 ms (16 trials); no `animationstart` ever fired. | Locally never. In production the card's fetch takes a network round trip: about 0.8 s for `/health` from this Mac (estimate, not measured in a browser), so it may pulse two or three times there. | `interact.mjs` (MutationObserver on `aria-busy`) |
| **Ask dialog** (`button[data-confirm]`) | `dialog.ask[open]` rise (`layout.ts:300`), backdrop fade (`:302`), `liveScript.ts:465-499` | Rises 8 px + fade, 200 ms; the page dims over 120 ms. Fired on the conversation, Practice, People and the assistant, at both widths. | The dimming, yes. The 8 px rise barely: it is about 40% done in 35 ms and 60% in 50 ms. | Frame trace |
| **Draft card** | `#approve` rise (`layout.ts:296`) | On every load of a conversation with a draft, and when it is drawn in after the assistant answers | Hardly on a page load. When drawn in on an open page it is the only change on screen, so more likely to be seen. | `loads.mjs`, `events.mjs redraw` |
| **Notice after an action** (`.flash`, including Undo) | `layout.ts:296` | 8 px + fade, 200 ms, as the next page loads | Reads as part of the page appearing | `flash.mjs` |
| **Toast** (a customer newly waiting) | `.toast` rise (`layout.ts:1282-1284`), made by `liveScript.ts:368-387` | Appeared 17.8 s after the hand-over in all four runs: the page's first poll, 20 s after it loaded (`liveScript.ts:85`). In general the wait is anything up to 20 s. Rises 8 px over 200 ms. 1280: bottom right, 236×47. 390: across the foot, 358×47. Removed after 6.0 s **instantly** (`drop`, `:364`). Fired on Today, Inbox and Settings. | The card's arrival, yes. Its rise, barely. Its exit is a jump. It only happens when a new customer starts waiting while a page is open; production traffic is low. | `events.mjs toast` |
| **Inbox dot** (`data-fresh`) | `layout.ts:1267-1279` | Appears with the toast | No motion is defined; it just appears | `events.mjs toast` |
| **Today drawn again** | `liveScript.ts:239-279`; stilled at `layout.ts:310` | Content replaced, nothing animates | By design, no | `events.mjs toast` |
| **"Writing" dots** | `layout.ts:297-299`, markup `layout.ts:166` | Three 6 px dots pulsing every 250 ms, forever, staggered | Yes, while shown. Shown only while the assistant is answering that conversation or Practice. | `loads.mjs` |
| **Busy button** (any form sent) | `.btn[aria-busy]::after` breathe (`layout.ts:301`; the "…" glyph `:382`), set at `liveScript.ts:510` | GET search: the pulse started 26 ms after the press, and the next page replaced it about 30 ms later. POST save: created, but the page left before it started. | Locally never seen. In production, with a round trip near 0.8 s from this Mac, the "…" should pulse for about a second (estimate). One glyph. | `events.mjs busy`, `flash.mjs` |
| **Folds** (`details`) | `details[open] > :not(summary)` (`layout.ts:295`) | Content drops 4 px and fades, 120 ms. Fired on 10 different folds across Inbox, the conversation, Practice, calendar, People, Forbidden, Data, Prices and Knowledge. | Barely: 65% done in about 33 ms. Closing is instant. | `interact.mjs`, frame trace |
| **Hover** | `layout.ts:291-293` (`.btn, .crow, .srow, a.navlink, .tab, .deeper, .chip, summary`), `:1858` (`.irow, .arow`) | 120 ms colour fades on nav links (#5E5A66 → #1C1B1F text, transparent → white), `.btn` (white → #F5F4F6), `.srow` and `.irow` (→ #F5F4F6), and primary buttons (shadow). Nothing on `.tab`, `.deeper`, `.arow`, `.chip` or plain `summary`. | A colour change, yes. A 120 ms fade between such close colours reads as instant. A phone has no hover. | `interact.mjs` |
| **Press** | `.btn:active` (`layout.ts:294`) | Scale 0.98 over 120 ms. On a 263×44 button that is 5 px narrower and under 1 px shorter. Release snaps back instantly: the transform transition is declared only on `:active`. | No | `interact.mjs` (transform read 180 ms into the press) |
| **Phone nav compaction** | Scroll-linked, `layout.ts:1082-1087`, `:1109-1110` (≤720 px) | 390 only: the nav shrinks from 77 to 63 px over the first 160 px of scroll (padding 10→4 px, links 56→44 px), following the finger. None at 1280. | Yes, if watched; it is tied to scrolling | `events.mjs scroll` |
| **Anything closing** | No exit rules exist | Dialog, card, fold and toast all disappear in one frame | — | Code (only `[open]` entry animations, `layout.ts:300-306`) |
| **Page to page** | Nothing | No transition | — | No `view-transition` in `src/` |
| **`MOTION_SPECS`** (`tokens.ts:293-298`: approveTap, quoteReveal, sendFlight, statusChange) | Defined | Never: nothing in `src/`, `tests/` or `tools/` imports them | — | grep |

## The three timings

They are defined in `tokens.ts:245` as `motionMs: { fast: 120, normal: 200, max: 250 }` and emitted as `--motion-fast`, `--motion-normal` and `--motion-max` (`css.ts:65`). They are in every signed-in page's stylesheet (`layout.ts:582` → `APP_SHEET :2384`) and in the door's (`:2731`). In the browser they resolve to 120, 200 and 250 ms: those are the durations `getAnimations()` reported. No duration resolved to 0, and no custom property was undefined.

| Timing | Used in the CSS for | Rendered elements that actually ran it |
|---|---|---|
| fast, 120 ms | Hover colour fades (`layout.ts:291-293`, `:1858`), press (`:294`), folds (`:295`), dot stagger (`:298`), dialog and card backdrops (`:302`, `:306`), the second Today section's delay (`:311`) | Yes: hover fades, folds, backdrops, press, `.td`'s delay |
| normal, 200 ms | Notice, draft and "at work" rise (`:296`), third dot's delay (`:299`), ask dialog (`:300`), profile card spring (`:304`), Today sections (`:308`), toast (`:1283`) | Yes: Today sections, draft card, notices, live line, ask dialog, profile card, toast, "at work" line |
| max, 250 ms | Dots breathe (`:297`), busy "…" (`:301`), face pulse (`:305`) | The Practice dots only. The busy "…" ran for under 30 ms before the page left; the face pulse never started. |

Two written claims disagree with the code:

- The comment at `layout.ts:283` and `PROGRESS.md` (lines 40 and 778) give "max" as 300 ms. The token, and what the browser runs, is 250 ms.
- `tokens.ts:290` still says "the chat surface has no animation". That is about the unused `MOTION_SPECS`, not about what runs.

## Reduced motion

**The app's rule.**

- Every rule that moves sits inside `@media (prefers-reduced-motion: no-preference)` (`layout.ts:290`, `:1083`, `:1282`, `:1858`).
- A `reduce` block (`layout.ts:314-317`) sets every animation and transition to 1 ms, one iteration, no delay, and scrolling to instant.
- The script scrolls smoothly only when the reader has not asked for less (`liveScript.ts:273-275`).

**Measured with reduced motion on:**

- No CSS animation started on any of the 34 addresses at either width.
- The ask dialog, profile card, folds, toast (`animation-name: none`, 0.001 s) and notice (opacity 1 on the first frame) did not move.
- Hovers became 1 ms changes.
- One side effect, invisible: because the `reduce` block gives every element a 1 ms transition on every property, small 1 ms transitions appear where none existed (outline, max-width, width, opacity).

**This Mac:**

- `defaults read com.apple.Accessibility ReduceMotionEnabled` = `0`.
- `com.apple.universalaccess` (readable, 267 lines) has no `reduceMotion` key, so it has never been switched on.
- Low Power Mode is `0`, and the Mac is on AC power.
- So every browser here reports `prefers-reduced-motion: no-preference`. **Reduced motion does not explain "no motion anywhere".**

**The browser:**

- The default http/https handler is Brave (`com.brave.browser`, version 153.1.95). It is Chromium-based, the same engine as these measurements.
- Safari 26.6.2 is also installed and was not measured: no WebKit build is available here.
- Chrome is not installed.
- Brave's own settings were not read. For example, an energy-saver mode that lowers the frame rate would make short motion even harder to see.
- The owner's phone settings could not be checked.

## What would make motion visible: observations only

1. **On a page, it plays while the page appears.** Most motion is a rise on page load (Today's sections, the draft card, notices). Its first painted frame is already 10–40% done, and it is about 90% done 100 ms later. It coincides with the page appearing.
2. **The distances are small.** Every rise is 8 px and every fold 4 px. Only the profile card travels far (48 px).
3. **The curve front-loads the change.** `cubic-bezier(0.2, 0, 0, 1)` puts about 60% of the change into the first quarter of the duration. A 200 ms animation looks like about 70 ms.
4. **Nine of the twelve kinds of page have no motion of their own on load:** Inbox, buyer page, calendar (all four views), Settings, My business, the assistant, Products, Knowledge, the door. Only Today, a conversation with a pending draft, and Practice while the assistant is at work move on load.
5. **Nothing animates when it leaves**, and moving between pages has no transition.
6. **The clearer motions need a moment the owner rarely meets:**
   - the profile card needs a face to be pressed;
   - the dots need the assistant to be answering that very conversation;
   - the toast needs a new customer to start waiting while a page is open, and comes up to 20 s later.
7. **The waiting pulses last only as long as the wait.** The busy "…" and the face pulse ran for under 50 ms locally and were never seen. Against production they would last about a round trip (near 0.8 s from this Mac; estimated, not measured in a browser).
8. **Some updates are deliberately still.** Today is drawn again in place with no motion (`layout.ts:310`). The calendar's jump to today is instant.
9. **Two claimed motions have nothing to move.** "The face row scrolling smoothly" has no script that scrolls it, and with the demo's faces the row barely overflows (2 px on a phone, 0 at 1280). "Menus opening" does not exist: Settings menus are lists of links.
10. **Hover fades are too short and too slight to see as motion.** They take 120 ms between near-identical colours (white → #F5F4F6), and a phone has no hover.
11. **The test does not render.** `tests/parity/phase5-motion.test.ts` passes when the stylesheet's text contains the rules. That is why two rebuilds could truthfully say the timings were "used" while the owner sees almost nothing move.
