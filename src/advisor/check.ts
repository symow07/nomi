import type { Locale } from '../core/owner/i18n/locale.js';

/**
 * THE ADVISOR'S RULE 4 (docs/ADVISOR-GROUNDING.md): "Every answer is checked before it is shown. Any number,
 * date, amount or customer name in the model's sentence that is not in the query's result throws the
 * sentence away." What it checks, in the model's sentence against the facts it was given:
 *
 *   · every figure (digits in any script, separators ignored) is one the facts carry;
 *   · no number written as a word ("three", 三, ثلاثة) unless the facts say that word;
 *   · no percentage, ever (the product computes none);
 *   · no month and no currency the facts do not name;
 *   · no customer's or product's name of this workspace that the facts do not carry;
 *   · nobody gendered (rule 6, decided 2026-09-23): no he / she, 他 / 她, él / ella, elle, and no Arabic
 *     هو / هي where a customer is named — a customer is their name, repeated;
 *   · nothing of the instructions ("FACTS", "QUESTION");
 *   · and what the facts say must be said is there (reply times: the median, the replies measured, and the
 *     messages still unanswered — together, or not at all).
 *
 * Strict on purpose: a sentence it throws away is replaced by the facts themselves, so a false alarm costs
 * a stiffer answer, never a wrong one.
 */

export type CheckInput = {
  readonly facts: readonly string[];
  /** The names the facts carry. */
  readonly names: readonly string[];
  /** Every customer's and product's name in the workspace. */
  readonly known: readonly string[];
  readonly must?: readonly string[];
  readonly locale: Locale;
};
export type CheckResult = { readonly ok: true } | { readonly ok: false; readonly why: string };

const ISOLATES = /[\u2066-\u2069\u200e\u200f\u202a-\u202e\u061c]/g;
/** Digits of every script the product writes, as ASCII; marks of direction gone; width folded. */
export const normalise = (s: string): string => s.normalize('NFKC').replace(ISOLATES, '')
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
/** Each figure, its separators (, . ' spaces ٬ ٫) dropped: "1,250.00" and "1 250,00" are both 125000. */
const figures = (s: string): string[] =>
  [...normalise(s).matchAll(/\d(?:[\d.,'  ٫٬ ]*\d)?/g)].map((m) => m[0].replace(/\D/g, ''));

const WORDS: Readonly<Record<Locale, readonly string[]>> = {
  en: ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
    'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
    'hundred', 'thousand', 'million', 'billion', 'dozen', 'half', 'double', 'twice', 'triple'],
  es: ['dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'veinte', 'treinta', 'cuarenta',
    'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa', 'cien', 'ciento', 'mil', 'millón', 'millones', 'mitad', 'doble'],
  fr: ['deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'vingt', 'trente', 'quarante',
    'cinquante', 'soixante', 'cent', 'mille', 'million', 'millions', 'moitié', 'double'],
  ar: ['اثنان', 'اثنين', 'اثنتين', 'ثلاثة', 'ثلاث', 'أربعة', 'أربع', 'خمسة', 'خمس', 'ستة', 'ست', 'سبعة', 'سبع', 'ثمانية', 'ثماني', 'تسعة', 'تسع',
    'عشرة', 'عشر', 'عشرون', 'عشرين', 'مئة', 'مائة', 'ألف', 'آلاف', 'مليون', 'نصف', 'ضعف'],
  zh: [],
};
const CJK_NUMERALS = /[二三四五六七八九十百千万亿两]/g;
const PERCENT = /[%٪％]|\bper ?cent\b|\bpercentage\b|\bpor ?ciento\b|\bpour ?cent\b|\bpourcentage\b|بالمئة|بالمائة|في المئة|百分/i;
const CURRENCIES = /\b(USD|CNY|RMB|AED|SAR|BRL|MXN|INR|IDR|EUR|GBP|JPY)\b|[$€£¥₹]|US\$|R\$|MX\$|درهم|ريال|元|美元|人民币|dólar|réal|euro/gi;
const months = (locale: Locale): string[] => {
  const out: string[] = [];
  for (const style of ['long', 'short'] as const) {
    const f = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : locale, { month: style, timeZone: 'UTC' });
    for (let m = 0; m < 12; m++) out.push(f.format(new Date(Date.UTC(2026, m, 15))).replace(/\.$/, ''));
  }
  return [...new Set(out.filter((m) => !/\d/.test(m) && m.length >= 3))];
};
/** A pronoun that genders a person (rule 6). French "il" is left out: it is also "il y a", "il reste". */
const GENDERED: Readonly<Record<Locale, RegExp | null>> = {
  en: /\b(she|her|hers|herself|he|him|his|himself)\b/i,
  es: /(?<![\p{L}])(él|ella|ellas)(?![\p{L}])/iu,
  fr: /(?<![\p{L}])(elle|elles)(?![\p{L}])/iu,
  zh: /[他她]/,
  ar: null,
};
const word = (w: string): RegExp => new RegExp(`(?<![\\p{L}\\p{M}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{M}])`, 'iu');

export function checkPhrasing(text: string, o: CheckInput): CheckResult {
  const said = normalise(text);
  const facts = normalise([...o.facts, ...o.names].join('\n'));
  const lower = facts.toLocaleLowerCase();
  const allowed = new Set(figures(facts));
  for (const f of figures(said)) if (!allowed.has(f)) return { ok: false, why: `figure ${f}` };
  for (const w of WORDS[o.locale]) if (word(w).test(said) && !word(w).test(facts)) return { ok: false, why: `number word ${w}` };
  if (o.locale === 'zh') {
    for (const c of said.match(CJK_NUMERALS) ?? []) if (!facts.includes(c)) return { ok: false, why: `numeral ${c}` };
  }
  if (PERCENT.test(said)) return { ok: false, why: 'percentage' };
  for (const m of months(o.locale)) if (word(m).test(said) && !word(m).test(facts)) return { ok: false, why: `month ${m}` };
  for (const c of said.match(CURRENCIES) ?? []) if (!lower.includes(c.toLocaleLowerCase())) return { ok: false, why: `currency ${c}` };
  const carried = new Set(o.names.map((n) => normalise(n).toLocaleLowerCase()));
  for (const n of o.known) {
    const k = normalise(n).toLocaleLowerCase();
    if (k.length >= 3 && !carried.has(k) && !lower.includes(k) && word(k).test(said.toLocaleLowerCase())) return { ok: false, why: `name ${n}` };
  }
  const gendered = GENDERED[o.locale];
  if (gendered?.test(said)) return { ok: false, why: 'a gendered pronoun' };
  // Arabic: when the facts name a customer, no he / she / they standing alone (with و or ف before it). The
  // copula over a figure ("عدد الطلبات هو") is fine where no one is named.
  if (o.locale === 'ar' && o.names.some((x) => x.trim().length >= 2) && /(?:^|[\s،:.؛])[وف]?(?:هو|هي|هما|هم|هن)(?=[\s،:.؛]|$)/u.test(said)) {
    return { ok: false, why: 'a gendered pronoun' };
  }
  // The prompt's own words never reach the owner.
  if (/\b(FACTS?|QUESTION)\b/.test(text)) return { ok: false, why: 'the instructions' };
  for (const m of o.must ?? []) {
    const need = figures(m);
    const have = new Set(figures(said));
    if (need.length ? need.some((f) => !have.has(f)) : !said.includes(normalise(m))) return { ok: false, why: `missing ${m}` };
  }
  return { ok: true };
}
