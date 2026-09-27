import { describe, it, expect } from 'vitest';
import { asksForPerson, detectSignals } from '../../src/core/scoring/detect.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { computeScores, needsHandoff } from '../../src/core/scoring/signals.js';
import { emptyState } from '../parity/fixtures.js';

/**
 * "WANTS A PERSON", IN TWO LAYERS (the owner's direction, 2026-09-28).
 *
 * The n8n word list matched words, not meaning, and failed both ways — every
 * failure below was confirmed on the list as it stood, and is now pinned the
 * other way round:
 *
 *   · LAYER 1 (`asksForPerson`, src/core/scoring/detect.ts) — the unambiguous
 *     requests, in en / zh / ar, before any model is asked. It must fire on
 *     the five it MISSED ("Can I talk to someone?", "speak with a person",
 *     «أريد أحدًا» with its hamza, 我要找你们经理, «أريد التحدث مع مديركم»), and
 *     must NOT fire on the WRONG MEANINGS (human hair wigs, 找人工成本低的工厂,
 *     «اريد احدث موديل») or the BUYER'S OWN SIDE ("someone in my team", "you
 *     can call me Ahmed") — those are layer 2's to read.
 *   · LAYER 2 (`Analysis.wantsPerson`) — the analyser's answer for the rest:
 *     true hands off, false does not, null (asked, unreadable) hands off as
 *     `not_answered`, absent (an analyser that was not asked) changes nothing.
 *
 * Ambiguous means hand off: a missed hand-off loses a buyer, a wrong one costs
 * the owner a minute. Yesterday's split of "manager" by whose it is holds as it
 * was decided (the last describes).
 *
 * The turn itself — who is called, what is said — is proved in
 * tests/pipeline/person-handoff.test.ts, and through production in
 * tests/integration/person-request.test.ts.
 */

/** Layer 1 alone, as the turn runs it before the analyser: no analysis at all. */
const byWords = (text: string): boolean =>
  detectSignals({ text, state: emptyState(), analysis: null, unitPrice: null })
    .some((s) => s.kind === 'human_requested');

const analysis = (wantsPerson?: boolean | null): Analysis => ({
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'clarification',
  ...(wantsPerson === undefined ? {} : { wantsPerson }),
});

/** Both layers, as the turn runs them after the analyser answered. */
const kinds = (text: string, a: Analysis): string[] =>
  detectSignals({ text, state: emptyState(), analysis: a, unitPrice: null }).map((s) => s.kind);

// ── Layer 1 ──────────────────────────────────────────────────────────────────

/** The five the list missed — the owner's first priority, by cost. */
const THE_FIVE_MISSES: readonly [string, string][] = [
  ['Can I talk to someone?', "'talk to', where the list said only 'speak to'"],
  ['I want to speak with a person', "'speak with', where the list said only 'speak to'"],
  ['أريد أحدًا يساعدني', "«اريد احد» typed with the hamza most people type"],
  ['我要找你们经理', 'the seller’s manager, in Chinese'],
  ['أريد التحدث مع مديركم', 'the seller’s manager, in Arabic'],
];

/** Unambiguous requests: layer 1 hands off, and no model is asked. */
const LAYER_ONE_FIRES: Record<'en' | 'zh' | 'ar', readonly string[]> = {
  en: [
    'speak with a person',
    "This isn't working — I want to speak to a real person now.",
    'I want to speak to someone',
    'Can I speak to a person?',
    'Could we talk with a human please',
    "I'd like to speak to a representative",
    'I would rather talk to a real person',
    'We need to talk to someone about the invoice',
    'Can I talk to someone from your sales team?',
    'May I speak to the owner?',
    'I want to talk to your boss',
    'Put me through to someone who can help',
    'Connect me with customer service',
    'Let me talk to a human',
    'I need a real person',
    'I want a human, not a bot',
    'get me a live agent',
    'Is there someone I can talk to?',
    'real person please',
    'Human please',
    'Agent!',
    'please call me',
    'Can you call me back?',
    'Call me asap',
    'Give me a call tomorrow',
    'Can I call you?',
    'Please have someone call me',
    'Can I get a human?',
    // Written otherwise, read the same: full-width letters, curly apostrophes.
    'ＣＡＮ Ｉ ＴＡＬＫ ＴＯ ＳＯＭＥＯＮＥ？',
    'I’d like to speak with a person',
  ],
  zh: [
    '我要找人工客服，谢谢',
    '转人工',
    '人工',
    '我要人工！',
    '找真人',
    '我想和真人聊聊',
    '能不能跟工作人员说一下',
    '请你们负责人联系我',
    '能让你们老板跟我谈吗',
    '您的客户经理一直没回复',
    '帮我转接客服',
    '请经理直接联系我',
    '我要找你們經理',   // traditional characters
    '转人工!',           // ASCII punctuation
    '转人工🙏',          // an emoji ends the word too
    '麻烦转人工 谢谢',
  ],
  ar: [
    'أريد التحدث مع شخص حقيقي من فضلك',
    'اريد احد يساعدني',
    'أريد أحداً يرد علي',
    'ابغى اكلم موظف',
    'ممكن أتكلم مع المسؤول؟',
    'عايز اكلم حد من فضلك',
    'بدي احكي مع حدا',
    'حولني على خدمة العملاء',
    'أريد الاتصال بالمدير',
    'مسؤولكم لم يرد علي',
    'المدير عندكم موجود؟',
    // A manager, an official, an employee who is a woman.
    'أريد التحدث مع المديرة',
    'مسؤولتكم لم ترد علي',
    'ممكن أكلم موظفة؟',
    // Written otherwise, read the same: tatweel, diacritics, a Persian keyboard's letters.
    'أريـــد التحدث مع مديركم',
    'أُرِيدُ أَحَدًا يُسَاعِدُنِي',
    'اریدُ التحدث مع مدیرکم',
  ],
};

/**
 * Not layer 1's — the words mean something else. Layer 2 reads these (and in
 * production answers false for them); the list must not decide them.
 */
const OTHER_MEANINGS: readonly [string, string][] = [
  ['Do you sell human hair wigs?', "'human' — a product"],
  ['I want a human hair wig in black', "'a human' — then 'hair': still the product"],
  ['We need 500 human-hair extensions', "'human-hair' — the product, hyphenated"],
  ['我们在找人工成本低的工厂', "'找人工' — labour cost"],
  ['这道工序需要人工', "'需要人工' — done by hand"],
  ['这个是机器做的，没有人工', "'没有人工' — no hand work"],
  ['你们用人工智能回复吗？', "'人工智能' — AI"],
  ['我们在找真人模特拍产品图', "'找真人' — real models, for a photo shoot"],
  ['اريد احدث موديل', "'اريد احد' — inside «احدث», the newest"],
  ['أريد أحد هذه الموديلات', "«احد» before a noun — one of these models"],
  ['نريد التواصل مع احد المصانع', "«احد» before a noun — one of the factories"],
  ['We want to be your agent in Saudi Arabia', "'agent' — a trade relationship"],
  ['Our agent in Dubai will collect the goods', "'agent' — theirs, a trade term"],
];

/** Not layer 1's — the person is on the BUYER's own side, or it is a name. */
const OWN_SIDE: readonly [string, string][] = [
  ["I'll speak to someone in my team and get back to you", 'someone in my team'],
  ['I will speak to a person in our office first', 'a person in our office'],
  ['I need to talk to someone at my company first', 'someone at my company'],
  ['Can I talk to my boss first and come back to you?', 'my boss'],
  ['Let me talk to someone and get back to you', "'let me talk to someone' — as often their own"],
  ['Hi, you can call me Ahmed', 'a name, not a call'],
  ['Call me Ahmed', 'a name, not a call'],
  ['Can I call you Lily?', 'a name, not a call'],
  ['My colleague will call me back tomorrow', 'their own colleague calls them'],
  ['A real person from our company will visit your factory', 'their own company'],
  ['我让经理联系你', 'their manager contacts the seller'],
  ['叫我小王就行', 'a name'],
  ['أحتاج التحدث مع شخص في شركتي أولاً', 'someone in their own company'],
  ['اسمي أحمد', 'a name'],
];

/**
 * Ordinary trade chat that shares words with a request — talk, speak, call,
 * agent, real, someone, 人工, 真人, 老板, «احد», «التواصل» — and asks for nobody.
 * Layer 1 stays out of all of it.
 */
const PASSING: Record<'en' | 'zh' | 'ar', readonly string[]> = {
  en: [
    'We want to talk about the price',
    'I want to talk to you about a big order',
    'Can I talk to you about pricing?',
    'Let me talk with my team',
    'Speak to you soon',
    'Talk to you later',
    'You can call me anytime',
    'I will call you tomorrow',
    'Can we have a call next week?',
    'Can I get a human hair sample?',
    'Can we have a representative sample?',
    'Can I get an agent price?',
    'I want a real bargain',
    'We need an agent in Riyadh',
    'Human resources department needs 200 uniforms',
    'Our customers are real people who care about quality',
    'Is this made by real people or machines?',
    'Someone told me you have the best price',
    'I need someone to confirm the shipping date',
    'Is there anyone who ships to Brazil?',
    'Transfer the money today',
    'Pass me the invoice please',
    'Give me a discount',
    'Call me crazy but I love this bag',
    'My colleague will ask someone to call me',
    'Can you speak English?',
  ],
  zh: [
    '请问有没有现货？',
    '你们工厂在哪里？',
    '我们公司老板想要样品',
    '你们的产品我们老板很喜欢',
    '谢谢你们的帮助，我们领导很满意',
    '我们领导让我问一下你们的价格',
    '人工费多少',
    '这个需要人工缝吗',
    '人工成本太高了',
    '真人秀',
    '在吗',
  ],
  ar: [
    'أريد التحدث عن السعر',
    'أريد التواصل معكم',
    'ممكن التواصل مع الشركة؟',
    'أريد أحد الأنواع',
    'أحد العملاء طلب هذا المنتج',
    'هل عندكم مندوب في دبي؟',
    'أريد أحدث الألوان',
    'أريد التحدث مع زوجتي أولا',
    'سأتحدث مع مديري وأعود إليك',
    'مدير المبيعات لدينا سيتصل بكم',
  ],
};

/** Declining a person is not asking for one. */
const DECLINED: readonly string[] = [
  "I don't want to talk to a person, just send the price",
  'No need to connect me with a person',
  "Don't transfer me to a human, you are doing fine",
  '不用转人工，你回答就行',
  '我不需要人工客服',
  '别找真人了',
  'لا أريد التحدث مع شخص، أرسل السعر فقط',
  'مش عايز اكلم حد',
];

/** A question about WHAT they are talking to is not, by itself, a request: layer 2's. */
const ABOUT_THE_ASSISTANT: readonly string[] = [
  'Are you a human?',
  'Hold on — am I talking to a bot or a real person?',
  '你是真人吗？',
  'هل أنت إنسان؟',
];

describe('layer 1 · the five the list missed now hand off, before any model', () => {
  for (const [text, why] of THE_FIVE_MISSES) {
    it(`${why}: ${JSON.stringify(text)}`, () => {
      expect(asksForPerson(text), text).toBe(true);
      expect(byWords(text), text).toBe(true);
    });
  }
});

describe('layer 1 · the unambiguous requests hand off', () => {
  for (const [lang, texts] of Object.entries(LAYER_ONE_FIRES)) {
    for (const text of texts) {
      it(`${lang}: ${JSON.stringify(text)}`, () => {
        expect(byWords(text), text).toBe(true);
      });
    }
  }
});

describe('layer 1 · other meanings of the words are not layer 1’s', () => {
  for (const [text, why] of OTHER_MEANINGS) {
    it(`${why}: ${JSON.stringify(text)}`, () => {
      expect(byWords(text), text).toBe(false);
    });
  }
});

describe('layer 1 · the buyer’s own side is not layer 1’s', () => {
  for (const [text, why] of OWN_SIDE) {
    it(`${why}: ${JSON.stringify(text)}`, () => {
      expect(byWords(text), text).toBe(false);
    });
  }
});

describe('layer 1 · ordinary trade chat that shares the words asks for nobody', () => {
  for (const [lang, texts] of Object.entries(PASSING)) {
    for (const text of texts) {
      it(`${lang}: ${JSON.stringify(text)}`, () => {
        expect(byWords(text), text).toBe(false);
      });
    }
  }
});

describe('layer 1 · declining a person is not asking for one', () => {
  for (const text of DECLINED) {
    it(JSON.stringify(text), () => {
      expect(byWords(text), text).toBe(false);
    });
  }
});

describe('layer 1 · "are you a bot?" is not a request by itself', () => {
  for (const text of ABOUT_THE_ASSISTANT) {
    it(JSON.stringify(text), () => {
      expect(byWords(text), text).toBe(false);
    });
  }
});

describe('layer 1 · reads the text however it was typed', () => {
  it('Arabic with the hamza, without it, with diacritics and with tatweel is one sentence', () => {
    for (const text of ['أريد أحدًا يساعدني', 'اريد احدا يساعدني', 'أُرِيدُ أَحَدًا يُسَاعِدُنِي', 'أريـــد أحــداً يساعدني']) {
      expect(asksForPerson(text), text).toBe(true);
    }
  });

  it('a request ends at any punctuation, full-width or not; 人工 inside a longer word does not', () => {
    for (const text of ['转人工', '转人工。', '转人工，谢谢', '转人工,谢谢', '转人工！', '转人工吧']) {
      expect(asksForPerson(text), text).toBe(true);
    }
    for (const text of ['找人工成本低的', '要人工费吗', '转人工智能']) {
      expect(asksForPerson(text), text).toBe(false);
    }
  });

  it('empty and blank say nothing', () => {
    for (const text of ['', '   ', '\n']) expect(asksForPerson(text)).toBe(false);
  });
});

// ── Layer 2 ──────────────────────────────────────────────────────────────────

describe('layer 2 · what layer 1 leaves, the analyser decides', () => {
  const LEFT: readonly string[] = [
    ...OTHER_MEANINGS.map(([text]) => text), ...OWN_SIDE.map(([text]) => text), ...ABOUT_THE_ASSISTANT, ...DECLINED,
    // Only the meaning says it: no word on any list.
    'Hello?? Is anybody actually reading these messages?',
    'Honestly I would prefer that Mr. Wang handles my order himself',
  ];

  for (const text of LEFT) {
    it(`true hands off, false answers as usual — ${JSON.stringify(text)}`, () => {
      expect(kinds(text, analysis(true))).toContain('human_requested');
      expect(needsHandoff(computeScores(detectSignals({ text, state: emptyState(), analysis: analysis(true), unitPrice: null })))).toBe(true);
      const asUsual = kinds(text, analysis(false));
      expect(asUsual).not.toContain('human_requested');
      expect(asUsual).not.toContain('not_answered');
    });
  }

  it('null — asked, and the answer could not be read — hands off as not_answered', () => {
    const signals = detectSignals({ text: 'Do you sell human hair wigs?', state: emptyState(), analysis: analysis(null), unitPrice: null });
    expect(signals.map((s) => s.kind)).toEqual(['not_answered']);
    expect(needsHandoff(computeScores(signals))).toBe(true);
  });

  it('absent — an analyser that was not asked (scripted, sandbox, harness) — changes nothing', () => {
    for (const text of LEFT) {
      const k = kinds(text, analysis());
      expect(k, text).not.toContain('human_requested');
      expect(k, text).not.toContain('not_answered');
    }
  });

  it('no analysis at all (the turn was gated before the analyser) — nothing from layer 2', () => {
    expect(byWords('Hello?? Is anybody actually reading these messages?')).toBe(false);
  });

  it('layer 1 is not overruled: a model that says false does not undo an unambiguous request', () => {
    for (const [text] of THE_FIVE_MISSES) {
      expect(kinds(text, analysis(false)), text).toContain('human_requested');
    }
  });

  it('when layer 1 has handed off, an unreadable answer adds nothing: one reason, not two', () => {
    for (const [text] of THE_FIVE_MISSES) {
      const k = kinds(text, analysis(null));
      expect(k, text).toContain('human_requested');
      expect(k, text).not.toContain('not_answered');
    }
  });

  it('a deletion request is still its own reason, beside either answer', () => {
    expect(kinds('Please delete my data', analysis(null))).toEqual(expect.arrayContaining(['deletion_requested', 'not_answered']));
    expect(kinds('Please delete my data', analysis(false))).toEqual(['deletion_requested']);
  });
});

// ── "Manager", split by whose it is (2026-09-28, kept as decided) ────────────

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

/** Whose manager it is cannot be told: in English it keeps handing off at layer 1, as decided. */
const AMBIGUOUS: readonly string[] = [
  'The manager approved it',
  'Sales Manager\nAhmed Ali',
  'Manager here, need 500 pcs',
];

describe('"manager", split by whose it is — as decided on 2026-09-28', () => {
  for (const [lang, texts] of Object.entries(THEIR_OWN)) {
    for (const text of texts) {
      it(`${lang}: their own — no hand-off — ${JSON.stringify(text)}`, () => {
        expect(byWords(text), text).toBe(false);
        // …and layer 2 is not made to take it back: a model that agrees answers as usual.
        expect(kinds(text, analysis(false)), text).not.toContain('human_requested');
      });
    }
  }
  for (const text of THE_SELLERS) {
    it(`the seller's side — hands off — ${JSON.stringify(text)}`, () => {
      expect(byWords(text), text).toBe(true);
    });
  }
  for (const text of AMBIGUOUS) {
    it(`ambiguous — kept, hands off — ${JSON.stringify(text)}`, () => {
      expect(byWords(text), text).toBe(true);
    });
  }
});

describe('whose it is decides, nothing else: make each of theirs "your", and it hands off', () => {
  for (const text of THEIR_OWN.en.filter((x) => /^(my|our) /i.test(x))) {
    const yours = text.replace(/^(my|our) /i, 'Your ');
    it(`${JSON.stringify(yours)}`, () => {
      expect(byWords(yours), yours).toBe(true);
    });
  }
  it('and in Chinese and Arabic: 我们经理 is theirs, 你们经理 is the seller’s; «مديرنا» theirs, «مديركم» the seller’s', () => {
    expect(byWords('我们经理会确认价格')).toBe(false);
    expect(byWords('你们经理会确认价格吗')).toBe(true);
    expect(byWords('مديرنا سيؤكد السعر')).toBe(false);
    expect(byWords('مديركم سيؤكد السعر؟')).toBe(true);
  });
});
