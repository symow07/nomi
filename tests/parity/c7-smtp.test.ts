import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Duplex } from 'node:stream';
import {
  authPlain, completeReply, dotStuff, isLocalHost, smtpConfigFrom, smtpDeliver,
} from '../../src/channels/email/smtp.js';

/**
 * Sending through her own mail provider — the rules that are not about a wire.
 *
 * The full conversation is proved against a real server in
 * `tests/integration/smtp.test.ts`; what is here is everything a server would
 * never tell us it got wrong: a password sent in the clear, a message body that
 * ends early, and SMTP's codes read as if they were HTTP's.
 */

const CRLF = '\r\n';
/** One reply on the wire: every line CRLF-terminated, as a server sends it. */
const lines = (reply: string): string => reply.split('\n').map((l) => `${l}${CRLF}`).join('');

/**
 * A server that says what the test tells it to: one REPLY per command, where a
 * reply may be several lines (an EHLO answer always is).
 */
function scriptedServer(script: readonly string[]): {
  readonly connect: () => Promise<Duplex>;
  readonly said: string[];
} {
  const said: string[] = [];
  return {
    said,
    connect: async () => {
      let step = 0;
      const socket: Duplex = new Duplex({
        read() { /* replies are pushed as the client speaks */ },
        write(chunk: Buffer | string, _enc: unknown, done: () => void) {
          said.push(String(chunk));
          const reply = script[step++];
          if (reply !== undefined) setTimeout(() => socket.push(lines(reply)), 1);
          done();
        },
      });
      // The greeting arrives before the client has said anything.
      const greeting = script[step++];
      if (greeting !== undefined) setTimeout(() => socket.push(lines(greeting)), 1);
      return socket;
    },
  };
}

const CONFIG = {
  host: 'mail.example.net', port: 587, user: 'lily@yiwuhf.com', password: 'secret', from: 'lily@yiwuhf.com',
};

describe('C7 · what SMTP must never do', () => {
  it('A SERVER THAT CANNOT ENCRYPT GETS NOTHING — no password, no message, and no retry', async () => {
    const server = scriptedServer(['220 mail.example.net ESMTP', '250-mail.example.net\n250 SIZE 35882577']);
    const r = await smtpDeliver(CONFIG, { to: 'buyer@gulf.test', data: 'Subject: hi' },
      { connect: server.connect, timeoutMs: 2000 });
    expect(r).toEqual({ ok: false, retryable: false, error: 'smtp server offers no STARTTLS' });
    expect(server.said.join('')).not.toContain('AUTH');
    expect(server.said.join('')).not.toContain('secret');
  });

  it('a relay on this machine is the one exception, because there is no network to overhear', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('mail.example.net')).toBe(false);
    // And the source says so where it fails closed.
    const src = readFileSync(fileURLToPath(new URL('../../src/channels/email/smtp.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/FAIL CLOSED/);
  });

  it("SMTP'S CODES ARE NOT HTTP'S: 4xx is temporary and retried, 5xx is permanent", async () => {
    const attempt = async (rcptReply: string) => smtpDeliver(
      { ...CONFIG, host: '127.0.0.1', password: '' },
      { to: 'buyer@gulf.test', data: 'Subject: hi' },
      {
        connect: scriptedServer([
          '220 local ESMTP', '250 local', '250 ok', rcptReply,
        ]).connect,
        timeoutMs: 2000,
      },
    );
    expect(await attempt('451 4.3.0 try later')).toEqual({ ok: false, retryable: true, error: 'smtp recipient 451' });
    expect(await attempt('550 5.1.1 no such user')).toEqual({ ok: false, retryable: false, error: 'smtp recipient 550' });
  });

  it('a wrong password is permanent — retrying one locks the account it belongs to', async () => {
    const r = await smtpDeliver({ ...CONFIG, host: '127.0.0.1' }, { to: 'b@x.test', data: 'Subject: hi' }, {
      connect: scriptedServer(['220 local ESMTP', '250-local\n250 AUTH PLAIN LOGIN', '535 5.7.8 bad credentials']).connect,
      timeoutMs: 2000,
    });
    expect(r).toEqual({ ok: false, retryable: false, error: 'smtp auth 535' });
  });

  it('nothing the server SAID comes back as text — only its code', async () => {
    const r = await smtpDeliver({ ...CONFIG, host: '127.0.0.1', password: '' },
      { to: 'b@x.test', data: 'Subject: hi' },
      { connect: scriptedServer(['220 local', '250 local', '550 5.7.1 blocked: yiwuhf.com is on our blacklist']).connect, timeoutMs: 2000 });
    expect(r).toEqual({ ok: false, retryable: false, error: 'smtp from 550' });
  });

  it('A LINE STARTING WITH A DOT DOES NOT END THE MESSAGE, and every line ends CRLF', () => {
    expect(dotStuff('one\n.two\nthree')).toBe(`one${CRLF}..two${CRLF}three`);
    expect(dotStuff(`a\r\nb`)).toBe(`a${CRLF}b`);
    expect(dotStuff('.')).toBe('..');
  });

  it('a multi-line greeting is one reply, and a continuation is not mistaken for the end', () => {
    expect(completeReply('250-mail.example.net\r\n')).toBeNull();
    expect(completeReply('250-mail.example.net\r\n250 STARTTLS\r\n'))
      .toEqual({ code: 250, lines: ['mail.example.net', 'STARTTLS'] });
  });

  it('the PLAIN mechanism is exactly RFC 4616, which is why it may only travel encrypted', () => {
    expect(Buffer.from(authPlain('u', 'p'), 'base64').toString('utf8')).toBe('\0u\0p');
  });
});

describe('C7 · half a configuration is no configuration', () => {
  it('all four parts, or nothing at all — a missing password would fail at her first mail', () => {
    expect(smtpConfigFrom({})).toBeNull();
    expect(smtpConfigFrom({ SMTP_HOST: 'smtp.zoho.com', SMTP_USER: 'lily@yiwuhf.com' })).toBeNull();
    expect(smtpConfigFrom({
      SMTP_HOST: 'smtp.zoho.com', SMTP_USER: 'lily@yiwuhf.com', SMTP_PASSWORD: 'x', SMTP_FROM: 'not-an-address',
    })).toBeNull();
  });

  it('the address is lower-cased and the port defaults to submission', () => {
    expect(smtpConfigFrom({
      SMTP_HOST: 'smtp.zoho.com', SMTP_USER: 'lily', SMTP_PASSWORD: 'x', SMTP_FROM: 'Lily@YiwuHF.com',
    })).toEqual({ host: 'smtp.zoho.com', port: 587, user: 'lily', password: 'x', from: 'lily@yiwuhf.com' });
    expect(smtpConfigFrom({
      SMTP_HOST: 'smtp.zoho.com', SMTP_USER: 'lily', SMTP_PASSWORD: 'x', SMTP_FROM: 'lily@yiwuhf.com', SMTP_PORT: '465',
    })?.port).toBe(465);
    expect(smtpConfigFrom({
      SMTP_HOST: 'smtp.zoho.com', SMTP_USER: 'lily', SMTP_PASSWORD: 'x', SMTP_FROM: 'lily@yiwuhf.com', SMTP_PORT: 'submission',
    })).toBeNull();
  });

  it('the checklist documents every SMTP setting the code reads', () => {
    const doc = readFileSync(fileURLToPath(new URL('../../docs/env-checklist.md', import.meta.url)), 'utf8');
    for (const name of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM']) {
      expect(doc, name).toContain(name);
    }
  });
});
