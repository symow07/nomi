import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { HANDOFF_REPLY } from '../../src/core/conversation/templates.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { disclosureFor, withDisclosure } from '../../src/core/conversation/disclosure.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';
import {
  REQUESTS, OTHER_MEANINGS, OWN_SIDE, LEFT_TO_LAYER_TWO, OPENERS, OPENERS_WITH_MORE, NOT_OPENERS,
  PLAIN_ASKS_THAT_LOOK_LIKE_OPENERS,
} from '../person/person-corpus.js';
import { REQUESTS as DELETION_REQUESTS } from '../parity/deletion-corpus.js';

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
 *
 * And a shop's opener (客服在吗, "Is anyone there?", «فيه أحد؟») in both states,
 * two turns of one conversation: as the opener it is answered — the model
 * saying "a person" is set aside — and the disclosure goes with the reply; the
 * same words again, after the disclosure, hand off before any model.
 */

type Ports = TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter; retriever: FakeRetriever };

/** No figure in it: the numeral guard would rightly refuse one nobody sourced. */
const ANSWER = 'Happy to help — which colour would you like?';

function ports(opts: { told?: boolean; mode?: 'auto' | 'draft' } = {}): Ports {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
  p.tenant.grantRows = CAPABILITIES.filter((c) => c !== 'confirm_order')
    .map((capability) => ({ capability, mode: opts.mode ?? 'auto', timeWindow: null }));
  p.tenant.seed(CONVERSATION, emptyState({
    phase: 'qualification',
    // Told on an earlier turn, unless the test is about the first one.
    aiDisclosedAt: (opts.told ?? true) ? new Date('2026-07-14T03:00:00Z') : null,
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

const req = (text: string, n = 1) => ({ conversationId: CONVERSATION, messageId: `m${n}-${text.slice(0, 16)}`, text });

async function run(p: Ports, text: string, n = 1) {
  const r = await computeTurn(p, req(text, n));
  const fx = await commitTurn(p, req(text, n), r, Date.now());
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

const toldIn = (lang: string): string =>
  disclosureFor({ detected: lang, name: 'Lily', business: 'Yiwu Canvas Co' })!;

describe("a shop's opener, both states in one conversation: answered with the disclosure, then a hand-off", () => {
  for (const [lang, rows] of Object.entries(OPENERS)) {
    for (const [text, why] of rows) {
      it(`${lang} · ${why}: ${JSON.stringify(text)}`, async () => {
        const p = ports({ told: false });
        // The worst case: the model reads the greeting as a request for a person.
        p.analyzer.next = analysis(lang, true);

        const first = await run(p, text, 1);
        expect(first.r.decision.action.kind, text).not.toBe('handoff');
        expect(signalsOf(p), text).not.toContain('human_requested');
        expect(first.fx.outbound?.reply ?? null, text).toBe(withDisclosure(toldIn(lang), ANSWER));
        expect(p.tenant.disclosedAt.has(CONVERSATION), text).toBe(true);

        // The same words, now that the buyer has been told: a request — no model asked.
        const second = await run(p, text, 2);
        expect(p.analyzer.calls, text).toBe(1);
        expect(second.r.decision.action.kind, text).toBe('handoff');
        expect(signalsOf(p), text).toContain('human_requested');
        expect(second.fx.outbound?.reply ?? null, text).toBe(HANDOFF_REPLY);
      });
    }
  }

  for (const [lang, texts] of Object.entries(OPENERS_WITH_MORE)) {
    for (const text of texts) {
      it(`${lang} · an opener and more: the model decides first, the words after — ${JSON.stringify(text)}`, async () => {
        const p = ports({ told: false });
        p.analyzer.next = analysis(lang, false);
        const first = await run(p, text, 1);
        expect(first.fx.outbound?.reply ?? null, text).toBe(withDisclosure(toldIn(lang), ANSWER));
        const second = await run(p, text, 2);
        expect(p.analyzer.calls, text).toBe(1);
        expect(second.r.decision.action.kind, text).toBe('handoff');
      });
    }
  }

  for (const [lang, rows] of Object.entries(NOT_OPENERS)) {
    for (const [text, why] of rows) {
      it(`${lang} · not an opener (${why}): after the disclosure, answered as usual — ${JSON.stringify(text)}`, async () => {
        const p = ports();
        p.analyzer.next = analysis(lang, false);
        const { r, fx } = await run(p, text);
        expect(r.decision.action.kind, text).not.toBe('handoff');
        expect(fx.outbound?.reply ?? null, text).toBe(ANSWER);
      });
    }
  }

  it('drafting, the disclosure never goes out — the owner reads each reply — so a repeat is drafted again, not handed off', async () => {
    const p = ports({ told: false, mode: 'draft' });
    p.analyzer.next = analysis('zh', true);
    for (const n of [1, 2]) {
      const { r, fx } = await run(p, '客服在吗', n);
      expect(r.decision.action.kind).not.toBe('handoff');
      expect(fx.outbound).toBeNull();
      expect(fx.draftCreated).not.toBeNull();
    }
    expect(p.tenant.disclosedAt.has(CONVERSATION)).toBe(false);
  });
});

describe('on the FIRST message, before any disclosure, every plain ask still hands off — and every deletion request, silently', () => {
  const plain = [...Object.values(REQUESTS).flat(), ...Object.values(PLAIN_ASKS_THAT_LOOK_LIKE_OPENERS).flat()];
  for (const text of plain) {
    it(`a person: ${JSON.stringify(text)}`, async () => {
      const p = ports({ told: false });
      const { r, fx } = await run(p, text);
      expect(p.analyzer.calls, text).toBe(0);
      expect(r.decision.action.kind, text).toBe('handoff');
      expect(signalsOf(p), text).toContain('human_requested');
      // The hand-off sentence goes out — with the disclosure in front, the first message sent alone.
      expect(fx.outbound?.reply ?? '', text).toContain(HANDOFF_REPLY);
    });
  }
  for (const text of [...Object.values(DELETION_REQUESTS).flat(), '客服在吗？请删除我的数据', 'Is anyone there? Please delete my data']) {
    it(`deletion: ${JSON.stringify(text)}`, async () => {
      const p = ports({ told: false });
      p.analyzer.next = analysis('en', false);
      const { r, fx } = await run(p, text);
      expect(r.decision.action.kind, text).toBe('handoff');
      expect(signalsOf(p), text).toContain('deletion_requested');
      expect(fx.outbound, text).toBeNull();
    });
  }
});
