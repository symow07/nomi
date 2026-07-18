import { MARK } from './tokens.js';
import { box, joinLines, joinSections, labeled } from './components.js';
import { formatQtyZh } from './format.js';
import { unitZh } from './vocabulary.js';
import type { InvoiceData } from '../commerce/invoice.js';
import { PLANS, type Plan } from '../billing/plans.js';

/**
 * M6 — Commercial surfaces: the owner-side invoice card (发票卡, boxed like
 * the quote card — computed things look like invoices), pricing pages
 * (中/EN), payment instructions, the fapiao answer, and the data promise.
 */

const money = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 形式发票卡 — one tap after a settled negotiation (回复「开票」). */
export function renderInvoiceCardZh(inv: InvoiceData): string {
  return joinSections([
    box('形式发票', [
      labeled('编号', inv.piNumber),
      labeled('买家', inv.buyerName),
      labeled('产品', `${inv.productName}（${inv.productSku}）`),
      labeled('数量', `${formatQtyZh(inv.quantity)} ${unitZh(inv.unit)}`),
      labeled('单价', `$${money(inv.unitPriceUsd)} ${inv.incoterm}`),
      labeled('总价', `$${money(inv.totalUsd)} USD`),
      inv.leadTimeDays !== null ? labeled('交期', `${inv.leadTimeDays} 天`) : null,
      labeled('付款', inv.paymentTermsZh),
      `数字都来自你确认过的报价 ${MARK.ok}`,
    ]),
    '回复「发送」发给买家 ｜「改」调整付款条件',
  ]);
}

/** ── Pricing page (中/EN) — plans come from plans.ts, one source ─────────── */

const planBlockZh = (p: Plan): string => joinLines([
  `【${p.nameZh}】${p.monthlyCny === 0 ? '免费' : `￥${p.monthlyCny}/月`}`,
  ...p.featuresZh.map((f) => `${MARK.ok} ${f}`),
]);

export function renderPricingZh(): string {
  return joinSections([
    '请一个不睡觉的外贸业务员，一个月的价格：',
    ...PLANS.map(planBlockZh),
    '先试14天，满意再付。随时停，数据带走。',
  ]);
}

export function renderPricingEn(): string {
  const block = (p: Plan): string => joinLines([
    `${p.nameEn} — ${p.monthlyCny === 0 ? 'Free' : `¥${p.monthlyCny}/mo`}`,
    p.trialDays ? `${p.trialDays}-day trial, no card required` : `${formatQtyZh(p.conversationsPerMonth)} conversations/mo`,
  ]);
  return joinSections([
    'A trade sales assistant who never sleeps.',
    ...PLANS.map(block),
    'Try 14 days free. Cancel anytime, export everything.',
  ]);
}

/** ── Payment: WeChat / Alipay / bank transfer, manually confirmed ────────── */

export type PaymentMethod = 'wechat' | 'alipay' | 'bank';

export function renderPaymentInstructionsZh(method: PaymentMethod, plan: Plan): string {
  const amount = `￥${plan.monthlyCny}`;
  const lines: Record<PaymentMethod, readonly string[]> = {
    wechat: [`微信扫码支付 ${amount}`, '付款后回复「已付」，当天开通。'],
    alipay: [`支付宝转账 ${amount}`, '付款后回复「已付」，当天开通。'],
    bank: [`对公转账 ${amount}（账户信息见开通短信）`, '转账后把回单发过来，当天开通。'],
  };
  return joinLines([`开通${plan.nameZh}：`, ...lines[method]]);
}

/** The fapiao answer — asked in every Chinese B2B sale; answer it up front. */
export const FAPIAO_ANSWER_ZH = joinLines([
  '可以开发票：',
  '· 电子普通发票——付款后3个工作日内开出',
  '· 增值税专用发票——对公转账后开出，提供税号即可',
  '开票信息发过来就行，不用催。',
]);

/** ── The data promise — PIPL story, surfaced as trust ───────────────────── */

export const DATA_PROMISE_ZH = joinLines([
  '你的数据永远是你的：',
  `${MARK.ok} 产品、价格、买家、聊天——随时可以导出`,
  `${MARK.ok} 只用来帮你接待买家，不给任何别人`,
  `${MARK.ok} 不要了就删，删了就是删了`,
]);
