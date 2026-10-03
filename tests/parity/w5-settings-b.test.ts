import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import { renderTerms, incotermOptions } from '../../src/api/web/settings.js';
import { validateTradeTerms } from '../../src/core/commerce/terms.js';
import { parseAnswer, linesFor, type SellingState } from '../../src/core/owner/howYouSell.js';
import { renderQuestion, renderConfirm, type QuestionView } from '../../src/api/web/howYouSell.js';
import { CATALOGUE_QUESTIONS } from '../../src/core/owner/howYouSell.js';
import { profileOf } from '../../src/core/owner/sellingStyle.js';
import { guardClaims } from '../../src/core/safety/claims.js';

/**
 * THE WARMTH RUN, phase 9 — the fix wave for Who works here, the business
 * profile, the rate, samples and terms, and the outreach area (contacts,
 * finding customers, first e-mails): the merged list's findings
 * (docs/UI-AUDIT.md §9), each held here.
 */

const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-03T10:00:00Z');

// ── V1-537 · payment terms without a delivery term ─────────────────────────
const terms = (l: Locale, stated: { incoterm: string | null } | null = null) =>
  renderTerms({ terms: stated ? { paymentTerms: 'Cash when you collect', incoterm: stated.incoterm, statedAt: NOW } : null }, l, null);
const selectOf = (html: string): string => html.slice(html.indexOf('<select id="tm-incoterm"'), html.indexOf('</select>', html.indexOf('<select id="tm-incoterm"')));

describe('V1-537 · how customers pay can be saved without a delivery term', () => {
  it('the delivery term is not required, and its first choice is none at all, in every locale', () => {
    for (const l of LOCALES) {
      const sel = selectOf(terms(l));
      expect(sel, l).not.toContain(' required');
      expect(sel, l).not.toContain('disabled');
      expect(sel.indexOf(`<option value="" selected>${esc(t(l, 'terms.incoterm.none'))}</option>`), l).toBeGreaterThan(0);
      // The hint says when none is needed.
      expect(terms(l), l).toContain(esc(t(l, 'terms.incoterm.hint', { name: 'Lily' }).slice(0, 30)));
    }
  });
  it('payment terms stated alone say so, and that no proforma follows; no code is chosen for the owner', () => {
    for (const l of LOCALES) {
      const html = terms(l, { incoterm: null });
      expect(html, l).toContain('<p class="stated-now"><bdi>Cash when you collect</bdi></p>');
      expect(html, l).toContain(`<p class="muted">${esc(t(l, 'terms.stated.noIncoterm'))}</p>`);
      expect(selectOf(html), l).toContain('<option value="" selected>');
      expect(selectOf(html), l).not.toMatch(/<option value="[A-Z]+" selected>/);
    }
  });
  it('with a term stated, that term is chosen, as before', () => {
    expect(selectOf(terms('en', { incoterm: 'FOB' }))).toContain('<option value="FOB" selected>');
    expect(selectOf(terms('en', { incoterm: 'FOB' }))).toContain('<option value="">No delivery term</option>');
  });
  it('a form sent back keeps the owner\'s choice of none', () => {
    const kept = { values: { payment: '', incoterm: '' }, field: 'payment', text: 'x' };
    const html = renderTerms({ terms: { paymentTerms: 'T/T', incoterm: 'CIF', statedAt: NOW } }, 'en', null, undefined, kept);
    expect(selectOf(html)).toContain('<option value="" selected>');
    expect(selectOf(html)).not.toContain('<option value="CIF" selected>');
  });
  it('the validator: empty is null, a code is checked, payment is still required', () => {
    expect(validateTradeTerms({ payment: 'T/T', incoterm: '', now: NOW })).toEqual({ ok: true, value: { paymentTerms: 'T/T', incoterm: null, statedAt: NOW } });
    expect(validateTradeTerms({ payment: '', incoterm: '', now: NOW })).toEqual({ ok: false, error: 'payment_missing' });
    expect(validateTradeTerms({ payment: 'T/T', incoterm: 'XYZ', now: NOW })).toEqual({ ok: false, error: 'incoterm_invalid' });
  });
  it('nothing a customer is sent changes: no delivery term allows none to be said, and no proforma is made without one', () => {
    // The two writers allow an Incoterm claim only when one was chosen.
    for (const [file, guard] of [['src/api/web/settings.ts', 'if (v.value.incoterm !== null) {'], ['src/db/howYouSell.ts', 'if (l.incoterm !== null) {']] as const) {
      const src = read(file);
      const at = src.indexOf(guard);
      expect(at, file).toBeGreaterThan(0);
      expect(src.indexOf("'incoterm', ${", at) - at, file).toBeLessThan(400);
    }
    // With no Incoterm allowed, a reply that names one is refused — default-deny, as with no terms.
    expect(guardClaims({ reply: 'We ship FOB Ningbo.', policy: [] }).ok).toBe(false);
    // The proforma still needs a delivery term (proformaText), so none is made.
    expect(read('src/api/web/orders.ts')).toContain('if (!unitPrice || !total || !v.paymentTerms || !v.incoterm) return null;');
  });
  it('the column may be null: a pending migration says so, for the driver to number', () => {
    const sql = read('migrations/PENDING-trade-terms-no-delivery-term.sql').split('\n').filter((x) => !x.trimStart().startsWith('--')).join('\n');
    expect(sql).toContain('alter table trade_terms alter column incoterm drop not null;');
  });

  // How you sell's payment question for a maker writes the same terms.
  const STATE: SellingState = { quantityFirst: false, products: [], allowed: new Set(), terms: null, workingHours: null, closures: [], words: new Set(), told: {} };
  const MAKER = { profile: profileOf('manufacturer'), pricesToOwner: false };
  const view = (over: Partial<QuestionView> = {}): QuestionView => ({
    facts: { kind: 'manufacturer', profile: profileOf('manufacturer'), pricesToOwner: false, zone: 'UTC' } as QuestionView['facts'],
    order: CATALOGUE_QUESTIONS, progress: {}, q: 'payment', state: STATE, ...over,
  });
  it('How you sell: none first, an answer with none read as null, and its line says "No delivery term"', () => {
    for (const l of LOCALES) {
      expect(renderQuestion(view(), l, null), l).toContain(incotermOptions(l, null));
    }
    const r = parseAnswer('payment', { payment: 'Cash when you collect', incoterm: '' }, MAKER);
    expect(r).toEqual({ ok: true, answer: { q: 'payment', told: '', terms: { payment: 'Cash when you collect', incoterm: null } } });
    if (!r.ok) return;
    expect(linesFor(r.answer, STATE)).toEqual([{ key: 'terms', kind: 'terms', payment: 'Cash when you collect', incoterm: null }]);
    const confirm = renderConfirm(view({ progress: { payment: { state: 'draft', answer: r.answer } } }), 'en', null)!;
    expect(confirm).toContain('<bdi>Cash when you collect</bdi> · <bdi>No delivery term</bdi>');
  });
});

// ── Business profile ───────────────────────────────────────────────────────
import { renderProfile, type BusinessProfile } from '../../src/api/web/settings.js';
import { zoneKept, zoneCity } from '../../src/core/owner/zones.js';

const bare: BusinessProfile = { name: 'Shop', description: null, location: null, workingHours: null, contactEmail: null, contactPhone: null, languagesServed: [] };
const profile = (l: Locale, p: BusinessProfile = bare, zone = 'Asia/Shanghai', country: string | null = null) =>
  renderProfile(p, l, null, {}, {}, { zone, country }, { currency: 'USD', fixed: true });
const zoneOptions = (html: string) => {
  const at = html.indexOf('<select id="pf-zone"');
  return [...html.slice(at, html.indexOf('</select>', at)).matchAll(/<option value="([^"]+)"([^>]*)>([^<]*)<\/option>/g)]
    .map((m) => ({ z: m[1]!, selected: m[2]!.includes('selected'), label: m[3]! }));
};

describe('w4-settings-b-outreach-06, -08 · either contact detail is enough, and each field says so', () => {
  it('with neither, the e-mail says "this or the phone" and the phone "this or the e-mail" — never both "needed"', () => {
    for (const l of LOCALES) {
      const html = profile(l);
      const row = (id: string) => html.slice(html.lastIndexOf('<div class="setrow', html.indexOf(`for="${id}"`)), html.indexOf('</div></div>', html.indexOf(`id="${id}"`)));
      expect(row('pf-contact_email'), l).toContain(`<span class="fr-need">${esc(t(l, 'settings.profile.needOrPhone'))}</span>`);
      expect(row('pf-contact_phone'), l).toContain(`<span class="fr-need">${esc(t(l, 'settings.profile.needOrEmail'))}</span>`);
      expect(row('pf-contact_email'), l).not.toContain(esc(t(l, 'settings.profile.need')) + '<');
    }
  });
  it('one of them given, neither is marked', () => {
    for (const l of LOCALES) expect(profile(l, { ...bare, contactPhone: '+971500000000' }), l).not.toContain(esc(t(l, 'settings.profile.needOrPhone')));
  });
  it('English writes "e-mail" one way on the page', () => {
    expect(t('en', 'settings.field.contactEmail')).toBe('Contact e-mail');
    expect(profile('en').replace(/<[^>]*>/g, ' ')).not.toMatch(/\b[Ee]mail\b/);   // the words, not the field's name
  });
});

describe('V1-006 (part: categories), V1-525, w4-settings-b-outreach-07 · what the business sells, in the owner\'s words, with a door that leads there', () => {
  it('How you sell\'s answer, named in the owner\'s language, and the door to that very question', () => {
    for (const l of LOCALES) {
      const html = profile(l, { ...bare, whatYouSell: { category: 'cosmetics' } });
      expect(html, l).toContain(esc(t(l, 'settings.field.whatYouSell')));
      expect(html, l).toContain(`<span class="fr-value">${esc(t(l, 'hs.category.cosmetics'))}</span>`);
      expect(html, l).toContain(`href="/app/business/selling/product_claims"`);
      expect(html, l).not.toContain('href="/app/products"');
    }
  });
  it('not answered yet says so; a business How you sell does not ask draws no row; no raw code anywhere', () => {
    expect(profile('zh', { ...bare, whatYouSell: { category: null } })).toContain(esc(t('zh', 'setup.state.notAnswered')));
    expect(profile('en', bare)).not.toContain(esc(t('en', 'settings.field.whatYouSell')));
    // The catalogue no longer carries the old line that sent the owner to a product page.
    expect(read('src/core/owner/i18n/messages.ts')).not.toContain("'settings.categories.from'");
    expect(read('src/api/web/settings.ts')).not.toContain('select distinct category from products');
  });
});

describe('V1-522, w4-settings-b-outreach-09, -10 · the zone list in the owner\'s language, each zone by the time it keeps now', () => {
  it('no English city in Chinese or Arabic, and no country named twice, in the whole list', () => {
    for (const l of LOCALES) {
      const opts = zoneOptions(profile(l));
      expect(opts.length, l).toBeGreaterThan(250);
      if (l === 'zh' || l === 'ar') expect(opts.filter((o) => /[A-Za-z]{2,}/.test(o.label)).map((o) => o.label), l).toEqual([]);
      expect(opts.filter((o) => /\([^)]*, [^)]*\)|（[^）]*，[^）]*）/.test(o.label)).map((o) => o.label), l).toEqual([]);
      const labels = opts.map((o) => o.label);
      expect(labels.filter((x, i) => labels.indexOf(x) !== i), `${l}: two choices read the same`).toEqual([]);
    }
  });
  it('zones of a country that keep the same clock all year are one choice; the workspace\'s own zone stays chosen', () => {
    const ar = zoneOptions(profile('en', bare, 'America/Argentina/Buenos_Aires', 'AR'));
    expect(ar.map((o) => o.z)).toEqual(['America/Argentina/Buenos_Aires']);
    const knox = zoneOptions(profile('en', bare, 'America/Indiana/Knox', 'US'));
    expect(knox.find((o) => o.selected)?.z).toBe('America/Indiana/Knox');
    expect(knox.map((o) => o.z)).not.toContain('America/Chicago');   // the same clock: Knox stands for it here
    expect(zoneOptions(profile('en', bare, 'America/New_York', 'US')).map((o) => o.z)).toContain('America/Chicago');
    expect(zoneOptions(profile('zh')).map((o) => o.z)).not.toContain('America/Argentina/Cordoba');
  });
  it('Lord Howe and Galápagos are named by the time they keep today, not by Sydney\'s and Ecuador\'s in 1970', () => {
    expect(zoneKept('en', 'Australia/Lord_Howe')).toBe('Lord Howe Time');
    expect(zoneKept('en', 'Pacific/Galapagos')).toBe('Galapagos Time');
    expect(zoneKept('zh', 'Australia/Lord_Howe')).not.toBe(zoneKept('zh', 'Australia/Sydney'));
  });
  it('French never falls back to "heure : …"; a city reads in the owner\'s language where this build names it', () => {
    expect(zoneOptions(profile('fr')).filter((o) => o.label.includes('heure :')).map((o) => o.label)).toEqual([]);
    expect(zoneCity('zh', 'America/Argentina/Cordoba')).toBe('科尔多瓦');
    expect(zoneCity('ar', 'America/Argentina/Cordoba')).toBe('كوردوبا');
    expect(zoneCity('zh', 'Europe/Madrid')).toBeNull();   // Spain's own: the country says it
  });
});
