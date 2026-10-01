import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { httpsMailConfigFrom, providerRequest, httpsSystemMailer, cappedMail, refusedByCap, type MailFetch } from '../../src/channels/email/httpsMail.js';
import { mailCapsFrom, DEFAULT_MAIL_CAPS } from '../../src/db/mailCaps.js';
import { renderOwnerAlert } from '../../src/pipeline/notify.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * MAIL (0112, decision 36) — a dedicated sender over HTTPS for the mail
 * strangers cause (codes, reset links, owner alerts), daily caps on it, and
 * the operator's mailbox left with operator mail only. The caps over
 * Postgres: tests/integration/mail-caps.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const KEY = 're_test_not_a_real_key_0001';

describe('MAIL · the sender, from three variables or none', () => {
  it('none is none, quietly; all three is a sender', () => {
    expect(httpsMailConfigFrom({})).toBeNull();
    expect(httpsMailConfigFrom({ MAIL_PROVIDER: 'Resend', MAIL_API_KEY: KEY, MAIL_FROM: 'Nomi <no-reply@mail.nomidoes.com>' }))
      .toEqual({ provider: 'resend', apiKey: KEY, from: 'Nomi <no-reply@mail.nomidoes.com>' });
  });
  it('half-set is no sender, and says which part', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(httpsMailConfigFrom({ MAIL_PROVIDER: 'mailchimp', MAIL_API_KEY: KEY, MAIL_FROM: 'a@b.co' })).toBeNull();
    expect(httpsMailConfigFrom({ MAIL_PROVIDER: 'postmark', MAIL_FROM: 'not-an-address' })).toBeNull();
    expect(warn.mock.calls.map((c) => String(c[0])).join(' ')).toMatch(/MAIL_PROVIDER.*MAIL_API_KEY.*MAIL_FROM/s);
    warn.mockRestore();
  });
  it('each provider\'s request: its address, the key only in a header, the message whole', () => {
    const msg = { to: 'owner@shop.example', subject: 'Your code is 123456', text: 'Your code is 123456.' };
    const r = providerRequest({ provider: 'resend', apiKey: KEY, from: 'no-reply@mail.nomidoes.com' }, msg);
    expect(r.url).toBe('https://api.resend.com/emails');
    expect(r.headers['Authorization']).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(r.body)).toEqual({ from: 'no-reply@mail.nomidoes.com', to: ['owner@shop.example'], subject: msg.subject, text: msg.text,
      headers: { 'Auto-Submitted': 'auto-generated' } });
    const p = providerRequest({ provider: 'postmark', apiKey: KEY, from: 'no-reply@mail.nomidoes.com' }, msg);
    expect(p.url).toBe('https://api.postmarkapp.com/email');
    expect(p.headers['X-Postmark-Server-Token']).toBe(KEY);
    expect(JSON.parse(p.body)).toMatchObject({ From: 'no-reply@mail.nomidoes.com', To: 'owner@shop.example', TextBody: msg.text, MessageStream: 'outbound' });
    for (const b of [r.body, p.body]) expect(b).not.toContain(KEY);
  });
  it('sends; a refusal says the provider\'s words, never the key; a network failure is a failure', async () => {
    const cfg = { provider: 'resend' as const, apiKey: KEY, from: 'Nomi <no-reply@mail.nomidoes.com>' };
    const ok: MailFetch = async () => ({ ok: true, status: 200, text: async () => '{"id":"x"}' });
    const no: MailFetch = async () => ({ ok: false, status: 422, text: async () => 'The from address is not verified' });
    const down: MailFetch = async () => { throw new Error('ECONNRESET'); };
    expect(httpsSystemMailer(cfg, ok).from).toBe('no-reply@mail.nomidoes.com');
    expect(await httpsSystemMailer(cfg, ok).send({ to: 'a@b.co', subject: 's', text: 't' })).toEqual({ ok: true });
    expect(await httpsSystemMailer(cfg, no).send({ to: 'a@b.co', subject: 's', text: 't' })).toEqual({ ok: false, error: 'resend 422: The from address is not verified' });
    expect(await httpsSystemMailer(cfg, down).send({ to: 'a@b.co', subject: 's', text: 't' })).toEqual({ ok: false, error: 'resend: ECONNRESET' });
  });
});

describe('MAIL · the daily caps', () => {
  it('a message the caps refuse is never sent, and says why', async () => {
    const sent: string[] = [];
    const base = { from: 'x@y.co', send: async (m: { to: string }) => { sent.push(m.to); return { ok: true as const }; } };
    const open = cappedMail(base, async () => 'ok');
    const full = cappedMail(base, async () => 'address_cap');
    expect(await open.send({ to: 'a@b.co', subject: 's', text: 't' })).toEqual({ ok: true });
    const r = await full.send({ to: 'c@d.co', subject: 's', text: 't' });
    expect(r).toEqual({ ok: false, error: 'daily_cap: address_cap' });
    expect(refusedByCap(r)).toBe(true);
    expect(refusedByCap({ ok: false, error: 'resend 500' })).toBe(false);
    expect(sent).toEqual(['a@b.co']);
  });
  it('the defaults, and the operator\'s own installation totals', () => {
    expect(mailCapsFrom({})).toEqual(DEFAULT_MAIL_CAPS);
    expect(mailCapsFrom({ MAIL_CAP_CODES_A_DAY: '250', MAIL_CAP_ALERTS_A_DAY: 'lots' })).toEqual({
      code: { perAddress: 10, installation: 250 }, alert: DEFAULT_MAIL_CAPS.alert });
  });
});

describe('MAIL · who sends what', () => {
  it('codes and reset links by the capped sender; a refusal by the caps reads "slow down"', () => {
    const app = src('src/api/web/app.ts');
    expect(app).toContain('const codeMail = deps.codeMail ?? deps.systemMail ?? null;');
    expect(app.match(/await codeMail!\.send\(\{/g)).toHaveLength(3);
    expect(app).not.toMatch(/await deps\.systemMail!\.send\(\{/);
    expect(app).toContain("if (refusedByCap(mailed)) return 'slow';");
    expect(app).toContain("if (refusedByCap(mailed)) return fail(429, 'verify.error.slow');");
  });
  it('owner alerts by the capped sender, the operator\'s by the operator\'s mailbox', () => {
    expect(src('src/pipeline/notify.ts')).toContain('const mail = isOperatorAlert(job.kind) ? (deps.operatorMail ?? deps.mail) : deps.mail;');
    const main = src('src/main.ts');
    expect(main).toContain("mail: alertMail, operatorMail: systemMail,");
    expect(main).toContain("const strangerMail = overrides?.systemMail ? null : (dedicatedMail ?? systemMail);");
  });
  for (const l of LOCALES) {
    it(`${l} · the operator's daily list says what was sent and what the caps held back`, () => {
      const words = renderOwnerAlert(l, 'signup_digest', null, { signups: [], mail: { codes: 12, alerts: 40, refused: 3 } });
      expect(words).toContain(t(l, 'notify.signup_digest.mail.capped', { codes: 12, alerts: 40, refused: 3 }));
    });
  }
});
