import { describe, it, expect } from 'vitest';
import {
  initialOnboardState, advanceOnboarding, activationStatus, firstConversationScript,
  ONBOARD_ORDER, ACTIVATION_TARGET_MS, YIWU_DEFAULTS, type OnboardState,
} from '../../src/core/onboard/flow.js';
import { parsePriceLines, validateExtracted } from '../../src/core/onboard/catalogImport.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { textWidth } from '../../src/core/owner/components.js';

const T0 = new Date('2026-07-18T08:00:00Z');
const mins = (m: number) => new Date(T0.getTime() + m * 60_000);

const complete = (s: OnboardState = initialOnboardState(T0)): OnboardState => {
  let x = advanceOnboarding(s, { kind: 'named', employeeName: '小雅', avatar: '👩‍💼' });
  x = advanceOnboarding(x, { kind: 'basics_confirmed' });
  x = advanceOnboarding(x, { kind: 'products_confirmed', count: 12 });
  x = advanceOnboarding(x, { kind: 'whatsapp_connected' });
  return advanceOnboarding(x, { kind: 'first_draft_approved', at: mins(7) });
};

/* ── Five steps, strict order, resumable ─────────────────────────────────── */
describe('M6 · onboarding flow', () => {
  it('walks the five steps in order to done', () => {
    expect(ONBOARD_ORDER).toHaveLength(6);
    const s = complete();
    expect(s.step).toBe('done');
    expect(s.employeeName).toBe('小雅');
    expect(s.productsImported).toBe(12);
    expect(s.whatsappConnected).toBe(true);
  });

  it('out-of-order and replayed events are no-ops (resumable, idempotent)', () => {
    const s0 = initialOnboardState(T0);
    // can't connect WhatsApp before naming the employee
    expect(advanceOnboarding(s0, { kind: 'whatsapp_connected' })).toEqual(s0);
    const done = complete();
    expect(advanceOnboarding(done, { kind: 'first_draft_approved', at: mins(99) })).toEqual(done);
  });

  it('no employee without a catalog: zero confirmed products does not advance', () => {
    let s = advanceOnboarding(initialOnboardState(T0), { kind: 'named', employeeName: '小雅', avatar: '🦊' });
    s = advanceOnboarding(s, { kind: 'basics_confirmed' });
    expect(advanceOnboarding(s, { kind: 'products_confirmed', count: 0 }).step).toBe('catalog_import');
  });

  it('Yiwu defaults are confirm-not-fill: CNY/USD, GMT+8, EXW/FOB', () => {
    expect(YIWU_DEFAULTS.currencyDomestic).toBe('CNY');
    expect(YIWU_DEFAULTS.currencyTrade).toBe('USD');
    expect(YIWU_DEFAULTS.timezone).toBe('Asia/Shanghai');
    expect([...YIWU_DEFAULTS.incoterms]).toEqual(['EXW', 'FOB']);
  });

  it('activation metric: minute-7 approval is within the 10-minute target', () => {
    expect(ACTIVATION_TARGET_MS).toBe(600_000);
    expect(activationStatus(complete())).toEqual({ activated: true, withinTarget: true, minutes: 7 });
    expect(activationStatus(initialOnboardState(T0))).toEqual({ activated: false });

    let slow = complete(initialOnboardState(new Date(T0.getTime() - 20 * 60_000)));
    expect(activationStatus(slow)).toMatchObject({ activated: true, withinTarget: false });
    void slow;
  });

  it('the simulated first buyer uses the owner\'s own product and is marked 测试', () => {
    const s = firstConversationScript('Canvas Tote Bag 38x40cm');
    expect(s.buyerMessage).toContain('Canvas Tote Bag');
    expect(s.buyerName).toContain('测试');
  });
});

/* ── Tolerant catalog import ─────────────────────────────────────────────── */
describe('M6 · tolerant catalog import', () => {
  it('parses the shapes owners actually paste', () => {
    const parsed = parsePriceLines([
      '帆布袋 1.05美元 500个起',
      'ZX-200 Thermos 500ml $2.60 MOQ 1000',
      '保温杯\t2.6\t1000',
      '随便聊两句，这行不是产品',
      '',
    ].join('\n'));
    expect(parsed[0]).toMatchObject({ sku: null, name: '帆布袋', nameZh: '帆布袋', priceUsd: 1.05, moq: 500 });
    expect(parsed[1]).toMatchObject({ priceUsd: 2.6, moq: 1000 });
    expect(parsed[1]!.name).toContain('Thermos');
    expect(parsed[2]).toMatchObject({ sku: null, name: '保温杯', priceUsd: 2.6, moq: 1000 });
  });

  it('missing price/moq is allowed — the confirm card asks, import never blocks', () => {
    const parsed = parsePriceLines('新款化妆包');
    expect(parsed[0]).toMatchObject({ sku: null, name: '新款化妆包', priceUsd: null, moq: null });
  });

  it('validation rejects duplicates and nonsense with owner-readable reasons', () => {
    const v = validateExtracted([
      { sku: null, name: '帆布袋', nameZh: '帆布袋', priceUsd: 1.05, moq: 500, unit: 'pcs' },
      { sku: null, name: '帆布袋', nameZh: '帆布袋', priceUsd: 1.05, moq: 500, unit: 'pcs' },
      { sku: null, name: '保温杯', nameZh: '保温杯', priceUsd: -3, moq: 1000, unit: 'pcs' },
      { sku: null, name: '吸管杯', nameZh: '吸管杯', priceUsd: 2, moq: 2.5, unit: 'pcs' },
    ]);
    expect(v.accepted).toHaveLength(1);
    expect(v.rejected.map((r) => r.reasonZh)).toEqual(['重复了', '价格看着不对', '起订量看着不对']);
  });
});

/*
 * M34.8 — the onboarding copy block was deleted with
 * src/core/owner/onboarding.js. The live guided onboarding is
 * api/web/onboarding.ts (M11.2), whose own header records that it re-implements
 * nothing and deep-links to the page that completes each step; its copy is in
 * the i18n catalogue and scanned there by owner-language.test.ts.
 */

describe('M22 (F-02) · product import preserves the owner’s own article number', () => {
  const one = (line: string) => parsePriceLines(line)[0]!;

  it('keeps a dash-joined article number, and out of the name', () => {
    const p = one('ZX-200 Thermos 500ml  $2.60  MOQ 1000');
    expect(p.sku).toBe('ZX-200');
    expect(p.name).not.toContain('ZX-200');
    expect(p.name).toContain('Thermos');
    expect(p.priceUsd).toBe(2.6);
    expect(p.moq).toBe(1000);
  });

  it('keeps a letters-then-digits article number', () => {
    expect(one('HX2035 Canvas tote $1.05').sku).toBe('HX2035');
    expect(one('BAG-NW-001 Non-woven bag $0.45').sku).toBe('BAG-NW-001');
  });

  it('invents nothing when the line carries no number', () => {
    expect(one('帆布袋 1.05美元 500个起').sku).toBeNull();
    expect(one('Thermos 500ml $2.60').sku).toBeNull();
  });

  it('never mistakes an ordinary word or a measurement for an article number', () => {
    // Renaming her product is worse than missing a number, so the shape has to
    // be unmistakable: letters AND digits, at the start of the line.
    expect(one('A4 paper $1.00').sku).toBeNull();          // one digit
    expect(one('A4 paper $1.00').name).toContain('A4');    // and it stays in the name
    expect(one('500ml cup $2.00').sku).toBeNull();          // leads with digits
    expect(one('Cotton tote bag $1.20').sku).toBeNull();    // no digits at all
  });

  it('a line that is only an article number keeps it as the name too', () => {
    const p = one('ZX-200  $2.60');
    expect(p.sku).toBe('ZX-200');
    expect(p.name).toBe('ZX-200');       // never nameless, never invented
  });

  it('two lines sharing an article number are one product, however differently written', () => {
    const r = validateExtracted(parsePriceLines(
      'ZX-200 Thermos $2.60\nZX-200 Thermos flask 500ml $2.60'));
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected[0]?.reason).toBe('duplicate');
  });

  it('products with no number are still deduplicated by name', () => {
    const r = validateExtracted(parsePriceLines('Canvas tote $1.05\nCanvas tote $1.05'));
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected[0]?.reason).toBe('duplicate');
  });
});
