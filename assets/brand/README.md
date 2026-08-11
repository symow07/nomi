# Brand assets

`mark-detail.svg`  the mark at 40px and up. Jade figure on a jade-wash disc.
`mark-small.svg`   below 40px — REVERSED (figure knocked out of a solid jade
                   disc), because a light disc loses its edge at favicon size.
                   A different drawing, not a scaled one.
`mark-mono.svg`    `currentColor` — inherits ink. Print, stamps, one-colour.
`mark-night.svg`   the `colorDark` values.

These are the SOURCE. In the product the mark is inlined into
`src/api/web/layout.ts` so it inherits the design tokens and costs no request;
these files are what the inline copies are cut from. If you change one, change
both, and say so in the commit.

The mark does NOT mirror in RTL. Brand marks stay constant; only directional
glyphs mirror.
