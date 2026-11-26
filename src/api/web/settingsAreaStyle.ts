export const SETTINGS_AREA_CSS=`
.settings-area{max-width:100%;margin-inline:auto;}
.sa-content{min-width:0;max-width:var(--measure-column);}
.sa-content>h1.page{margin-top:0;}
.sa-content .lede{max-width:var(--measure-prose);}
.sa-index-list{list-style:none;padding:0;margin-block:var(--space-32);}
.sa-index-list li{border-top:1px solid var(--color-border);}
.sa-index-list a{display:flex;align-items:center;justify-content:space-between;gap:var(--space-24);padding-block:var(--space-24);text-decoration:none;font-weight:600;}
.sa-index-list svg{width:18px;flex:none;}
.sa-description{display:block;color:var(--color-ink-secondary);font-weight:400;font-size:var(--font-size-small);margin-top:var(--space-8);}
.settings-area .scard,.settings-area .card{box-shadow:none;border-inline:0;border-radius:0;background:transparent;}
.settings-area .sgroup{margin-block:var(--space-32);}
.settings-area .srow{padding-inline:0;}
.settings-area .setrow{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-12);padding-block:var(--space-24);}
.settings-area .setrow .fr-c{width:100%;min-width:0;}
.settings-area input:not([type=checkbox]):not([type=radio]),.settings-area select,.settings-area textarea{max-width:100%;}
.settings-area textarea{width:100%;}
.settings-area .btn{min-height:44px;background:var(--color-ink);color:var(--color-surface);border-color:var(--color-ink);}
.settings-area .ch-screen .code{font-size:var(--font-size-small);letter-spacing:normal;white-space:pre-wrap;overflow-wrap:anywhere;}
.settings-area form{max-width:100%;}
.settings-area .block{padding-block:var(--space-24);border-top:1px solid var(--color-border);}
.sa-subject{margin-block:var(--space-32);padding-top:var(--space-24);border-top:1px solid var(--color-border);}
.sa-subject h2{font-size:var(--font-size-title);}
.sa-subject>summary{min-height:44px;scroll-margin-block-start:var(--space-24);}
.sa-sum{display:flex;flex-direction:column;gap:var(--space-4);min-width:0;}
.sa-sname{font-weight:600;}
.sa-now{font-size:var(--font-size-small);color:var(--color-ink-secondary);overflow-wrap:anywhere;}
.sa-body{padding-top:var(--space-16);}
.sa-body:focus{outline:none;}
.sa-body:focus-visible{outline:2px solid var(--color-ink);outline-offset:2px;}
.stop-panel{margin-block:var(--space-24);padding:var(--space-16) var(--space-24);border:1px solid var(--color-ink);border-radius:var(--radius-card);}
.stop-panel h2{margin:0 0 var(--space-8);font-size:var(--font-size-base);}
.stop-panel .stop-here{margin:0;padding:0;border:0;}
.settings-area .btn.danger{background:transparent;color:var(--color-ink);border-color:var(--color-ink);}
.settings-area :is(.certlist,.actrow) .btn{background:transparent;color:var(--color-ink);border:1px solid var(--color-ink);}
.sa-value{margin-block:var(--space-24);}
.sa-value dt{color:var(--color-ink-secondary);font-size:var(--font-size-small);}
.sa-value dd{margin:var(--space-8) 0 var(--space-24);overflow-wrap:anywhere;}
.sa-logout{margin-top:var(--space-32);}
.ch-states{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-8) var(--space-16);margin-top:var(--space-12);}
.ch-one{display:flex;flex-wrap:wrap;align-items:baseline;}
.ch-state{display:flex;flex-direction:column;gap:var(--space-4);min-width:0;}
.ch-k{font-size:var(--font-size-caption);color:var(--color-ink-secondary);}
.ch-state .sr-value,.ch-v{max-width:100%;margin:0;text-align:start;font-size:var(--font-size-small);overflow-wrap:anywhere;}
.ch-v{color:var(--color-ink);}
.ch-next{margin-top:var(--space-12);font-size:var(--font-size-small);font-weight:600;color:var(--color-ink);}
.ch-code{margin-block:var(--space-16);}
.ch-tools{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-8) var(--space-16);margin-top:var(--space-12);}
.settings-area .ch-tools .btn{display:inline-flex;align-items:center;gap:var(--space-8);background:transparent;color:var(--color-ink);border:1px solid var(--color-ink);}
.ch-tools a{display:inline-flex;align-items:center;gap:var(--space-8);min-height:44px;}
.ch-tools svg{inline-size:18px;block-size:18px;flex:none;}
.ch-said:empty{display:none;}
.help-step>summary h2{margin:0;font-size:var(--font-size-base);}
.help-step .sa-body>:first-child{margin-top:0;}
.sa-subject.help-step{margin-block:0;padding-top:var(--space-8);}
.sa-subject.help-step+.sa-subject.help-step{margin-top:var(--space-8);}
.sa-vh{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
.biz-scope{margin-block:var(--space-16) 0;color:var(--color-ink-secondary);}
.settings-area .biz-form .scard{border-top:1px solid var(--color-border);}
.settings-area .biz-form .fr-acts{padding-inline:0;}
.settings-area .setrow:has(input[type=checkbox]) label.fr-name{display:flex;align-items:center;min-height:44px;}
.biz-door{margin:var(--space-12) 0 0;}
.settings-area .biz-form .sgroup-h{font-size:var(--font-size-title);font-weight:600;color:var(--color-ink);margin-block:var(--space-32) var(--space-8);}
.settings-area h3.sgroup-h{font-size:var(--font-size-base);font-weight:600;color:var(--color-ink);margin-block:var(--space-24) var(--space-8);}
.settings-area .closures .btn{background:transparent;color:var(--color-ink);border:1px solid var(--color-ink);}
.team-table{width:100%;border-collapse:collapse;margin-top:var(--space-16);}
.team-table th,.team-table td{padding:var(--space-12) var(--space-8);text-align:start;vertical-align:top;border-top:1px solid var(--color-border);}
.team-table thead th{font-size:var(--font-size-small);font-weight:600;color:var(--color-ink-secondary);border-top:0;padding-top:0;}
.team-table tbody th{font-weight:400;}
.team-table td{font-size:var(--font-size-small);overflow-wrap:anywhere;}
.team-table .tm-edit td{border-top:0;padding-top:0;}
.tm-k{display:none;}
.team-edit>summary{display:flex;align-items:center;min-height:44px;cursor:pointer;font-size:var(--font-size-small);}
.tm-body{padding-block:var(--space-8) var(--space-16);}
.tm-role{margin:0 0 var(--space-12);}
.tm-remove p{margin:0 0 var(--space-12);max-width:var(--measure-prose);}
.settings-area .tm-remove .btn,.settings-area .team-avail .btn{background:transparent;color:var(--color-ink);border:1px solid var(--color-ink);}
.team-add>summary h2{margin:0;font-size:var(--font-size-title);}
.sa-subject.team-add{margin-block:0;padding-top:0;border-top:0;}
.tm-rolerow{display:block;}
.tm-roles{border:0;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-4);min-width:0;}
.tm-roles legend{font-weight:600;margin-bottom:var(--space-8);padding:0;}
.tm-choice{display:flex;align-items:center;gap:var(--space-12);min-height:44px;}
.tm-choice input{flex:none;}
.team-roles h3,.team-avail h3{font-size:var(--font-size-base);font-weight:600;margin-block:var(--space-24) var(--space-4);}
.team-avail .turn{display:flex;flex-wrap:wrap;align-items:flex-end;gap:var(--space-12) var(--space-24);width:100%;}
.team-avail .turn .person{flex:1 1 12em;align-self:center;}
.turn-away{display:flex;flex-direction:column;gap:var(--space-4);}
.turn-switch{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-12);margin-block:var(--space-12);}
.dr-index ul{display:flex;flex-wrap:wrap;gap:0 var(--space-24);list-style:none;margin:0 0 var(--space-8);padding:0;}
.dr-index a{display:inline-flex;align-items:center;min-height:44px;text-decoration:underline;text-underline-offset:3px;}
.dr-index-h{margin:0;font-size:var(--font-size-small);color:var(--color-ink-secondary);}
.dr-short{margin:0 0 var(--space-8);max-width:var(--measure-prose);}
.sa-subject.data-review{margin-block:var(--space-8) 0;padding-top:0;border-top:0;}
.data-review>summary{display:flex;align-items:center;cursor:pointer;font-weight:600;}
.data-review .sa-body>.lede:first-child{margin-top:var(--space-8);}
.settings-area .btn.hist-quiet{background:transparent;color:var(--color-ink);border:1px solid var(--color-ink);}
.settings-area .btn.second{background:transparent;color:var(--color-ink);border:1px solid var(--color-ink);}
.hist-team .row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--space-8) var(--space-16);}
.quiet-pair{display:flex;flex-wrap:wrap;gap:var(--space-12) var(--space-24);}
.quiet-one{display:flex;flex-direction:column;gap:var(--space-4);flex:1 1 10em;min-width:0;}
.ways-after{margin-top:var(--space-12);}
@media(max-width:600px){.team-table thead{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);}.team-table,.team-table tbody,.team-table tr,.team-table th,.team-table td{display:block;}.team-table tr.tm{border-top:1px solid var(--color-border);padding-block:var(--space-12) var(--space-4);}.team-table th,.team-table td{border:0;padding:var(--space-4) 0;}.team-table .tm-edit td{padding:0 0 var(--space-8);}.tm-k{display:inline;color:var(--color-ink-secondary);margin-inline-end:var(--space-8);}}
@media(min-width:721px){.settings-area .biz-form .setrow{grid-template-columns:minmax(0,2fr) minmax(0,3fr);gap:var(--space-8) var(--space-24);}.settings-area .biz-form .fr-l{padding-top:var(--space-8);}}
@media(max-width:1100px){.sa-content{max-width:none;}}
@media(max-width:600px){.settings-area .sr-menu{flex-wrap:wrap;}.settings-area .sform,.settings-area .pform{width:100%;}.settings-area .dparts{max-width:100%;}.settings-area .people-perms{flex-wrap:wrap;}.ch-states{grid-template-columns:minmax(0,1fr);gap:var(--space-8);}.ch-state{flex-direction:row;justify-content:space-between;gap:var(--space-12);}.ch-state .sr-value,.ch-v{text-align:end;}}
`;
