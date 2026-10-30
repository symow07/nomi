import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * #401's audit item (audit batch 5, 2026-10-31) — THE OWNER'S WORDS ARE NEVER TRIMMED. The first reply sent alone
 * carries the disclosure, which says hello; #401 took the reply's own opening greeting off so the customer is greeted
 * once. That is for a reply the WRITER wrote. A taught answer is the owner's own text, sent word for word (rule 49):
 * behind the disclosure it goes exactly as she wrote it, greeting and all.
 */

type Ports = TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter; retriever: FakeRetriever };

const HER_WORDS = 'Hello! Yes, we ship everywhere, and every parcel is tracked.';
const WRITER = 'Hi Amal! Yes, we ship everywhere, and every parcel is tracked.';

function ports(): Ports {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-10-31T04:00:00Z'),
  };
  p.tenant.grantRows = CAPABILITIES.filter((c) => c !== 'confirm_order')
    .map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  // Not told yet: the first reply sent alone carries the disclosure.
  p.tenant.seed(CONVERSATION, emptyState({ aiDisclosedAt: null, aiDisclosureDeliveredAt: null }));
  p.analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'qualification', wantsPerson: false,
  } satisfies Analysis;
  return p;
}
const req = (text: string) => ({ conversationId: CONVERSATION, messageId: `m-${text.slice(0, 10)}`, text });
async function run(p: Ports, text: string) {
  const r = await computeTurn(p, req(text));
  const fx = await commitTurn(p, req(text), r, Date.now());
  return { r, fx };
}

describe('#401 · the disclosure goes first; the owner\'s word-for-word answer goes behind it untouched', () => {
  it('a taught answer that opens with a greeting: every word of it, after the disclosure', async () => {
    const p = ports();
    p.tenant.knowledgeRows.push({
      id: 'k-ship', productId: null, kind: 'faq', label: 'Do you ship everywhere?',
      content: HER_WORDS, source: 'owner_confirmed', status: 'active',
    });
    const { r, fx } = await run(p, 'do you ship everywhere?');
    expect(r.answerPath).toBe('taught_answer');
    expect(p.replyWriter.calls).toBe(0);
    const sent = fx.outbound?.reply ?? '';
    expect(sent.endsWith(`\n\n${HER_WORDS}`)).toBe(true);
    expect(sent.length).toBeGreaterThan(HER_WORDS.length + 2);   // the disclosure is in front
  });

  it('the control: a reply the writer wrote still loses its own "Hi Amal!" behind the disclosure (one greeting)', async () => {
    const p = ports();
    p.replyWriter.replies = [WRITER];
    const { r, fx } = await run(p, 'do you ship everywhere?');
    expect(r.answerPath).toBe('model');
    const sent = fx.outbound?.reply ?? '';
    expect(sent).not.toContain('Hi Amal!');
    expect(sent.endsWith('\n\nYes, we ship everywhere, and every parcel is tracked.')).toBe(true);
  });
});
