import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateSignup, signupCapFrom, signupModeInForce } from '../../src/core/owner/signup.js';
import { TERMS_KEYS } from '../../src/core/legal/terms.js';
import { renderLegalTerms, TERMS_VERSION } from '../../src/api/web/legal.js';
import { signupPage } from '../../src/api/web/layout.js';
import { renderOwnerAlert, SIGNUP_DIGEST_LINES } from '../../src/pipeline/notify.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * G1 — sign-up for strangers: the terms agreed in so many words and recorded
 * by version, the cohort cap, open sign-up only with a sender, the operator
 * told. Over Postgres: tests/integration/g1-signup.test.ts.
 */

const good = {
  factory: 'Oud House', name: 'Rana', email: 'rana@oud.example', password: 'correct horse battery', invite: '',
  kind: 'retail', sells: 'Perfume oils', country: 'AE', website: '', teamSize: '2-5', channels: ['instagram'], terms: 'on',
};
const opts = { mode: 'open' as const, passwordMin: 10, passwordMax: 200 };

describe('G1 · the terms', () => {
  it('a sign-up without the box ticked is refused, by name', () => {
    expect(validateSignup({ ...good, terms: '' }, opts)).toMatchObject({ ok: false, problems: { terms: 'terms_missing' } });
    expect(validateSignup({ ...good, terms: 'yes' }, opts)).toMatchObject({ ok: false, problems: { terms: 'terms_missing' } });
    expect(validateSignup(good, opts)).toMatchObject({ ok: true });
  });
  it('the version is a digest of the terms\' own words, every key of which the page draws', () => {
    expect(TERMS_VERSION).toMatch(/^[0-9a-f]{12}$/);
    const page = renderLegalTerms('en', null);
    for (const k of TERMS_KEYS) expect(page, k).toContain(esc(t('en', k)));
  });
  for (const locale of LOCALES) {
    it(`${locale} · the terms say what may not be sold or said, and the form asks for agreement with a link to them`, () => {
      const l = locale as Locale;
      expect(renderLegalTerms(l, null)).toContain(esc(t(l, 'legal.terms.use.title')));
      const form = signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10 });
      expect(form).toMatch(/<input type="checkbox" name="terms" required \/>/);
      expect(form).toContain('<a href="/terms" target="_blank" rel="noopener">');
      expect(form).not.toContain('{terms}');
    });
  }
});

describe('G1 · the cap, the mode, the operator', () => {
  it('SIGNUP_CAP: a whole number above zero, else no cap', () => {
    expect(signupCapFrom('20')).toBe(20);
    for (const v of [undefined, '', '0', '-3', '2.5', 'twenty']) expect(signupCapFrom(v), String(v)).toBeNull();
  });
  it('open sign-up without the installation\'s sender reads as closed, and /verify asks the mode again', () => {
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    // MAIL — "a sender" is the one codes leave by: the dedicated one, or the installation's own.
    // BOT — the mode is asked on every request (the operator's switch in the database).
    expect(app).toContain("return signupModeInForce(set, deps.signupMode ?? 'invite', { mail: Boolean(codeMail), botCheck: Boolean(botCheck) });");
    expect(signupModeInForce(null, 'open', { mail: false, botCheck: true })).toBe('closed');
    const verify = app.slice(app.indexOf("app.post('/verify'"));
    expect(verify.indexOf('const signupMode = await signupModeNow();')).toBeLessThan(verify.indexOf("if (signupMode === 'closed')"));
    expect(verify.indexOf("if (signupMode === 'closed')")).toBeLessThan(verify.indexOf('provisionAccount('));
  });
  it('the day\'s sign-ups, by name, kind and country', () => {
    const text = renderOwnerAlert('en', 'signup_digest', null, { signups: [{ business: 'Oud House', kind: 'retail', country: 'AE' }] });
    expect(text).toBe(`${t('en', 'notify.signup_digest', { n: 1 })}\nOud House (${t('en', 'business.kind.retail')}, AE)`);
  });
  it('a long day names the first 25 and counts the rest', () => {
    const many = Array.from({ length: SIGNUP_DIGEST_LINES + 7 }, (_, i) => ({ business: `Shop ${i}`, kind: null, country: null }));
    const lines = renderOwnerAlert('en', 'signup_digest', null, { signups: many }).split('\n');
    expect(lines).toHaveLength(1 + SIGNUP_DIGEST_LINES + 1);
    expect(lines.at(-1)).toBe(t('en', 'notify.signup_digest.more', { n: 7 }));
  });
  it('the daily job: 07:15 UTC, the list from signups_since(), one alert a day', () => {
    const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
    const job = main.slice(main.indexOf("boss.schedule(QUEUES.signupDigest, '15 7 * * *', {})"));
    expect(job).toMatch(/^boss\.schedule\(QUEUES\.signupDigest/);
    expect(job.slice(0, 400)).toContain('signupDigestAlert(db, PILOT_BUSINESS_ID, new Date())');
    expect(job.slice(0, 400)).toContain("{ singletonKey: 'signup_digest', singletonSeconds: 23 * 3600 }");
  });
  it('TikTok and WeChat are on Channels as "not yet"', () => {
    const channels = readFileSync(new URL('../../src/api/web/channels.ts', import.meta.url), 'utf8');
    expect(channels).toContain("{ literal: 'TikTok' }, { literal: 'WeChat' },");
  });
});
