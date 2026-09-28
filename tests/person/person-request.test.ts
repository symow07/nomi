import { describe, it, expect } from 'vitest';
import { asksForPerson, detectSignals } from '../../src/core/scoring/detect.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { computeScores, needsHandoff } from '../../src/core/scoring/signals.js';
import { emptyState } from '../parity/fixtures.js';
import {
  THE_FIVE_MISSES, REQUESTS, OTHER_MEANINGS, OWN_SIDE, PASSING, DECLINED, ABOUT_THE_ASSISTANT, LEFT_TO_LAYER_TWO,
  type Lang,
} from './person-corpus.js';

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
// The corpus lives in ./person-corpus.ts, three groups in three languages.

const LANGS: readonly Lang[] = ['en', 'zh', 'ar'];

describe('the corpus holds every group in every language', () => {
  it('requests, other meanings and the buyer’s own side — en, zh and ar each', () => {
    for (const l of LANGS) {
      expect(REQUESTS[l].length, `requests ${l}`).toBeGreaterThanOrEqual(30);
      expect(OTHER_MEANINGS[l].length, `other meanings ${l}`).toBeGreaterThanOrEqual(5);
      expect(OWN_SIDE[l].length, `own side ${l}`).toBeGreaterThanOrEqual(5);
      expect(PASSING[l].length, `passing ${l}`).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('layer 1 · the five the list missed now hand off, before any model', () => {
  for (const [text, why] of THE_FIVE_MISSES) {
    it(`${why}: ${JSON.stringify(text)}`, () => {
      expect(asksForPerson(text), text).toBe(true);
      expect(byWords(text), text).toBe(true);
    });
  }
});

describe('layer 1 · the unambiguous requests hand off, in every language', () => {
  for (const [lang, texts] of Object.entries(REQUESTS)) {
    for (const text of texts) {
      it(`${lang}: ${JSON.stringify(text)}`, () => {
        expect(byWords(text), text).toBe(true);
      });
    }
  }
});

describe('layer 1 · other meanings of the words are not layer 1’s', () => {
  for (const [lang, rows] of Object.entries(OTHER_MEANINGS)) {
    for (const [text, why] of rows) {
      it(`${lang} · ${why}: ${JSON.stringify(text)}`, () => {
        expect(byWords(text), text).toBe(false);
      });
    }
  }
});

describe('layer 1 · the buyer’s own side is not layer 1’s', () => {
  for (const [lang, rows] of Object.entries(OWN_SIDE)) {
    for (const [text, why] of rows) {
      it(`${lang} · ${why}: ${JSON.stringify(text)}`, () => {
        expect(byWords(text), text).toBe(false);
      });
    }
  }
});

describe('layer 1 · what is left to layer 2 on purpose is not layer 1’s', () => {
  for (const [lang, rows] of Object.entries(LEFT_TO_LAYER_TWO)) {
    for (const [text, why] of rows) {
      it(`${lang} · ${why}: ${JSON.stringify(text)}`, () => {
        expect(byWords(text), text).toBe(false);
      });
    }
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
  for (const text of Object.values(DECLINED).flat()) {
    it(JSON.stringify(text), () => {
      expect(byWords(text), text).toBe(false);
    });
  }
});

describe('layer 1 · "are you a bot?" is not a request by itself', () => {
  for (const text of Object.values(ABOUT_THE_ASSISTANT).flat()) {
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
    ...Object.values(OTHER_MEANINGS).flat().map(([text]) => text),
    ...Object.values(OWN_SIDE).flat().map(([text]) => text),
    ...Object.values(ABOUT_THE_ASSISTANT).flat(), ...Object.values(DECLINED).flat(),
    ...Object.values(LEFT_TO_LAYER_TWO).flat().map(([text]) => text),
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
