export const SETTINGS_AREA_CSS=`
.settings-area{display:grid;grid-template-columns:10rem minmax(0,1fr);gap:var(--space-32);max-width:100%;margin-inline:auto;}
.sa-nav{display:flex;flex-direction:column;align-self:start;position:sticky;top:var(--space-24);}
.sa-nav a{display:flex;align-items:center;min-height:44px;padding:var(--space-12);border-inline-start:2px solid transparent;color:var(--color-ink);text-decoration:none;}
.sa-nav a[aria-current]{color:var(--color-accent);border-inline-start-color:var(--color-accent);}
.sa-nav .sa-index{font-size:var(--font-size-small);color:var(--color-ink-secondary);margin-bottom:var(--space-16);}
.sa-chooser,.sa-page-chooser{display:none;}
.sa-content{min-width:0;max-width:var(--measure-column);}
.sa-content>h1.page{margin-top:0;}
.sa-content .lede{max-width:var(--measure-prose);}
.sa-index-list{list-style:none;padding:0;margin-block:var(--space-32);}
.sa-index-list li{border-top:1px solid var(--color-border);}
.sa-index-list a{display:flex;align-items:center;justify-content:space-between;gap:var(--space-24);padding-block:var(--space-24);text-decoration:none;font-weight:600;}
.sa-index-list svg{width:18px;flex:none;}
.sa-description{display:block;color:var(--color-ink-secondary);font-weight:400;font-size:var(--font-size-small);margin-top:var(--space-8);}
.sa-pages{display:flex;flex-wrap:wrap;gap:var(--space-8) var(--space-24);border-bottom:1px solid var(--color-border);margin-bottom:var(--space-32);}
.sa-pages a{display:flex;align-items:center;min-height:44px;text-decoration:none;color:var(--color-ink-secondary);border-bottom:2px solid transparent;font-size:var(--font-size-small);}
.sa-pages a[aria-current]{color:var(--color-accent);border-bottom-color:var(--color-accent);}
.settings-area .scard,.settings-area .card{box-shadow:none;border-inline:0;border-radius:0;background:transparent;}
.settings-area .sgroup{margin-block:var(--space-32);}
.settings-area .srow{padding-inline:0;}
.settings-area .setrow{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-12);padding-block:var(--space-24);}
.settings-area .setrow .fr-c{width:100%;min-width:0;}
.settings-area input:not([type=checkbox]):not([type=radio]),.settings-area select,.settings-area textarea{max-width:100%;min-height:44px;font-size:var(--font-size-base);}
.settings-area textarea{width:100%;}
.settings-area .btn{min-height:44px;background:var(--color-ink);color:var(--color-surface);border-color:var(--color-ink);}
.settings-area .ch-screen .code{font-size:var(--font-size-small);letter-spacing:normal;white-space:pre-wrap;overflow-wrap:anywhere;}
.settings-area form{max-width:100%;}
.settings-area .block{padding-block:var(--space-24);border-top:1px solid var(--color-border);}
.sa-subject{margin-block:var(--space-32);padding-top:var(--space-24);border-top:1px solid var(--color-border);}
.sa-subject h2{font-size:var(--font-size-title);}
.sa-value{margin-block:var(--space-24);}
.sa-value dt{color:var(--color-ink-secondary);font-size:var(--font-size-small);}
.sa-value dd{margin:var(--space-8) 0 var(--space-24);overflow-wrap:anywhere;}
.sa-logout{margin-top:var(--space-32);}
@media(max-width:1100px){.settings-area{grid-template-columns:minmax(0,1fr);}.sa-nav{position:static;flex-direction:row;flex-wrap:wrap;}.sa-nav .sa-index{margin:0;}.sa-content{max-width:none;}}
@media(max-width:600px){.sa-nav,.sa-pages{display:none;}.sa-page-chooser{display:block;margin-bottom:var(--space-24);border-bottom:1px solid var(--color-border);padding-bottom:var(--space-12);}.sa-page-chooser summary{display:flex;align-items:center;justify-content:space-between;min-height:44px;}.sa-page-chooser nav a{display:flex;align-items:center;min-height:44px;}.sa-chooser{display:block;}.sa-chooser summary{display:flex;align-items:center;justify-content:space-between;min-height:44px;}.sa-chooser nav a{display:flex;align-items:center;min-height:44px;}.settings-area{gap:var(--space-24);}.sa-pages{gap:var(--space-8) var(--space-16);}.settings-area .sr-menu{flex-wrap:wrap;}.settings-area .sform,.settings-area .pform{width:100%;}.settings-area .dparts{max-width:100%;}.settings-area .people-perms{flex-wrap:wrap;}}
`;
