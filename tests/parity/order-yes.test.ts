import { describe, it, expect } from 'vitest';
import { detectFastPath } from '../../src/core/conversation/fastpath.js';
import { asksOrHolds, soundsLikeYes } from '../../src/core/conversation/acceptance.js';
import { emptyState } from './fixtures.js';

/**
 * The language sweep's finding 1 (the owner, 2026-10-14): a buyer's yes the fast path did not know — «好的», «تمام» —
 * was answered with the price again. Two parts: (a) the owner's words on the list, read past punctuation; (b) the
 * list no longer load-bearing — a yes it does not know goes to the owner (`soundsLikeYes`, src/pipeline/turn.ts).
 * Through a whole turn: tests/pipeline/maybe-confirmation.test.ts.
 */

const waiting = emptyState({ phase: 'confirmation', pendingQuestion: 'order_confirmation' });
const confirms = (text: string) => {
  const r = detectFastPath(text, waiting);
  return r.matched && r.type === 'order_confirm_yes';
};

describe('(a) the owner\'s words confirm an order — past the punctuation around them', () => {
  for (const w of ['好的', '是的', '可以', '确认', 'تمام', 'موافق', 'yes please', 'Yes.', '好的。', 'تمام!', 'ok 👍', 'أكيد', '没问题']) {
    it(w, () => expect(confirms(w), w).toBe(true));
  }
  it('still a whole answer: "yes I want 500" carries new information, and is read in full', () => {
    expect(confirms('yes I want 500')).toBe(false);
  });
});

/** (b) Deliberately NOT on the list, in each language — and each read as a possible yes. */
const NOT_ON_THE_LIST: Readonly<Record<string, readonly string[]>> = {
  en: ['Sounds great, let us go with that', 'Perfect, book it', 'alright, that works for me'],
  zh: ['那就这么定了吧', '行吧，就按这个来', '嗯嗯，下单吧'],
  ar: ['تمام كذا، نمشي على هذا', 'اتفقنا، أكد الطلب', 'ماشي، خلاص'],
  es: ['Vale, adelante con eso'],
  fr: ['Ça marche, on part là-dessus'],
  pt: ['Combinado, pode fechar'],
};

describe('(b) a yes NOT on the list, in each language: not confirmed by the list, and heard as a possible yes', () => {
  for (const [lang, list] of Object.entries(NOT_ON_THE_LIST)) {
    for (const text of list) {
      it(`${lang}: ${text}`, () => {
        expect(confirms(text), 'deliberately not on the list').toBe(false);
        expect(soundsLikeYes(text), text).not.toBeNull();
      });
    }
  }
  for (const text of ['no problem, go ahead', '没问题，就这样', 'لا مشكلة، أكد', 'pas de souci, je confirme']) {
    it(`a yes that holds a "no": ${text}`, () => expect(soundsLikeYes(text), text).not.toBeNull());
  }
});

describe('not a yes — it asks, refuses or hesitates, and is answered as before', () => {
  for (const text of [
    'Can you do 3.50?', 'ok but it is too expensive', 'No, not yet', 'let me think about it',
    '可以便宜点吗', '太贵了', '我再考虑一下', '不要了',
    'هل يمكن تخفيض السعر؟', 'لا، غالي', 'لكن السعر مرتفع',
    '¿puede ser más barato?', 'non, trop cher', 'mas está caro',
  ]) {
    it(text, () => {
      expect(asksOrHolds(text), text).toBe(true);
      expect(soundsLikeYes(text), text).toBeNull();
    });
  }
  it('a greeting is not a yes: «你好» holds «好»', () => {
    expect(soundsLikeYes('你好')).toBeNull();
    expect(soundsLikeYes('你好，好的')).not.toBeNull();
  });
  it('a long message is about something else — the analysis reads it, not the word list', () => {
    expect(soundsLikeYes('ok and we would also like to add our logo in blue on both sides of every bag with a matching ribbon handle')).toBeNull();
  });
});
