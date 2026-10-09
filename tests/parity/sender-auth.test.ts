import { describe, it, expect } from 'vitest';
import { senderConfirmed, GMAIL_AUTHSERV } from '../../src/channels/email/senderAuth.js';
import { readGmailMessage } from '../../src/channels/email/gmailMessage.js';
import { parseInboundMail } from '../../src/channels/email/inbound.js';

/**
 * R1 (docs/PRE-LAUNCH.md, 0132) — an e-mail is its From address's words only when the receiving server confirmed
 * the sender. Over Postgres, both ways in: tests/integration/email-replies.test.ts (a reply, by webhook) and
 * tests/integration/mail-accounts.test.ts (the connected Gmail inbox).
 */

const GOOGLE_PASS = 'mx.google.com; dkim=pass header.i=@buyer.test header.s=s1 header.b=abc; '
  + 'spf=pass (google.com: domain of a@buyer.test designates 192.0.2.1 as permitted sender) smtp.mailfrom=a@buyer.test; '
  + 'dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=buyer.test';

describe('R1 · who sent it, as the receiving server saw it', () => {
  it('a pass for the From domain confirms it: DMARC, or DKIM or SPF for an aligned domain', () => {
    expect(senderConfirmed([GOOGLE_PASS], 'a@buyer.test', GMAIL_AUTHSERV)).toBe(true);
    expect(senderConfirmed(['mx.google.com; dmarc=pass header.from=buyer.test'], 'a@buyer.test', GMAIL_AUTHSERV)).toBe(true);
    expect(senderConfirmed(['mx.google.com; dkim=pass header.d=mail.buyer.test'], 'a@buyer.test', GMAIL_AUTHSERV)).toBe(true);
    expect(senderConfirmed(['mx.google.com; dkim=pass header.i=@buyer.test'], 'a@sales.buyer.test', GMAIL_AUTHSERV)).toBe(true);
    expect(senderConfirmed(['mx.google.com; spf=pass smtp.mailfrom=bounce@buyer.test'], 'A@Buyer.Test', GMAIL_AUTHSERV)).toBe(true);
  });

  it('a pass for some other domain, a fail, a softfail, none, or no verdict at all confirms nothing', () => {
    expect(senderConfirmed([GOOGLE_PASS], 'a@victim.test', GMAIL_AUTHSERV)).toBe(false);
    expect(senderConfirmed(['mx.google.com; dkim=pass header.d=evil.test; spf=pass smtp.mailfrom=x@evil.test'], 'a@buyer.test', GMAIL_AUTHSERV)).toBe(false);
    expect(senderConfirmed(['mx.google.com; dmarc=pass header.from=evil.test'], 'a@buyer.test', GMAIL_AUTHSERV)).toBe(false);
    expect(senderConfirmed(['mx.google.com; dkim=fail header.d=buyer.test; spf=softfail smtp.mailfrom=a@buyer.test; dmarc=fail header.from=buyer.test'], 'a@buyer.test', GMAIL_AUTHSERV)).toBe(false);
    expect(senderConfirmed(['mx.google.com; dkim=none; spf=neutral smtp.mailfrom=a@buyer.test'], 'a@buyer.test', GMAIL_AUTHSERV)).toBe(false);
    expect(senderConfirmed([], 'a@buyer.test', GMAIL_AUTHSERV)).toBe(false);
    expect(senderConfirmed([GOOGLE_PASS], 'not-an-address', GMAIL_AUTHSERV)).toBe(false);
  });

  it('only the receiving server\'s own verdict counts: the topmost, and the one that names it', () => {
    // a "pass" the sender wrote below Google's own fail
    expect(senderConfirmed(['mx.google.com; dmarc=fail header.from=buyer.test', GOOGLE_PASS], 'a@buyer.test', GMAIL_AUTHSERV)).toBe(false);
    // a "pass" at the top that some other server claims
    expect(senderConfirmed(['mx.evil.test; dmarc=pass header.from=buyer.test'], 'a@buyer.test', GMAIL_AUTHSERV)).toBe(false);
    // a provider's adapter passes only its own verdict: no server named, the topmost is it
    expect(senderConfirmed(['mx.inbound.test; spf=pass smtp.mailfrom=a@buyer.test'], 'a@buyer.test', null)).toBe(true);
    expect(senderConfirmed(['mx.inbound.test; spf=fail smtp.mailfrom=a@buyer.test'], 'a@buyer.test', null)).toBe(false);
  });

  it('both ways in carry the verdict: Gmail\'s headers in their order; the webhook\'s field, one or several', () => {
    const b64 = (x: string) => Buffer.from(x, 'utf8').toString('base64url');
    const read = readGmailMessage({ id: 'g1', payload: { mimeType: 'text/plain', body: { data: b64('Hello') }, headers: [
      { name: 'From', value: 'A <a@buyer.test>' }, { name: 'Authentication-Results', value: 'mx.google.com; dmarc=fail' },
      { name: 'Subject', value: 'Hi' }, { name: 'authentication-results', value: GOOGLE_PASS },
    ] } });
    expect('skipped' in read ? null : read.authResults).toEqual(['mx.google.com; dmarc=fail', GOOGLE_PASS]);
    const one = parseInboundMail({ from: 'a@buyer.test', messageId: '<m@x>', text: 'Yes', authenticationResults: 'mx.i; spf=pass smtp.mailfrom=a@buyer.test' });
    expect(one?.authResults).toEqual(['mx.i; spf=pass smtp.mailfrom=a@buyer.test']);
    const several = parseInboundMail({ from: 'a@buyer.test', messageId: '<m@x>', text: 'Yes', authenticationResults: ['first', 'second', 7] });
    expect(several?.authResults).toEqual(['first', 'second']);
    expect(parseInboundMail({ from: 'a@buyer.test', messageId: '<m@x>', text: 'Yes' })?.authResults).toEqual([]);
  });
});
