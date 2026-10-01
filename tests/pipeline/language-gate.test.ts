import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { HANDOFF_REPLIES } from '../../src/core/conversation/templates.js';
import { autonomyReleasedFor } from '../../src/core/conversation/disclosure.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * LG (decision 16) — THE GATE READS THE LANGUAGE BY FIXED RULES, at the one
 * place that decides (`commitTurn`). Latin text the analysis calls English
 * but that is Arabizi or Hinglish drafts; a message that says nothing of its
 * language is read by the customer's earlier ones; a hand-off no model read
 * is said in the language of the pattern that caught it; and in a workspace
 * that signed itself up the first five replies in a language wait. Monotone:
 * every rule only takes authority away. The words: tests/parity/lg-language.test.ts.
 */

const NOW = new Date('2026-10-01T04:00:00Z');
const ANSWER = 'Happy to help — which colour would you like?';

function ports(mode: 'auto' | 'draft' = 'auto') {
  const p = { tenant: new FakeTenant(), retriever: new FakeRetriever(), analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(), now: () => NOW };
  p.tenant.grantRows = (['greet', 'qualify', 'recommend'] as const).map((capability) => ({ capability, mode, timeWindow: null }));
  // The real gate per language, not a flag: en, zh, ar signed off; es, fr unread.
  p.tenant.releasedFor = autonomyReleasedFor;
  p.tenant.seed(CONVERSATION, emptyState({
    phase: 'qualification',
    aiDisclosedAt: new Date('2026-10-01T03:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-10-01T03:00:05Z'),
  }));
  p.replyWriter.replies = [ANSWER, ANSWER, ANSWER];
  return p;
}
const analysis = (lang: string): Analysis => ({
  language: { detected: lang, replyIn: lang },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'qualification', wantsPerson: false,
});

async function run(p: ReturnType<typeof ports>, text: string) {
  const req = { conversationId: CONVERSATION, messageId: `m-${text.slice(0, 12)}`, text };
  const r = await computeTurn(p as TurnPorts, req);
  const fx = await commitTurn(p as TurnPorts, req, r, Date.now());
  const ev = (type: string) => p.tenant.eventRows.find((e) => e.type === type)?.payload as Record<string, unknown> | undefined;
  return { r, fx, withheld: ev('autonomy_withheld'), pending: ev('draft_pending') };
}

describe('LG · the language is the gate\'s, not the analysis\'s word', () => {
  it('ARABIZI the analysis calls English: a draft, "not certain which language", nothing sent', async () => {
    const p = ports();
    p.analyzer.next = analysis('en');
    const { r, fx, withheld, pending } = await run(p, 'salam, kam el si3r?');
    expect(r.gateLanguage).toBe('und');
    expect(fx.outbound).toBeNull();
    expect(fx.draftCreated).not.toBeNull();
    expect(withheld).toEqual({ capability: 'qualify', reason: 'language_unknown' });
    expect(pending).toMatchObject({ withheld: { reason: 'language_unknown' }, gate: 'und' });
  });
  it('HINGLISH beside an English word: the same', async () => {
    const p = ports();
    p.analyzer.next = analysis('en');
    const { fx, withheld } = await run(p, 'price kya hai bhai');
    expect(fx.outbound).toBeNull();
    expect(withheld?.['reason']).toBe('language_unknown');
  });
  it('ENGLISH the analysis calls English: it goes alone, as before', async () => {
    const p = ports();
    p.analyzer.next = analysis('en');
    const { r, fx, withheld } = await run(p, 'Do you have it in blue?');
    expect(r.gateLanguage).toBe('en');
    expect(fx.outbound?.reply).toBe(ANSWER);
    expect(withheld).toBeUndefined();
  });
  it('"ok" says nothing of its language: read by the customer\'s earlier messages', async () => {
    const english = ports();
    english.analyzer.next = analysis('en');
    english.tenant.history = [{ direction: 'inbound', text: 'Can you send it to Dubai?' }, { direction: 'outbound', text: 'Yes, we can.' }];
    expect((await run(english, 'ok')).fx.outbound?.reply).toBe(ANSWER);

    const none = ports();
    none.analyzer.next = analysis('en');
    const { fx, withheld } = await run(none, 'ok');
    expect(fx.outbound).toBeNull();
    expect(withheld?.['reason']).toBe('language_unknown');
  });
  it('a CHINESE customer is Chinese by the script, whatever the analysis said', async () => {
    const p = ports();
    p.analyzer.next = analysis('en');
    const { r, fx } = await run(p, '这个有蓝色的吗？');
    expect(r.gateLanguage).toBe('zh');
    expect(fx.outbound?.reply).toContain(ANSWER);
  });
  it('a language whose sentence is unread is still named as before (fr)', async () => {
    const p = ports();
    p.analyzer.next = analysis('fr');
    const { withheld } = await run(p, 'Bonjour, vous avez des sacs ?');
    expect(withheld).toEqual({ capability: 'qualify', reason: 'disclosure_not_reviewed', language: 'fr' });
  });
});

describe('LG · a hand-off no model read is in the language of the pattern that caught it', () => {
  for (const [text, lang] of [['I want to speak to a real person', 'en'], ['转人工', 'zh'], ['أريد التحدث مع موظف', 'ar']] as const) {
    it(`${lang}: ${JSON.stringify(text)}`, async () => {
      const p = ports();
      const { r, fx } = await run(p, text);
      expect(p.analyzer.calls).toBe(0);
      expect(r.decision.action.kind).toBe('handoff');
      expect(r.gateLanguage).toBe(lang);
      expect(fx.outbound?.reply).toBe(HANDOFF_REPLIES[lang]);
    });
  }
});

describe('LG · the first five replies in a language (0108)', () => {
  it('NOT PROVEN: the reply drafts, "the first five in English", and the language is named', async () => {
    const p = ports();
    p.analyzer.next = analysis('en');
    const asked: string[] = [];
    p.tenant.languageProvenFor = (l) => { asked.push(l); return false; };
    const { fx, withheld, pending } = await run(p, 'Do you have it in blue?');
    expect(asked).toEqual(['en']);
    expect(fx.outbound).toBeNull();
    expect(withheld).toEqual({ capability: 'qualify', reason: 'language_new', language: 'en' });
    expect(pending).toMatchObject({ withheld: { reason: 'language_new', language: 'en' } });
  });
  it('not asked where the language is not released anyway: that reason is named, not this one', async () => {
    const p = ports();
    p.analyzer.next = analysis('fr');
    const asked: string[] = [];
    p.tenant.languageProvenFor = (l) => { asked.push(l); return false; };
    const { withheld } = await run(p, 'Bonjour, vous avez des sacs ?');
    expect(asked).toEqual([]);
    expect(withheld?.['reason']).toBe('disclosure_not_reviewed');
  });
  it('named after "not earned": the workspace\'s rung comes first', async () => {
    const p = ports();
    p.analyzer.next = analysis('en');
    p.tenant.earnedRungValue = 0;
    p.tenant.languageProvenFor = () => false;
    expect((await run(p, 'Do you have it in blue?')).withheld?.['reason']).toBe('not_earned');
  });
  it('DRAFT is untouched, and the draft still records the language the gate read', async () => {
    const p = ports('draft');
    p.analyzer.next = analysis('en');
    p.tenant.languageProvenFor = () => false;
    const { withheld, pending } = await run(p, 'Do you have it in blue?');
    expect(withheld).toBeUndefined();
    expect(pending).toMatchObject({ gate: 'en' });
    expect(pending?.['withheld']).toBeUndefined();
  });
});
