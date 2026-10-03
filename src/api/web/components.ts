import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';
import { esc, deeper, back, byAssistant } from './layout.js';
import { face } from './faces.js';
import { menuRow, menuGroup } from './settings.js';
import { bubbleClass } from './inbox.js';
import { flashBanner } from './flash.js';
import * as show from './values.js';

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

  // Phase 9 (settings-a-new-11) — on a card, where the neutral pill is drawn (paper on paper it was invisible),
  // with the assistant's mark beside the four states.
  const chips = `
    <div class="card"><p><span class="pill ok">${label}</span><span class="pill warn">${label}</span>
       <span class="pill bad">${label}</span><span class="pill owner">${label}</span>
       <span class="as">✦ ${esc(assistantName(locale))}</span></p></div>
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

  const doors = `${deeper('/app/settings/setup', esc(t(locale, 'nav.setup')))}${back('/app/settings/setup', esc(t(locale, 'nav.setup')))}`;

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
  // Phase 9 of the warmth run (V1-487) — the product's own words, not one placeholder in every role.
  const notices = flashBanner({ text: t(locale, 'closures.flash.removed'), bad: false })
    + flashBanner({ text: t(locale, 'business.kind.bad.country'), bad: true });
  const empty = `<div class="empty">${esc(t(locale, 'data.buyers.none'))}</div><div class="ok-line">✓ ${esc(t(locale, 'alerts.flash.tested'))}</div>`;
  // Phase 9 (V1-488) — samples, not doors: they reloaded this page.
  const tabs = `<div class="tabs"><span class="tab on">${s('state.rest')}</span>
    <span class="tab">${s('sample.more')}</span></div>`;

  // The warmth run (w4-settings-a-21) — speech as a conversation draws it: the customer by name, the
  // assistant's reply on its wash with "✦ {name}", a person's reply plain; each with its time.
  const at = (m: number) => esc(show.time(locale, new Date(Date.UTC(2026, 9, 3, 9, m))));
  const speech = `
    <div class="timeline">
      <div class="msg inbound"><div dir="auto" class="${bubbleClass('buyer')}"><bdi>${s('sample.buyer')}</bdi></div><div class="ts muted">${at(12)} · <bdi>Aisha Bello</bdi></div></div>
      <div class="msg outbound"><div dir="auto" class="${bubbleClass('assistant')}"><bdi>${s('sample.reply')}</bdi></div><div class="ts muted">${at(13)} · ${byAssistant(assistantName(locale))}</div></div>
      <div class="msg outbound"><div dir="auto" class="${bubbleClass('person')}"><bdi>${s('sample.reply')}</bdi></div><div class="ts muted">${at(20)} · ${esc(t(locale, 'conv.by.you'))}</div></div>
    </div>
    <div dir="auto" class="proposed"><bdi>${s('sample.reply')}</bdi></div>`;

  // The warmth run's parts (w4-settings-a-21): faces in their five sizes and tints, a menu row with
  // and without its line, and the one small card that says a customer newly waits.
  const people = ['Aisha Bello', 'Carlos Mendes', 'ليلى منصور', '陈莉', '+971 50 000 0000'];
  const faces = `<div class="chips">${(['xs', 's', 'm', 'l', 'xl'] as const).map((size, i) =>
    face({ clientId: `c${i}`, name: people[i] ?? null, photo: null }, size)).join('')}</div>`;
  const menu = menuGroup('gallery', label, [
    menuRow({ href: '/app/settings/components', icon: 'bell', label: t(locale, 'alerts.title'), value: t(locale, 'alerts.way.email') }),
    menuRow({ href: '/app/settings/components', icon: 'folder', label: t(locale, 'data.title'), desc: t(locale, 'setup.alerts.nothing'), value: null }),
  ]);
  const toast = `<div><a class="toast" href="/app/inbox">${esc(t(locale, 'live.toast.reply', { who: 'Aisha Bello' }))}</a></div>`;

  const counts = `
    <div class="stats">
      <div class="stat"><span class="v">${esc(show.count(locale, 3))}</span><span class="l">${label}</span></div>
      <div class="stat"><span class="v">${esc(show.count(locale, 12))}</span><span class="l">${label}</span></div>
    </div>
    <div class="stated-now">${esc(show.money(locale, { amount: 2.1, currency: 'USD' }))}</div>`;

  const sections = `
    <div class="card"><h2>${label}</h2><p class="muted">${s('sample.help')}</p>
      <div class="dhead"><span class="pill ok">${label}</span><span class="note">${s('sample.help')}</span></div></div>
    <div class="facts"><div class="frow"><span class="flabel">${label}</span><span>${s('sample.option')}</span></div></div>`;

  const text = `
    <p class="sub">${label}</p>
    <p class="muted">${s('sample.help')}</p>
    <p class="note">${s('sample.help')}</p>
    <p class="subline">${s('sample.help')}</p>`;

  // Phase 9 (V1-491) — the way back, at the top like every Setup page.
  return `${back('/app/settings/setup', t(locale, 'nav.setup'))}
    <h1 class="page">${s('title')}</h1>
    <p class="muted measure-prose">${s('lead')}</p>
    ${section('chips', chips)}
    ${section('buttons', buttons)}
    ${section('doors', doors)}
    ${section('form', form)}
    ${section('notice', notices)}
    ${section('empty', empty)}
    ${section('tabs', tabs)}
    ${section('speech', speech)}
    ${section('faces', faces)}
    ${section('menu', menu)}
    ${section('toast', toast)}
    ${section('counts', counts)}
    ${section('sections', sections)}
    ${section('text', text)}`;
}
