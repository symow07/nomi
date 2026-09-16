import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyStatus, isUncertainSend, SENDING_RECLAIM_MS } from '../../src/core/channel/delivery.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import type { UncertainSend } from '../../src/api/web/refusals.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * 0052 — a message is never sent twice by a machine.
 *
 * The worker marks a row 'sending', calls the provider, records the answer. A
 * crash in the middle used to re-queue the row, on the reasoning that a rare
 * duplicate was the price of never losing a message. What is on trial here is
 * the reversal: the row stops, she is asked, and nothing is chosen for her.
 */

const NOW = new Date('2026-09-16T10:00:00Z');

const detail = (uncertainSends: readonly UncertainSend[]): ConversationDetail => ({
  conversationId: 'c-1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
  product: { name: 'Canvas tote', nameZh: null }, quantity: 5000, quote: null, order: null,
  messages: [{ direction: 'inbound', text: 'what is your price?', at: NOW }],
  pendingDraft: null, ownership: 'AI', refusals: [], uncertainSends, handoffReasons: [], unheardReason: null,
  lastHumanAction: null, knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null,
  proof: { quoteId: null, token: null },
});

const one = (over: Partial<UncertainSend> = {}): UncertainSend => ({
  outboundId: '11111111-1111-4111-8111-111111111111', conversationId: 'c-1', buyer: 'Ahmed',
  body: 'Your price for 500 is $0.92 each.', at: new Date(NOW.getTime() - 3 * 60_000),
  origin: 'employee', ...over,
});

describe('C8 · when nobody can say whether it went', () => {
  it('A SEND THAT NEVER REPORTED BACK is uncertain — after the window, not before', () => {
    expect(isUncertainSend(new Date(NOW.getTime() - SENDING_RECLAIM_MS - 1), NOW)).toBe(true);
    expect(isUncertainSend(new Date(NOW.getTime() - 1_000), NOW)).toBe(false);
    expect(isUncertainSend(null, NOW)).toBe(false);
  });

  it('THE WORKER STOPS INSTEAD OF RE-QUEUEING, and says so where it used to resend', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/outbound/worker.ts', import.meta.url)), 'utf8');
    expect(src).toContain("transition(r.id, 'uncertain'");
    // The old behaviour, by name: a reclaim back into the queue.
    expect(src).not.toContain("'queued', 'reclaimed");
    expect(src).not.toMatch(/kind: 'reclaimed'/);
  });

  it('it is NOT terminal: a receipt that does arrive is still believed', () => {
    expect(applyStatus('uncertain', 'delivered')).toEqual({ apply: true, next: 'delivered' });
    expect(applyStatus('uncertain', 'sent')).toEqual({ apply: true, next: 'sent' });
    // And a late failure is a failure, not an excuse to send again.
    expect(applyStatus('uncertain', 'failed')).toEqual({ apply: true, next: 'failed' });
  });

  it('only the worker writes it — her screens read it back and may not change a send', () => {
    const read = readFileSync(fileURLToPath(new URL('../../src/api/web/refusals.ts', import.meta.url)), 'utf8');
    const code = read.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const write of ['insert into', 'update ', 'delete from']) {
      expect(code.toLowerCase().includes(write), `the read model writes: ${write}`).toBe(false);
    }
  });
});

describe('C8 · what she is asked, and how', () => {
  it('HER OWN WORDS ARE SHOWN BACK, with both answers and no default', () => {
    const html = renderConversationDetail(detail([one()]), 'en', NOW, null);
    expect(html).toContain(esc('Your price for 500 is $0.92 each.'));
    expect(html).toContain('/app/outbound/11111111-1111-4111-8111-111111111111/send-again');
    expect(html).toContain('/app/outbound/11111111-1111-4111-8111-111111111111/leave');
    expect(html).toContain(esc(t('en', 'unsure.again')));
    expect(html).toContain(esc(t('en', 'unsure.leave')));
    // Nothing is pre-selected or counted down: no checked input, no timer.
    expect(html).not.toMatch(/checked|autofocus|setTimeout/);
  });

  it('it says plainly that nobody knows — in every locale', () => {
    for (const locale of LOCALES) {
      const html = renderConversationDetail(detail([one()]), locale, NOW, null);
      expect(html, locale).toContain(esc(t(locale, 'unsure.title')));
      expect(html, locale).toContain(esc(t(locale, 'unsure.why')));
    }
  });

  it('a conversation with nothing uncertain says nothing at all', () => {
    const html = renderConversationDetail(detail([]), 'en', NOW, null);
    expect(html).not.toContain(esc(t('en', 'unsure.title')));
    expect(html).not.toContain('/send-again');
  });

  it("his words follow their own direction inside her page's", () => {
    const html = renderConversationDetail(detail([one({ body: 'مرحبا، السعر؟' })]), 'en', NOW, null);
    expect(html).toMatch(/<blockquote class="unsure-q" dir="auto">/);
  });
});
