// UI Block 6 · F32, as the settings overhaul (rule 104) redrew it — Settings › Assistant › Reply permissions: Stop at the
// top, apart from the levels; every decision in view and saying where it stands (nothing folded); a link names a part
// of the page by its id; a row's own action (Wait for my OK, Send without me) and Stop are not ink fills. What each
// button does, who may press it and what it asks first are unchanged — those stay pinned in w5-alone-now,
// follow-ups-page and others.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderEmployee, PERMISSIONS_SAVE, type EmployeeProfile } from '../../src/api/web/employee.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, withAssistantName } from '../../src/api/web/say.js';
import { esc, ASSISTANT_HOME } from '../../src/api/web/layout.js';
import { SETTINGS_MOVES } from '../../src/api/web/settingsNavigation.js';
import { SETTINGS_AREA_CSS } from '../../src/api/web/settingsAreaStyle.js';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { withoutIsolates } from './isolates.js';
import { buttonsAndDoors } from './buttons-and-doors.js';

const set: EmployeeProfile = {
  knows: 4, assistantNamed: true, spotChecks: [], hireDate: new Date('2026-07-09T00:00:00Z'), stage: 'partial',
  canDo: ['greet', 'qualify'], needConfirm: ['quote'],
  capabilities: [
    { capability: 'greet', mode: 'auto', promotable: false },
    { capability: 'qualify', mode: 'auto', promotable: false },
    { capability: 'recommend', mode: 'draft', promotable: true },
    { capability: 'quote', mode: 'draft', promotable: false },
  ],
  growth: [], promoted: true, conditions: [{ cond: 'passed_spotcheck', met: true }, { cond: 'learned_correction', met: false }], products: 3, words: 0, answering: true,
  chosen: null, pendingName: 'Lily',
};
const page = (e: EmployeeProfile, l: (typeof LOCALES)[number], owner = true) =>
  withAssistantName('Lily', () => renderEmployee(e, l, null, { isOwner: owner }, { followUps: { enabled: true, delayDays: 3, wording: 'Hello' } }));
const css = SETTINGS_AREA_CSS.replace(/\s+/g, ' ');

describe('UI Block 6 · F32 — the assistant\'s settings page (Reply permissions)', () => {
  it('Stop is at the top, before the levels and outside them; it asks first; owner only, while answering', () => {
    for (const l of LOCALES) {
      const html = page(set, l);
      const levels = html.indexOf('<section class="set-sec" id="on-her-own">');
      const levelsEnd = html.indexOf('</section>', levels);
      const panel = html.indexOf('<div class="set-note" id="stop">');
      expect(panel, l).toBeGreaterThan(0);
      expect(panel, l).toBeLessThan(levels);
      expect(html.slice(levels, levelsEnd), l).not.toContain('stop-assistant');
      const stop = html.slice(panel, html.indexOf('</div>', panel));
      expect(stop, l).toContain('<form method="post" action="/app/business/stop-assistant" class="set-act">');
      expect(stop, l).toContain('<input type="hidden" name="from" value="employee" />');
      expect(stop, l).toContain(`onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(withAssistantName('Lily', () => t(l, 'assistant.stop.action.stopConfirm')))}"`);
      expect(stop, l).toContain(`>${esc(withAssistantName('Lily', () => t(l, 'assistant.stop.action.stop')))}</button>`);
      expect(html.match(/action="\/app\/business\/stop-assistant"/g), l).toHaveLength(1);
      // Stop is its own form: it is not a field of the page's Save.
      const save = html.indexOf(`<form method="post" action="${PERMISSIONS_SAVE}"`);
      expect(panel, l).toBeLessThan(save);
      // Nobody but the owner, and only while there is something to stop.
      expect(page(set, l, false), l).not.toContain('stop-assistant');
      expect(page({ ...set, answering: false }, l), l).not.toContain('stop-assistant');
      // Stopped: the page says so in the same place, and the way to start again is Going live's.
      const stopped = page({ ...set, stopped: true }, l);
      expect(stopped, l).not.toContain('stop-assistant');
      const said = stopped.slice(stopped.indexOf('<p class="set-note" id="stop">'), stopped.indexOf('</p>', stopped.indexOf('<p class="set-note" id="stop">')));
      expect(said, l).toContain(esc(withAssistantName('Lily', () => t(l, 'today.stopped.title'))));
      expect(said, l).toContain('href="/app/settings/assistant/ready#stop"');
      expect(buttonsAndDoors(html), l).toEqual([]);
    }
  });
  it('every decision is in view and says where it stands: nothing is folded', () => {
    for (const l of LOCALES) {
      const html = withoutIsolates(page(set, l));
      expect(html, l).not.toContain('<details');
      // The kinds of reply: each a row with its state in words.
      const kinds = html.slice(html.indexOf('<section class="set-sec" id="reply-types">'), html.indexOf('</section>', html.indexOf('id="reply-types"')));
      expect(kinds, l).toContain(`<h2 class="set-h">${esc(withoutIsolates(t(l, 'her.handles.title')))}</h2>`);
      expect(kinds.match(/<tr class="tm[^"]*">/g)?.length, l).toBe(4 + 4);   // the four kinds set, and the four that always wait
      // What comes next: now, in the level's own words.
      const progress = /<p class="set-help" id="progress">([\s\S]*?)<\/p>/.exec(kinds)?.[1] ?? '';
      expect(progress, l).toContain(esc(withoutIsolates(t(l, 'employee.promo.current'))));
      expect(progress, l).toContain(esc(withoutIsolates(t(l, 'employee.promo.done'))));
      for (const c of ['passed_spotcheck', 'learned_correction'] as const)
        expect(kinds, `${l} ${c}`).toContain(esc(withoutIsolates(withAssistantName('Lily', () => t(l, `employee.promo.cond.${c}`)))));
      // Follow-ups: its fields say the rule as it stands.
      const rule = html.slice(html.indexOf('<section class="set-sec" id="follow-ups">'));
      expect(rule, l).toContain('name="enabled" value="1" checked');
      expect(rule, l).toContain('<option value="3" selected>');
      expect(rule, l).toContain('>Hello</textarea>');
    }
  });
  it('a link names a part of the page by its id; the folds\' old addresses arrive at those parts', () => {
    const html = page(set, 'en');
    for (const id of ['stop', 'on-her-own', 'reply-types', 'progress', 'follow-ups']) expect(html.match(new RegExp(`id="${id}"`, 'g')), id).toHaveLength(1);
    expect(SETTINGS_MOVES[`${ASSISTANT_HOME}/replies`]).toBe(`${ASSISTANT_HOME}#reply-types`);
    expect(SETTINGS_MOVES[`${ASSISTANT_HOME}/one-kind`]).toBe(`${ASSISTANT_HOME}#reply-types`);
    expect(SETTINGS_MOVES[`${ASSISTANT_HOME}/next`]).toBe(`${ASSISTANT_HOME}#progress`);
    expect(SETTINGS_MOVES[`${ASSISTANT_HOME}/alone`]).toBe(ASSISTANT_HOME);
    // No fold is left for `?open=` to open: the route reads no such thing, and an old link with it still lands.
    const app = readFileSync('src/api/web/app.ts', 'utf8');
    expect(app).not.toContain('setupFoldOf');
    expect(app).toContain("title: t(locale, 'settingsArea.permissions'), active: 'settings', bodyHtml: await permissionsBody(s, locale, takeFlash(req, reply)),");
  });
  it('with script, a link to a folded part elsewhere still opens its fold and focuses its summary', () => {
    expect(LIVE_SCRIPT).toContain('function deepLinks()');
    expect(LIVE_SCRIPT).toMatch(/\n {2}deepLinks\(\);\n/);
    const fn = LIVE_SCRIPT.slice(LIVE_SCRIPT.indexOf('function deepLinks()'), LIVE_SCRIPT.indexOf('/* The native summary still opens'));
    for (const part of ['fold.open = true', 's.focus({ preventScroll: true })', "window.addEventListener('hashchange', reveal)", "window.addEventListener('load'", '[?&]open=']) expect(fn).toContain(part);
    // Only a settings decision's fold or the knowledge page's add actions: a menu that folds is never opened by a link.
    expect(fn).toContain("at.closest('details.sa-subject,details.ak-add')");
  });
  it('a row\'s own action and Stop are outlined, not ink fills; a switch is a 44 px target on a phone', () => {
    expect(css).toContain('.settings-area .as-act .btn,.settings-area .set-note .set-act .btn,.settings-area .set-rows>.set-act .btn,.settings-area .set-add .btn{background:transparent;color:var(--color-ink);border:1px solid var(--color-ink);}');
    expect(css).toContain('.settings-area .btn.danger{background:transparent;');
    expect(css).toMatch(/@media\(max-width:720px\)\{\.set-switch\{min-block-size:44px;min-inline-size:44px;\}/);
    expect(css).not.toContain('.stop-panel');
  });
});
