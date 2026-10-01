import { describe, it, expect } from 'vitest';
import { detectClaims, guardClaims } from '../../src/core/safety/claims.js';

/**
 * RT — what a shop promises (the onboarding plan, Stage 3): returns, free
 * shipping, and refunds, warranties and replacements in Chinese and Arabic too.
 * Each pattern held both ways; each promise refused until the owner allows it.
 */

const keysIn = (text: string) => [...new Set(detectClaims(text).map((c) => c.claimKey))];

/** [text, the key it must raise]. */
const PROMISES: readonly [string, string][] = [
  ['Free returns within 30 days!', 'returns'],
  ['Returns are accepted on all orders.', 'returns'],
  ['You can return it if it does not fit.', 'returns'],
  ['We offer 14-day returns.', 'returns'],
  ['支持七天无理由退货', 'returns'],
  ['不合适可以包退', 'returns'],
  ['يمكن إرجاع المنتج خلال ١٤ يومًا', 'returns'],
  ['الاسترجاع مجاني', 'returns'],
  ['Devoluciones gratis en 30 días', 'returns'],
  ['Retours gratuits sous 30 jours', 'returns'],
  ['全额退款', 'refund'],
  ['يمكن استرداد المبلغ كاملًا', 'refund'],
  ['保修一年', 'warranty'],
  ['المنتج بضمان سنة', 'warranty'],
  ['坏了免费换新的', 'free_replacement'],
  ['Free shipping on every order', 'free_shipping'],
  ['全国包邮', 'free_shipping'],
  ['الشحن مجاني لكل الطلبات', 'free_shipping'],
  ['Envío gratis a todo el país', 'free_shipping'],
  ['Livraison gratuite dès 50 €', 'free_shipping'],
  ['我们发顺丰', 'express'],
];

/** None of these promises anything. */
const PLAIN: readonly string[] = [
  "I'll return your call tomorrow.",
  'Let me get back to you on that.',
  'It returns to stock next week.',
  '我们退一步说',
  'سأرجع إليك قريبًا',
  'لضمان وصول الطلب في الوقت المحدد، يُرجى تأكيد العنوان',
  'The delivery fee is shown at checkout.',
  'Shipping takes 3 to 5 days.',
];

describe('RT · shop promises — both ways', () => {
  for (const [text, key] of PROMISES) it(`raises ${key}: ${JSON.stringify(text)}`, () => expect(keysIn(text)).toContain(key));
  for (const text of PLAIN) it(`raises nothing: ${JSON.stringify(text)}`, () => expect(keysIn(text)).toEqual([]));
});

describe('RT · default-deny, and the owner\'s switch', () => {
  it('a promise she has not allowed is refused; one she allowed passes', () => {
    expect(guardClaims({ reply: 'Free returns within 30 days.', policy: [] }).ok).toBe(false);
    expect(guardClaims({ reply: 'Free returns within 30 days.', policy: [{ kind: 'guarantee', claimKey: 'returns', allowed: true }] }).ok).toBe(true);
    expect(guardClaims({ reply: '全国包邮', policy: [{ kind: 'shipping_method', claimKey: 'free_shipping', allowed: false }] }).ok).toBe(false);
  });
});
