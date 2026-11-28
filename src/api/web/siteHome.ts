import { readdirSync, readFileSync } from 'node:fs';
import { t } from './say.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { markSmall } from '../../core/owner/brand.js';
import { publicFrame, esc, langMenu, LANGSW_CSS, LANGMENU_CSS, inviteMailto } from './layout.js';
import { brandSvg, type BrandLogo } from './brandLogos.js';
import { solarSvg } from './icons.js';

/**
 * THE PUBLIC SITE, REBUILT (finding F45; the owner's brief of 2026-11-27, inventory approved 2026-11-28).
 *
 * The homepage in the app's own look (DESIGN_TOKENS through `publicFrame`: off-white, near-black, the seal's magenta
 * as a mark only, one sans). Its first screen is a reply being made, played in the page: a customer writes, the
 * assistant drafts, the price stops at the owner's lowest, the visitor taps Approve. Scripted here, no model call;
 * with reduced motion it is drawn whole at once, and with no script the same frame is drawn with no controls.
 *
 * Every claim maps to a line of the inventory (docs/SITE-CLAIMS.md). No figure of the product's performance.
 *
 * REVIEW STAGE: the hero, the channel strip and the first chapter, at /site/new (noindex), for the owner's OK
 * before the rest is built and the page replaces the current site.
 */

export type SiteHomeInput = {
  readonly locale: Locale;
  /** Where the language menu returns. */
  readonly path: string;
  /** The address a trial request is written to. Absent, the button goes to sign-up or is not drawn. */
  readonly contact: string | null;
  readonly signIn: string;
  readonly noindex: boolean;
};

// ── The demo's script ──────────────────────────────────────────────────────────────────────────────────────────
// One conversation, in the three languages the switch offers. The disclosure is the product's own sentence
// (src/core/conversation/disclosure.ts), as a customer gets it on the first reply. Halden Studio is an invented
// clothing brand: the same workspace the screenshots come from (src/demo/siteDemo.ts).

type DemoLang = 'en' | 'zh' | 'ar';
const BUSINESS = 'Halden Studio';
const ASSISTANT = 'Lily';
type Line = { readonly who: 'customer' | 'shop'; readonly text: string };
type Script = {
  readonly customer: string;
  readonly lines: readonly Line[];
  /** The reply that waits for the owner, then goes out on Approve. */
  readonly draft: string;
  readonly after: string;
};
const PRICES = { list: 68, asked: 50, floor: 58, qty: 2 } as const;

export const DEMO_SCRIPT: Record<DemoLang, Script> = {
  en: {
    customer: 'Emma',
    lines: [
      { who: 'customer', text: 'Hi! Is the linen shirt still in sand, size M?' },
      { who: 'shop', text: `Hi, I'm ${ASSISTANT}, ${BUSINESS}'s AI assistant. If you'd like a person from our team, just say so and they'll reply as soon as they can.` },
      { who: 'shop', text: 'Yes, sand in M is in stock. It’s $68.' },
      { who: 'customer', text: 'I’d like two. Could you do $50 each?' },
    ],
    draft: 'I can’t go as low as $50, but for two I can do $58 each, so $116 for both. Does that work for you?',
    after: 'Perfect, two please!',
  },
  zh: {
    customer: '王静',
    lines: [
      { who: 'customer', text: '你好！亚麻衬衫沙色M码还有吗？' },
      { who: 'shop', text: `您好，我是${ASSISTANT}，${BUSINESS}的AI助手。如需人工服务请告诉我，同事会尽快回复您。` },
      { who: 'shop', text: '沙色M码有货，价格是68美元。' },
      { who: 'customer', text: '我想要两件，每件50美元可以吗？' },
    ],
    draft: '50美元给不了，两件的话每件可以算58美元，两件一共116美元。这样可以吗？',
    after: '可以，要两件！',
  },
  ar: {
    customer: 'ليلى',
    lines: [
      { who: 'customer', text: 'مرحبًا! هل القميص الكتان متوفر باللون الرملي مقاس M؟' },
      { who: 'shop', text: `مرحبًا، أنا ${ASSISTANT}، مساعد آلي لدى ${BUSINESS}. للتحدث مع شخص من فريقنا يكفي طلب ذلك، ويصل الرد في أقرب وقت ممكن.` },
      { who: 'shop', text: 'نعم، اللون الرملي مقاس M متوفر، وسعره 68 دولارًا.' },
      { who: 'customer', text: 'أريد قطعتين. هل يمكن بـ50 دولارًا للقطعة؟' },
    ],
    draft: 'لا أستطيع النزول إلى 50 دولارًا، لكن للقطعتين أقدر أن أجعلها 58 دولارًا للقطعة، أي 116 دولارًا للاثنتين. هل يناسبك ذلك؟',
    after: 'ممتاز، قطعتان من فضلك!',
  },
};

const DEMO_LANG_LABEL: Record<DemoLang, string> = { en: 'English', zh: '中文', ar: 'العربية' };
const demoDefault = (l: Locale): DemoLang => (l === 'zh' || l === 'ar' ? l : 'en');

// ── The screenshots ────────────────────────────────────────────────────────────────────────────────────────────
// Taken from the local demo workspace by tools/site-shots.mjs, one per language and width. Served from the build.

const SHOT_DIR = new URL('../../../assets/site/', import.meta.url);
const SHOT_NAME = /^[a-z]+\.(en|zh|ar|es|fr)\.(wide|phone)\.webp$/;
const SHOTS: ReadonlySet<string> = (() => {
  try { return new Set(readdirSync(SHOT_DIR).filter((f) => SHOT_NAME.test(f))); } catch { return new Set(); }
})();
const shotBytes = new Map<string, Buffer>();
/** A site picture by its exact name, or null. */
export function siteShotAt(file: string): Buffer | null {
  if (!SHOTS.has(file)) return null;
  let b = shotBytes.get(file);
  if (!b) { b = readFileSync(new URL(file, SHOT_DIR)); shotBytes.set(file, b); }
  return b;
}

/** The picture of one place in the app, in the page's language, the phone cut on a narrow screen. */
function shot(name: string, l: Locale, alt: string, w: number, h: number, pw: number, ph: number): string {
  const wide = `${name}.${l}.wide.webp`;
  const phone = `${name}.${l}.phone.webp`;
  if (!SHOTS.has(wide)) return '';
  return `<picture>${SHOTS.has(phone) ? `<source media="(max-width: 40rem)" srcset="/assets/site/${phone}" width="${pw}" height="${ph}">` : ''}`
    + `<img src="/assets/site/${wide}" alt="${esc(alt)}" width="${w}" height="${h}" loading="lazy" decoding="async"></picture>`;
}

// ── The page ───────────────────────────────────────────────────────────────────────────────────────────────────

const CHANNELS: readonly { readonly id: string; readonly logo: BrandLogo | 'email' | 'webchat'; readonly how?: MessageKey }[] = [
  { id: 'whatsapp', logo: 'whatsapp' },
  { id: 'instagram', logo: 'instagram', how: 'www.channels.instagram.how' },
  { id: 'messenger', logo: 'messenger' },
  { id: 'email', logo: 'email', how: 'www.channels.email.how' },
  { id: 'tiktok', logo: 'tiktok' },
  { id: 'webchat', logo: 'webchat', how: 'www.channels.webchat.how' },
  { id: 'telegram', logo: 'telegram' },
];
type Named = Partial<Record<Locale, string>> & { en: string };
const CHANNEL_NAME: Record<'whatsapp' | 'instagram' | 'messenger' | 'tiktok' | 'telegram', Named> = {
  whatsapp: { en: 'WhatsApp', ar: 'واتساب' },
  instagram: { en: 'Instagram', ar: 'إنستغرام' },
  messenger: { en: 'Messenger', ar: 'ماسنجر' },
  tiktok: { en: 'TikTok', ar: 'تيك توك' },
  telegram: { en: 'Telegram', ar: 'تيليغرام' },
};

export function renderSiteHome(v: SiteHomeInput): string {
  const l = v.locale;
  const k = (key: MessageKey, p?: Record<string, string | number>) => esc(t(l, key, p));
  const mail = v.contact ? esc(inviteMailto(l, v.contact)) : null;
  const trial = (cls: string) => (mail ? `<a class="${cls}" href="${mail}">${k('www.cta.trial')}</a>` : '');
  const dl = demoDefault(l);
  const s = DEMO_SCRIPT[dl];
  const money = (n: number) => `<bdi dir="ltr">$${n}</bdi>`;

  const bubble = (who: 'customer' | 'shop', text: string, cls = '') =>
    `<li class="b ${who === 'customer' ? 'mine' : 'theirs'}${cls}" dir="auto">${esc(text)}</li>`;

  // The frame drawn by the server: the moment the reply waits for the owner. The script redraws it as it plays.
  const phone = `<div class="phone" data-channel="whatsapp" dir="${dl === 'ar' ? 'rtl' : 'ltr'}" lang="${dl}">
        <div class="phone-top"><span class="phone-face" aria-hidden="true">H</span><span class="phone-who"><b>${BUSINESS}</b><small class="phone-ch">${esc(CHANNEL_NAME.whatsapp[l] ?? 'WhatsApp')}</small></span></div>
        <ol class="chat" aria-live="polite">${s.lines.map((x) => bubble(x.who, x.text)).join('')}</ol>
        <div class="phone-bar" aria-hidden="true"><span></span></div>
      </div>`;
  const card = `<div class="card" lang="${l}">
        <p class="card-who">${markSmall(18, null)}<span>${k('card.drafted', { name: ASSISTANT })}</span><span class="card-wait">${k('www.demo.waits')}</span></p>
        <p class="card-draft" dir="auto" lang="${dl}">${esc(s.draft)}</p>
        <div class="floor" aria-label="${k('www.demo.stopped')}">
          <dl class="floor-nums">
            <div class="asked"><dt>${k('www.demo.asked')}</dt><dd>${money(PRICES.asked)}</dd></div>
            <div class="low"><dt>${k('www.demo.lowest')}</dt><dd>${money(PRICES.floor)}</dd></div>
            <div><dt>${k('www.demo.offered')}</dt><dd>${money(PRICES.floor)}</dd></div>
          </dl>
          <div class="track" aria-hidden="true"><span class="below"></span><span class="above"><i class="dot"></i></span></div>
          <p class="floor-say">${k('www.demo.stopped')}</p>
        </div>
        <p class="card-act"><button type="button" class="approve">${k('www.demo.approve')}</button><span class="card-tap">${k('www.demo.tap')}</span><span class="card-sent" hidden>${k('www.demo.sent')}</span></p>
      </div>`;

  const seg = (name: string, label: MessageKey, items: readonly [string, string][], on: string) =>
    `<div class="seg" role="group" aria-label="${k(label)}" data-seg="${name}"><span class="seg-label">${k(label)}</span>${items.map(([val, word]) =>
      `<button type="button" data-${name}="${val}" aria-pressed="${val === on}"${name === 'lang' ? ` lang="${val}"` : ''}>${esc(word)}</button>`).join('')}</div>`;

  const channel = (c: (typeof CHANNELS)[number]) => {
    const logo = c.logo === 'email' ? solarSvg('ch-logo', 'letter', 28) : c.logo === 'webchat' ? solarSvg('ch-logo', 'chat-round-dots', 28)
      : brandSvg('ch-logo', c.logo, 28, `-strip`);
    const name = c.id === 'email' ? k('www.channels.email') : c.id === 'webchat' ? k('www.channels.webchat') : esc(CHANNEL_NAME[c.id as keyof typeof CHANNEL_NAME][l] ?? CHANNEL_NAME[c.id as keyof typeof CHANNEL_NAME].en);
    return `<li>${logo}<span class="ch-name">${name}</span>${c.how ? `<span class="ch-how">${k(c.how)}</span>` : ''}</li>`;
  };
  const point = (p: string) => `<li><h3>${k(`www.answer.${p}.h` as MessageKey)}</h3><p>${k(`www.answer.${p}.p` as MessageKey)}</p></li>`;

  const data = JSON.stringify({
    script: DEMO_SCRIPT, start: dl,
    channel: { whatsapp: CHANNEL_NAME.whatsapp[l] ?? 'WhatsApp', instagram: CHANNEL_NAME.instagram[l] ?? 'Instagram' },
    writing: t(l, 'www.demo.writing'),
  }).replace(/</g, '\\u003c');

  return publicFrame({
    locale: l, title: t(l, 'www.title'), noindex: v.noindex, mainClass: 'www',
    extraCss: LANGSW_CSS + LANGMENU_CSS + HOME_CSS,
    body: `<header class="top">
  <a class="brand" href="${esc(v.path)}">${markSmall(32, null)}<span>Nomi</span></a>
  <nav class="top-nav" aria-label="${k('www.nav.label')}"><a href="#answer">${k('www.nav.features')}</a></nav>
  <div class="top-end">${langMenu(l, v.path)}<a class="signin" href="${esc(v.signIn)}">${k('site.signIn')}</a>${trial('go go-s')}</div>
</header>

<section class="hero" aria-labelledby="hero-h">
  <div class="hero-text">
    <h1 id="hero-h">${k('www.hero.title')}</h1>
    <p class="lead">${k('www.hero.lead')}</p>
    <p class="hero-cta">${trial('go')}<a class="go go-2" href="#demo" data-watch>${k('www.hero.watch')}</a></p>
  </div>
  <figure class="demo" id="demo" aria-label="${k('www.demo.label')}" data-step="5">
    <div class="stage">
      <div class="side side-phone"><p class="side-label">${k('www.demo.customer')}</p>${phone}</div>
      <div class="side side-card"><p class="side-label">${k('www.demo.you')}</p>${card}</div>
    </div>
    <div class="demo-controls">${seg('lang', 'www.demo.language', (['en', 'zh', 'ar'] as const).map((x) => [x, DEMO_LANG_LABEL[x]]), dl)}${
      seg('channel', 'www.demo.channel', [['whatsapp', CHANNEL_NAME.whatsapp[l] ?? 'WhatsApp'], ['instagram', CHANNEL_NAME.instagram[l] ?? 'Instagram']], 'whatsapp')}</div>
    <p class="demo-again"><button type="button" class="again" hidden>${k('www.demo.again')}</button></p>
  </figure>
</section>

<section class="strip" aria-labelledby="ch-h">
  <h2 id="ch-h">${k('www.channels.title')}</h2>
  <p>${k('www.channels.lead')}</p>
  <ul class="channels">${CHANNELS.map(channel).join('')}</ul>
</section>

<section class="chapter" id="answer" aria-labelledby="answer-h">
  <div class="chapter-head">
    <p class="kicker">${k('www.answer.kicker')}</p>
    <h2 id="answer-h">${k('www.answer.title')}</h2>
    <p class="lead">${k('www.answer.lead')}</p>
  </div>
  <div class="shot">${shot('answer', l, t(l, 'www.answer.shot'), 2880, 1800, 780, 1688)}</div>
  <ul class="points">${['inbox', 'draft', 'handoff', 'media', 'languages'].map(point).join('')}</ul>
</section>
<script type="application/json" id="demo-data">${data}</script>
<script>${DEMO_JS}</script>`,
  });
}

// ── The page's rules ───────────────────────────────────────────────────────────────────────────────────────────

const HOME_CSS = `
  main.www { max-width:none; margin:0; padding:0; }
  .www { --wrap:72rem; --gut:clamp(1rem, 4vw, 2.5rem); }
  .www > * { max-width:var(--wrap); margin-inline:auto; padding-inline:var(--gut); }
  .www h1, .www h2, .www h3 { color:var(--color-ink); }
  .www p { color:var(--color-ink-secondary); }
  .www .lead { font-size:var(--font-size-field); }

  /* The top line */
  .top { display:flex; align-items:center; gap:var(--space-16); padding-block:var(--space-16); }
  .brand { display:inline-flex; align-items:center; gap:var(--space-8); min-height:44px; font-weight:700; font-size:var(--font-size-title);
    color:var(--color-ink); text-decoration:none; }
  .brand .mark { --color-brand:var(--color-cue); }
  .top-nav { display:flex; gap:var(--space-16); margin-inline-start:var(--space-16); }
  .top-nav a, .signin { color:var(--color-ink); text-decoration:none; min-height:44px; display:inline-flex; align-items:center; }
  .top-nav a:hover, .signin:hover { text-decoration:underline; }
  .top-end { display:flex; align-items:center; gap:var(--space-12); margin-inline-start:auto; }
  .langmenu .langsw { position:absolute; inset-inline-end:0; top:calc(100% + 4px); flex-direction:column; z-index:3; }

  /* Buttons that are doors: one filled (ink), one outlined */
  .go { display:inline-flex; align-items:center; justify-content:center; min-height:48px; padding:0 var(--space-24);
    border-radius:var(--radius-chip); background:var(--color-ink); color:var(--color-surface); font-weight:600;
    text-decoration:none; white-space:nowrap; }
  .go:hover { background:var(--color-ink-secondary); }
  .go-2 { background:transparent; color:var(--color-ink); box-shadow:inset 0 0 0 1px var(--color-control-line); }
  .go-2:hover { background:var(--color-sand); }
  .go-s { min-height:44px; padding:0 var(--space-16); }

  /* The first screen */
  .hero { display:grid; grid-template-columns:minmax(0, 5fr) minmax(0, 7fr); gap:var(--space-48); align-items:center;
    padding-block:var(--space-32) var(--space-48); }
  .hero h1 { font-size:clamp(2.25rem, 1.2rem + 3.2vw, 3.6rem); line-height:1.08; letter-spacing:-0.025em; margin:0 0 var(--space-20);
    text-wrap:balance; }
  [lang="zh"] .hero h1, [lang="ar"] .hero h1 { line-height:1.3; letter-spacing:0; }
  .hero .lead { max-width:34rem; margin-bottom:var(--space-32); }
  .hero-cta { display:flex; flex-wrap:wrap; gap:var(--space-12); }

  /* The demo */
  .demo { margin:0; }
  .demo-controls { display:flex; flex-wrap:wrap; gap:var(--space-8) var(--space-16); justify-content:center; margin-top:var(--space-20); }
  .seg { display:inline-flex; align-items:center; gap:var(--space-4); padding:3px; border:1px solid var(--color-border);
    border-radius:var(--radius-chip); background:var(--color-surface); }
  .seg-label { font-size:var(--font-size-caption); color:var(--color-ink-secondary); padding-inline:var(--space-8) var(--space-4); }
  .seg button { min-height:36px; min-width:44px; padding:0 var(--space-12); border-radius:var(--radius-chip); background:transparent;
    color:var(--color-ink-secondary); font-size:var(--font-size-small); font-weight:500; }
  .seg button[aria-pressed="true"] { background:var(--color-ink); color:var(--color-surface); }
  html:not(.js) .demo-controls, html:not(.js) .card-act, html:not(.js) .demo-again { display:none; }
  .stage { display:flex; align-items:flex-end; justify-content:center; }
  .side-label { font-size:var(--font-size-caption); margin:0 0 var(--space-8); padding-inline-start:var(--space-4); }
  .side-phone { flex:none; width:19.5rem; position:relative; z-index:1; }
  .side-card { flex:none; width:21rem; margin-inline-start:-2.5rem; margin-bottom:var(--space-32); position:relative; z-index:2; }
  .side-card .side-label { padding-inline-start:3.25rem; }

  .phone { height:34rem; display:flex; flex-direction:column; border-radius:2.4rem; background:var(--color-surface);
    border:8px solid var(--color-ink); overflow:hidden; box-shadow:var(--shadow-lift2); }
  .phone-top { display:flex; align-items:center; gap:var(--space-8); padding:var(--space-16) var(--space-12) var(--space-8);
    border-bottom:1px solid var(--color-border); background:var(--color-surface); }
  .phone-face { width:32px; height:32px; border-radius:50vh; display:grid; place-items:center; background:var(--color-sand);
    color:var(--color-ink); font-weight:700; font-size:var(--font-size-small); }
  .phone-who { display:flex; flex-direction:column; line-height:1.2; }
  .phone-who b { font-size:var(--font-size-small); color:var(--color-ink); }
  .phone-ch { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .chat { flex:1; list-style:none; margin:0; padding:var(--space-12); display:flex; flex-direction:column; justify-content:flex-end;
    gap:var(--space-8); overflow:hidden; }
  .phone[data-channel="whatsapp"] .chat { background:var(--color-demo-whatsapp-ground); }
  .b { max-width:82cqw; max-width:16rem; padding:var(--space-8) var(--space-12); border-radius:14px; font-size:var(--font-size-small);
    line-height:1.4; margin:0; color:var(--color-ink); }
  .b.mine { align-self:flex-end; }
  .b.theirs { align-self:flex-start; }
  .phone[data-channel="whatsapp"] .b.theirs { background:var(--color-surface); border-start-start-radius:4px; }
  .phone[data-channel="whatsapp"] .b.mine { background:var(--color-demo-whatsapp-mine); border-start-end-radius:4px; }
  .phone[data-channel="instagram"] .b { border-radius:20px; }
  .phone[data-channel="instagram"] .b.theirs { background:var(--color-demo-instagram-theirs); }
  .phone[data-channel="instagram"] .b.mine { background:var(--color-demo-instagram-mine); color:var(--color-surface); }
  .b.typing { display:inline-flex; gap:4px; padding:12px 14px; }
  .b.typing i { width:6px; height:6px; border-radius:50vh; background:var(--color-ink-secondary); opacity:.5;
    animation:blink 1s infinite; }
  .b.typing i:nth-child(2) { animation-delay:.15s; } .b.typing i:nth-child(3) { animation-delay:.3s; }
  @keyframes blink { 50% { opacity:1; } }
  .b.new { animation:rise var(--motion-normal) var(--motion-ease) both; }
  @keyframes rise { from { opacity:0; transform:translateY(8px); } }
  .phone-bar { padding:var(--space-8) var(--space-12) var(--space-16); background:var(--color-surface); }
  .phone-bar span { display:block; height:36px; border-radius:50vh; border:1px solid var(--color-border); }

  .card { background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-panel);
    padding:var(--space-16); box-shadow:var(--shadow-lift2); }
  .card p { margin:0; }
  .card-who { display:flex; align-items:center; gap:var(--space-8); font-size:var(--font-size-caption); color:var(--color-ink); font-weight:600; }
  .card-who .mark { --color-brand:var(--color-cue); }
  .card-wait { margin-inline-start:auto; font-weight:500; color:var(--color-ink-secondary); }
  .card-wait::before { content:""; display:inline-block; width:7px; height:7px; border-radius:50vh; background:var(--color-cue);
    margin-inline-end:6px; vertical-align:1px; }
  .card-draft { margin-block:var(--space-12) !important; padding:var(--space-12); border:1px solid var(--color-control-line);
    border-radius:var(--radius-control); color:var(--color-ink) !important; font-size:var(--font-size-small); line-height:1.45; }
  .floor { margin-bottom:var(--space-12); }
  .floor-nums { display:grid; grid-template-columns:repeat(3, 1fr); gap:var(--space-8); margin:0 0 var(--space-8); }
  .floor-nums dt { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .floor-nums dd { margin:0; font-weight:700; color:var(--color-ink); }
  .floor-nums .asked dd { text-decoration:line-through; color:var(--color-ink-secondary); font-weight:500; }
  .floor-nums .low dd { color:var(--color-cue); }
  .track { display:flex; height:8px; border-radius:50vh; overflow:visible; }
  .track .below { flex:8; border-radius:50vh 0 0 50vh; background:repeating-linear-gradient(135deg, var(--color-border) 0 4px, var(--color-surface) 4px 8px); }
  [dir="rtl"] .track .below { border-radius:0 50vh 50vh 0; }
  .track .above { flex:10; position:relative; background:var(--color-sand); border-start-end-radius:50vh; border-end-end-radius:50vh;
    border-inline-start:2px solid var(--color-cue); container-type:inline-size; }
  .dot { position:absolute; top:-5px; inset-inline-start:-9px; width:16px; height:16px; border-radius:50vh; background:var(--color-ink);
    border:3px solid var(--color-surface); box-shadow:0 0 0 1px var(--color-ink); }
  .demo.sliding .dot { animation:to-floor 1.4s var(--motion-ease) both; }
  @keyframes to-floor { 0% { transform:translateX(calc(var(--sign, 1) * 100cqi)); } 72% { transform:translateX(calc(var(--sign, 1) * -6px)); }
    86% { transform:translateX(calc(var(--sign, 1) * 2px)); } 100% { transform:none; } }
  [dir="rtl"] .dot { --sign:-1; }
  .floor-say { font-size:var(--font-size-caption); color:var(--color-ink-secondary) !important; margin-top:var(--space-8) !important; }
  .card-act { display:flex; align-items:center; gap:var(--space-12); }
  .approve { min-height:44px; padding:0 var(--space-24); border-radius:var(--radius-chip); }
  .demo.waiting .approve { animation:nudge 1.6s var(--motion-ease) infinite; }
  @keyframes nudge { 0%, 100% { box-shadow:0 0 0 0 var(--color-rail-shadow); } 50% { box-shadow:0 0 0 6px var(--color-rail-shadow); } }
  .card-tap, .card-sent { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .card-sent { color:var(--color-ok); font-weight:600; }
  .demo.sent .approve, .demo.sent .card-tap { display:none; }
  .demo.before .side-card { visibility:hidden; }
  .demo-again { text-align:center; margin:var(--space-12) 0 0; min-height:44px; }
  .again { background:transparent; color:var(--color-ink); box-shadow:inset 0 0 0 1px var(--color-control-line); border-radius:var(--radius-chip); }

  /* The channel strip */
  .strip { padding-block:var(--space-48); text-align:center; border-top:1px solid var(--color-border); }
  .strip h2, .chapter h2 { font-size:clamp(1.6rem, 1.1rem + 1.6vw, 2.4rem); line-height:1.15; letter-spacing:-0.015em; margin:0 0 var(--space-12); }
  .channels { list-style:none; padding:0; margin:var(--space-32) 0 0; display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:var(--space-12); }
  .channels li { display:flex; flex-direction:column; align-items:center; gap:var(--space-8); padding:var(--space-20) var(--space-8);
    background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-card); margin:0; }
  .ch-logo { width:28px; height:28px; color:var(--color-ink); }
  .ch-name { font-weight:600; color:var(--color-ink); }
  .ch-how { font-size:var(--font-size-caption); color:var(--color-ink-secondary); line-height:1.3; }

  /* A chapter */
  .chapter { padding-block:var(--space-48); border-top:1px solid var(--color-border); }
  .chapter-head { max-width:44rem; }
  .kicker { font-size:var(--font-size-small); font-weight:700; color:var(--color-cue) !important; margin:0 0 var(--space-8); }
  .shot { margin-block:var(--space-32); }
  .shot img { display:block; width:100cqw; width:100%; height:auto; border-radius:var(--radius-panel); border:1px solid var(--color-border);
    box-shadow:var(--shadow-lift2); background:var(--color-surface); }
  .points { list-style:none; padding:0; margin:0; display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:var(--space-24) var(--space-32); }
  .points li { margin:0; }
  .points h3 { font-size:var(--font-size-base); margin:0 0 var(--space-4); }
  .points p { margin:0; font-size:var(--font-size-small); }

  @media (max-width: 60rem) {
    .hero { grid-template-columns:1fr; gap:var(--space-32); }
    .channels { grid-template-columns:repeat(4, minmax(0, 1fr)); }
    .points { grid-template-columns:1fr 1fr; }
  }
  @media (max-width: 40rem) {
    .top-nav, .top-end .go-s { display:none; }
    .hero { padding-top:var(--space-16); }
    .hero-cta .go { flex:1 1 auto; }
    .stage { flex-direction:column; align-items:stretch; }
    .side-phone { width:auto; }
    .side-card { width:auto; margin:-2.5rem var(--space-12) 0; }
    .side-card .side-label { display:none; }
    .phone { height:27rem; }
    .seg-label { display:none; }
    .seg { flex:1 1 auto; justify-content:center; }
    .seg button { flex:1; }
    .channels { grid-template-columns:1fr; gap:var(--space-8); text-align:start; }
    .channels li { display:grid; grid-template-columns:28px 1fr; align-items:center; padding:var(--space-12) var(--space-16); gap:0 var(--space-12); }
    .channels .ch-logo { grid-row:span 2; }
    .channels li:not(:has(.ch-how)) .ch-logo { grid-row:auto; }
    .points { grid-template-columns:1fr; }
  }
  @media (prefers-reduced-motion: reduce) {
    .b.new, .demo.sliding .dot, .demo.waiting .approve, .b.typing i { animation:none; }
  }
`;

// ── The demo's player ──────────────────────────────────────────────────────────────────────────────────────────
// Small and plain: it redraws the chat from the script, step by step. Reduced motion: every step drawn at once up
// to the moment that waits for the visitor. It starts when the demo is first seen, and again on "Watch".

const DEMO_JS = `(function(){
document.documentElement.classList.add('js');
var D=JSON.parse(document.getElementById('demo-data').textContent);
var fig=document.getElementById('demo'); if(!fig)return;
var chat=fig.querySelector('.chat'), phone=fig.querySelector('.phone'), draft=fig.querySelector('.card-draft');
var sent=fig.querySelector('.card-sent'), again=fig.querySelector('.again'), ch=fig.querySelector('.phone-ch');
var calm=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var lang=D.start, timers=[], step=0;
function clear(){timers.forEach(clearTimeout);timers=[];}
function later(ms,f){timers.push(setTimeout(f,calm?0:ms));}
function li(who,text,cls){var e=document.createElement('li');e.className='b '+(who==='customer'?'mine':'theirs')+(cls||'');e.dir='auto';e.textContent=text;return e;}
function typing(who){var e=li(who,'',' typing');e.setAttribute('aria-label',D.writing);for(var i=0;i<3;i++)e.appendChild(document.createElement('i'));return e;}
function add(e){var t=chat.querySelector('.typing');if(t)t.remove();if(!calm)e.classList.add('new');chat.appendChild(e);}
function state(s){fig.classList.remove('before','sliding','waiting','sent');s.forEach(function(c){fig.classList.add(c);});}
function setLang(l){lang=l;var S=D.script[l];phone.dir=l==='ar'?'rtl':'ltr';phone.lang=l;draft.lang=l;draft.textContent=S.draft;}
function play(){
  clear();var S=D.script[lang];chat.innerHTML='';sent.hidden=true;again.hidden=true;state(['before']);
  if(calm){S.lines.forEach(function(x){add(li(x.who,x.text));});state(['waiting']);return;}
  var t=300;
  S.lines.forEach(function(x,i){
    later(t,function(){add(typing(x.who));});t+=x.who==='customer'?900:1200;
    later(t,function(){add(li(x.who,x.text));});t+=i===0?500:700;
  });
  later(t,function(){add(typing('shop'));});t+=900;
  later(t,function(){var e=chat.querySelector('.typing');if(e)e.remove();state(['sliding']);});t+=1500;
  later(t,function(){state(['waiting']);});
}
function approve(){
  if(!fig.classList.contains('waiting'))return;
  clear();var S=D.script[lang];state(['sent']);sent.hidden=false;add(li('shop',S.draft));
  later(900,function(){add(typing('customer'));});
  later(2000,function(){add(li('customer',S.after));again.hidden=false;});
}
fig.querySelector('.approve').addEventListener('click',approve);
again.addEventListener('click',play);
fig.querySelectorAll('[data-lang]').forEach(function(b){b.addEventListener('click',function(){
  fig.querySelectorAll('[data-lang]').forEach(function(x){x.setAttribute('aria-pressed',String(x===b));});setLang(b.dataset.lang);play();});});
fig.querySelectorAll('[data-channel]').forEach(function(b){b.addEventListener('click',function(){
  fig.querySelectorAll('[data-channel]').forEach(function(x){x.setAttribute('aria-pressed',String(x===b));});
  phone.dataset.channel=b.dataset.channel;ch.textContent=D.channel[b.dataset.channel];});});
document.querySelectorAll('[data-watch]').forEach(function(a){a.addEventListener('click',function(){play();});});
setLang(lang);
if('IntersectionObserver' in window&&!calm){var seen=false;new IntersectionObserver(function(es,o){if(!seen&&es[0].isIntersecting){seen=true;o.disconnect();play();}},{threshold:.4}).observe(fig);}else{play();}
})();`;
