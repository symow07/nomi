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

// ── Who works here ─────────────────────────────────────────────────────────
import { renderPeople, type TeamMember } from '../../src/api/web/people.js';
import { renderAssistantsSection } from '../../src/api/web/assistants.js';
import { withWorkspace } from '../../src/api/web/say.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import type { Assistant } from '../../src/core/owner/assistants.js';
import { esc } from '../../src/api/web/layout.js';
import * as show from '../../src/api/web/values.js';

const NOW = new Date('2026-10-02T10:00:00Z');
const you: TeamMember = { id: 'p-you', name: 'Mei', isOwner: true, addedAt: new Date('2026-10-02T08:00:00Z'), signsInWithEmail: true, lastSeenAt: NOW };
const chen: TeamMember = { id: 'p-chen', name: '陈莉', isOwner: false, addedAt: new Date('2026-10-02T09:00:00Z'), signsInWithEmail: false, lastSeenAt: null };
const lily: Assistant = { id: '00000000-0000-4000-8000-000000000001', name: 'Lily', role: 'sales', note: null, channels: [], isDefault: true };
const noor: Assistant = { id: '00000000-0000-4000-8000-000000000002', name: 'Noor', role: 'support', note: null, channels: ['instagram'], isDefault: false };
const people = (l: (typeof LOCALES)[number], extra: Partial<Parameters<typeof renderPeople>[0]> = {}) =>
  renderPeople({ people: [you, chen], justIssued: null, assistants: [lily, noor], ...extra }, l, null, NOW);
const SCOPE = { name: null, several: false, outreach: false, setup: null, business: '义乌宏发日用品厂 (demo)' };
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('V1-509, V1-519 · adding someone has its own heading, and says a code will be shown to hand over', () => {
  it('a section of its own after the list, headed, with the hint before the button, in every locale', () => {
    for (const l of LOCALES) {
      const html = people(l);
      const list = html.indexOf('</ul>');
      const head = html.indexOf(`<h2>${esc(t(l, 'people.add.title'))}</h2>`);
      const hint = html.indexOf(esc(t(l, 'people.add.hint')));
      const form = html.indexOf('action="/app/settings/people"');
      expect(head, l).toBeGreaterThan(list);
      expect(hint, l).toBeGreaterThan(head);
      expect(form, l).toBeGreaterThan(hint);
      // the form is not inside the list of people
      expect(html.slice(html.indexOf('<ul class="rows">'), list), l).not.toContain('action="/app/settings/people"');
    }
    expect(t('en', 'people.add.hint')).toMatch(/code/);
  });
});

describe('settings-b-outreach-missed-02 · one word, one act', () => {
  it('adding a teammate and adding an assistant are said differently, in every locale', () => {
    for (const l of LOCALES) expect(t(l, 'people.add.button'), l).not.toBe(t(l, 'assistants.add.button'));
  });
});

describe('V1-510 · the assistant\'s folds are controls, and say what they change', () => {
  it('each summary is drawn as a button with its own words', () => {
    for (const l of LOCALES) {
      const html = renderAssistantsSection([lily, noor], l);
      const sums = [...html.matchAll(/<summary class="btn">([^<]*)<\/summary>/g)].map((m) => m[1]);
      expect(sums, l).toEqual([esc(t(l, 'assistants.change')), esc(t(l, 'assistants.change.channels')), esc(t(l, 'assistants.add.summary'))]);
    }
    expect(t('en', 'assistants.add.summary')).toBe('Add another assistant');
    expect(t('es', 'assistants.add.summary')).not.toMatch(/alguien/);
  });
});

describe('V1-511 · one name for the assistant on the page', () => {
  it('while the name is unconfirmed, the page says "your assistant" and the row says the name is not confirmed', () => {
    for (const l of LOCALES) {
      const html = withWorkspace(SCOPE, () => people(l));
      expect(html, l).toContain(esc(t(l, 'assistants.unconfirmed')));
      expect(html, l).toContain('href="/app/onboarding"');
      const intro = html.slice(html.indexOf('id="assistants"'), html.indexOf('<ul class="rows">', html.indexOf('id="assistants"')));
      expect(intro, l).not.toContain('Lily');
    }
  });
  it('once confirmed, the intro and the list say the name, and nothing says it is unconfirmed', () => {
    const html = withWorkspace({ ...SCOPE, name: 'Lily' }, () => people('en'));
    expect(html).toContain('goes to Lily.');
    expect(html).toContain('Decide what Lily may do without asking');
    expect(html).not.toContain(t('en', 'assistants.unconfirmed'));
  });
});

describe('V1-512 · Who works here names itself and leads back to Setup', () => {
  it('the back link, and the tab is the heading', () => {
    for (const l of LOCALES) {
      const html = people(l);
      expect(html.indexOf('<a class="back" href="/app/settings">'), l).toBeGreaterThan(-1);
      expect(html.indexOf('<a class="back" href="/app/settings">'), l).toBeLessThan(html.indexOf('<h1 class="page">'));
      const doc = withWorkspace(SCOPE, () => shell({ title: t(l, 'nav.settings'), active: 'settings', locale: l, path: '/app/settings/people', bodyHtml: html }));
      expect(doc, l).toContain(`<title>${esc(t(l, 'people.title'))} · 义乌宏发日用品厂 (demo)</title>`);
    }
  });
});

describe('V1-513 · the date after a name says what it is', () => {
  it('"Added …" on every row', () => {
    for (const l of LOCALES) {
      const html = people(l);
      for (const p of [you, chen]) expect(html, `${l} ${p.name}`).toContain(esc(t(l, 'people.added', { date: show.date(l, p.addedAt) })));
    }
    expect(text(people('en'))).toContain('Added Fri, Oct 2');
  });
});

describe('V1-514, V1-520 · one label style and one field width on the page', () => {
  it('every form on the page is a card of rows: no muted span labels, no bare .fld', () => {
    for (const l of LOCALES) {
      const html = people(l, { business: 'Mei' });
      expect(html, l).not.toContain('class="fld"');
      expect(html, l).not.toMatch(/<label class="fld"><span class="muted">/);
      expect(html, l).toContain('class="sform askname"');
      // the owner's name form and the add form are the same shape, both outside the list
      const rows = html.slice(html.indexOf('<ul class="rows">'), html.indexOf('</ul>'));
      expect(rows, l).not.toContain('<form method="post" action="/app/settings/people/p-you/name"');
      expect(html.match(/<div class="setrow"><div class="fr-l"><label class="fr-name" for="pp-/g)?.length, l).toBe(2);
    }
  });
  it('the channels are a grid of two, so no channel sits alone on a line', () => {
    const html = renderAssistantsSection([lily, noor], 'en');
    expect(html).toContain('class="choices as-chans"');
    expect(rulesFor('.as-chans').join(';')).toContain('grid-template-columns:repeat(2, max-content)');
  });
});

describe('V1-515 · Chinese: one name for the code', () => {
  it('the intro, the rows and the Remove question all say 登录码', () => {
    const html = people('zh');
    expect(html).not.toContain('进入密码');
    expect(t('zh', 'people.via.code')).toContain('登录码');
    expect(t('zh', 'people.remove.confirm', { who: '陈莉' })).toContain('登录码');
    expect(t('zh', 'people.intro')).toContain('登录码');
  });
});

describe('V1-516, settings-b-outreach-missed-01 · Arabic: the count in its own form, لـ joined, nobody gendered', () => {
  it('two people are شخصان; the owner-only line joins لمساعدك', () => {
    const html = withWorkspace(SCOPE, () => people('ar'));
    expect(text(html)).toContain('شخصان هنا');
    expect(html).not.toContain('2 من الأشخاص');
    expect(html).toContain('لمساعدك');
    expect(html).not.toContain('لـ مساعدك');
  });
  it('no third-person verb or participle about a person on the rows', () => {
    const html = people('ar', { people: [you, chen, { ...chen, id: 'p-3', name: 'Ali', lastSeenAt: NOW }] });
    for (const word of ['يدخل', 'لم يظهر', 'متصل']) expect(html, word).not.toContain(word);
  });
});

describe('V1-517 · labels are words, the one state is a pill you can see', () => {
  it('no bare pill and no paper-on-paper pill; "Online now" carries its hairline', () => {
    for (const l of LOCALES) {
      const html = people(l);
      expect(html, l).not.toContain('<span class="pill">');
      expect(html, l).not.toContain('class="pill owner"');
      expect(html, l).toContain(`<span class="pill stop">${esc(t(l, 'people.online'))}</span>`);
      expect(text(html), l).toContain(`${t(l, 'assistants.role.sales')} · ${t(l, 'assistants.default.pill')}`);
    }
    expect(rulesFor('.pill.stop').join(';')).toContain('border:1px solid');
  });
});

describe('V1-518 · what only the owner may do is a list to read', () => {
  it('a plain list, not ruled rows; the English reads as one run of imperatives', () => {
    const html = people('en');
    expect(html).toContain('<ul class="owner-only">');
    expect(html).not.toContain('<li class="row muted">');
    expect(t('en', 'people.ownerOnly.outreach')).toMatch(/^Let /);
  });
});

describe('settings-b-outreach-missed-03 · Arabic: "your customers", plural', () => {
  it('the assistants heading', () => {
    expect(t('ar', 'assistants.title')).toContain('عملائك');
    expect(t('ar', 'assistants.title')).not.toContain('عميلك');
  });
});
