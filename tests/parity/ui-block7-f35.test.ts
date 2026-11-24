import { describe, it, expect } from 'vitest';
import { renderProfile, settingsProfileValue, renderClosures, type BusinessProfile } from '../../src/api/web/settings.js';
import { renderBusinessKind } from '../../src/api/web/businessKind.js';
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
 * UI Block 7 · F35 — Business settings. The profile is three subjects, each its own form with its own Save that says
 * what it saves; the route (POST /app/settings, unchanged) still saves the whole profile, so every form carries every
 * field it needs — the others hidden — and never blanks one. Hours, the zone and the currency are shown in the profile's
 * own row pattern, by their names, and a value that cannot change here says why (rules 41, 42). Closures: what is
 * recorded first, then the form that adds more. Labels sit beside their controls on a desk; a phone stacks them.
 */

const STAFF: Viewer = { ...OWNER_VIEW, isOwner: false } as Viewer;
const p: BusinessProfile = {
  name: 'Juniper Skin', description: 'Skin care made in small batches.', location: 'Lisbon', workingHours: 'Mon–Fri 9–18',
  contactEmail: 'hello@juniper.test', contactPhone: '+351210000000', languagesServed: ['en', 'pt'],
} as BusinessProfile;
const draw = (l: Locale, opts: { fixed?: boolean; viewer?: Viewer; zone?: boolean } = {}) =>
  withoutIsolates(renderProfile(p, l, null, {}, {}, opts.zone === false ? null : { zone: 'Europe/Lisbon', country: 'PT' },
    { currency: 'EUR', fixed: opts.fixed ?? false }, opts.viewer ?? OWNER_VIEW));
const forms = (html: string) => [...html.matchAll(/<form method="post" action="\/app\/settings" class="sform biz-form">([\s\S]*?)<\/form>/g)].map((m) => m[1]!);
const names = (f: string, hidden: boolean) =>
  [...f.matchAll(/<(input|select|textarea)\b([^>]*)>/g)].filter((m) => (m[2]!.includes('type="hidden"')) === hidden)
    .map((m) => /name="([^"]+)"/.exec(m[2]!)?.[1]).filter((n): n is string => !!n);
const acts = (f: string) => [...f.matchAll(/<div class="fr-acts"><button class="btn send" type="submit">([^<]+)<\/button><\/div>/g)].map((m) => m[1]!);
const PROFILE = ['name', 'description', 'location', 'working_hours', 'contact_email', 'contact_phone'];

describe('F35 · the profile is three subjects, each saved by its own Save', () => {
  it('three forms, one Save each, inside its own card, saying what it saves — in every language', () => {
    for (const l of LOCALES) {
      const html = draw(l);
      const fs = forms(html);
      expect(fs.length, l).toBe(3);
      expect(html, l).not.toContain('class="savebar"');
      expect(fs.map(acts), l).toEqual([[esc(t(l, 'biz.save.business'))], [esc(t(l, 'biz.save.contact'))], [esc(t(l, 'biz.save.zone'))]]);
      expect(html, l).toContain(esc(t(l, 'biz.scopeNote')));
    }
  });
  it('each field is shown in exactly one subject; every form carries the whole profile, so no Save blanks another', () => {
    const fs = forms(draw('en'));
    const shown = fs.map((f) => names(f, false));
    expect(shown[0]).toEqual(expect.arrayContaining(['name', 'description', 'location', 'working_hours', 'lang_en', 'lang_pt']));
    expect(shown[1]).toEqual(['contact_email', 'contact_phone', 'postal_address']);
    expect(shown[2]).toEqual(['zone', 'currency']);
    expect(shown.flat().length).toBe(new Set(shown.flat()).size);
    for (const f of fs) {
      const all = [...names(f, false), ...names(f, true)];
      for (const n of PROFILE) expect(all, n).toContain(n);
      // the languages served are carried too (an absent box is an unticked one)
      expect(all).toEqual(expect.arrayContaining(['lang_en', 'lang_pt']));
      expect(names(f, true)).not.toContain('lang_fr');
    }
    // The address, the zone and the currency ride only with their own subject: the route leaves each as it is otherwise.
    for (const [i, own] of [[1, 'postal_address'], [2, 'zone'], [2, 'currency']] as const) {
      fs.forEach((f, j) => { if (j !== i) expect([...names(f, false), ...names(f, true)], `${own} in ${j}`).not.toContain(own); });
    }
    // The hidden values are the stored ones.
    expect(fs[1]).toContain('<input type="hidden" name="description" value="Skin care made in small batches." />');
    expect(fs[0]).toContain('<input type="hidden" name="contact_email" value="hello@juniper.test" />');
  });
  it('rule 42 kept: a fixed currency and a staff member get no currency choice; the zone Save then says only the zone', () => {
    for (const html of [draw('en', { fixed: true }), draw('en', { viewer: STAFF })]) {
      expect(html).not.toContain('name="currency"');
      expect(acts(forms(html)[2]!)).toEqual([esc(t('en', 'biz.save.zoneOnly'))]);
    }
    expect(draw('en', { fixed: true })).toContain(esc(t('en', 'settings.currency.fixed')));
    expect(draw('en', { viewer: STAFF })).toContain(esc(t('en', 'staff.ownerDecides')));
    // nothing to save in it: no Save at all
    const none = draw('en', { fixed: true, zone: false });
    expect(forms(none).length).toBe(3);
    expect(acts(forms(none)[2]!)).toEqual([]);
  });
  it('the type, country and website on the profile: its own Save in its own card, saying what it saves', () => {
    const v = { kind: null, country: 'PT', website: '' };
    for (const l of LOCALES) {
      const on = renderBusinessKind(v, l, null, 'x', null, true);
      expect(on, l).toContain(`<div class="fr-acts"><button class="btn send" type="submit">${esc(t(l, 'biz.save.kind'))}</button></div></div></section>`);
      expect(on, l).not.toContain('class="savebar"');
      expect(renderBusinessKind(v, l, null, 'x'), l).toContain(`<div class="savebar"><button class="btn send" type="submit">${esc(t(l, 'business.kind.save'))}</button>`);
    }
  });
});

describe('F35 · hours, zone and currency in the same row pattern, by their names, read-only states explained', () => {
  const hours = (l: Locale) => withoutIsolates(settingsProfileValue(l, 'hours', p, { zone: 'Asia/Shanghai', country: 'CN' }, null));
  const cur = (fixed: boolean, viewer: Viewer = OWNER_VIEW) =>
    withoutIsolates(settingsProfileValue('en', 'currency', p, null, { currency: 'EUR', fixed }, viewer));
  it('the zone by its name in the owner\'s language, never its raw name; the currency by its name, not its code', () => {
    for (const l of LOCALES) {
      const html = hours(l);
      expect(html, l).toContain(esc(zoneLabel(l, 'Asia/Shanghai')));
      expect(html, l).not.toContain('Asia/Shanghai');
      expect(html, l).toContain('class="setrow"');
      expect(html.match(/settings\/business\/profile#/g)?.length, l).toBe(1);
    }
    expect(cur(false)).toContain(esc(currencyLabel('en', 'EUR')));
  });
  it('a fixed currency says why and offers no door; staff are told who decides; the owner gets the door', () => {
    expect(cur(true)).toContain(esc(t('en', 'settings.currency.fixed')));
    expect(cur(true)).not.toContain('/app/settings/business/profile#zone');
    expect(cur(false, STAFF)).toContain(esc(t('en', 'staff.ownerDecides')));
    expect(cur(false, STAFF)).not.toContain('/app/settings/business/profile#zone');
    expect(cur(false)).toContain('/app/settings/business/profile#zone');
    expect(cur(false)).toContain(esc(t('en', 'settings.currency.why')));
  });
  it('closures on Settings: what is recorded first, then the form; each Remove names its closure; the add form unchanged', () => {
    const v = { closures: [{ id: '00000000-0000-4000-8000-000000000001', label: 'Summer break', from: new Date(Date.UTC(2026, 7, 1)), to: new Date(Date.UTC(2026, 7, 15)) }] };
    for (const l of LOCALES) {
      const html = renderClosures(v, l, null, null, true);
      expect(html.indexOf('class="closures"'), l).toBeLessThan(html.indexOf('action="/app/settings/closures"'));
      expect(html, l).toContain(`${esc(t(l, 'closures.remove'))}<span class="sa-vh"> <bdi>Summer break</bdi></span>`);
      expect(html, l).toContain(esc(t(l, 'biz.closures.now')));
      expect(html, l).toContain(esc(t(l, 'biz.closures.add')));
      expect(html, l).toContain('action="/app/settings/closures/00000000-0000-4000-8000-000000000001/remove"');
    }
  });
});

describe('F35 · labels beside controls on a desk, a stack on a phone; every new line in all five', () => {
  it('the business forms are two columns from 721 px and one below', () => {
    expect(SETTINGS_AREA_CSS).toMatch(/@media\(min-width:721px\)\{\.settings-area \.biz-form \.setrow\{grid-template-columns:minmax\(0,2fr\) minmax\(0,3fr\)/);
    expect(SETTINGS_AREA_CSS).toContain('.sa-vh{position:absolute;');
  });
  it('each new key is its own language in zh, ar, es and fr', () => {
    const keys = ['biz.scopeNote', 'biz.save.business', 'biz.save.contact', 'biz.save.zone', 'biz.save.zoneOnly', 'biz.save.currencyOnly',
      'biz.save.kind', 'biz.now.hours', 'biz.now.currency', 'biz.closures.now', 'biz.closures.add'] as MessageKey[];
    for (const k of keys) for (const l of LOCALES) if (l !== 'en') expect(t(l, k), `${l} ${k}`).not.toBe(t('en', k));
  });
});
