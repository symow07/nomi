# The advisor's nav mark: the empty bubble, lit from within

Rendered 2026-10-09 in Brave (Chromium; device scale 2) from the build itself, on a local instance with the demo
workspace. Round one (three sketches drawn from the orb) is in `round-1-sketches/`. The owner chose this instead.

## What it is

- **The drawing:** Solar's round speech bubble, empty. It is the advisor's bubble without its three dots, which
  is Solar's own `chat-round`, unchanged. The rail is still all Solar Linear, and the CC BY 4.0 notice is unchanged.
- **On the system:** 28 px, the nav's 1.75 px line, ink at rest. Active, the white pill and the deep magenta line.
- **The light:** the orb's glow (#A1127A) behind it.
  - A soft disc from the bubble's middle out to 4 px past the icon (36 px across), at a third of the glow's
    strength.
  - **The only rail icon with a light, on purpose.** It is the recorded exception, and the guards hold that no
    other entry is lit.
  - **Still:** nothing animates it.
  - **Contained:** measured on every render, it stops 37 px or more short of any other icon in the rail (Calendar
    above, Settings below, the phone's neighbours).
  - **Less motion:** unchanged; it never moved. **Scripts off:** unchanged; it is the stylesheet's.
  - **Forced colours:** the light is dropped and the bubble stays.

## One meaning, one shape

**`chat-round` was also WhatsApp's icon in My business.** On the owner's word (2026-10-09), WhatsApp moved to
Solar's `chat-round-line`, the round bubble with its lines. The empty bubble is now the advisor's alone, and the
guard has no shared pair: no other meaning may draw `chat-round`. See
`whatsapp-my-business-{desktop,phone}-en.png`.

## Files

- **The rail, five languages:** `lit-{resting,active}-{desktop,phone}-{en,zh,ar,es,fr}.png`.
  - Resting is on Home; active is on the advisor.
  - Arabic is mirrored: the rail is on the right, and the phone's row runs right to left.
- **Close up, English:** `lit-{resting,active}-{desktop,phone}-en-close.png`.
- **The whole page, English:** `lit-{resting,active}-{desktop,phone}-en-whole.png`.
- **Edge cases:** `lit-active-{desktop,phone}-en-{reduced-motion,scripts-off,forced-colors}.png`.
- **WhatsApp's new drawing, in My business:** `whatsapp-my-business-{desktop,phone}-en.png`.
