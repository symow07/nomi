import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { rowSwitch } from '../../src/api/web/settingsPage.js';
import { historyWorkspaceRows } from '../../src/api/web/advisorHistory.js';
import { certTable } from '../../src/api/web/knowledge.js';
import { renderProfile, PROFILE_PAGE, HOURS_PAGE } from '../../src/api/web/settings.js';
import { t } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { settingsApp, postSettingsForm } from './settings-harness.js';

/**
 * The independent test of the settings overhaul (rule 104) found these; each is pinned here as it now is.
 *   1. A switch that asks first: the dialog's yes names the act ("Turn off"), never the state the switch shows ("On").
 *   3. Business profile: where the hours and the currency are set is said BEFORE the form; the Save ends the page.
 *   5. An older tab's POST /app/settings with the time zone alone saves the zone and lands on Hours and closures.
 */

/** The shipped script, with the product's dialog on the page and one button that asks first. */
function dialog() {
  const listeners: ((e: unknown) => void)[] = [];
  const el = () => ({ textContent: '', className: '', addEventListener: () => {} });
  const said = el(), yes = el(), no = el();
  const box = { showModal: () => { box.open = true; }, close: () => { box.open = false; }, open: false, addEventListener: () => {},
    querySelector: (q: string) => q === '[data-ask-q]' ? said : q === '[data-ask-yes]' ? yes : q === '[data-ask-no]' ? no : null };
  const document = {
    querySelector: (q: string) => q === '[data-ask]' ? box : null,
    querySelectorAll: () => [],
    addEventListener: (type: string, fn: (e: unknown) => void) => { if (type === 'click') listeners.push(fn); },
  };
  vm.runInNewContext(LIVE_SCRIPT, { document, window: { addEventListener: () => {} }, location: { pathname: '/app/settings', hash: '', search: '' } });
  const click = (button: { attrs: Record<string, string>; text: string; className: string }) => {
    const b = { getAttribute: (k: string) => button.attrs[k] ?? null, textContent: button.text, className: button.className,
      form: { requestSubmit: () => {}, checkValidity: () => true } };
    const e = { target: { closest: (q: string) => q === 'button[data-confirm]' ? b : null }, preventDefault() {}, stopPropagation() {} };
    for (const fn of listeners) fn(e);
  };
  return { click, said, yes, box };
}

describe('1 · a switch that asks first says the act on its yes', () => {
  it('rowSwitch names the verb of what pressing it does, in every language; a switch that does not ask carries none', () => {
    for (const l of LOCALES) {
      const on = rowSwitch(l, { action: '/x', on: true, label: 'X', confirm: 'Sure?' });
      const off = rowSwitch(l, { action: '/x', on: false, label: 'X', confirm: 'Sure?' });
      expect(on, l).toContain(` data-verb="${esc(t(l, 'set.turnOff'))}"`);
      expect(off, l).toContain(` data-verb="${esc(t(l, 'set.turnOn'))}"`);
      expect(t(l, 'set.turnOff'), l).not.toBe(t(l, 'followUp.on'));
      expect(rowSwitch(l, { action: '/x', on: true, label: 'X' }), l).not.toContain('data-verb');
      // without script, the browser's own question is still asked
      expect(on, l).toContain('onclick="return confirm(this.dataset.confirm)"');
    }
  });
  it('the dialog\'s yes reads data-verb before the button\'s text; a button without one keeps its own word', () => {
    const d = dialog();
    d.click({ attrs: { 'data-confirm': 'Turn off history?', 'data-verb': 'Turn off' }, text: 'On', className: 'set-switch' });
    expect(d.box.open).toBe(true);
    expect(d.said.textContent).toBe('Turn off history?');
    expect(d.yes.textContent).toBe('Turn off');
    const e = dialog();
    e.click({ attrs: { 'data-confirm': 'Remove this?' }, text: ' Remove ', className: 'btn danger' });
    expect(e.yes.textContent).toBe('Remove');
    expect(e.yes.className).toBe('btn danger');
  });
  it('Data and privacy\'s history switch, when on, offers "Turn off"; a certification offers its own verb', () => {
    for (const l of LOCALES) {
      expect(historyWorkspaceRows(l, true).join(''), l).toContain(` data-verb="${esc(t(l, 'advisor.history.turnOff'))}"`);
      const certs = certTable(l, ['organic'], 3);
      expect(certs, l).toContain(` data-verb="${esc(t(l, 'knowledge.cert.turnOn'))}"`);
      expect(certs, l).not.toMatch(new RegExp(` data-verb="${esc(t(l, 'knowledge.cert.off')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    }
  });
});

describe('3 · Business profile: the Save is the page\'s last control', () => {
  it('the two lines that say where the hours and the currency are set come before the form', () => {
    for (const l of LOCALES) {
      const html = renderProfile({ name: 'Juniper Skin', description: null, location: null, workingHours: null,
        contactEmail: null, contactPhone: null, languagesServed: [] }, l, null);
      const form = html.indexOf(`<form method="post" action="${PROFILE_PAGE}"`);
      expect(form, l).toBeGreaterThan(-1);
      expect(html.indexOf('href="/app/settings/business/hours"'), l).toBeLessThan(form);
      expect(html.indexOf('href="/app/settings/business/currency"'), l).toBeLessThan(form);
      expect(html.slice(html.indexOf('<div class="set-save">')).trim(), l).toMatch(/^<div class="set-save">(?:(?!<form|<a )[\s\S])*<\/div><\/form>$/);
    }
  });
});

describe('5 · an older tab posting the time zone alone to /app/settings', () => {
  it('saves the zone and lands on Hours and closures; nothing of the profile is touched', async () => {
    const asked: string[] = [];
    const app = settingsApp({ answers: [[{ test: (q: string) => { asked.push(q); return false; } } as unknown as RegExp, []]] });
    const r = await postSettingsForm(app, '/app/settings', 'en', { zone: 'Europe/Lisbon' });
    expect(r.status).toBe(302);
    expect(r.location).toBe(HOURS_PAGE);
    expect(asked.some((q) => /update businesses set timezone = \$1/.test(q))).toBe(true);
    expect(asked.some((q) => /update business_profile|insert into business_profile/i.test(q))).toBe(false);
    await app.close();
  });
  it('an unknown zone saves nothing and says so on Hours and closures', async () => {
    const asked: string[] = [];
    const app = settingsApp({ answers: [[{ test: (q: string) => { asked.push(q); return false; } } as unknown as RegExp, []]] });
    const r = await postSettingsForm(app, '/app/settings', 'en', { zone: 'Mars/Olympus' });
    expect(r.status).toBe(302);
    expect(r.location).toBe(HOURS_PAGE);
    expect(asked.some((q) => /update businesses set timezone/.test(q))).toBe(false);
    await app.close();
  });
  it('a form that carries the profile is still checked whole: an empty name is refused on the page', async () => {
    const app = settingsApp();
    const r = await postSettingsForm(app, '/app/settings', 'en', { name: '', zone: 'Europe/Lisbon' });
    expect(r.status).toBe(200);
    expect(r.location).toBeNull();
    expect(r.html).toContain(esc(t('en', 'settings.flash.profileFix')));
    await app.close();
  });
});
