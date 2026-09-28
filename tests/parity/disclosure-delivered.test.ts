import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { carriesDisclosure, disclosureFor, withDisclosure, DISCLOSURE_LOCALES } from '../../src/core/conversation/disclosure.js';
import {
  driveConversationOutbound,
  type OutboundStore, type OutboundWorkRow, type ConversationSendContext,
} from '../../src/outbound/worker.js';
import type { ChannelAdapter, SendResult } from '../../src/channels/contract.js';

/**
 * 0079 — "HAS THE BUYER BEEN TOLD?" IS A FACT ABOUT WHAT REACHED HIM.
 *
 * The owner's rule (2026-09-28): a shop's opener asked again after the buyer
 * was told is a request for a person; before, it is answered. "Told" must not
 * depend on draft versus auto-send, and it must not be the queueing: a reply
 * queued and then refused — Stop, a hand-over, the allowlist — told him
 * nothing. So the send path stamps it, the moment the provider accepts a
 * message that carries the disclosure sentence, whoever wrote the message.
 *
 * Here: recognising the sentence (every language, any name, the earlier
 * Arabic wording), and the drive loop stamping on a SENT message only. The
 * database half — the store, the column, saveState never erasing it, the
 * backfill — is tests/integration/disclosure-delivered.test.ts.
 */

const NAMES: readonly [string, string][] = [
  ['Lily', 'Westlake Canvas Co'],
  ['A+B (Pty) Ltd.* bot', 'Maison [Beauté] & Co. $5'],   // regex characters in both
  ['小王', '义乌帆布'],
  ['رشا', 'متجر الورد'],
];

describe('carriesDisclosure — recognises the sentence, in every language, with any name', () => {
  for (const locale of DISCLOSURE_LOCALES) {
    for (const [name, business] of NAMES) {
      const sentence = disclosureFor({ detected: locale, name, business })!;
      it(`${locale} · ${name} / ${business}`, () => {
        expect(carriesDisclosure(sentence)).toBe(true);                                   // sent alone (the buyer asked)
        expect(carriesDisclosure(withDisclosure(sentence, 'Which colour would you like?'))).toBe(true); // in front of a reply
        expect(carriesDisclosure(`Hi again!\n\n${sentence}\n\nSee you soon`)).toBe(true); // inside an owner's message
        expect(carriesDisclosure(sentence.replace(/ /g, '  '))).toBe(true);              // spaces doubled by an edit
      });
    }
  }

  it("the earlier Arabic wordings still count: a message queued then was still the disclosure", () => {
    expect(carriesDisclosure('مرحبًا، أنا ليلى، المساعد الذكي لدى متجر الورد. إذا أردت التحدث مع شخص من فريقنا فأخبرني، وسيرد عليك في أقرب وقت.')).toBe(true);
    expect(carriesDisclosure('مرحبًا، أنا ليلى، مساعد آلي لدى متجر الورد. إذا أردت التحدث مع شخص من فريقنا فأخبرني، وسيرد عليك في أقرب وقت.')).toBe(true);
  });

  it('a business name as long as the profile allows (200) and an assistant name at its limit (40), in every language', () => {
    for (const locale of DISCLOSURE_LOCALES) {
      for (const ch of ['A', '王', 'م']) {
        const sentence = disclosureFor({ detected: locale, name: ch.repeat(40), business: ch.repeat(200) })!;
        expect(carriesDisclosure(withDisclosure(sentence, 'Which colour?')), `${locale} ${ch}`).toBe(true);
      }
    }
  });

  it('does not fire on what merely talks about an assistant or a person', () => {
    for (const text of [
      '', 'Which colour would you like?',
      'Our AI assistant can help you with orders.',
      "Hi, I'm Lily from Westlake Canvas Co. How can I help?",
      '您好，我是小王。有什么可以帮您？',
      'مرحبًا، أنا رشا من متجر الورد. كيف يمكنني المساعدة؟',
      // Half of it is not it: the part that says how to reach a person is missing.
      "Hi, I'm Lily, Westlake Canvas Co's AI assistant.",
    ]) {
      expect(carriesDisclosure(text), text).toBe(false);
    }
  });
});

// ── The drive loop stamps on SENT, and on nothing else ──────────────────────

const NOW = new Date('2026-07-18T02:00:00Z');
const TOLD = withDisclosure(disclosureFor({ detected: 'en', name: 'Lily', business: 'Westlake Canvas Co' })!, 'Happy to help — which colour?');

type Row = { -readonly [K in keyof OutboundWorkRow]: OutboundWorkRow[K] };

function memStore(body: string, ctx: Partial<ConversationSendContext> = {}, origin: OutboundWorkRow['origin'] = 'employee') {
  const row: Row = {
    id: 'o1', seq: 1, status: 'queued', requiresOrder: true, attempts: 0, sentAt: null,
    to: '971500000001', body, origin, sendingSince: null,
  };
  const delivered: { conversationId: string; at: Date }[] = [];
  const context: ConversationSendContext = {
    assignedTo: null, paused: false, lastInboundAt: new Date(NOW.getTime() - 3600_000), template: 'none',
    pilotMode: false, activated: true, silenced: false, stopped: false, ...ctx,
  };
  const store: OutboundStore = {
    async load() { return { rows: [{ ...row }], ctx: context }; },
    async transition(_id, to) { row.status = to; if (to === 'sent') row.sentAt = NOW; },
    async recordProviderId() {},
    async scheduleRetry() {},
    async deadLetter() {},
    async markDisclosureDelivered(conversationId, at) { delivered.push({ conversationId, at }); },
  };
  return { store, row, delivered };
}

const adapter = (result: SendResult): ChannelAdapter => ({
  kind: 'whatsapp', provider: 'test', verifyWebhook: () => false, parseWebhook: () => [],
  sendText: async () => result,
});
const drive = (store: OutboundStore, result: SendResult = { ok: true, providerMessageId: 'wamid.1' }) =>
  driveConversationOutbound({ store, adapter: adapter(result), now: () => NOW }, 'conv1');

describe('the drive loop — told when the provider ACCEPTS a message carrying it, never before', () => {
  it('sent alone, carrying it: the conversation is stamped, once, at the send', async () => {
    const m = memStore(TOLD);
    await drive(m.store);
    expect(m.row.status).toBe('sent');
    expect(m.delivered).toEqual([{ conversationId: 'conv1', at: NOW }]);
  });

  it("the owner's own message carrying it (an approved draft, a reply typed) counts the same: mode does not matter", async () => {
    const m = memStore(`Hello! ${disclosureFor({ detected: 'zh', name: '小王', business: '义乌帆布' })}`, {}, 'owner');
    await drive(m.store);
    expect(m.delivered).toHaveLength(1);
  });

  it('a message that does not carry it tells him nothing', async () => {
    const m = memStore('Happy to help — which colour?');
    await drive(m.store);
    expect(m.row.status).toBe('sent');
    expect(m.delivered).toEqual([]);
  });

  it('refused at send time — Stop, the ops silence, a hand-over, a pause, the allowlist — is not told', async () => {
    for (const ctx of [
      { stopped: true }, { silenced: true }, { assignedTo: 'owner' }, { paused: true },
      { pilotMode: true, recipientAllowed: false },
    ] as Partial<ConversationSendContext>[]) {
      const m = memStore(TOLD, ctx);
      await drive(m.store);
      expect(m.row.status, JSON.stringify(ctx)).not.toBe('sent');
      expect(m.delivered, JSON.stringify(ctx)).toEqual([]);
    }
  });

  it('a provider that refuses it — for now or for good — is not told', async () => {
    for (const result of [
      { ok: false, retryable: true, error: 'rate limited' },
      { ok: false, retryable: false, error: 'recipient blocked' },
    ] as SendResult[]) {
      const m = memStore(TOLD);
      await drive(m.store, result);
      expect(m.row.status).not.toBe('sent');
      expect(m.delivered).toEqual([]);
    }
  });

  it('the database store implements the stamp (the port is optional only for in-memory stores)', () => {
    const src = readFileSync('src/db/channels.ts', 'utf8');
    expect(src).toMatch(/async markDisclosureDelivered\(conversationId\)/);
    expect(src).toMatch(/ai_disclosure_delivered_at is null/);
  });
});
