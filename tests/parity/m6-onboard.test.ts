import { describe, it, expect } from 'vitest';
import {
  initialOnboardState, advanceOnboarding, activationStatus, firstConversationScript,
  ONBOARD_ORDER, ACTIVATION_TARGET_MS, YIWU_DEFAULTS, type OnboardState,
} from '../../src/core/onboard/flow.js';
import { parsePriceLines, validateExtracted } from '../../src/core/onboard/catalogImport.js';
import { ONBOARD_STEP_COPY, renderCatalogConfirm, renderActivation } from '../../src/core/owner/onboarding.js';
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
    expect(parsed[0]).toMatchObject({ name: '帆布袋', nameZh: '帆布袋', priceUsd: 1.05, moq: 500 });
    expect(parsed[1]).toMatchObject({ priceUsd: 2.6, moq: 1000 });
    expect(parsed[1]!.name).toContain('Thermos');
    expect(parsed[2]).toMatchObject({ name: '保温杯', priceUsd: 2.6, moq: 1000 });
  });

  it('missing price/moq is allowed — the confirm card asks, import never blocks', () => {
    const parsed = parsePriceLines('新款化妆包');
    expect(parsed[0]).toMatchObject({ name: '新款化妆包', priceUsd: null, moq: null });
  });

  it('validation rejects duplicates and nonsense with owner-readable reasons', () => {
    const v = validateExtracted([
      { name: '帆布袋', nameZh: '帆布袋', priceUsd: 1.05, moq: 500, unit: 'pcs' },
      { name: '帆布袋', nameZh: '帆布袋', priceUsd: 1.05, moq: 500, unit: 'pcs' },
      { name: '保温杯', nameZh: '保温杯', priceUsd: -3, moq: 1000, unit: 'pcs' },
      { name: '吸管杯', nameZh: '吸管杯', priceUsd: 2, moq: 2.5, unit: 'pcs' },
    ]);
    expect(v.accepted).toHaveLength(1);
    expect(v.rejected.map((r) => r.reasonZh)).toEqual(['重复了', '价格看着不对', '起订量看着不对']);
  });
});

/* ── Onboarding surfaces ─────────────────────────────────────────────────── */
describe('M6 · onboarding copy', () => {
  const confirmCard = renderCatalogConfirm(validateExtracted([
    { name: '帆布袋', nameZh: '帆布袋', priceUsd: 1.05, moq: 500, unit: 'pcs' },
    { name: '保温杯', nameZh: '保温杯', priceUsd: null, moq: null, unit: 'pcs' },
    { name: 'x', nameZh: null, priceUsd: 1, moq: 1, unit: 'pcs' },
  ]), '小雅');
  const activation = renderActivation('小雅', 7);
  const stepCopy = Object.values(ONBOARD_STEP_COPY).map((s) => `${s.title}\n${s.prompt}`).join('\n');

  it('confirm card proposes, never silently saves', () => {
    expect(confirmCard).toContain('小雅认出了 2 个产品');
    expect(confirmCard).toContain('价格待补');
    expect(confirmCard).toContain('没认出来');
    expect(confirmCard).toContain('回复「对」入册');
  });

  it('activation moment names the time and the working pattern', () => {
    expect(activation).toContain('7 分钟');
    expect(activation).toContain('她起草，你审批');
  });

  for (const [name, text] of Object.entries({ confirmCard, activation, stepCopy })) {
    it(`${name}: banned-term scan + width budget`, () => {
      const lower = text.toLowerCase();
      for (const banned of BANNED_OWNER_TERMS) {
        const needle = banned.toLowerCase();
        const hit = /^[a-z ]+$/.test(needle)
          ? new RegExp(`\\b${needle}\\b`).test(lower)
          : lower.includes(needle);
        expect(hit, `"${banned}" in ${name}`).toBe(false);
      }
      for (const l of text.split('\n')) {
        if ((l.match(/[A-Za-z]/g)?.length ?? 0) >= 15) continue;
        expect(textWidth(l), `${name}: ${l}`).toBeLessThanOrEqual(48);
      }
    });
  }
});
