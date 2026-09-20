import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAddress, readGmailMessage, stripHtml, type GmailMessage } from '../../src/channels/email/gmailMessage.js';
import { authorizeUrl, grantsReading } from '../../src/connectors/oauth.js';

/**
 * E1 — she reads the inbox.
 *
 * A buyer's e-mail used to land in the owner's Gmail unread by this product.
 * These are the pure parts: reading one Gmail message into what a turn needs,
 * telling a machine's mail from a person's, and the grant being asked for
 * only when the owner ticked the box — and recorded only off what Google
 * actually returned.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const msg = (over: Partial<GmailMessage> & { headers?: Record<string, string>; text?: string; html?: string }): GmailMessage => {
  const headers = Object.entries({ From: 'Ahmed <AHMED@buyer.test>', Subject: 'Price for 500 bags', 'Message-ID': '<abc@buyer.test>', ...(over.headers ?? {}) })
    .map(([name, value]) => ({ name, value }));
  const parts = [
    ...(over.text !== undefined ? [{ mimeType: 'text/plain', body: { data: b64(over.text) } }] : []),
    ...(over.html !== undefined ? [{ mimeType: 'text/html', body: { data: b64(over.html) } }] : []),
  ];
  return { id: over.id ?? 'g1', internalDate: over.internalDate ?? '1789800000000', payload: { mimeType: 'multipart/alternative', headers, parts } };
};

describe('E1 · one Gmail message, read', () => {
  it('the plain text, the sender, the subject, the ids and when', () => {
    const r = readGmailMessage(msg({ text: 'Hello, price for 500 bags?\n\n> quoted' }));
    expect('skipped' in r).toBe(false);
    if ('skipped' in r) return;
    expect(r).toMatchObject({ gmailId: 'g1', messageId: 'abc@buyer.test', from: 'ahmed@buyer.test', fromName: 'Ahmed',
      subject: 'Price for 500 bags', text: 'Hello, price for 500 bags?\n\n> quoted', automatic: false, inReplyTo: null });
    expect(r.receivedAt.getTime()).toBe(1789800000000);   // Gmail's internalDate, in ms
  });

  it('HTML only: the tags come off, the words stay', () => {
    const r = readGmailMessage(msg({ html: '<div>Hello,<br>price for <b>500</b> bags?</div><style>p{}</style>' }));
    expect(!('skipped' in r) && r.text).toBe('Hello,\nprice for 500 bags?');
    expect(stripHtml('a &amp; b<p>c</p>')).toBe('a & b c');
  });

  it('a machine wrote it: bounces, notices, lists, no-reply — never answered', () => {
    for (const headers of [{ 'Auto-Submitted': 'auto-replied' }, { Precedence: 'bulk' }, { 'List-Id': '<news.x.test>' }, { From: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>' }, { From: 'no-reply@shop.test' }]) {
      const r = readGmailMessage(msg({ text: 'x', headers }));
      expect(!('skipped' in r) && r.automatic, JSON.stringify(headers)).toBe(true);
    }
    const person = readGmailMessage(msg({ text: 'x', headers: { 'Auto-Submitted': 'no' } }));
    expect(!('skipped' in person) && person.automatic).toBe(false);
  });

  it('what cannot be read is skipped and says why, never guessed', () => {
    expect(readGmailMessage({ id: 'g2' })).toEqual({ skipped: 'no payload' });
    expect(readGmailMessage(msg({ text: 'x', headers: { From: 'not an address' } }))).toEqual({ skipped: 'no sender address' });
    expect(readGmailMessage(msg({}))).toEqual({ skipped: 'no readable text' });
  });

  it('addresses in the ways mail clients write them', () => {
    expect(parseAddress('"Al Noor Trading" <sales@alnoor.ae>')).toEqual({ address: 'sales@alnoor.ae', name: 'Al Noor Trading' });
    expect(parseAddress('sales@alnoor.ae')).toEqual({ address: 'sales@alnoor.ae', name: null });
    expect(parseAddress('nonsense')).toBeNull();
  });
});

describe('E1 · the grant', () => {
  const client = { clientId: 'cid', clientSecret: 'sec' };
  it('reading is asked for only when she ticked the box', () => {
    const plain = new URL(authorizeUrl('google', client, { redirectUri: 'https://x.test/cb', state: 's', challenge: 'c' }));
    const withRead = new URL(authorizeUrl('google', client, { redirectUri: 'https://x.test/cb', state: 's', challenge: 'c', read: true }));
    expect(plain.searchParams.get('scope')).not.toContain('gmail.readonly');
    expect(withRead.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(withRead.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/gmail.send');
  });

  it('and is recorded off what Google returned, never off what was asked', () => {
    expect(grantsReading('google', 'openid email https://www.googleapis.com/auth/gmail.send')).toBe(false);
    expect(grantsReading('google', 'openid https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly')).toBe(true);
    expect(read('src/channels/email/connectMailbox.ts')).toMatch(/readsInbox: grantsReading\(input\.provider, r\.value\.scopes\)/);
  });

  it('her answer is "Re:" what he wrote — his subject counts now, not only hers', () => {
    const src = read('src/db/channels.ts');
    expect(src).toMatch(/origin === 'owner' \|\| origin === 'employee'/);
    expect(src).toMatch(/from messages\s+where conversation_id = \$\{conversationId\} and direction = 'inbound' and subject is not null/);
  });

  it('a minute\'s work fits in a minute: every call bounded, the whole read bounded, and a half-read inbox keeps its place', () => {
    const src = read('src/channels/email/inboxReader.ts');
    expect(src).toMatch(/signal: AbortSignal\.timeout\(CALL_TIMEOUT_MS\)/);
    expect(src).toMatch(/if \(now\(\)\.getTime\(\) > until\) \{ finished = false; break; \}/);
    // Gmail answers newest first: a half-read inbox must not move the mark past what it never saw.
    expect(src).toMatch(/if \(finished\) \{[\s\S]*?markInboxRead/);
  });

  it('the reader never answers her own mail or a machine\'s, and queues the same turn a webhook does', () => {
    const src = read('src/channels/email/inboxReader.ts');
    expect(src).toMatch(/if \(mail\.automatic \|\| own\.has\(mail\.from\)\) \{ skipped\+\+; continue; \}/);
    expect(src).toMatch(/evidence: 'inbound_message'/);
    expect(read('src/main.ts')).toMatch(/enqueue: \(job\) => enqueueInbound\(boss, \{ \.\.\.job, messageType: 'text' \}\)/);
  });
});
