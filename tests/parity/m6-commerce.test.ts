import { describe, it, expect } from 'vitest';
import { recallLineZh, recallContextEn, RETURNING_AFTER_MS, type BuyerHistory } from '../../src/core/conversation/buyerMemory.js';
import { renderApprovalCard } from '../../src/core/conversation/cards.js';
import { buildInvoice, renderInvoiceEn } from '../../src/core/commerce/invoice.js';
import { renderInvoiceCardZh, renderPricingZh, renderPricingEn, renderPaymentInstructionsZh, FAPIAO_ANSWER_ZH, DATA_PROMISE_ZH } from '../../src/core/owner/commerce.js';
import { renderBusinessProfile, renderEmployeeProfile } from '../../src/core/owner/profile.js';
import { PLANS, planById, startTrial, confirmPayment, subscriptionStatus, computeCosts, TOKEN_PRICE_USD } from '../../src/core/billing/plans.js';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { textWidth } from '../../src/core/owner/components.js';
import { BOX } from '../../src/core/owner/tokens.js';
import { product, tiers, policy } from './fixtures.js';

const NOW = new Date('2026-07-18T10:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600 * 1000);

/* ── Wow #2: buyer memory in context ─────────────────────────────────────── */
describe('M6 · returning-buyer recall', () => {
  const history = (over: Partial<BuyerHistory> = {}): BuyerHistory => ({
    buyerName: 'Ahmed', countryZh: '阿联酋', isVip: true,
    preferenceNoteZh: '只发英文，付款只走TT',
    lastContactAt: daysAgo(120),
    pastInquiries: [{
      at: new Date('2026-03-10T00:00:00Z'), productSku: 'ZX-200',
      productNameZh: '保温杯', quantity: 20000, lastUnitPriceUsd: 2.1,
    }],
    ...over,
  });

  it('recalls the spec line: 这是Ahmed，3月询过保温杯（ZX-200），2万个，谈到$2.10/个', () => {
    const line = recallLineZh(history(), NOW)!;
    expect(line).toContain('这是Ahmed');
    expect(line).toContain('3月询过保温杯（ZX-200）');
    expect(line).toContain('2万个');
    expect(line).toContain('谈到$2.10/个');
  });

  it('no fake memory: recent contact or empty history → no recall line', () => {
    expect(recallLineZh(history({ lastContactAt: daysAgo(3) }), NOW)).toBeNull();
    expect(recallLineZh(history({ pastInquiries: [] }), NOW)).toBeNull();
    expect(RETURNING_AFTER_MS).toBe(30 * 24 * 3600 * 1000);
  });

  it('surfaces IN CONTEXT: the approval card carries the recall under the buyer header', () => {
    const card = renderApprovalCard({
      buyerName: 'Ahmed', buyerCountryHint: '阿联酋', isReturning: true,
      recallZh: recallLineZh(history(), NOW),
      buyerMessage: 'Hi, back again — same thermos?', buyerMessageZh: '嗨，又来了——还是那个保温杯？',
      draft: 'Welcome back Ahmed!', draftZh: '欢迎回来！',
      whyLineZh: '老买家回来了，先接住。', quoteCard: null,
    });
    const header = card.indexOf('👤 Ahmed');
    const recall = card.indexOf('这是Ahmed');
    const said = card.indexOf('买家说：');
    expect(recall).toBeGreaterThan(header);
    expect(recall).toBeLessThan(said);
  });

  it('reply-writer context includes memory and the owner note', () => {
    const ctx = recallContextEn(history())!;
    expect(ctx).toContain('ZX-200');
    expect(ctx).toContain('$2.10');
    expect(ctx).toContain('Owner note');
    expect(recallContextEn(history({ pastInquiries: [] }))).toBeNull();
  });
});

/* ── Wow #3: instant invoice ─────────────────────────────────────────────── */
describe('M6 · instant invoice', () => {
  const quote = (() => {
    const r = computeQuote({ product: product(), tiers: tiers(), policy: policy(), rules: [], quantity: 5000 });
    if (!r.ok) throw new Error('fixture');
    return r.value;
  })();
  const inv = buildInvoice({
    quote, sellerName: 'Yiwu Hongfa Daily Goods Factory', sellerPrefix: 'HF',
    buyerName: 'Mohammed Noor', productName: product().name, productSku: 'ZX-100',
    incoterm: 'FOB Ningbo', paymentTermsZh: 'TT 30% 定金，发货前付清',
    paymentTermsEn: 'T/T 30% deposit, balance before shipment',
    conversationRef: 'de300000-0000-4000-8000-000000000304', now: NOW,
  });

  it('every number is the quote\'s number — zero new arithmetic', () => {
    expect(inv.quantity).toBe(quote.quantity.value);
    expect(inv.unitPriceUsd).toBe(quote.unitPriceUsd);
    expect(inv.totalUsd).toBe(quote.totalUsd);
    expect(inv.leadTimeDays).toBe(quote.leadTimeDays);
  });

  it('PI number is deterministic and idempotent to reissue', () => {
    expect(inv.piNumber).toBe('PI-HF-20260718-0304');
    const again = buildInvoice({
      quote, sellerName: 'x', sellerPrefix: 'HF', buyerName: 'y', productName: 'p',
      productSku: 's', incoterm: 'FOB', paymentTermsZh: 'a', paymentTermsEn: 'b',
      conversationRef: 'de300000-0000-4000-8000-000000000304', now: NOW,
    });
    expect(again.piNumber).toBe(inv.piNumber);
  });

  it('the buyer PI carries only quote-derived money figures', () => {
    const en = renderInvoiceEn(inv);
    const moneyFigures = [...en.matchAll(/\$([\d,]+\.\d{2})/g)].map((m) => Number(m[1]!.replace(/,/g, '')));
    for (const f of moneyFigures) {
      expect([quote.unitPriceUsd, quote.totalUsd]).toContain(f);
    }
    expect(en).toContain(`Qty: ${quote.quantity.value.toLocaleString('en-US')}`);
  });

  it('the zh invoice card uses the box grammar and states its provenance', () => {
    const card = renderInvoiceCardZh(inv);
    expect(card.split('\n')[0]).toBe(BOX.top('形式发票'));
    expect(card).toContain('数字都来自你确认过的报价');
    expect(card).toContain('回复「发送」发给买家');
  });
});

/* ── Commercial readiness ────────────────────────────────────────────────── */
describe('M6 · plans, subscription lifecycle, costs', () => {
  it('three plans; trial is free, unbound, and honest', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['trial', 'standard', 'pro']);
    expect(planById('trial').monthlyCny).toBe(0);
    expect(planById('trial').trialDays).toBe(14);
    expect(planById('standard').monthlyCny).toBeGreaterThan(0);
  });

  it('trial → past_due after expiry; payment activates 30 days; stacking extends', () => {
    const t = startTrial(NOW);
    expect(subscriptionStatus(t, NOW)).toBe('trialing');
    expect(subscriptionStatus(t, new Date(NOW.getTime() + 15 * 24 * 3600 * 1000))).toBe('past_due');

    const paid = confirmPayment(t, 'standard', NOW);
    expect(paid.status).toBe('active');
    expect(paid.paidThrough!.getTime()).toBe(NOW.getTime() + 30 * 24 * 3600 * 1000);

    const paidAgain = confirmPayment(paid, 'standard', new Date(NOW.getTime() + 5 * 24 * 3600 * 1000));
    expect(paidAgain.paidThrough!.getTime()).toBe(NOW.getTime() + 60 * 24 * 3600 * 1000);

    const lapsed = new Date(paid.paidThrough!.getTime() + 6 * 24 * 3600 * 1000);
    expect(subscriptionStatus(paid, lapsed)).toBe('past_due');
    expect(subscriptionStatus(paid, new Date(paid.paidThrough!.getTime() + 2 * 24 * 3600 * 1000))).toBe('active');
  });

  it('cost arithmetic: token prices × usage, per unique conversation', () => {
    const c = computeCosts([
      { conversationId: 'a', inputTokens: 1_000_000, outputTokens: 100_000 },
      { conversationId: 'a', inputTokens: 500_000, outputTokens: 0 },
      { conversationId: 'b', inputTokens: 0, outputTokens: 200_000 },
    ]);
    expect(c.totalUsd).toBeCloseTo(1.5 * TOKEN_PRICE_USD.inputPerM + 0.3 * TOKEN_PRICE_USD.outputPerM, 6);
    expect(c.conversations).toBe(2);
    expect(c.usdPerConversation).toBeCloseTo(c.totalUsd / 2, 6);
    expect(computeCosts([])).toEqual({ totalUsd: 0, conversations: 0, usdPerConversation: 0 });
  });
});

/* ── Owner-facing commercial surfaces ────────────────────────────────────── */
describe('M6 · commercial copy passes the owner test', () => {
  const surfaces: Record<string, string> = {
    pricingZh: renderPricingZh(),
    paymentWechat: renderPaymentInstructionsZh('wechat', planById('standard')),
    paymentBank: renderPaymentInstructionsZh('bank', planById('pro')),
    fapiao: FAPIAO_ANSWER_ZH,
    dataPromise: DATA_PROMISE_ZH,
    businessProfile: renderBusinessProfile({
      companyName: '义乌宏发日用品厂', incotermZh: 'FOB 宁波',
      currencyZh: '人民币记账，美元报价', languagesZh: ['中文', '英文', '阿拉伯文'],
      paymentTermsZh: 'TT 30% 定金', catalogCount: 12,
    }),
    employeeProfile: renderEmployeeProfile({
      employeeName: '小雅', avatar: '👩‍💼', hireDate: daysAgo(9),
      roleZh: '外贸销售助理（试用期）', languagesZh: ['中文', '英文'],
      promotedCount: 1, learningCount: 5,
    }),
  };

  for (const [name, text] of Object.entries(surfaces)) {
    it(`${name}: banned terms + width`, () => {
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

  it('the data promise leads the PIPL story: yours, exportable, deletable', () => {
    expect(DATA_PROMISE_ZH).toContain('你的数据永远是你的');
    expect(DATA_PROMISE_ZH).toContain('随时可以导出');
    expect(DATA_PROMISE_ZH).toContain('删了就是删了');
  });

  it('fapiao is answered up front, both kinds', () => {
    expect(FAPIAO_ANSWER_ZH).toContain('电子普通发票');
    expect(FAPIAO_ANSWER_ZH).toContain('增值税专用发票');
  });

  it('pricing exists in both languages with the trial promise', () => {
    expect(renderPricingZh()).toContain('￥399');
    expect(renderPricingZh()).toContain('先试14天');
    expect(renderPricingEn()).toContain('14-day trial');
    expect(renderPricingEn()).toContain('Cancel anytime');
  });
});
