import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { anthropicAnalyzer } from '../../src/llm/anthropic.js';
import { computeTurn, commitTurn, UNCLAIMED_AGENT } from '../../src/pipeline/turn.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * "Wants a person", layer 2 — the analyser is asked, in the call it already
 * makes (prompts/analysis.txt), and its answer is read defensively: a real JSON
 * boolean is an answer; anything else — the key missing, "true" in quotes,
 * null, a number, JSON that does not parse, no text at all — is an answer that
 * cannot be read, `wantsPerson: null`, which hands the turn to a person as
 * `not_answered`.
 *
 * No network: the client is a stand-in with the one method the adapter calls.
 */

type Seen = { req?: Record<string, unknown> | undefined; opts?: Record<string, unknown> | undefined };
const clientThat = (text: string | null, seen: Seen = {}): Anthropic => ({
  messages: {
    create: async (req: Record<string, unknown>, opts?: Record<string, unknown>) => {
      seen.req = req; seen.opts = opts;
      return { content: text === null ? [] : [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } };
    },
  },
}) as unknown as Anthropic;

const answer = (extra: Record<string, unknown>) => JSON.stringify({
  language: { detected: 'en', reply_in: 'en' },
  intent: { primary_intent: 'inquiry', product_candidates: [] },
  phase: { recommended_phase: 'clarification' },
  ...extra,
});

const analyse = async (text: string | null, seen: Seen = {}) =>
  (await anthropicAnalyzer(clientThat(text, seen)).analyze({
    text: 'Hello?? Is anybody reading these?', state: emptyState({ phase: 'warm_intake' }), candidates: [], recentMessages: [],
  })).analysis;

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

describe('wants_person — only a real boolean is an answer', () => {
  it('true and false are read as they are', async () => {
    expect((await analyse(answer({ wants_person: true }))).wantsPerson).toBe(true);
    expect((await analyse(answer({ wants_person: false }))).wantsPerson).toBe(false);
  });

  it('inside a code fence, as some models write it', async () => {
    expect((await analyse('```json\n' + answer({ wants_person: true }) + '\n```')).wantsPerson).toBe(true);
  });

  for (const [what, extra] of [
    ['the key missing', {}],
    ['"true" in quotes', { wants_person: 'true' }],
    ['"false" in quotes', { wants_person: 'false' }],
    ['null', { wants_person: null }],
    ['a number', { wants_person: 1 }],
    ['an object', { wants_person: { value: true } }],
  ] as const) {
    it(`${what} → null, and the rest of the analysis is still read`, async () => {
      const a = await analyse(answer(extra));
      expect(a.wantsPerson).toBeNull();
      expect(a.recommendedPhase).toBe('clarification');
      expect(a.language.detected).toBe('en');
    });
  }
});

describe('the fallback — an answer that does not parse is not an ordinary question any more', () => {
  for (const [what, text] of [
    ['prose instead of JSON', 'I think the buyer wants a person.'],
    ['JSON cut off mid-way', answer({ wants_person: true }).slice(0, 40)],
    ['a bare null', 'null'],
  ] as const) {
    it(`${what} → wantsPerson null; unknown intent; the phase stays`, async () => {
      const a = await analyse(text);
      expect(a.wantsPerson).toBeNull();
      expect(a.intent.primary).toBe('inquiry');
      expect(a.recommendedPhase).toBe('warm_intake');
    });
  }

  it('no text block at all → null', async () => {
    expect((await analyse(null)).wantsPerson).toBeNull();
  });

  it('through the real turn: an unparseable answer hands the conversation to a person as not_answered, and nothing is written', async () => {
    const tenant = new FakeTenant();
    tenant.seed(CONVERSATION, emptyState({ phase: 'qualification' }));
    const replyWriter = new FakeReplyWriter();
    const ports = {
      tenant, retriever: new FakeRetriever(), replyWriter,
      analyzer: anthropicAnalyzer(clientThat('Sorry, I cannot help with that.')),
      now: () => new Date('2026-07-14T04:00:00Z'),
    };
    const req = { conversationId: CONVERSATION, messageId: 'm-unreadable', text: 'Do you sell human hair wigs?' };
    const r = await computeTurn(ports, req);
    const fx = await commitTurn(ports, req, r, Date.now());
    expect(r.analysis?.wantsPerson).toBeNull();
    expect(replyWriter.calls).toBe(0);
    expect(r.reply).toBeNull();
    expect(r.newState.assignedTo).toBe(UNCLAIMED_AGENT);
    expect((tenant.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind)).toEqual(['not_answered']);
    expect(fx.handoffAlert).toBe(true);
    expect(fx.outbound).toBeNull();
    expect(fx.draftCreated).toBeNull();
  });
});

describe('the request — the question is asked, and a hung call gives up fast', () => {
  it('the instructions the model reads ask for wants_person, with the rules in three languages', async () => {
    const seen: Seen = {};
    await analyse(answer({ wants_person: false }), seen);
    const system = String(seen.req?.['system'] ?? '');
    expect(system).toContain('"wants_person": true or false');
    for (const example of ['Can I talk to someone?', '我要找你们经理', 'أريد التحدث مع مديركم',
      // The positioning rewrite: the Chinese "人工 is not a person" example is a shop's (artificial fragrance), not a factory's.
      'human hair wigs', '这款有没有人工香精？', 'اريد احدث موديل', 'someone in my team', 'you can call me Ahmed']) {
      expect(system, example).toContain(example);
    }
    expect(system).toMatch(/cannot tell whether they want a person[^.]*answer true/);
  });

  it('a shop\'s opener asks for nobody, and the model is told to read what follows it', async () => {
    const seen: Seen = {};
    await analyse(answer({ wants_person: false }), seen);
    const system = String(seen.req?.['system'] ?? '');
    expect(system).toMatch(/greeting that opens a chat[^\n]*客服在吗[^\n]*judge the rest of the message/);
    for (const example of ['"Is anyone there?"', '"فيه أحد؟"', '"客服在吗？这个包多少钱" is false', '"客服在吗？我要跟真人说" is true']) {
      expect(system, example).toContain(example);
    }
  });

  it('with its own timeout, far below the SDK’s ten minutes, and at most one quick retry', async () => {
    const seen: Seen = {};
    await analyse(answer({ wants_person: false }), seen);
    const timeout = Number(seen.opts?.['timeout']);
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(60_000);
    expect(Number(seen.opts?.['maxRetries'])).toBeLessThanOrEqual(1);
  });

  it('the prompt file is the one the analyser loads', () => {
    expect(read('prompts/analysis.txt')).toContain('"wants_person": true or false');
  });
});
