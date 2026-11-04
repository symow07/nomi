import { DESIGN_TOKENS, SPLIT_TOKENS as K } from '../../core/owner/tokens.js';
import { SPLIT_FACES_CSS } from './type.js';

/**
 * THE SPLIT TODAY PREVIEW'S STYLESHEET (2026-11-04; docs/DESIGN-SYSTEM.md). Linked after the app's own sheet by the one
 * page drawn with `body.split`; no other page sees a rule of it. It re-points the shell's own custom properties inside
 * `.split`, so what the shell draws (the rail, a notice, a door, a toast) follows without a second copy of its rules.
 */

/** The ink-wash band: an SVG of cloudy noise, in ink, fading downward. Base64, as the favicon is: the served text stays clean. */
const WASH = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="220" viewBox="0 0 1400 220" preserveAspectRatio="none">
<filter id="w" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.0045 0.022" numOctaves="5" seed="11"/>
<feColorMatrix values="0 0 0 0 0.145 0 0 0 0 0.125 0 0 0 0 0.11 0.62 0 0 0 -0.16"/>
</filter>
<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="0.55" stop-color="#999"/><stop offset="1" stop-color="#000"/></linearGradient>
<mask id="m"><rect width="1400" height="220" fill="url(#f)"/></mask>
<rect width="1400" height="220" filter="url(#w)" mask="url(#m)"/>
</svg>`).toString('base64');

const serif = {
  en: '"Newsreader Variable", "Noto Serif SC", "Noto Naskh Arabic Variable", Georgia, serif',
  zh: '"Noto Serif SC", "Newsreader Variable", "Noto Naskh Arabic Variable", serif',
  ar: '"Noto Naskh Arabic Variable", "Newsreader Variable", "Noto Serif SC", serif',
};
const hairline = DESIGN_TOKENS.color.border;

export const SPLIT_CSS = `${SPLIT_FACES_CSS}
.split {
  --sp-serif:${serif.en};
  --sp-jade:${K.color.jade}; --sp-jade-wash:${K.color.jadeWash};
  --sp-ochre:${K.color.ochre}; --sp-ochre-text:${K.color.ochreText}; --sp-ochre-wash:${K.color.ochreWash};
  --sp-magenta:${K.color.magenta}; --sp-neutral:${K.color.neutral}; --sp-wine:${K.color.wine};
  --sp-line:${hairline};
  --color-brand:var(--color-ink); --color-needs:var(--sp-ochre-text); --color-needs-wash:var(--sp-ochre-wash);
  --color-assistant:var(--color-ink); --color-assistant-wash:var(--color-paper);
  --color-ok:var(--sp-jade); --color-ok-wash:var(--sp-jade-wash); --color-warn:var(--sp-ochre-text); --color-warn-wash:var(--sp-ochre-wash);
  --shadow-lift1:none; --shadow-lift2:none; --shadow-lift3:none;
  background:var(--color-paper);
}
html[lang="zh"] .split { --sp-serif:${serif.zh}; }
html[lang="ar"] .split { --sp-serif:${serif.ar}; }
.split .mark { --color-brand:var(--sp-wine); --color-coin:var(--sp-wine); }
/* A customer with no photo: a neutral initial, one colour for everyone. */
.split .face { background:var(--sp-neutral); color:var(--color-ink-secondary); }

/* The rail */
.split nav.side { background:var(--color-paper); border-inline-end:1px solid var(--sp-line); }
.split nav.side a.navlink.active { background:var(--sp-neutral); box-shadow:none; color:var(--color-ink); }
.split nav.side a.navlink.active .ni { color:var(--color-ink); }
.split .navcount { color:var(--sp-ochre-text); }
.split .sp-me { display:flex; align-items:center; gap:${K.space[8]}px; min-height:44px; padding:${K.space[4]}px ${K.space[8]}px; color:var(--color-ink);
  font-size:var(--font-size-small); text-decoration:none; border-radius:${K.radius.control}px; }
.split .sp-me:hover { background:var(--sp-neutral); }

/* The page */
.split main.wide { max-inline-size:none; padding:0; }
.sp { max-inline-size:1280px; margin-inline:auto; padding-block-end:${K.space[32]}px; }
.sp-head { position:relative; display:flex; align-items:flex-start; justify-content:space-between; gap:${K.space[16]}px;
  padding:${K.space[32]}px ${K.space[24]}px ${K.space[24]}px;
  background:url("data:image/svg+xml;base64,${WASH}") top center / 100% 100% no-repeat; }
.sp-headmark { display:none; }
.split h1.page { margin:0; font-family:var(--sp-serif); font-size:${K.size.title}px; font-weight:400; line-height:1.1; letter-spacing:-0.01em; color:var(--color-ink); }
html[lang="ar"] .split h1.page, html[lang="zh"] .split h1.page { letter-spacing:0; line-height:1.3; }
.sp-sub { margin:${K.space[4]}px 0 0; font-size:var(--font-size-small); color:var(--color-ink-secondary); }
.sp-new { flex:none; margin:0; }
.sp-panels { display:grid; grid-template-columns:minmax(0, 1.15fr) minmax(0, 1fr); gap:${K.space[24]}px; padding-inline:${K.space[24]}px; align-items:start; }
.sp-panels.is-one { grid-template-columns:minmax(0, 720px); }
.sp-start { padding-inline:${K.space[24]}px; }
@media (max-width: 1100px) { .sp-panels { grid-template-columns:minmax(0, 1fr); } }

/* A panel: a heading on the paper, then flat cards with a hairline */
.sp-panel { display:grid; gap:${K.space[12]}px; min-inline-size:0; }
.sp-phead { display:flex; align-items:center; justify-content:space-between; gap:${K.space[12]}px; min-block-size:44px; }
.sp-phead h2 { display:flex; align-items:center; gap:${K.space[8]}px; margin:0; font-family:var(--sp-serif); font-size:${K.size.name}px; font-weight:500; line-height:1.3; letter-spacing:0; color:var(--color-ink); }
.sp-phead .ni { inline-size:22px; block-size:22px; }
.sp-phead .deeper { margin:0; font-size:var(--font-size-small); }
.sp-phead .sp-cap { margin:0; }
.sp-card { padding:${K.space[20]}px; background:var(--color-surface); border:1px solid var(--sp-line); border-radius:${K.radius.panel}px; min-inline-size:0; }
.sp-card > *:first-child { margin-block-start:0; }
.sp-card h3 { margin:0; font-family:var(--sp-serif); font-size:${K.size.name}px; font-weight:500; line-height:1.3; letter-spacing:0; color:var(--color-ink); }
.sp-cap { margin:0 0 ${K.space[12]}px; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }

/* Buttons: one filled magenta, on Send; everything else outlined */
.sp-btn { display:inline-flex; align-items:center; justify-content:center; min-block-size:44px; padding:0 ${K.space[20]}px; cursor:pointer;
  font:inherit; font-size:var(--font-size-small); font-weight:500; color:var(--color-ink); background:var(--color-surface);
  border:1px solid var(--color-ink-secondary); border-radius:${K.radius.control}px; }
.sp-btn:hover { background:var(--sp-neutral); }
.sp-btn:focus-visible { outline:2px solid var(--color-ink); outline-offset:2px; }
.sp-btn.sp-send { color:#fff; background:var(--sp-magenta); border-color:var(--sp-magenta); }
.sp-btn.sp-send:hover { background:var(--sp-magenta); filter:brightness(0.92); }
.sp-btn.sp-quiet { min-block-size:36px; padding-inline:${K.space[12]}px; font-size:var(--font-size-caption); }
.sp-remind { margin:0; }

/* The decision card */
.sp-who { display:flex; align-items:center; gap:${K.space[16]}px; min-inline-size:0; }
.sp-who .face { inline-size:72px; block-size:72px; font-size:${K.size.question}px; }
.sp-who-t { min-inline-size:0; }
.sp-name { display:block; font-family:var(--sp-serif); font-size:${K.size.name}px; font-weight:500; line-height:1.3; color:var(--color-ink); text-decoration:none; overflow-wrap:anywhere; }
.sp-name:hover { text-decoration:underline; }
.sp-deal { display:flex; align-items:center; gap:${K.space[8]}px; margin:${K.space[4]}px 0 0; font-size:var(--font-size-small); color:var(--color-ink); }
.sp-from { margin:${K.space[4]}px 0 0; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.sp-thumb { display:inline-block; flex:none; inline-size:36px; block-size:36px; object-fit:cover; border-radius:${K.radius.thumb}px; background:var(--sp-neutral); }
.sp-thumb-s { inline-size:28px; block-size:28px; }
.sp-q { margin:${K.space[16]}px 0 ${K.space[8]}px !important; font-size:${K.size.question}px !important; font-weight:400 !important; line-height:1.25 !important; }
.sp-form { margin:0; }
.sp-reply { display:block; inline-size:100%; margin:0 0 ${K.space[12]}px; padding:${K.space[12]}px; font:inherit; font-size:var(--font-size-small); line-height:1.55; color:var(--color-ink);
  background:var(--color-paper); border:1px solid var(--sp-line); border-radius:${K.radius.control}px; resize:vertical; field-sizing:content; }
.sp-reply:focus { outline:2px solid var(--color-ink); outline-offset:1px; background:var(--color-surface); }
.sp-acts { display:flex; flex-wrap:wrap; gap:${K.space[8]}px; }
.sp-window { margin:${K.space[8]}px 0 0; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.sp-decide details.reading { margin-block-start:${K.space[12]}px; }

/* What else waits */
.sp-also { margin-block-start:${K.space[16]}px; padding-block-start:${K.space[16]}px; border-block-start:1px solid var(--sp-line); }
.sp-also:first-child { margin-block-start:0; padding-block-start:0; border-block-start:0; }
.split .tw-head, .split .tw-need { color:var(--color-ink); }
.split .tw-note { background:transparent; border:0; padding:0; margin:0 0 ${K.space[12]}px; }
.split .notlive { margin:0 0 ${K.space[12]}px; color:var(--sp-ochre-text); font-size:var(--font-size-small); }
.split .today-foot { margin:0; font-size:var(--font-size-caption); }
.sp-notices:empty { display:none; }

/* The stage strip */
.sp-stages { display:flex; margin:0; padding:0; list-style:none; }
.sp-stages li { position:relative; flex:1 1 0; min-inline-size:0; display:flex; flex-direction:column; align-items:center; text-align:center; padding-block-start:${K.space[20]}px; }
.sp-stages li::before { content:""; position:absolute; inset-block-start:6px; inset-inline-start:50%; inline-size:100%; block-size:1px; background:var(--sp-line); }
html[dir="rtl"] .sp-stages li::before { inset-inline-start:auto; inset-inline-end:50%; }
.sp-stages li:last-child::before { display:none; }
.sp-dot { position:absolute; inset-block-start:0; z-index:1; inline-size:13px; block-size:13px; border-radius:50%; background:var(--color-surface); border:2px solid var(--sp-line); }
.sp-stages li.is-done .sp-dot { background:var(--sp-jade); border-color:var(--sp-jade); }
.sp-stages li.is-waiting .sp-dot { border-color:var(--sp-ochre); }
.sp-stage { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.sp-fig { font-size:var(--font-size-small); font-weight:600; color:var(--color-ink); font-variant-numeric:lining-nums; }
.sp-val { font-size:var(--font-size-caption); color:var(--color-ink); font-variant-numeric:lining-nums; overflow-wrap:anywhere; }

/* Rows */
.sp-rows { display:block; margin:0; padding:0; list-style:none; }
.sp-row { display:grid; grid-template-columns:36px minmax(0, 1fr) 30px auto 72px 40px 16px; align-items:center; gap:${K.space[8]}px ${K.space[12]}px; min-block-size:52px; padding-block:${K.space[8]}px;
  color:var(--color-ink); text-decoration:none; border-block-start:1px solid var(--sp-line); }
.sp-rows li:first-child .sp-row { border-block-start:0; }
.sp-row:hover .sp-rname { text-decoration:underline; }
.sp-row .face { inline-size:36px; block-size:36px; font-size:var(--font-size-small); }
.sp-rname { font-size:var(--font-size-small); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sp-rval { font-size:var(--font-size-small); text-align:end; font-variant-numeric:lining-nums tabular-nums; white-space:nowrap; }
.sp-rday { font-size:var(--font-size-caption); color:var(--color-ink-secondary); text-align:end; white-space:nowrap; }
.sp-chip { justify-self:start; padding:2px ${K.space[8]}px; font-size:var(--font-size-caption); line-height:1.5; white-space:nowrap; color:var(--color-ink-secondary); background:var(--sp-neutral); border-radius:${K.radius.chip}px; }
.sp-chip.is-order { color:var(--sp-jade); background:var(--sp-jade-wash); }
.sp-chip.is-waiting { color:var(--sp-ochre-text); background:var(--sp-ochre-wash); }
.sp-row .go { justify-self:end; color:var(--color-ink-secondary); }

/* Books */
.sp-money { display:grid; grid-template-columns:minmax(0, 1fr) 150px; gap:${K.space[4]}px ${K.space[16]}px; align-items:end; }
.sp-money h3 { grid-column:1 / -1; }
.sp-inout { margin:${K.space[4]}px 0 0; font-size:var(--font-size-small); color:var(--color-ink); font-variant-numeric:lining-nums; }
.sp-profit { display:flex; flex-wrap:wrap; align-items:baseline; gap:${K.space[8]}px; margin:${K.space[8]}px 0 0; font-family:var(--sp-serif); font-size:${K.size.name}px; color:var(--sp-jade); }
.sp-profit.is-down { color:var(--color-ink); }
.sp-big { font-size:${K.size.money}px; line-height:1.1; font-variant-numeric:lining-nums; }
.sp-trend { display:block; margin:0; }
.sp-trend svg { display:block; inline-size:100%; block-size:auto; overflow:visible; }
html[dir="rtl"] .sp-trend svg { transform:scaleX(-1); }
.sp-owed { margin:${K.space[4]}px 0 0; font-size:var(--font-size-small); font-variant-numeric:lining-nums; }
.sp-over { margin:${K.space[4]}px 0 0; font-family:var(--sp-serif); font-size:${K.size.name}px; color:var(--sp-ochre); }
.sp-note { margin:${K.space[4]}px 0 0; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.sp-late { display:flex; flex-wrap:wrap; align-items:center; gap:${K.space[8]}px ${K.space[12]}px; margin-block-start:${K.space[12]}px; padding-block-start:${K.space[12]}px; border-block-start:1px solid var(--sp-line); font-size:var(--font-size-small); }
.sp-late .face { inline-size:32px; block-size:32px; font-size:var(--font-size-small); }
.sp-late-n { font-weight:500; min-inline-size:0; overflow-wrap:anywhere; }
.sp-late-d { color:var(--sp-ochre-text); font-size:var(--font-size-caption); }
.sp-remind { margin-inline-start:auto; }
.sp-door { display:flex; align-items:center; gap:${K.space[12]}px; min-block-size:44px; color:var(--color-ink); text-decoration:none; font-size:var(--font-size-small); }
.sp-door:hover { text-decoration:underline; }
.sp-door > .go { margin-inline-start:auto; color:var(--color-ink-secondary); }
.sp-door .ni { inline-size:22px; block-size:22px; flex:none; }
.sp-phonedoor { display:none; }

/* A phone: Sales first, Books below, the tab bar at the foot */
@media (max-width: 720px) {
  .split nav.side { position:fixed; inset-block:auto 0; inset-inline:0; z-index:5; padding:${K.space[4]}px ${K.space[4]}px calc(${K.space[4]}px + env(safe-area-inset-bottom));
    background:var(--color-surface); border-inline-end:0; border-block-end:0; border-block-start:1px solid var(--sp-line); animation:none; }
  .split nav.side .brand, .split .sp-me, .split .sp-notab { display:none; }
  .split nav.side a.navlink, .split nav.side a.navlink.sub { min-block-size:56px; gap:${K.space[4]}px; animation:none; }
  .split nav.side a.navlink.active { background:transparent; font-weight:600; }
  .split nav.side .ni { inline-size:24px; block-size:24px; }
  .split .business-name { display:none; }
  .split .content { padding-block-end:calc(84px + env(safe-area-inset-bottom)); }
  .split .toasts { inset-block-end:calc(84px + env(safe-area-inset-bottom)); }
  .sp-head { align-items:center; flex-wrap:wrap; padding:${K.space[20]}px ${K.space[16]}px ${K.space[16]}px; }
  .sp-headmark { display:block; flex:none; line-height:0; }
  .sp-headt { flex:1 1 0; min-inline-size:0; }
  .split h1.page { font-size:${K.size.titlePhone}px; }
  .sp-panels { gap:${K.space[20]}px; padding-inline:${K.space[12]}px; }
  .sp-start { padding-inline:${K.space[12]}px; }
  .sp-card { padding:${K.space[16]}px; }
  .sp-who .face { inline-size:56px; block-size:56px; font-size:var(--font-size-title); }
  .sp-acts .sp-btn { flex:1 1 auto; }
  .sp-row { grid-template-columns:36px 28px minmax(0, 1fr) auto 14px; grid-template-areas:"face thumb name val go" "face thumb chip day go"; gap:2px ${K.space[8]}px; }
  .sp-row .face { grid-area:face; }
  .sp-row .sp-thumb { grid-area:thumb; }
  .sp-rname { grid-area:name; }
  .sp-chip { grid-area:chip; }
  .sp-rval { grid-area:val; }
  .sp-rday { grid-area:day; }
  .sp-row .go { grid-area:go; }
  .sp-money { grid-template-columns:minmax(0, 1fr) 110px; }
  .sp-big { font-size:34px; }
  .sp-phonedoor { display:block; padding:${K.space[16]}px ${K.space[16]}px 0; }
}
`;
