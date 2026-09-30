import { randomUUID } from 'node:crypto';
import type { ChannelAdapter, SendResult } from './contract.js';

/**
 * PRACTICE'S CHANNEL — the end of the real pipeline, with nothing after it.
 *
 * A practice reply goes the whole way a customer's would: the turn, the queue,
 * the outbound worker and its send gate (Stop, the window, the ceiling). Here,
 * where an adapter would call Meta, it is accepted and goes nowhere: the
 * worker marks it sent, which is what writes it on the practice transcript.
 *
 * This file imports no network code, and a test holds that it never does
 * (`tests/parity/practice-channel.test.ts`). It is picked by the business, never
 * by the channel: the outbound worker hands a practice copy this adapter and
 * nothing else, so a copy cannot reach a real account even if one were set.
 */
export function practiceAdapter(): ChannelAdapter {
  const accepted = async (): Promise<SendResult> => ({ ok: true, providerMessageId: `practice:${randomUUID()}` });
  return {
    kind: 'instagram',
    provider: 'practice',
    // Nothing arrives from outside: a practice message is written by the owner, on the page.
    verifyWebhook: () => false,
    parseWebhook: () => [],
    sendText: accepted,
    sendMedia: accepted,
  };
}
