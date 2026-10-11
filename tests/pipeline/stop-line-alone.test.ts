import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import { HANDOFF_REPLIES } from '../../src/core/conversation/templates.js';
import { OPT_OUT_REPLIES } from '../../src/core/safety/optOut.js';
import { autonomyReleasedFor, disclosureFor, withDisclosure } from '../../src/core/conversation/disclosure.js';
import { NO_KILL_SWITCHES } from '../../src/core/ops/killSwitch.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * D2 (the owner, 2026-10-11) — "the STOP confirmation line always sends,
 * overriding the autonomy/draft setting — it's a fixed acknowledgement,
 * nothing to review. EXCEPT Arabic while unsigned."
 *
 *   · Every capability waiting for the owner: the line goes alone all the same,
 *     with the disclosure when it is the first message sent alone.
 *   · Not the rungs about her own writing: the ramp, the first five in a
 *     language, a hold (an order waiting for the owner).
 *   · Still the rungs about saying what she is: a language whose sentence is
 *     unsigned (es, fr, pt today; Arabic until 2026-10-11) or unknown drafts
 *     it, and so does a name not confirmed. The operator's switches win.
 *   · Only the line: the hand-off sentence and an ordinary reply wait as before.
 */

type Ports = TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter; retriever: FakeRetriever };

/** Nothing on auto: every capability waits for the owner (no grant rows). */
function ports(opts: { told?: boolean; assignedTo?: string } = {}): Ports {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-10-11T04:00:00Z'),
  };
  // The real gate per language: en, zh and ar signed; es, fr and pt not.
  p.tenant.releasedFor = autonomyReleasedFor;
  const told = opts.told ?? true;
  p.tenant.seed(CONVERSATION, emptyState({
    phase: 'qualification',
    ...(told ? { aiDisclosedAt: new Date('2026-10-11T03:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-10-11T03:00:05Z') } : {}),
    ...(opts.assignedTo ? { assignedTo: opts.assignedTo as never } : {}),
  }));
  p.replyWriter.replies = ['Happy to help — which colour would you like?'];
  return p;
}

const req = (text: string) => ({ conversationId: CONVERSATION, messageId: `m-${text.slice(0, 12)}`, text });
async function run(p: Ports, text: string) {
  const r = await computeTurn(p, req(text));
  const fx = await commitTurn(p, req(text), r, Date.now());
  const ev = (type: string) => p.tenant.eventRows.find((e) => e.type === type)?.payload as Record<string, unknown> | undefined;
  return { r, fx, withheld: ev('autonomy_withheld'), pending: ev('draft_pending'), sent: ev('auto_sent') };
}
const disclosure = (lang: string) => disclosureFor({ detected: lang, name: 'Lily', business: 'Yiwu Canvas Co' })!;

describe('D2 · the line goes alone, whatever the capability is set to', () => {
  it('nothing on auto: "stop messaging me" — the line leaves alone, no draft, on the record as sent alone', async () => {
    const p = ports();
    const { r, fx, withheld, sent } = await run(p, 'stop messaging me');
    expect(r.notice).toBe('opt_out');
    expect(fx.outbound).toEqual(expect.objectContaining({ reply: OPT_OUT_REPLIES.en, notice: 'opt_out' }));
    expect(fx.draftCreated).toBeNull();
    expect(p.tenant.draftsCreated).toEqual([]);
    expect(withheld).toBeUndefined();
    expect(sent).toMatchObject({ body: OPT_OUT_REPLIES.en });
  });

  it('the first message sent alone in the conversation: it carries the disclosure, and the conversation is marked told', async () => {
    const p = ports({ told: false });
    const { fx } = await run(p, 'STOP');
    expect(fx.outbound?.reply).toBe(withDisclosure(disclosure('en'), OPT_OUT_REPLIES.en));
    expect(p.tenant.eventRows.filter((e) => e.type === 'ai_disclosed').map((e) => e.payload)).toEqual([{ reason: 'first_auto_send' }]);
  });

  for (const [text, lang] of [['别再发了', 'zh'], ['لا تراسلني', 'ar'], ['ماتبقاش تصيفط ليا', 'ar']] as const) {
    it(`${lang}, signed: the line leaves alone in the buyer's language — ${JSON.stringify(text)}`, async () => {
      const p = ports({ told: false });
      const { fx } = await run(p, text);
      expect(fx.outbound?.reply).toBe(withDisclosure(disclosure(lang), OPT_OUT_REPLIES[lang]));
    });
  }

  it('a person holding the conversation: the line still leaves alone, and the person keeps it', async () => {
    const p = ports({ assignedTo: 'owner' });
    const { r, fx } = await run(p, 'STOP');
    expect(r.decision.action).toEqual({ kind: 'silent' });
    expect(r.newState.assignedTo).toBe('owner');
    expect(fx.outbound).toEqual(expect.objectContaining({ reply: OPT_OUT_REPLIES.en, notice: 'opt_out' }));
  });

  it('not the rungs about her writing: not yet earned, the language not yet proven, an order waiting for the owner', async () => {
    for (const set of [
      (p: Ports) => { p.tenant.earnedRungValue = 0; },
      (p: Ports) => { p.tenant.languageProvenFor = () => false; },
      (p: Ports) => { p.tenant.orderWaiting = true; },
    ]) {
      const p = ports();
      set(p);
      const { fx } = await run(p, 'stop messaging me');
      expect(fx.outbound).toEqual(expect.objectContaining({ reply: OPT_OUT_REPLIES.en, notice: 'opt_out' }));
      expect(fx.draftCreated).toBeNull();
    }
  });
});

describe('D2 · the exception: what she is cannot be said', () => {
  for (const [text, lang] of [['deja de escribirme', 'es'], ["arrêtez de m'écrire", 'fr'], ['pare de me mandar mensagens', 'pt']] as const) {
    it(`${lang}, unsigned: the line waits for the owner, and says why — ${JSON.stringify(text)}`, async () => {
      const p = ports();
      const { fx, withheld, pending } = await run(p, text);
      expect(fx.outbound).toBeNull();
      expect(p.tenant.draftsCreated.map((d) => [d.draftText, d.notice])).toEqual([[OPT_OUT_REPLIES[lang], 'opt_out']]);
      expect(withheld).toMatchObject({ reason: 'disclosure_not_reviewed', language: lang });
      expect(pending).toMatchObject({ withheld: { reason: 'disclosure_not_reviewed', language: lang } });
    });
  }

  it('Arabic unsigned (as until 2026-10-11): the line waits — the exception the owner named', async () => {
    const p = ports();
    p.tenant.releasedFor = (l) => autonomyReleasedFor(l) && (l ?? '').slice(0, 2) !== 'ar';
    const { fx, withheld } = await run(p, 'لا تراسلني');
    expect(fx.outbound).toBeNull();
    expect(p.tenant.draftsCreated.map((d) => d.draftText)).toEqual([OPT_OUT_REPLIES.ar]);
    expect(withheld).toMatchObject({ reason: 'disclosure_not_reviewed', language: 'ar' });
  });

  it('the name not confirmed, or nobody named: the line waits', async () => {
    const unnamed = ports();
    unnamed.tenant.assistantNamedFlag = false;
    expect((await run(unnamed, 'STOP')).fx.outbound).toBeNull();
    expect(unnamed.tenant.draftsCreated.map((d) => d.draftText)).toEqual([OPT_OUT_REPLIES.en]);

    const nobody = ports();
    nobody.tenant.speakerIs = null;
    expect((await run(nobody, 'STOP')).fx.outbound).toBeNull();
    expect(nobody.tenant.draftsCreated.map((d) => d.draftText)).toEqual([OPT_OUT_REPLIES.en]);
  });

  it("the operator's switches win: draft only drafts it, a silenced capability or the global silence says nothing", async () => {
    const draftOnly = ports();
    draftOnly.tenant.switches = { ...NO_KILL_SWITCHES, forceDraft: ['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up'] };
    const a = await run(draftOnly, 'STOP');
    expect(a.fx.outbound).toBeNull();
    expect(draftOnly.tenant.draftsCreated.map((d) => d.draftText)).toEqual([OPT_OUT_REPLIES.en]);

    const silenced = ports();
    silenced.tenant.switches = { ...NO_KILL_SWITCHES, silenceCapability: ['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up'] };
    const b = await run(silenced, 'STOP');
    expect(b.fx.outbound).toBeNull();
    expect(silenced.tenant.draftsCreated).toEqual([]);

    const quiet = ports();
    quiet.tenant.switches = { ...NO_KILL_SWITCHES, globalSilence: true };
    const c = await run(quiet, 'STOP');
    expect(c.fx.outbound).toBeNull();
    expect(quiet.tenant.draftsCreated).toEqual([]);
  });
});

describe('D2 · only the line', () => {
  it('"let me talk to a person": the hand-off sentence still waits for the owner', async () => {
    const p = ports();
    const { r, fx } = await run(p, 'Let me talk to a person');
    expect(r.notice).toBe('handoff');
    expect(fx.outbound).toBeNull();
    expect(p.tenant.draftsCreated.map((d) => d.draftText)).toEqual([HANDOFF_REPLIES.en]);
  });

  it('an ordinary message: her reply still waits for the owner', async () => {
    const p = ports();
    p.analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'qualification', wantsPerson: false,
    };
    const { r, fx } = await run(p, 'Do you have it in blue?');
    expect(r.notice).toBeNull();
    expect(fx.outbound).toBeNull();
    expect(p.tenant.draftsCreated).toHaveLength(1);
  });
});
