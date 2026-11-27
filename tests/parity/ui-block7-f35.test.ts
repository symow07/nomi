import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderProfile, renderHours, renderCurrency, type BusinessProfile } from '../../src/api/web/settings.js';
import { saveActs } from '../../src/api/web/settingsPage.js';
import { SETTINGS_AREA_CSS } from '../../src/api/web/settingsAreaStyle.js';
import { OWNER_VIEW, type Viewer } from '../../src/core/conversation/people.js';
import { zoneLabel } from '../../src/core/owner/zones.js';
import { currencyLabel } from '../../src/core/owner/currencies.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import type { MessageKey } from '../../src/core/owner/i18n/messages.js';
import { withoutIsolates } from './isolates.js';

/**
 * UI Block 7 · F35 — Business settings, as RULE 104 (the settings overhaul, 2026-11-27) draws them. F35 made the
 * profile three subjects, each its own form with its own Save, every form carrying the whole profile hidden so that
 * no Save blanked another. Rule 104 keeps what that protected and does it with ONE form: every field of the profile is
 * on the page once, and the page's one Save sends them all; nothing is hidden, so nothing can be blanked. Working
 * hours and the time zone have one home (Hours and closures), the currency another (Currency), each by its name, and
 * a value that cannot change there says why (rules 41, 42). Closures: what is recorded first, then the form that adds.
 */

const STAFF: Viewer = { ...OWNER_VIEW, isOwner: false } as Viewer;
const p: BusinessProfile = {
  name: 'Juniper Skin', description: 'Skin care made in small batches.', location: 'Lisbon', workingHours: 'Mon–Fri 9–18',
  contactEmail: 'hello@juniper.test', contactPhone: '+351210000000', languagesServed: ['en', 'pt'],
} as BusinessProfile;
const KIND = { view: { kind: null, country: 'PT', website: '' } };
const draw = (l: Locale) => withoutIsolates(renderProfile(p, l, null, {}, {}, null, null, OWNER_VIEW, {}, KIND));
const forms = (html: string) => [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[0]!);
const names = (f: string, hidden: boolean) =>
  [...f.matchAll(/<(input|select|textarea)\b([^>]*)>/g)].filter((m) => (m[2]!.includes('type="hidden"')) === hidden)
    .map((m) => /name="([^"]+)"/.exec(m[2]!)?.[1]).filter((n): n is string => !!n);

describe('F35 · rule 104 · the profile is one form with one Save', () => {
  it('one form, one Save that says "Save", its Cancel beside it, at the end — in every language', () => {
    for (const l of LOCALES) {
      const html = draw(l);
      const fs = forms(html);
      expect(fs.length, l).toBe(1);
      expect(fs[0], l).toContain('<form method="post" action="/app/settings/business/profile" class="set-form" data-save id="profile-form">');
      expect(html, l).not.toContain('class="savebar"');
      expect(fs[0]!.endsWith(`${saveActs(l)}</form>`), l).toBe(true);
      expect(html.match(/class="btn send\b/g)?.length, l).toBe(1);
      // the per-subject Saves are gone with the subjects' own forms
      for (const k of ['biz.save.business', 'biz.save.contact', 'biz.save.zone', 'biz.save.kind'] as MessageKey[]) expect(html, `${l} ${k}`).not.toContain(`>${esc(t(l, k))}</button>`);
    }
  });
  it('every field is on the page exactly once and none is carried hidden, so no Save blanks another', () => {
    const f = forms(draw('en'))[0]!;
    const shown = names(f, false);
    expect(shown).toEqual(expect.arrayContaining(['name', 'description', 'location', 'lang_en', 'lang_pt', 'contact_email', 'contact_phone', 'postal_address', 'kind', 'country', 'website']));
    expect(shown.length).toBe(new Set(shown).size);
    expect(names(f, true)).toEqual([]);
    // the stored values are the fields' values
    expect(f).toContain('>Skin care made in small batches.</textarea>');
    expect(f).toContain('name="contact_email" value="hello@juniper.test"');
    // Working hours left the profile: the route keeps what is stored, so the profile's Save never blanks them.
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    const route = app.slice(app.indexOf('app.post(PROFILE_PAGE'), app.indexOf('app.post(PROFILE_PAGE') + 1200);
    expect(route).toContain("workingHours: stored.workingHours ?? ''");
    expect(shown).not.toContain('working_hours');
  });
  it('the type, country and website are rows of the same form: no Save of their own', () => {
    for (const l of LOCALES) {
      const html = draw(l);
      const part = html.slice(html.indexOf('<section class="set-sec" id="business-kind">'));
      expect(part.slice(0, part.indexOf('</section>')), l).not.toContain('type="submit"');
      expect(part, l).toContain('<select id="bk-kind" name="kind">');
      expect(part, l).toContain('<option value="PT" selected>');
    }
  });
});

describe('F35 · hours, zone and currency by their names, each in its one home, read-only states explained', () => {
  const hours = (l: Locale) => withoutIsolates(renderHours({ workingHours: 'Mon–Fri 9–18', zone: { zone: 'Asia/Shanghai', country: 'CN' }, closures: [] }, l, null));
  const cur = (fixed: boolean, viewer: Viewer = OWNER_VIEW) =>
    withoutIsolates(renderCurrency({ current: null, previous: [], pair: null, currency: 'EUR' }, { currency: 'EUR', fixed }, 'en', null, viewer));
  it('rule 42 kept: a fixed currency and a staff member get no currency choice', () => {
    for (const html of [cur(true), cur(false, STAFF)]) {
      expect(html).not.toContain('name="currency"');
      expect(html).not.toContain('type="submit"');   // nothing to save: no Save at all
    }
    expect(cur(false)).toContain('<select id="pf-currency" name="currency">');
  });
  it('the zone by its name in the owner\'s language, never its raw name; the currency by its name, not its code', () => {
    for (const l of LOCALES) {
      const html = hours(l);
      // (one zone for the country: the list names it as zoneLabel does, by the place and its time)
      const chosen = /<option value="Asia\/Shanghai" selected>([^<]+)<\/option>/.exec(html)?.[1] ?? '';
      expect(chosen, l).not.toBe('');
      expect(esc(zoneLabel(l, 'Asia/Shanghai')), l).toContain(chosen);
      expect(html.replace(/<[^>]+>/g, ' '), l).not.toContain('Asia/Shanghai');
      expect(html, l).toContain('class="setrow"');
      // hours and the zone are fields of the page's one Save, at the end of the page
      expect(html, l).toContain('<form method="post" action="/app/settings/business/hours" class="set-form" data-save id="hours-form">');
      expect(html, l).toContain('name="working_hours" value="Mon–Fri 9–18"');
      expect(html.trimEnd().endsWith(`${saveActs(l)}</form>`), l).toBe(true);
    }
    expect(cur(false)).toContain(esc(currencyLabel('en', 'EUR')));
  });
  it('a fixed currency says why; staff are told who decides; the owner may choose, and is told why it matters', () => {
    expect(cur(true)).toContain(esc(t('en', 'settings.currency.fixed')));
    expect(cur(false, STAFF)).toContain(esc(t('en', 'staff.ownerDecides')));
    expect(cur(false)).toContain(esc(t('en', 'settings.currency.why')));
    expect(cur(false)).toContain('<form method="post" action="/app/settings/business/currency" class="set-form" data-save id="currency-form">');
  });
  it('closures: what is recorded first, then the form; each Remove names its closure; the add form unchanged', () => {
    const closures = [{ id: '00000000-0000-4000-8000-000000000001', label: 'Summer break', from: new Date(Date.UTC(2026, 7, 1)), to: new Date(Date.UTC(2026, 7, 15)) }];
    for (const l of LOCALES) {
      const html = renderHours({ workingHours: null, zone: null, closures }, l, null);
      expect(html.indexOf('class="closures"'), l).toBeLessThan(html.indexOf('action="/app/settings/closures"'));
      expect(html, l).toContain(`aria-label="${esc(t(l, 'closures.remove'))} Summer break"`);
      expect(html, l).toContain(esc(t(l, 'biz.closures.now')));
      expect(html, l).toContain(esc(t(l, 'biz.closures.add')));
      expect(html, l).toContain('action="/app/settings/closures/00000000-0000-4000-8000-000000000001/remove"');
      // the add form is its own (it adds; it is not the page's Save), with its own button named for what it does
      // its rows drawn as the Save's form draws them (one grid), so the two sections' columns line up
      expect(html, l).toContain('<form method="post" action="/app/settings/closures" class="set-form" id="add-closure">');
      // and the page's Save is its last control: the hours form comes after the Add
      expect(html.indexOf('id="add-closure"'), l).toBeLessThan(html.indexOf('id="hours-form"'));
      expect(html.slice(html.indexOf('<div class="set-save">')), l).toMatch(/^<div class="set-save">(?:(?!<form)[\s\S])*<\/div><\/form>\s*$/);
      expect(html, l).toContain(`>${esc(t(l, 'closures.add.button'))}</button>`);
    }
  });
});

describe('F35 · labels beside controls on a desk, a stack on a phone; every new line in all five', () => {
  it('the business forms are two columns from 721 px and one below, in ONE grid for every section of a page', () => {
    expect(SETTINGS_AREA_CSS).toMatch(/@media\(min-width:721px\)\{\.settings-area \.set-rows>\.setrow\{grid-template-columns:minmax\(0,5fr\) minmax\(0,6fr\)/);
    // the older second grid (2fr / 3fr), which put Hours' Add form out of line with its hours, is gone
    expect(SETTINGS_AREA_CSS).not.toContain('.biz-form');
    expect(SETTINGS_AREA_CSS).toContain('.sa-vh{position:absolute;');
  });
  it('each new key is its own language in zh, ar, es and fr', () => {
    const keys = ['biz.scopeNote', 'biz.save.business', 'biz.save.contact', 'biz.save.zone', 'biz.save.zoneOnly', 'biz.save.currencyOnly',
      'biz.save.kind', 'biz.now.hours', 'biz.now.currency', 'biz.closures.now', 'biz.closures.add'] as MessageKey[];
    for (const k of keys) for (const l of LOCALES) if (l !== 'en') expect(t(l, k), `${l} ${k}`).not.toBe(t('en', k));
  });
});
