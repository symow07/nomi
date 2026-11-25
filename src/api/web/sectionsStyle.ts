/**
 * The navigation block (2026-11-25, the owner's decision): two layers, as Intercom has them. The rail is narrow (an
 * icon over its word), and beside it each area's section sidebar lists all of the area (sections.ts). Below 960 px
 * the sidebar gives way to the chooser at the top of the page; on a phone the rail is the bottom bar, as before.
 * One "you are here" style for both layers: the rail's quiet sand tile and weight.
 */
export const SECTIONS_CSS = String.raw`
@media (min-width:721px) {
  .owner-shell .layout { grid-template-columns:88px minmax(0, 1fr); }
  .owner-shell nav.side { inline-size:88px; padding:var(--space-16) var(--space-8); }
  .owner-shell nav.side .brand { justify-content:center; padding:0 0 var(--space-16); }
  .owner-shell nav.side .brand .brandname { display:none; }
  .owner-shell nav.side :is(a,button).navlink { position:relative; flex-direction:column; align-items:center; justify-content:center; gap:var(--space-4);
    min-block-size:60px; padding:var(--space-8) var(--space-4); font-size:var(--font-size-caption); text-align:center; }
  .owner-shell nav.side .nl-body { display:contents; }
  .owner-shell nav.side .nl-text { max-inline-size:100%; line-height:1.2; text-align:center; overflow-wrap:normal; letter-spacing:0; }
  .owner-shell nav.side .navcount { position:absolute; inset-block-start:var(--space-4); inset-inline-start:calc(50% + 6px); margin:0; }
  .owner-shell nav.side .sp-me { justify-content:center; }
  .owner-shell nav.side .sp-me > span:not(.face) { display:none; }
  .owner-shell .content > .area-nav { display:none; }
  /* The page's head keeps clear of the "?" now that no row of tabs pushes it down: the door, its inset and a gap. */
  .owner-shell .content:has(> .help-door) .sp-head { padding-inline-end:max(var(--space-24), calc((100% - 1240px) / 2), calc(44px + var(--space-16) + var(--space-8))); }
}
@media (min-width:961px) {
  .owner-shell .layout:has(> .sect) { grid-template-columns:88px 240px minmax(0, 1fr); }
}
.sect { display:none; }
@media (min-width:961px) {
  .sect { display:block; position:sticky; top:0; block-size:100vh; overflow-y:auto; padding:var(--space-24) var(--space-12);
    background:var(--color-paper); border-inline-end:1px solid var(--color-border); }
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
.sect-business { margin:0 var(--space-12) var(--space-4); font-size:var(--font-size-caption); font-weight:600; color:var(--color-ink-secondary); overflow-wrap:anywhere; }
.sect-title { margin:0 var(--space-12) var(--space-16); font-size:var(--font-size-title); font-weight:600; line-height:var(--line-height-tight); letter-spacing:var(--tracking-tight); }
html[lang="ar"] .sect-title, html[lang="zh"] .sect-title { letter-spacing:0; }
.sect-group + .sect-group { margin-block-start:var(--space-16); }
.sect-head { margin:0; padding:var(--space-8) var(--space-12) var(--space-4); font-size:var(--font-size-caption); font-weight:600; color:var(--color-ink-secondary); }
.sect a { display:flex; align-items:center; min-block-size:44px; padding:var(--space-8) var(--space-12); border-radius:var(--radius-control);
  font-size:var(--font-size-small); color:var(--color-ink); text-decoration:none; }
.sect a:hover { background:var(--color-sand); }
.sect a[aria-current] { background:var(--color-sand); font-weight:600; }
.sect a:focus-visible { outline:2px solid var(--color-brand); outline-offset:-2px; }
.area-chooser .sect-head { padding-inline:var(--space-8); padding-block-start:var(--space-12); }
.area-chooser a[aria-current] { font-weight:600; }
@media print { .sect, .owner-shell .content > .area-nav { display:none; } }
`;
