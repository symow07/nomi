// UI Block 6 · F32 — the assistant's settings page: Stop in its own named panel, after the levels and apart from them;
// each folded decision says where it stands in its summary; a link opens and focuses its fold, with script and without;
// a row's own action (Turn on, Wait for my OK, Let it go alone) and Stop are not ink fills. What each button does, who
// may press it and what it asks first are unchanged — those stay pinned in w5-alone-now, follow-ups-page and others.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderEmployee, setupFoldOf, SETUP_FOLDS, type EmployeeProfile } from '../../src/api/web/employee.js';
import { renderFollowUpRule } from '../../src/api/web/followUps.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, withAssistantName } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import { SETTINGS_AREA_CSS } from '../../src/api/web/settingsAreaStyle.js';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { withoutIsolates } from './isolates.js';

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
const page = (e: EmployeeProfile, l: (typeof LOCALES)[number], owner = true, open: ReturnType<typeof setupFoldOf> = null) =>
  withAssistantName('Lily', () => renderEmployee(e, l, null, undefined, { isOwner: owner }, true, open));
const css = SETTINGS_AREA_CSS.replace(/\s+/g, ' ');

describe('UI Block 6 · F32 — the assistant\'s settings page', () => {
  it('Stop is its own named panel after the levels, outside them, with the same form and question; owner only, while answering', () => {
    for (const l of LOCALES) {
      const html = page(set, l);
      const levels = html.indexOf('<section class="block level-control"');
      const levelsEnd = html.indexOf('</section>', levels);
      const panel = html.indexOf('<section class="stop-panel" aria-labelledby="stop-h">');
      expect(levels, l).toBeGreaterThan(0);
      expect(panel, l).toBeGreaterThan(levelsEnd);
      expect(html.slice(levels, levelsEnd), l).not.toContain('stop-assistant');
      const stop = html.slice(panel, html.indexOf('</section>', panel));
      expect(stop, l).toContain(`<h2 id="stop-h">${esc(withAssistantName('Lily', () => t(l, 'assistant.stop.title')))}</h2>`);
      expect(stop, l).toContain('<form method="post" action="/app/business/stop-assistant" class="inline">');
      expect(stop, l).toContain(`data-confirm="${esc(withAssistantName('Lily', () => t(l, 'assistant.stop.action.stopConfirm')))}"`);
      // …and before the folded decisions.
      expect(panel, l).toBeLessThan(html.indexOf('<details class="sa-subject"'));
      expect(page(set, l, false), l).not.toContain('stop-panel');
      expect(page({ ...set, stopped: true }, l), l).not.toContain('stop-panel');
      expect(page({ ...set, answering: false }, l), l).not.toContain('stop-panel');
    }
  });
  it('each folded decision says its name and where it stands; the link target is inside the fold and can take focus', () => {
    for (const l of LOCALES) {
      const html = withoutIsolates(page(set, l));
      for (const [id, name, now] of [
        ['progress', t(l, 'employee.promo.title'), t(l, 'nav.setup.progress', { done: 1, total: 2 })],
        ['reply-types', t(l, 'her.handles.title'), null],
      ] as const) {
        const at = html.indexOf(`<div class="sa-body" id="${id}" tabindex="-1">`);
        expect(at, `${l} ${id}`).toBeGreaterThan(0);
        const fold = html.slice(html.lastIndexOf('<details class="sa-subject"', at), at);
        expect(fold, `${l} ${id}`).not.toContain(' open');
        expect(fold, `${l} ${id}`).toContain(`<span class="sa-sname">${esc(withoutIsolates(name))}</span>`);
        const said = /<span class="sa-now">([^<]+)<\/span>/.exec(fold)?.[1] ?? '';
        expect(said.length, `${l} ${id}`).toBeGreaterThan(0);
        if (now) expect(said, `${l} ${id}`).toBe(esc(withoutIsolates(now)));
      }
      expect(html).not.toMatch(/<details[^>]*id="(?:progress|reply-types)"/);
      const rule = renderFollowUpRule(l, { enabled: true, delayDays: 3, wording: 'Hello' }, true);
      expect(rule, l).toContain('<details class="sa-subject follow-up-settings">');
      expect(rule, l).toContain('<div class="sa-body" id="follow-ups" tabindex="-1">');
      const ruleNow = rule.slice(rule.indexOf('<span class="sa-now">'), rule.indexOf('</summary>'));
      expect(ruleNow, l).toContain(esc(t(l, 'followUp.on')));
      expect(withoutIsolates(ruleNow), l).toMatch(/3/);
      expect(ruleNow, l).toContain(' · ');
    }
  });
  it('a fold a link names is open on the server (?open=), and only that one; anything else opens nothing', () => {
    expect(SETUP_FOLDS).toEqual(['progress', 'reply-types', 'follow-ups']);
    expect(setupFoldOf('reply-types')).toBe('reply-types');
    for (const bad of ['', 'stop', 'progress#x', ['progress'], undefined]) expect(setupFoldOf(bad)).toBeNull();
    const html = page(set, 'en', true, 'reply-types');
    expect(html.match(/<details class="sa-subject" open>/g)?.length).toBe(1);
    expect(html.indexOf('<details class="sa-subject" open>')).toBe(html.lastIndexOf('<details class="sa-subject"', html.indexOf('id="reply-types"')));
    expect(renderFollowUpRule('en', { enabled: false, delayDays: 2, wording: '' }, true, false, true)).toContain('<details class="sa-subject follow-up-settings" open>');
    expect(renderFollowUpRule('en', { enabled: false, delayDays: 2, wording: '' }, true, true)).toContain('<details class="sa-subject follow-up-settings" open>');
    const app = readFileSync('src/api/web/app.ts', 'utf8');
    expect(app).toContain('const open = setupFoldOf((req.query as { open?: unknown }).open);');
    expect(app).toContain("renderEmployee(e, locale, flash, ctx, personOf(s), true, open)");
  });
  it('with script, a link to a folded part opens the fold and focuses its summary, on arrival and on a later #link', () => {
    expect(LIVE_SCRIPT).toContain('function deepLinks()');
    expect(LIVE_SCRIPT).toMatch(/\n {2}deepLinks\(\);\n/);
    const fn = LIVE_SCRIPT.slice(LIVE_SCRIPT.indexOf('function deepLinks()'), LIVE_SCRIPT.indexOf('/* The native summary still opens'));
    for (const part of ['fold.open = true', 's.focus({ preventScroll: true })', "window.addEventListener('hashchange', reveal)", "window.addEventListener('load'", '[?&]open=']) expect(fn).toContain(part);
    // Only a settings decision's fold or the knowledge page's add actions: a menu that folds is never opened by a link.
    expect(fn).toContain("at.closest('details.sa-subject,details.ak-add')");
  });
  it('a row\'s own action and Stop are outlined, not ink fills; the fold\'s summary is a 44 px target; its focus is an ink ring', () => {
    expect(css).toContain('.settings-area :is(.certlist,.actrow) .btn{background:transparent;color:var(--color-ink);border:1px solid var(--color-ink);}');
    expect(css).toContain('.settings-area .btn.danger{background:transparent;');
    expect(css).toMatch(/\.sa-subject>summary\{min-height:44px;/);
    expect(css).toContain('.sa-body:focus-visible{outline:2px solid var(--color-ink);outline-offset:2px;}');
    expect(css).toContain('.stop-panel{');
  });
});
