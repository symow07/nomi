import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import { esc, deeper, back } from './layout.js';
import { flashBanner } from './flash.js';

/**
 * V1 step two — every component the shell defines, in every state it can be
 * in, on one page. For looking at: by eye on a phone, and by the screenshot
 * tool at three widths in three languages, before and after each V1 step.
 *
 * It carries no stylesheet of its own. Everything here is a class the shell
 * already draws, so if this page looks wrong the shell is wrong, and the fix
 * lands everywhere at once. Hover and focus are shown through the shell's
 * `.is-hover` / `.is-focus` twins of the pseudo-classes; disabled is the
 * attribute. tests/parity/v1-one-stylesheet.test.ts holds that every family
 * is on this page and that no stylesheet is.
 */
export function renderComponents(locale: Locale): string {
  const s = (k: string): string => esc(t(locale, `components.${k}` as MessageKey));
  const section = (key: string, inner: string): string => `<div class="block"><h2>${s(key)}</h2>${inner}</div>`;
  const label = s('sample.label');

  const chips = `
    <p><span class="pill ok">${label}</span><span class="pill warn">${label}</span>
       <span class="pill bad">${label}</span><span class="pill owner">${label}</span></p>
    <div class="chips"><span class="chip">${s('sample.option')}</span><span class="chip">${s('sample.option')}</span></div>`;

  const buttonRow = (state: 'rest' | 'hover' | 'focus' | 'disabled'): string => {
    const extra = state === 'hover' ? ' is-hover' : state === 'focus' ? ' is-focus' : '';
    const attr = state === 'disabled' ? ' disabled' : '';
    const word = s(`state.${state}`);
    return `<div class="acts">
      <button type="button" class="btn send${extra}"${attr}>${word}</button>
      <button type="button" class="btn${extra}"${attr}>${word}</button>
      <button type="button" class="btn ghost${extra}"${attr}>${word}</button>
      <button type="button" class="btn danger${extra}"${attr}>${word}</button>
    </div>`;
  };
  const buttons = (['rest', 'hover', 'focus', 'disabled'] as const).map(buttonRow).join('');

  const doors = `${deeper('/app/settings', esc(t(locale, 'nav.settings')))}${back('/app/settings', esc(t(locale, 'nav.settings')))}`;

  const form = `
    <form class="pform" method="get" action="/app/settings/components">
      <label class="fld"><span class="muted">${label}</span><input name="a" value="" />
        <span class="muted">${s('sample.help')}</span></label>
      <label class="fld"><span class="muted">${label}</span>
        <select name="b"><option>${s('sample.option')}</option><option>${s('sample.more')}</option></select></label>
      <label class="fld"><span class="muted">${label}</span><textarea name="c" rows="2"></textarea></label>
      <label class="chkbox"><input type="checkbox" name="d" /> ${s('sample.option')}</label>
      <details><summary>${s('sample.more')}</summary><p class="muted">${s('sample.help')}</p></details>
      <span class="perr">${s('sample.help')}</span>
      <button type="button" class="btn send">${s('state.rest')}</button>
    </form>`;

  // The notice is drawn in ONE place (flash.ts); a page never paints its own.
  const notices = flashBanner({ text: t(locale, 'components.sample.help'), bad: false })
    + flashBanner({ text: t(locale, 'components.sample.help'), bad: true });
  const empty = `<div class="empty">${s('empty')}</div><div class="ok-line">✓ ${s('sample.help')}</div>`;
  const tabs = `<div class="tabs"><a class="tab on" href="/app/settings/components">${s('state.rest')}</a>
    <a class="tab" href="/app/settings/components">${s('sample.more')}</a></div>`;

  const speech = `
    <div class="timeline">
      <div class="msg inbound"><div class="bubble"><bdi>${s('sample.buyer')}</bdi></div><div class="ts muted">${s('state.rest')}</div></div>
      <div class="msg outbound"><div class="bubble"><bdi>${s('sample.reply')}</bdi></div><div class="ts muted">${s('state.rest')}</div></div>
    </div>
    <div class="proposed"><bdi>${s('sample.reply')}</bdi></div>`;

  const counts = `
    <div class="stats">
      <div class="stat"><span class="v">3</span><span class="l">${label}</span></div>
      <div class="stat"><span class="v">12</span><span class="l">${label}</span></div>
    </div>
    <div class="stated-now">$2.10</div>`;

  const sections = `
    <div class="card"><h2>${label}</h2><p class="muted">${s('sample.help')}</p>
      <div class="dhead"><span class="pill ok">${label}</span><span class="note">${s('sample.help')}</span></div></div>
    <div class="facts"><div class="frow"><span class="flabel">${label}</span><span>${s('sample.option')}</span></div></div>`;

  const text = `
    <p class="sub">${label}</p>
    <p class="muted">${s('sample.help')}</p>
    <p class="note">${s('sample.help')}</p>
    <p class="subline">${s('sample.help')}</p>`;

  return `<h1 class="page">${s('title')}</h1>
    <p class="muted measure-prose">${s('lead')}</p>
    ${section('chips', chips)}
    ${section('buttons', buttons)}
    ${section('doors', doors)}
    ${section('form', form)}
    ${section('notice', notices)}
    ${section('empty', empty)}
    ${section('tabs', tabs)}
    ${section('speech', speech)}
    ${section('counts', counts)}
    ${section('sections', sections)}
    ${section('text', text)}`;
}
