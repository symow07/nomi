/**
 * The navigation block (2026-11-25, the owner's decision): two layers, as Intercom has them. The rail is narrow (an
 * icon over its word), and beside it each area's section sidebar lists all of the area (sections.ts). Below 960 px
 * the sidebar gives way to the chooser at the top of the page; on a phone the rail is the bottom bar, as before.
 * One "you are here" style for both layers: the rail's quiet sand tile and weight.
 */
export const SECTIONS_CSS = String.raw`
@media (min-width:721px) {
  .owner-shell .layout { grid-template-columns:72px minmax(0, 1fr); }
  .owner-shell nav.side { inline-size:72px; padding:var(--space-16) var(--space-12); overflow:visible; z-index:3; }
  .owner-shell nav.side .brand { padding-block-end:var(--space-24); }
  .owner-shell nav.side .brand { justify-content:center; padding:0 0 var(--space-16); }
  .owner-shell nav.side .brand .brandname { display:none; }
  /* The rail is icons only (2026-11-26, the owner's reference); each one's word is still its name to a screen reader,
     and it shows beside the icon on hover or focus. */
  .owner-shell nav.side .navgroup, .owner-shell nav.side .navfoot { gap:var(--space-4); }
  .owner-shell .layout > nav.side :is(a,button).navlink { position:relative; display:flex; align-items:center; justify-content:center; inline-size:48px;
    min-block-size:48px; margin-inline:auto; padding:0; gap:0; border-radius:var(--radius-control); }
  .owner-shell nav.side .nl-body { display:contents; }
  /* A little bubbly (the owner, 2026-11-26): the rail on a soft magenta gradient, round tiles, the one you are on
     lifted in white. */
  .owner-shell .layout > nav.side { background:linear-gradient(to bottom, var(--color-rail-top), var(--color-rail-bottom)); border-inline-end-color:var(--color-rail-shadow); }
  .owner-shell .layout > nav.side :is(a,button).navlink { border-radius:var(--radius-panel); }
  .owner-shell .layout > nav.side .navlink:hover { background:var(--color-surface); }
  .owner-shell .layout > nav.side a.navlink.active { background:var(--color-surface); box-shadow:0 2px 8px var(--color-rail-shadow); }
  .owner-shell nav.side .nl-text { position:absolute; inset-inline-start:calc(100% + var(--space-8)); inset-block-start:50%; z-index:20; translate:0 -50%;
    padding:var(--space-4) var(--space-8); border-radius:var(--radius-chip); background:var(--color-ink); color:var(--color-surface);
    font-size:var(--font-size-caption); font-weight:500; line-height:1.3; white-space:nowrap; letter-spacing:0; pointer-events:none;
    max-inline-size:none; overflow:visible;
    opacity:0; visibility:hidden; }
  .owner-shell nav.side :is(a,button).navlink:is(:hover, :focus-visible) .nl-text { opacity:1; visibility:visible; }
  .owner-shell nav.side .navcount { position:absolute; inset-block-start:2px; inset-inline-end:2px; margin:0; }
  .owner-shell nav.side .sp-me { justify-content:center; }
  .owner-shell nav.side .sp-me > span:not(.face) { display:none; }
  .owner-shell .content > .area-nav { display:none; }
  /* The page's head keeps clear of the "?" now that no row of tabs pushes it down: the door, its inset and a gap. */
  .owner-shell .content:has(> .help-door) .sp-head { padding-inline-end:max(var(--space-24), calc((100% - 1240px) / 2), calc(44px + var(--space-16) + var(--space-8))); }
}
/* Today's head when it is one column: the "?" sits at the column's end, so its button keeps clear of it. */
.owner-shell .content:has(.sp > .sp-panels.is-one) .sp-head > .sp-new { margin-inline-end:calc(44px + var(--space-8)); }
@media (min-width:961px) {
  .owner-shell .layout:has(> .sect) { grid-template-columns:72px 264px minmax(0, 1fr); }
}
.sect { display:none; }
@media (min-width:961px) {
  .sect { display:block; position:sticky; top:0; block-size:100vh; overflow-y:auto; padding:0;
    background:var(--color-surface); border-inline-end:1px solid var(--color-border); }
}
@media (min-width:721px) and (max-width:960px) {
  .owner-shell .content > .area-nav { display:block; padding:var(--space-8) var(--space-24); }
  .owner-shell .content > .area-nav .area-links { display:none; }
  .owner-shell .content > .area-nav .area-chooser { display:block; margin:0; margin-inline-end:calc(44px + var(--space-16) + var(--space-8)); }
  .area-chooser > summary { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); min-block-size:44px; list-style:none; text-align:start; }
  .area-chooser > summary::before, .area-chooser > summary::-webkit-details-marker { display:none; }
  .area-chooser > div { display:flex; flex-direction:column; padding-block-end:var(--space-8); }
  .area-chooser > div > a { display:flex; align-items:center; min-block-size:44px; }
  .owner-shell .content > .area-nav .area-chooser a { justify-content:flex-start; border:0; padding-inline:var(--space-8); text-align:start; }
}
/* The sidebar's look (2026-11-26, the owner's reference): a search on top, then each group between thin rules, under a
   small heading; every item an icon and its words, with room around them. */
.sect-search { padding:var(--space-16); border-block-end:1px solid var(--color-border); }
.sect-search label { display:flex; align-items:center; gap:var(--space-8); min-block-size:44px; padding-inline:var(--space-12);
  border:1px solid var(--color-border); border-radius:var(--radius-control); background:var(--color-surface); color:var(--color-ink-secondary); }
.sect-search label:focus-within { border-color:var(--color-ink); }
.sect-search input { flex:1; min-inline-size:0; border:0; padding:0; background:transparent; font:inherit; font-size:var(--font-size-small); color:var(--color-ink); }
.sect-search input:focus { outline:none; }
.sect-group { padding:var(--space-16); }
.sect-group + .sect-group { border-block-start:1px solid var(--color-border); }
.sect-head { margin:0; padding:var(--space-4) var(--space-12) var(--space-12); font-size:var(--font-size-caption); font-weight:500;
  color:var(--color-ink-secondary); }
.sect a { display:flex; align-items:center; gap:var(--space-12); min-block-size:44px; padding:var(--space-8) var(--space-12); border-radius:var(--radius-control);
  font-size:var(--font-size-small); color:var(--color-ink); text-decoration:none; }
.sect-ic { flex:none; color:var(--color-ink-secondary); }
.sect a:hover { background:var(--color-sand); }
.sect a[aria-current] { background:var(--color-sand); font-weight:600; }
.sect a[aria-current] .sect-ic { color:var(--color-ink); }
.area-chooser > div > a { gap:var(--space-12); }
/* The chooser names the area, then the page in it; its arrow points down, the way it opens. */
.area-chooser .ac-name { display:flex; flex-direction:column; line-height:1.25; }
.area-chooser .ac-area { font-size:var(--font-size-caption); font-weight:500; color:var(--color-ink-secondary); }
.area-chooser .ac-page { font-weight:600; }
.area-chooser:not([data-titled]) > summary .gi { rotate:90deg; }
.area-chooser:not([data-titled])[open] > summary .gi { rotate:-90deg; }
.sect a:focus-visible { outline:2px solid var(--color-brand); outline-offset:-2px; }
.area-chooser .sect-head { padding-inline:var(--space-8); padding-block-start:var(--space-12); }
.area-chooser a[aria-current] { font-weight:600; }
@media print { .sect, .owner-shell .content > .area-nav { display:none; } }
`;
