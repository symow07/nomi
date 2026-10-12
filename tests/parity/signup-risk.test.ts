import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  scoreSignup, canonicalEmail, isThrowawayEmail, networkOf, fingerprintSource,
  SIGNUP_MARK_DAYS, MEDIUM_FROM, HIGH_FROM, type SignupSignals,
} from '../../src/core/owner/signupRisk.js';
import { signupDigests, newSignupDeviceId } from '../../src/db/signupMarks.js';
import { signupPage, esc } from '../../src/api/web/layout.js';
import { renderPrivacy } from '../../src/api/web/legal.js';
import { COOKIES } from '../../src/api/web/thirdParty.js';
import { aiProcessor, HOSTING } from '../../src/core/legal/processors.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { withoutIsolates } from './isolates.js';

/**
 * Phase 1 (the owner's roadmap, 2026-10-13) — OPEN SIGN-UP WITH TRIAL-ABUSE SCORING. Repeat device and network,
 * a fresh (throwaway) e-mail, and velocity are scored: low → a free trial, medium → a card first, high → refused,
 * said plainly with the way to a person. The fingerprint is named on the privacy page and in the cookie table.
 * The database half (the marks, their counts, their forgetting, billing's card and trial) is
 * tests/integration/signup-risk.test.ts.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f: string) => readFileSync(`${ROOT}${f}`, 'utf8');
const none: SignupSignals = {
  earlierFromDevice: 0, earlierWithEmail: 0, earlierFromFingerprintAndNetwork: 0, earlierFromNetwork: 0,
  throwawayEmail: false, attemptsFromNetwork: 0, attemptsFromDevice: 0,
};
const tier = (over: Partial<SignupSignals>) => scoreSignup({ ...none, ...over }).tier;

describe('Phase 1 · the score: low → trial, medium → card, high → refused', () => {
  it('a first sign-up is low; a browser or an address that already made a workspace is high', () => {
    expect(scoreSignup(none)).toEqual({ tier: 'low', points: 0, reasons: [] });
    expect(tier({ earlierFromDevice: 1 })).toBe('high');
    expect(tier({ earlierWithEmail: 1 })).toBe('high');
    expect(scoreSignup({ ...none, earlierFromDevice: 1 }).reasons).toEqual(['repeat_device']);
  });
  it('the same fingerprint on the same network (which is also the same network) asks for a card; with more, refused', () => {
    const sameBrowserHere = { earlierFromFingerprintAndNetwork: 1, earlierFromNetwork: 1 };
    expect(scoreSignup({ ...none, ...sameBrowserHere })).toEqual({ tier: 'medium', points: 3, reasons: ['repeat_fingerprint', 'repeat_network'] });
    expect(tier({ ...sameBrowserHere, throwawayEmail: true })).toBe('high');
    expect(tier({ ...sameBrowserHere, earlierFromNetwork: 3 })).toBe('high');
  });
  it('a shared network weighs little: one earlier workspace is still a trial, three ask for a card', () => {
    expect(tier({ earlierFromNetwork: 1 })).toBe('low');
    expect(tier({ earlierFromNetwork: 3 })).toBe('medium');
  });
  it('a throwaway address alone asks for a card', () => {
    expect(scoreSignup({ ...none, throwawayEmail: true })).toEqual({ tier: 'medium', points: 2, reasons: ['fresh_email'] });
  });
  it('velocity: a few attempts are nothing; many, from one network or one browser, add up', () => {
    expect(tier({ attemptsFromNetwork: 3 })).toBe('low');
    expect(tier({ attemptsFromNetwork: 6 })).toBe('medium');
    expect(tier({ attemptsFromDevice: 3 })).toBe('medium');
    expect(scoreSignup({ ...none, attemptsFromNetwork: 10, attemptsFromDevice: 3 })).toEqual({ tier: 'high', points: 5, reasons: ['velocity'] });
  });
  it('the thresholds and the window are one place each', () => {
    expect([MEDIUM_FROM, HIGH_FROM, SIGNUP_MARK_DAYS]).toEqual([2, 4, 180]);
  });
});

describe('Phase 1 · the signals, and only as one-way codes', () => {
  it('an address as a mailbox: case, a "+tag", and Gmail\'s dots set aside', () => {
    expect(canonicalEmail(' J.Doe+trial2@GoogleMail.com ')).toBe('jdoe@gmail.com');
    expect(canonicalEmail('a.b+x@outlook.com')).toBe('a.b@outlook.com');
    expect(canonicalEmail('shop@saffron.example')).toBe('shop@saffron.example');
  });
  it('a throwaway mailbox, a subdomain of one too; an ordinary provider is not one', () => {
    expect(isThrowawayEmail('x@mailinator.com')).toBe(true);
    expect(isThrowawayEmail('x@inbox.yopmail.com')).toBe(true);
    expect(isThrowawayEmail('x@gmail.com')).toBe(false);
    expect(isThrowawayEmail('x@saffron.example')).toBe(false);
  });
  it('the network, not the address: an IPv4 /24, an IPv6 /48, nothing for what is not an address', () => {
    expect(networkOf('203.0.113.45')).toBe('203.0.113.0/24');
    expect(networkOf('::ffff:203.0.113.200')).toBe('203.0.113.0/24');
    expect(networkOf('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
    expect(networkOf('2001:0db8:0000:0012::9')).toBe('2001:db8:0::/48');
    for (const bad of ['unknown', '999.1.1.1', '', 'not:an:address:zz']) expect(networkOf(bad), bad).toBeNull();
  });
  it('the fingerprint is what the browser sends, and nothing of the caller\'s address', () => {
    const h = { 'user-agent': 'Mozilla/5.0 Test', 'accept-language': 'en-GB,en;q=0.9', 'x-forwarded-for': '203.0.113.45' };
    expect(fingerprintSource(h)).toBe(fingerprintSource({ ...h, 'x-forwarded-for': '198.51.100.1' }));
    expect(fingerprintSource(h)).not.toBe(fingerprintSource({ ...h, 'user-agent': 'Other/1.0' }));
    expect(fingerprintSource(h)).not.toContain('203.0.113');
  });
  it('every mark is the app\'s keyed SHA-256: hex, never the value, and different under another key', () => {
    const device = newSignupDeviceId();
    const input = { deviceId: device, ip: '203.0.113.45', headers: { 'user-agent': 'UA' }, email: 'J.Doe+2@gmail.com' };
    const a = signupDigests('secret-one-of-sufficient-length', input);
    for (const v of Object.values(a)) expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(a)).not.toMatch(/203\.0\.113|jdoe|gmail|UA/);
    expect(signupDigests('secret-one-of-sufficient-length', { ...input, email: 'jdoe@gmail.com' }).email).toBe(a.email);
    expect(signupDigests('secret-two-of-sufficient-length', input).device).not.toBe(a.device);
    // A cookie that is not ours is no device; an address that is not one is no network.
    expect(signupDigests('k'.repeat(32), { ...input, deviceId: 'forged value' }).device).toBeNull();
    expect(signupDigests('k'.repeat(32), { ...input, ip: 'unknown' })).toMatchObject({ network: null, fingerprint: null });
  });
});

describe('Phase 1 · the route: scored before a code is sent, refused in plain words, never silently', () => {
  const app = read('src/api/web/app.ts');
  it('the score comes after the form, the bot check and the invitation, and before any code is mailed', () => {
    const order = ['const v = validateSignup(', 'botCheck.verify(', 'inviteIsOpen(deps.db, v.value.invite!)',
      'await checkSignup(deps.db, signupDigests(', "risk?.score.tier === 'high'", 'const sent = await sendCode(reply, locale, wanted.email'];
    const at = order.map((s) => app.indexOf(s));
    for (const [i, n] of at.entries()) expect(n, order[i]).toBeGreaterThan(0);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
  });
  it('a sign-up the operator vouched for is never refused; in open mode a database that cannot count refuses the try', () => {
    expect(app).toContain("const vouched = signupMode === 'invite'");
    expect(app).toContain("if (!vouched && risk?.score.tier === 'high') {");
    expect(app).toContain('if (scoring && !vouched && !risk) return again(503,');
    expect(app).toContain('const scoring = Boolean(deps.signupGuard);');
  });
  it('the refusal says what happened and how to reach a person, in five languages — never which mark', () => {
    for (const l of LOCALES) {
      const page = withoutIsolates(signupPage({ locale: l, path: '/signup', mode: 'open', passwordMin: 10, contact: 'hello@nomi.example', riskRefused: true }));
      expect(page, l).toContain(esc(t(l, 'signup.riskRefused')));
      expect(page, l).toContain('href="mailto:hello@nomi.example"');
      expect(page, l).not.toContain('<form');
    }
  });
  it('a medium sign-up is told at once that a card comes first', () => {
    expect(app).toContain("? [{ key: 'signup.welcome' }, { key: 'signup.welcome.card' }] : 'signup.welcome';");
    for (const l of LOCALES) expect(t(l, 'signup.welcome.card'), l).not.toBe('signup.welcome.card');
  });
});

describe('Phase 1 · the fingerprint is named: the privacy page and the cookie table', () => {
  const facts = { processor: aiProcessor('deepseek'), hosting: HOSTING };
  const fingerprint = { en: /fingerprint of the browser/, zh: /浏览器指纹/, ar: /بصمة المتصفح/, es: /huella del navegador/, fr: /empreinte du navigateur/ } as const;
  it('the privacy page says what is compared, as one-way codes, for 180 days — and that closing a workspace leaves them', () => {
    for (const l of LOCALES) {
      const page = withoutIsolates(renderPrivacy(l, null, facts));
      const line = t(l, 'legal.privacy.owner.signupCheck');
      expect(page, l).toContain(`<p id="signup-check">${esc(line)}</p>`);
      expect(line, l).toMatch(fingerprint[l]);
      expect(line, l).toContain('180');
      expect(t(l, 'legal.privacy.owner.howLong'), l).toContain('180');
    }
  });
  it('the cookie table lists the sign-up cookie with the lifetime the code writes', () => {
    const c = COOKIES.find((x) => x.name === 'yf_signup');
    expect(c?.lifetimeSec).toBe(SIGNUP_MARK_DAYS * 24 * 3600);
    expect(c?.purpose).toBe('legal.privacy.cookies.for.signup');
    for (const l of LOCALES) {
      const page = withoutIsolates(renderPrivacy(l, null, facts));
      expect(page, l).toContain('yf_signup');
      expect(page, l).toContain(esc(t(l, 'legal.privacy.cookies.for.signup')));
    }
  });
  it('the cookie paragraph no longer says none of them recognises you', () => {
    expect(t('en', 'legal.privacy.cookies.body')).not.toMatch(/None tracks you/);
    expect(t('en', 'legal.privacy.cookies.body')).toMatch(/on the sign-up form only, to recognise a browser that signs up again/);
  });
});

describe('Phase 1 · the database keeps marks, not people', () => {
  const m = read('migrations/0148_signup_marks.sql');
  it('a mark is a kind, a 64-hex code, what it marked and when: no business, no address, no e-mail', () => {
    const table = /create table if not exists signup_marks \(([\s\S]*?)\n\);/.exec(m)![1]!;
    const cols = [...table.matchAll(/^\s+([a-z_]+)\s+(bigserial|text|timestamptz)/gm)].map((x) => x[1]);
    expect(cols).toEqual(['id', 'kind', 'digest', 'what', 'at']);
    expect(m).toContain("digest  text not null check (digest ~ '^[0-9a-f]{64}$')");
    expect(m).toContain('revoke all on signup_marks from public, nomi_app;');
  });
  it('forgotten by age: an attempt after two days, a workspace\'s after 180', () => {
    expect(m).toMatch(/what = 'attempt' and at < now\(\) - interval '2 days'\)\s+or \(what = 'workspace' and at < now\(\) - interval '180 days'\)/);
    expect(read('src/main.ts')).toContain('select signup_marks_forget()::text as n');
  });
  it('billing reads the risk: medium needs a card and has no free trial; the installation\'s trial is what the rest start with', () => {
    expect(m).toMatch(/or exists \(select 1 from signup_risk r where r\.business_id = current_business_id\(\) and r\.tier = 'medium'\)/);
    expect(m).toMatch(/case when exists \(select 1 from signup_risk r where r\.business_id = p_business and r\.tier = 'medium'\) then null\s+else \(select s\.self_serve_trial_days/);
    expect(m).toContain('select w.business_id, w.stripe_customer_id, pl.stripe_price_id, trial_days_for(w.business_id), first_channel_at(w.business_id)');
  });
});

describe('Phase 1 · the operator sees what the check did (0149)', () => {
  it('the daily list says how many were asked for a card first and how many were refused, and why', async () => {
    const { renderOwnerAlert } = await import('../../src/pipeline/notify.js');
    const check = { cards: 2, refused: 1, why: [
      { outcome: 'card' as const, reason: 'fresh_email', n: 2 }, { outcome: 'refused' as const, reason: 'repeat_device', n: 1 }] };
    const text = renderOwnerAlert('en', 'signup_digest', null, { signups: [], check });
    expect(text).toContain('The sign-up check asked 2 for a card first (fresh_email ×2).');
    expect(text).toContain('The sign-up check refused 1 (repeat_device ×1).');
    expect(renderOwnerAlert('en', 'signup_digest', null, { signups: [], check: { cards: 0, refused: 0, why: [] } })).not.toContain('sign-up check');
    expect(renderOwnerAlert('en', 'signup_digest', null, { signups: [], check: { cards: 0, refused: 2, why: [] } })).not.toContain('for a card');
  });
  it('a refusal is counted before the page answers: its points and reasons, nothing a person typed', () => {
    const app = read('src/api/web/app.ts');
    expect(app.indexOf('await markSignupRefused(deps.db, risk.score)')).toBeGreaterThan(app.indexOf("risk?.score.tier === 'high'"));
    expect(app.indexOf('await markSignupRefused(deps.db, risk.score)')).toBeLessThan(app.indexOf('return riskRefusal(reply, locale);'));
    const m = read('migrations/0149_signup_refusals.sql');
    const table = /create table if not exists signup_refusals \(([\s\S]*?)\n\);/.exec(m)![1]!;
    expect([...table.matchAll(/^\s+([a-z_]+)\s+(bigserial|integer|text\[\]|timestamptz)/gm)].map((x) => x[1])).toEqual(['id', 'at', 'points', 'reasons']);
    expect(m).toContain("delete from signup_refusals where at < now() - interval '30 days';");
    expect(read('src/pipeline/signupDigest.ts')).toContain('const check = await signupCheckSince(db, since);');
  });
});
