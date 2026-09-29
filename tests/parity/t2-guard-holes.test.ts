import { describe, it, expect } from 'vitest';
import { acknowledgesAi, guardIdentity } from '../../src/core/safety/identity.js';
import { extractNumerals, guardNumerals } from '../../src/core/safety/numerals.js';
import { promisesDeletion } from '../../src/core/safety/deletion.js';
import { emptyState } from './fixtures.js';

/**
 * T2 — THE GUARD HOLES, CLOSED (the plan's list, 2026-09-29).
 *
 *   · "AI" was matched case-blind anywhere in a reply, so "details", "email",
 *     "available" — and French «j'ai», «taille» — counted as saying what the
 *     assistant is, and a reply that dodged "are you a bot?" went out;
 *   · Spanish deletion promises with accents ("eliminaré tus datos");
 *   · figures the numeral guard could not see: Arabic-Indic digits and
 *     Chinese numerals; and a small number beside any currency but $ € £ ¥
 *     ("9 AED", "₹9") passed as an ordinary word.
 */

describe('T2 · "AI" is the word, not two letters inside another', () => {
  it('ordinary words are not an admission', () => {
    for (const reply of ['Sure, I can send the details.', 'Please send your email.', 'It is available in black.',
      'I said I would check again.', "J'ai bien reçu votre message.", 'Quelle taille voulez-vous ?']) {
      expect(acknowledgesAi(reply), reply).toBe(false);
    }
  });
  it('saying what it is still counts', () => {
    for (const reply of ["I'm an AI assistant.", 'Soy una IA.', "Je suis l'IA de la boutique.", '我是AI助手', '我是智能助手']) {
      expect(acknowledgesAi(reply), reply).toBe(true);
    }
  });
  it('a reply that dodges the question is held — even with "details" in it', () => {
    expect(guardIdentity({ reply: 'Happy to share the details!', buyerText: 'Are you a bot?' }).ok).toBe(false);
  });
});

describe('T2 · figures in every script, and a price in every currency', () => {
  const values = (t: string) => extractNumerals(t).map((n) => n.value);
  const commercial = (t: string) => extractNumerals(t).filter((n) => n.commercial).map((n) => n.value);

  it('Arabic-Indic digits are figures', () => {
    expect(values('٥٠٠ قطعة')).toEqual([500]);
    expect(values('۱۲۰۰')).toEqual([1200]);
    expect(values('السعر ٢٫٥')).toEqual([2.5]);
  });
  it('Chinese numerals are figures where they count or price something — never inside a word', () => {
    expect(values('五百个')).toEqual([500]);
    expect(values('一千五百件')).toEqual([1500]);
    expect(values('三十天发货')).toEqual([30]);
    expect(commercial('十二元一个')).toContain(12);
    for (const t of ['等一下', '我们一起', '一样的', '万一不行', '十分感谢']) expect(values(t), t).toEqual([]);
  });
  it('a small number beside any currency is a price', () => {
    for (const [t, n] of [['9 AED', 9], ['₹9', 9], ['٩ درهم', 9], ['SAR 5', 5], ['7 块', 7]] as const) {
      expect(commercial(t), t).toContain(n);
    }
  });
  it('so an invented small price is refused, in any of them', () => {
    for (const reply of ['The price is 9 AED.', 'السعر ٩ درهم', '只要七块', '₹9 only']) {
      expect(guardNumerals({ reply, quote: null, clientText: 'price?', state: emptyState() }).ok, reply).toBe(false);
    }
    // …and a figure the customer wrote themselves is theirs to be repeated.
    expect(guardNumerals({ reply: 'نعم، ٥٠٠ قطعة', quote: null, clientText: 'أريد ٥٠٠ قطعة', state: emptyState() }).ok).toBe(true);
  });
});

describe('T2 · Spanish deletion promises, accents and all', () => {
  it('caught', () => {
    for (const reply of ['Eliminaré tus datos.', 'Borraré todos sus datos.', 'Sus datos fueron eliminados.']) {
      expect(promisesDeletion(reply), reply).not.toBeNull();
    }
  });
});
