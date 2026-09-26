import { t } from './say.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { markSmall } from '../../core/owner/brand.js';
import { publicDocument, esc, switcher, LANGSW_CSS } from './layout.js';

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
  /** The preview on the app host is not for search engines. */
  readonly noindex: boolean;
};

export function renderSite(v: SiteInput): string {
  const l = v.locale;
  const k = (key: Parameters<typeof t>[1]) => esc(t(l, key));
  const mail = v.contact ? `mailto:${esc(v.contact)}` : null;
  const signIn = esc(v.signIn);
  const invite = mail ? `<a class="site-go" href="${mail}">${k('site.cta.invite')}</a>` : '';

  const step = (n: 1 | 2 | 3) =>
    `<li><h3>${k(`site.how.${n}.title`)}</h3><p>${k(`site.how.${n}.body`)}</p></li>`;
  const yours = (which: 'prices' | 'alone' | 'back') =>
    `<div class="site-card"><h3>${k(`site.yours.${which}.title`)}</h3><p>${k(`site.yours.${which}.body`)}</p></div>`;
  // Brand names are the same in every language but Arabic, which writes them
  // in its own script; e-mail is a word, so it is translated.
  const CHANNEL_NAME: Record<Locale, Record<'whatsapp' | 'instagram' | 'messenger', string>> = {
    en: { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' },
    zh: { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' },
    ar: { whatsapp: 'واتساب', instagram: 'إنستغرام', messenger: 'ماسنجر' },
  };
  const channel = (c: 'whatsapp' | 'instagram' | 'messenger' | 'email') =>
    `<li><strong>${c === 'email' ? k('site.channels.email') : esc(CHANNEL_NAME[l][c])}</strong><span>${k(`site.channels.${c}.how`)}</span></li>`;

  return publicDocument({
    locale: l, title: t(l, 'site.title'), description: t(l, 'site.description'),
    noindex: v.noindex, icon: true, mainClass: 'site', extraCss: LANGSW_CSS + SITE_CSS,
    body: `<div class="site-root" data-surface="site">
  <header class="site-top">
    <a class="site-brand" href="${v.path}">${markSmall(28, null)}<span>Nomi</span></a>
    <div class="site-tools">${switcher(l, v.path)}<a class="site-signin" href="${signIn}">${k('site.signIn')}</a></div>
  </header>

  <section class="site-hero">
    <div class="site-hero-text">
      <h1>${k('site.hero.title')}</h1>
      <p class="site-lead">${k('site.hero.lead')}</p>
      <p>${k('site.hero.alone')}</p>
      <p class="site-cta">${invite}<span class="site-member">${k('site.hero.member')} <a href="${signIn}">${k('site.signIn')}</a></span></p>
    </div>
    <figure class="site-example" aria-label="${k('site.example.label')}">
      <figcaption>${k('site.example.label')}</figcaption>
      <div class="site-said">
        <span class="site-who">${k('site.example.from')}</span>
        <p class="site-bubble" dir="auto">${k('site.example.buyer')}</p>
      </div>
      <div class="site-said site-draft">
        <span class="site-who">${k('site.example.reply')}<span class="site-draft-tag">${k('site.example.waiting')}</span></span>
        <p class="site-bubble" dir="auto">${k('site.example.draft')}</p>
        <div class="site-acts" aria-hidden="true"><span class="site-fake">${k('site.example.change')}</span><span class="site-fake site-fake-send">${k('site.example.send')}</span></div>
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

  ${mail ? `<section class="site-sec site-invite" aria-labelledby="site-invite">
    <h2 id="site-invite">${k('site.invite.title')}</h2>
    <p class="site-prose">${k('site.invite.body')}</p>
    <p class="site-cta">${invite}<span class="site-member">${k('site.invite.write')} <a href="${mail}">${esc(v.contact!)}</a></span></p>
  </section>` : ''}

  <footer class="site-foot">
    <nav class="site-links" aria-label="Nomi">
      <a href="/privacy">${k('legal.privacyLink')}</a>
      <a href="/terms">${k('legal.termsLink')}</a>
      <a href="/data-deletion">${k('legal.deletion.title')}</a>
      <a href="${signIn}">${k('site.signIn')}</a>
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
  .site-root h2 { font-size:var(--font-size-display); line-height:1.25; font-weight:700; color:var(--color-ink);
    margin:0 0 var(--space-16); }
  .site-root h3 { font-size:var(--font-size-title); line-height:1.3; font-weight:600; color:var(--color-ink);
    margin:0 0 var(--space-8); }
  .site-root p { max-width:var(--measure-prose); }

  .site-top { display:flex; align-items:center; justify-content:space-between; gap:var(--space-16); flex-wrap:wrap; }
  .site-brand { display:inline-flex; align-items:center; gap:var(--space-8); min-height:44px;
    font-weight:700; font-size:var(--font-size-title); text-decoration:none; color:var(--color-ink); }
  .site-brand .mark { flex:none; }
  .site-tools { display:flex; align-items:center; gap:var(--space-16); flex-wrap:wrap; }
  .site-signin { display:inline-flex; align-items:center; min-height:44px; font-weight:600;
    font-size:var(--font-size-small); color:var(--color-ink); }

  .site-hero { display:grid; grid-template-columns:minmax(0, 1fr); gap:var(--space-32); align-items:center;
    padding-block:var(--space-24); }
  .site-hero h1 { font-size:var(--font-size-hero); line-height:1.2; margin:0 0 var(--space-24); font-weight:700;
    color:var(--color-ink); letter-spacing:-0.01em; }
  .site-lead { font-size:var(--font-size-title); color:var(--color-ink); }
  .site-cta { display:flex; align-items:center; gap:var(--space-16) var(--space-24); flex-wrap:wrap;
    margin:var(--space-32) 0 0; }
  .site-go { display:inline-flex; align-items:center; min-height:48px; padding:var(--space-12) var(--space-24);
    border-radius:var(--radius-card); background:var(--color-jade); color:var(--color-surface);
    font-weight:600; text-decoration:none; }
  .site-go:hover { background:var(--color-jade-deep); }
  .site-member { font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  .site-member a { display:inline-block; padding-block:var(--space-12); font-weight:600; }

  .site-example { margin:0; padding:var(--space-24); background:var(--color-surface); border-radius:var(--radius-card);
    box-shadow:var(--shadow-lift2); display:flex; flex-direction:column; gap:var(--space-16); }
  .site-example figcaption { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .site-said { display:flex; flex-direction:column; gap:var(--space-4); align-items:flex-start; }
  .site-said.site-draft { align-items:flex-end; }
  .site-who { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap;
    font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .site-bubble { margin:0; padding:var(--space-12) var(--space-16); border-radius:var(--radius-card);
    background:var(--color-paper-sunk); color:var(--color-ink);
    font-size:var(--font-size-small); max-width:var(--measure-form); }
  .site-draft .site-bubble { background:var(--color-jade-wash); border:1px solid var(--color-jade-line); }
  .site-draft-tag { padding:2px var(--space-8); border-radius:var(--radius-chip); background:var(--color-waiting-wash);
    color:var(--color-waiting); border:1px solid var(--color-waiting-line); font-weight:600; }
  .site-acts { display:flex; gap:var(--space-8); margin-top:var(--space-4); }
  .site-fake { display:inline-flex; align-items:center; padding:var(--space-8) var(--space-16); border-radius:var(--radius-card);
    border:1px solid var(--color-border); font-size:var(--font-size-small); font-weight:600; color:var(--color-ink); }
  .site-fake-send { background:var(--color-jade); border-color:var(--color-jade); color:var(--color-surface); }

  .site-sec { border-top:1px solid var(--color-border); padding-top:var(--space-48); }
  .site-steps { list-style:none; margin:var(--space-24) 0 0; padding:0; display:grid; gap:var(--space-32);
    grid-template-columns:minmax(0, 1fr); counter-reset:site-step; }
  .site-steps li { counter-increment:site-step; margin:0; }
  .site-steps li::before { content:counter(site-step); display:inline-flex; align-items:center; justify-content:center;
    inline-size:40px; block-size:40px; border-radius:var(--radius-chip); margin-bottom:var(--space-12);
    background:var(--color-jade-wash); color:var(--color-jade-deep); font-weight:700; font-size:var(--font-size-title); }
  html[lang="ar"] .site-steps li::before { content:counter(site-step, arabic-indic); }

  .site-cards { display:grid; grid-template-columns:minmax(0, 1fr); gap:var(--space-16); margin-top:var(--space-24); }
  .site-card { background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-card);
    padding:var(--space-24); }
  .site-card p { margin:0; }
  .site-honest { margin-top:var(--space-24); padding-inline-start:var(--space-16);
    border-inline-start:3px solid var(--color-jade-line); }

  .site-channels { list-style:none; margin:var(--space-24) 0 0; padding:0; display:grid; gap:var(--space-12);
    grid-template-columns:minmax(0, 1fr); }
  .site-channels li { display:flex; flex-direction:column; gap:var(--space-4); margin:0; padding:var(--space-16) var(--space-24);
    background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-card); }
  .site-channels strong { color:var(--color-ink); font-size:var(--font-size-title); }
  .site-channels span { font-size:var(--font-size-small); }

  .site-invite { border-top:0; padding:var(--space-32) var(--space-24); background:var(--color-jade-wash);
    border-radius:var(--radius-card); }

  .site-foot { display:flex; align-items:center; justify-content:space-between; gap:var(--space-16); flex-wrap:wrap;
    padding-top:var(--space-24); border-top:1px solid var(--color-border); }
  .site-links { display:flex; gap:var(--space-8) var(--space-24); flex-wrap:wrap; font-size:var(--font-size-small); }
  .site-links a { display:inline-flex; align-items:center; min-height:44px; color:var(--color-ink-secondary); }

  @media (min-width: 48rem) {
    main.site { padding-inline:var(--space-32); }
    .site-steps { grid-template-columns:repeat(3, minmax(0, 1fr)); }
    .site-cards { grid-template-columns:repeat(3, minmax(0, 1fr)); }
    .site-channels { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  }
  @media (min-width: 60rem) {
    .site-hero { grid-template-columns:minmax(0, 7fr) minmax(0, 5fr); gap:var(--space-48); padding-block:var(--space-48); }
    .site-channels { grid-template-columns:repeat(4, minmax(0, 1fr)); }
  }
`;
