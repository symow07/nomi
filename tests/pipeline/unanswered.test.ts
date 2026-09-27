import { describe, it, expect } from 'vitest';
import { handToPerson, unansweredIn } from '../../src/pipeline/received.js';
import type { InboundJob } from '../../src/queue/boss.js';
import { alertKindFor } from '../../src/pipeline/notify.js';
import { computeScores, needsHandoff } from '../../src/core/scoring/signals.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeTenant } from './fakes.js';

/**
 * 0077 — an inbound turn that exhausted its retries hands its conversation to
 * a person as `not_answered` (src/worker/main.ts, the dead-letter loop).
 *
 * What a dead job is read as — `unansweredIn`, pure — is proved here: the dead
 * letter carries the job's own data, queued by whichever build queued it, so
 * it is read defensively. The hand-over itself (a transaction: lock, the
 * message on the timeline, `handToPerson`) and the worker's wiring run against
 * Postgres in tests/integration/person-request.test.ts.
 */

const BIZ = 'b1000000-0000-4000-8000-000000000077';
const CONV = 'c1000000-0000-4000-8000-000000000077';
const job = (over: Partial<InboundJob> = {}): InboundJob => ({
  businessId: BIZ, conversationId: CONV, messageId: 'wamid.gave-up', text: 'And the lead time?', ...over,
});

describe('unansweredIn — what a dead inbound job leaves for a person', () => {
  it('a typed message: its words go on the timeline (they already are; it is idempotent)', () => {
    expect(unansweredIn(job())).toEqual({
      businessId: BIZ, conversationId: CONV, messageId: 'wamid.gave-up', text: 'And the lead time?', record: { kind: 'typed' },
    });
    expect(unansweredIn(job({ messageType: 'text' }))?.record).toEqual({ kind: 'typed' });
  });

  it('a voice note or a photo whose turn rolled back is recorded by name, never opened', () => {
    expect(unansweredIn(job({ messageType: 'audio', text: '' }))?.record).toEqual({ kind: 'received', received: 'voice' });
    expect(unansweredIn(job({ messageType: 'image', text: 'like this' }))).toMatchObject({
      text: 'like this', record: { kind: 'received', received: 'photo' },
    });
    expect(unansweredIn(job({ messageType: 'unsupported', received: 'document' }))?.record)
      .toEqual({ kind: 'received', received: 'document' });
    expect(unansweredIn(job({ messageType: 'unsupported' }))?.record).toEqual({ kind: 'received', received: 'other' });
  });

  it("an owner's “answer this” names a message already on the timeline: nothing is recorded again", () => {
    expect(unansweredIn(job({ answerOnly: true }))?.record).toBeNull();
  });

  it('blank words are no words', () => {
    expect(unansweredIn(job({ text: '   ' }))?.text).toBeNull();
  });

  it('a job that names no conversation leaves nothing to hand over', () => {
    for (const bad of [
      null, undefined, 'x', 42, [],
      {},
      { ...job(), businessId: 'not-a-uuid' },
      { ...job(), conversationId: undefined },
      { ...job(), conversationId: 7 },
    ]) {
      expect(unansweredIn(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('no message id: the conversation is still handed over, nothing recorded', () => {
    expect(unansweredIn({ businessId: BIZ, conversationId: CONV })).toEqual({
      businessId: BIZ, conversationId: CONV, messageId: null, text: null, record: null,
    });
  });
});

describe('the hand-over it makes: not_answered, the ordinary alert', () => {
  it('a person holds the conversation afterwards, and the owner is told the way any hand-off is told', async () => {
    const t = new FakeTenant();
    t.seed(CONVERSATION, emptyState());
    const fx = await handToPerson(t, CONVERSATION, { kind: 'not_answered' },
      [{ messageId: 'wamid.gave-up', text: 'And the lead time?' }]);
    expect((t.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind)).toEqual(['not_answered']);
    expect(t.states.get(CONVERSATION)?.assignedTo).not.toBeNull();
    expect(t.eventRows).toContainEqual({ conversationId: CONVERSATION, type: 'handoff', payload: { reason: 'not_answered' } });
    expect(alertKindFor(fx)).toBe('handoff');
    expect(needsHandoff(computeScores([{ kind: 'not_answered' }]))).toBe(true);
  });

  it('a deletion request among the words it never answered is written down as its own reason', async () => {
    const t = new FakeTenant();
    t.seed(CONVERSATION, emptyState());
    const fx = await handToPerson(t, CONVERSATION, { kind: 'not_answered' },
      [{ messageId: 'wamid.gave-up', text: 'Please delete my data' }]);
    expect((t.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind).sort()).toEqual(['deletion_requested', 'not_answered']);
    expect(alertKindFor(fx)).toBe('deletion_requested');
  });
});
