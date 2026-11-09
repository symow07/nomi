import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { asksPriceOrAvailability } from '../../src/core/channel/commentQuestions.js';

/** Labelled examples: asks seek a price or stock; praise, prices stated and unrelated questions do not. */
const corpus = {
  en: {
    yes: ['How much?', 'Price please', 'What is the price of this bag?', 'How much does it cost?', 'Can you tell me the price?', 'Is this available?', 'Is the blue one in stock?', 'Do you have this in red?', 'Any stock left?', 'Can I buy this?'],
    no: ['Beautiful bag!', 'The price is too high', 'I love this colour', 'How are you?', 'Where are you based?', 'Thanks for the price', 'Not asking about the price', 'It costs 20 dollars', 'We have this in stock', 'I do not want to buy this'],
  },
  zh: {
    yes: ['多少钱？', '这个什么价格？', '请问价格', '这件怎么卖？', '能告诉我价钱吗？', '有货吗？', '红色还有吗？', '这个有现货吗？', '现在可以买到吗？', '请问还有库存吗？'],
    no: ['很好看', '价格太贵了', '谢谢告诉我价格', '我不问价格', '今天多少钱都不买', '哪里发货？', '我已经买了', '我们有货', '这是我的包', '库存终于到了'],
  },
  ar: {
    yes: ['بكم؟', 'كم السعر؟', 'ما سعر هذه الحقيبة؟', 'السعر من فضلك', 'كم ثمنه؟', 'هل متوفر؟', 'هل هذا متاح؟', 'هل يوجد اللون الأحمر؟', 'عندكم هذا؟', 'هل في مخزون؟'],
    no: ['جميل جدا', 'السعر غالي', 'شكرا على السعر', 'لا أسأل عن السعر', 'لا أريد شراء هذا', 'أين المتجر؟', 'اشتريت هذا', 'عندنا مخزون', 'أحب هذا اللون', 'سعره عشرون'],
  },
  es: {
    yes: ['¿Cuánto cuesta?', 'Precio por favor', '¿Cuál es el precio?', '¿Qué precio tiene?', '¿Cuánto vale?', '¿Está disponible?', '¿Tienen en rojo?', '¿Hay stock?', '¿Queda alguna?', '¿Puedo comprar este?'],
    no: ['¡Qué bonito!', 'El precio es muy alto', 'Gracias por el precio', 'No pregunto el precio', 'No quiero comprar esto', '¿Dónde están?', 'Ya lo compré', 'Tenemos stock', 'Me encanta el color', 'Cuesta veinte euros'],
  },
  fr: {
    yes: ['Combien coûte ce sac ?', 'Le prix svp', 'Quel est le prix ?', 'Ça coûte combien ?', 'À combien ?', 'Est-ce disponible ?', 'Vous avez en bleu ?', 'En stock ?', 'Il en reste ?', 'Puis-je acheter celui-ci ?'],
    no: ['Magnifique !', 'Le prix est trop élevé', 'Merci pour le prix', 'Je ne demande pas le prix', 'Je ne veux pas acheter', 'Vous êtes où ?', 'Je l’ai déjà acheté', 'Nous avons du stock', 'J’aime la couleur', 'Il coûte vingt euros'],
  },
  pt: {
    yes: ['Quanto custa?', 'Preço por favor', 'Qual é o preço?', 'Qual o valor?', 'Quanto fica?', 'Está disponível?', 'Tem em azul?', 'Tem estoque?', 'Ainda tem?', 'Posso comprar este?'],
    no: ['Que lindo!', 'O preço é muito alto', 'Obrigado pelo preço', 'Não pergunto o preço', 'Não quero comprar', 'Onde fica a loja?', 'Já comprei', 'Temos estoque', 'Adoro a cor', 'Custa vinte reais'],
  },
} as const;

/**
 * Asks the detector missed in review (2026-11-10), each with its reason. A missed ask is `not_asking`: no alert, no reply.
 * A new phrasing goes here first, with its reason, never into the patterns alone. `rule` names the pattern it witnesses.
 */
const reviewed: readonly { language: string; text: string; asks: boolean; reason: string; rule?: string }[] = [
  { language: 'zh', text: '价格是多少？', asks: true, rule: 'zh-price-is', reason: '"What is the price?": the price as subject, 是多少 after it.' },
  { language: 'zh', text: '可以告诉我价格吗？', asks: true, rule: 'zh-price-tell', reason: '"Can you tell me the price?": a request ending in the question particle 吗.' },
  { language: 'zh', text: '谢谢告诉我价格', asks: false, reason: 'Thanks for telling me the price: the same words with no 吗 are a statement.' },
  { language: 'ar', text: 'كم سعر هذا المنتج؟', asks: true, rule: 'ar-price-kam', reason: '"How much is the price of this product?": كم before an indefinite سعر.' },
  { language: 'ar', text: 'ممكن السعر؟', asks: true, rule: 'ar-price-mumkin', reason: '"The price, possible?": a polite request for the price.' },
  { language: 'ar', text: 'هل هو موجود في المخزون؟', asks: true, rule: 'ar-stock-mawjud', reason: '"Is it in stock?": هل with a pronoun before موجود.' },
  { language: 'ar', text: 'هل بقي منه شيء؟', asks: true, rule: 'ar-stock-baqi', reason: '"Is any of it left?": هل with بقي.' },
  { language: 'es', text: '¿Me dices el precio?', asks: true, rule: 'es-price-tell', reason: '"Will you tell me the price?".' },
  { language: 'es', text: '¿Quedan unidades?', asks: true, rule: 'es-stock-quedan', reason: '"Are there units left?".' },
  { language: 'es', text: '¿Hay en azul?', asks: true, rule: 'es-stock-hay-en', reason: '"Is there one in blue?": hay en opening the clause.' },
  { language: 'es', text: 'No hay en mi talla', asks: false, reason: 'A statement that there is none in my size: hay en does not open the clause.' },
  { language: 'es', text: '¿Tienen talla M disponible?', asks: true, rule: 'es-stock-talla', reason: '"Do you have size M available?".' },
  { language: 'fr', text: 'Combien ça coûte ?', asks: true, rule: 'fr-price-ca', reason: '"How much does it cost?" with ça between combien and coûte.' },
  { language: 'fr', text: 'C’est combien ?', asks: true, rule: 'fr-price-cest', reason: '"How much is it?".' },
  { language: 'fr', text: 'Vous pouvez me donner le prix ?', asks: true, rule: 'fr-price-give', reason: '"Can you give me the price?".' },
  { language: 'fr', text: 'Il vous en reste ?', asks: true, rule: 'fr-stock-vous-reste', reason: '"Do you have any left?": vous between il and en reste.' },
  { language: 'fr', text: 'Le bleu est-il disponible ?', asks: true, rule: 'fr-stock-inverted', reason: '"Is the blue one available?": the inverted question.' },
  { language: 'pt', text: 'Pode me dizer o preço?', asks: true, rule: 'pt-price-tell', reason: '"Can you tell me the price?".' },
  { language: 'pt', text: 'Tem na cor azul?', asks: true, rule: 'pt-stock-cor', reason: '"Do you have it in blue?": tem na cor opening the clause.' },
  { language: 'pt', text: 'Tem tamanho M disponível?', asks: true, rule: 'pt-stock-tamanho', reason: '"Do you have size M available?".' },
  // The negation reaches only its own clause: a later clause's ask still counts.
  { language: 'en', text: 'I don\'t want the red one, do you have it in blue?', asks: true, rule: 'clauses', reason: 'The negation is about the red one; the next clause asks.' },
  { language: 'es', text: 'No quiero el rojo, ¿tienen este en azul?', asks: true, rule: 'clauses', reason: 'Same shape in Spanish: a negated preference, then an availability question.' },
  { language: 'en', text: 'I\'m not asking how much, just saying it\'s lovely', asks: false, reason: 'The negation and the price phrase share their clause: a statement.' },
  { language: 'zh', text: '不问多少钱，就是喜欢', asks: false, reason: '"Not asking the price, just like it": the negation in the price clause.' },
  { language: 'es', text: 'No pregunto cuánto cuesta, solo me encanta', asks: false, reason: '"I am not asking what it costs": the negation in the price clause.' },
];

describe('comments asking a price or availability · six languages, no model', () => {
  for (const [language, cases] of Object.entries(corpus)) {
    for (const text of cases.yes) it(`${language} asks: ${text}`, () => expect(asksPriceOrAvailability(text)).toBe(true));
    for (const text of cases.no) it(`${language} leaves alone: ${text}`, () => expect(asksPriceOrAvailability(text)).toBe(false));
  }
  for (const c of reviewed) it(`${c.language} reviewed ${c.asks ? 'asks' : 'leaves alone'}: ${c.text}`, () => expect(asksPriceOrAvailability(c.text), c.reason).toBe(c.asks));
  it('normalizes width, case, accents and spacing without inventing a question', () => {
    expect(asksPriceOrAvailability('ＰＲＩＣＥ　please')).toBe(true);
    expect(asksPriceOrAvailability('  QUANTO   CUSTA?? ')).toBe(true);
    expect(asksPriceOrAvailability('')).toBe(false);
    expect(asksPriceOrAvailability('x'.repeat(4001))).toBe(false);
  });
});

/** Run the actual pure function with one production pattern disabled, not a second detector. */
it('each production rule, the negation guard and the clause split has a failing labelled witness when removed', () => {
  const source = readFileSync(new URL('../../src/core/channel/commentQuestions.ts', import.meta.url), 'utf8');
  const executable = (code: string): ((text: string) => boolean) => new Function(code
    .replace(' as const;', ';').replace('export function', 'function')
    .replaceAll(': string', '').replaceAll('): boolean', ')') + '; return asksPriceOrAvailability;')() as (text: string) => boolean;
  const lines = source.split('\n').filter(line => line.includes("{ id: '"));
  expect(lines).toHaveLength(30);
  const yes = [...Object.values(corpus).flatMap(c => c.yes), ...reviewed.filter(c => c.asks).map(c => c.text)];
  for (const line of lines) {
    const id = /\{ id: '([^']+)'/.exec(line)![1];
    const disabled = executable(source.replace(line, ''));
    expect(yes.some(text => !disabled(text)), line).toBe(true);
    const own = reviewed.filter(c => c.rule === id);
    if (id.split('-').length > 2) expect(own.length, `${id} has a witness`).toBeGreaterThan(0);
    for (const c of own) expect(disabled(c.text), `${id} switched off: ${c.text}`).toBe(false);
  }
  const no = [...Object.values(corpus).flatMap(c => c.no), ...reviewed.filter(c => !c.asks).map(c => c.text)];
  const noNegation = executable(source.replace('if (!folded || NEGATED.test(folded)) return false;', 'if (!folded) return false;'));
  expect(no.some(text => noNegation(text))).toBe(true);
  const wholeText = executable(source.replace('text.split(CLAUSE_END)', '[text]'));
  for (const c of reviewed.filter(c => c.rule === 'clauses')) expect(wholeText(c.text), `no clause split: ${c.text}`).toBe(false);
});
