import { t } from '../../core/owner/i18n/messages.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { back, esc } from './layout.js';

/**
 * A1 — "how do I sign in, and how do I change it?"
 *
 * One page, for the person who is signed in and nobody else. It shows the
 * e-mail she signs in with (never anyone else's) and changes her password only
 * against her present one — a session left open on a shared computer must not
 * be enough to lock her out of her own factory.
 *
 * Someone who came in with an access code has no password; the page says so
 * rather than offering a form that cannot work.
 */
export type AccountView = { readonly email: string | null; readonly passwordMin: number };

export function renderAccount(v: AccountView, locale: Locale, flash: string | null, backLabel: string): string {
  const body = v.email === null
    ? `<p class="muted">${esc(t(locale, 'account.codeOnly'))}</p>`
    : `<p><bdi>${esc(t(locale, 'account.email', { email: v.email }))}</bdi></p>
       <form method="post" action="/app/settings/account/password" class="pform">
         <div class="fld"><label for="acc-current">${esc(t(locale, 'account.current'))}</label>
           <input id="acc-current" type="password" name="current" required autocomplete="current-password" /></div>
         <div class="fld"><label for="acc-new">${esc(t(locale, 'account.new'))}</label>
           <input id="acc-new" type="password" name="next" required minlength="${v.passwordMin}" autocomplete="new-password" />
           <span class="muted">${esc(t(locale, 'signup.passwordHint', { n: v.passwordMin }))}</span></div>
         <button class="btn send" type="submit">${esc(t(locale, 'account.save'))}</button>
       </form>`;
  return `${back('/app/settings', backLabel)}
    <h1 class="page">${esc(t(locale, 'account.title'))}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    <section class="block">${body}</section>`;
}
