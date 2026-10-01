import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseOptions, formatOptions, optionsOf, MAX_OPTIONS } from '../../src/core/commerce/options.js';
import { stockQuestionLanguage, asksAboutStock } from '../../src/core/scoring/detect.js';
import { PROBLEM_SIGNAL_KINDS, TRIGGER_REASONS, toTriggerReason, SIGNAL_SAMPLES } from '../../src/core/scoring/signals.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * VAR (0111, decision 31) — a product's options (sizes, colours, shades) with
 * no price or stock of their own; a question about stock goes to the owner.
 * The turn: tests/pipeline/options.test.ts. Over Postgres:
 * tests/integration/var-options.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('VAR · options, as the owner types them', () => {
  it('one a line, or joined by " · "; values by commas in any script; a slash stays inside a value', () => {
    expect(parseOptions('Size: S, M, L\nColour: black, white')).toEqual({ ok: true, options: [
      { name: 'Size', values: ['S', 'M', 'L'] }, { name: 'Colour', values: ['black', 'white'] }] });
    expect(parseOptions('Size: S/M, L/XL · Shade: 01 Rose')).toEqual({ ok: true, options: [
      { name: 'Size', values: ['S/M', 'L/XL'] }, { name: 'Shade', values: ['01 Rose'] }] });
    expect(parseOptions('尺码：S，M、L')).toEqual({ ok: true, options: [{ name: '尺码', values: ['S', 'M', 'L'] }] });
    expect(parseOptions('Size: S, s, M')).toEqual({ ok: true, options: [{ name: 'Size', values: ['S', 'M'] }] });
    expect(parseOptions('  ')).toEqual({ ok: true, options: [] });
  });
  it('one bad line refuses them all, and says which way', () => {
    expect(parseOptions('S, M, L')).toEqual({ ok: false, error: 'no_name' });
    expect(parseOptions('Size:')).toEqual({ ok: false, error: 'no_values' });
    expect(parseOptions(Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `O${i}: a`).join('\n'))).toEqual({ ok: false, error: 'too_many_options' });
    expect(parseOptions(`Size: ${'x'.repeat(41)}`)).toEqual({ ok: false, error: 'too_long' });
  });
  it('written back the way they are read; what the database holds is options only in their exact shape', () => {
    const o = [{ name: 'Size', values: ['S', 'M'] }, { name: 'Colour', values: ['black'] }];
    expect(formatOptions(o)).toBe('Size: S, M · Colour: black');
    expect(parseOptions(formatOptions(o, '\n'))).toEqual({ ok: true, options: o });
    expect(optionsOf(o)).toEqual(o);
    for (const bad of [null, 'Size: S', [{ name: 'Size' }], [{ name: 1, values: [] }], [{ name: 'x', values: [1] }]]) expect(optionsOf(bad)).toEqual([]);
  });
});

describe('VAR · the reply is given them, whole', () => {
  it('the turn reads the identified product\'s options, passes them to the writer, and sources their figures', () => {
    const turn = src('src/pipeline/turn.ts');
    expect(turn).toContain('const options = identifiedProductId === null ? [] : await tenant.catalog.productOptions(identifiedProductId);');
    expect(turn).toContain('...optionNumbers,');
    expect(turn).toContain('...(options.length ? { options } : {}),');
    expect(src('src/llm/anthropic.ts')).toContain('...(options?.length ? { options: options.map((o) => ({ name: o.name, values: o.values })) } : {}),');
  });
  it('the prompt: options answered only from what is listed; stock never stated', () => {
    const p = src('prompts/response.txt');
    expect(p).toContain('OPTIONS: when CONTEXT.options is present');
    expect(p).toContain('Never invent an option or describe one that is not listed.');
    expect(p).toContain('STOCK: nothing you are given says what is in stock');
  });
  it('a practice copy reads its live product\'s; the store import fills them', () => {
    expect(src('migrations/0111_product_options.sql')).toContain('select coalesce(src.options, p.options)');
    expect(src('src/api/web/products.ts')).toContain('update products set options = ${JSON.stringify(parsed.options)}::jsonb where id = ${id}::uuid');
  });
});

describe('VAR · a question about stock goes to the owner', () => {
  it('its own signal: a problem that hands off, with its own reason in every language', () => {
    expect(PROBLEM_SIGNAL_KINDS).toContain('stock_asked');
    expect(TRIGGER_REASONS).toContain('stock_asked');
    expect(toTriggerReason(SIGNAL_SAMPLES.stock_asked)).toBe('stock_asked');
    expect(src('migrations/0111_product_options.sql').match(/'allowance_used','stock_asked'\)\);/g)).toHaveLength(2);
    for (const l of LOCALES) expect(t(l, 'takeover.reason.stock_asked' as MessageKey)).not.toBe('takeover.reason.stock_asked');
  });

  /** [language the pattern is in, the customer's words]. */
  const ASKS: readonly (readonly [string, string])[] = [
    ['en', 'Is it in stock?'], ['en', 'Do you have any left?'], ['en', 'How many do you have left?'], ['en', 'Is the black one sold out?'],
    ['en', 'When will it be back in stock?'], ['en', 'Is it available now?'],
    ['zh', '有货吗？'], ['zh', '还有现货吗'], ['zh', '黑色的缺货了吗'], ['zh', '什么时候补货？'], ['zh', '库存多少'],
    ['ar', 'هل هو متوفر حاليا؟'], ['ar', 'هل يوجد مخزون؟'], ['ar', 'نفدت الكمية؟'], ['ar', 'متى يرجع؟'],
    ['es', '¿Hay stock?'], ['es', '¿Está agotado?'], ['es', '¿Cuántos quedan?'], ['es', '¿Tienen stock del negro?'],
    ['fr', 'Est-il épuisé ?'], ['fr', 'Combien il en reste ?'], ['fr', 'Rupture de stock ?'],
    ['pt', 'Tem em estoque?'], ['pt', 'Está esgotado?'], ['pt', 'Quantos restam?'], ['pt', 'Está disponível agora?'],
  ];
  for (const [lang, text] of ASKS) {
    it(`asks (${lang}) — ${JSON.stringify(text)}`, () => {
      expect(asksAboutStock(text), text).toBe(true);
      expect(stockQuestionLanguage(text), text).toBe(lang);
    });
  }
  it('"en stock" is Spanish and French: asked, and no pattern names the language (the word list does)', () => {
    expect(asksAboutStock("Vous l'avez en stock ?")).toBe(true);
    expect(stockQuestionLanguage("Vous l'avez en stock ?")).toBeNull();
    expect(asksAboutStock('¿Lo tienen en stock?')).toBe(true);
    expect(stockQuestionLanguage('¿Lo tienen en stock?')).toBeNull();
  });
  /** [the customer's words, why it is not about stock]. */
  const NOT: readonly (readonly [string, string])[] = [
    ['Do you have it in black?', 'an option'], ['Is it available in M?', 'an option'], ['How many colours does it come in?', 'how many — of options'],
    ['Can I use the stock photo on my site?', '"stock" as in photos'], ['Printed on card stock?', 'a paper'], ['How many do I need for 20 guests?', 'their need'],
    ['有黑色吗？', 'an option'], ['这个有什么尺码', 'an option'], ['هل متوفر باللون الأسود؟', 'an option'],
    ['¿Lo tienen en negro?', 'an option'], ['Vous l\'avez en noir ?', 'an option'], ['Tem na cor preta?', 'an option'],
    ['Qual o estoque de ideias?', 'a figure of speech? still "estoque" without a stock verb'],
  ];
  for (const [text, why] of NOT) {
    it(`not about stock — ${why}: ${JSON.stringify(text)}`, () => { expect(asksAboutStock(text), text).toBe(false); });
  }
});
