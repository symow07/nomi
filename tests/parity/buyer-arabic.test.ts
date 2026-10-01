import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { messages, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { disclosureFor } from '../../src/core/conversation/disclosure.js';
import { AR_BANNED_FORMS } from './assistant-pronouns.lists.js';
import { HANDOFF_REPLIES, SAFE_REPLIES, orderBlockedReply, orderConfirmedReply, guardFallbackReply } from '../../src/core/conversation/templates.js';
import { SAFE_FALLBACK_REPLIES } from '../../src/core/safety/injection.js';
import type { BlockingReason, Quote } from '../../src/core/types/commerce.js';
import { PRODUCT } from './fixtures.js';
import { usd } from '../../src/core/types/money.js';

/**
 * EVERY ARABIC WORD A BUYER READS addresses them in neither gender (rule 6),
 * and calls the assistant what it is — «مساعد آلي», never «ذكي» (swept
 * 2026-09-28, the owner's direction).
 *
 * What a buyer reads in Arabic, all of it: the buyer-facing pages of the
 * catalogue (`legal.*`, `unsub.*`, `proof.*`), the disclosure, the fixed
 * replies of the fast path, and since LG the fixed sentences of the send path
 * (hand-off, the safe replies, an order blocked or confirmed, the stand-in).
 * The rest of the send path writes through the model, whose words are its
 * own; the rest of the catalogue is the owner's
 * (tests/parity/assistant-pronouns.test.ts holds that).
 *
 * The forms below are the ones that can only be a gendered address to the
 * reader: a masculine or feminine imperative, a second-person verb, a
 * vowel-marked suffix. The unvowelled ـك is not one (rule 6). Words are
 * compared exactly as written, like the owner catalogue's list.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const AR_W = /[ء-يً-ْ]+/g;

/** Second-person forms, either gender, that an address to a buyer would use. */
const BUYER_ADDRESS_FORMS = [
  'أخبرني', 'فأخبرني', 'أخبريني', 'فأخبريني', 'تحتاج', 'تحتاجين', 'تحتاجه', 'تريد', 'تريدين',
  'ترغب', 'ترغبين', 'تستطيع', 'تستطيعين', 'أردتَ', 'أردتِ', 'أنتَ', 'أنتِ', 'أرسلْ', 'أرسلي',
  'اكتب', 'اكتبي', 'تواصلي', 'اضغط', 'اضغطي', 'تفضل', 'تفضلي',
];

const fastPathArabic = (): string[] => {
  const src = readFileSync(`${ROOT}src/core/conversation/fastpath.ts`, 'utf8');
  const block = src.slice(src.indexOf('const REPLIES'), src.indexOf('function replyFor'));
  return [...block.matchAll(/^\s+ar: '([^']+)',$/gm)].map((m) => m[1]!);
};

const QUOTE: Quote = { productId: PRODUCT, quantity: { value: 500, unit: 'pcs' }, unitPrice: usd(1.2), discountPct: 0, total: usd(600),
  moq: 100, leadTimeDays: 20, leadTimeBlocked: null, requiresHuman: false, contradicts: null, appliedRules: [] };
const ONE: Quote = { ...QUOTE, quantity: { value: 1, unit: 'item' }, unitPrice: usd(12), total: usd(12), leadTimeDays: 5, moq: null };
const BLOCKED: readonly BlockingReason[] = ['email_missing', 'product_not_confirmed_by_client', 'quantity_missing', 'quantity_below_moq',
  'pending_question_unresolved', 'problem_score_too_high', 'missing_product', 'price_missing'];
/** LG — the send path's fixed sentences, in Arabic. */
const fixedArabic = (): [string, string][] => [
  ['handoff', HANDOFF_REPLIES.ar], ['safe', SAFE_REPLIES.ar], ['injection', SAFE_FALLBACK_REPLIES.ar],
  ...BLOCKED.map((r) => [`blocked:${r}`, orderBlockedReply([r], QUOTE, 'ar')] as [string, string]),
  ['blocked:no-minimum', orderBlockedReply(['quantity_below_moq'], null, 'ar')],
  ['confirmed', orderConfirmedReply({ orderReference: 'NM-1', productName: 'X', quantity: 5, unit: 'pcs', language: 'ar' })],
  ['stand-in', guardFallbackReply(null, null, 'ar')], ['stand-in:quote', guardFallbackReply(QUOTE, null, 'ar')],
  ['stand-in:one', guardFallbackReply(ONE, null, 'ar')],
];

const buyerArabic = (): [string, string][] => [
  ...(Object.entries(messages.ar) as [MessageKey, string][]).filter(([k]) => /^(legal|unsub|proof)\./.test(k)),
  ['disclosure', disclosureFor({ detected: 'ar', name: 'Lily', business: 'Westlake' })!],
  ...fastPathArabic().map((v, i) => [`fastpath#${i + 1}`, v] as [string, string]),
  ...fixedArabic(),
];

describe('buyer-facing Arabic addresses nobody in a gender', () => {
  it('reads every surface: the catalogue pages, the disclosure, the fixed replies', () => {
    const all = buyerArabic();
    expect(all.filter(([k]) => /^(legal|unsub|proof)\./.test(k)).length).toBeGreaterThan(90);
    expect(all.filter(([k]) => k.startsWith('fastpath#'))).toHaveLength(3);
    expect(all.filter(([k]) => /^(handoff|safe|injection|blocked|confirmed|stand-in)/.test(k)).length).toBe(fixedArabic().length);
    expect(all.find(([k]) => k === 'disclosure')?.[1]).toContain('مساعد آلي');
  });

  it('no gendered second-person form, and none the owner-side sweep removed', () => {
    const banned = new Set([...BUYER_ADDRESS_FORMS, ...AR_BANNED_FORMS]);
    const bad = buyerArabic().flatMap(([k, v]) =>
      (v.replace(/\{[a-zA-Z_]+\}/g, ' ').match(AR_W) ?? []).filter((w) => banned.has(w)).map((w) => `${k}: ${w}`));
    expect(bad).toEqual([]);
  });

  it('no vowel-marked address (كَ كِ تَ تِ at a word end)', () => {
    const bad = buyerArabic().filter(([, v]) => /(كَ|كِ|تَ|تِ)(?![ء-ي])/.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it('the assistant is «مساعد آلي» — a kind — never «ذكي», a compliment', () => {
    const bad = buyerArabic().filter(([, v]) => /(?<![ء-ي])(?:ال)?ذكي(?:ة)?(?![ء-ي])/.test(v)).map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
    expect(messages.ar['legal.privacy.ai' as MessageKey]).toContain('مساعد آلي');
  });
});
