import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import { OWNER_AGENT } from '../../src/core/conversation/ownership.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';
import type { AgentId } from '../../src/core/types/ids.js';

/**
 * M16.1 — the AI-silent guarantee under human control. Taking over sets
 * assigned_to; the EXISTING decideTurn gate then makes the AI produce nothing —
 * no draft, no send — so takeover needs no new enforcement.
 */
function ports(): TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer } {
  return {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T12:00:00Z'),
  };
}
const req = (text: string) => ({ conversationId: CONVERSATION, messageId: `m-${text.slice(0, 6)}`, text });

describe('M16.1 · owner-controlled conversation is fully silent', () => {
  it('when the owner holds control, the AI drafts nothing and sends nothing', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState({ assignedTo: OWNER_AGENT as AgentId }));
    const r = await computeTurn(p, req('do you have canvas bags?'));
    expect(p.analyzer.calls).toBe(0);         // no model spend either
    expect(r.decision.action.kind).toBe('silent');
    expect(r.reply).toBeNull();

    const fx = await commitTurn(p, req('do you have canvas bags?'), r, Date.now());
    expect(fx.outbound).toBeNull();           // nothing auto-sent
    expect(fx.draftCreated).toBeNull();       // and nothing queued for approval
  });
});
