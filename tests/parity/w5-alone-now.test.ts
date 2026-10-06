import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  renderEmployee, renderEmployeeScreen, EMPLOYEE_SCREENS, type EmployeeProfile,
} from '../../src/api/web/employee.js';
import { aloneNow } from '../../src/core/conversation/aloneNow.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, withAssistantName } from '../../src/api/web/say.js';
import { capabilityName } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * THE WARMTH RUN, phase 9 — V1-417 (S1) and rule 13 on the assistant's page.
 *
 * "No screen may say a kind of reply goes out without the owner while the
 * holds (rule 1's native read, rule 2's name, rule 13's Stop or pause) keep
 * everything waiting." One function decides what goes out alone now
 * (`aloneNow`); every screen of the assistant's page reads it. Proven here in
 * all five languages, hold by hold, with the hold switched off as the control.
 */

// Rule 1 can only be shown "not released" with the gate closed: the flag is a constant.
const gate = vi.hoisted(() => ({ released: null as boolean | null }));
vi.mock('../../src/core/conversation/disclosure.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/core/conversation/disclosure.js')>();
  return { ...real, autonomyReleased: () => gate.released ?? real.autonomyReleased() };
});
afterEach(() => { gate.released = null; });

const set: EmployeeProfile = {
  knows: 4, assistantNamed: true, spotChecks: [], hireDate: new Date('2026-07-09T00:00:00Z'), stage: 'partial',
  canDo: ['greet', 'qualify'], needConfirm: ['quote'],
  capabilities: [
    { capability: 'greet', mode: 'auto', promotable: false },
    { capability: 'qualify', mode: 'auto', promotable: false },
    { capability: 'recommend', mode: 'draft', promotable: true },
    { capability: 'quote', mode: 'draft', promotable: false },
  ],
  growth: [], promoted: true, conditions: [], products: 3, words: 0, answering: true,
  chosen: null, pendingName: 'Lily',
};

type Hold = 'stopped' | 'silenced' | 'name' | 'release';
const held = (h: Hold): EmployeeProfile =>
  h === 'stopped' ? { ...set, stopped: true } : h === 'silenced' ? { ...set, silenced: true }
    : h === 'name' ? { ...set, assistantNamed: false } : set;
const everything = (e: EmployeeProfile, l: Locale): string => withAssistantName('Lily', () =>
  [renderEmployee(e, l, null), ...EMPLOYEE_SCREENS.map((s) => renderEmployeeScreen(s, e, l, null))].join('\n'));
const plain = (html: string): string => withoutIsolates(html);

describe('V1-417 · one function decides what goes out without the owner', () => {
  it('each hold keeps every kind waiting; with none, what is set goes, up to the rung', () => {
    const caps = set.capabilities;
    expect(aloneNow({ capabilities: caps, released: true, named: true }).alone).toEqual(['greet', 'qualify']);
    for (const f of [{ stopped: true }, { silenced: true }, { named: false }, { released: false }, { earned: false }]) {
      const now = aloneNow({ capabilities: caps, released: true, named: true, ...f });
      expect(now.alone, JSON.stringify(f)).toEqual([]);
      expect(now.setButHeld, JSON.stringify(f)).toEqual(['greet', 'qualify']);
      expect(now.hold, JSON.stringify(f)).not.toBeNull();
    }
    // The order the notices are said in: the operator's pause, the owner's Stop, the native read, the name, the ramp.
    expect(aloneNow({ capabilities: caps, released: false, named: false, stopped: true, silenced: true }).hold).toBe('silenced');
    expect(aloneNow({ capabilities: caps, released: false, named: false, stopped: true }).hold).toBe('stopped');
    expect(aloneNow({ capabilities: caps, released: false, named: false }).hold).toBe('release');
    // R2 — past the rung earned, a kind is set but still waits, with no hold over everything.
    const quote = [{ capability: 'quote', mode: 'auto' as const }, { capability: 'greet', mode: 'auto' as const }];
    expect(aloneNow({ capabilities: quote, released: true, named: true, rung: 1 })).toEqual({ hold: null, alone: ['greet'], setButHeld: ['quote'] });
  });

  for (const l of LOCALES) {
    for (const h of ['stopped', 'silenced', 'name', 'release'] as const) {
      it(`${l} · ${h}: no screen says a kind goes out without you; each says it is set and still waits`, () => {
        if (h === 'release') gate.released = false;
        const html = plain(everything(held(h), l));
        for (const c of ['greet', 'qualify']) {
          const cap = capabilityName(l, c);
          expect(html, `${l}/${h}/${c}`).not.toContain(esc(plain(t(l, 'employee.actions.granted', { cap }))));
          expect(html, `${l}/${h}/${c}`).toContain(esc(plain(t(l, 'employee.actions.grantedHeld', { cap }))));
        }
        // The landing's rows and "What comes next" say no reply goes out now.
        expect(html, `${l}/${h}`).not.toContain(esc(plain(t(l, 'employee.promo.done'))));
        expect(html, `${l}/${h}`).not.toContain(`<span class="sr-desc">${esc(t(l, 'her.handles.alone'))}`);
        // The languages line says who gets replies sent alone: not while nothing is.
        expect(html, `${l}/${h}`).not.toContain(esc(plain(withAssistantName('Lily', () => t(l, 'autonomy.languages', { ready: '\u0000', waiting: '\u0000' }))).split('\u0000')[0]!));
        // A kind earned is said as earned, not as going out now.
        expect(html, `${l}/${h}`).not.toContain(esc(plain(t(l, 'employee.actions.eligible', { cap: capabilityName(l, 'recommend') }))));
        // And the reason is said where the kinds are.
        const oneKind = plain(withAssistantName('Lily', () => renderEmployeeScreen('one-kind', held(h), l, null)));
        const why = h === 'stopped' ? 'today.stopped.body' : h === 'silenced' ? 'today.silenced.body'
          : h === 'name' ? 'her.handles.held.why.name' : 'her.handles.held.why.release';
        expect(oneKind, `${l}/${h}`).toContain(esc(plain(withAssistantName('Lily', () => t(l, why, { name: 'Lily' })))));
      });
    }

    it(`${l} · the control: with nothing holding it, what is set goes out, and the screens say so`, () => {
      const html = plain(everything(set, l));
      expect(html).toContain(esc(plain(t(l, 'employee.actions.granted', { cap: capabilityName(l, 'greet') }))));
      expect(html).toContain(esc(plain(t(l, 'employee.actions.eligible', { cap: capabilityName(l, 'recommend') }))));
      expect(html).not.toContain(esc(plain(t(l, 'employee.actions.grantedHeld', { cap: capabilityName(l, 'greet') }))));
    });

    it(`${l} · what is in force follows the holds: chose "talks", stopped — in force, every reply waits`, () => {
      const e: EmployeeProfile = { ...held('stopped'), chosen: { level: 'talks', at: new Date('2026-09-01T00:00:00Z') } };
      const html = plain(withAssistantName('Lily', () => renderEmployee(e, l, null)));
      expect(html).toContain(esc(plain(withAssistantName('Lily', () => t(l, 'autonomy.inForce', { level: t(l, 'autonomy.level.waits') })))));
    });
  }
});

describe('rule 13 · while the assistant answers, its Stop is on its own page; owner only', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const landing = (e: EmployeeProfile, owner = true) => withAssistantName('Lily', () => renderEmployee(e, l, null, undefined, { isOwner: owner }));
      const on = landing(set);
      expect(on).toContain('<form method="post" action="/app/business/stop-assistant" class="inline">');
      expect(on).toContain('<input type="hidden" name="from" value="employee" />');
      expect(on).toContain(esc(withAssistantName('Lily', () => t(l, 'assistant.stop.action.stop'))));
      expect(on).toContain(`data-confirm="${esc(withAssistantName('Lily', () => t(l, 'assistant.stop.action.stopConfirm')))}"`);
      // …under the levels, and the levels first after the name.
      expect(on.indexOf('name="level"')).toBeLessThan(on.indexOf('stop-assistant'));
      // Not for staff (rule 11); not while already stopped (Start's door instead); not while nothing is connected.
      expect(landing(set, false)).not.toContain('stop-assistant');
      expect(landing({ ...set, stopped: true })).not.toContain('stop-assistant');
      expect(landing({ ...set, stopped: true })).toContain('href="/app/business/ready#stop"');
      expect(landing({ ...set, answering: false })).not.toContain('stop-assistant');
    });
  }
});

describe('w4-business-assistant-26 · the levels come first after the name; the prose before them is one level down', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = withAssistantName('Lily', () => renderEmployee(set, l, null));
      const control = html.slice(html.indexOf('level-control'), html.indexOf('name="level"'));
      // Between the heading and the first level: no paragraph at all when nothing holds it.
      expect(control.replace(/<h2>[\s\S]*?<\/h2>/, ''), l).not.toMatch(/<p[\s>]/);
      for (const k of ['autonomy.intro', 'autonomy.disclosure'] as const) {
        expect(html, `${l}/${k}`).not.toContain(esc(withAssistantName('Lily', () => t(l, k))));
        expect(withAssistantName('Lily', () => renderEmployeeScreen('alone', set, l, null)), `${l}/${k}`).toContain(esc(withAssistantName('Lily', () => t(l, k))));
      }
      expect(html).toContain(`href="/app/settings/assistant/alone">${esc(withAssistantName('Lily', () => t(l, 'her.alone.title')))}`);
      // With the name not confirmed: one line, then the levels.
      const unnamed = withAssistantName('Lily', () => renderEmployee({ ...set, assistantNamed: false }, l, null));
      const before = unnamed.slice(unnamed.indexOf('level-control'), unnamed.indexOf('name="level"'));
      expect(before.match(/<p[\s>]/g) ?? [], l).toHaveLength(1);
    });
  }
});

describe('V1-417 · Ready for customers reads the same answer', () => {
  for (const l of LOCALES) {
    it(`${l} · "may send alone" only while nothing holds every reply`, async () => {
      const { renderReady } = await import('../../src/api/web/ready.js');
      const v = { items: [], seen: new Set<never>(), named: true, connected: true, earned: true };
      const said = (k: Parameters<typeof t>[1]) => esc(withAssistantName('Lily', () => t(l, k, { name: 'Lily' })));
      const page = (over: object) => withAssistantName('Lily', () => renderReady({ ...v, ...over }, l));
      expect(page({})).toContain(said('ready.alone.earned'));
      expect(page({ stopped: true })).toContain(said('today.stopped.title'));
      expect(page({ stopped: true })).not.toContain(said('ready.alone.earned'));
      expect(page({ silenced: true })).toContain(said('today.silenced.title'));
      gate.released = false;
      expect(page({})).toContain(said('her.handles.held.why.release'));
    });
  }
});
