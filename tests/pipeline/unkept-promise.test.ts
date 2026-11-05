import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/** The owner, 2026-11-05: no promise the code does not keep; and the record says which model wrote the reply. */

const analysis: Analysis = {
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'clarification',
};

function ports(replies: (string | null)[]) {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
  p.tenant.grantRows = CAPABILITIES.filter((c) => c !== 'confirm_order').map((capability) => ({ capability, mode: 'draft' as const, autoAfterCleanApprovals: 20, timeWindow: null }));
  p.tenant.seed(CONVERSATION, emptyState({ phase: 'clarification' }));
  p.analyzer.next = analysis;
  p.replyWriter.replies = replies;
  return p as TurnPorts & typeof p;
}

const req = { conversationId: CONVERSATION, messageId: 'm-1', text: 'Do you have this certified?' };

describe('a reply that promises what nothing keeps', () => {
  it('is written again, and the second writing is what goes', async () => {
    const p = ports(["I'll check and get back to you.", "I don't have that confirmed. Which product do you mean?"]);
    const r = await computeTurn(p, req);
    expect(p.replyWriter.calls).toBe(2);
    expect(r.reply).toBe("I don't have that confirmed. Which product do you mean?");
    expect(r.answerPath).toBe('model');
  });

  it('written twice, it never goes: the stand-in, held for the owner', async () => {
    const p = ports(["I'll check.", 'Someone from the team can reply.']);
    const r = await computeTurn(p, req);
    expect(p.replyWriter.calls).toBe(2);
    expect(r.reply).not.toContain("I'll check.");
    expect(r.reply).not.toContain('Someone from the team');
    expect(r.answerPath).toBe('stand_in');
    expect(r.unkeptPromise).toBe('someone from the team');
  });
});

describe('the model that wrote the reply', () => {
  it('is on the draft, and on the turn', async () => {
    const p = ports(['Which product do you mean?']);
    const r = await computeTurn(p, req);
    expect(r.provenance.replyModel).toBe('fake-model');
    await commitTurn(p, req, r, 0);
    const event = p.tenant.eventRows.find((e) => e.type === 'draft_pending');
    expect(event?.payload).toMatchObject({ model: 'fake-model' });
  });

  it('is no one when no model wrote it', async () => {
    const p = ports(["I'll check.", "I'll check."]);
    const r = await computeTurn(p, req);
    expect(r.provenance.replyModel).toBeNull();
  });
});
