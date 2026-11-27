import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  renderEmployee, renderEmployeeScreen, EMPLOYEE_SCREENS, type EmployeeProfile,
} from '../../src/api/web/employee.js';
import { aloneNow } from '../../src/core/conversation/aloneNow.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, withAssistantName } from '../../src/api/web/say.js';
import { capabilityName } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { notesFor } from '../../src/api/web/helpTopics.js';
import { renderHelp } from '../../src/api/web/helpPanel.js';
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
// Rule 104 — a kind of reply is a ROW of Reply permissions' table: its name, then where it stands, in a pill.
const kindRow = (html: string, l: Locale, capability: string): string => {
  const at = html.indexOf(`<th scope="row"><bdi>${esc(plain(capabilityName(l, capability)))}</bdi></th>`);
  if (at < 0) throw new Error(`no row for ${capability}`);
  return html.slice(at, html.indexOf('</tr>', at));
};

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
          // the row says it is set and still waits, never that it goes out
          expect(kindRow(html, l, c), `${l}/${h}/${c}`).toContain(`<span class="pill long">${esc(plain(t(l, 'her.handles.held')))}</span>`);
        }
        // No row, and not "What comes next", says a reply goes out now.
        expect(html, `${l}/${h}`).not.toContain(`>${esc(plain(t(l, 'her.handles.alone')))}</span>`);
        expect(html, `${l}/${h}`).not.toContain(esc(plain(t(l, 'employee.promo.done'))));
        // The languages line says who gets replies sent alone: not while nothing is.
        expect(html, `${l}/${h}`).not.toContain(esc(plain(withAssistantName('Lily', () => t(l, 'autonomy.languages', { ready: '\u0000', waiting: '\u0000' }))).split('\u0000')[0]!));
        // A kind earned is said as earned, not as going out now.
        expect(html, `${l}/${h}`).not.toContain(esc(plain(t(l, 'employee.actions.eligible', { cap: capabilityName(l, 'recommend') }))));
        // And the reason is said on the page the kinds are on, before them (one notice at the top).
        const page = plain(withAssistantName('Lily', () => renderEmployee(held(h), l, null)));
        const why = h === 'stopped' ? 'today.stopped.body' : h === 'silenced' ? 'today.silenced.body'
          : h === 'name' ? 'her.handles.held.why.name' : 'autonomy.notReleased';
        const said = page.indexOf(esc(plain(withAssistantName('Lily', () => t(l, why, { name: 'Lily' })))));
        expect(said, `${l}/${h}`).toBeGreaterThan(0);
        expect(said, `${l}/${h}`).toBeLessThan(page.indexOf('id="reply-types"'));
      });
    }

    it(`${l} · the control: with nothing holding it, what is set goes out, and the screens say so`, () => {
      const html = plain(everything(set, l));
      expect(kindRow(html, l, 'greet')).toContain(`<span class="pill long ok">${esc(plain(t(l, 'her.handles.alone')))}</span>`);
      expect(html).toContain(esc(plain(t(l, 'employee.actions.eligible', { cap: capabilityName(l, 'recommend') }))));
      expect(html).not.toContain(`>${esc(plain(t(l, 'her.handles.held')))}</span>`);
      expect(html).toContain(esc(plain(t(l, 'employee.promo.done'))));
    });

    it(`${l} · what is in force follows the holds: chose "talks", stopped — in force, every reply waits`, () => {
      const e: EmployeeProfile = { ...held('stopped'), chosen: { level: 'talks', at: new Date('2026-09-01T00:00:00Z') } };
      const html = plain(withAssistantName('Lily', () => renderEmployee(e, l, null)));
      expect(html).toContain(esc(plain(withAssistantName('Lily', () => t(l, 'autonomy.inForce', { level: t(l, 'autonomy.level.waits') })))));
    });
  }
});

// Rule 104 (the owner-approved plan: "Stop at the top") — Reply permissions carries the Stop itself, at the top, as its
// own form that asks first; Going live keeps its own. It was a door to Going live's (the text cleanup, 2026-11-26).
describe('rule 13 · while the assistant answers, its Stop is at the top of its own page; owner only', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const landing = (e: EmployeeProfile, owner = true) => withAssistantName('Lily', () => renderEmployee(e, l, null, { isOwner: owner }));
      const on = landing(set);
      const at = on.indexOf('<div class="set-note" id="stop">');
      expect(at).toBeGreaterThan(0);
      const stop = on.slice(at, on.indexOf('</div>', at));
      expect(stop).toContain('<form method="post" action="/app/business/stop-assistant" class="set-act">');
      expect(stop).toContain(`>${esc(withAssistantName('Lily', () => t(l, 'assistant.stop.action.stop')))}</button>`);
      expect(stop).toContain(`data-confirm="${esc(withAssistantName('Lily', () => t(l, 'assistant.stop.action.stopConfirm')))}"`);
      // …at the top: before the levels.
      expect(at).toBeLessThan(on.indexOf('name="level"'));
      // Not for staff (rule 11); not while already stopped (Start's door instead); not while nothing is connected.
      expect(landing(set, false)).not.toContain('stop-assistant');
      expect(landing({ ...set, stopped: true })).not.toContain('stop-assistant');
      expect(landing({ ...set, stopped: true })).toContain('href="/app/settings/assistant/ready#stop"');
      expect(landing({ ...set, answering: false })).not.toContain('stop-assistant');
    });
  }
});

// Rule 104 — "one level down" is the page's own help now (helpTopics.ts `PAGE_NOTES`), and the DISCLOSURE is on the
// page in one line, before the levels (the owner-approved plan: the safety line stays on the page).
describe('w4-business-assistant-26 · the levels come first; before them one line, the disclosure; the long form is in the page\'s help', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = withAssistantName('Lily', () => renderEmployee(set, l, null));
      const control = html.slice(html.indexOf('id="on-her-own"'), html.indexOf('name="level"'));
      // Between the heading and the first level: the one line that says a customer is told, and nothing else.
      expect(control.match(/<p[\s>]/g) ?? [], l).toHaveLength(1);
      expect(control, l).toContain(`<p class="set-help">${esc(t(l, 'as.perm.disclosure'))}</p>`);
      const help = withAssistantName('Lily', () => renderHelp(l, { from: '/app/settings/assistant', role: 'owner', canAsk: false, canWrite: false }));
      expect(notesFor('/app/settings/assistant?x=1#on-her-own').flatMap((n) => n.lines), l).toEqual(['autonomy.intro', 'autonomy.needsName', 'autonomy.disclosure']);
      for (const k of ['autonomy.intro', 'autonomy.needsName', 'autonomy.disclosure'] as const) {
        expect(html, `${l}/${k}`).not.toContain(esc(withAssistantName('Lily', () => t(l, k))));
        expect(help, `${l}/${k}`).toContain(esc(withAssistantName('Lily', () => t(l, k))));
      }
      expect(help, l).toContain(esc(withAssistantName('Lily', () => t(l, 'her.alone.title'))));
      // With the name not confirmed: the reason is one notice above the section, with the door to confirm it.
      const unnamed = withAssistantName('Lily', () => renderEmployee({ ...set, assistantNamed: false }, l, null));
      const before = unnamed.slice(unnamed.indexOf('id="on-her-own"'), unnamed.indexOf('name="level"'));
      expect(before.match(/<p[\s>]/g) ?? [], l).toHaveLength(1);
      const top = unnamed.slice(0, unnamed.indexOf('id="on-her-own"'));
      expect(top, l).toContain(esc(t(l, 'her.handles.held.why.name')));
      expect(top, l).toContain('href="/app/settings/assistant/name"');
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
