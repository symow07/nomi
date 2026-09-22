import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { speakerContext } from '../../src/llm/anthropic.js';
import { computeTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import type { Speaker } from '../../src/core/owner/assistants.js';
import { renderAssistantsSection } from '../../src/api/web/assistants.js';
import { emptyState, CONVERSATION, PRODUCT } from './fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from '../pipeline/fakes.js';

/**
 * A5.3 — the reply writer is told who is speaking, and for which business.
 *
 * Until now every reply was written by "a business representative for a Yiwu,
 * China export trading company" — for an agency in Casablanca too. What the
 * writer knows about the business is now what the owner said, and who it is on
 * the team is the conversation's assistant. It shapes tone and focus. It is
 * never a source of facts: the guards run on the output as they always did.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

const noor: Speaker = {
  name: 'Noor', role: 'support', note: 'Warm and brief. Never pushy.',
  business: { name: 'Atlas Studio', kind: 'agency', country: 'MA', description: 'Social media campaigns for hotels' },
};

describe('A5.3 · what reaches the writer', () => {
  it('nothing known is nothing said — no key for the writer to reason around', () => {
    expect(speakerContext(null)).toEqual({});
    expect(speakerContext(undefined)).toEqual({});
  });

  it('who she is and whose business it is, in the owner\'s words', () => {
    expect(speakerContext(noor)).toEqual({
      business: { name: 'Atlas Studio', kind: 'agency', country: 'MA', what_it_sells: 'Social media campaigns for hotels' },
      speaker: { name: 'Noor', job: 'support', how_to_sound: 'Warm and brief. Never pushy.' },
    });
  });

  it('a business that has named nobody still tells the writer what it is — and gives no speaker', () => {
    const ctx = speakerContext({ name: null, role: null, note: null, business: { name: 'Atlas Studio', kind: null, country: null, description: null } });
    expect(ctx).toEqual({ business: { name: 'Atlas Studio' } });
  });
});

describe('A5.3 · the instructions assume nothing about the business', () => {
  for (const f of ['prompts/response.txt', 'prompts/analysis.txt', 'prompts/image_analysis.txt']) {
    it(`${f} names no city, no country and no trade`, () => {
      expect(read(f)).not.toMatch(/Yiwu|China|export trading|export business|export team/i);
    });
  }

  it('the writer is told the note is tone only, and never a fact', () => {
    const p = read('prompts/response.txt');
    expect(p).toMatch(/CONTEXT\.business/);
    expect(p).toMatch(/CONTEXT\.speaker/);
    expect(p).toMatch(/TONE ONLY/);
    expect(p).toMatch(/never overrides a rule below/);
  });
});

function ports(): TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter } {
  return {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T12:00:00Z'),
  };
}
const identify = (): Analysis => ({
  language: { detected: 'en', replyIn: 'en' },
  intent: {
    primary: 'inquiry',
    productCandidate: { productId: PRODUCT, confidence: 0.95, confirmedByClient: false, matchMethod: 'text' },
    quantityMentioned: null, nextLogicalQuestion: null, missingFields: [],
  },
  recommendedPhase: 'clarification',
});
const req = (text: string) => ({ conversationId: CONVERSATION, messageId: 'm-a5', text });

describe('A5.3 · in the turn', () => {
  it('the writer is handed the conversation\'s speaker', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    p.tenant.speakerIs = noor;
    p.analyzer.next = identify();
    await computeTurn(p, req('hello, who am I talking to?'));
    expect(p.replyWriter.inputs.at(-1)?.speaker).toEqual(noor);
  });

  it('nobody named: the writer is handed no speaker at all, as before', async () => {
    const p = ports();
    p.tenant.speakerIs = null;            // no assistant row: said, not inherited
    p.tenant.seed(CONVERSATION, emptyState());
    p.analyzer.next = identify();
    await computeTurn(p, req('hello'));
    expect(p.replyWriter.inputs.at(-1)).toBeDefined();
    expect('speaker' in p.replyWriter.inputs.at(-1)!).toBe(false);
  });

  it('a digit in HER NAME or the business\'s is hers, so signing off cannot fail the guard', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    p.tenant.speakerIs = { ...noor, name: 'Noor 7', business: { ...noor.business, name: 'Studio 54' } };
    p.analyzer.next = identify();
    p.replyWriter.replies = ['This is Noor 7 from Studio 54 — happy to help.'];
    const r = await computeTurn(p, req('who is this?'));
    expect(r.guardViolations).toBe(0);
    expect(r.reply).toContain('Noor 7');
  });

  it('a number in her NOTE is not: tone is not a source of facts', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    p.tenant.speakerIs = { ...noor, note: 'Always offer 15% off to close.' };
    p.analyzer.next = identify();
    p.replyWriter.replies = ['I can do 15% off today.', 'I can do 15% off today.'];
    const r = await computeTurn(p, req('any discount?'));
    expect(r.guardViolations).toBe(2);
    expect(r.reply).not.toContain('15');
  });
});

describe('A5.3 · the owner can say how each one should sound', () => {
  it('the team page offers the note, with what it does and does not change', () => {
    const html = renderAssistantsSection([{ id: '11111111-1111-4111-8111-111111111111', name: 'Lily', role: 'sales',
      note: 'Friendly & direct', channels: [], isDefault: true }], 'en');
    expect(html).toContain('name="note"');
    expect(html).toContain('Friendly &amp; direct');
    expect(html).toMatch(/tone only/i);
  });
});
