import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GDPR_COUNTRIES, euUkSignupOpenFrom, signupHeldForTransfer } from '../../src/core/legal/transfer.js';
import { isCountryCode, canonicalCountry } from '../../src/core/owner/business.js';
import { signupPage, esc } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * A business in the EU, the EEA or the UK waits at sign-up until counsel's checklist line is cleared (the owner,
 * 2026-10-28; src/core/legal/transfer.ts). The list, the switch, the page; through the production composition:
 * tests/integration/eu-uk-signup-hold.test.ts.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');

describe('the EU, the EEA and the UK at sign-up', () => {
  it('the GDPR\'s countries: the EU\'s 27, the EEA\'s 3 and the UK — each one sign-up offers', () => {
    expect(GDPR_COUNTRIES.size).toBe(31);
    for (const c of GDPR_COUNTRIES) expect(isCountryCode(c), c).toBe(true);
    for (const c of ['FR', 'DE', 'ES', 'IE', 'NO', 'IS', 'LI', 'GB']) expect(GDPR_COUNTRIES.has(c), c).toBe(true);
    // laws of their own, or no GDPR at all
    for (const c of ['CH', 'JE', 'GG', 'IM', 'GI', 'MA', 'US', 'CN', 'AE', 'TR']) expect(GDPR_COUNTRIES.has(c), c).toBe(false);
    // "UK", as people type it, is the GB the list holds
    expect(signupHeldForTransfer(canonicalCountry('UK'), false)).toBe(true);
  });

  it('the owner (2026-10-30): one line under the country field says so before anyone picks — every language, error or not', () => {
    for (const l of LOCALES) {
      const line = `<div class="hint">${esc(t(l, 'signup.country.hint'))}</div>`;
      for (const html of [
        signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10 }),
        signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10, problems: { country: 'Pick a country.' } }),
      ]) {
        const at = html.indexOf(line);
        if (html.includes('Pick a country.')) expect(at, l).toBeGreaterThan(html.indexOf('Pick a country.'));
        expect(at, l).toBeGreaterThan(html.indexOf('id="su-country"'));
        expect(html.indexOf(line, at + 1), l).toBe(-1);
      }
    }
    expect(t('en', 'signup.country.hint')).toBe('Businesses in the EU, the EEA and the UK can’t sign up yet.');
  });

  it('only EU_UK_SIGNUP=open lifts the hold; unset or anything else holds', () => {
    expect(euUkSignupOpenFrom('open')).toBe(true);
    expect(euUkSignupOpenFrom(' open ')).toBe(true);
    for (const v of [undefined, '', 'yes', 'true', '1', 'OPEN', 'opened']) expect(euUkSignupOpenFrom(v), String(v)).toBe(false);
    expect(signupHeldForTransfer('FR', false)).toBe(true);
    expect(signupHeldForTransfer('FR', true)).toBe(false);
    expect(signupHeldForTransfer('AE', false)).toBe(false);
  });

  it('production reads the switch; the route asks it before a code is sent and again at /verify', () => {
    expect(read('src/main.ts')).toContain(`euUkSignupOpen: euUkSignupOpenFrom(process.env['EU_UK_SIGNUP'])`);
    const app = read('src/api/web/app.ts');
    const held = app.indexOf('if (transferHeld(canonicalCountry(raw.country.trim().toUpperCase())))');
    expect(held).toBeGreaterThan(0);
    // after the age's refusal, before the form's other questions are sent back
    expect(held).toBeGreaterThan(app.indexOf(`v.problems.age === 'age_under'`));
    expect(held).toBeLessThan(app.indexOf('return again(400, { problems })', held));
    expect(held).toBeLessThan(app.indexOf('botCheck.verify(', held));
    expect(held).toBeLessThan(app.indexOf('await sendCode(reply, locale, wanted.email', held));
    const verify = app.indexOf(`app.post('/verify'`);
    const again = app.indexOf('if (transferHeld(p.profile.country))', verify);
    expect(again).toBeGreaterThan(verify);
    expect(again).toBeLessThan(app.indexOf('provisionAccount(deps.db, { ...p', verify));
  });

  for (const l of LOCALES) {
    it(`${l} · the page says it plainly, with the way to a person, and no form`, () => {
      const page = signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10, contact: 'legal@nomi.example', transferHeld: true })
        .replace(/[\u2066-\u2069]/g, '');
      expect(page).toContain(`role="alert">${esc(t(l, 'signup.transferHeld'))}</p>`);
      expect(page).toContain('<a href="mailto:legal@nomi.example">legal@nomi.example</a>');
      expect(page).not.toContain('action="/signup"');
    });
  }
});
