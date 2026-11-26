/**
 * THE PICTURE OF AN ANSWER (the owner, 2026-11-26; askPicture.ts draws it). Boxes on a grid the page lays out; the
 * ribbons between them are the one script's (askPictureScript.ts), drawn behind the boxes and tucked under their
 * edges. The owner's own choices, from the prototype approved that day: solid ribbons in the mark's magenta, pale at
 * the start and full at the end, a light running inside them, each box lit as the light reaches it.
 * Colours are the palette's own (the mark's magenta and the neutrals) and mixes of them; nothing new.
 * NOTHING HERE MOVES: these rules are the picture at rest, which is what a reader who asked for less motion sees,
 * and what stands without the script. The motion is the picture's own file's (askPictureScript.ts).
 */
export const ASK_PICTURE_CSS = String.raw`
.ask-pic{margin-top:var(--space-16);width:44rem;max-width:100%;min-width:0;container-type:inline-size;}
.ap-fig{position:relative;margin:0;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-panel);min-width:0;}
.ap-lines{display:none;}
.ask-pic:has(.ap-as-words:checked) .ap-fig{display:none;}
.ask-pic:has(.ap-as-words:checked) .ap-lines{display:block;}
.ap-show{display:inline-flex;margin:var(--space-16) 0 0;padding:var(--space-4);border:0;border-radius:var(--radius-chip);background:var(--color-sand);}
.ap-show legend{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
.ap-show label{display:inline-flex;position:relative;}
.ap-show input{position:absolute;inset:0;opacity:0;margin:0;}
.ap-show span{display:flex;align-items:center;min-height:44px;padding-inline:var(--space-16);border-radius:var(--radius-chip);font-size:var(--font-size-small);font-weight:600;}
.ap-show input:checked+span{background:var(--color-ink);color:var(--color-surface);}
.ap-show input:focus-visible+span{outline:2px solid var(--color-ink);outline-offset:2px;}
.ap-n{position:relative;z-index:1;display:block;min-width:0;padding:var(--space-12) var(--space-16);background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-card);color:var(--color-ink);text-decoration:none;overflow-wrap:break-word;}
a.ap-n:hover,a.ap-n:focus-visible{border-color:var(--color-ink);}
.ap-l{display:block;font-size:var(--font-size-small);color:var(--color-ink-secondary);line-height:var(--line-height-tight);}
.ap-v{display:block;margin-top:var(--space-4);font-size:var(--font-size-title);font-weight:600;font-variant-numeric:tabular-nums;line-height:var(--line-height-tight);}
.ap-n.ap-waits{background:color-mix(in srgb,var(--color-cue) 7%,var(--color-surface));border-color:color-mix(in srgb,var(--color-cue) 28%,var(--color-surface));}
.ap-n.ap-waits .ap-v{color:var(--color-cue);}
.ap-n.ap-none{background:transparent;border-style:dashed;}
.ap-n.ap-none .ap-v{font-size:var(--font-size-base);color:var(--color-ink-secondary);}
.ap-sweep{position:absolute;inset:-1px;z-index:2;padding:2px;border-radius:var(--radius-panel);pointer-events:none;opacity:0;
  background:linear-gradient(100deg,transparent 30%,color-mix(in srgb,var(--color-cue) 30%,var(--color-surface)) 42%,var(--color-cue) 50%,color-mix(in srgb,var(--color-cue) 30%,var(--color-surface)) 58%,transparent 70%) 100% 0 / 300% 100% no-repeat;
  -webkit-mask:linear-gradient(var(--color-ink) 0 0) content-box,linear-gradient(var(--color-ink) 0 0);-webkit-mask-composite:xor;
  mask:linear-gradient(var(--color-ink) 0 0) content-box exclude,linear-gradient(var(--color-ink) 0 0);}
.ap-pulse{transform-box:fill-box;transform-origin:center;}
.ap-wires{position:absolute;inset:0;z-index:0;width:100%;height:100%;overflow:visible;pointer-events:none;}
.ap-ribbon{fill:none;stroke-width:11;}
.ap-streak{fill:none;stroke:var(--color-surface);stroke-width:4;stroke-linecap:round;stroke-dasharray:26 174;stroke-dashoffset:26;opacity:.95;}
.ap-streak.ap-soft{stroke-width:9;opacity:.35;filter:blur(2px);}
.ap-s-a{stop-color:color-mix(in srgb,var(--color-cue) 30%,var(--color-surface));}
.ap-s-b,.ap-s-wa{stop-color:var(--color-cue);}
.ap-s-wb{stop-color:color-mix(in srgb,var(--color-cue) 62%,var(--color-ink));}
.ap-flow{position:relative;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));column-gap:var(--space-48);row-gap:var(--space-32);align-items:center;}
.ap-c0{grid-column:1;}.ap-c1{grid-column:2;}.ap-c2{grid-column:3;}.ap-c3{grid-column:4;}
.ap-r0{grid-row:1;}.ap-r1{grid-row:2;}.ap-rmid{grid-row:1 / span 2;}
.ap-people{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);column-gap:var(--space-48);row-gap:var(--space-16);align-items:center;}
.ap-people .ap-start{grid-column:1;}.ap-people .ap-end{grid-column:3;}
.ap-you{grid-column:2;grid-row:1;justify-self:center;display:grid;place-items:center;width:72px;height:72px;padding:0;border:0;border-radius:var(--radius-chip);background:var(--color-ink);color:var(--color-surface);font-weight:600;}
.ap-people[data-ap-rows="2"] .ap-you{grid-row:1 / span 2;}
.ap-people[data-ap-rows="3"] .ap-you{grid-row:1 / span 3;}
.ap-people[data-ap-rows="4"] .ap-you{grid-row:1 / span 4;}
.ap-name{display:block;font-weight:600;}
.ap-tag{display:inline-block;margin-top:var(--space-4);padding:var(--space-4) var(--space-8);border-radius:var(--radius-control);background:var(--color-sand);color:var(--color-ink-secondary);font-size:var(--font-size-caption);}
.ap-tag.ap-waits{background:color-mix(in srgb,var(--color-cue) 9%,var(--color-surface));color:var(--color-cue);}
.ap-more{grid-column:1 / -1;margin:0;font-size:var(--font-size-small);}
.ap-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));list-style:none;margin:0;padding:0;}
.ap-day{min-width:0;min-height:9rem;padding:0 var(--space-8) var(--space-8);border-inline-start:1px solid var(--color-border);}
.ap-day:first-child{border-inline-start:0;padding-inline-start:0;}
.ap-dl{display:block;margin-bottom:var(--space-12);font-size:var(--font-size-caption);color:var(--color-ink-secondary);}
.ap-today .ap-dl{color:var(--color-ink);font-weight:600;}
.ap-day ul{display:grid;gap:var(--space-8);list-style:none;margin:0;padding:0;}
.ap-item{padding:var(--space-8) var(--space-12);background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-control);font-size:var(--font-size-small);overflow-wrap:anywhere;}
.ap-item.ap-late{border-style:dashed;border-color:var(--color-control-line);}
.ap-legend{display:flex;flex-wrap:wrap;gap:var(--space-8) var(--space-24);list-style:none;margin:0 0 var(--space-12);padding:0;font-size:var(--font-size-small);}
.ap-key{display:inline-block;width:20px;margin-inline-end:var(--space-8);vertical-align:middle;border-top:3px solid var(--color-cue);}
.ap-then .ap-key{border-top:2px dashed var(--color-control-line);}
.ap-plot svg{display:block;width:100%;height:auto;}
.ap-then-line{fill:none;stroke:var(--color-control-line);stroke-width:2;stroke-dasharray:5 5;}
.ap-now-line{fill:none;stroke:var(--color-cue);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round;}
.ap-area{fill:var(--color-cue);opacity:.08;}
.ap-dot{fill:var(--color-cue);stroke:var(--color-surface);stroke-width:2;}
.ap-pulse{fill:var(--color-cue);opacity:0;}
.ap-axis{display:flex;justify-content:space-between;margin:var(--space-4) 0 0;font-size:var(--font-size-caption);color:var(--color-ink-secondary);}
.ap-fig{padding:var(--space-16);}
@container (max-width:620px){
.ap-flow{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);column-gap:var(--space-24);row-gap:var(--space-32);}
.ap-flow .ap-c0{grid-row:1;}.ap-flow .ap-c1{grid-row:2;}.ap-flow .ap-c2{grid-row:3;}.ap-flow .ap-c3{grid-row:4;}
.ap-flow .ap-r0,.ap-flow .ap-rmid{grid-column:1;}.ap-flow .ap-r1{grid-column:2;}
.ap-week{grid-template-columns:minmax(0,1fr);}
.ap-day,.ap-day:first-child{display:grid;grid-template-columns:5.5rem minmax(0,1fr);gap:var(--space-8);min-height:0;padding:var(--space-12) 0;border-inline-start:0;border-top:1px solid var(--color-border);}
.ap-day:first-child{border-top:0;}
.ap-dl{margin:0;}
}
@container (max-width:420px){
.ap-people{grid-template-columns:56px minmax(0,1fr);column-gap:var(--space-16);align-items:start;}
.ap-people .ap-start,.ap-people .ap-end{grid-column:2;}
.ap-people .ap-you,.ap-people[data-ap-rows] .ap-you{grid-column:1 / -1;grid-row:1;justify-self:start;width:56px;height:56px;}
.ap-people .ap-more{grid-column:2;}
}
`;
