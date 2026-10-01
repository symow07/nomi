import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { languageEvidence, gateLanguage, fixedLanguage, UNDETERMINED, ROMANISED } from '../../src/core/conversation/gateLanguage.js';
import { personRequestLanguage } from '../../src/core/scoring/detect.js';
import {
  HANDOFF_REPLIES, SAFE_REPLIES, orderBlockedReply, orderConfirmedReply, guardFallbackReply,
} from '../../src/core/conversation/templates.js';
import { SAFE_FALLBACK_REPLIES } from '../../src/core/safety/injection.js';
import type { BlockingReason, Quote } from '../../src/core/types/commerce.js';
import { PRODUCT } from './fixtures.js';
import { usd } from '../../src/core/types/money.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * LG (decision 16) — which language the gate reads, by fixed rules, and the
 * fixed sentences said in it. The turn: tests/pipeline/language-gate.test.ts;
 * the first five per language over Postgres: tests/integration/lg-language.test.ts.
 *
 * THE CORPUS. Each line is a decision, with its reason. Latin text is a
 * language only when the analysis says so and the word list agrees; a
 * romanised language is never English. A new phrasing goes here first.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/** Read as undetermined whatever the analysis says (here it says English, the worst case). */
const NEVER_ENGLISH: readonly (readonly [string, string])[] = [
  ['salam, kam el si3r?', 'Arabizi: "kam" (how much) and a 3 inside a word'],
  ['3ndkom hal lon?', 'Arabizi: a leading 3 (ع) before letters'],
  ['shu el price ya 7abibi', 'Arabizi: "shu" (what), and 7 for ح — beside an English word'],
  ['a7la wa7ed please', 'Arabizi: 7 inside two words, even with "please"'],
  ['kifak, bikam hay?', 'Levantine Arabizi: "kifak", "bikam"'],
  ['shlonak, abi 10', 'Gulf Arabizi: "shlonak", "abi" (I want)'],
  ['mesh 3ayez da', 'Egyptian Arabizi: "mesh" and a 3 inside a word'],
  ['price kya hai bhai', 'Hinglish: "kya", "bhai" — beside the English "price"'],
  ['mujhe 2 chahiye', 'Hinglish: "mujhe", "chahiye"'],
  ['kitne ka hai ye?', 'Hinglish: "kitne"'],
  ['aap delivery karte ho?', 'Hinglish: "aap" — beside the English "delivery"'],
  ['magkano po ito?', 'Taglish: "magkano" (how much)'],
  ['pwede pa-deliver sa Cebu?', 'Taglish: "pwede"'],
  ['salamat, meron pa ba?', 'Taglish: "salamat", "meron"'],
  ['boleh hantar ke KL?', 'Malay: "boleh", "hantar"'],
  ['nak order 5, sudah ada stock?', 'Malay: "nak", "sudah" — beside the English "order"'],
  ['duoshao qian?', 'pinyin: "duoshao", "qian"'],
  ['nihao, you jiage ma', 'pinyin: "nihao", "jiage"'],
];

/** Read as English when the analysis says English: what an English-writing customer sends. */
const ENGLISH: readonly (readonly [string, string])[] = [
  ['Hi, what is the price of the canvas tote?', 'small words and a sales word'],
  ['Can you send 200 pcs to Dubai?', 'a count is not Arabizi ("pcs" after the figure)'],
  ['I need 3pcs in XL', '"3pcs" — a figure and its unit, not a letter'],
  ['Do you ship to the 3rd floor?', 'an ordinal is not Arabizi'],
  ['Do you have a b2b price list?', '"b2b" is a trade word, not Arabizi'],
  ['Thanks!', 'one word on the list is enough when the analysis agrees'],
  ['Is anyone there?', 'the opener'],
  ['Yes please, send it today', 'a reply to a question'],
];

/** Say nothing of their language: read by the customer's earlier messages. */
const NO_EVIDENCE: readonly (readonly [string, string])[] = [
  ['ok', '"ok" is written in every language'],
  ['200 pcs?', 'a figure and a unit'],
  ['👍', 'no letters'],
  ['', 'nothing'],
];

describe('LG · Latin script: never English unless the analysis and the words agree', () => {
  for (const [text, why] of NEVER_ENGLISH) {
    it(`undetermined — ${why}: ${JSON.stringify(text)}`, () => {
      expect(languageEvidence(text, 'en')).toBe(UNDETERMINED);
    });
  }
  for (const [text, why] of ENGLISH) {
    it(`English — ${why}: ${JSON.stringify(text)}`, () => {
      expect(languageEvidence(text, 'en')).toBe('en');
    });
  }
  it('English words, and the analysis says otherwise: nobody can say', () => {
    expect(languageEvidence('What is the price?', 'es')).toBe(UNDETERMINED);
    expect(languageEvidence('What is the price?', null)).toBe(UNDETERMINED);
  });
  it('the analysis picks among languages tied by a shared word; it cannot pick one the words rank lower', () => {
    expect(languageEvidence('¿Venden pelucas de cabello humano?', 'es')).toBe('es');   // "de": es, fr, pt — es among them
    expect(languageEvidence('Bonjour, vous avez des sacs ?', 'fr')).toBe('fr');
    expect(languageEvidence('Bonjour, vous avez des sacs ?', 'en')).toBe(UNDETERMINED);
  });
  for (const [text, why] of NO_EVIDENCE) {
    it(`no evidence — ${why}: ${JSON.stringify(text)}`, () => {
      expect(languageEvidence(text, 'en')).toBeNull();
    });
  }
  it('a message with no evidence is read by the earlier ones, newest first; none at all is undetermined', () => {
    expect(gateLanguage(['ok', 'Can you send it today?', 'salam kam?'], 'en')).toBe('en');
    expect(gateLanguage(['ok', 'salam kam?', 'Can you send it today?'], 'en')).toBe(UNDETERMINED);
    expect(gateLanguage(['ok', '200 pcs?'], 'en')).toBe(UNDETERMINED);
    expect(gateLanguage([], 'en')).toBe(UNDETERMINED);
  });
  it('the romanised lists hold no English word', () => {
    const english = ['fee', 'ana', 'po', 'hai', 'yuan', 'ada', 'sis', 'eh', 'fi', 'duo'];
    for (const [kind, words] of Object.entries(ROMANISED)) {
      for (const w of english) expect(words, `${kind}: ${w}`).not.toContain(w);
    }
  });
});

describe('LG · a script decides by itself', () => {
  it('Chinese, Arabic, Cyrillic — the analysis is not asked', () => {
    expect(languageEvidence('这个多少钱？', 'en')).toBe('zh');
    expect(languageEvidence('كم السعر؟', 'en')).toBe('ar');
    expect(languageEvidence('Сколько стоит?', 'en')).toBe('ru');
  });
  it('counted in words: a brand name in Latin letters does not make Chinese Latin', () => {
    expect(languageEvidence('删除logo', 'zh')).toBe('zh');
    expect(languageEvidence('我要 canvas tote', 'zh')).toBe('zh');
  });
  it('kana anywhere is Japanese, whatever its kanji', () => {
    expect(languageEvidence('こんにちは、値段は？', 'zh')).toBe('ja');
    expect(languageEvidence('値段はいくらですか', 'zh')).toBe('ja');
  });
  it('Arabic script with Urdu or Persian letters or words is not Arabic', () => {
    expect(languageEvidence('یہ کتنے کا ہے؟', 'ar')).toBe('ur');
    expect(languageEvidence('قیمت این چقدر است؟', 'ar')).toBe('fa');
    // Gulf Arabic writes چ and گ: still Arabic.
    expect(languageEvidence('شلونك؟ أبي گوني', 'ar')).toBe('ar');
  });
});

describe('LG · before any model, the pattern that caught it', () => {
  it('a request for a person is in the language of its frame; the analysis, absent, does not overrule it', () => {
    expect(personRequestLanguage('Agent!')).toBe('en');
    expect(personRequestLanguage('Get me your manager')).toBe('en');
    expect(personRequestLanguage('Quiero hablar con una persona')).toBe('es');
    expect(languageEvidence('Agent!', null, 'en')).toBe('en');
    expect(languageEvidence('Agent!', 'es', 'en')).toBe(UNDETERMINED);
    // A romanised marker still wins over a pattern.
    expect(languageEvidence('real person please bhai', null, 'en')).toBe(UNDETERMINED);
  });
  it('a shop\'s opener is in the language of its clause (each clause carries its own)', () => {
    expect(personRequestLanguage('客服在吗')).toBe('zh');
    expect(personRequestLanguage('فيه أحد؟')).toBe('ar');
    expect(personRequestLanguage('Is anyone there?')).toBe('en');
    expect(personRequestLanguage('¿Hay alguien?')).toBe('es');
    expect(personRequestLanguage("Il y a quelqu'un ?")).toBe('fr');
    expect(personRequestLanguage('Can you send it today?')).toBeNull();
  });
});

describe('LG · the turn reads it, and nothing else', () => {
  const turn = src('src/pipeline/turn.ts');
  it('the gate, the disclosure and the reason all use the gate\'s language', () => {
    expect(turn).toContain('const language = r.gateLanguage;');
    expect(turn).toContain('const released = !speaksAlone || (language !== UNDETERMINED && tenant.autonomy.released(language));');
    expect(turn).toContain('detected: r.gateLanguage,');
    expect(turn).toContain('const proven = !speaksAlone || !released || await tenant.autonomy.languageProven(languageHead(language));');
  });
  it('every draft records the language the gate read, so the first five can be counted', () => {
    expect(turn).toContain('gate: language,');
    expect(src('migrations/0108_language_proven.sql')).toContain("coalesce(e.payload->>'gate', e.payload->>'language')");
  });
});

describe('LG · the fixed sentences, in English, Chinese and Arabic', () => {
  const base: Quote = { productId: PRODUCT, quantity: { value: 500, unit: 'pcs' }, unitPrice: usd(1.2), discountPct: 0, total: usd(600),
    moq: 100, leadTimeDays: 20, leadTimeBlocked: null, requiresHuman: false, contradicts: null, appliedRules: [] };
  const quote = base;
  const one: Quote = { ...base, quantity: { value: 1, unit: 'item' }, unitPrice: usd(12), total: usd(12), leadTimeDays: null, moq: null };
  const reasons: readonly BlockingReason[] = ['email_missing', 'product_not_confirmed_by_client', 'quantity_missing', 'quantity_below_moq',
    'pending_question_unresolved', 'conversation_handed_off', 'missing_product', 'price_missing'];
  it('a customer\'s language picks one of the three; any other is English (and its reply drafts)', () => {
    expect(fixedLanguage('zh')).toBe('zh');
    expect(fixedLanguage('ar')).toBe('ar');
    expect(fixedLanguage('en')).toBe('en');
    for (const l of ['es', 'fr', 'ja', UNDETERMINED, null]) expect(fixedLanguage(l)).toBe('en');
  });
  it('every sentence exists in each, and differs from the English', () => {
    for (const lang of ['zh', 'ar'] as const) {
      expect(HANDOFF_REPLIES[lang]).not.toBe(HANDOFF_REPLIES.en);
      expect(SAFE_REPLIES[lang]).not.toBe(SAFE_REPLIES.en);
      expect(SAFE_FALLBACK_REPLIES[lang]).not.toBe(SAFE_FALLBACK_REPLIES.en);
      for (const r of reasons) expect(orderBlockedReply([r], quote, lang), r).not.toBe(orderBlockedReply([r], quote, 'en'));
      expect(guardFallbackReply(null, null, lang)).not.toBe(guardFallbackReply(null, null, 'en'));
    }
  });
  it('figures come from the quote, unchanged, in every language — and the unit is the language\'s own', () => {
    expect(guardFallbackReply(quote, null, 'en')).toBe('For 500 pcs: $1.20 USD each, $600 in total, ready in 20 days.');
    expect(guardFallbackReply(quote, null, 'zh')).toBe('500件：单价 $1.20 USD，总价 $600，20 天可备好。');
    expect(guardFallbackReply(quote, null, 'ar')).toBe('لكمية 500 قطعة: سعر الوحدة $1.20 USD، والإجمالي $600، ومدة التجهيز بالأيام: 20.');
    expect(guardFallbackReply(one, null, 'en')).toBe('$12.00 USD each.');
    expect(guardFallbackReply(one, null, 'zh')).toBe('单价 $12.00 USD。');
    expect(orderBlockedReply(['quantity_below_moq'], quote, 'zh')).toBe('这个产品的最低起订量是100件——这个数量可以吗？');
    const confirmed = { orderReference: 'NM-1042', productName: 'Canvas tote', quantity: 500, unit: 'pcs' };
    expect(orderConfirmedReply(confirmed)).toBe("Your order is confirmed — reference NM-1042: 500 pcs of Canvas tote. We'll send you the invoice next.");
    expect(orderConfirmedReply({ ...confirmed, language: 'zh' })).toBe('你的订单已确认——编号 NM-1042：Canvas tote，500件。接下来我们会把发票发给你。');
    expect(orderConfirmedReply({ ...confirmed, language: 'ar' })).toContain('NM-1042');
    // The analyser's own question is still preferred to the fixed one.
    expect(guardFallbackReply(null, 'Which colour?', 'zh')).toBe('Which colour?');
  });
  it('the order card shows the sentence the customer will read, in their language', () => {
    expect(src('src/api/web/inbox.ts')).toContain('language: fixedLanguage(p.customerLanguage),');
    expect(src('src/pipeline/orderProposal.ts')).toContain('language: fixedLanguage(p.customerLanguage),');
  });
});

describe('LG · what the card says', () => {
  for (const l of LOCALES) {
    it(`${l} · undetermined, and the first five in a language`, () => {
      expect(t(l, 'inbox.draft.held.language_unknown' as MessageKey)).not.toBe('inbox.draft.held.language_unknown');
      const s = t(l, 'inbox.draft.held.language_new' as MessageKey, { language: 'X' });
      expect(s).toContain('X');
    });
  }
});
