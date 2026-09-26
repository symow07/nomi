import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import {
  renderProductList, renderProductDetail, renderAddForm, type ProductListItem, type ProductDetail,
} from '../../src/api/web/products.js';
import { renderRate, renderTerms, renderSamples } from '../../src/api/web/settings.js';
import { renderPilotReadiness, type PilotReadiness } from '../../src/api/web/pilot.js';
import { OWNER_VIEW, type Viewer } from '../../src/core/conversation/people.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * Phase 4a (CC-08) — a sales assistant is not shown a form that can only
 * refuse them. The routes are the gate (tests/integration/phase4-permissions);
 * this holds the renderers: the owner's view carries each control, the staff
 * view carries the values and "The owner decides this." in its place.
 */

const STAFF: Viewer = { isOwner: false, id: 'p-1' };
const NOW = new Date('2026-08-12T10:00:00Z');

const items: ProductListItem[] = [
  { id: 'p1', name: 'Canvas bag', nameZh: '帆布袋', sku: 'ZX-100', moq: 1000, unit: 'pcs', entryQty: 5000, entryPrice: usd(0.92), learned: true, status: 'needs_limits', imageMatchable: true, isActive: true },
];
const detail: ProductDetail = {
  id: 'p1', name: 'Canvas Tote Bag', nameZh: '帆布袋', sku: 'ZX-100', category: 'bags',
  unit: 'pcs', moq: 1000, leadTimeDays: 15, customizable: false, learned: true, status: 'learned', isActive: true, imageMatchable: true,
  tiers: [{ minQty: 500, maxQty: null, unitPrice: usd(1.05) }], aliases: [], images: [], recentQuotes: [],
};
const pilot: PilotReadiness = {
  detected: { profile: true, products: true, priceRules: false, knowledge: true, claims: false, sandbox: false, channel: false },
  attest: { backupTestedAt: null, secretsRotatedAt: null, ownerReadyAt: null, assistantNamedAt: null },
  assistantName: 'Lily', validation: { at: null, pass: null, total: null },
  backupVerifiedAt: null, readyToLaunch: false,
};

/** Each page, rendered for a viewer, and the controls only the owner may use. */
const PAGES: ReadonlyArray<readonly [string, (v: Viewer) => string, RegExp]> = [
  ['product list', (v) => renderProductList(items, 'en', null, v), /href="\/app\/(products\/add|factory\/prices)"/],
  ['product list, empty', (v) => renderProductList([], 'en', null, v), /href="\/app\/products\/add"/],
  ['product detail', (v) => renderProductDetail(detail, 'en', null, {}, {}, v), /action="\/app\/products\/p1\/edit"/],
  ['product detail, no price', (v) => renderProductDetail({ ...detail, tiers: [] }, 'en', null, {}, {}, v), /action=|href="\/app\/products\/add"/],
  ['add products', (v) => renderAddForm('en', v), /action="\/app\/products\/add\/(review|photo)"/],
  ['rate', (v) => renderRate({ current: { from: 'USD', to: 'CNY', rate: 7.15, statedAt: NOW }, previous: [] }, 'en', null, v), /action="\/app\/settings\/rate"/],
  ['terms', (v) => renderTerms({ terms: null }, 'en', null, v), /action="\/app\/settings\/terms"/],
  ['samples', (v) => renderSamples({ policy: null, waiting: [] }, 'en', null, NOW, v), /action="\/app\/settings\/samples"/],
  ['getting ready', (v) => renderPilotReadiness(pilot, 'en', null, v), /action="\/app\/onboarding\/|href="\/app\/factory\/prices"/],
];

describe('Phase 4a · staff see no form that would refuse them', () => {
  it('the owner’s view carries every control — so its absence is the viewer, not the data', () => {
    for (const [name, render, control] of PAGES) {
      expect(render(OWNER_VIEW), name).toMatch(control);
    }
  });

  it('the staff view carries none of them, and says whose decision it is', () => {
    for (const [name, render, control] of PAGES) {
      const html = render(STAFF);
      expect(html, name).not.toMatch(control);
      if (name !== 'product list') expect(html, name).toContain(t('en', 'staff.ownerDecides'));
    }
  });

  it('the values stay on the page to read', () => {
    expect(renderProductDetail(detail, 'en', null, {}, {}, STAFF)).toContain('$1.05');
    expect(renderRate({ current: { from: 'USD', to: 'CNY', rate: 7.15, statedAt: NOW }, previous: [] }, 'en', null, STAFF)).toContain('7.15');
    expect(renderProductList(items, 'en', null, STAFF)).toContain('Canvas bag');
  });

  it('the sentence exists in every locale', () => {
    for (const locale of LOCALES) {
      expect(renderAddForm(locale, STAFF)).toContain(t(locale, 'staff.ownerDecides'));
    }
  });
});
