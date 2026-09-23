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
const entries = (l: 'en' | 'zh' | 'ar') => Object.entries(messages[l]) as [MessageKey, string][];

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
