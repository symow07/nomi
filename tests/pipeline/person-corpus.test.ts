import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { HANDOFF_REPLY } from '../../src/core/conversation/templates.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';
import { REQUESTS, OTHER_MEANINGS, OWN_SIDE, LEFT_TO_LAYER_TWO } from '../person/person-corpus.js';

/**
 * "WANTS A PERSON" — THE WHOLE CORPUS THROUGH THE REAL TURN (computeTurn →
 * commitTurn), the way the deletion corpus goes through it. Every capability
 * on AUTO: the setting in which a wrong decision reaches a buyer alone.
 *
 *   1. every request, in en / zh / ar, hands off at layer 1 — no model is
 *      asked anything, the ordinary hand-off sentence goes out;
 *   2. every other meaning and 3. every mention of the buyer's own side,
 *      read by a model that says "no person", is answered as usual — the
 *      words alone never hand it off;
 *   and what is left to layer 2 on purpose hands off exactly when the model
 *   says so.
 */

type Ports = TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter; retriever: FakeRetriever };

/** No figure in it: the numeral guard would rightly refuse one nobody sourced. */
const ANSWER = 'Happy to help — which colour would you like?';

function ports(): Ports {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
  p.tenant.grantRows = CAPABILITIES.filter((c) => c !== 'confirm_order')
    .map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  p.tenant.seed(CONVERSATION, emptyState({
    phase: 'qualification',
    aiDisclosedAt: new Date('2026-07-14T03:00:00Z'),   // told on an earlier turn
  }));
  p.replyWriter.replies = [ANSWER, ANSWER, ANSWER];
  return p;
}

const analysis = (lang: string, wantsPerson: boolean): Analysis => ({
  language: { detected: lang, replyIn: lang },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'qualification',
  wantsPerson,
});

const req = (text: string) => ({ conversationId: CONVERSATION, messageId: `m-${text.slice(0, 16)}`, text });

async function run(p: Ports, text: string) {
  const r = await computeTurn(p, req(text));
  const fx = await commitTurn(p, req(text), r, Date.now());
  return { r, fx };
}

const signalsOf = (p: Ports) => (p.tenant.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind);

describe('1 · every request hands off at layer 1, with no model asked — en, zh, ar', () => {
  for (const [lang, texts] of Object.entries(REQUESTS)) {
    for (const text of texts) {
      it(`${lang}: ${JSON.stringify(text)}`, async () => {
        const p = ports();
        const { r, fx } = await run(p, text);
        expect(p.analyzer.calls, text).toBe(0);
        expect(r.decision.action.kind, text).toBe('handoff');
        expect(signalsOf(p), text).toContain('human_requested');
        expect(fx.outbound?.reply ?? null, text).toBe(HANDOFF_REPLY);
      });
    }
  }
});

const notRequests = (groups: Record<string, readonly [string, string][]>) =>
  Object.entries(groups).flatMap(([lang, rows]) => rows.map(([text, why]) => ({ lang, text, why })));

describe('2 and 3 · other meanings and the buyer’s own side, read as "no person", are answered as usual', () => {
  for (const { lang, text, why } of [...notRequests(OTHER_MEANINGS), ...notRequests(OWN_SIDE)]) {
    it(`${lang} · ${why}: ${JSON.stringify(text)}`, async () => {
      const p = ports();
      p.analyzer.next = analysis(lang, false);
      const { r, fx } = await run(p, text);
      expect(p.analyzer.calls, text).toBe(1);
      expect(r.decision.action.kind, text).not.toBe('handoff');
      expect(signalsOf(p), text).not.toContain('human_requested');
      expect(fx.outbound?.reply ?? null, text).toBe(ANSWER);
    });
  }
});

describe('left to layer 2 on purpose: handed off exactly when the model says so', () => {
  for (const { lang, text, why } of notRequests(LEFT_TO_LAYER_TWO)) {
    it(`${lang} · ${why}: ${JSON.stringify(text)}`, async () => {
      const yes = ports();
      yes.analyzer.next = analysis(lang, true);
      const a = await run(yes, text);
      expect(a.r.decision.action.kind, text).toBe('handoff');
      expect(signalsOf(yes), text).toContain('human_requested');

      const no = ports();
      no.analyzer.next = analysis(lang, false);
      const b = await run(no, text);
      expect(b.r.decision.action.kind, text).not.toBe('handoff');
      expect(b.fx.outbound?.reply ?? null, text).toBe(ANSWER);
    });
  }
});
