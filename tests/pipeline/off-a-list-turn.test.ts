import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, UNCLAIMED_AGENT, type TurnPorts } from '../../src/pipeline/turn.js';
import { OPT_OUT_REPLIES } from '../../src/core/safety/optOut.js';
import { asksForDeletion } from '../../src/core/safety/deletion.js';
import { fixedLanguage } from '../../src/core/conversation/gateLanguage.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { alertKindFor } from '../../src/pipeline/notify.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';
import { OFF_A_LIST, STOP_AND_DELETE } from '../parity/opt-out-corpus.js';

/**
 * D3 (the owner, 2026-10-11) — "'remove me from your list' gets the STOP
 * confirmation line, not deletion silence. Keep recording the opt-out as now.
 * But if the deletion path owes a real data-deletion request its own separate
 * response, do NOT suppress that."
 *
 * Through the real turn (computeTurn → commitTurn):
 *   · OFF_A_LIST: the stop is recorded and answered with its line; where the
 *     deletion check read it, the deletion is STILL written down (0076) and
 *     the owner still gets the deletion's own alert — only what is said changed.
 *   · STOP_AND_DELETE: the deletion's silence stands (0075); the stop is
 *     still recorded.
 *   · A deletion request still waiting from an earlier message keeps a later
 *     "remove me from your list" silent; a person holding the conversation
 *     still gets the line sent.
 */

type Ports = TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter; retriever: FakeRetriever };

function ports(assignedTo: string | null = null): Ports {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-10-11T04:00:00Z'),
  };
  p.tenant.grantRows = CAPABILITIES.filter((c) => c !== 'confirm_order')
    .map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  p.tenant.seed(CONVERSATION, emptyState({
    phase: 'qualification',
    aiDisclosedAt: new Date('2026-10-11T03:00:00Z'),
    aiDisclosureDeliveredAt: new Date('2026-10-11T03:00:00Z'),
    ...(assignedTo ? { assignedTo: assignedTo as never } : {}),
  }));
  return p;
}
const req = (text: string) => ({ conversationId: CONVERSATION, messageId: `m-${text.slice(0, 12)}`, text });
async function run(p: Ports, text: string) {
  const r = await computeTurn(p, req(text));
  const fx = await commitTurn(p, req(text), r, Date.now());
  return { r, fx };
}
const signalsOf = (p: Ports) => (p.tenant.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind);

describe('D3 · off a list: the stop\'s line, and the deletion still written down', () => {
  for (const [lang, list] of Object.entries(OFF_A_LIST)) {
    for (const text of list) {
      it(`${lang}: ${JSON.stringify(text)}`, async () => {
        const p = ports();
        const { r, fx } = await run(p, text);
        expect(p.analyzer.calls).toBe(0);
        expect(p.tenant.optOutsRecorded, text).toHaveLength(1);
        expect(r.reply, text).toBe(OPT_OUT_REPLIES[fixedLanguage(r.gateLanguage)]);
        expect(r.notice).toBe('opt_out');
        expect(r.newState.assignedTo).toBe(UNCLAIMED_AGENT);
        expect(fx.outbound).toEqual(expect.objectContaining({ reply: r.reply, notice: 'opt_out' }));
        if (asksForDeletion(text)) {
          // Nothing of the deletion is suppressed: the record, the signal and its own alert.
          expect(r.deletionAsked).toBe(true);
          expect(signalsOf(p)).toEqual(expect.arrayContaining(['deletion_requested', 'opted_out']));
          expect(p.tenant.deletionAsksNoted.map((x) => x.outcome)).toEqual(['noted']);
          expect(fx.deletionAlert).toBe(true);
          expect(alertKindFor(fx)).toBe('deletion_requested');
        }
      });
    }
  }
});

describe('D3 · a stop that asks for the data to go: the silence stands', () => {
  for (const [lang, list] of Object.entries(STOP_AND_DELETE)) {
    for (const text of list) {
      it(`${lang}: ${JSON.stringify(text)}`, async () => {
        const p = ports();
        const { r, fx } = await run(p, text);
        expect(r.reply, text).toBeNull();
        expect(r.notice).toBeNull();
        expect(r.answerPath).toBe('silent');
        expect(fx.outbound).toBeNull();
        expect(fx.draftCreated).toBeNull();
        expect(p.tenant.optOutsRecorded, text).toHaveLength(1);
        expect(signalsOf(p)).toEqual(expect.arrayContaining(['deletion_requested', 'opted_out']));
        expect(p.tenant.deletionAsksNoted.map((x) => x.outcome)).toEqual(['noted']);
        expect(alertKindFor(fx)).toBe('deletion_requested');
      });
    }
  }
});

describe('D3 · beside the other rules', () => {
  it('a deletion request still waiting from an earlier message keeps "remove me from your list" silent', async () => {
    const p = ports();
    p.tenant.signalRows.set(CONVERSATION, [{ kind: 'deletion_requested' }]);
    const { r, fx } = await run(p, 'remove me from your list');
    expect(r.reply).toBeNull();
    expect(fx.outbound).toBeNull();
    expect(p.tenant.optOutsRecorded).toHaveLength(1);
  });

  it('a person holding the conversation: the line goes, the person keeps it, and the deletion is written down', async () => {
    const p = ports('owner');
    const { r, fx } = await run(p, 'remove me from your list');
    expect(r.decision.action).toEqual({ kind: 'silent' });
    expect(r.newState.assignedTo).toBe('owner');
    expect(r.reply).toBe(OPT_OUT_REPLIES.en);
    expect(fx.outbound).toEqual(expect.objectContaining({ notice: 'opt_out' }));
    expect(r.deletionAsked).toBe(true);
    expect(p.tenant.deletionAsksNoted).toHaveLength(1);
  });
});
