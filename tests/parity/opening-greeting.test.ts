import { describe, it, expect } from 'vitest';
import { withoutOpeningGreeting } from '../../src/core/conversation/openingGreeting.js';
import { disclosureFor, withDisclosureFirst, isSignedOff, DISCLOSURE_LOCALES } from '../../src/core/conversation/disclosure.js';

/**
 * One greeting, not two (the owner, 2026-10-28; src/core/conversation/openingGreeting.ts). The corpus both ways: a new
 * phrasing goes here first, with its reason. Through the production composition on WhatsApp and Telegram:
 * tests/integration/disclosure-one-greeting.test.ts.
 */

/** [the reply as written, what follows the disclosure] */
const TAKEN: readonly (readonly [string, string])[] = [
  ['Hi! The canvas tote is $12.', 'The canvas tote is $12.'],
  ['Hi Amal! Yes, we make tote bags — which size?', 'Yes, we make tote bags — which size?'],
  ['Hello there, thanks for writing. It ships in 3 days.', 'Thanks for writing. It ships in 3 days.'],
  ['Hey, yes it comes in black.', 'Yes it comes in black.'],
  ['Good morning! We open at 9.', 'We open at 9.'],
  ['Hello again 👋 the price is $12.', 'Hello again 👋 the price is $12.'],      // no punctuation where a greeting ends: kept
  ['Hello again! 👋 The price is $12.', 'The price is $12.'],                     // the emoji goes with it
  ['Hi\nThe tote is $12.', 'The tote is $12.'],
  ['Hello! Good morning, the tote is $12.', 'The tote is $12.'],                   // one opening, twice over
  ['您好！这款帆布包12美元。', '这款帆布包12美元。'],
  ['你好呀，有黑色的。', '有黑色的。'],
  ['亲，这款有现货吗需要问一下老板。', '这款有现货吗需要问一下老板。'],
  ['亲爱的顾客，您好！包邮。', '包邮。'],
  ['مرحبًا! سعر الحقيبة 12 دولارًا.', 'سعر الحقيبة 12 دولارًا.'],
  ['أهلًا وسهلًا، نعم متوفر باللون الأسود.', 'نعم متوفر باللون الأسود.'],
  ['السلام عليكم، السعر 12 دولارًا.', 'السعر 12 دولارًا.'],
  ['مرحبا أمل، نعم لدينا.', 'نعم لدينا.'],
  ['¡Hola! ¿Qué talla buscas?', '¿Qué talla buscas?'],
  ['Hola Ana, sí, la tenemos en negro.', 'Sí, la tenemos en negro.'],
  ['Buenas tardes, el envío tarda 3 días.', 'El envío tarda 3 días.'],
  ['Bonjour ! Le sac coûte 12 €.', 'Le sac coûte 12 €.'],
  ['Bonsoir, oui il existe en noir.', 'Oui il existe en noir.'],
  ['Olá! A bolsa custa R$ 60.', 'A bolsa custa R$ 60.'],
  ['Oi, tudo bem? Temos sim.', 'Tudo bem? Temos sim.'],
  ['Bom dia, temos em preto.', 'Temos em preto.'],
];

/** Kept whole, with why. */
const KEPT: readonly (readonly [string, string])[] = [
  ['Hello Kitty bags are $5 each.', 'a brand, and no punctuation where a greeting would end'],
  ['Hi-vis vests are $3.', 'a word, not a greeting'],
  ['Hilton tote, $12.', 'starts with the letters, not the word'],
  ['Oil lamps are $5.', 'starts with "oi", not the word'],
  ['Heyday prints are back.', 'a word'],
  ['Thanks for your message! The tote is $12.', 'thanks are not a greeting'],
  ['Yes, we have it. Hi to the team!', 'a greeting not at the start'],
  ['亲自送货需要两天。', '亲自 (in person), not 亲'],
  ['你好看的那款是黑色。', 'no punctuation after 你好'],
  ['أهلًا بك في متجرنا الجديد، السعر 12 دولارًا.', 'a welcome to the shop that runs on — no punctuation after the greeting'],
  ['Olaplex is not something we sell.', 'a brand'],
  ['Salutations are not how we write; the price is $12.', 'a longer word'],
  ['The tote is $12. Hello!', 'a greeting at the end'],
];

describe('the reply\'s own opening greeting goes; nothing else does', () => {
  for (const [reply, rest] of TAKEN) it(`taken: ${reply}`, () => expect(withoutOpeningGreeting(reply)).toBe(rest));
  for (const [reply, why] of KEPT) it(`kept (${why}): ${reply}`, () => expect(withoutOpeningGreeting(reply)).toBe(reply));
  it('a reply that was only a greeting leaves nothing', () => {
    for (const g of ['Hi!', 'Hello there!', '您好！', 'مرحبًا!', '¡Hola!', 'Bonjour !', 'Olá!']) expect(withoutOpeningGreeting(g), g).toBe('');
  });
});

describe('the disclosure is said word for word, then the reply without its greeting', () => {
  it('every language: the signed sentence untouched, one blank line, the reply\'s substance', () => {
    for (const l of DISCLOSURE_LOCALES) {
      const d = disclosureFor({ detected: l, name: 'Lily', business: 'Atlas Bags' })!;
      expect(withDisclosureFirst(d, 'Hi Amal! The tote is $12.')).toBe(`${d}\n\nThe tote is $12.`);
      expect(withDisclosureFirst(d, 'The tote is $12.')).toBe(`${d}\n\nThe tote is $12.`);
      expect(withDisclosureFirst(d, 'Hello!'), 'only a greeting: the disclosure alone').toBe(d);
    }
    // the signed sentences themselves still are what their readers signed
    for (const l of ['en', 'zh', 'ar'] as const) {
      expect(isSignedOff(l, disclosureFor({ detected: l, name: '{name}', business: '{business}' })!), l).toBe(true);
    }
  });
});
