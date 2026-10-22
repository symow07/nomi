import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { proposedSentences, type StrictSigned } from '../../src/core/conversation/strict.js';
import { emptyState, CONVERSATION, PRODUCT } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * S4 (Phase 5, item 16) — the done-criterion (PHASE-5.md §4): "500 varied turns in a strict language, and nothing but
 * approved sentences is ever sent alone." Through the real send decision (computeTurn → commitTurn), every rung
 * allowing auto: the writer returns a reply built by a seeded generator — signed sentences, the same with one thing
 * changed, free text, mixtures — and whatever leaves alone is checked by an oracle written separately from the check
 * in strict.ts (string pieces, no pattern). With English signed for the test (production signs none), the same 500
 * turns without strict mode send the unapproved replies alone — so the test is not vacuous — and with it, never.
 */
const NOW = new Date('2026-10-22T04:00:00Z');
const NAME = 'Non-woven shopping bag';
const SIGNED: StrictSigned = { en: proposedSentences('en') };

/** Signed sentences with no figure to ground (the numeral guard checks figures; this is about words). */
const PLAIN = proposedSentences('en').filter((s) => !/\{(qty|price|days)\}/.test(s)).map((s) => s.split('{product}').join(NAME));
const FREE = [
  'We make canvas totes in several sizes.', 'Sure, happy to help!', 'Our factory is in Yiwu and we ship worldwide.',
  'Let me check with the team and get back to you.', 'Hello! Thanks for reaching out.', 'Which colour would you like?',
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

/** A reply, and whether it is made only of signed sentences (the generator knows: it built it). */
function replyOf(r: () => number): { text: string; approved: boolean } {
  const some = (n: number) => Array.from({ length: n }, () => pick(r, PLAIN));
  switch (Math.floor(r() * 6)) {
    case 0: case 1: return { text: some(1 + Math.floor(r() * 3)).join(r() < 0.5 ? ' ' : '\n'), approved: true };
    case 2: { // one character of one signed sentence changed
      const s = pick(r, PLAIN); const i = Math.floor(r() * s.length);
      const c = s[i] === 'x' ? 'y' : 'x';
      return { text: s.slice(0, i) + c + s.slice(i + 1), approved: false };
    }
    case 3: return { text: [...some(1), pick(r, FREE)].join(' '), approved: false };            // a free sentence added
    case 4: return { text: pick(r, PLAIN.filter((s) => s.includes(NAME))).replace(NAME, 'Leather handbag'), approved: false }; // another product
    default: return { text: pick(r, FREE), approved: false };
  }
}

/** The oracle: split into sentences at their ends, and each must be one of the signed sentences as written. */
function onlySigned(text: string): boolean {
  const pieces = text.replace(/\s+/g, ' ').trim().match(/[^.?!]+[.?!]+/g) ?? [];
  if (pieces.join('').replace(/\s/g, '') !== text.replace(/\s/g, '')) return false;
  return pieces.length > 0 && pieces.every((p) => PLAIN.includes(p.trim()));
}

function ports(strict: StrictSigned | undefined): TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter } {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(), analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => NOW, ...(strict ? { strict } : {}),
  };
  p.tenant.grantRows = (['greet', 'qualify', 'recommend', 'quote'] as const).map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  p.tenant.speakerIs = { name: 'Lily', role: 'sales', note: null, business: { name: 'Yiwu Canvas Co', kind: null, country: null, description: null } };
  p.tenant.seed(CONVERSATION, emptyState({
    phase: 'clarification', aiDisclosedAt: NOW, aiDisclosureDeliveredAt: NOW,
    product: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
  }));
  return p;
}
const analysis: Analysis = {
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'clarification',
};

/** The 500 turns, each its own conversation's: what was sent alone, and what the writer had written. */
async function fiveHundred(strict: StrictSigned | undefined) {
  const r = mulberry32(20261022);
  const out: { reply: { text: string; approved: boolean }; sent: string | null; held: string | null }[] = [];
  for (let i = 0; i < 500; i++) {
    const p = ports(strict);
    const reply = replyOf(r);
    p.analyzer.next = analysis;
    p.replyWriter.replies = [reply.text];
    const req = { conversationId: CONVERSATION, messageId: `m-${i}`, text: pick(r, ['Hello', 'Do you make bags?', 'Can you send a sample?', 'What is the MOQ?']) };
    const t = await computeTurn(p, req);
    const fx = await commitTurn(p, req, t, Date.now());
    out.push({ reply, sent: fx.outbound?.reply ?? null, held: fx.heldBack ?? null });
  }
  return out;
}

describe('S4 · 500 varied turns in a strict language', () => {
  it('NOTHING BUT SIGNED SENTENCES IS EVER SENT ALONE — and replies made of them still go', async () => {
    const runs = await fiveHundred(SIGNED);
    const sent = runs.filter((x) => x.sent !== null);
    for (const x of sent) expect(onlySigned(x.sent!), x.sent!).toBe(true);
    // every unapproved reply waited, with strict mode's own reason
    const unapproved = runs.filter((x) => !x.reply.approved);
    expect(unapproved.length).toBeGreaterThan(200);
    for (const x of unapproved) expect(x.sent, x.reply.text).toBeNull();
    expect(unapproved.filter((x) => x.held === 'strict_unapproved').length).toBeGreaterThan(200);
    // and the approved ones went, word for word
    const approved = runs.filter((x) => x.reply.approved);
    expect(approved.length).toBeGreaterThan(100);
    for (const x of approved) expect(x.sent, x.reply.text).toBe(x.reply.text);
  });

  it('THE CONTROL: the same 500 without strict mode send the unapproved replies alone (the check above is what held them)', async () => {
    const runs = await fiveHundred(undefined);
    const alone = runs.filter((x) => !x.reply.approved && x.sent !== null);
    expect(alone.length).toBeGreaterThan(200);
    expect(runs.some((x) => x.held === 'strict_unapproved')).toBe(false);
  });

  it('a language not signed is not strict: a French reply goes as before, whatever English signed', async () => {
    const p = ports(SIGNED);
    p.analyzer.next = { ...analysis, language: { detected: 'fr', replyIn: 'fr' } };
    p.tenant.releasedFor = () => true;
    p.replyWriter.replies = ['Nous fabriquons des sacs en toile.'];
    const req = { conversationId: CONVERSATION, messageId: 'm-fr', text: 'Bonjour, vous faites des sacs ?' };
    const fx = await commitTurn(p, req, await computeTurn(p, req), Date.now());
    expect(fx.heldBack ?? null).not.toBe('strict_unapproved');
  });
});
