# The advisor's nav mark: three sketches drawn from the orb

Rendered 2026-10-09 in Brave (Chromium; device scale 2) in the real nav, on a local instance with the demo
workspace. Each sketch was put into the nav's advisor icon in place, so it is drawn by the page's own stylesheet
at the nav's size and line, next to Home, Customers, Inbox, Calendar and Settings. Today's Solar bubble is
alongside for comparison. **Nothing is changed in the code yet.** The owner picks, then the chosen mark is built,
guarded and recorded as the one exception to "every nav icon is Solar Linear".

## How each is drawn (so it sits with the Solar icons)

- **The box:** the Solar Linear set's 24-unit square, drawn at 28 px.
- **The circle:** Solar's own (`r = 10`, as in its circle icons).
- **The line:** round, not filled, taking the nav's 1.75 px from the same rule as every rail icon.
- **The dots:** drawn the way Solar draws its own (Calendar's days, the bubble's three): a round-capped stroke of
  no length, so each is the line's width. Nothing is filled.
- **The active state:** the white pill and the deep magenta line, unchanged.

## The three

- **A · the sash:** six even dots on the front half of a band round the sphere, tilted, rim side to rim side. It
  is the orb's own `composing` sash.
- **B · the lane:** five even dots in one column, bowed to the right like the orb's dotted lanes.
- **C · the sash, with depth:** A's band with seven dots, the middle ones larger (2.6 px down to 1.5 px), as the
  orb's near dots are.

None is a ring concentric with the circle (the loading spinner's shape), and none is the Nomi character.

## My read, at real size

- **B is the one I would pick.** It reads as the orb's dotted lanes on a sphere. At 28 px it is quiet, a little
  lighter than its neighbours, because its middle is mostly empty. It does not read as a spinner.
- **A reads as a face, or a dial.** At this size a curved row of dots in the lower half of a circle looks like a
  smile.
- **C comes closest to a loading indicator.** Dots that grow and shrink along an arc are the classic "dots
  spinner" cue, and it shares A's smile.

If none of the three is strong enough, the brief's fallback stands: keep a Solar glyph.

## Files

- `sheet-desktop-{en,zh,ar,es,fr}.png`: the rail on a desktop, each sketch (and today's bubble) resting (on
  Home) and active (on the advisor). Arabic is mirrored, the rail on the right.
- `sheet-phone.png`: the phone's nav in all five languages, each sketch resting and active.
- `{A,B,C,now}-{resting,active}-{desktop,phone}-en.png`: the whole page.
- `sketches-at-28-and-112.png`: the three beside the Solar icons at 28 px (ink, then the active magenta), then
  enlarged. The enlarged row draws C's dots at their 28 px sizes, so they look small there only.
