export const FOLLOW_UP_CSS = `
.follow-up-settings,.follow-ups{min-inline-size:0}
.follow-up-settings form{display:grid;gap:var(--space-8)}
.follow-up-settings textarea,.follow-up-settings select{inline-size:100%;min-inline-size:0;box-sizing:border-box}
.follow-up-settings .follow-up-check{display:flex;gap:var(--space-8);align-items:start}
.follow-up-settings .follow-up-check input{inline-size:auto;flex:none}
.follow-up-settings .follow-up-check bdi{flex:1;text-align:match-parent}
.follow-up-settings button{justify-self:start}
.follow-up-words{display:block;white-space:pre-wrap;overflow-wrap:anywhere;text-align:match-parent;margin-inline:0}
.follow-up-run{padding-block:var(--space-16);border-block-start:1px solid var(--color-border)}
.follow-ups{padding:var(--space-16)}
`;
