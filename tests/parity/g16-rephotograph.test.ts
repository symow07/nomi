import { describe, it, expect } from 'vitest';
import { diffAgainstCatalogue, type CatalogueEntry } from '../../src/core/onboard/catalogDiff.js';
import { reviewImport, renderReview, renderPhotoRefusal, importFlash, type PhotoRefusal } from '../../src/api/web/products.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { formatMoney } from '../../src/core/owner/i18n/format.js';
import { esc } from '../../src/api/web/layout.js';
import { usd } from '../../src/core/types/money.js';

/**
 * G16 · M37 — re-photographing a price sheet updates what changed.
 *
 * Every imported line used to be an insert that skipped a product she already
 * had, so a new year's price sheet could not change a single price: she was
 * told the products were "already here". The Postgres walk, through the real
 * routes, is tests/integration/rephotograph.test.ts; this is the rule that sorts
 * each line, and the screen that shows it.
 */

const entry = (over: Partial<CatalogueEntry> & Pick<CatalogueEntry, 'id' | 'sku' | 'name'>): CatalogueEntry => ({
  nameZh: null, price: 1, currency: 'USD', moq: 500, floor: null, ...over,
});

const TOTE = entry({ id: 'p-tote', sku: 'ZX-100', name: 'Canvas tote', price: 1.05, moq: 500 });
const CUP = entry({ id: 'p-cup', sku: 'ZX-220', name: 'Vacuum cup', price: 2.6, moq: 1000 });
const MUG = entry({ id: 'p-mug', sku: 'NEW-k1-0', name: 'Enamel mug', nameZh: '搪瓷杯', price: 3, moq: 200 });
const CATALOGUE = [TOTE, CUP, MUG];

const lines = (text: string) => reviewImport(text).accepted;

describe('G16 · which pile each line goes in', () => {
  it('THE DONE-WHEN: one changed price is one change, and the rest are shown as agreeing', () => {
    const d = diffAgainstCatalogue(lines([
      'ZX-100 Canvas tote $0.98 MOQ 500',
      'ZX-220 Vacuum cup $2.60 MOQ 1000',
      'Enamel mug $3.00 MOQ 200',
    ].join('\n')), CATALOGUE);
    expect(d.changed.map((c) => [c.product.id, c.price, c.moq])).toEqual([['p-tote', { from: 1.05, to: 0.98 }, null]]);
    expect(d.unchanged.map((u) => u.product.id)).toEqual(['p-cup', 'p-mug']);
    expect(d.added).toEqual([]);
    expect(d.held).toEqual([]);
  });

  it('her article number decides which product a line is — not its name', () => {
    const d = diffAgainstCatalogue(lines('ZX-220 Canvas tote $5.00'), CATALOGUE);
    expect(d.changed.map((c) => c.product.id)).toEqual(['p-cup']);
    // …and an article number she does not have is a new product, even when a
    // product of hers shares the name: the number is who it is (M22).
    expect(diffAgainstCatalogue(lines('ZX-999 Canvas tote $1.05'), CATALOGUE).added.map((p) => p.sku)).toEqual(['ZX-999']);
  });

  it('with no number, her product’s name finds it — in either of its names', () => {
    const d = diffAgainstCatalogue(lines('搪瓷杯 $3.40\nenamel   MUG $3.00 MOQ 250'), CATALOGUE);
    // one product, named twice: the second line is not a second change
    expect(d.changed.map((c) => [c.product.id, c.price])).toEqual([['p-mug', { from: 3, to: 3.4 }]]);
    expect(d.held.map((h) => [h.product?.id, h.reason])).toEqual([['p-mug', 'twice_on_page']]);
  });

  it('a name two of her products share is not guessed at', () => {
    const twin = entry({ id: 'p-tote-2', sku: 'ZX-101', name: 'Canvas tote', price: 1.2 });
    const d = diffAgainstCatalogue(lines('Canvas tote $0.90'), [...CATALOGUE, twin]);
    expect(d.changed).toEqual([]);
    expect(d.added).toEqual([]);
    expect(d.held.map((h) => [h.product, h.reason])).toEqual([[null, 'matches_several']]);
  });

  it('a line never ERASES: no price keeps her price, no MOQ keeps her MOQ', () => {
    const d = diffAgainstCatalogue(lines('ZX-100 Canvas tote\nZX-220 Vacuum cup $2.75'), CATALOGUE);
    expect(d.unchanged.map((u) => u.product.id)).toEqual(['p-tote']);
    expect(d.changed.map((c) => [c.product.id, c.price, c.moq])).toEqual([['p-cup', { from: 2.6, to: 2.75 }, null]]);
  });

  it('0.45 and 0.4500 are one price — only a real difference is a change', () => {
    const d = diffAgainstCatalogue(lines('ZX-100 Canvas tote $1.0500 MOQ 500'), CATALOGUE);
    expect(d.unchanged.map((u) => u.product.id)).toEqual(['p-tote']);
  });

  it('a product with no price yet gets the page’s — as a change she confirms', () => {
    const bare = entry({ id: 'p-bare', sku: 'ZX-300', name: 'Jute bag', price: null });
    const d = diffAgainstCatalogue(lines('ZX-300 Jute bag $1.50'), [bare]);
    expect(d.changed.map((c) => c.price)).toEqual([{ from: null, to: 1.5 }]);
  });

  it('HER FLOOR STILL APPLIES — the same rule the product page refuses by', () => {
    const floored = { ...TOTE, floor: 1 };
    const below = diffAgainstCatalogue(lines('ZX-100 Canvas tote $0.95'), [floored]);
    expect(below.changed).toEqual([]);
    expect(below.held.map((h) => h.reason)).toEqual(['below_floor']);
    // at the floor is allowed, exactly as updateProduct allows it
    expect(diffAgainstCatalogue(lines('ZX-100 Canvas tote $1.00'), [floored]).changed).toHaveLength(1);
  });

  it('a product in another currency is not re-priced from a dollar line', () => {
    const yuan = { ...TOTE, currency: 'CNY' as const, price: 7.5 };
    const d = diffAgainstCatalogue(lines('ZX-100 Canvas tote $1.00'), [yuan]);
    expect(d.held.map((h) => h.reason)).toEqual(['other_currency']);
  });

  it('every line lands in exactly one pile', () => {
    const text = 'ZX-100 Canvas tote $0.98\nZX-220 Vacuum cup $2.60 MOQ 1000\nZX-777 Straw hat $4.00\nZX-100 Canvas tote $0.99';
    const accepted = lines(text);
    const d = diffAgainstCatalogue(accepted, CATALOGUE);
    expect(d.added.length + d.changed.length + d.unchanged.length + d.held.length).toBe(accepted.length);
  });
});

describe('G16 · the review shows the change, and lets her leave it out', () => {
  const text = 'ZX-100 Canvas tote $0.98 MOQ 500\nZX-220 Vacuum cup $2.60 MOQ 1000\nZX-777 Straw hat $4.00';
  const v = reviewImport(text);
  const d = diffAgainstCatalogue(v.accepted, CATALOGUE);

  it('the changed product is a tick of its own, on by default, inside the confirm form', () => {
    const html = renderReview(v, text, 'en', d);
    const form = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
    expect(form).toMatch(/<input type="checkbox" name="apply:p-tote" checked \/>/);
    expect(form.match(/name="apply:/g)).toHaveLength(1);           // only the one that changes
    expect(form).toContain(esc(t('en', 'product.review.change.price', { from: formatMoney(usd(1.05)), to: formatMoney(usd(0.98)) })));
    // the line it came from, beside it — the M37 rule, for a change too
    expect(form).toContain('ZX-100 Canvas tote $0.98 MOQ 500');
  });

  it('new, and already-as-the-page-says, are shown apart from the change', () => {
    const html = renderReview(v, text, 'en', d);
    expect(html).toContain(esc(t('en', 'product.review.addedTitle', { count: 1 })));
    expect(html).toContain(esc(t('en', 'product.review.unchangedTitle', { count: 1 })));
    expect(html).toContain('Straw hat');
  });

  it('a page that changes nothing offers nothing to confirm — and says so', () => {
    const same = 'ZX-220 Vacuum cup $2.60 MOQ 1000';
    const html = renderReview(reviewImport(same), same, 'en', diffAgainstCatalogue(reviewImport(same).accepted, CATALOGUE));
    expect(html).not.toContain('<form');
    expect(html).toContain(esc(t('en', 'product.review.nothingToChange')));
  });

  it('with only changes, the button says what it does', () => {
    const only = 'ZX-100 Canvas tote $0.98';
    const html = renderReview(reviewImport(only), only, 'en', diffAgainstCatalogue(reviewImport(only).accepted, CATALOGUE));
    expect(html).toContain(esc(t('en', 'product.review.confirmChanges')));
    expect(html).not.toContain(esc(t('en', 'product.review.confirm')));
  });

  it('a held line says why, and links to the product when there is one', () => {
    const floored = [{ ...TOTE, floor: 1 }];
    const low = 'ZX-100 Canvas tote $0.90';
    const html = renderReview(reviewImport(low), low, 'en', diffAgainstCatalogue(reviewImport(low).accepted, floored));
    expect(html).toContain(esc(t('en', 'product.review.held.below_floor')));
    expect(html).toContain('href="/app/products/p-tote"');
    // her floor is a number a buyer must never learn; the review names the rule, not the number
    expect(html).not.toContain('$1.00');
  });

  it('every pile renders in every locale, with no key left showing', () => {
    const twin = entry({ id: 'p-tote-2', sku: 'ZX-101', name: 'Canvas tote', price: 1.2 });
    const all = 'ZX-100 Canvas tote $0.98\nZX-220 Vacuum cup $2.60 MOQ 1000\nZX-777 Straw hat $4.00\nCanvas tote $0.90';
    const vv = reviewImport(all);
    const dd = diffAgainstCatalogue(vv.accepted, [TOTE, CUP, twin]);
    for (const locale of LOCALES) {
      const html = renderReview(vv, all, locale, dd);
      expect(html, locale).not.toMatch(/product\.review\.[a-z_.]+/);
      expect(html, locale).toContain(esc(t(locale, 'product.review.held.matches_several')));
    }
  });
});

describe('G16 · every line the page had is accounted for', () => {
  it('rejected lines past the first eight are counted, not cut', () => {
    // The same line twelve times: one product, eleven rejected as repeats.
    const v = reviewImport(Array.from({ length: 12 }, () => 'Straw hat $4.00').join('\n'));
    expect(v.rejected).toHaveLength(11);
    const html = renderReview(v, '', 'en');
    const block = html.slice(html.indexOf(esc(t('en', 'product.review.rejectedTitle'))));
    expect(block.match(/<div class="muted">· /g)).toHaveLength(8);
    expect(block).toContain(esc(t('en', 'activation.recipients.more', { n: 3 })));
  });
});

describe('G16 · each upload failure says what it is', () => {
  it('the three upload failures are separate sentences with a way out, in every locale', () => {
    const reasons: PhotoRefusal[] = ['too_large', 'not_a_photo', 'upload_failed'];
    for (const locale of LOCALES) {
      const said = reasons.map((r) => t(locale, `product.photo.refused.${r}`));
      expect(new Set(said).size, locale).toBe(3);
      for (const r of reasons) {
        const html = renderPhotoRefusal(r, locale);
        expect(html).toContain(esc(t(locale, `product.photo.refused.${r}`)));
        expect(html).toContain('href="/app/products/add"');
      }
    }
  });
});

describe('G16 · the flash after confirm', () => {
  it('a page that only changed prices does not announce "added 0"', () => {
    const f = importFlash('en', { added: 0, withPrice: 0, updated: 1, alreadyHere: 2, refused: 0 });
    expect(f).toBe(`${t('en', 'product.flash.updated', { n: 1 })} ${t('en', 'product.flash.alreadyHere', { n: 2 })}`);
  });

  it('a change her rules refused at the last moment is said, never folded into done', () => {
    const f = importFlash('zh', { added: 0, withPrice: 0, updated: 0, alreadyHere: 0, refused: 1 });
    expect(f).toContain(t('zh', 'product.flash.refused', { n: 1 }));
  });
});
