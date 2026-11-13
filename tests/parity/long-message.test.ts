import { describe, expect, it } from 'vitest';
import { LONG_MESSAGE, messageBubble, messageOpening } from '../../src/api/web/inbox.js';

/**
 * THE UI CORRECTION (2026-11-13, audit F14) — a long message in the thread is shown as its opening, with the whole of
 * it one press away. What this file holds: an ordinary message is drawn exactly as it always was; the opening stops
 * where the quoted history or the signature begins; nothing is ever cut from what the bubble holds; an address is
 * shortened in the opening only, and is never made a link.
 */
const EMAIL = [
  'Hello,', '', 'We would like 600 of the canvas tote bags with our logo. What is the price?', '',
  'Kind regards,', 'Adam', '', '-- ', 'Adam Lahlou', 'Purchasing', 'Tel. +212 600 000 000',
  'This message is confidential and intended only for the person named above.', '',
  'On Tue, 10 Nov 2026 at 15:12, Lumen & Co. <hello@example.com> wrote:', '> Thank you for writing to us.', '> Which colour would you like?',
].join('\n');

describe('F14 · a long message is its opening, and whole one press away', () => {
  it('an ordinary message is drawn as before: one element holding its words, its own direction', () => {
    for (const text of ['Hi! How much for 5,000 of the travel cosmetic bags?', 'Line one\nLine two\nLine three', 'x'.repeat(LONG_MESSAGE.chars)]) {
      expect(messageOpening(text), text.slice(0, 20)).toBeNull();
      expect(messageBubble('en', text, 'bubble')).toBe(`<div dir="auto" class="bubble">${text}</div>`);
    }
  });

  it('the opening stops where the signature or the quoted history begins', () => {
    const opening = messageOpening(EMAIL)!;
    expect(opening).toContain('600 of the canvas tote bags');
    expect(opening.endsWith('Adam')).toBe(true);
    for (const held of ['Purchasing', 'confidential', 'wrote:', 'Which colour']) expect(opening, held).not.toContain(held);
  });

  it.each([
    ['a quoted line', 'Yes please.\n\n> How many would you like?\n> We have them in stock.\n> Thank you.\n> The team\n' + 'a'.repeat(130)],
    ['French', 'Oui, merci.\n\nLe mar. 10 nov. 2026 à 15:12, Lumen <hello@example.com> a écrit :\n' + 'texte cité. '.repeat(20)],
    ['Spanish', 'Sí, gracias.\n\nEl mar, 10 nov 2026 a las 15:12, Lumen <hello@example.com> escribió:\n' + 'texto citado. '.repeat(20)],
    ['Chinese', '好的，谢谢。\n\n2026年11月10日 15:12，Lumen <hello@example.com> 写道：\n' + '引用的文字。'.repeat(40)],
    ['a forwarded header', 'See below.\n\nFrom: Lumen <hello@example.com>\nSent: Tuesday\n' + 'forwarded words. '.repeat(20)],
    ['an original-message rule', 'See below.\n\n-----Original Message-----\n' + 'earlier words. '.repeat(20)],
  ])('%s is where the opening stops', (_name, text) => {
    const opening = messageOpening(text)!;
    expect(opening.split('\n')[0]).toBe(text.split('\n')[0]);
    expect(opening.split('\n').length).toBeLessThanOrEqual(2);
  });

  it('a message with no history but very long is cut at a word, within the limit', () => {
    const text = 'We need to know the delivery time and the colours. '.repeat(40);
    const opening = messageOpening(text)!;
    expect(Array.from(opening).length).toBeLessThanOrEqual(LONG_MESSAGE.chars);
    expect(text.startsWith(opening)).toBe(true);
    expect(opening.endsWith('.') || opening.endsWith('s') || /\w$/.test(opening)).toBe(true);
  });

  it('a very long address is shortened to where it leads in the opening only; a short one is left as written', () => {
    const long = `https://files.example.com/shared/${'a'.repeat(300)}?token=${'b'.repeat(80)}`;
    const text = `The artwork is here: ${long}\nand the size chart: https://example.com/sizes\nThank you.`;
    const html = messageBubble('en', text, 'bubble');
    const opening = messageOpening(text)!;
    expect(opening).toContain('files.example.com/…');
    expect(opening).not.toContain('token=');
    expect(opening).toContain('https://example.com/sizes');
    // The whole message is in the bubble exactly as it arrived, and nothing in it is a link.
    expect(html).toContain(`<div dir="auto" class="msg-whole">${text}</div>`);
    expect(html).not.toMatch(/<a\b/);
  });

  it('nothing is cut from what is kept: the bubble holds the message whole, escaped, with both words of the press', () => {
    const text = `${EMAIL}\n<script>alert(1)</script> & more`;
    const html = messageBubble('en', text, 'bubble by-as');
    expect(html.startsWith('<div class="bubble by-as long"><details class="msg-long"><summary>')).toBe(true);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more</div></details></div>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('The whole message');
    expect(html).toContain('Show less');
    // Rule 86: the element that holds the words is the isolate; no <bdi> inside an auto-direction box.
    expect(html).not.toMatch(/dir="auto"[^>]*><bdi/);
  });

  it('a line or two held back is not worth a press: the message is drawn whole', () => {
    expect(messageOpening(`${'word '.repeat(60)}\n\n-- \nAdam`)).toBeNull();
    expect(messageOpening('Thanks!\n\n> ok')).toBeNull();
  });

  it('says the press in each of the five languages', () => {
    const text = 'a'.repeat(900);
    for (const [locale, whole, less] of [['en', 'The whole message', 'Show less'], ['zh', '完整消息', '收起'], ['ar', 'الرسالة كاملة', 'عرض أقل'], ['es', 'El mensaje completo', 'Mostrar menos'], ['fr', 'Le message entier', 'Afficher moins']] as const) {
      const html = messageBubble(locale, text, 'bubble');
      expect(html, locale).toContain(`<span class="mt-more">${whole}</span>`);
      expect(html, locale).toContain(`<span class="mt-less">${less}</span>`);
    }
  });
});
