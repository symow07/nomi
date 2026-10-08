import { describe, it, expect } from 'vitest';
import { validateSignup, MIN_AGE } from '../../src/core/owner/signup.js';
import { TERMS_KEYS } from '../../src/core/legal/terms.js';
import { renderLegalTerms } from '../../src/api/web/legal.js';
import { signupPage, esc } from '../../src/api/web/layout.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * AGE (docs/PRE-LAUNCH.md item 1, 2026-10-08) — sign-up asks the age, plainly, and refuses anyone under 18: the
 * terms are agreed for a business, and every child under COPPA's thirteen is kept out with them. Only that the
 * answer passed is kept. Over Postgres, with the cookie that keeps a refused browser refused:
 * tests/integration/g1-signup.test.ts.
 */

const good = {
  factory: 'Oud House', name: 'Rana', email: 'rana@oud.example', password: 'correct horse battery', invite: '',
  kind: 'retail', sells: 'Perfume oils', country: 'AE', website: '', teamSize: '2-5', channels: ['instagram'], terms: 'on', age: '34',
};
const opts = { mode: 'open' as const, passwordMin: 10, passwordMax: 200 };
/** A page as read: Arabic pages set each figure apart with direction isolates, which the words themselves lack. */
const read = (html: string) => html.replace(/[\u2066-\u2069]/g, '');
const problemOf = (age: string) => {
  const v = validateSignup({ ...good, age }, opts);
  return v.ok ? null : v.problems.age ?? null;
};

describe('AGE · the age at sign-up', () => {
  it('the youngest who may sign a business up is 18', () => {
    expect(MIN_AGE).toBe(18);
  });

  it('an age is whole years, 1 to 130; under 18 refuses the sign-up; 18 and over passes', () => {
    for (const a of ['18', '34', '130', ' 40 ']) expect(problemOf(a), a).toBeNull();
    for (const a of ['', ' ', 'abc', '0', '131', '17.5', '-3', '1e2', '٣٤']) expect(problemOf(a), a).toBe('age_missing');
    for (const a of ['17', '13', '12', '1']) expect(problemOf(a), a).toBe('age_under');
  });

  for (const locale of LOCALES) {
    const l = locale as Locale;
    it(`${l} · the form asks it plainly: a labelled number box, and nothing on the form says the minimum`, () => {
      const form = signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10 });
      expect(form).toContain(`<label for="su-age">${esc(t(l, 'signup.age'))}</label>`);
      expect(form).toMatch(/<input id="su-age" type="number" name="age" value="" required min="1" max="130"/);
      expect(form).not.toContain(esc(t(l, 'signup.problem.age_under')));
      // a form sent back for another reason keeps the age typed
      expect(signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10, values: { age: '41' } })).toContain('name="age" value="41"');
    });

    it(`${l} · refused: the minimum, said once, and no form to answer again`, () => {
      const page = read(signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10, ageRefused: true }));
      expect(page).toContain(`role="alert">${esc(t(l, 'signup.problem.age_under'))}</p>`);
      expect(page).not.toContain('action="/signup"');
      expect(page).not.toContain('name="age"');
    });

    it(`${l} · the terms say it, first of what the business undertakes`, () => {
      const terms = read(renderLegalTerms(l, null));
      expect(terms).toContain(esc(t(l, 'legal.terms.yours.you0')));
      expect(terms.indexOf(esc(t(l, 'legal.terms.yours.you0')))).toBeLessThan(terms.indexOf(esc(t(l, 'legal.terms.yours.you1'))));
    });
  }

  it('the terms\' version moved with the words: the new line is one of the keys it is digested from', () => {
    expect(TERMS_KEYS).toContain('legal.terms.yours.you0');
  });
});
