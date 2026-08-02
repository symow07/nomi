import { type Locale, dirOf, LOCALES, LOCALE_LABEL } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';

/**
 * M9.1 + ADR-0008 — The command-center shell (pure HTML), now locale-aware
 * (en/zh/ar) with RTL for Arabic and a language switcher. Owner language only.
 *
 * Phase A: the customer-facing brand is "Nomi". Internal identifiers — the
 * repository, database, `yiwuflow_app` role, migrations and i18n KEYS — keep
 * their original names deliberately; only what the owner reads changed.
 */

/**
 * Nomi navigation. Moving toward four destinations — Today, Buyers, 小雅,
 * My factory — one phase at a time.
 *
 * Phase E folds the four business-context surfaces (settings, products,
 * knowledge, WhatsApp) into My factory, which links to each of them. Their
 * ROUTES all still work and are still linked; only the top-level door moved,
 * so nothing an owner (or a bookmark) relied on has been taken away.
 */
export const NAV: readonly { readonly href: string; readonly id: string; readonly icon: string }[] = [
  { href: '/app/onboarding',    id: 'onboarding',    icon: '🚀' },
  { href: '/app',               id: 'home',          icon: '🏠' },
  { href: '/app/inbox',         id: 'inbox',         icon: '📥' },
  { href: '/app/conversations', id: 'conversations', icon: '💬' },
  { href: '/app/employee',      id: 'employee',      icon: '🧑‍💼' },
  { href: '/app/factory',       id: 'factory',       icon: '🏭' },
  { href: '/app/analytics',     id: 'analytics',     icon: '📊' },
  { href: '/app/sandbox',       id: 'sandbox',       icon: '🧪' },
];

/** Inside My factory — still routed, still linked, no longer a top-level door. */
export const FACTORY_ROUTES: readonly string[] =
  ['/app/settings', '/app/products', '/app/knowledge', '/app/channels'];

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The EN·中文·العربية switcher — links to the public /locale route, returns to `path`. */
function switcher(locale: Locale, path: string): string {
  const next = encodeURIComponent(path || '/app');
  return `<div class="langsw" role="group" aria-label="${esc(t(locale, 'switcher.aria'))}">
    ${LOCALES.map((l) =>
      `<a class="${l === locale ? 'on' : ''}" hreflang="${l}" lang="${l}" href="/locale?set=${l}&next=${next}">${esc(LOCALE_LABEL[l])}</a>`,
    ).join('')}</div>`;
}

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0d10; color: #e6e8eb;
    font: 15px/1.5 -apple-system, "Segoe UI", "Noto Sans SC", "Noto Sans Arabic", system-ui, sans-serif; }
  a { color: inherit; text-decoration: none; }
  .layout { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }
  nav.side { background: #101317; border-inline-end: 1px solid #23272e; padding: 20px 12px; }
  .brand { font-weight: 700; font-size: 17px; padding: 6px 12px 18px; letter-spacing: .3px; }
  .brand small { display:block; color:#6b7280; font-weight:500; font-size:12px; letter-spacing:0; margin-top:2px; }
  nav.side a.navlink { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
    border-radius: 10px; color: #b9c0c9; font-size: 14px; margin-bottom: 2px; }
  nav.side a.navlink:hover { background: #171b21; color: #fff; }
  nav.side a.navlink.active { background: #1b2430; color: #fff; }
  nav.side a.navlink .ic { width: 20px; text-align: center; }
  header.top { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 16px 28px; border-bottom: 1px solid #23272e; }
  header.top .who { display:flex; align-items:center; gap:10px; }
  header.top .avatar { width: 30px; height: 30px; border-radius: 999px; background:#1b2430;
    display:flex; align-items:center; justify-content:center; font-size:16px; }
  header.top .right { display:flex; align-items:center; gap:14px; }
  header.top .logout { color:#6b7280; font-size:13px; }
  header.top .logout:hover { color:#f87171; }
  .langsw { display:inline-flex; gap:2px; background:#0f1216; border:1px solid #23272e; border-radius:999px; padding:3px; }
  .langsw a { padding:4px 10px; border-radius:999px; font-size:12px; color:#8b929c; }
  .langsw a.on { background:#1b2430; color:#fff; }
  main { padding: 28px; max-width: 1040px; }
  h1.page { font-size: 20px; margin: 0 0 18px; }
  .card { background:#14171c; border:1px solid #23272e; border-radius:14px; padding:20px; margin:16px 0; }
  .card h2 { font-size:13px; text-transform:uppercase; letter-spacing:.8px; color:#8b929c; margin:0 0 14px; font-weight:600; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  .stat { background:#0f1216; border:1px solid #23272e; border-radius:10px; padding:16px; text-align:center; }
  .stat .v { font-size:28px; font-weight:700; color:#fff; }
  .stat .l { font-size:12px; color:#8b929c; margin-top:4px; }
  .pill { display:inline-block; padding:5px 12px; border-radius:999px; font-size:13px; font-weight:600; margin:0 8px 8px 0; }
  .pill.ok { background:#0f2e1c; color:#4ade80; } .pill.bad { background:#2e1414; color:#f87171; }
  .pill.warn { background:#2e2413; color:#fbbf24; }
  pre { background:#0f1216; border:1px solid #23272e; border-radius:10px; padding:18px; overflow-x:auto;
    font:14px/1.55 "SF Mono", ui-monospace, Menlo, monospace; color:#d6dae0; white-space:pre; margin:0; }
  .muted { color:#8b929c; font-size:13px; }   /* 6.2:1 — #6b7280 was 4.02:1, under AA at 13px */
  .empty { text-align:center; color:#8b929c; padding:40px 20px; }
  /* RTL needs NO override here: a grid's first track already sits on the
     inline-start edge, so the sidebar mirrors to the right on its own. The
     three rules that used to live here re-flipped it — putting the sidebar
     back on the LEFT in Arabic, and, because two explicitly-placed columns ran
     against DOM order, pushing the whole content column into grid row 2 behind
     a screen-height gap. Every page was affected at desktop width. */
  @media (max-width: 720px) {
    .layout { grid-template-columns: 1fr; }
    nav.side { display:flex; flex-wrap:wrap; gap:4px; border-inline-end:none; border-bottom:1px solid #23272e; }
    nav.side .brand { width:100%; padding-bottom:10px; }
    nav.side a.navlink { margin:0; padding:8px 10px; }
    .stats { grid-template-columns: repeat(2,1fr); }
  }
`;

export function shell(input: {
  readonly title: string;
  readonly active: string;
  readonly locale: Locale;
  readonly path: string;
  readonly avatar: string;
  readonly bodyHtml: string;
}): string {
  const { locale } = input;
  const name = EMPLOYEE_NAME[locale];
  const nav = NAV.map((n) =>
    `<a href="${n.href}" class="navlink ${n.id === input.active ? 'active' : ''}">
       <span class="ic">${n.icon}</span>${esc(t(locale, `nav.${n.id}` as MessageKey))}</a>`).join('');
  return `<!doctype html>
<html lang="${locale}" dir="${dirOf(locale)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(input.title)} · ${esc(name)}</title>
<style>${STYLE}</style></head>
<body><div class="layout">
  <nav class="side">
    <div class="brand">Nomi<small>${esc(t(locale, 'app.tagline', { name }))}</small></div>
    ${nav}
  </nav>
  <div class="content">
    <header class="top">
      <div class="who"><span class="avatar">${input.avatar}</span>
        <div><div style="font-weight:600">${esc(name)}</div>
        <div class="muted" style="font-size:12px">${esc(t(locale, 'header.stage'))}</div></div></div>
      <div class="right">${switcher(locale, input.path)}
        <a class="logout" href="/logout">${esc(t(locale, 'header.logout'))}</a></div>
    </header>
    <main>${input.bodyHtml}</main>
  </div>
</div></body></html>`;
}

export function loginPage(input: { readonly locale: Locale; readonly path: string; readonly error?: boolean }): string {
  const { locale } = input;
  return `<!doctype html>
<html lang="${locale}" dir="${dirOf(locale)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nomi · ${esc(t(locale, 'login.title'))}</title>
<style>${STYLE}
  .login { max-width: 360px; margin: 12vh auto; padding: 0 20px; }
  .login .top-sw { display:flex; justify-content:center; margin-bottom:14px; }
  .login .card { padding: 28px; }
  input { width:100%; padding:12px 14px; border-radius:10px; border:1px solid #2b313a;
    background:#0f1216; color:#fff; font-size:15px; margin:8px 0 14px; }
  button { width:100%; padding:12px; border:0; border-radius:10px; background:#2563eb;
    color:#fff; font-weight:600; font-size:15px; cursor:pointer; }
  button:hover { background:#1d4ed8; }
  .err { color:#f87171; font-size:13px; margin-bottom:8px; }
  label { color:#6b7280; font-size:13px; }
</style></head>
<body><div class="login">
  <div class="top-sw">${switcher(locale, input.path)}</div>
  <div class="brand" style="font-weight:700;font-size:19px;margin-bottom:8px">Nomi<small class="muted" style="display:block;font-size:12px">${esc(t(locale, 'login.brandTagline'))}</small></div>
  <div class="card">
    ${input.error ? `<div class="err">${esc(t(locale, 'login.error'))}</div>` : ''}
    <form method="post" action="/login">
      <label>${esc(t(locale, 'login.passwordLabel'))}</label>
      <input type="password" name="code" autofocus autocomplete="current-password" />
      <button type="submit">${esc(t(locale, 'login.submit'))}</button>
    </form>
  </div>
  <p class="muted" style="text-align:center;font-size:12px">${esc(t(locale, 'login.footer'))}</p>
</div></body></html>`;
}
