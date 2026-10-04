import { t } from './say.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { markSmall } from '../../core/owner/brand.js';
import { publicDocument, esc, switcher, LANGSW_CSS, FACE_CSS, gapAfter, inviteMailto } from './layout.js';
import { shape, shapeUrl, SHAPE_BOX, SHAPE_CSS } from './marks.js';
import { face } from './faces.js';

/**
 * Phase 5 — nomidoes.com, served by this app.
 *
 * WHICH HOST IS THE SITE. `SITE_HOSTS` names them (`nomidoes.com,
 * www.nomidoes.com`). On one of those, `/` is this page, the legal pages are
 * served as everywhere, and every address that belongs to the app —
 * `/app…`, `/login`, `/signup`, `/verify` — is sent to `PUBLIC_BASE_URL`, so a
 * session cookie is only ever set on the app's own host. With no
 * `PUBLIC_BASE_URL` there is nowhere to send them, and they are served here
 * exactly as before rather than redirected to themselves.
 *
 * `/site` shows the same page on any host, marked noindex, so the owner can
 * read it at app.nomidoes.com before the DNS exists.
 *
 * WHAT IT MAY SAY. Only what the product does today, checked against the code:
 * no price, no trial, no number nobody measured, no channel that is not wired
 * (WeChat is not). The assistant has no pronoun and no fixed name — "an
 * assistant you name". Copy is in the catalogue under `site.*`, so the banned
 * vocabulary and pronoun tests read it like every other sentence.
 */

/** `SITE_HOSTS` → lower-cased host names. Empty entries are dropped. */
export function parseSiteHosts(raw: string | undefined | null): readonly string[] {
  return (raw ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/** The shape the boot accepts: a comma list of plain host names, no scheme, no port. */
export const SITE_HOSTS_SHAPE = (v: string): boolean =>
  parseSiteHosts(v).length > 0
  && parseSiteHosts(v).every((h) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h));

/** The request's host, lower-cased, port stripped. */
export const hostOf = (header: string | string[] | undefined): string =>
  String(Array.isArray(header) ? header[0] : header ?? '').trim().toLowerCase().replace(/:\d+$/, '');

/**
 * The site hosts in force: the configured ones, minus the app's own host. If
 * both named the same host, `/app` there would redirect to itself forever.
 */
export function siteHostsInForce(hosts: readonly string[], publicBaseUrl: string | null | undefined): ReadonlySet<string> {
  let app: string | null = null;
  try { app = publicBaseUrl ? new URL(publicBaseUrl).hostname.toLowerCase() : null; } catch { app = null; }
  return new Set(hosts.filter((h) => h !== app));
}

/** The addresses that belong to the app, never to the site. */
const APP_PATH = /^\/(app|login|signup|verify)(?=[/?#]|$)/;
export const isAppPath = (url: string): boolean => APP_PATH.test(url);

/**
 * Where an app address asked of the site host goes: the same path and query on
 * `PUBLIC_BASE_URL`. Null when there is no base to send it to.
 */
export function appAddress(publicBaseUrl: string | null | undefined, url: string): string | null {
  if (!publicBaseUrl) return null;
  return `${publicBaseUrl.replace(/\/+$/, '')}${url}`;
}

export type SiteInput = {
  readonly locale: Locale;
  /** The address this page was asked at — the language switch returns to it. */
  readonly path: '/' | '/site';
  /** `LEGAL_CONTACT_EMAIL`. Absent, the invitation line is not drawn. */
  readonly contact: string | null;
  /** Where "Sign in" goes: the app's own login. */
  readonly signIn: string;
  /**
   * SITE (opening step 4) — sign-up is open on this installation, as the app
   * decides it on every request (the operator's switch, a sender, a bot check).
   * Then the button is "Start your workspace" and goes to sign-up; until then
   * the site invites a visitor to write (rule 12: it states nothing unbuilt).
   */
  readonly signUp?: string | null;
  /** The preview on the app host is not for search engines. */
  readonly noindex: boolean;
};

/**
 * The example's customer: an id for the face's tint only, never a row anywhere. It draws
 * tint 8, a blue, so the face is not read as the magenta of the assistant's words under it.
 */
const EXAMPLE_CUSTOMER = 'site-example-customer';

export function renderSite(v: SiteInput): string {
  const l = v.locale;
  // Phase 9 (V1-023) — "e-mail" never breaks at its hyphen: a no-break hyphen, drawn, not stored.
  const k = (key: Parameters<typeof t>[1]) => esc(t(l, key)).replace(/(^|[^\p{L}])([eE])-mail/gu, '$1$2\u2011mail');
  // Phase 9 (public-missed-02) — the mail opens already saying what to write (w4-public-13: sign-up's too).
  const mail = v.contact ? esc(inviteMailto(l, v.contact)) : null;
  const signIn = esc(v.signIn);
  const signUp = v.signUp ? esc(v.signUp) : null;
  // public-missed-04 — one filled button on the page: the hero's. The same act lower down is outlined.
  const go = (second: boolean) => (signUp ? `<a class="site-go${second ? ' site-go-2' : ''}" href="${signUp}">${k('site.cta.signup')}</a>`
    : mail ? `<a class="site-go${second ? ' site-go-2' : ''}" href="${mail}">${k('site.cta.invite')}</a>` : '');
  const invite = go(false);
  // public-missed-08, w4-public-05 — a label that ends in full-width punctuation (：？) takes no space after it.
  const label = (key: Parameters<typeof t>[1]) => `${k(key)}${gapAfter(t(l, key))}`;

  const step = (n: 1 | 2 | 3) =>
    `<li><h3>${k(`site.how.${n}.title`)}</h3><p>${k(`site.how.${n}.body`)}</p></li>`;
  // w4-public-09 — "What goes out alone" is its three conditions as a list, then what still waits.
  const yours = (which: 'prices' | 'alone' | 'back') =>
    `<div class="site-card"><h3>${k(`site.yours.${which}.title`)}</h3><p>${k(`site.yours.${which}.body`)}</p>${which === 'alone'
      ? `<ul class="site-when"><li>${k('site.yours.alone.named')}</li><li>${k('site.yours.alone.practice')}</li><li>${k('site.yours.alone.record')}</li></ul><p>${k('site.yours.alone.after')}</p>`
      : ''}</div>`;
  // Brand names are the same in every language but Arabic, which writes them
  // in its own script; e-mail is a word, so it is translated.
  const CHANNEL_NAME: Record<Locale, Record<'whatsapp' | 'instagram' | 'messenger', string>> = {
    en: { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' },
    zh: { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' },
    ar: { whatsapp: 'واتساب', instagram: 'إنستغرام', messenger: 'ماسنجر' },
    es: { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' },
    fr: { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' },
  };
  const channel = (c: 'whatsapp' | 'instagram' | 'messenger' | 'email') =>
    `<li><strong>${c === 'email' ? k('site.channels.email') : esc(CHANNEL_NAME[l][c])}</strong><span>${k(`site.channels.${c}.how`)}</span></li>`;

  return publicDocument({
    locale: l, title: t(l, 'site.title'), description: t(l, 'site.description'),
    noindex: v.noindex, icon: true, mainClass: 'site', extraCss: LANGSW_CSS + FACE_CSS + SHAPE_CSS + SITE_CSS,
    body: `<div class="site-root" data-surface="site">
  <header class="site-top">
    <a class="site-brand" href="${v.path}">${markSmall(28, null)}<span>Nomi</span></a>
    <a class="site-signin" href="${signIn}">${k('site.signIn')}</a>
    <div class="site-lang">${switcher(l, v.path)}</div>
  </header>

  <section class="site-hero">
    <div class="site-hero-text">
      <h1>${k('site.hero.title')}</h1>
      <p class="site-lead">${k('site.hero.lead')}</p>
      <p>${k('site.hero.alone')}</p>
      <p class="site-cta">${invite}<span class="site-member">${label('site.hero.member')}<a href="${signIn}">${k('site.signIn')}</a></span></p>
    </div>
    <figure class="site-example" aria-label="${k('site.example.label')}">
      <figcaption>${k('site.example.label')}</figcaption>
      <div class="site-said">
        ${/* w4-public-03 — the customer has a face, drawn by the product's own renderer: a coloured
           initial, as a customer with no photo has. The draft below sits on the assistant's wash. */ ''}<span class="site-who">${face({ clientId: EXAMPLE_CUSTOMER, name: t(l, 'site.example.from') }, 's')}<span>${k('site.example.from')}</span></span>
        <p class="site-bubble" dir="auto">${k('site.example.buyer')}</p>
      </div>
      <div class="site-said site-draft">
        ${/* V1-018, public-new-01 — the product's own draft card, in its own words: who drafted it and
           that it waits; what happens next is said, not drawn as buttons that do nothing. */ ''}<span class="site-who"><span>${shape('assistant', 'site-as')} ${esc(t(l, 'card.drafted'))}</span><span class="site-draft-tag">${esc(t(l, 'card.waiting'))}</span></span>
        <p class="site-bubble" dir="auto">${k('site.example.draft')}</p>
        <p class="site-acts">${k('site.example.acts')}</p>
      </div>
    </figure>
  </section>

  <section class="site-sec" aria-labelledby="site-how">
    <h2 id="site-how">${k('site.how.title')}</h2>
    <ol class="site-steps">${step(1)}${step(2)}${step(3)}</ol>
  </section>

  <section class="site-sec" aria-labelledby="site-yours">
    <h2 id="site-yours">${k('site.yours.title')}</h2>
    <div class="site-cards">${yours('prices')}${yours('alone')}${yours('back')}</div>
    <p class="site-honest">${k('site.yours.honest')}</p>
  </section>

  <section class="site-sec" aria-labelledby="site-channels">
    <h2 id="site-channels">${k('site.channels.title')}</h2>
    <p>${k('site.channels.lead')}</p>
    <ul class="site-channels">${channel('whatsapp')}${channel('instagram')}${channel('messenger')}${channel('email')}</ul>
  </section>

  <section class="site-sec" aria-labelledby="site-who">
    <h2 id="site-who">${k('site.who.title')}</h2>
    <p class="site-prose">${k('site.who.body')}</p>
    <p class="site-prose">${k('site.who.languages')}</p>
  </section>

  <section class="site-sec" aria-labelledby="site-first">
    <h2 id="site-first">${k('site.first.title')}</h2>
    <p class="site-prose">${k(signUp ? 'site.first.open' : 'site.first.invite')}</p>
    <p class="site-prose">${k('site.first.assisted')}</p>
  </section>

  ${signUp ? `<section class="site-sec site-invite" aria-labelledby="site-invite">
    <h2 id="site-invite">${k('site.signup.title')}</h2>
    <p class="site-prose">${k('site.signup.body')}</p>
    <p class="site-cta">${go(true)}${mail ? `<span class="site-member">${label('site.signup.write')}<a href="${mail}">${esc(v.contact!)}</a></span>` : ''}</p>
  </section>` : mail ? `<section class="site-sec site-invite" aria-labelledby="site-invite">
    <h2 id="site-invite">${k('site.invite.title')}</h2>
    <p class="site-prose">${k('site.invite.body')}</p>
    <p class="site-cta">${go(true)}<span class="site-member">${label('site.invite.write')}<a href="${mail}">${esc(v.contact!)}</a></span></p>
  </section>` : ''}

  <footer class="site-foot">
    ${/* V1-029 — Sign in is in the header and the hero; the foot is the policies. public-missed-06 —
       the deletion page is for a business's customers, and its link says so. */ ''}<nav class="site-links" aria-label="Nomi">
      <a href="/privacy">${k('legal.privacyLink')}</a>
      <a href="/terms">${k('legal.termsLink')}</a>
      <a href="/data-deletion">${k('site.foot.deletion')}</a>
    </nav>
    ${switcher(l, v.path)}
  </footer>
</div>`,
  });
}

/**
 * The site's own rules. Everything else — the variables, the base type,
 * links, lists — is publicDocument's. Every class here starts `site-`, so
 * none is a second definition of a shell family. Logical properties only:
 * the Arabic page mirrors itself.
 */
export const SITE_CSS = `
  main.site { max-width:var(--measure-column); padding:var(--space-24) var(--space-16) var(--space-48); }
  .site-root { display:flex; flex-direction:column; gap:var(--space-48); }
  .site-root h2 { font-size:var(--font-size-display); line-height:var(--line-height-tight); letter-spacing:var(--tracking-tight); font-weight:700; color:var(--color-ink);
    margin:0 0 var(--space-16); }
  .site-root h3 { font-size:var(--font-size-title); line-height:var(--line-height-tight); font-weight:600; color:var(--color-ink);
    margin:0 0 var(--space-8); }
  .site-root p { max-width:var(--measure-prose); }
  .site-root h3 { text-wrap:balance; }

  /* V1-019 — on a phone the name and Sign in share the first row and the language
     switch has the next one to itself; on a wide screen all three are one row. */
  .site-top { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8) var(--space-16); flex-wrap:wrap; }
  .site-brand { display:inline-flex; align-items:center; gap:var(--space-8); min-height:44px;
    font-weight:700; font-size:var(--font-size-title); text-decoration:none; color:var(--color-ink); }
  .site-brand .mark { flex:none; }
  .site-lang { flex:1 0 20rem; }
  .site-signin { display:inline-flex; align-items:center; min-height:44px; font-weight:600;
    font-size:var(--font-size-small); color:var(--color-ink); }

  .site-hero { display:grid; grid-template-columns:minmax(0, 1fr); gap:var(--space-32); align-items:center;
    padding-block:var(--space-24); }
  .site-hero h1 { font-size:var(--font-size-hero); line-height:var(--line-height-tight); margin:0 0 var(--space-24); font-weight:700;
    color:var(--color-ink); letter-spacing:var(--tracking-tight); }
  /* The type pass (2026-10-04) — the lead is large and quiet: light, the one place a stranger meets the light weight first. */
  .site-lead { font-size:var(--font-size-title); font-weight:300; color:var(--color-ink); }
  .site-cta { display:flex; align-items:center; gap:var(--space-16) var(--space-24); flex-wrap:wrap;
    margin:var(--space-32) 0 0; }
  .site-go { display:inline-flex; align-items:center; justify-content:center; min-height:48px; padding:var(--space-12) var(--space-24);
    border-radius:var(--radius-control); background:var(--color-ink); color:var(--color-surface);
    font-weight:600; text-decoration:none; text-align:center; text-wrap:balance; }
  /* Above: w4-public-04 — a button is a control, with a control's corner; w4-public-07 — a label
     that wraps is centred in its button, in even lines. */
  .site-go:hover { box-shadow:var(--shadow-lift2); }
  .site-go.site-go-2 { background:transparent; color:var(--color-ink); border:1px solid var(--color-ink-secondary); }
  .site-member { font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  .site-member a { display:inline-block; padding-block:var(--space-12); font-weight:600; }

  .site-example { margin:0; padding:var(--space-24); background:var(--color-surface); border-radius:var(--radius-card);
    box-shadow:var(--shadow-lift2); display:flex; flex-direction:column; gap:var(--space-16); }
  .site-example figcaption { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .site-said { display:flex; flex-direction:column; gap:var(--space-4); align-items:flex-start; }
  .site-said.site-draft { align-items:flex-end; }
  .site-who { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap;
    font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .site-draft .site-who { justify-content:flex-end; }
  .site-as { color:var(--color-assistant); }
  .site-bubble { margin:0; padding:var(--space-12) var(--space-16); border-radius:var(--radius-card);
    background:var(--color-paper); color:var(--color-ink);
    font-size:var(--font-size-small); max-width:var(--measure-form); }
  /* w4-public-03 — the assistant's words on the assistant's wash, as in a conversation. */
  .site-draft .site-bubble { background:var(--color-assistant-wash); }
  .site-draft-tag { padding:2px var(--space-8); border-radius:var(--radius-chip); background:var(--color-needs-wash);
    color:var(--color-needs); border:1px solid var(--color-border); font-weight:600; }
  /* The product's waiting mark: a shape before the word, so the colour is not alone. */
  .site-draft-tag::before { content:""; ${SHAPE_BOX} --shape:${shapeUrl('waiting')}; margin-inline-end:var(--space-4); }
  .site-acts { margin:var(--space-4) 0 0; font-size:var(--font-size-caption); color:var(--color-ink-secondary);
    text-align:end; text-wrap:balance; }

  .site-sec { border-top:1px solid var(--color-border); padding-top:var(--space-48); }
  .site-steps { list-style:none; margin:var(--space-24) 0 0; padding:0; display:grid; gap:var(--space-32);
    grid-template-columns:minmax(0, 1fr); counter-reset:site-step; }
  .site-steps li { counter-increment:site-step; margin:0; }
  /* V1-022 — the number sits in a disc you can see, its edge on the heading's edge.
     V1-028 — the same digits as every other page, Arabic included. */
  .site-steps li::before { content:counter(site-step); display:inline-flex; align-items:center; justify-content:center;
    inline-size:40px; block-size:40px; border-radius:var(--radius-chip); margin-bottom:var(--space-12);
    background:var(--color-surface); border:1px solid var(--color-border);
    color:var(--color-ink); font-weight:700; font-size:var(--font-size-title); }

  /* w4-public-09 — one card to a row at every width, each as tall as its own words. */
  .site-cards { display:grid; grid-template-columns:minmax(0, 1fr); gap:var(--space-16); margin-top:var(--space-24);
    max-width:var(--measure-prose); }
  .site-card { background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-card);
    padding:var(--space-24); }
  .site-card p { margin:0; }
  .site-card p + p, .site-when + p { margin-top:var(--space-12); }
  .site-when { margin:var(--space-8) 0 0; padding-inline-start:var(--space-24); }
  .site-when li { margin:0 0 var(--space-4); max-width:var(--measure-prose); }
  .site-honest { margin-top:var(--space-24); padding-inline-start:var(--space-16);
    border-inline-start:3px solid var(--color-border); }

  .site-channels { list-style:none; margin:var(--space-24) 0 0; padding:0; display:grid; gap:var(--space-12);
    grid-template-columns:minmax(0, 1fr); }
  .site-channels li { display:flex; flex-direction:column; gap:var(--space-4); margin:0; padding:var(--space-16) var(--space-24);
    background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-card); }
  .site-channels strong { color:var(--color-ink); font-size:var(--font-size-title); }
  .site-channels span { font-size:var(--font-size-small); }

  /* V1-020 — the invitation's indent is a box you can see. */
  .site-invite { border-top:0; padding:var(--space-32) var(--space-24); background:var(--color-surface);
    border:1px solid var(--color-border); border-radius:var(--radius-card); }

  .site-foot { display:flex; align-items:center; justify-content:space-between; gap:var(--space-16); flex-wrap:wrap;
    padding-top:var(--space-24); border-top:1px solid var(--color-border); }
  /* V1-029 — on a phone one link to a line, so none is left alone on the last. */
  .site-links { display:flex; flex-direction:column; gap:0 var(--space-24); font-size:var(--font-size-small); }
  .site-links a { display:inline-flex; align-items:center; min-height:44px; color:var(--color-ink-secondary); }

  @media (min-width: 48rem) {
    main.site { padding-inline:var(--space-32); }
    .site-lang { flex:0 0 auto; order:1; margin-inline-start:auto; }
    .site-links { flex-direction:row; flex-wrap:wrap; }
    .site-signin { order:2; }
    .site-steps { grid-template-columns:repeat(3, minmax(0, 1fr)); }
    .site-channels { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  }
  @media (min-width: 60rem) {
    .site-hero { grid-template-columns:minmax(0, 7fr) minmax(0, 5fr); gap:var(--space-48); padding-block:var(--space-48); }
  }
`;
