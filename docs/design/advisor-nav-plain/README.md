# The advisor's nav mark: plain

Rendered 2026-10-11 in Brave (Chromium; device scale 2) from the build itself, on a local instance with the demo
workspace. **Not merged: waiting for the owner.**

The owner's brief: "Remove the magenta glow behind the Advisor icon entirely. Plain icon like every other nav entry;
the lit bubble goes back to a normal unlit bubble. Keep it on the Solar system, 28px, 1.75px, ink."

**What changed:**
- **The light is gone.** The `.ni-lit` wrapper and its `::before` glow are removed from the stylesheet. No rule of
  the nav paints with the orb's glow any more; the orb's own page is the only thing that uses it.
- **The mark is the rail's plain icon,** like every other entry: Solar's round bubble, empty (`chat-round`), 28 px,
  a 1.75 px line.
  - At rest it is ink.
  - Where you are, it takes the white pill and the deep magenta, as every entry does.

**Files** (`plain-*` now, `before-*` the lit bubble as live today):
- `*-nav-resting-{desktop,phone}-en.png`: on another page.
- `*-nav-active-{desktop,phone}-en.png`: on the advisor's page.
