import { esc, NEEDS_DOT, inviteMailto, gapAfter } from './layout.js';
import { t } from './say.js';
import { face } from './faces.js';
import { renderSite, type SiteInput } from './site.js';
import { unitLabel } from './products.js';
import { disclosureFor } from '../../core/conversation/disclosure.js';
import { usd } from '../../core/types/money.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import * as show from './values.js';
import { solarSvg } from './icons.js';

/**
 * PHASE 3a — THE SITE, MOTION-LED (approved by the owner at the stop-gate, 2026-10-13).
 *
 * The roadmap's story — an employee that answers, negotiates, closes and (coming) keeps the books — told the way a
 * reel tells it: the first screen is a conversation that plays itself, one beat at a time, each beat named beside it
 * (the headline's own verbs), a playhead running under the one that is on. Below the first screen, the site as it is.
 *
 * WHAT IT SHOWS. What the product does today, the way it does it: a question answered at night goes alone, and its
 * first message says what is answering — the disclosure itself (`disclosureFor`), word for word, the one place the
 * page says "AI"; a price waits for the owner's tap; no order is confirmed without the owner; the proforma is made,
 * and the owner sends it. Keeping the books is "Coming": no date and nothing to click (Phase 5 is unscheduled).
 *
 * FIGURES (the owner's rule, 2026-10-13, written in site.ts too). Inside the reel's made-up shop, visibly marked as an
 * example, a quantity and a per-piece price may move — a price in a pretend conversation is no claim about Nomi.
 * Never, anywhere, the reel included: a figure about results, speed, revenue, conversion, time saved or how many
 * customers. The shop is invented (`SHOP`) so it is no real business's prices.
 *
 * MOTION. CSS alone: nothing fetched, no script. One twenty-second loop, four five-second scenes; every element's
 * timing is a keyframe of its own, started with its scene (a phase of the loop, never a wait), so it never drifts.
 * Under reduced motion nothing moves: the four scenes stand as a storyboard, each at its last frame.
 *
 * NOT YET THE SITE'S FIRST SCREEN (the owner's word, 2026-10-13): served at /site/next only, until every language's
 * words have had a native read (`REEL_NATIVE_REVIEW`; docs/NATIVE-REVIEW-UI.md). A Chinese visitor must never land
 * on a first screen half in English.
 */

/** The reel's words, read by a native speaker: until all five are, `/` keeps today's first screen. */
export const REEL_NATIVE_REVIEW: Readonly<Record<Locale, boolean>> = Object.freeze({ en: true, zh: false, ar: false, es: false, fr: false });
export const reelReady = (): boolean => Object.values(REEL_NATIVE_REVIEW).every(Boolean);

/** The made-up shop, its customer and its assistant: names, the same in every language. */
const SHOP = 'Linden Totes';
const CUSTOMER = 'Amira';
const ASSISTANT = 'Mira';
const INSTAGRAM: Readonly<Record<Locale, string>> = { en: 'Instagram', zh: 'Instagram', ar: 'إنستغرام', es: 'Instagram', fr: 'Instagram' };
/** The example's figures: a quantity, the per-piece price before and after — inside the reel only. */
const EXAMPLE = { qty: 500, was: usd(4.2), now: usd(3.8), total: usd(1900) } as const;

const CYCLE = 20;
const SCENE = 5;
/**
 * Where scene `n` starts, as a phase of the loop rather than a wait: a negative offset, so every element is already
 * mid-loop when the page opens and none sits on its first frame waiting for its turn (a beat still to come would
 * otherwise show as the one playing).
 */
const offset = (scene: number): number => (scene === 0 ? 0 : scene * SCENE - CYCLE);


/** One element's timing within its scene: the class that runs it, and the keyframes it needs. */
function timeline() {
  const frames = new Map<string, string>();
  const rules: string[] = [];
  const pc = (s: number): string => `${((s / CYCLE) * 100).toFixed(2)}%`;
  const id = (s: number): string => String(Math.round(s * 1000));
  const run = (scene: number, name: string, body: string): string => {
    const cls = `rl-${scene}-${name}`;
    if (!frames.has(name)) frames.set(name, body);
    rules.push(`.${cls} { animation:${name} ${CYCLE}s var(--motion-ease) ${offset(scene)}s infinite both; }`);
    return cls;
  };
  return {
    /** Arrives at `at` seconds into the scene, and stays. */
    appear: (scene: number, at: number) => run(scene, `rl-in-${id(at)}`,
      `0%, ${pc(at)} { opacity:0; transform:translateY(var(--travel-rise)); } ${pc(at + 0.4)}, 100% { opacity:1; transform:none; }`),
    /** Is there from the scene's start, and fades back at `at` seconds: the price that came down. */
    dim: (scene: number, at: number) => run(scene, `rl-dim-${id(at)}`,
      `0%, ${pc(at)} { opacity:1; } ${pc(at + 0.3)}, 100% { opacity:0.45; }`),
    /**
     * Is there from the scene's start, and FOLDS away at `at` seconds — the button once it is tapped: the card closes
     * up over it rather than keeping an empty box where it was (the owner's note on the hooks, 2026-10-14).
     */
    fold: (scene: number, at: number) => run(scene, `rl-fold-${id(at)}`,
      `0%, ${pc(at)} { opacity:1; max-block-size:4rem; } ${pc(at + 0.3)}, 100% { opacity:0; max-block-size:0; margin-block:0; padding-block:0; }`),
    /** Is there from the scene's start, and leaves at `at` seconds. */
    leave: (scene: number, at: number) => run(scene, `rl-out-${id(at)}`,
      `0%, ${pc(at)} { opacity:1; } ${pc(at + 0.2)}, 100% { opacity:0; }`),
    /** Shown from `from` to `to` seconds: the typing dots. */
    during: (scene: number, from: number, to: number) => run(scene, `rl-on-${id(from)}-${id(to)}`,
      `0%, ${pc(from)} { opacity:0; } ${pc(from + 0.15)}, ${pc(to)} { opacity:1; } ${pc(to + 0.15)}, 100% { opacity:0; }`),
    /** A tap, at `at` seconds: a ring that swells and fades. */
    tap: (scene: number, at: number) => run(scene, `rl-tap-${id(at)}`,
      `0%, ${pc(at)} { opacity:0; transform:scale(0.6); } ${pc(at + 0.15)} { opacity:0.9; transform:scale(1); } ${pc(at + 0.6)}, 100% { opacity:0; transform:scale(1.7); }`),
    css: () => [...[...frames].map(([n, b]) => `@keyframes ${n} { ${b} }`), ...rules].join('\n  '),
  };
}

/** The first screen: the words, the four beats with their playhead, and the conversation that plays. */
export function renderReelHero(v: SiteInput): { readonly html: string; readonly css: string } {
  const tl = timeline();
  const l = v.locale;
  const w = (key: string, params?: Record<string, string | number>) => esc(t(l, `site.reel.${key}` as Parameters<typeof t>[1], params));
  const mail = v.contact ? inviteMailto(l, v.contact) : null;
  const go = v.signUp ? `<a class="site-go" href="${esc(v.signUp)}">${esc(t(l, 'site.cta.signup'))}</a>`
    : mail ? `<a class="site-go" href="${esc(mail)}">${esc(t(l, 'site.cta.invite'))}</a>` : '';
  const qty = show.quantityOf(l, EXAMPLE.qty, unitLabel(l, 'pcs'));
  const was = show.money(l, EXAMPLE.was);
  const now = show.money(l, EXAMPLE.now);
  // The order's total, for the payoff (the owner's note on hook 3): the example's quantity at the price agreed.
  const total = show.money(l, EXAMPLE.total);
  const disclosure = disclosureFor({ detected: l, name: ASSISTANT, business: SHOP }) ?? '';
  const said = (cls: string, text: string, mine = false) =>
    `<p class="rl-bubble${mine ? ' rl-mine' : ''} ${cls}" dir="auto">${text}</p>`;
  const typing = (scene: number, from: number, to: number) =>
    `<p class="rl-typing ${tl.during(scene, from, to)}" aria-hidden="true"><i></i><i></i><i></i></p>`;
  const caption = (scene: number, at: number, key: string) => `<p class="rl-caption ${tl.appear(scene, at)}">${w(key)}</p>`;

  const scenes = [
    `<div class="rl-scene rl-s0">
      <p class="rl-late ${tl.appear(0, 0.1)}">${w('late')}</p>
      ${said(tl.appear(0, 0.3), w('s1.asks'))}
      <div class="rl-stack">${typing(0, 0.9, 1.8)}${said(`rl-disclose ${tl.appear(0, 1.9)}`, esc(disclosure), true)}</div>
      ${said(tl.appear(0, 2.4), w('s1.answers'), true)}
      ${caption(0, 3.3, 's1.caption')}
    </div>`,
    `<div class="rl-scene rl-s1">
      ${said(tl.appear(1, 0.3), w('s2.asks', { qty }))}
      <div class="rl-card rl-mine ${tl.appear(1, 1.1)}">
        <p class="rl-card-head"><span class="rl-by">${w('s2.by')}</span>
          <span class="rl-state"><span class="rl-need ${tl.leave(1, 3.0)}">${w('s2.waits')}</span><span class="ok ${tl.appear(1, 3.1)}">${w('s2.sent')}</span></span></p>
        <p class="rl-card-text" dir="auto">${w('s2.reply', { qty, now })}</p>
        <p class="rl-price"><s class="rl-was ${tl.dim(1, 1.8)}"><bdi>${esc(was)}</bdi></s> <b class="${tl.appear(1, 1.9)}"><bdi>${esc(now)}</bdi></b> ${w('s2.each')}</p>
        <p class="rl-act ${tl.fold(1, 3.0)}"><span class="rl-btn">${w('s2.send')}<span class="rl-ring ${tl.tap(1, 2.6)}"></span></span></p>
      </div>
      ${caption(1, 3.4, 's2.caption')}
    </div>`,
    `<div class="rl-scene rl-s2">
      ${said(tl.appear(2, 0.3), w('s3.asks'))}
      <div class="rl-card ${tl.appear(2, 1.0)}">
        <p class="rl-card-head"><span class="rl-by">${w('s3.order')}</span>
          <span class="rl-state"><span class="rl-need ${tl.leave(2, 2.6)}">${w('s2.waits')}</span><span class="ok ${tl.appear(2, 2.7)}">${w('s3.confirmed')}</span></span></p>
        <p class="rl-card-text rl-sum"><bdi>${esc(qty)}</bdi> × <bdi>${esc(now)}</bdi> = <b><bdi>${esc(total)}</bdi></b></p>
        <p class="rl-act ${tl.fold(2, 2.6)}"><span class="rl-btn">${w('s3.confirm')}<span class="rl-ring ${tl.tap(2, 2.2)}"></span></span></p>
      </div>
      <p class="rl-doc ${tl.appear(2, 3.0)}">${solarSvg('rl-doc-icon', 'file-text', 18)}${w('s3.proforma')}</p>
      ${caption(2, 3.5, 's3.caption')}
    </div>`,
    `<div class="rl-scene rl-s3 rl-books">
      <div class="rl-ledger ${tl.appear(3, 0.3)}">
        <p class="rl-card-head"><span class="rl-by">${w('s4.title')}</span><span class="rl-coming">${w('coming')}</span></p>
        <ul>${['s4.confirmed', 's4.deposit', 's4.paid'].map((k, i) => `<li class="${tl.appear(3, 0.8 + i * 0.5)}">${w(k)}</li>`).join('')}</ul>
      </div>
      ${caption(3, 2.6, 's4.caption')}
    </div>`,
  ];

  // The beats are the headline's own verbs: what the reel shows is what the headline says.
  const beats = (['answers', 'negotiates', 'closes', 'books'] as const).map((b, i) => `<li class="rl-beat rl-b${i}${b === 'books' ? ' rl-books' : ''}">
      <span class="rl-dot" aria-hidden="true"></span>
      <span class="rl-beat-text"><span class="rl-beat-title"><strong>${w(`${b}.title`)}</strong>${b === 'books' ? `<span class="rl-coming">${w('coming')}</span>` : ''}</span><span>${w(`${b}.line`)}</span></span>
      <span class="rl-play" aria-hidden="true"></span>
    </li>`).join('');

  const html = `<section class="rl-hero">
    <div class="rl-head">
      <h1>${w('title')}</h1>
      <p class="site-lead">${w('lead')}</p>
    </div>
    <div class="rl-more">
      <ol class="rl-beats">${beats}</ol>
      <p class="rl-note">${w('note')}</p>
      <p class="site-cta">${go}<span class="site-member">${esc(t(l, 'site.hero.member'))}${gapAfter(t(l, 'site.hero.member'))}<a href="${esc(v.signIn)}">${esc(t(l, 'site.signIn'))}</a></span></p>
    </div>
    <figure class="rl-phone" aria-label="${w('label')}">
      <figcaption class="rl-top"><span class="rl-who">${face({ clientId: 'site-example-customer', name: CUSTOMER }, 's')}<span><bdi>${esc(CUSTOMER)}</bdi> · ${esc(INSTAGRAM[l])}</span></span>
        <span class="rl-mark">${w('example')}</span></figcaption>
      <div class="rl-chat" data-example>${scenes.join('')}</div>
    </figure>
  </section>`;

  return { html, css: REEL_CSS + `\n  ${tl.css()}` };
}

/** The page at /site/next: the site, its first screen the reel. */
export function renderSiteReel(v: SiteInput): string {
  const hero = renderReelHero(v);
  return renderSite(v, { hero: hero.html, css: hero.css });
}

/**
 * The reel's own rules. Tokens only; every class starts `rl-` (the site's own start `site-`). Logical properties,
 * so the Arabic page mirrors itself once the words are in the catalogue.
 */
const REEL_CSS = `
  .rl-hero { display:grid; grid-template-columns:minmax(0, 1fr); grid-template-areas:"head" "phone" "more";
    gap:var(--space-32); padding-block:var(--space-24); }
  .rl-head { grid-area:head; } .rl-more { grid-area:more; } .rl-phone { grid-area:phone; }
  .rl-head h1 { font-size:var(--font-size-hero); line-height:var(--line-height-tight); margin:0 0 var(--space-24); font-weight:700;
    color:var(--color-ink); letter-spacing:var(--tracking-tight); text-wrap:balance; }
  @media (min-width: 60rem) {
    .rl-hero { grid-template-columns:minmax(0, 7fr) minmax(0, 5fr); grid-template-areas:"head phone" "more phone";
      grid-template-rows:auto 1fr; column-gap:var(--space-48); row-gap:0; padding-block:var(--space-48); align-items:start; }
    .rl-phone { position:sticky; inset-block-start:var(--space-24); }
  }
  .rl-beats { list-style:none; margin:0; padding:0; display:grid; gap:var(--space-4); }
  .rl-beat { position:relative; display:grid; grid-template-columns:auto minmax(0, 1fr); gap:var(--space-12); align-items:baseline;
    padding:var(--space-8) var(--space-16); border-radius:var(--radius-card); overflow:hidden;
    animation:rl-beat ${CYCLE}s var(--motion-ease) infinite both; }
  .rl-b1 { animation-delay:${offset(1)}s; } .rl-b2 { animation-delay:${offset(2)}s; } .rl-b3 { animation-delay:${offset(3)}s; }
  .rl-beat-text { display:flex; flex-direction:column; gap:var(--space-4); min-width:0; }
  .rl-beat strong { font-size:var(--font-size-base); color:var(--color-ink); }
  .rl-beat-text > span:last-child { color:var(--color-ink-secondary); font-size:var(--font-size-small); }
  .rl-dot { inline-size:10px; block-size:10px; border-radius:var(--radius-chip); background:var(--color-border);
    animation:rl-dot ${CYCLE}s var(--motion-ease) infinite both; animation-delay:inherit; }
  .rl-play { position:absolute; inset-inline:0; inset-block-end:0; block-size:2px; background:var(--color-brand);
    transform-origin:left center; transform:scaleX(0); animation:rl-play ${CYCLE}s linear infinite both; animation-delay:inherit; }
  [dir="rtl"] .rl-play { transform-origin:right center; }
  @keyframes rl-beat { 0%, 24% { background:var(--color-surface); box-shadow:var(--shadow-lift1); } 25%, 100% { background:transparent; box-shadow:none; } }
  @keyframes rl-dot { 0%, 24% { background:var(--color-brand); transform:scale(1.2); } 25%, 100% { background:var(--color-border); transform:none; } }
  @keyframes rl-play { 0% { transform:scaleX(0); } 25% { transform:scaleX(1); } 25.01%, 100% { transform:scaleX(0); } }
  .rl-coming { display:inline-block; margin-inline-start:var(--space-8); padding:1px var(--space-8); border-radius:var(--radius-chip);
    border:1px solid var(--color-border); color:var(--color-ink-secondary); font-size:var(--font-size-caption); font-weight:600; vertical-align:middle; }
  .rl-note { margin-top:var(--space-24); font-size:var(--font-size-small); color:var(--color-ink-secondary); }

  .rl-phone { margin:0; justify-self:center; inline-size:100%; max-width:var(--measure-form); background:var(--color-surface);
    border-radius:var(--radius-panel); box-shadow:var(--shadow-lift2); overflow:hidden; display:flex; flex-direction:column; }
  .rl-top { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:var(--space-8);
    padding:var(--space-12) var(--space-16); border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); }
  .rl-mark { padding:1px var(--space-8); border-radius:var(--radius-chip); border:1px dashed var(--color-border);
    color:var(--color-ink-secondary); font-size:var(--font-size-caption); font-weight:600; }
  .rl-who { display:inline-flex; align-items:center; gap:var(--space-8); color:var(--color-ink); font-weight:600; }
  .rl-chat { position:relative; block-size:30rem; background:var(--color-paper); }
  .rl-scene { position:absolute; inset:0; padding:var(--space-16); display:flex; flex-direction:column; gap:var(--space-8);
    animation:rl-scene ${CYCLE}s var(--motion-ease) infinite both; }
  .rl-s1 { animation-delay:${offset(1)}s; } .rl-s2 { animation-delay:${offset(2)}s; } .rl-s3 { animation-delay:${offset(3)}s; }
  @keyframes rl-scene { 0% { opacity:0; } 1.5%, 23.5% { opacity:1; } 25%, 100% { opacity:0; } }
  .rl-late { align-self:center; margin:0; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .rl-bubble { margin:0; padding:var(--space-8) var(--space-12); border-radius:var(--radius-card); max-width:85%;
    background:var(--color-surface); color:var(--color-ink); font-size:var(--font-size-small);
    align-self:flex-start; box-shadow:var(--shadow-lift1); }
  .rl-bubble.rl-mine { align-self:flex-end; background:var(--color-assistant-wash); }
  .rl-disclose { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .rl-stack { display:grid; justify-items:end; }
  .rl-stack > * { grid-area:1 / 1; }
  .rl-typing { margin:0; align-self:start; display:inline-flex; gap:var(--space-4); padding:var(--space-8) var(--space-12);
    border-radius:var(--radius-card); background:var(--color-assistant-wash); }
  .rl-typing i { inline-size:6px; block-size:6px; border-radius:var(--radius-chip); background:var(--color-ink-secondary); opacity:0.6; }
  .rl-card, .rl-ledger { align-self:flex-end; inline-size:85%; padding:var(--space-12); border-radius:var(--radius-card);
    background:var(--color-surface); border:1px solid var(--color-border); box-shadow:var(--shadow-lift1);
    display:flex; flex-direction:column; gap:var(--space-8); }
  .rl-card.rl-mine { background:var(--color-assistant-wash); }
  .rl-ledger { align-self:stretch; inline-size:auto; }
  .rl-card p, .rl-ledger p { margin:0; }
  .rl-card-head { display:flex; justify-content:space-between; align-items:center; gap:var(--space-8); flex-wrap:wrap;
    font-size:var(--font-size-caption); }
  .rl-by { color:var(--color-assistant); font-weight:600; }
  .rl-state { display:inline-grid; margin-inline-start:auto; }
  .rl-beat-title { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-4) 0; }
  .rl-state > span { grid-area:1 / 1; justify-self:end; padding:1px var(--space-8); border-radius:var(--radius-chip); font-weight:600; }
  .rl-need { background:var(--color-needs-wash); color:var(--color-needs); }
  .rl-need::before { ${NEEDS_DOT} margin-inline-end:0.4em; }
  .rl-state > .ok { background:var(--color-ok-wash); color:var(--color-ok); }
  .rl-card-text { font-size:var(--font-size-small); color:var(--color-ink); }
  .rl-price { align-self:flex-start; margin:0; padding:var(--space-4) var(--space-12); border-radius:var(--radius-chip);
    background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-ink-secondary); font-size:var(--font-size-small);
    font-variant-numeric:tabular-nums; }
  .rl-price s { color:var(--color-ink-secondary); }
  .rl-price b { color:var(--color-ink); font-size:var(--font-size-base); }
  .rl-act { display:flex; justify-content:flex-end; overflow:hidden; }
  .rl-btn { position:relative; display:inline-flex; padding:var(--space-4) var(--space-16); border-radius:var(--radius-control);
    background:var(--color-brand); color:var(--color-surface); font-size:var(--font-size-small); font-weight:600; }
  .rl-ring { position:absolute; inset:-6px; border-radius:var(--radius-control); border:2px solid var(--color-brand); opacity:0; pointer-events:none; }
  .rl-doc { align-self:flex-end; display:inline-flex; align-items:center; gap:var(--space-8); margin:0; padding:var(--space-8) var(--space-12);
    border-radius:var(--radius-card); background:var(--color-surface); border:1px solid var(--color-border); font-size:var(--font-size-small); font-weight:600; }
  .rl-doc-icon { flex:none; inline-size:18px; block-size:18px; color:var(--color-ink-secondary); }
  .rl-sum b { font-weight:700; }
  .rl-ledger ul { list-style:none; margin:0; padding:0; display:grid; gap:var(--space-4); }
  .rl-ledger li { padding:var(--space-8) 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); color:var(--color-ink); }
  .rl-ledger li:last-child { color:var(--color-ink-secondary); border-bottom:0; }
  .rl-caption { margin:auto 0 0; font-size:var(--font-size-small); font-weight:600; color:var(--color-ink); text-wrap:balance; }

  @media (prefers-reduced-motion: reduce) {
    .rl-chat { block-size:auto; display:grid; gap:var(--space-16); padding:var(--space-16); }
    .rl-scene { position:static; padding:0; }
    .rl-hero *, .rl-beat, .rl-dot, .rl-play { animation:none !important; opacity:1; transform:none; }
    .rl-typing, .rl-ring, .rl-need, .rl-play, .rl-act { display:none; }
  }
`;
