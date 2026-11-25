/** UI Block 9 (F47): a page's state, its heading, its reason and its one next step (stateBlock.ts). Each kind carries
 * a mark of its own shape beside the heading, so the kinds differ by more than colour. */
export const STATE_CSS = `.state{display:grid;gap:var(--space-8);justify-items:start;margin-block:var(--space-16);padding:var(--space-24);
  background:var(--color-sand);border-radius:var(--radius-card);max-inline-size:var(--measure-form);}
.state-h{display:flex;align-items:center;gap:var(--space-8);margin:0;font-size:var(--font-size-title);font-weight:600;line-height:var(--line-height-tight);color:var(--color-ink);}
.state-h::before{content:"";flex:none;inline-size:0.6em;block-size:0.6em;border:2px solid var(--color-ink-secondary);}
.state[data-state="empty"] .state-h::before{border-radius:var(--radius-chip);}
.state[data-state="nomatch"] .state-h::before{border-radius:var(--radius-chip);border-style:dashed;}
.state[data-state="loading"] .state-h::before{border-radius:var(--radius-chip);border-inline-end-color:transparent;}
.state[data-state="error"] .state-h::before{transform:rotate(45deg);border-color:var(--color-ink);}
.state[data-state="forbidden"] .state-h::before{background:var(--color-ink-secondary);}
.state[data-state="unavailable"] .state-h::before{border-style:dashed;}
.state-p{margin:0;color:var(--color-ink-secondary);max-inline-size:60ch;overflow-wrap:anywhere;}
.state-next{margin:var(--space-4) 0 0;}
.state-next a,.state-next button{min-block-size:44px;display:inline-flex;align-items:center;}
@media(max-width:600px){.state{padding:var(--space-16);}}
`;
