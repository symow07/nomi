import { describe, it, expect } from 'vitest';
import { renderProfile, type BusinessProfile } from '../../src/api/web/settings.js';
import { saveActs } from '../../src/api/web/settingsPage.js';
import { renderProductDetail, type ProductDetail, type ProductListItem } from '../../src/api/web/products.js';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { esc, shell } from '../../src/api/web/layout.js';
import { OWNER_VIEW, type Viewer } from '../../src/core/conversation/people.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { messages, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { t } from '../../src/api/web/say.js';
import { usd } from '../../src/core/types/money.js';
import { withoutIsolates } from './isolates.js';
import { linkedCss } from './linked-css.js';

// (Rule 104 replaced this on the Business profile: see the note above its tests. A product's change folds keep it.)
// UI correction, Block 9 — F10 "Read, create and edit are mixed". On the records earlier blocks did not cover (Business
// profile's parts, the business's type, country and website, the legal identifiers, a product's change folds): a part
// reads first — a short list of its values, with "Not given yet" where one is missing — and its form opens on purpose,
// behind its own "Change …" fold, with its own Save and a Cancel beside it. A fold is open at rest only while its part
// still needs something for setting up, or after a refused save of it. Cancel puts the form back and closes the fold;
// Escape closes it with the words kept; both return focus to the fold's summary (liveScript's editFolds()). Measured in
// a browser by the harness's f10probe.mjs (base fails 30/30, head passes); this file holds the markup and the script.

// RULE 104 (the settings overhaul, the owner, 2026-11-27) replaces F10 ON THE BUSINESS PROFILE: every field is on the
// page, always, in sections, with the page's ONE Save and its Cancel at the end. A part no longer reads first behind a
// "Change …" fold (the fold hid fields; one Save cannot save a form the owner cannot see). What F10 protected there is
// held the new way: a value that is missing is marked where it is missing ("Needed"), a refused save keeps what was
// typed and marks the one field, and nothing is saved by a second button. F10 itself still holds on a product (below).
const full: BusinessProfile = {
  name: 'Juniper Skin', description: 'Skin care made in small batches.', location: 'Lisbon', workingHours: 'Mon–Fri 9–18',
  contactEmail: 'hello@juniper.test', contactPhone: '+351210000000', languagesServed: ['en', 'pt'],
  identifiers: { ice: null, taxId: null, rc: null, rcCourt: null },
} as BusinessProfile;
const KIND = { kind: 'retail', country: 'US', website: 'shop.example' };
const draw = (p: BusinessProfile, l: Locale = 'en', o: { errors?: Record<string, string>; viewer?: Viewer; kind?: typeof KIND | { kind: null; country: string; website: string } } = {}) =>
  withoutIsolates(renderProfile(p, l, null, {}, (o.errors ?? {}) as never, null, null, o.viewer ?? OWNER_VIEW, {}, { view: o.kind ?? KIND }));
const sections = (html: string) => [...html.matchAll(/<section class="set-sec" id="([^"]+)">([\s\S]*?)<\/section>/g)]
  .map((m) => ({ id: m[1]!, body: m[2]! }));
const CANCEL = (l: Locale) => `<button class="btn ghost" type="button" data-edit-cancel hidden>${esc(t(l, 'common.cancel'))}</button>`;
const NEEDED = (l: Locale) => `<span class="set-need">${esc(t(l, 'set.needed'))}</span>`;

describe('rule 104 · Business profile: every field on the page, one Save', () => {
  it('the sections, each with its fields drawn (no fold), inside the page\'s one form, in every language', () => {
    for (const l of LOCALES) {
      const html = draw(full, l);
      expect(sections(html).map((s) => s.id), l).toEqual(['about', 'contact', 'identifiers', 'business-kind']);
      expect(html, l).not.toContain('<details');
      expect(html, l).not.toContain('<dl class="ef-sum">');
      // ONE form, ONE Save, its Cancel beside it, at the end of the form
      expect(html.match(/<form\b/g)?.length, l).toBe(1);
      expect(html, l).toContain('<form method="post" action="/app/settings/business/profile" class="set-form" data-save id="profile-form">');
      expect(html.match(/type="submit"/g)?.length, l).toBe(1);
      expect(html, l).toContain(`${saveActs(l)}</form>`);
      // the stored values are in their fields
      expect(html, l).toContain('<input id="pf-name" name="name" value="Juniper Skin" />');
      expect(html, l).toContain('<input id="pf-location" name="location" value="Lisbon" />');
      expect(html, l).toContain('name="contact_email" value="hello@juniper.test"');
      expect(html, l).toContain('>Skin care made in small batches.</textarea>');
      expect(html, l).toMatch(/name="lang_en" checked/);
      expect(html, l).toMatch(/name="lang_pt" checked/);
      // with nothing missing, nothing is marked and the "to finish setting up" line is not drawn
      expect(html, l).not.toContain('class="set-need"');
      expect(html, l).not.toContain('id="profile-needs"');
    }
  });
  it('what setting up still needs is marked on its own field, and said once at the top', () => {
    for (const l of LOCALES) {
      const missing = draw({ ...full, description: null, location: null, contactEmail: null, contactPhone: null } as BusinessProfile, l);
      expect(missing, l).toContain(`<p class="set-note" id="profile-needs"><span>${esc(t(l, 'settings.profile.needs'))}</span></p>`);
      expect(missing, l).toContain(`for="pf-description">${esc(t(l, 'settings.field.description'))} ${NEEDED(l)}</label>`);
      expect(missing, l).toContain(`for="pf-location">${esc(t(l, 'settings.field.location'))} ${NEEDED(l)}</label>`);
      // either way of being reached finishes the step, and each field says so
      expect(missing, l).toContain(`<span class="set-need">${esc(t(l, 'ws.profile.orPhone'))}</span>`);
      expect(missing, l).toContain(`<span class="set-need">${esc(t(l, 'ws.profile.orEmail'))}</span>`);
      expect(missing.match(/class="set-need"/g)?.length, l).toBe(4);
    }
  });
  it('a refused save marks the one field that was wrong, on the same page', () => {
    const refused = draw(full, 'en', { errors: { contactEmail: 'emailShape' } });
    expect(refused.match(/class="setrow bad"/g)?.length).toBe(1);
    expect(refused).toContain(`<span class="fielderr" role="alert">${esc(t('en', 'settings.err.emailShape'))}</span>`);
  });
  it('the languages served are named in their own language, each isolated', () => {
    for (const l of LOCALES) {
      const html = draw(full, l);
      expect(html, l).toContain('<bdi lang="en">English</bdi>');
      expect(html, l).toContain('<bdi lang="pt">Português</bdi>');
      expect(html, l).toContain('<bdi lang="ar">العربية</bdi>');
    }
  });
  it('working hours, the time zone and the currency have ONE home each: named here, with their doors, and no field', () => {
    for (const l of LOCALES) {
      const html = draw(full, l);
      expect(html, l).not.toMatch(/name="(working_hours|zone|currency)"/);
      expect(html, l).toContain(`<a href="/app/settings/business/hours">${esc(t(l, 'settingsArea.hours'))}</a>`);
      expect(html, l).toContain(`<a href="/app/settings/business/currency">${esc(t(l, 'settingsArea.currency'))}</a>`);
    }
  });
  it('the type, country and website are fields of the same form; the country as its list names it', () => {
    for (const l of LOCALES) {
      const html = draw(full, l);
      const part = sections(html).find((s) => s.id === 'business-kind')!.body;
      expect(part, l).toContain('<option value="retail" selected>');
      const name = new Intl.DisplayNames([l === 'zh' ? 'zh-Hans' : l], { type: 'region' }).of('US')!;
      expect(part, l).toContain(`<option value="US" selected>${esc(name)}</option>`);
      expect(part, l).toContain('name="website" value="shop.example"');
      // not answered yet: the list starts on "choose", nothing is pre-chosen for the owner
      const open = sections(draw(full, l, { kind: { kind: null, country: 'US', website: '' } })).find((s) => s.id === 'business-kind')!.body;
      expect(open.slice(open.indexOf('id="bk-kind"'), open.indexOf('</select>')), l).not.toContain(' selected');
    }
  });
});

const item: ProductListItem = { id: '11111111-1111-4111-8111-111111111111', name: 'Canvas tote', nameZh: null, sku: 'TOTE', unit: 'item', moq: null, entryQty: 1, entryPrice: usd('20'), learned: true, status: 'learned', imageMatchable: true, isActive: true };
const detail: ProductDetail = { ...item, currency: 'USD', category: null, customizable: false, leadTimeDays: null, tiers: [{ minQty: 1, maxQty: null, unitPrice: usd('20') }], aliases: ['Canvas tote', 'shop tote'], images: [], recentQuotes: [], businessKind: 'retail' };

describe('F10 · a product\'s change folds each carry a Cancel beside their Save', () => {
  it('every change fold is an edit fold, closed at rest, with one Cancel', () => {
    for (const l of LOCALES) {
      const html = renderProductDetail(detail, l, null, {}, {}, OWNER_VIEW, new Date('2026-11-06T09:00:00Z'));
      // the prices fold holds a nested fold of its own (the optional fields), so each change fold is read from its
      // opening tag to the next one's
      const folds = html.split('<details class="pd-change"').slice(1);
      expect(folds.length, l).toBe(4);
      for (const f of folds) {
        expect(f.slice(0, f.indexOf('>')), l).toBe(' data-edit');
        expect(f.split(CANCEL(l)).length - 1, l).toBe(1);
      }
      expect(html.split(CANCEL(l)).length - 1, l).toBe(4);
    }
  });
});

describe('F10 · the shared behaviour and its words', () => {
  it('liveScript: Cancel resets the form and closes the fold; Escape closes it; focus goes back to its summary', () => {
    expect(LIVE_SCRIPT).toContain('function editFolds()');
    expect(LIVE_SCRIPT).toMatch(/\[data-edit-cancel\]'\)\.forEach\(function \(b\) \{ b\.hidden = false; \}\)/);
    expect(LIVE_SCRIPT).toContain('.form.reset()');
    expect(LIVE_SCRIPT).toContain("e.key === 'Escape'");
    expect(LIVE_SCRIPT).toContain('details[data-edit][open]');
    expect(LIVE_SCRIPT).toContain(':scope > details[data-edit]');
    expect(LIVE_SCRIPT).toMatch(/editFolds\(\);/);
  });
  it('the summary and the fold are styled from tokens, and a phone stacks the summary', () => {
    const css = linkedCss(shell({ title: 'T', active: 'settings', locale: 'en', path: '/app/settings/business/profile', bodyHtml: '' }));
    expect(css).toContain('.ef-sum{');
    expect(css).toContain('.ef-fold');
    expect(css).toMatch(/button\.btn\.ghost\[data-edit-cancel\]\{[^}]*min-height:44px/);
  });
  it('the words exist in all five catalogues and differ from one another', () => {
    const keys = ['edit.notGiven', 'edit.change.business', 'edit.change.contact', 'edit.change.zone', 'edit.change.zoneCurrency',
      'edit.change.currency', 'edit.change.kind', 'edit.change.ids'] as MessageKey[];
    for (const k of keys) expect(Object.keys(messages.en), k).toContain(k);
    for (const l of LOCALES) {
      const said = keys.map((k) => t(l, k));
      expect(new Set(said).size, l).toBe(keys.length);
      if (l !== 'en') for (const k of keys) expect(t(l, k), `${l} ${k}`).not.toBe(t('en', k));
    }
  });
});
