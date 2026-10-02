import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { messages, t, ASSISTANT_FALLBACK, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { AR_BANNED_FORMS, AR_NAME_ADJACENT_NOUNS, AR_HUWA_HIYA_THINGS, ZH_IT_THINGS } from './assistant-pronouns.lists.js';

/**
 * THE ASSISTANT HAS NO PRONOUNS (decided 2026-09-23).
 *
 * Copy says the name the owner chose — `{name}` — or "your assistant" / 你的助手
 * / مساعدك until there is one. Never she/her/it, never 她/它, and in Arabic
 * nothing that agrees with her in either gender. In the same decision, Arabic
 * stopped addressing the OWNER in the feminine, and addresses nobody in a
 * gender at all.
 *
 * What a test can hold, and what it cannot:
 *  · English and Chinese pronouns are words, so they are banned outright.
 *  · Chinese 它 is also the ordinary word for a thing; it may stay only on a key
 *    listed with the reason it is not her (ZH_IT_THINGS — empty today).
 *  · Arabic carries gender in verb forms and suffixes, not in separate words. The
 *    test holds (a) هي/هو, (b) a verb right next to `{name}`, (c) vowel-marked
 *    feminine address, and (d) every exact form the sweep removed that can be
 *    nothing but a gendered address or a verb about her (AR_BANNED_FORMS). An
 *    implied subject with no marker is beyond a regex; that is what the native
 *    review list is for (docs/NATIVE-REVIEW-UI.md).
 *
 * Placeholders are stripped first: `{buyer}` is not a pronoun, and neither was
 * the old `{hers}` (renamed `{own}`).
 */

const strip = (s: string) => s.replace(/\{[a-zA-Z_]+\}/g, ' ');
const entries = (l: 'en' | 'zh' | 'ar' | 'es' | 'fr') => Object.entries(messages[l]) as [MessageKey, string][];

const AR_W = '[\\u0621-\\u064A\\u064B-\\u0652]';

describe('English: no pronoun for her', () => {
  it('no she/her/hers/herself/he/him/his/himself in any string', () => {
    const bad = entries('en').filter(([, v]) => /\b(she|her|hers|herself|he|him|his|himself)\b/i.test(strip(v)));
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });
});

describe('Chinese: no pronoun for her', () => {
  it('no 她, and no 他 (其他 aside)', () => {
    const bad = entries('zh').filter(([, v]) => /她|(?<!其)他/.test(strip(v)));
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });

  it('它 only where a listed reason says it is a thing, not her', () => {
    const bad = entries('zh').filter(([k, v]) => v.includes('它') && !(k in ZH_IT_THINGS));
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
    for (const [k, why] of Object.entries(ZH_IT_THINGS)) {
      expect(messages.zh[k as MessageKey], `${k} is listed but no longer says 它`).toContain('它');
      expect(why.length, `${k} needs a reason`).toBeGreaterThan(10);
    }
  });
});

describe('Arabic: nothing agrees with her, and nobody is addressed in a gender', () => {
  it('no هي / هو, except where a listed reason says it is a thing', () => {
    const re = new RegExp(`(?<!${AR_W})(هي|هو)(?!${AR_W})`);
    const bad = entries('ar').filter(([k, v]) => re.test(strip(v)) && !(k in AR_HUWA_HIYA_THINGS));
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });

  it('no verb right after {name} (a particle between counts)', () => {
    const re = new RegExp(`\\{name\\}\\s+(?:(?:لن|لا|لم|قد|سوف|ما|كانت|كان)\\s+)?([تي]${AR_W}{2,})`);
    const bad = entries('ar').filter(([, v]) => {
      const m = v.match(re);
      return m !== null && !AR_NAME_ADJACENT_NOUNS.includes(m[1]!.replace(/[ً-ْ]/g, ''));
    });
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });

  it('no feminine past tense right before {name}', () => {
    const re = new RegExp(`${AR_W}+(ت|ته|تها)\\s+\\{name\\}`);
    const bad = entries('ar').filter(([, v]) => re.test(v));
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });

  it('no vowel-marked feminine address (كِ تِ أنتِ)', () => {
    const bad = entries('ar').filter(([, v]) => /(كِ|تِ|أنتِ)(?![ء-ي])/.test(v));
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });

  // Compared EXACTLY AS WRITTEN, vowel marks included: «رُدّ» (reply!, to the
  // owner) is banned and «ردّ» (a reply) is the most common noun in the product.
  // Stripping the marks would make them the same word.
  it('none of the forms the sweep removed has come back', () => {
    expect(AR_BANNED_FORMS.length).toBeGreaterThan(0);
    const words = (v: string) => strip(v).split(/[^ء-يً-ْ]+/).filter(Boolean);
    const banned = new Set(AR_BANNED_FORMS);
    const bad = entries('ar').flatMap(([k, v]) => words(v).filter((w) => banned.has(w)).map((w) => `${k}: ${w}`));
    expect(bad).toEqual([]);
  });
});

// UI-es (0119) — Spanish carries gender in adjectives and participles, not
// only in pronouns. What a regex can hold: the pronouns themselves; an
// adjective or participle right after {name} and a linking verb ("{name} está
// lista"); and the owner addressed with one ("¿Estás seguro?", "Bienvenido").
// The rest is the native read's (docs/NATIVE-REVIEW-UI.md).
describe('Spanish: nobody is gendered', () => {
  it('no él / ella / ellos / ellas', () => {
    const bad = entries('es').filter(([, v]) => /(?<![\p{L}])(él|ella|ellos|ellas)(?![\p{L}])/iu.test(strip(v)));
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });
  it('no adjective or participle agreeing with {name} after a linking verb (a gerund is not one)', () => {
    const re = /\{name\}\s+(?:ya\s+|no\s+|también\s+)?(?:está|estará|estaba|estuvo|fue|será|era|queda|quedó|quedará|sigue|parece|anda)\s+(\p{L}+)/iu;
    const bad = entries('es').filter(([, v]) => {
      const m = v.match(re);
      return m !== null && /[oa]s?$/i.test(m[1]!) && !/(ando|iendo|endo)$/i.test(m[1]!) && !['en', 'a', 'para', 'sin', 'con', 'fuera', 'ahora', 'otra'].includes(m[1]!.toLowerCase());
    });
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });
  it('the owner is never addressed with a gendered word', () => {
    const bad = entries('es').filter(([, v]) => /(?<![\p{L}])(bienvenid[oa]s?|est[áa]s\s+(segur|list|conectad|registrad|suscrit)[oa]s?)(?![\p{L}])/iu.test(v));
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });
  it('the checks fire on the sentences they exist for', () => {
    expect(/(?<![\p{L}])(él|ella|ellos|ellas)(?![\p{L}])/iu.test('Ella responde')).toBe(true);
    expect(/(?<![\p{L}])(bienvenid[oa]s?|est[áa]s\s+(segur|list|conectad|registrad|suscrit)[oa]s?)(?![\p{L}])/iu.test('¿Estás seguro?')).toBe(true);
  });
});

// Phase 9 (0121) — French, like Spanish, carries gender in adjectives and
// participles. What a regex can hold: no elle/elles at all, il/ils only
// impersonal (il y a, il faut…); no adjective or participle after {name} and
// a linking verb; the owner never addressed with one ("Vous êtes connecté",
// "Bienvenu"). The rest is the native read's (docs/NATIVE-REVIEW-UI.md).
const FR_IMPERSONAL = /^(?:y\s+a|faut|reste|restait|manque|suffit|est\s+(?:temps|possible|impossible|préférable|inutile|utile|recommandé|conseillé|prudent|trop|déjà|encore)|vaut|s’agit|se\s+peut|n’y\s+a|ne\s+reste|ne\s+faut|n’est)/iu;
const FR_PERSONAL = (v: string): boolean => [...strip(v).matchAll(/(?<![\p{L}])(elles?|ils?)(?![\p{L}])\s*(.{0,24})/giu)]
  .some((m) => m[1]!.toLowerCase().startsWith('elle') || !FR_IMPERSONAL.test(m[2]!));
const FR_NAME_AGREES = /\{name\}\s+(?:n’)?(?:est|sera|était|reste|semble|devient|demeure)\s+(?:pas\s+|déjà\s+|encore\s+)?(?:prête?|sûre?|connectée?|occupée?|formée?|nommée?|arrêtée?|activée?|désactivée?|bloquée?|lancée?|prête?s?)(?![\p{L}])/iu;
const FR_OWNER_AGREES = /(?<![\p{L}])(?:bienvenue?s(?![\p{L}])|bienvenu(?![\p{L}e])|(?:vous\s+êtes|êtes-vous)\s+(?:sûre?s?|prête?s?|connectée?s?|inscrite?s?|abonnée?s?|certaine?s?|déconnectée?s?|seule?s?)(?![\p{L}]))/iu;
describe('French: nobody is gendered', () => {
  it('no elle / elles, and il / ils only impersonal', () => {
    const bad = entries('fr').filter(([, v]) => FR_PERSONAL(v));
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });
  it('no adjective or participle agreeing with {name} after a linking verb', () => {
    const bad = entries('fr').filter(([, v]) => FR_NAME_AGREES.test(v));
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });
  it('the owner is never addressed with a word that agrees', () => {
    const bad = entries('fr').filter(([, v]) => FR_OWNER_AGREES.test(v));
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });
  it('the checks fire on the sentences they exist for, and not on impersonal il', () => {
    expect(FR_PERSONAL('Elle répond vite')).toBe(true);
    expect(FR_PERSONAL('Il répond vite')).toBe(true);
    expect(FR_PERSONAL('Il faut un prix')).toBe(false);
    expect(FR_NAME_AGREES.test('{name} est prête')).toBe(true);
    expect(FR_OWNER_AGREES.test('Vous êtes connecté')).toBe(true);
    expect(FR_OWNER_AGREES.test('Bienvenu')).toBe(true);
    expect(FR_OWNER_AGREES.test('Bienvenue')).toBe(false);
  });
});

describe('the name, and what is said when there is none', () => {
  it('with no name confirmed, {name} is "your assistant", capitalised only where a sentence starts', () => {
    expect(t('en', 'nav.employee')).toBe('Your assistant');
    expect(t('zh', 'nav.employee')).toBe(ASSISTANT_FALLBACK.zh);
    expect(t('ar', 'nav.employee')).toBe(ASSISTANT_FALLBACK.ar);
    const mid = (Object.entries(messages.en) as [MessageKey, string][])
      .find(([, v]) => /^[^{]*[a-z][^.!?{]*\{name\}/.test(v));
    expect(mid, 'a string with {name} mid-sentence').toBeDefined();
    expect(t('en', mid![0])).toContain('your assistant');
    expect(t('en', mid![0])).not.toContain('Your assistant');
  });

  it('a confirmed name goes in as it is, and the capitalised label is read as the phrase', () => {
    expect(t('en', 'nav.employee', { name: 'Maya' })).toBe('Maya');
    expect(t('en', 'nav.employee', { name: 'Your assistant' })).toBe('Your assistant');
  });

  it('no buyer-facing page says {name}: it would say "your assistant" to a buyer', () => {
    for (const l of ['en', 'zh', 'ar'] as const) {
      const bad = entries(l).filter(([k, v]) => /^(legal|proof|unsub)\./.test(k) && v.includes('{name}'));
      expect(bad.map(([k]) => `${l} ${k}`)).toEqual([]);
    }
  });
});

describe('what the model reads', () => {
  const dir = fileURLToPath(new URL('../../prompts/', import.meta.url));
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt'))) {
    it(`prompts/${f} gives her no pronoun`, () => {
      const text = readFileSync(dir + f, 'utf8');
      expect(text).not.toMatch(/\b(she|her|hers|herself)\b/i);
      expect(text).not.toMatch(/她/);
    });
  }
});

describe('Phase 9 · the name joins the sentence the way its script does (V1-008, V1-010)', () => {
  it('Chinese: no stray spaces around 你的助手 or a Chinese name; a Latin name keeps them', () => {
    const k = (Object.entries(messages.zh) as [MessageKey, string][]).find(([, v]) => /[一-鿿] \{name\}/.test(v))![0];
    expect(t('zh', k)).not.toMatch(/ 你的助手|你的助手 /);
    expect(t('zh', k, { name: '小雅' })).not.toMatch(/ 小雅|小雅 /);
    expect(t('zh', k, { name: 'Lily' })).toMatch(/ Lily/);
  });
  it('Arabic: لـ joins مساعدك and an Arabic name, and stays apart before a Latin one', () => {
    const k = (Object.entries(messages.ar) as [MessageKey, string][]).find(([, v]) => /لـ\s*\{name\}/.test(v))![0];
    expect(t('ar', k)).toContain('لمساعدك');
    expect(t('ar', k)).not.toContain('لـ مساعدك');
    expect(t('ar', k, { name: 'ياسمين' })).toContain('لياسمين');
    expect(t('ar', k, { name: 'Lily' })).toContain('لـ Lily');
  });
});
