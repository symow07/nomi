import { t } from './say.js';
import { LOCALES, LOCALE_LABEL, type Locale } from '../../core/owner/i18n/locale.js';
import { esc } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import { pageHead, setSection, setRow, saveForm, saveActs } from './settingsPage.js';


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
 *
 * THE SETTINGS OVERHAUL (rule 104) — Settings › You › Account, in the one template: the sign-in facts, the password
 * (two fields, sent only when the person fills them), the language as ONE select, all saved by the page's ONE Save
 * (`ACCOUNT_SAVE`); and Log out, a button, at the end. The Language page is this page's `#language` section.
 */
export type AccountView = {
  readonly email: string | null; readonly passwordMin: number;
  /** The door can e-mail a link to choose a new password (PWR: the installation sends system mail). Absent: no. */
  readonly recovery?: boolean;
  /** B18 — the accountant: the same page (their language is on it too). */
  readonly accountant?: boolean;
  /** A refused Save: the reason, under the field it is about. A password is never drawn back. */
  readonly errors?: { readonly current?: string; readonly next?: string };
  /** The language chosen on a Save that was refused, so the select still shows it. */
  readonly keptLanguage?: Locale;
};

/** Where the page's one Save posts. `/app/settings/account/password` and `/locale` still answer. */
export const ACCOUNT_SAVE = '/app/settings/personal/account';

export function renderAccount(v: AccountView, locale: Locale, flash: Flash | null): string {
  // The warmth run, phase 9 (w4-settings-a-22) — what to do when the code or the password is lost:
  // the door's own link where it can e-mail one, else the people who can.
  const lost = v.recovery
    ? `<p class="caption muted"><a href="/login/forgot">${esc(t(locale, 'login.forgot'))}</a></p>`
    : `<p class="caption muted">${esc(t(locale, 'account.lost.passwordAsk'))}</p>`;
  const err = (said: string | undefined): { error?: string } => said ? { error: `<p class="perr" role="alert">${esc(said)}</p>` } : {};
  const signIn = v.email === null
    ? [setRow(locale, { label: t(locale, 'account.row.password'), control: `<span class="fr-value">${esc(t(locale, 'account.codeOnly'))}</span>` })]
    : [
      setRow(locale, { label: t(locale, 'account.row.email'), control: `<span class="fr-value"><bdi>${esc(v.email)}</bdi></span>` }),
      // Not `required`: the page's Save also saves the language, with the password left as it is.
      setRow(locale, { label: t(locale, 'account.current'), forId: 'acc-current', ...err(v.errors?.current),
        control: `<input id="acc-current" type="password" name="current" autocomplete="current-password"${v.errors?.current ? ' aria-invalid="true"' : ''} />` }),
      setRow(locale, { label: t(locale, 'account.new'), forId: 'acc-new', desc: t(locale, 'signup.passwordHint', { n: v.passwordMin }), ...err(v.errors?.next),
        control: `<input id="acc-new" type="password" name="next" minlength="${v.passwordMin}" autocomplete="new-password"${v.errors?.next ? ' aria-invalid="true"' : ''} />` }),
    ];
  const chosen = v.keptLanguage ?? locale;
  const language = setRow(locale, { label: t(locale, 'switcher.aria'), forId: 'acc-language',
    control: `<select id="acc-language" name="language">${LOCALES.map((l) =>
      `<option value="${l}" lang="${l}"${l === chosen ? ' selected' : ''}>${esc(LOCALE_LABEL[l])}</option>`).join('')}</select>` });
  return `${pageHead(t(locale, 'settingsArea.account'), t(locale, 'set.account.lede'))}
    ${flashBanner(flash)}
    ${saveForm(ACCOUNT_SAVE, `${setSection({ id: 'signin', title: t(locale, 'account.title'), rows: signIn })}
      ${v.email === null ? `<p class="caption muted">${esc(t(locale, 'account.lost.code'))}</p>` : lost}
      ${setSection({ id: 'language', title: t(locale, 'settings.language.title'), rows: [language] })}
      ${saveActs(locale)}`)}
    <form method="post" action="/logout" class="sa-logout"><button class="btn" type="submit">${esc(t(locale, 'header.logout'))}</button></form>`;
}
