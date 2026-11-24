// UI Block 6 · F33 — the selling questions, one a page and compact: back and where she is (question i of n, and where
// this one stands) on one row; what is in force now; the control; Next filled and Leave for later outlined. A field a
// choice needs (the one minimum; a category's claims; the closure rows) shows only once that choice is made — every
// field stays in the form, so what is posted, read and kept is unchanged. On the confirm page each tick sits at the
// start of its fact. Nothing about what is saved moved: no line is written without its own tick (hs-how-you-sell).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CATALOGUE_QUESTIONS, SERVICE_QUESTIONS, type SellingState } from '../../src/core/owner/howYouSell.js';
import { renderQuestion, renderConfirm, type QuestionView } from '../../src/api/web/howYouSell.js';
import { profileOf } from '../../src/core/owner/sellingStyle.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import type { MessageKey } from '../../src/core/owner/i18n/messages.js';
import { withoutIsolates } from './isolates.js';

const w = (s: string) => withoutIsolates(esc(s));
const css = readFileSync(new URL('../../src/api/web/layout.ts', import.meta.url), 'utf8');
const STATE: SellingState = {
  quantityFirst: false,
  products: [{ id: 'p1', name: 'Rose lip oil', moq: null }, { id: 'p2', name: 'Silk scrunchie', moq: 2 }],
  allowed: new Set(['guarantee:refund']),
  terms: null, workingHours: null, closures: [{ label: 'Holiday', from: '2026-12-24', to: '2026-12-26' }], words: new Set(['cheap']), told: {},
};
const FACTS = { kind: 'brand' as const, profile: profileOf('brand'), pricesToOwner: false, zone: 'UTC' };
const view = (over: Partial<QuestionView> = {}): QuestionView =>
  ({ facts: FACTS, order: CATALOGUE_QUESTIONS, progress: {}, q: 'price', state: STATE, ...over }) as QuestionView;
const q = (l: Locale, over: Partial<QuestionView> = {}, errors = {}, typed: Record<string, unknown> | null = null) =>
  withoutIsolates(renderQuestion(view(over), l, null, errors, typed));

describe('UI Block 6 · F33 — the selling questions', () => {
  it('the step header: back, then where she is and where this question stands, on one row before the question', () => {
    for (const l of LOCALES) {
      const html = q(l, { q: 'minimum', progress: { minimum: { state: 'draft', answer: { q: 'minimum', mode: 'none', qty: null } } } });
      const head = html.slice(html.indexOf('<div class="dhead hs-step">'), html.indexOf('<h1'));
      expect(head, l).toContain('class="back"');
      expect(head, l).toContain(`<div class="hs-where"><p class="muted hs-pos">${w(t(l, 'hs.position', { i: '2', n: '9' }))}</p>`);
      expect(head, l).toContain(`<p class="muted hs-state">${w(t(l, 'hs.state.draft'))}</p></div></div>`);
      expect(q(l), l).toContain(`<p class="muted hs-state">${w(t(l, 'hs.state.open'))}</p>`);
    }
    for (const sel of ['.hs-step { justify-content:space-between;', '.hs-where { display:flex;']) expect(css).toContain(sel);
  });

  it('what is in force now comes before the control: the products\' minimums, closures and words already saved', () => {
    for (const l of LOCALES) {
      const min = q(l, { q: 'minimum' });
      const now = w(t(l, 'hs.now.minimum', { n: '1', total: '2' }));
      expect(min, l).toContain(`<p class="small hs-now">${now}</p>`);
      expect(min.indexOf('hs-now'), l).toBeLessThan(min.indexOf('<fieldset'));
      expect(q(l, { q: 'minimum', state: { ...STATE, products: [{ id: 'p1', name: 'A', moq: null }] } }), l)
        .toContain(`<p class="small hs-now">${w(t(l, 'hs.now.minimumNone'))}</p>`);
      const hours = q(l, { q: 'hours' });
      expect(hours.indexOf(`<p class="small hs-now">${w(t(l, 'hs.closure.already'))}`), l).toBeGreaterThan(0);
      expect(hours.indexOf('hs-now'), l).toBeLessThan(hours.indexOf('name="hours"'));
      const words = q(l, { q: 'words' });
      expect(words.indexOf(`<p class="small hs-now">${w(t(l, 'hs.words.already'))}`), l).toBeGreaterThan(0);
      expect(words.indexOf('hs-now'), l).toBeLessThan(words.indexOf('<textarea'));
    }
  });

  it('a field a choice needs shows only once it is chosen; every field stays in the form', () => {
    const min = q('en', { q: 'minimum' });
    expect(min).toMatch(/<div class="hs-min"><fieldset class="choices hs-choices">[\s\S]*<label class="fld hs-dep">[\s\S]*name="qty"[\s\S]*<\/label><\/div>/);
    const claims = q('en', { q: 'product_claims' });
    expect(claims).toContain('<fieldset class="choices hs-dep hs-cat-cosmetics">');
    expect(claims).toContain('<fieldset class="choices hs-dep hs-cat-apparel">');
    expect(claims.match(/name="attr:/g)?.length).toBeGreaterThan(4);
    expect(css).toContain('@supports selector(:has(*))');
    expect(css).toContain('.hs-min:not(:has(input[name="mode"][value="same"]:checked)) .hs-dep { display:none; }');
    expect(css).toContain('.hs-claims:has(input[name="category"][value="cosmetics"]:checked) .hs-cat-cosmetics,');
    // The closures fold: closed when none is filled; open when one is kept, typed or wrong.
    const hours = q('en', { q: 'hours' });
    expect(hours).toContain(`<details class="hs-more"><summary>${w(t('en', 'hs.closure.title'))}</summary>`);
    expect(hours.match(/name="closure\d\.(label|from|to)"/g)).toHaveLength(9);
    expect(q('en', { q: 'hours' }, {}, { 'closure1.label': 'Inventory' })).toContain('<details class="hs-more" open>');
    expect(q('en', { q: 'hours' }, { closure0: 'from_missing' })).toContain('<details class="hs-more" open>');
    expect(q('en', { q: 'hours', progress: { hours: { state: 'draft', answer: { q: 'hours', hours: '', closures: [{ label: 'X', from: '2026-12-01', to: '2026-12-02' }] } } } }))
      .toContain('<details class="hs-more" open>');
    expect(css).toMatch(/\.hs-more > summary \{ display:flex; align-items:center; min-height:44px;/);
    expect(css).toContain('.hs-more > summary:focus-visible { outline:2px solid var(--color-ink); outline-offset:2px; }');
  });

  it('Next is the one filled button; Leave for later is outlined, in both its forms', () => {
    for (const l of LOCALES) {
      const html = q(l, { q: 'returns' });
      expect(html.split('class="btn send"').length - 1, l).toBe(1);
      const none = q(l, { q: 'minimum', state: { ...STATE, products: [] } });
      expect(none, l).toContain('<form method="post" action="/app/business/selling/minimum/skip" class="hs-later"><button class="btn" type="submit">');
    }
    expect(css).toContain('.hs-acts .btn:not(.send), .hs-later .btn { background:transparent; color:var(--color-ink); border:1px solid var(--color-ink); }');
  });

  it('the services questions are the same page: header, state, Next and Later', () => {
    for (const k of ['offered', 'area', 'duration', 'next_step'] as const) {
      const html = q('en', { q: k, order: SERVICE_QUESTIONS, facts: { ...FACTS, pricesToOwner: true } });
      expect(html, k).toContain('<div class="dhead hs-step">');
      expect(html, k).toContain('<p class="muted hs-state">');
      expect(html, k).toContain('<div class="acts hs-acts">');
    }
  });

  it('on the confirm page each tick sits at the start of its fact, at the fact\'s first line', () => {
    const page = renderConfirm(view({ q: 'returns', progress: { returns: { state: 'draft', answer: { q: 'returns', offers: ['return', 'refund'], told: 'Within 14 days.' } } } }), 'en', null)!;
    expect(page).toContain('<ul class="rows hs-lines"><li class="row lines"><label class="pcheck"><input type="checkbox" name="line:');
    expect(css).toContain('.hs-lines .pcheck { align-items:flex-start;');
    expect(css).toContain('.hs-lines .pcheck input { flex:none;');
  });

  it('every new label is in all five catalogues, the French its own', () => {
    for (const k of ['hs.now.minimum', 'hs.now.minimumNone'] as MessageKey[]) {
      for (const l of LOCALES) expect(t(l, k), `${l} ${k}`).not.toBe('');
      expect(t('fr', k)).not.toBe(t('en', k));
    }
  });
});
