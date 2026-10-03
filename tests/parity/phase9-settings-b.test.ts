import { describe, it, expect } from 'vitest';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { shell } from '../../src/api/web/layout.js';
import { linkedCss } from './linked-css.js';

/**
 * Phase 9 — Who works here, the business profile, the rate, samples and terms,
 * and the outreach area (contacts, finding customers, first e-mails): the
 * findings of the merged audit (docs/UI-AUDIT-V2.md §9), each held here.
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
      expect(html, path).toMatch(/<a href="\/app\/inbox" class="navlink sub active"/);
      expect(html, path).not.toMatch(/<a href="\/app\/calendar" class="navlink sub active"/);
      // …and the phone row lights Customers, as it did.
      expect(html, path).toMatch(/<a href="\/app\/inbox" class="navlink sub active"/);
    }
  });
  it('the calendar still lights only the calendar; Today lights neither', () => {
    expect(page('/app/calendar', 'inbox')).toMatch(/<a href="\/app\/calendar" class="navlink sub active"/);
    expect(page('/app/calendar', 'inbox')).not.toMatch(/<a href="\/app\/inbox" class="navlink sub active"/);
    expect(page('/app', 'home')).not.toMatch(/class="navlink sub active"/);
  });
  it('in every locale', () => {
    for (const l of LOCALES) {
      expect(shell({ title: 'T', active: 'contacts', locale: l, path: '/app/contacts', bodyHtml: '' }), l)
        .toMatch(/<a href="\/app\/inbox" class="navlink sub active"/);
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
      expect(html.indexOf('<a class="back" href="/app/settings/setup">'), l).toBeGreaterThan(-1);
      expect(html.indexOf('<a class="back" href="/app/settings/setup">'), l).toBeLessThan(html.indexOf('<h1 class="page">'));
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

// ── Business profile ───────────────────────────────────────────────────────
import { renderProfile, type BusinessProfile } from '../../src/api/web/settings.js';

const fullProfile: BusinessProfile = {
  name: 'Yiwu Hongfa', description: 'Daily-use goods', location: 'Yiwu', workingHours: '9-18',
  contactEmail: 'sales@example.com', contactPhone: null, languagesServed: ['en'], categories: ['bags', 'home'],
};
const bareProfile: BusinessProfile = {
  name: 'Yiwu Hongfa', description: null, location: null, workingHours: null,
  contactEmail: null, contactPhone: null, languagesServed: [], categories: [],
};
const profile = (l: (typeof LOCALES)[number], p: BusinessProfile = bareProfile, zone = 'Asia/Shanghai', country: string | null = null) =>
  renderProfile(p, l, null, {}, {}, { zone, country }, { currency: 'USD', fixed: true });
const optionsOf = (html: string) => [...html.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)].map((m) => ({ z: m[1]!, label: m[2]! }));

describe('V1-522, V1-528 · the full zone list: grouped, in the owner\'s language, no research stations', () => {
  it('without a country, the zones sit under their continent, named in the owner\'s language', () => {
    expect(profile('zh')).toContain('<optgroup label="亚洲">');
    expect(profile('ar')).toContain('<optgroup label="أوروبا">');
    expect(profile('es')).toContain('<optgroup label="Europa">');
    for (const l of LOCALES) expect(profile(l).match(/<optgroup /g)?.length, l).toBe(7);
  });
  it('a country with one zone is named wholly in the owner\'s language; a city only where a country has several', () => {
    const dubai = (l: (typeof LOCALES)[number]) => optionsOf(profile(l)).find((o) => o.z === 'Asia/Dubai')!.label;
    for (const l of ['zh', 'ar'] as const) expect(dubai(l), l).not.toMatch(/[A-Za-z]/);
    // Phase 9 (V1-522) — China's two zones keep two times, so neither needs a city.
    expect(optionsOf(profile('zh')).find((o) => o.z === 'Asia/Shanghai')!.label, 'zh Shanghai').not.toMatch(/[A-Za-z]/);
    // Brazil's Recife and Fortaleza keep the same time: the city tells them apart.
    expect(optionsOf(profile('zh')).find((o) => o.z === 'America/Recife')!.label).toMatch(/（Recife）/);
    expect(optionsOf(profile('en')).find((o) => o.z === 'Europe/Paris')!.label).toMatch(/^France — /);
  });
  it('no station in Antarctica or Svalbard is offered — unless it is the zone already kept', () => {
    for (const l of LOCALES) expect(optionsOf(profile(l)).filter((o) => /^(Antarctica|Arctic)\//.test(o.z)), l).toEqual([]);
    expect(optionsOf(profile('en', bareProfile, 'Antarctica/Troll')).filter((o) => o.z === 'Antarctica/Troll')).toHaveLength(1);
  });
  it('a country\'s own zones stay a short flat list', () => {
    const us = profile('en', bareProfile, 'America/New_York', 'US');
    expect(us).not.toContain('<optgroup');
    expect(optionsOf(us).every((o) => o.z.startsWith('America/') || o.z.startsWith('Pacific/'))).toBe(true);
  });
});

describe('V1-523 · the page marks what the setup step still needs', () => {
  it('an empty profile says what finishes the step, and marks each missing field', () => {
    for (const l of LOCALES) {
      const html = profile(l);
      expect(html, l).toContain(esc(t(l, 'settings.profile.needs')));
      expect(html.split(`<span class="fr-need">${esc(t(l, 'settings.profile.need'))}</span>`).length - 1, l).toBe(4);
    }
  });
  it('a finished one marks nothing', () => {
    const html = profile('en', fullProfile);
    expect(html).not.toContain('fr-need');
    expect(html).not.toContain(t('en', 'settings.profile.needs'));
  });
});

describe('V1-524, V1-525 · who reads what, and where the categories come from', () => {
  it('the description says the assistant reads it; the contact details say nobody is given them', () => {
    for (const l of LOCALES) {
      const html = withWorkspace(SCOPE, () => profile(l, fullProfile));
      expect(html, l).toContain(esc(t(l, 'settings.desc.description')));
      expect(html, l).toContain(esc(t(l, 'settings.desc.contact')));
      expect(html, l).toContain(esc(t(l, 'settings.categories.from')));
      expect(html, l).toMatch(/class="deeper" href="\/app\/products"/);
    }
  });
});

describe('V1-526 · the fixed currency explains itself in the owner\'s words', () => {
  it('no talk of converting', () => {
    expect(t('en', 'settings.currency.fixed')).not.toMatch(/convert/i);
    expect(t('zh', 'settings.currency.fixed')).not.toContain('换算');
    expect(t('es', 'settings.currency.fixed')).not.toMatch(/convert/i);
  });
});

describe('V1-527 · the languages sit in even columns', () => {
  it('a grid of three, two on a phone', () => {
    expect(rulesFor('.langs').join(';')).toContain('grid-template-columns:repeat(3, max-content)');
    expect(css).toMatch(/@media \(max-width: 560px\) \{ \.langs \{ grid-template-columns:repeat\(2, max-content\); \} \}/);
  });
});

describe('settings-b-outreach-missed-05 · typographic quotes around "today"', () => {
  it('in English and Spanish', () => {
    expect(t('en', 'settings.zone.why')).toContain('“today”');
    expect(t('es', 'settings.zone.why')).toContain('«hoy»');
    for (const l of LOCALES) expect(t(l, 'settings.zone.why'), l).not.toContain('"');
  });
});

// ── The rate, samples, terms ───────────────────────────────────────────────
import { renderRate, renderSamples, renderTerms, OFFERED_INCOTERMS } from '../../src/api/web/settings.js';
import { currencyLabel } from '../../src/core/owner/currencies.js';

const noRate = (l: (typeof LOCALES)[number]) => renderRate({ current: null, previous: [], pair: null, currency: 'USD' }, l, null);
const samples = (l: (typeof LOCALES)[number]) => renderSamples({ policy: null, waiting: [], currency: 'USD' }, l, null, NOW);
const terms = (l: (typeof LOCALES)[number], stated: { incoterm: string | null } | null = null) =>
  renderTerms({ terms: stated ? { paymentTerms: '30% with order', incoterm: stated.incoterm, statedAt: NOW } : null }, l, null);

describe('V1-529, V1-530, V1-531, V1-532, settings-b-outreach-new-06 · the rate page is not a dead end', () => {
  it('nothing to convert is a panel, with the currency by its name and the door to where it is set, and the way back', () => {
    for (const l of LOCALES) {
      const html = noRate(l);
      expect(html.indexOf('<a class="back" href="/app/business/how-you-sell">'), l).toBe(0);
      expect(html, l).toContain('<div class="empty notset" role="status">');
      expect(html, l).toContain(esc(currencyLabel(l, 'USD')));
      expect(html, l).toMatch(/class="deeper" href="\/app\/settings\/profile#zone"/);
    }
    expect(text(noRate('en'))).toContain('Your prices are in US Dollar (USD)');
    // ar: the last two words never part
    expect(t('ar', 'rate.none', { from: 'x' })).toContain('سعر صرف');
    expect(rulesFor('.empty.notset').join(';')).toContain('text-wrap:pretty');
  });
  it('with a rate to set, the way back too', () => {
    const html = renderRate({ current: null, previous: [], pair: { from: 'USD', to: 'CNY' }, currency: 'USD' }, 'en', null);
    expect(html.indexOf('<a class="back" href="/app/business/how-you-sell">')).toBe(0);
  });
});

describe('V1-533 · Chinese: no stray spaces around the stand-in name on Samples', () => {
  it('the intro and the panel run on', () => {
    const html = samples('zh');
    expect(html).toContain('告诉你的助手一个样品多少钱');
    expect(html).toContain('你还没跟你的助手说过样品的事');
    expect(html).not.toMatch(/ 你的助手|你的助手 /);
  });
});

// Phase 7 — opened from My business › How you sell, and back there.
describe('V1-534, V1-541 · Samples and Terms lead back to How you sell, where they are opened from', () => {
  it('in every locale', () => {
    for (const l of LOCALES) {
      for (const html of [samples(l), terms(l)]) {
        expect(html.indexOf(`<a class="back" href="/app/business/how-you-sell"><span class="go" aria-hidden="true">‹</span>${esc(t(l, 'factory.sellhow.title'))}</a>`), l).toBe(0);
      }
    }
  });
});

describe('V1-535 · the sample price says which money it is in', () => {
  it('the line under the field names the currency', () => {
    for (const l of LOCALES) expect(samples(l), l).toContain(esc(t(l, 'samples.price.desc', { currency: currencyLabel(l, 'USD') })));
    expect(t('en', 'samples.price.label')).not.toMatch(/\(0/);
  });
});

describe('V1-536, V1-538 · the intro and the panel do not say the same thing twice', () => {
  it('Samples: the intro no longer repeats that nothing is said', () => {
    expect(t('en', 'samples.intro')).not.toMatch(/Until you do/);
    for (const l of LOCALES) expect(t(l, 'samples.intro').length, l).toBeLessThan(t('en', 'samples.intro').length * 2);
  });
  it('Terms: the intro says what a proforma is; the panel only what follows from none', () => {
    expect(t('en', 'terms.intro')).toMatch(/^A proforma is the invoice/);
    expect(t('en', 'terms.intro')).not.toMatch(/until you/i);
    expect(t('en', 'terms.none')).not.toMatch(/until you/i);
    for (const l of LOCALES) expect(t(l, 'terms.intro'), l).not.toContain(t(l, 'terms.none').slice(0, 12));
  });
});

describe('settings-b-outreach-new-07 · a not-set panel sits apart from the card, as wide as it', () => {
  it('on Samples, Terms and the rate', () => {
    for (const l of LOCALES) for (const html of [samples(l), terms(l), noRate(l)]) expect(html, l).toContain('class="empty notset"');
    const rule = rulesFor('.empty.notset').join(';');
    expect(rule).toContain('max-width:100%');
    expect(rule).toContain('margin-bottom:var(--space-16)');
  });
});

describe('settings-b-outreach-new-08 · the tick sits at the start, beside its name', () => {
  it('wrapped in its 44px label box, held to the start of the control column', () => {
    expect(samples('en')).toContain('<span class="chkbox"><input id="sm-credited" type="checkbox" name="credited"');
    expect(css).toMatch(/\.fr-c > input\[type="checkbox"\], \.fr-c > input\[type="radio"\], \.fr-c > \.chkbox \{ align-self:flex-start; \}/);
  });
});

describe('V1-537, V1-006-terms · the delivery term is a choice the owner can read', () => {
  it('each term says what it means; the first choice is none at all (the warmth run, V1-537); DDU is not offered', () => {
    for (const l of LOCALES) {
      const html = terms(l);
      expect(html, l).toContain(`<option value="" selected>${esc(t(l, 'terms.incoterm.none'))}</option>`);
      const opts = optionsOf(html);
      expect(opts.map((o) => o.z), l).toEqual([...OFFERED_INCOTERMS]);
      for (const o of opts) expect(o.label, `${l} ${o.z}`).toBe(esc(`${o.z} — ${t(l, `terms.incoterm.${o.z}` as never)}`));
    }
  });
  it('a workspace that chose DDU keeps it, said for what it is', () => {
    const html = terms('en', { incoterm: 'DDU' });
    expect(html).toContain('<option value="DDU" selected>DDU — an old name for DAP, no longer in use</option>');
    expect(html).toContain('<p class="muted">DDU — an old name for DAP, no longer in use</p>');
  });
  it('the stated term is said in words too', () => {
    for (const l of LOCALES) expect(terms(l, { incoterm: 'FOB' }), l).toContain(`<p class="muted">${esc(`FOB — ${t(l, 'terms.incoterm.FOB')}`)}</p>`);
  });
});

describe('V1-539 · the payment example is never cut off', () => {
  it('it is a line under the name, not a placeholder', () => {
    for (const l of LOCALES) {
      const html = terms(l);
      expect(html, l).toContain(esc(t(l, 'terms.payment.example')));
      expect(html.slice(html.indexOf('id="tm-payment"'), html.indexOf('/>', html.indexOf('id="tm-payment"'))), l).not.toContain('placeholder=');
    }
  });
});

describe('V1-540, V1-542, settings-b-outreach-missed-10 · the terms page in Arabic and Chinese', () => {
  it('ar: لـ joins مساعدك in the hint; the not-set panel is one short sentence', () => {
    expect(terms('ar')).toContain('ويمكن لمساعدك ذكره');
    expect(terms('ar')).not.toContain('لـمساعدك');
    expect(t('ar', 'terms.none').length).toBeLessThan(50);   // it was 58 with the name in, and its last word fell alone
  });
  it('zh: one word for delivery', () => {
    expect(t('zh', 'terms.title')).toContain('交货');
    expect(t('zh', 'terms.title')).not.toContain('交付');
    expect(t('zh', 'terms.incoterm.label')).toContain('交货');
  });
});

// ── Contacts ───────────────────────────────────────────────────────────────
import { renderContacts, renderSuppressConfirm, CONTACTS_PAGE, type ContactsView } from '../../src/api/web/contacts.js';
import type { ContactRow } from '../../src/db/contacts.js';
import { saidFlash } from '../../src/api/web/flash.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const AT = new Date('2026-08-01T02:00:00Z');
const wa = (i: number): ContactRow => ({
  id: null, channel: 'whatsapp', identity: `2126000${String(i).padStart(5, '0')}`, displayName: `Buyer ${i}`, company: null,
  source: 'inbound', firstSeen: AT, archivedAt: null,
  consent: { evidence: 'inbound_message', obtainedAt: AT, recordedBy: 'system' }, suppression: null,
});
const card: ContactRow = { id: 'k1', channel: 'email', identity: 'mei@gulf.example', displayName: 'Mei', company: 'Gulf Trading',
  source: 'manual', firstSeen: AT, archivedAt: null, consent: null, suppression: null };
const seventyOne = Array.from({ length: 71 }, (_, i) => wa(i + 1));
const cview = (contacts: readonly ContactRow[], over: Partial<ContactsView> = {}): ContactsView =>
  ({ contacts, outreach: new Map(), satisfied: new Set(), ...over });
const rowsOf = (html: string) => html.split('<li class="ct ').length - 1;

describe('V1-543, V1-545, V1-555 · the heading promises nothing the rows deny; each reason is said once', () => {
  it('the page is "Contacts", and says up front how many can be written to first', () => {
    for (const l of LOCALES) {
      const html = renderContacts(cview(seventyOne), l, null);
      expect(html, l).toContain(`<h1 class="page">${esc(t(l, 'contacts.title'))}</h1>`);
      expect(html, l).toContain(esc(t(l, 'contacts.summary', { can: show.count(l, 0), total: show.count(l, 71) })));
    }
    expect(t('en', 'contacts.title')).toBe('Contacts');
  });
  it('WhatsApp people sit under one head that says, once, that a first message goes by e-mail only', () => {
    for (const l of LOCALES) {
      const html = renderContacts(cview(seventyOne), l, null);
      expect(html.split(esc(t(l, 'contacts.why.reply_only'))).length - 1, l).toBe(1);
      expect(html, l).not.toContain(esc(t(l, 'refused.why.channel_cannot_initiate')));
      expect(html, l).not.toContain('class="pill ok"');
      // how they came is said once on each row
      expect(html.split(esc(t(l, 'contacts.evidence.inbound_message'))).length - 1, l).toBe(CONTACTS_PAGE);
    }
  });
});

describe('V1-544 · the list is searched and paged, and adding someone opens above it', () => {
  it('25 a page, with where you are in the whole', () => {
    const html = renderContacts(cview(seventyOne), 'en', null);
    expect(rowsOf(html)).toBe(CONTACTS_PAGE);
    expect(html).toContain('1–25 of 71');
    expect(html).toContain('href="/app/contacts?page=2"');
    const last = renderContacts(cview(seventyOne, { page: 3 }), 'en', null);
    expect(rowsOf(last)).toBe(21);
    expect(last).toContain('51–71 of 71');
  });
  it('a search by name or by digits narrows it', () => {
    expect(rowsOf(renderContacts(cview(seventyOne, { query: 'Buyer 7' }), 'en', null))).toBe(3);   // Buyer 7, 70 and 71
    expect(rowsOf(renderContacts(cview(seventyOne, { query: '00042' }), 'en', null))).toBe(1);
    expect(renderContacts(cview(seventyOne, { query: 'nobody' }), 'en', null)).toContain(t('en', 'buyers.search.none', { q: 'nobody' }));
  });
  it('"Add someone you met" is before the list', () => {
    const html = renderContacts(cview(seventyOne), 'en', null);
    expect(html.indexOf(t('en', 'contacts.add.title'))).toBeLessThan(html.indexOf('<li class="ct '));
  });
});

describe('V1-546 · never writing to someone again is a button, not a door', () => {
  it('a quiet button that opens the question; no "›" door to it', () => {
    const html = renderContacts(cview([wa(1)]), 'en', null);
    expect(html).toContain(`<button class="btn ghost" type="submit">${esc(t('en', 'contacts.suppress.button'))}</button>`);
    expect(html).not.toMatch(/class="deeper" href="\/app\/contacts\/suppress/);
  });
});

describe('V1-548, V1-562, V1-563 · one name for the page, wherever it is named', () => {
  it('the back links of finding customers and first e-mails say what the page says', async () => {
    const { renderProspects } = await import('../../src/api/web/prospects.js');
    const { renderSequenceList } = await import('../../src/api/web/sequences.js');
    for (const l of LOCALES) {
      const back = `<a class="back" href="/app/contacts"><span class="go" aria-hidden="true">‹</span>${esc(t(l, 'contacts.title'))}</a>`;
      expect(renderProspects({ status: { kind: 'none' }, filter: null, outcome: null }, l, null), l).toContain(back);
      expect(renderSequenceList([], l, null), l).toContain(back);
      const doc = shell({ title: t(l, 'nav.sequences'), active: 'sequences', locale: l, path: '/app/sequences', bodyHtml: renderSequenceList([], l, null) });
      expect(doc, l).toContain(`<title>${esc(t(l, 'seq.title'))} · Nomi</title>`);
    }
  });
});

describe('V1-549, settings-b-outreach-missed-11 · the intro says only what the form asks', () => {
  it('no "how you met" in any language', () => {
    expect(t('en', 'contacts.intro')).not.toMatch(/how you met/);
    expect(t('es', 'contacts.intro')).not.toMatch(/conocieron/);
    expect(t('zh', 'contacts.intro')).not.toMatch(/怎么认识/);
    expect(t('ar', 'contacts.intro')).not.toMatch(/التعارف/);
    expect(t('fr', 'contacts.intro')).not.toMatch(/origine du contact/);
  });
});

describe('V1-550 · the add form is a card of rows with its act at the end', () => {
  it('no full-width column form', () => {
    const html = renderContacts(cview([]), 'en', null);
    expect(html).not.toContain('class="cform"');
    expect(html).toMatch(/<div class="fr-acts"><button class="btn send" type="submit">Add to the list<\/button><\/div>/);
  });
});

describe('V1-551 · a phone number with its country code set apart', () => {
  it('+212 600000105, +234 5000000261, +971 5000000200', async () => {
    const { withCallingCode } = await import('../../src/core/channel/callingCodes.js');
    expect(withCallingCode('212600000105')).toBe('+212 600000105');
    expect(withCallingCode('2345000000261')).toBe('+234 5000000261');
    expect(withCallingCode('9715000000200')).toBe('+971 5000000200');
    expect(withCallingCode('14155550100')).toBe('+1 4155550100');
    expect(renderContacts(cview([wa(105)]), 'en', null)).toContain('+212 600000105');
  });
});

describe('V1-552, V1-553 · E-mail as the product writes it; Chinese without a doubled gap or a doubled phrase', () => {
  it('en and ar', () => {
    expect(t('en', 'contacts.channel.email')).toBe('E-mail');
    expect(t('ar', 'contacts.channel.email')).toBe('البريد الإلكتروني');
  });
  it('zh', () => {
    const html = renderContacts(cview([wa(1)]), 'zh', null);
    expect(html).not.toContain('　·　');
    expect(t('zh', 'contacts.source.inbound')).toBe(t('zh', 'contacts.evidence.inbound_message'));
  });
});

describe('V1-554, V1-556 · an address that names nobody, or someone not reached by e-mail, says so', () => {
  it('the routes draw the list with a sentence, and the sentence is drawn', () => {
    const app = readFileSync(fileURLToPath(new URL('../../src/api/web/app.ts', import.meta.url)), 'utf8');
    expect(app.match(/saidFlash\(locale, 'contacts\.said\.notOnList'\)/g)?.length).toBe(2);
    expect(app).toContain("saidFlash(locale, 'contacts.said.emailOnly')");
    for (const l of LOCALES) {
      for (const k of ['contacts.said.notOnList', 'contacts.said.emailOnly'] as const) {
        expect(renderContacts(cview(seventyOne), l, saidFlash(l, k)), `${l} ${k}`).toContain(esc(t(l, k)));
      }
    }
  });
});

describe('V1-557, V1-558, settings-b-outreach-new-12 · never again: what it changes, asked as the dialog asks', () => {
  it('says the customer is still answered; the act in red, then the way back with the focus', () => {
    for (const l of LOCALES) {
      const html = renderSuppressConfirm({ channel: 'whatsapp', identity: '212600000105', displayName: 'Fatima Zahra' }, l);
      expect(html, l).toContain(esc(t(l, 'contacts.suppress.hint')));
      const danger = html.indexOf(`<button class="btn danger" type="submit">${esc(t(l, 'contacts.suppress.confirm'))}</button>`);
      const cancel = html.indexOf(`<a class="back" href="/app/contacts" autofocus><span class="go" aria-hidden="true">‹</span>${esc(t(l, 'contacts.suppress.cancel'))}</a>`);
      expect(danger, l).toBeGreaterThan(-1);
      expect(cancel, l).toBeGreaterThan(danger);
    }
    expect(t('en', 'contacts.suppress.hint')).toMatch(/answered as usual/);
    expect(t('ar', 'contacts.suppress.confirm')).not.toBe('نعم، أبدًا');
    expect(rulesFor('.btn.danger').join(';')).toContain('color:var(--color-warn)');
  });
});

describe('settings-b-outreach-missed-02 · adding a customer is its own word too', () => {
  it('in every locale', () => {
    for (const l of LOCALES) {
      expect(t(l, 'contacts.add.button'), l).not.toBe(t(l, 'people.add.button'));
      expect(t(l, 'contacts.add.button'), l).not.toBe(t(l, 'assistants.add.button'));
    }
  });
});

// ── Find customers, first e-mails ──────────────────────────────────────────
import { renderProspects } from '../../src/api/web/prospects.js';
import { renderSequenceList } from '../../src/api/web/sequences.js';

const storedKey = { kind: 'stored' as const, fingerprint: 'ab12cd34ef56', createdBy: 'Mei', createdAt: NOW, readable: true };
const prospects = (l: (typeof LOCALES)[number], status: Parameters<typeof renderProspects>[0]['status'] = { kind: 'none' }) =>
  renderProspects({ status, filter: null, outcome: null }, l, null);

describe('V1-559, settings-b-outreach-missed-13 · the Apollo key: what Apollo is, where the key is made, the way there', () => {
  it('in every locale, with the link out; the field is not the heading again', () => {
    for (const l of LOCALES) {
      const html = prospects(l);
      expect(html, l).toContain(esc(t(l, 'prospects.key.none')));
      expect(html, l).toContain('href="https://www.apollo.io/" rel="noopener noreferrer" target="_blank"');
      expect(t(l, 'prospects.key.field'), l).not.toBe(t(l, 'prospects.key.title'));
    }
    expect(t('en', 'prospects.key.none')).toMatch(/paid directory/);
    expect(t('en', 'prospects.key.none')).toMatch(/Settings, then Integrations/);
  });
});

describe('V1-560, V1-561 · before a key, the page says what the search will be', () => {
  it('a preview panel without a key; the search itself once one is in', () => {
    for (const l of LOCALES) expect(prospects(l), l).toContain(`<div class="empty notset">${esc(t(l, 'prospects.preview'))}</div>`);
    const open = prospects('en', storedKey);
    expect(open).not.toContain(t('en', 'prospects.preview'));
    expect(open).toContain('<form method="get" action="/app/prospects" class="sform">');
    expect(t('en', 'prospects.intro')).not.toMatch(/their row says so/);
  });
  it('zh reads as said, not as a rule', () => {
    expect(t('zh', 'prospects.intro')).not.toContain('没有任何记录说你可以联系对方');
  });
});

describe('V1-564, V1-565, settings-b-outreach-new-14 · first e-mails say what they need, and the form is a card', () => {
  it('e-mail only, to people who may be written to first; with nobody ready, said, with the door to Contacts', () => {
    for (const l of LOCALES) {
      const html = renderSequenceList([], l, null, { ready: 0 });
      expect(html, l).toContain(esc(t(l, 'seq.needs')));
      expect(html, l).toContain(esc(t(l, 'seq.noneReady')));
      expect(html, l).toMatch(/class="deeper" href="\/app\/contacts"/);
      expect(html, l).not.toContain('class="sqform"');
      expect(html, l).toMatch(/<div class="fr-acts"><button class="btn send" type="submit">/);
    }
    expect(renderSequenceList([], 'en', null, { ready: 2 })).not.toContain(t('en', 'seq.noneReady'));
  });
  it('the empty list says what will be listed, and where to start', () => {
    expect(t('en', 'seq.empty')).toMatch(/listed here/);
    expect(t('en', 'seq.empty')).toMatch(/below/);
    expect(t('es', 'seq.empty')).not.toMatch(/ninguna/);
  });
});

describe('V1-566 · the thing being made has one name in every language', () => {
  it('"a first e-mail and its follow-ups" — not a group, not a sequence', () => {
    expect(t('en', 'seq.new.title')).toMatch(/first e-mail and its follow-ups/);
    expect(t('zh', 'seq.new.title')).not.toContain('组');
    expect(t('ar', 'seq.new.title')).not.toContain('مجموعة');
    expect(t('es', 'seq.new.title')).not.toMatch(/secuencia/);
    expect(t('fr', 'seq.new.title')).not.toMatch(/séquence/);
  });
});

describe('settings-b-outreach-new-09 · one place for a form\'s act on every page here: its end side', () => {
  it('no form on these pages puts its filled button at the start of a column form', () => {
    const pages = [
      people('en'), noRate('en'), samples('en'), terms('en'), profile('en'),
      renderContacts(cview([card]), 'en', null), prospects('en'), prospects('en', storedKey), renderSequenceList([], 'en', null),
    ];
    for (const html of pages) {
      for (const cls of ['pform', 'cform', 'sqform']) expect(html).not.toContain(`class="${cls}"`);
      const acts = html.match(/<button class="btn send" type="submit">/g)?.length ?? 0;
      const ended = (html.match(/<div class="(fr-acts|savebar)"><button class="btn send" type="submit">/g)?.length ?? 0);
      expect(ended, html.slice(0, 80)).toBe(acts);
    }
    for (const l of LOCALES) expect(t(l, 'terms.save'), l).toBe(t(l, 'samples.save'));
  });
});
