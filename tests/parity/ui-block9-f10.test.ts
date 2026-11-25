import { describe, it, expect } from 'vitest';
import { renderProfile, type BusinessProfile } from '../../src/api/web/settings.js';
import { renderBusinessKind } from '../../src/api/web/businessKind.js';
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

// UI correction, Block 9 — F10 "Read, create and edit are mixed". On the records earlier blocks did not cover (Business
// profile's parts, the business's type, country and website, the legal identifiers, a product's change folds): a part
// reads first — a short list of its values, with "Not given yet" where one is missing — and its form opens on purpose,
// behind its own "Change …" fold, with its own Save and a Cancel beside it. A fold is open at rest only while its part
// still needs something for setting up, or after a refused save of it. Cancel puts the form back and closes the fold;
// Escape closes it with the words kept; both return focus to the fold's summary (liveScript's editFolds()). Measured in
// a browser by the harness's f10probe.mjs (base fails 30/30, head passes); this file holds the markup and the script.

const full: BusinessProfile = {
  name: 'Juniper Skin', description: 'Skin care made in small batches.', location: 'Lisbon', workingHours: 'Mon–Fri 9–18',
  contactEmail: 'hello@juniper.test', contactPhone: '+351210000000', languagesServed: ['en', 'pt'],
  identifiers: { ice: null, taxId: null, rc: null, rcCourt: null },
} as BusinessProfile;
const draw = (p: BusinessProfile, l: Locale = 'en', o: { errors?: Record<string, string>; viewer?: Viewer; fixed?: boolean; zone?: boolean } = {}) =>
  withoutIsolates(renderProfile(p, l, null, {}, (o.errors ?? {}) as never, o.zone === false ? null : { zone: 'Europe/Lisbon', country: 'PT' },
    { currency: 'EUR', fixed: o.fixed ?? false }, o.viewer ?? OWNER_VIEW));
const sections = (html: string) => [...html.matchAll(/<section class="sgroup ef" id="([^"]+)">([\s\S]*?)<\/section>/g)]
  .map((m) => ({ id: m[1]!, body: m[2]! }));
const foldOpen = (body: string) => /<details class="ef-fold" data-edit open>/.test(body);
const CANCEL = (l: Locale) => `<button class="btn ghost" type="button" data-edit-cancel hidden>${esc(t(l, 'common.cancel'))}</button>`;

describe('F10 · a record part reads first, and its form opens on purpose', () => {
  it('Business profile: every part is a summary list above its own "Change …" fold, in every language', () => {
    for (const l of LOCALES) {
      const html = draw(full, l);
      const parts = sections(html);
      expect(parts.map((s) => s.id), l).toEqual(['about', 'contact', 'zone', 'identifiers']);
      for (const s of parts) {
        const sum = s.body.indexOf('<dl class="ef-sum">'), fold = s.body.indexOf('<details class="ef-fold" data-edit');
        expect(sum, `${l} ${s.id}`).toBeGreaterThan(-1);
        expect(fold, `${l} ${s.id}`).toBeGreaterThan(sum);
        // one form behind the fold, one Save, and the Cancel beside it
        expect(s.body.slice(fold).match(/<form\b/g)?.length, `${l} ${s.id}`).toBe(1);
        expect(s.body.match(/type="submit"/g)?.length, `${l} ${s.id}`).toBe(1);
        expect(s.body, `${l} ${s.id}`).toContain(CANCEL(l));
        expect(s.body.slice(0, fold), `${l} ${s.id}`).not.toMatch(/<(input|select|textarea)\b/);
      }
      // the summary shows the stored values; with nothing missing every fold is closed at rest
      for (const v of ['Juniper Skin', 'Lisbon', 'hello@juniper.test']) expect(html, l).toContain(v);
      expect(parts.filter((s) => foldOpen(s.body)).map((s) => s.id), l).toEqual([]);
      expect(html, l).toContain(`<summary>${esc(t(l, 'edit.change.business'))}</summary>`);
      expect(html, l).toContain(`<summary>${esc(t(l, 'edit.change.contact'))}</summary>`);
      expect(html, l).toContain(`<summary>${esc(t(l, 'edit.change.zoneCurrency'))}</summary>`);
    }
  });
  it('a fold is open at rest only while its part still needs something, or after a refused save of it', () => {
    const missing = draw({ ...full, description: null, location: null, contactEmail: null, contactPhone: null } as BusinessProfile);
    const open = sections(missing).filter((s) => foldOpen(s.body)).map((s) => s.id);
    expect(open).toEqual(['about', 'contact']);
    expect(missing).toContain(`<span class="muted">${esc(t('en', 'edit.notGiven'))}</span>`);
    const refused = draw(full, 'en', { errors: { contactEmail: 'email' } });
    expect(sections(refused).filter((s) => foldOpen(s.body)).map((s) => s.id)).toEqual(['contact']);
  });
  it('the languages served read in the locale\'s own list punctuation, each name isolated', () => {
    const ar = draw(full, 'ar');
    expect(ar).toContain('<bdi lang="en">English</bdi>، <bdi lang="pt">Português</bdi>');
    expect(draw(full, 'zh')).toContain('<bdi lang="en">English</bdi>、<bdi lang="pt">Português</bdi>');
  });
  it('a part with nothing to save has no fold and no form: its values are drawn read-only', () => {
    // the zone is not offered (none stored) and the currency is fixed: nothing in the part can be saved
    const html = draw(full, 'en', { fixed: true, zone: false });
    expect(html).toContain('<section class="sgroup" id="zone">');
    expect(sections(html).map((s) => s.id)).not.toContain('zone');
    const zonePart = html.slice(html.indexOf('<section class="sgroup" id="zone">'));
    expect(zonePart.slice(0, zonePart.indexOf('</section>'))).not.toContain('<form');
    expect(html.match(/<form method="post" action="\/app\/settings" /g)?.length).toBe(2);
  });
  it('the type, country and website read first on the profile; the country as its form\'s list names it', () => {
    for (const l of LOCALES) {
      const on = renderBusinessKind({ kind: 'retail', country: 'US', website: 'shop.example' }, l, null, 'x', null, true);
      expect(on, l).toContain('<dl class="ef-sum">');
      expect(on.indexOf('<dl class="ef-sum">'), l).toBeLessThan(on.indexOf('<details class="ef-fold" data-edit>'));
      expect(on, l).toContain(`<summary>${esc(t(l, 'edit.change.kind'))}</summary>`);
      expect(on, l).toContain(CANCEL(l));
      const name = new Intl.DisplayNames([l === 'zh' ? 'zh-Hans' : l], { type: 'region' }).of('US')!;
      expect(withoutIsolates(on), l).toContain(`<bdi>${esc(name)}</bdi>`);
      // open at rest while the kind or the country is not answered
      expect(renderBusinessKind({ kind: null, country: 'US', website: '' }, l, null, 'x', null, true), l)
        .toContain('<details class="ef-fold" data-edit open>');
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
