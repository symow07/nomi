import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gateOutbound, GATE_REFUSALS } from '../../src/core/channel/sendGate.js';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import { autonomyReleasedFor } from '../../src/core/conversation/disclosure.js';
import { HANDOFF_REPLIES } from '../../src/core/conversation/templates.js';
import { OPT_OUT_REPLIES } from '../../src/core/safety/optOut.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from '../pipeline/fakes.js';
import { emptyState, CONVERSATION } from './fixtures.js';

/**
 * PHASE 4 GATE, BLOCKER 1 (the owner, 2026-10-14; 0153) — "If a Spanish-speaking buyer writes during the pilot, what
 * goes out? Make it fail closed: a buyer whose language has no signed disclosure cannot receive an automated send at
 * all — the message goes to hand-over instead. Test it."
 *
 *   · LAYER 1, the turn: a buyer's message in a known language whose disclosure no native reader signed hands the
 *     conversation to a person before anything is written — silently: no reply, no draft, no hand-off sentence, no
 *     stop line. (tests/integration/language-gate.test.ts runs it through the production composition.)
 *   · LAYER 2, the send gate: whatever the machine would still send without the owner to a buyer whose language on
 *     record is unsigned — a reply queued before, a notice, a follow-up a schedule released — is refused
 *     (`language_not_reviewed`). The owner's own words, and what the owner approved, go.
 *   · A language nobody can tell (`und`) is not this rule: it drafts, as before, and no reply to it goes alone.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8');
const openPlan = { action: 'send_free', ownerNoteZh: '' } as const;
const base = {
  assignedTo: null, paused: false, windowPlan: openPlan, activated: true, silenced: false, stopped: false, frozen: false,
  pilotMode: false, recipientAllowed: true, dailyCeilingReached: false,
} as const;

describe('blocker 1 · layer 2 · the send gate refuses what the machine would send alone, and only that', () => {
  it('a reason of its own, among the gate\'s', () => {
    expect(GATE_REFUSALS).toContain('language_not_reviewed');
  });

  it('unsigned: the assistant\'s own reply, a notice, a follow-up — refused', () => {
    const refused = { allow: false, reason: 'language_not_reviewed' };
    expect(gateOutbound({ ...base, origin: 'employee', buyerLanguage: 'unreviewed' })).toEqual(refused);
    expect(gateOutbound({ ...base, origin: 'employee', notice: 'handoff', buyerLanguage: 'unreviewed' })).toEqual(refused);
    expect(gateOutbound({ ...base, origin: 'employee', notice: 'opt_out', buyerLanguage: 'unreviewed' })).toEqual(refused);
    expect(gateOutbound({ ...base, origin: 'employee', automated: true, buyerLanguage: 'unreviewed' })).toEqual(refused);
  });

  it('unsigned: the owner\'s own words, and a draft the owner approved — sent', () => {
    expect(gateOutbound({ ...base, origin: 'owner', buyerLanguage: 'unreviewed' })).toEqual({ allow: true, viaTemplate: false });
    expect(gateOutbound({ ...base, origin: 'employee', approved: true, buyerLanguage: 'unreviewed' })).toEqual({ allow: true, viaTemplate: false });
  });

  it('signed, or none on record: the gate is as it was', () => {
    expect(gateOutbound({ ...base, origin: 'employee', buyerLanguage: 'reviewed' })).toEqual({ allow: true, viaTemplate: false });
    expect(gateOutbound({ ...base, origin: 'employee' })).toEqual({ allow: true, viaTemplate: false });
  });

  it('the send path always tells the gate: the worker passes the language and the approval; the store reads them from the buyer', () => {
    const worker = read('src/outbound/worker.ts');
    expect(worker).toContain('...(ctx.buyerLanguage ? { buyerLanguage: ctx.buyerLanguage } : {}),');
    expect(worker).toContain("...(candidate.approved === true ? { approved: true } : {}),");
    const store = read('src/db/channels.ts');
    expect(store).toContain("const buyerLanguage = c?.buyer_locale ? (autonomyReleasedFor(c.buyer_locale) ? 'reviewed' as const : 'unreviewed' as const) : null;");
    expect(store).toContain('...(buyerLanguage ? { buyerLanguage } : {}),');
  });
});

describe('blocker 1 · layer 1 · the turn hands the buyer to a person, and nothing it would have said goes out', () => {
  type Ports = TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter };
  const ports = (opts: { assignedTo?: string } = {}): Ports => {
    const p = { tenant: new FakeTenant(), retriever: new FakeRetriever(), analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(), now: () => new Date('2026-10-14T04:00:00Z') };
    p.tenant.releasedFor = autonomyReleasedFor;   // the real gate: en, zh, ar signed; es, fr, pt not
    p.tenant.grantRows = (['greet', 'qualify', 'recommend'] as const).map((capability) => ({ capability, mode: 'auto', timeWindow: null }));
    p.tenant.seed(CONVERSATION, emptyState({
      phase: 'qualification', aiDisclosedAt: new Date('2026-10-14T03:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-10-14T03:00:05Z'),
      ...(opts.assignedTo ? { assignedTo: opts.assignedTo as never } : {}),
    }));
    p.replyWriter.replies = ['Con gusto — ¿qué color le interesa?'];
    return p;
  };
  const speaks = (p: Ports, lang: string, wantsPerson = false) => {
    p.analyzer.next = {
      language: { detected: lang, replyIn: lang },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'qualification', wantsPerson,
    } satisfies Analysis;
  };
  const run = async (p: Ports, text: string) => {
    const req = { conversationId: CONVERSATION, messageId: `m-${text.slice(0, 12)}`, text };
    const r = await computeTurn(p, req);
    return { r, fx: await commitTurn(p, req, r, Date.now()), kinds: (p.tenant.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind) };
  };

  it('es — a buyer who asks for a person: no Spanish "someone will reply", nothing at all; the reason recorded', async () => {
    const p = ports();
    speaks(p, 'es', true);
    const { r, fx, kinds } = await run(p, 'Quiero hablar con una persona, por favor');
    expect(r.reply).toBeNull();
    expect(r.reply).not.toBe(HANDOFF_REPLIES.es);
    expect(fx.outbound).toBeNull();
    expect(fx.draftCreated).toBeNull();
    expect(fx.handoffAlert).toBe(true);
    expect(kinds).toContain('language_not_reviewed');
  });

  it('es — a buyer a person already holds says stop: the person answers it too; no line goes', async () => {
    const p = ports({ assignedTo: 'unclaimed' });
    speaks(p, 'es');
    const { r, fx } = await run(p, 'deja de escribirme');
    expect(r.reply).not.toBe(OPT_OUT_REPLIES.es);
    expect(fx.outbound).toBeNull();
    expect(fx.draftCreated).toBeNull();
  });

  it('en — untouched: the hand-off sentence still reaches a buyer who asked for a person', async () => {
    const p = ports();
    speaks(p, 'en', true);
    const { fx, kinds } = await run(p, 'Can I talk to a person please?');
    expect(fx.outbound).toEqual(expect.objectContaining({ reply: HANDOFF_REPLIES.en, notice: 'handoff' }));
    expect(kinds).not.toContain('language_not_reviewed');
  });

  it('a language nobody can tell is not this rule: no hand-over, and nothing goes alone (it drafts, as before)', async () => {
    const p = ports();
    speaks(p, 'en');
    const { fx, kinds } = await run(p, '👍');
    expect(kinds).not.toContain('language_not_reviewed');
    expect(fx.outbound).toBeNull();
  });
});
