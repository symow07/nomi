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
  return publicDocument({
    locale: l, title: t(l, 'site.title'), description: t(l, 'site.description'),
    noindex: v.noindex, icon: true, mainClass: 'site', extraCss: LANGSW_CSS + SITE_CSS,
    body: `<div class="site-root" data-surface="site">
  <header class="site-top">
    <a class="site-brand" href="${v.path}">${markSmall(28, null)}<span>Nomi</span></a>
    <div class="site-tools">${switcher(l, v.path)}<a class="site-signin" href="${esc(v.signIn)}">${k('site.signIn')}</a></div>
  </header>

  <section class="site-hero">
    <h1>${k('site.hero.title')}</h1>
    <p class="site-lead">${k('site.hero.lead')}</p>
    <p>${k('site.hero.alone')}</p>
    ${mail ? `<p class="site-cta"><a class="site-go" href="${mail}">${k('site.cta.invite')}</a></p>
    <p class="site-note">${k('site.cta.note')} <a href="${mail}">${esc(v.contact!)}</a></p>` : ''}
  </section>

  <footer class="site-foot">
    <a href="/privacy">${k('legal.privacyLink')}</a>
    <a href="/terms">${k('legal.termsLink')}</a>
  </footer>
</div>`,
  });
}

/**
 * The site's own rules. Everything else — the tokens, the base type, links,
 * lists — is publicDocument's. Every class here starts `site-`, so none is a
 * second definition of a shell family.
 */
export const SITE_CSS = `
  main.site { max-width:var(--measure-column); padding:var(--space-24) var(--space-16) var(--space-48); }
  .site-root { display:flex; flex-direction:column; gap:var(--space-48); }
  .site-top { display:flex; align-items:center; justify-content:space-between; gap:var(--space-16); flex-wrap:wrap; }
  .site-brand { display:inline-flex; align-items:center; gap:var(--space-8); min-height:44px;
    font-weight:700; font-size:var(--font-size-title); text-decoration:none; color:var(--color-ink); }
  .site-brand .mark { flex:none; }
  .site-tools { display:flex; align-items:center; gap:var(--space-16); flex-wrap:wrap; }
  .site-signin { display:inline-flex; align-items:center; min-height:44px; font-weight:600;
    font-size:var(--font-size-small); color:var(--color-ink); }
  .site-hero { max-width:var(--measure-prose); }
  .site-hero h1 { font-size:var(--font-size-hero); line-height:1.2; margin:0 0 var(--space-24); font-weight:700; color:var(--color-ink); }
  .site-lead { font-size:var(--font-size-title); color:var(--color-ink); }
  .site-cta { margin:var(--space-32) 0 var(--space-12); }
  .site-go { display:inline-flex; align-items:center; min-height:48px; padding:var(--space-12) var(--space-24);
    border-radius:var(--radius-card); background:var(--color-jade); color:var(--color-surface);
    font-weight:600; text-decoration:none; }
  .site-go:hover { background:var(--color-jade-deep); }
  .site-note { font-size:var(--font-size-small); }
  .site-foot { display:flex; gap:var(--space-24); flex-wrap:wrap; padding-top:var(--space-24);
    border-top:1px solid var(--color-border); font-size:var(--font-size-small); }
  .site-foot a { display:inline-flex; align-items:center; min-height:44px; color:var(--color-ink-secondary); }
`;
