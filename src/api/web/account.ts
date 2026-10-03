import { t } from './say.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { back, esc } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import { fieldRow, rowsCard, saveBar } from './rows.js';


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
export type AccountView = {
  readonly email: string | null; readonly passwordMin: number;
  /** The door can e-mail a link to choose a new password (PWR: the installation sends system mail). Absent: no. */
  readonly recovery?: boolean;
};

export function renderAccount(v: AccountView, locale: Locale, flash: Flash | null, backLabel: string): string {
  // Phase 3 — the sign-in as rows: who signs in, then the one form to change the password.
  // Phase 9 (settings-a-new-01) — the row names what it holds, not the page's own title again.
  // The warmth run, phase 9 (w4-settings-a-22) — what to do when the code or the password is lost:
  // the door's own link where it can e-mail one, else the people who can.
  const lost = v.recovery
    ? `<p class="caption muted">${esc(t(locale, 'account.lost.password'))} <a href="/login/forgot">${esc(t(locale, 'login.forgot'))}</a></p>`
    : `<p class="caption muted">${esc(t(locale, 'account.lost.passwordAsk'))}</p>`;
  const body = v.email === null
    ? `${rowsCard(null, [fieldRow({ label: t(locale, 'account.row.password'), control: `<span class="fr-value">${esc(t(locale, 'account.codeOnly'))}</span>` })])}
       <p class="caption muted">${esc(t(locale, 'account.lost.code'))}</p>`
    : `${rowsCard(null, [fieldRow({ label: t(locale, 'account.row.email'), control: `<span class="fr-value"><bdi>${esc(v.email)}</bdi></span>` })])}
       <form method="post" action="/app/settings/account/password" class="sform">
         ${rowsCard(null, [
           fieldRow({ label: t(locale, 'account.current'), forId: 'acc-current',
             control: '<input id="acc-current" type="password" name="current" required autocomplete="current-password" />' }),
           fieldRow({ label: t(locale, 'account.new'), forId: 'acc-new', desc: t(locale, 'signup.passwordHint', { n: v.passwordMin }),
             control: `<input id="acc-new" type="password" name="next" required minlength="${v.passwordMin}" autocomplete="new-password" />` }),
         ])}
         ${saveBar(t(locale, 'account.save'))}
       </form>
       ${lost}`;
  return `${back('/app/settings/setup', backLabel)}
    <h1 class="page">${esc(t(locale, 'account.title'))}</h1>
    ${flashBanner(flash)}
    ${body}`;
}
