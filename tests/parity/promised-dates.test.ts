import { describe, it, expect } from 'vitest';
import { readPromises, type PromiseKind } from '../../src/core/conversation/promises.js';

/**
 * WHAT A REPLY PROMISED, AND FOR WHEN — both ways (the design pass, decided
 * 2026-09-29: the calendar's dates from conversations, the promised
 * follow-up first; then the day a price ends, and a delivery date).
 *
 * Said on Tuesday 29 September 2026. A day the words name, or nothing: a span
 * ("next week", "soon") is not a day, a question is not a promise, and a
 * sentence that says it cannot is not one either. A new phrasing goes here
 * with its reason, never into the patterns alone.
 */

const SAID_ON = '2026-09-29';   // a Tuesday

const FOUND: readonly (readonly [string, PromiseKind, string])[] = [
  // English
  ["I'll check with the factory and get back to you tomorrow.", 'follow_up', '2026-09-30'],
  ['We will confirm the colours by Friday.', 'follow_up', '2026-10-02'],
  ["Let me check and I'll let you know today.", 'follow_up', '2026-09-29'],
  ['I will send you the photos on Monday.', 'follow_up', '2026-10-05'],
  ["I'll get back to you in 3 days.", 'follow_up', '2026-10-02'],
  ["We'll confirm within 2 working days.", 'follow_up', '2026-10-01'],
  ["I'll write to you on October 5.", 'follow_up', '2026-10-05'],
  ['This price is valid until October 15.', 'price_end', '2026-10-15'],
  ['The offer is good until Friday.', 'price_end', '2026-10-02'],
  ['The quote expires on the 10th.', 'price_end', '2026-10-10'],
  ['We can ship on Thursday.', 'delivery', '2026-10-01'],
  ["We'll ship the order by October 20.", 'delivery', '2026-10-20'],
  ['Delivery by October 25.', 'delivery', '2026-10-25'],
  // Chinese
  ['我明天确认后回复您。', 'follow_up', '2026-09-30'],
  ['我们周五前给您确认颜色。', 'follow_up', '2026-10-02'],
  ['3天内给您回复。', 'follow_up', '2026-10-02'],
  ['这个价格有效期到10月15日。', 'price_end', '2026-10-15'],
  ['我们下周三发货。', 'delivery', '2026-10-07'],
  // Arabic
  ['سأؤكد لك غدًا.', 'follow_up', '2026-09-30'],
  ['سنرسل الصور يوم الخميس.', 'follow_up', '2026-10-01'],
  ['هذا السعر صالح حتى 15 أكتوبر.', 'price_end', '2026-10-15'],
  ['سنشحن الطلب يوم الأحد.', 'delivery', '2026-10-04'],
  ['سأرد عليك خلال ٣ أيام.', 'follow_up', '2026-10-02'],
  // Spanish
  ['Te confirmo mañana.', 'follow_up', '2026-09-30'],
  ['Le escribiré el viernes.', 'follow_up', '2026-10-02'],
  ['El precio es válido hasta el 15 de octubre.', 'price_end', '2026-10-15'],
  ['Enviaremos el pedido el lunes.', 'delivery', '2026-10-05'],
  // French
  ['Je vous confirme demain.', 'follow_up', '2026-09-30'],
  ['Nous vous répondrons vendredi.', 'follow_up', '2026-10-02'],
  ["Ce prix est valable jusqu'au 15 octobre.", 'price_end', '2026-10-15'],
  ['Nous expédierons la commande lundi.', 'delivery', '2026-10-05'],
];

const LEFT: readonly (readonly [string, string])[] = [
  ['Would you like it tomorrow?', 'a question to the customer'],
  ['Can you confirm by Friday?', 'a question'],
  ['Lead time is 25 days.', 'a duration, not a day, and nobody committed'],
  ['We will send it soon.', '"soon" is not a day'],
  ["I'll confirm next week.", '"next week" is a span, not a day'],
  ["Sorry, I can't confirm today.", 'says it cannot'],
  ['The sun hats are in stock.', '"sun" is not Sunday'],
  ['We are closed on Sunday.', 'a fact, not a promise'],
  ['Our shop opened in May 2020.', 'the past'],
  ['Thank you for your order today!', 'thanks, not a promise'],
  ['We may need more time.', '"may" is not the month'],
  ['I sat down with the team on Sunday.', 'the past; "sat" is not Saturday'],
  ['你明天要吗？', 'a question'],
  ['我们下周联系。', '"next week" is a span'],
  ['今年发货量很大。', '今年 is this year, not today'],
  ['سأل العميل عن السعر اليوم.', 'سأل is "asked", not a future'],
  ['مرت سنة على طلبك.', 'سنة is "a year"'],
  ['لن أستطيع التأكيد غدًا.', 'says it cannot'],
  ['¿Lo quieres mañana?', 'a question'],
  ['Por la mañana estamos abiertos.', '"la mañana" is the morning'],
  ["C'est vrai, le prix est bon.", '"vrai" is not a future tense'],
  ['Vous le voulez demain ?', 'a question'],
];

describe('a reply\'s promises, found', () => {
  for (const [said, kind, day] of FOUND) {
    it(`${kind} ${day} — ${JSON.stringify(said)}`, () => {
      expect(readPromises(said, SAID_ON)).toEqual([{ kind, day, said }]);
    });
  }
});

describe('ordinary words, left alone', () => {
  for (const [said, why] of LEFT) {
    it(`nothing — ${JSON.stringify(said)} (${why})`, () => {
      expect(readPromises(said, SAID_ON)).toEqual([]);
    });
  }
});

describe('a reply with several sentences', () => {
  it('each promise is read from its own sentence, kept as sent, once', () => {
    const reply = 'Thanks Maya! The Rose Face Serum is €34.90. This price is valid until October 15. I\'ll check the 100 ml and get back to you by Friday. I\'ll check the 100 ml and get back to you by Friday.';
    expect(readPromises(reply, SAID_ON)).toEqual([
      { kind: 'price_end', day: '2026-10-15', said: 'This price is valid until October 15.' },
      { kind: 'follow_up', day: '2026-10-02', said: 'I\'ll check the 100 ml and get back to you by Friday.' },
    ]);
  });

  it('a day already past is not a promise; a date that does not exist is none', () => {
    expect(readPromises('I will confirm on September 1.', SAID_ON)).toEqual([
      { kind: 'follow_up', day: '2027-09-01', said: 'I will confirm on September 1.' },
    ]);
    expect(readPromises('I will confirm on February 30.', SAID_ON)).toEqual([]);
  });

  it('"Friday" said on a Friday is next week\'s', () => {
    expect(readPromises('I will confirm on Friday.', '2026-10-02')[0]!.day).toBe('2026-10-09');
  });
});
