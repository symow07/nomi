import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_REPLY_CHARS, messageIds, parseInboundMail } from '../../src/channels/email/inbound.js';
import {
  PROBLEM_SIGNAL_KINDS, SIGNAL_SAMPLES, TRIGGER_REASONS, isProblemSignal, toTriggerReason,
} from '../../src/core/scoring/signals.js';
import { CONSENT_EVIDENCE } from '../../src/core/outreach/consent.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { nextToSend, DELIVERY_WAIT_CAP_MS, type OutboundRow } from '../../src/outbound/sequencer.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * C4.c — the reply is the opt-in.
 *
 * The parts that are pure: reading a reply without guessing at its provider,
 * finding the mails it quotes, and the vocabulary that lets a person be told.
 * Whether the tenant can be forged, and whether the follow-ups stop, need
 * Postgres — tests/integration/email-replies.test.ts.
 */

const SQL = readFileSync(fileURLToPath(new URL('../../migrations/0048_email_replies.sql', import.meta.url)), 'utf8');

describe('C4.c · the Message-IDs a reply quotes', () => {
  it('bracketed, bare, space-separated or in a list — each id once, bare', () => {
    expect(messageIds('<a@x.test>')).toEqual(['a@x.test']);
    expect(messageIds(' b@x.test ')).toEqual(['b@x.test']);
    expect(messageIds('<a@x.test> <b@x.test>\r\n <a@x.test>')).toEqual(['a@x.test', 'b@x.test']);
    expect(messageIds(['<a@x.test>', 'c@x.test'])).toEqual(['a@x.test', 'c@x.test']);
  });

  it('anything that is not a Message-ID is not treated as one', () => {
    expect(messageIds('not an id')).toEqual([]);
    expect(messageIds(42)).toEqual([]);
    expect(messageIds([null, {}, '<>'])).toEqual([]);
  });
});

describe('C4.c · reading a reply', () => {
  const base = { from: 'ahmed@gulf.test', messageId: '<his@gulf.test>', text: 'Yes, send prices.' };

  it('the mail he answered comes first, then the rest of the thread', () => {
    const m = parseInboundMail({ ...base, inReplyTo: '<ours-2@nomi.test>', references: '<ours-1@nomi.test> <ours-2@nomi.test>' });
    expect(m?.quoted).toEqual(['ours-2@nomi.test', 'ours-1@nomi.test']);
    expect(m?.messageId).toBe('his@gulf.test');
  });

  it('a display name around the address is read past', () => {
    expect(parseInboundMail({ ...base, from: 'Ahmed Al Mansouri <ahmed@gulf.test>' })?.from).toBe('ahmed@gulf.test');
  });

  it('no sender, no id of his own, or nothing written — not a reply', () => {
    expect(parseInboundMail({ ...base, from: '' })).toBeNull();
    expect(parseInboundMail({ ...base, messageId: 'nope' })).toBeNull();
    expect(parseInboundMail({ ...base, text: '   ' })).toBeNull();
    expect(parseInboundMail(null)).toBeNull();
    expect(parseInboundMail('a string')).toBeNull();
  });

  it('his quoted history is KEPT — a stripper that cut his answer would hide the one thing to read', () => {
    const text = 'Yes, send prices.\n\nOn Tue, Lily wrote:\n> We make canvas totes.';
    expect(parseInboundMail({ ...base, text })?.text).toBe(text);
  });

  it('a forwarded catalogue is cut to a length a page can show', () => {
    expect(parseInboundMail({ ...base, text: 'x'.repeat(MAX_REPLY_CHARS + 50) })?.text).toHaveLength(MAX_REPLY_CHARS);
  });
});

describe('C4.c · a person is told', () => {
  it('his answer is a PROBLEM signal — not because it is bad, but because a person must act', () => {
    expect(PROBLEM_SIGNAL_KINDS).toContain('email_reply');
    expect(isProblemSignal(SIGNAL_SAMPLES.email_reply)).toBe(true);
    expect(toTriggerReason(SIGNAL_SAMPLES.email_reply)).toBe('email_reply');
  });

  it('in her words, in every language: why the conversation needs her, and what his answer proves', () => {
    for (const l of LOCALES) {
      expect(t(l, 'takeover.reason.email_reply' as MessageKey), l).not.toBe('takeover.reason.email_reply');
      expect(t(l, 'contacts.evidence.replied_to_email' as MessageKey), l).not.toBe('contacts.evidence.replied_to_email');
    }
  });

  it('the columns accept exactly what the code can now write', () => {
    for (const e of CONSENT_EVIDENCE) expect(SQL, e).toContain(`'${e}'`);
    for (const r of TRIGGER_REASONS) expect(SQL, r).toContain(`'${r}'`);
  });

  it('the tenant lookup returns only what the reply needs, to the app role alone', () => {
    expect(SQL).toMatch(/returns table \(business_id uuid, conversation_id uuid, identity text\)/);
    expect(SQL).toContain('security definer set search_path = public');
    expect(SQL).toContain('revoke all on function resolve_email_reply(text[]) from public');
    // Only mails that actually went: a refused or failed row has no thread.
    expect(SQL).toContain("o.status in ('sent', 'delivered', 'read')");
  });
});

describe('C4.c · e-mail has no delivery receipt to wait for', () => {
  const now = new Date('2026-09-15T01:00:00Z');
  const justSent = new Date(now.getTime() - 2_000);
  const row = (over: Partial<OutboundRow>): OutboundRow => ({
    id: 'x', seq: 1, status: 'queued', requiresOrder: true, attempts: 0, sentAt: null, ...over,
  });

  it('her answer is not held behind a mail that was accepted two seconds ago', () => {
    expect(nextToSend([
      row({ id: 'first', seq: 1, status: 'sent', sentAt: justSent, channel: 'email' }),
      row({ id: 'answer', seq: 2, channel: 'email' }),
    ], now)).toEqual({ action: 'send', id: 'answer' });
  });

  it('WhatsApp still waits for its receipt, exactly as before — and so does a channel nobody named', () => {
    for (const channel of [undefined, 'whatsapp', 'carrier-pigeon']) {
      const d = nextToSend([
        row({ id: 'first', seq: 1, status: 'sent', sentAt: justSent, ...(channel ? { channel } : {}) }),
        row({ id: 'next', seq: 2, ...(channel ? { channel } : {}) }),
      ], now);
      expect(d, String(channel)).toEqual({ action: 'wait', blockedOn: 'first', recheckInMs: DELIVERY_WAIT_CAP_MS - 2_000 });
    }
  });

  it('an e-mail still in flight still blocks the next one: order holds, only the pointless wait goes', () => {
    expect(nextToSend([
      row({ id: 'first', seq: 1, status: 'sending', channel: 'email' }),
      row({ id: 'next', seq: 2, channel: 'email' }),
    ], now).action).toBe('wait');
  });
});
