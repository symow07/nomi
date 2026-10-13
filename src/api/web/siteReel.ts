import { esc, NEEDS_DOT, inviteMailto, gapAfter } from './layout.js';
import { t } from './say.js';
import { face } from './faces.js';
import { renderSite, type SiteInput } from './site.js';

/**
 * PHASE 3a — THE SITE, MOTION-LED: A DRAFT FOR THE OWNER'S STOP-GATE (2026-10-13). Not the site yet.
 *
 * The roadmap's story — an employee that answers, negotiates, sells and (coming) keeps the books — told the way a
 * reel tells it: the first screen is a conversation that plays itself, one beat at a time, each beat named beside
 * it, a playhead running under the one that is on. Everything below the first screen is today's site, unchanged.
 *
 * WHAT IT MAY SHOW. What the product does today, the way it does it: a question answered at night goes alone, and
 * its first message says what is answering (the disclosure, word for word); a price waits for the owner's tap; no
 * order is confirmed without the owner; the proforma is made, and the owner sends it. Keeping the books is marked
 * as coming. No figure, no "we", no price of Nomi's own.
 *
 * MOTION. CSS alone — the page asks nothing of the network and runs no script. One twenty-second loop, four
 * five-second scenes; every element's timing is a keyframe of its own, started with its scene, so the loop never
 * drifts. Under reduced motion nothing moves: the four scenes stand as a storyboard, each at its last frame.
 *
 * The words are English only while the owner reads the draft (DRAFT, below); approved, they move to the catalogue
 * in the five languages, and this replaces the site's first screen.
 */

const CYCLE = 20;
const SCENE = 5;
/**
 * Where scene `n` starts, as a phase of the loop rather than a wait: a negative offset, so every element is already
 * mid-loop when the page opens and none sits on its first frame waiting for its turn (a beat still to come would
 * otherwise show as the one playing).
 */
const offset = (scene: number): number => (scene === 0 ? 0 : scene * SCENE - CYCLE);

/** The draft's words. English, for the owner to read; the catalogue's once approved. */
const DRAFT = {
  title: 'It answers. It negotiates. It closes. You keep the last word.',
  lead: 'Nomi gives your business a sales assistant you name. When a customer writes on WhatsApp, Instagram, Messenger or e-mail, your assistant answers from your own products and prices, works out the deal inside the limits you set, and brings you the order to confirm — at any hour.',
  note: 'Anything with a price waits for your tap until your assistant has earned a record of its own. No order is confirmed without you.',
  reelLabel: 'A conversation, as it happens',
  coming: 'Coming',
  beats: [
    { title: 'Answers', line: 'A question at midnight is answered at once, from what you taught.' },
    { title: 'Negotiates', line: 'It works out the price for the quantity, never below your lowest, and waits for your tap.' },
    { title: 'Sells', line: 'The customer says yes, you confirm in one tap, and the proforma is ready to send.' },
    { title: 'Keeps the books', line: 'Every order and payment, in one place.', coming: true },
  ],
  channel: 'Instagram',
  customer: 'Amira',
  late: 'Late at night',
  s1: {
    asks: 'Hi! Do you have the canvas tote in navy?',
    disclosure: 'Hi, I’m Mira, Westlake Canvas’s AI assistant. If you’d like a person from our team, just say so and they’ll reply as soon as they can.',
    answers: 'Yes, the canvas tote comes in navy and it’s in stock. How many would you like?',
    caption: 'Answered at once — and it says what is answering.',
  },
  s2: {
    asks: 'It’s for my shop, a big order. Can you do better on the price?',
    by: 'Mira’s reply',
    waits: 'Waits for your OK',
    sent: 'Sent',
    reply: 'For an order that size the price per piece comes down. Here is your price for that quantity.',
    price: 'Your price for that quantity',
    send: 'Send',
    caption: 'Never below the lowest price you set.',
  },
  s3: {
    asks: 'Perfect, please confirm the order.',
    order: 'Order · Canvas tote, navy',
    waits: 'Waits for your OK',
    confirm: 'Confirm',
    confirmed: 'Confirmed',
    proforma: 'Proforma invoice · ready to send',
    caption: 'Confirmed when you say so. The proforma is ready.',
  },
  s4: {
    title: 'Your books',
    rows: ['Order confirmed · Canvas tote', 'Deposit asked for', 'Paid'],
    caption: 'Keeps the books — coming.',
  },
} as const;

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
  const k = esc;
  const l = v.locale;
  const mail = v.contact ? inviteMailto(l, v.contact) : null;
  const go = v.signUp ? `<a class="site-go" href="${esc(v.signUp)}">${k(t(l, 'site.cta.signup'))}</a>`
    : mail ? `<a class="site-go" href="${esc(mail)}">${k(t(l, 'site.cta.invite'))}</a>` : '';
  const who = (name: string, extra = '') => `<span class="rl-who">${face({ clientId: 'site-example-customer', name }, 's')}<span>${k(name)}${extra}</span></span>`;
  const said = (cls: string, text: string, mine = false) =>
    `<p class="rl-bubble${mine ? ' rl-mine' : ''} ${cls}" dir="auto">${k(text)}</p>`;
  const typing = (scene: number, from: number, to: number) =>
    `<p class="rl-typing ${tl.during(scene, from, to)}" aria-hidden="true"><i></i><i></i><i></i></p>`;
  const caption = (scene: number, at: number, text: string) => `<p class="rl-caption ${tl.appear(scene, at)}">${k(text)}</p>`;

  const scenes = [
    `<div class="rl-scene rl-s0">
      <p class="rl-late ${tl.appear(0, 0.1)}">${k(DRAFT.late)}</p>
      ${said(tl.appear(0, 0.3), DRAFT.s1.asks)}
      <div class="rl-stack">${typing(0, 0.9, 1.8)}${said(`rl-disclose ${tl.appear(0, 1.9)}`, DRAFT.s1.disclosure, true)}</div>
      ${said(tl.appear(0, 2.4), DRAFT.s1.answers, true)}
      ${caption(0, 3.3, DRAFT.s1.caption)}
    </div>`,
    `<div class="rl-scene rl-s1">
      ${said(tl.appear(1, 0.3), DRAFT.s2.asks)}
      <div class="rl-card rl-mine ${tl.appear(1, 1.1)}">
        <p class="rl-card-head"><span class="rl-by">${k(DRAFT.s2.by)}</span>
          <span class="rl-state"><span class="rl-need ${tl.leave(1, 3.0)}">${k(DRAFT.s2.waits)}</span><span class="ok ${tl.appear(1, 3.1)}">${k(DRAFT.s2.sent)}</span></span></p>
        <p class="rl-card-text" dir="auto">${k(DRAFT.s2.reply)}</p>
        <p class="rl-price">${k(DRAFT.s2.price)}</p>
        <p class="rl-act ${tl.leave(1, 3.0)}"><span class="rl-btn">${k(DRAFT.s2.send)}<span class="rl-ring ${tl.tap(1, 2.6)}"></span></span></p>
      </div>
      ${caption(1, 3.4, DRAFT.s2.caption)}
    </div>`,
    `<div class="rl-scene rl-s2">
      ${said(tl.appear(2, 0.3), DRAFT.s3.asks)}
      <div class="rl-card ${tl.appear(2, 1.0)}">
        <p class="rl-card-head"><span class="rl-by">${k(DRAFT.s3.order)}</span>
          <span class="rl-state"><span class="rl-need ${tl.leave(2, 2.6)}">${k(DRAFT.s3.waits)}</span><span class="ok ${tl.appear(2, 2.7)}">${k(DRAFT.s3.confirmed)}</span></span></p>
        <p class="rl-act ${tl.leave(2, 2.6)}"><span class="rl-btn">${k(DRAFT.s3.confirm)}<span class="rl-ring ${tl.tap(2, 2.2)}"></span></span></p>
      </div>
      <p class="rl-doc ${tl.appear(2, 3.0)}"><span class="rl-doc-mark" aria-hidden="true"></span>${k(DRAFT.s3.proforma)}</p>
      ${caption(2, 3.5, DRAFT.s3.caption)}
    </div>`,
    `<div class="rl-scene rl-s3">
      <div class="rl-ledger ${tl.appear(3, 0.3)}">
        <p class="rl-card-head"><span class="rl-by">${k(DRAFT.s4.title)}</span><span class="rl-coming">${k(DRAFT.coming)}</span></p>
        <ul>${DRAFT.s4.rows.map((r, i) => `<li class="${tl.appear(3, 0.8 + i * 0.5)}">${k(r)}</li>`).join('')}</ul>
      </div>
      ${caption(3, 2.6, DRAFT.s4.caption)}
    </div>`,
  ];

  const beats = DRAFT.beats.map((b, i) => `<li class="rl-beat rl-b${i}">
      <span class="rl-dot" aria-hidden="true"></span>
      <span class="rl-beat-text"><span class="rl-beat-title"><strong>${k(b.title)}</strong>${'coming' in b && b.coming ? `<span class="rl-coming">${k(DRAFT.coming)}</span>` : ''}</span><span>${k(b.line)}</span></span>
      <span class="rl-play" aria-hidden="true"></span>
    </li>`).join('');

  const html = `<section class="rl-hero">
    <div class="rl-head">
      <h1>${k(DRAFT.title)}</h1>
      <p class="site-lead">${k(DRAFT.lead)}</p>
    </div>
    <div class="rl-more">
      <ol class="rl-beats">${beats}</ol>
      <p class="rl-note">${k(DRAFT.note)}</p>
      <p class="site-cta">${go}<span class="site-member">${k(t(l, 'site.hero.member'))}${gapAfter(t(l, 'site.hero.member'))}<a href="${esc(v.signIn)}">${k(t(l, 'site.signIn'))}</a></span></p>
    </div>
    <figure class="rl-phone" aria-label="${k(DRAFT.reelLabel)}">
      <figcaption class="rl-top">${who(DRAFT.customer, ` · ${k(DRAFT.channel)}`)}</figcaption>
      <div class="rl-chat">${scenes.join('')}</div>
    </figure>
  </section>`;

  return { html, css: REEL_CSS + `\n  ${tl.css()}` };
}

/** The draft page: today's site, its first screen replaced by the reel. */
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
      column-gap:var(--space-48); row-gap:0; padding-block:var(--space-48); align-items:start; }
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
  .rl-top { padding:var(--space-12) var(--space-16); border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); }
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
  .rl-price { align-self:flex-start; padding:var(--space-4) var(--space-12); border-radius:var(--radius-chip);
    background:var(--color-surface); border:1px dashed var(--color-border); color:var(--color-assistant); font-size:var(--font-size-caption); font-weight:600; }
  .rl-act { display:flex; justify-content:flex-end; }
  .rl-btn { position:relative; display:inline-flex; padding:var(--space-4) var(--space-16); border-radius:var(--radius-control);
    background:var(--color-brand); color:var(--color-surface); font-size:var(--font-size-small); font-weight:600; }
  .rl-ring { position:absolute; inset:-6px; border-radius:var(--radius-control); border:2px solid var(--color-brand); opacity:0; pointer-events:none; }
  .rl-doc { align-self:flex-end; display:inline-flex; align-items:center; gap:var(--space-8); margin:0; padding:var(--space-8) var(--space-12);
    border-radius:var(--radius-card); background:var(--color-surface); border:1px solid var(--color-border); font-size:var(--font-size-small); font-weight:600; }
  .rl-doc-mark { inline-size:14px; block-size:18px; border-radius:2px; border:2px solid var(--color-ink-secondary); }
  .rl-ledger ul { list-style:none; margin:0; padding:0; display:grid; gap:var(--space-4); }
  .rl-ledger li { padding:var(--space-8) 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); color:var(--color-ink); }
  .rl-ledger li:last-child { color:var(--color-ink-secondary); border-bottom:0; }
  .rl-caption { margin:auto 0 0; font-size:var(--font-size-small); font-weight:600; color:var(--color-ink); text-wrap:balance; }

  @media (prefers-reduced-motion: reduce) {
    .rl-chat { block-size:auto; display:grid; gap:var(--space-16); padding:var(--space-16); }
    .rl-scene { position:static; padding:0; }
    .rl-hero *, .rl-beat, .rl-dot, .rl-play { animation:none !important; opacity:1; transform:none; }
    .rl-typing, .rl-ring, .rl-need, .rl-play { display:none; }
  }
`;
