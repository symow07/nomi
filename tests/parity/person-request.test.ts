import { describe, it, expect } from 'vitest';
import { detectSignals } from '../../src/core/scoring/detect.js';
import { emptyState } from './fixtures.js';

/**
 * "WANTS A PERSON" — "manager", split by whose manager it is (the owner's
 * decision, 2026-09-28).
 *
 * The request-for-a-person list (`HUMAN_PHRASES`, src/core/scoring/detect.ts,
 * ported from n8n) matched the word "manager" anywhere. In trade chat buyers
 * talk about their own colleagues all the time — "my manager approved it",
 * "our manager will confirm the price" — and every one of them pulled the
 * owner in for nothing.
 *
 *   · The buyer's OWN manager ("my", "our", "I'm the … manager", "the manager
 *     at my company") is not a request to reach a person: no hand-off.
 *   · The SELLER's side ("your manager", "speak to a manager", "someone in
 *     charge") still hands off.
 *   · Anything else — "the manager approved it" — is AMBIGUOUS and keeps the
 *     old behaviour: it hands off. A wrong hand-off costs the owner a minute; a
 *     missed one loses a buyer.
 *
 * The last describe pins what was REPORTED to the owner and deliberately not
 * changed — the other words on the list that fire on a buyer's own side, and
 * the gaps — so that changing one is a decision, not a side effect.
 */

const asksForPerson = (text: string): boolean =>
  detectSignals({ text, state: emptyState(), analysis: null, unitPrice: null })
    .some((s) => s.kind === 'human_requested');

const THEIR_OWN: Record<'en' | 'zh' | 'ar', readonly string[]> = {
  en: [
    'My manager approved it',
    'my manager will confirm the price',
    'Our manager wants a sample first',
    'Can you remove my account manager from the cc?',
    'Our purchasing manager will send the PO tomorrow',
    'My new sales manager is copied here',
    "My manager's approval came through",
    'OUR MANAGER SAID OK',
    "I'm the purchasing manager at Al Noor Trading",
    'I am the manager of a small shop in Dubai',
    'im the store manager, we need 500 pcs',
    'The purchasing manager at my company approved the sample',
    'Our person in charge will confirm by Friday',
    'Someone in charge at my company will call you',
  ],
  // Neither list ever had a word for "manager" in Chinese or Arabic: the
  // buyer's own manager never handed off there, and still does not.
  zh: [
    '我的经理已经批准了',
    '我们经理会确认价格',
    '我的客户经理明天联系你',
    '我们采购经理下周来工厂',
    '我问一下经理再回复你',
  ],
  ar: [
    'مديري وافق على السعر',
    'مديرنا سيؤكد السعر',
    'مدير المشتريات لدينا سيرسل الطلب غدا',
  ],
};

const THE_SELLERS: readonly string[] = [
  'I want to speak to your manager',
  'Can I speak to a manager?',
  'Let me talk to someone in charge',
  'Put me through to the manager',
  'Your manager promised me a discount',
  'manager please',
  'Your account manager never replied',
  'Is there someone in charge I can talk to?',
  "I'd like to speak with the person in charge",
  // Both: theirs stays theirs, and yours still hands off.
  'My manager wants to speak to your manager',
  // Near misses of the buyer's-own patterns: none of these is theirs.
  "I'm meeting your manager next week",
  "I'm talking to the manager tomorrow",
  'Your manager at our meeting said 5% off',
];

/** Whose manager it is cannot be told: it keeps the old behaviour and hands off. */
const AMBIGUOUS: readonly string[] = [
  'The manager approved it',
  'Sales Manager\nAhmed Ali',
  'Manager here, need 500 pcs',
];

describe('"manager", split by whose it is', () => {
  for (const [lang, texts] of Object.entries(THEIR_OWN)) {
    for (const text of texts) {
      it(`${lang}: their own — no hand-off — ${JSON.stringify(text)}`, () => {
        expect(asksForPerson(text), text).toBe(false);
      });
    }
  }
  for (const text of THE_SELLERS) {
    it(`the seller's side — hands off — ${JSON.stringify(text)}`, () => {
      expect(asksForPerson(text), text).toBe(true);
    });
  }
  for (const text of AMBIGUOUS) {
    it(`ambiguous — kept, hands off — ${JSON.stringify(text)}`, () => {
      expect(asksForPerson(text), text).toBe(true);
    });
  }
});

describe('whose it is decides, nothing else: make each of theirs "your", and it hands off', () => {
  for (const text of THEIR_OWN.en.filter((x) => /^(my|our) /i.test(x))) {
    const yours = text.replace(/^(my|our) /i, 'Your ');
    it(`${JSON.stringify(yours)}`, () => {
      expect(asksForPerson(yours), yours).toBe(true);
    });
  }
});

describe('the rest of the list is unchanged', () => {
  for (const text of [
    "This isn't working — I want to speak to a real person now.",
    'I want to speak to someone', 'please call me', 'Are you a human?', 'Can I speak to a person?',
    'أريد التحدث مع شخص حقيقي من فضلك', 'اريد احد يساعدني', '我要找人工客服，谢谢', '找真人',
  ]) {
    it(`still hands off — ${JSON.stringify(text)}`, () => {
      expect(asksForPerson(text), text).toBe(true);
    });
  }
});

/**
 * REPORTED TO THE OWNER, 2026-09-28 — NOT CHANGED. Each is pinned at what it
 * does today, so that fixing one is a decision.
 */
describe('reported, not changed', () => {
  const OWN_SIDE_HANDS_OFF: readonly [string, string][] = [
    ["I'll speak to someone in my team and get back to you", "'speak to someone' — about their own team"],
    ['I will speak to a person in our office first', "'speak to a person' — their own office"],
    ['Hi, you can call me Ahmed', "'call me' — a name, not a request"],
    ['A real person from our company will visit your factory', "'real person' — their own company"],
    ['أحتاج التحدث مع شخص في شركتي أولاً', "'التحدث مع شخص' — someone at their own company"],
    ['我们在找真人模特拍产品图', "'找真人' — they are looking for real models"],
  ];
  const OTHER_MEANING_HANDS_OFF: readonly [string, string][] = [
    ['Do you sell human hair wigs?', "'human' — a product"],
    ['اريد احدث موديل', "'اريد احد' — inside «احدث», the newest"],
    ['我们在找人工成本低的工厂', "'找人工' — labour cost"],
  ];
  const MISSED: readonly [string, string][] = [
    ['Can I talk to someone?', "'talk to', where the list says 'speak to'"],
    ['I want to speak with a person', "'speak with', where the list says 'speak to'"],
    ['أريد أحدًا يساعدني', "'اريد احد' with the hamza most people type"],
    ['我要找你们经理', 'no Chinese word for a manager on the list'],
    ['أريد التحدث مع مديركم', 'no Arabic word for a manager on the list'],
  ];
  for (const [text, why] of [...OWN_SIDE_HANDS_OFF, ...OTHER_MEANING_HANDS_OFF]) {
    it(`hands off today — ${why}: ${JSON.stringify(text)}`, () => {
      expect(asksForPerson(text), text).toBe(true);
    });
  }
  for (const [text, why] of MISSED) {
    it(`does not hand off today — ${why}: ${JSON.stringify(text)}`, () => {
      expect(asksForPerson(text), text).toBe(false);
    });
  }
});
