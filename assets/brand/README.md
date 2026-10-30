# Brand assets

The mark is a SEAL (the owner, 2026-10-31): a square chop reading "nomi" in
two rows, n o over m i, its "o" an old Chinese cash coin — a disc with a square
hole, a rim round its edge and a rim round its hole.

`mark-detail.svg`  40px and up. The 400 grid: frame 23 units, strokes 35, the
                   coin's paper rims 9.5 and 7.5 units so they read at 48 px.
`mark-small.svg`   below 40px. Drawn on the 32-pixel grid, every edge on a
                   whole pixel; its coin is a disc and a hole, no rims (at 32 px
                   the coin is ten pixels and a rim is a haze). Draw it at 32 or 16.
`mark-mono.svg`    `currentColor` — one colour: print, a real chop.
`favicon.svg`      the coin alone on a 16 grid: disc, one paper ring, the hole.
`favicon-32.svg`   the coin alone on a 32 grid, both rims: the 32 px entry of
                   `/favicon.ico`.
`retired-figure/`  the figure mark (head, shoulders, body) it replaced. A record;
                   nothing draws it.

Colours: the frame and letters are the brand magenta (`--color-brand`,
`#9A0F5E` — the main button's fill, one magenta for both); the coin is `coin`
(`#5A0A2E`), the mark's alone.

These are the SOURCE. In the product the mark is inlined by
`src/core/owner/brand.ts` so it inherits the design tokens and costs no
request; `brand.test.ts` holds the copies byte for byte. The home-screen icons
and `/favicon.ico` are PNG/ICO renders of these, kept in
`src/api/web/appIcons.ts` (made by `tools/brand-icons.mjs`).

The mark does NOT mirror in RTL. Brand marks stay constant; only directional
glyphs mirror.
