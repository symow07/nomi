import type {Locale} from '../../core/owner/i18n/locale.js';
import type {Viewer} from '../../core/conversation/people.js';
import {esc} from './layout.js';
import {t} from './say.js';
import {flashBanner,type Flash} from './flash.js';
import {settingsMenu} from './sections.js';
import type {SettingsGroup} from './settingsNavigation.js';
/** The navigation block (2026-11-25): the section sidebar (sections.ts) is Settings' one menu; this is the page's frame. */
export function settingsArea(body:string,_locale:Locale,_path:string,_viewer:Viewer):string {
 return `<div class="settings-area"><div class="sa-content">${body}</div></div>`;
}
/**
 * The settings overhaul (2026-11-27, rule 104; the owner's condition 1) — `/app/settings` is the MENU PAGE at every
 * width: the five groups and their pages, as this viewer may see them (sections.ts `settingsMenu`), each a link. On a
 * phone, where no sidebar is drawn, it is how every settings page is one tap from the rail. Log out is on You ›
 * Account; the button stays here as well. The older group addresses (`/app/settings/business`, `/personal`) show this
 * same page.
 */
export function renderSettingsIndex(locale:Locale,flash:Flash|null,_viewer:Viewer):string {
 return `<h1 class="page">${esc(t(locale,'nav.settings'))}</h1>${flashBanner(flash)}${settingsMenu(locale)}<form method="post" action="/logout" class="sa-logout"><button class="btn" type="submit">${esc(t(locale,'header.logout'))}</button></form>`;
}
/** The navigation block: a group's pages are listed in the section sidebar, so the page draws no row of tabs. */
export function settingsPageLinks(_locale:Locale,_group:SettingsGroup,_path:string,_viewer:Viewer):string {
 return '';
}
