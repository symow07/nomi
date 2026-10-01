import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { HANDOFF_REPLIES } from '../../src/core/conversation/templates.js';
import { fixedLanguage } from '../../src/core/conversation/gateLanguage.js';

/** LG — the hand-off sentence in the customer's language where Nomi writes it (en, zh, ar), else English. */
const handoffIn = (lang: string): string => HANDOFF_REPLIES[fixedLanguage(lang)];
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
 * And a shop's opener (客服在吗, "Is anyone there?", «فيه أحد؟») in the four
 * states the owner named (2026-09-28): the disclosure DELIVERED or not, in
 * AUTO-SEND or in DRAFT mode — two turns of one conversation each. "Delivered"
 * is 0079's: a message carrying the disclosure was accepted by the provider,
 * whoever wrote it (`deliverDisclosure` stands in for the send path, which
 * tests/parity/disclosure-delivered.test.ts and the integration test prove).
 * Not delivered, a repeat is still an opener and is answered; delivered, it is
 * a request and hands off before any model — the same in both modes.
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
    // Told on an earlier turn — the disclosure queued AND delivered — unless
    // the test is about the first one.
    aiDisclosedAt: (opts.told ?? true) ? new Date('2026-07-14T03:00:00Z') : null,
    aiDisclosureDeliveredAt: (opts.told ?? true) ? new Date('2026-07-14T03:00:05Z') : null,
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
        expect(fx.outbound?.reply ?? null, text).toBe(handoffIn(lang));
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

const openers = Object.entries(OPENERS).flatMap(([lang, rows]) => rows.map(([text, why]) => ({ lang, text, why })));

describe("a shop's opener · AUTO-SEND · the disclosure DELIVERED: answered first, a repeat hands off", () => {
  for (const { lang, text, why } of openers) {
    it(`${lang} · ${why}: ${JSON.stringify(text)}`, async () => {
      const p = ports({ told: false });
      // The worst case: the model reads the greeting as a request for a person.
      p.analyzer.next = analysis(lang, true);

      const first = await run(p, text, 1);
      expect(first.r.decision.action.kind, text).not.toBe('handoff');
      expect(signalsOf(p), text).not.toContain('human_requested');
      expect(first.fx.outbound?.reply ?? null, text).toBe(withDisclosure(toldIn(lang), ANSWER));

      p.tenant.deliverDisclosure(CONVERSATION);   // the provider accepted it

      const second = await run(p, text, 2);
      expect(p.analyzer.calls, text).toBe(1);   // layer 1: no model asked
      expect(second.r.decision.action.kind, text).toBe('handoff');
      expect(signalsOf(p), text).toContain('human_requested');
      expect(second.fx.outbound?.reply ?? null, text).toBe(handoffIn(lang));
    });
  }
});

describe("a shop's opener · AUTO-SEND · the disclosure NOT delivered: a repeat is still an opener, answered", () => {
  for (const { lang, text, why } of openers) {
    it(`${lang} · ${why}: ${JSON.stringify(text)}`, async () => {
      const p = ports({ told: false });
      p.analyzer.next = analysis(lang, true);
      const first = await run(p, text, 1);
      expect(first.fx.outbound?.reply ?? null, text).toBe(withDisclosure(toldIn(lang), ANSWER));
      expect(p.tenant.disclosedAt.has(CONVERSATION), text).toBe(true);   // queued — but it never left

      // Refused at send time (Stop, a hand-over, the allowlist): he was told nothing.
      const second = await run(p, text, 2);
      expect(second.r.decision.action.kind, text).not.toBe('handoff');
      expect(signalsOf(p), text).not.toContain('human_requested');
      // …so this reply, sent alone, says it again.
      expect(second.fx.outbound?.reply ?? null, text).toBe(withDisclosure(toldIn(lang), ANSWER));
    });
  }

  it('one still queued, not yet accepted, has told him nothing yet: the repeat is answered and says it too', async () => {
    // Never "on its way": a queued one may still fail, and a reply that overtook
    // it would have gone out alone (review of #121). Twice, rarely; never zero.
    const p = ports({ told: false });
    p.analyzer.next = analysis('zh', true);
    await run(p, '客服在吗', 1);
    const second = await run(p, '客服在吗', 2);
    expect(second.r.decision.action.kind).not.toBe('handoff');
    expect(second.fx.outbound?.reply ?? null).toBe(withDisclosure(toldIn('zh'), ANSWER));
  });
});

describe("a shop's opener · DRAFT · the disclosure NOT delivered: the owner's approved replies told nothing, a repeat is answered", () => {
  for (const { lang, text, why } of openers) {
    it(`${lang} · ${why}: ${JSON.stringify(text)}`, async () => {
      const p = ports({ told: false, mode: 'draft' });
      p.analyzer.next = analysis(lang, true);
      for (const n of [1, 2]) {
        const { r, fx } = await run(p, text, n);
        expect(r.decision.action.kind, `${text} #${n}`).not.toBe('handoff');
        expect(signalsOf(p), `${text} #${n}`).not.toContain('human_requested');
        expect(fx.outbound, `${text} #${n}`).toBeNull();
        expect(fx.draftCreated, `${text} #${n}`).not.toBeNull();
        // The owner approves and sends the draft: it does not carry the
        // disclosure (rule 3), so nothing is stamped — nothing is called here.
      }
      expect(p.tenant.disclosedAt.has(CONVERSATION), text).toBe(false);
    });
  }
});

describe("a shop's opener · DRAFT · the disclosure DELIVERED: a repeat hands off, as it would in auto-send", () => {
  for (const { lang, text, why } of openers) {
    it(`${lang} · ${why}: ${JSON.stringify(text)}`, async () => {
      const p = ports({ told: false, mode: 'draft' });
      p.analyzer.next = analysis(lang, true);
      const first = await run(p, text, 1);
      expect(first.r.decision.action.kind, text).not.toBe('handoff');
      expect(first.fx.draftCreated, text).not.toBeNull();

      // The owner approved and sent a message that carried the disclosure (or an
      // earlier reply sent alone did): the provider accepted it.
      p.tenant.deliverDisclosure(CONVERSATION);

      const second = await run(p, text, 2);
      expect(p.analyzer.calls, text).toBe(1);
      expect(second.r.decision.action.kind, text).toBe('handoff');
      expect(signalsOf(p), text).toContain('human_requested');
    });
  }
});

describe("an opener and more: before delivery the model reads the rest; after, the opener hands off — auto and draft", () => {
  for (const [lang, texts] of Object.entries(OPENERS_WITH_MORE)) {
    for (const text of texts) {
      for (const mode of ['auto', 'draft'] as const) {
        it(`${lang} · ${mode}: ${JSON.stringify(text)}`, async () => {
          const p = ports({ told: false, mode });
          p.analyzer.next = analysis(lang, false);
          const first = await run(p, text, 1);
          expect(first.r.decision.action.kind, text).not.toBe('handoff');
          const again = await run(p, text, 2);   // not delivered: still the model's
          expect(again.r.decision.action.kind, text).not.toBe('handoff');
          expect(p.analyzer.calls, text).toBe(2);
          p.tenant.deliverDisclosure(CONVERSATION);
          const third = await run(p, text, 3);
          expect(p.analyzer.calls, text).toBe(2);
          expect(third.r.decision.action.kind, text).toBe('handoff');
        });
      }
    }
  }
});

describe('not an opener: after the disclosure was delivered, answered as usual', () => {
  for (const [lang, rows] of Object.entries(NOT_OPENERS)) {
    for (const [text, why] of rows) {
      it(`${lang} · ${why}: ${JSON.stringify(text)}`, async () => {
        const p = ports();
        p.analyzer.next = analysis(lang, false);
        const { r, fx } = await run(p, text);
        expect(r.decision.action.kind, text).not.toBe('handoff');
        expect(fx.outbound?.reply ?? null, text).toBe(ANSWER);
      });
    }
  }
});

describe('on the FIRST message, before any disclosure, every plain ask still hands off — and every deletion request, silently', () => {
  const plain = [...Object.entries(REQUESTS), ...Object.entries(PLAIN_ASKS_THAT_LOOK_LIKE_OPENERS)]
    .flatMap(([lang, texts]) => texts.map((text) => ({ lang, text })));
  for (const { lang, text } of plain) {
    it(`a person: ${JSON.stringify(text)}`, async () => {
      const p = ports({ told: false });
      const { r, fx } = await run(p, text);
      expect(p.analyzer.calls, text).toBe(0);
      expect(r.decision.action.kind, text).toBe('handoff');
      expect(signalsOf(p), text).toContain('human_requested');
      // The hand-off sentence goes out — with the disclosure in front, the first message sent alone.
      expect(fx.outbound?.reply ?? '', text).toContain(handoffIn(lang));
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
