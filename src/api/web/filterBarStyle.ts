/** UI correction, Block 9 — F07: the shared filter bar's look (the helper is filterBar.ts). */
/**
 * The bar's look, in the split sheet (linked on every owner page). Scoped to .fbar, so a page's older filter rules (kept for its
 * other markup) are overridden by specificity where they would part a label from its control.
 */
export const FILTER_BAR_CSS = `
  .fbar { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--space-12) var(--space-16); margin-block:var(--space-16) var(--space-24); }
  .fbar .fbar-f { display:flex; flex-direction:column; gap:var(--space-4); min-inline-size:0; flex:0 1 14rem; font-size:var(--font-size-small); }
  .fbar .fbar-q { flex:1 1 18rem; }
  .fbar .fbar-l { color:var(--color-ink-secondary); font-weight:500; }
  .fbar .fbar-f input, .fbar .fbar-f select { flex:none; box-sizing:border-box; inline-size:100%; }
  .fbar .fbar-more { display:contents; }
  .fbar .fbar-more > summary { display:none; }
  .fbar .fbar-fields { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--space-12) var(--space-16); flex:0 1 auto; min-inline-size:0; }
  .fbar .fbar-acts { display:flex; align-items:center; gap:var(--space-8) var(--space-16); flex:none; }
  .fbar .fbar-acts .btn { box-sizing:border-box; padding-block:0; background:var(--color-surface); color:var(--color-ink); font-weight:500; }
  .fbar .fbar-clear, .fbar > a { display:inline-flex; align-items:center; min-block-size:44px; min-inline-size:44px; }
  @media (min-width:721px) {
    .fbar .fbar-more::details-content { content-visibility:visible; display:contents; }
  }
  @media (max-width:720px) {
    .fbar { flex-direction:column; align-items:stretch; gap:var(--space-12); }
    .fbar .fbar-f, .fbar .fbar-q { flex:none; inline-size:100%; }
    .fbar .fbar-more { display:block; }
    .fbar .fbar-more > summary { display:flex; align-items:center; gap:var(--space-8); min-block-size:44px; padding-inline:var(--space-16);
      border:1px solid var(--color-control-line); border-radius:var(--radius-control); background:var(--color-surface);
      color:var(--color-ink); font-size:var(--font-size-small); font-weight:500; cursor:pointer; inline-size:fit-content; }
    .fbar .fbar-more[open] > summary { margin-block-end:var(--space-12); }
    .fbar .fbar-n { display:inline-flex; align-items:center; justify-content:center; min-inline-size:1.5em; padding-inline:0.4em;
      border-radius:var(--radius-chip); background:var(--color-ink); color:var(--color-surface); font-size:var(--font-size-small); }
    .fbar .fbar-fields { flex-direction:column; align-items:stretch; gap:var(--space-12); }
    .fbar .fbar-acts .btn { flex:1 1 auto; }
  }
`;
