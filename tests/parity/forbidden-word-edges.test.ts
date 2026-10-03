import { describe, it, expect } from 'vitest';
import { findForbidden, effectiveForbidden, guardForbidden, FORBIDDEN_FLOOR } from '../../src/core/safety/forbiddenWords.js';

/**
 * V1-504 (the owner's decision, 2026-10-03) — a forbidden word is caught where
 * it stands as a word, never inside a longer one. "liar" stopped "familiar"
 * and 滚 stopped 滚筒, and a stopped reply is written again or handed to the
 * owner: this changes what reaches customers.
 *
 * In every language: the word alone, the word inside an innocent longer word,
 * the word at the start of a message and at its end. Then what a word edge
 * means where it is not a space: Chinese (a dictionary's edges) and Arabic (a
 * word's written prefixes and endings).
 */
const caught = (reply: string, owner: readonly string[] = []): string[] =>
  findForbidden(reply, effectiveForbidden(owner)).map((t) => t.term);
const hits = (reply: string, word: string, owner: readonly string[] = []): boolean => caught(reply, owner).includes(word);

type Case = { readonly word: string; readonly owner?: readonly string[]; readonly alone: string;
  readonly innocent: readonly string[]; readonly atStart: string; readonly atEnd: string };
const LANGUAGES: Readonly<Record<'en' | 'zh' | 'ar' | 'es' | 'fr', Case>> = {
  en: { word: 'liar', alone: 'liar', innocent: ['Our familiar design is back.', 'A peculiar request, but yes.'],
    atStart: 'Liar is not a word we use here.', atEnd: 'Nobody here is a liar' },
  zh: { word: '滚', alone: '滚', innocent: ['滚筒洗衣机有现货。', '这个滚轮很结实。', '滚珠轴承 5000 个。', '页面可以滚动。'],
    atStart: '滚，别再发了。', atEnd: '你给我滚' },
  ar: { word: 'حرام', owner: ['حرام'], alone: 'حرام', innocent: ['ملابس الإحرام متوفرة.', 'نبيع قماش إحرام قطني.'],
    atStart: 'حرام أن يضيع هذا العرض.', atEnd: 'هذا السعر حرام' },
  es: { word: 'caro', owner: ['caro'], alone: 'caro', innocent: ['Carolina le escribirá mañana.', 'Este aceite tiene caroteno.'],
    atStart: 'Caro no es, se lo aseguro.', atEnd: 'No es caro' },
  fr: { word: 'nul', owner: ['nul'], alone: 'nul', innocent: ['Vous pouvez annuler la commande.', 'Le montant est annulé.'],
    atStart: 'Nul besoin de payer maintenant.', atEnd: 'Ce modèle est nul' },
};

describe('V1-504 · a forbidden word is caught as a word, in every language', () => {
  for (const [lang, c] of Object.entries(LANGUAGES)) {
    describe(lang, () => {
      it('the word alone', () => expect(hits(c.alone, c.word, c.owner)).toBe(true));
      it('inside an innocent longer word: not caught', () => {
        for (const s of c.innocent) expect(hits(s, c.word, c.owner), s).toBe(false);
      });
      it('at the start of a message', () => expect(hits(c.atStart, c.word, c.owner)).toBe(true));
      it('at the end of a message', () => expect(hits(c.atEnd, c.word, c.owner)).toBe(true));
    });
  }
});

describe('V1-504 · Chinese: a word edge is where the dictionary puts one', () => {
  it('a term may span several of the dictionary\'s words (傻逼 is 傻|逼 to it), and is caught before 的', () => {
    expect(hits('你这个傻逼', '傻逼')).toBe(true);
    expect(hits('傻逼的东西', '傻逼')).toBe(true);
    expect(hits('他是大骗子', '骗子')).toBe(true);
    expect(hits('你真是个白痴吧', '白痴')).toBe(true);
  });
  it('the insults built on 滚 are caught by name; 滚 alone, beside a particle, is too', () => {
    expect(caught('滚出去')).toContain('滚出去');
    expect(caught('给我滚开')).toContain('滚开');
    expect(caught('滚蛋吧你')).toContain('滚蛋');
    expect(hits('滚吧', '滚')).toBe(true);
  });
  it('the owner\'s own word: 最 standing alone is caught, 最近 (recently) is another word', () => {
    expect(hits('这是最便宜的', '最', ['最'])).toBe(true);
    expect(hits('最近有货', '最', ['最'])).toBe(false);
  });
  it('a Latin word inside Chinese text has its edges where the script changes', () => {
    expect(hits('你是idiot吗', 'idiot')).toBe(true);
  });
});

describe('V1-504 · Arabic: a word\'s written prefixes and endings do not make it a longer word', () => {
  it('the article, a conjunction, a preposition, the vocative, written on: still the word', () => {
    for (const s of ['الغبي', 'وغبي جدا', 'يا غبي', 'ياغبي', 'بالكذاب', 'فالأحمق']) expect(caught(s).length, s).toBeGreaterThan(0);
  });
  it('an ending (feminine, plural, a pronoun): still the word', () => {
    expect(hits('هذه غبية', 'غبي')).toBe(true);
    expect(hits('كلهم كذابين', 'كذاب')).toBe(true);
    expect(hits('كذابون', 'كذاب')).toBe(true);
  });
  it('a letter that is not a prefix or an ending makes another word', () => {
    expect(hits('ملابس الإحرام متوفرة', 'حرام', ['حرام'])).toBe(false);   // ihram, the pilgrim's garment
    expect(hits('هذا حرام', 'حرام', ['حرام'])).toBe(true);
  });
  it('written with or without hamza, vowel marks or the long stroke: the same word', () => {
    expect(hits('احمق', 'أحمق')).toBe(true);
    expect(hits('غَبِيّ', 'غبي')).toBe(true);
    expect(hits('غبـــي', 'غبي')).toBe(true);
  });
  it('the forms a prefix or an ending cannot make are listed: أغبياء, حمقاء, حمقى', () => {
    expect(caught('أغبياء')).toContain('أغبياء');
    expect(caught('يا حمقى')).toContain('حمقى');
  });
});

describe('V1-504 · the longer forms the floor must still catch, now that containment does not', () => {
  it('English, Spanish, French, Portuguese inflections are caught by name', () => {
    for (const s of ['fucking idiots', 'You fucked up', 'what bullshit', 'the morons', 'two liars']) expect(caught(s).length, s).toBeGreaterThan(0);
    for (const s of ['idiota', 'estúpidos', 'mentirosas', 'cabrones', 'pendejas', 'imbéciles']) expect(caught(s).length, s).toBeGreaterThan(0);
    for (const s of ['idiote', 'connards', 'menteuses', 'crétine', 'salauds', 'imbécile']) expect(caught(s).length, s).toBeGreaterThan(0);
    for (const s of ['imbecis', 'otários', 'cretinas', 'vagabundos', 'babacas']) expect(caught(s).length, s).toBeGreaterThan(0);
  });
  it('accents and case do not hide a word; an apostrophe ends one', () => {
    expect(caught('ESTUPIDO')).toContain('estúpido');
    expect(caught('Quel crétin')).toContain('crétin');
    expect(hits("C'est l'idiot du village", 'idiot')).toBe(true);
    expect(hits('l’idiot', 'idiot')).toBe(true);
  });
  it('every floor word, alone, is caught by itself', () => {
    for (const w of FORBIDDEN_FLOOR) expect(caught(w), w).toContain(w);
  });
  it('innocent words the old containment stopped are free', () => {
    for (const s of ['Our familiar packaging', 'peculiar', 'a shiitake box', 'an idiotproof lid'])
      expect(caught(s), s).toEqual([]);
  });
  it('the guard still refuses, and says which word', () => {
    const r = guardForbidden({ reply: 'You liar.', ownerTerms: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.terms.map((t) => t.term)).toEqual(['liar']);
    expect(guardForbidden({ reply: 'A familiar shape.', ownerTerms: [] }).ok).toBe(true);
  });
});
