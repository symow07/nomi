import { describe, it, expect } from 'vitest';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { shell } from '../../src/api/web/layout.js';
import { linkedCss } from './linked-css.js';

/**
 * Phase 9 — Who works here, the business profile, the rate, samples and terms,
 * and the outreach area (contacts, finding customers, first e-mails): the
 * findings of the merged audit (docs/UI-AUDIT.md §9), each held here.
 */

const page = (path: string, active: string, bodyHtml = '<h1 class="page">X</h1>') =>
  shell({ title: 'T', active, locale: 'en', path, bodyHtml });
const css = linkedCss(page('/app', 'home'));
/** Every rule whose selector list names `sel`, comments stripped. */
const rulesFor = (sel: string): string[] =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1]!.split(',').some((p) => p.trim() === sel)).map((m) => m[2]!);

describe('extra-pform-choices · a form\'s text-field box is for text fields only', () => {
  it('no rule gives a tick or a radio in a .pform the text field\'s padding, border and height', () => {
    expect(rulesFor('.pform input'), 'a bare `.pform input` styles every tick as a text box').toEqual([]);
    const text = rulesFor('.pform input:not([type="checkbox"]):not([type="radio"])').join(';');
    expect(text).toContain('padding:11px 14px');
    expect(text).toContain('min-height:44px');
  });

  it('every choice label a .pform carries is a 44px target', () => {
    for (const sel of ['.chkbox', '.as-box', '.pcheck', '.pform label.check']) {
      expect(rulesFor(sel).join(';'), sel).toMatch(/min-height:44px/);
    }
  });
});

describe('settings-b-outreach-new-04 · the one Save sits at the form\'s end, not across it', () => {
  it('the save bar does not stick to the foot of the screen', () => {
    const bar = rulesFor('.savebar').join(';');
    expect(bar).toContain('justify-content:flex-end');
    expect(bar).not.toMatch(/position\s*:\s*(sticky|fixed)/);
  });
});

describe('V1-547, V1-562, V1-563 · a page reached from the customer list lights it on a wide screen', () => {
  it('contacts, finding customers and first e-mails light "Customer list", never the calendar', () => {
    for (const [path, active] of [['/app/contacts', 'contacts'], ['/app/prospects', 'prospects'], ['/app/sequences', 'sequences'],
      ['/app/contacts/suppress', 'contacts'], ['/app/sequences/x', 'sequences']] as const) {
      const html = page(path, active);
      expect(html, path).toMatch(/<a href="\/app\/inbox" class="subnav active"/);
      expect(html, path).not.toMatch(/<a href="\/app\/calendar" class="subnav active"/);
      // …and the phone row lights Customers, as it did.
      expect(html, path).toMatch(/<a href="\/app\/inbox" class="navlink active"/);
    }
  });
  it('the calendar still lights only the calendar; Today lights neither', () => {
    expect(page('/app/calendar', 'inbox')).toMatch(/<a href="\/app\/calendar" class="subnav active"/);
    expect(page('/app/calendar', 'inbox')).not.toMatch(/<a href="\/app\/inbox" class="subnav active"/);
    expect(page('/app', 'home')).not.toMatch(/class="subnav active"/);
  });
  it('in every locale', () => {
    for (const l of LOCALES) {
      expect(shell({ title: 'T', active: 'contacts', locale: l, path: '/app/contacts', bodyHtml: '' }), l)
        .toMatch(/<a href="\/app\/inbox" class="subnav active"/);
    }
  });
});
