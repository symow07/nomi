import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * V1-504 through a whole turn (2026-10-03): what reaches the customer. A
 * reply whose only "hit" is inside an innocent longer word now goes out as
 * written; a reply with the word itself is stopped, written again, and the
 * word never reaches the customer — in English, Chinese, Arabic, Spanish and
 * French. The matcher itself is forbidden-word-edges.test.ts.
 */
function ports(owner: string[]): TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter } {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
  p.tenant.forbidden = owner;
  p.tenant.grantRows = (['qualify', 'recommend', 'quote'] as const)
    .map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  p.tenant.seed(CONVERSATION, emptyState({
    aiDisclosedAt: new Date('2026-07-14T03:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-07-14T03:00:00Z'),
  }));
  return p;
}
const analysis = (lang: string): Analysis => ({
  language: { detected: lang as Analysis['language']['detected'], replyIn: lang as Analysis['language']['replyIn'] },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'clarification',
});
async function turn(owner: string[], lang: string, replies: string[]) {
  const p = ports(owner);
  p.analyzer.next = analysis(lang);
  p.replyWriter.replies = replies;
  const req = { conversationId: CONVERSATION, messageId: `m-${lang}-${replies[0]!.length}`, text: 'hello' };
  const r = await computeTurn(p, req);
  const fx = await commitTurn(p, req, r, Date.now());
  return { r, said: [fx.outbound?.reply ?? '', ...p.tenant.draftsCreated.map((d) => d.draftText)].filter(Boolean) };
}

const CASES = [
  { lang: 'en', owner: [], word: 'liar', innocent: 'Our familiar design is back in stock.', bad: 'Nobody here is a liar.' },
  { lang: 'zh', owner: [], word: '滚', innocent: '滚筒洗衣机和滚轮都有现货。', bad: '你给我滚' },
  { lang: 'ar', owner: ['حرام'], word: 'حرام', innocent: 'ملابس الإحرام متوفرة لدينا.', bad: 'هذا السعر حرام' },
  { lang: 'es', owner: ['caro'], word: 'caro', innocent: 'Carolina le escribirá mañana.', bad: 'No es caro' },
  { lang: 'fr', owner: ['nul'], word: 'nul', innocent: 'Vous pouvez annuler la commande.', bad: 'Ce modèle est nul' },
] as const;

describe('V1-504 · through a turn: a word inside an innocent longer word goes out; the word itself never does', () => {
  for (const c of CASES) {
    it(`${c.lang}: the innocent reply is sent as written`, async () => {
      const { r, said } = await turn([...c.owner], c.lang, [c.innocent]);
      expect(r.guardViolations).toBe(0);
      expect(said).toContain(c.innocent);
    });
    it(`${c.lang}: the word itself is stopped, and never reaches the customer`, async () => {
      const { r, said } = await turn([...c.owner], c.lang, [c.bad]);
      expect(r.guardViolations).toBeGreaterThan(0);
      for (const s of said) expect(s, s).not.toContain(c.bad);
    });
  }
});
