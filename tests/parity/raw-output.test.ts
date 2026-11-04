import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { carriesOurJson, readWriterOutput } from '../../src/core/safety/rawOutput.js';
import { anthropicReplyWriter, usageOf } from '../../src/llm/anthropic.js';
import { gateOutbound, type GateInput } from '../../src/core/channel/sendGate.js';
import { sendPlan } from '../../src/core/channel/window.js';
import { estimateCost } from '../../src/core/conversation/answerPath.js';
import { emptyState } from './fixtures.js';

/**
 * The writer's words and nothing of its JSON. Every "came out" line was seen, or
 * is the same shape as one seen, from a real model on 2026-11-04: words then the
 * object, the object after a fence, the object cut short. A new shape goes here
 * first, with its reason.
 */

const TAIL = '{"attach_product_image":false,"tone":"warm","phase_action":"maintain"}';

describe('readWriterOutput — the words, whatever came with them', () => {
  const reads: readonly [string, string, string][] = [
    ['the object, as asked', JSON.stringify({ reply_text: 'Hello there.', tone: 'warm' }), 'Hello there.'],
    ['in a fence', '```json\n{"reply_text":"Hello there."}\n```', 'Hello there.'],
    ['plain words', 'Hello there.', 'Hello there.'],
    ['words, then our trailing fields', `ما المنتج المقصود؟ ${TAIL}`, 'ما المنتج المقصود؟'],
    ['words, then a line break and the fields', `Which one do you mean?\n\n${TAIL}`, 'Which one do you mean?'],
    ['words, then the fields in a fence', `Which one do you mean?\n\`\`\`json\n${TAIL}\n\`\`\``, 'Which one do you mean?'],
    ['words, then a trailing object cut short', 'Which one? {"attach_product_image":false,"tone":"wa', 'Which one?'],
    ['words, then fields with no brace', 'Which one? "tone":"warm"}', 'Which one?'],
    ['words, then any other object', 'Which one? {"note": "x"}', 'Which one?'],
    ['words before an object holding the reply', 'Here it is: {"reply_text":"Hello there.","tone":"warm"}', 'Hello there.'],
    ['an object that does not parse, its reply still readable', '{"reply_text":"Hello \\"there\\".","tone":"warm",}', 'Hello "there".'],
    ['the reply itself carrying the fields', JSON.stringify({ reply_text: `Hello. ${TAIL}` }), 'Hello.'],
    ['a price in braces-free words stays', 'It is $12.00: size M, tone: warm.', 'It is $12.00: size M, tone: warm.'],
  ];
  for (const [what, came, words] of reads) {
    it(what, () => expect(readWriterOutput(came, 'end_turn')).toBe(words));
  }

  const nothing: readonly [string, string | null, string | null][] = [
    ['no text at all', null, 'end_turn'],
    ['an empty answer', '   ', 'end_turn'],
    ['a refusal', 'I cannot help with that.', 'refusal'],
    ['cut off at the limit, even with words', 'Hello, the price of the', 'max_tokens'],
    ['an object with no reply', TAIL, 'end_turn'],
    ['an object whose reply is not words', '{"reply_text":12}', 'end_turn'],
    ['an object whose reply is empty', '{"reply_text":""}', 'end_turn'],
    ['an object cut short before its reply ended', '{"reply_text":"Hello the', 'end_turn'],
    ['only fields, no brace', '"tone":"warm"', 'end_turn'],
  ];
  for (const [what, came, stop] of nothing) {
    it(`${what} → nothing to send`, () => expect(readWriterOutput(came, stop)).toBeNull());
  }

  it('the adapter passes the stop reason and invents no thank-you', async () => {
    const answering = (text: string | null, stop: string): Anthropic => ({
      messages: { create: async () => ({
        content: text === null ? [] : [{ type: 'text', text }], stop_reason: stop,
        usage: { input_tokens: 10, output_tokens: 5 },
      }) },
    }) as unknown as Anthropic;
    const write = (c: Anthropic) => anthropicReplyWriter(c).write({
      state: emptyState({ phase: 'warm_intake' }), text: 'hi', quote: null, replyLanguage: 'en', nextQuestion: null, retryAfterViolation: false,
    });
    expect((await write(answering(null, 'end_turn'))).reply).toBeNull();
    expect((await write(answering('Sorry, no.', 'refusal'))).reply).toBeNull();
    expect((await write(answering(`Hello. ${TAIL}`, 'end_turn'))).reply).toBe('Hello.');
  });
});

describe('carriesOurJson — the last net names our own fields', () => {
  for (const s of [TAIL, 'Hi "tone":"warm"', 'x reply_text: y', 'attach_product_image: false', '{"wants_person":true}', '"phase_action":"maintain"']) {
    it(`stops ${s}`, () => expect(carriesOurJson(s)).toBe(true));
  }
  for (const s of ['Skin tone: warm', 'Tone: warm', 'Language: English', 'Your order {ref: 12} is ready', 'Intent: to buy', 'The tote is $12.00.']) {
    it(`leaves ${s}`, () => expect(carriesOurJson(s)).toBe(false));
  }
});

describe('the send gate stops it, on every path but the owner\'s own words', () => {
  const open: GateInput = {
    origin: 'employee', assignedTo: null, paused: false, windowPlan: sendPlan('open', 'reply', 'none'),
    activated: true, pilotMode: false, silenced: false, stopped: false, frozen: false, approved: true,
  };
  it('an assistant\'s message, approved or not, does not leave', () => {
    expect(gateOutbound({ ...open, garbled: true })).toEqual({ allow: false, reason: 'garbled' });
    expect(gateOutbound({ ...open, origin: 'outreach', garbled: true })).toEqual({ allow: false, reason: 'garbled' });
  });
  it('the owner\'s own words are not read for it', () => {
    expect(gateOutbound({ ...open, origin: 'owner', garbled: true }).allow).toBe(true);
  });
});

describe('usageOf — all input is input', () => {
  it('counts what was read from and written to the cache, and keeps the read part beside it', () => {
    expect(usageOf({ input_tokens: 159, cache_read_input_tokens: 1536, output_tokens: 40 }))
      .toEqual({ inputTokens: 1695, outputTokens: 40, cachedInputTokens: 1536 });
    expect(usageOf({ input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: null, output_tokens: 1 }))
      .toEqual({ inputTokens: 150, outputTokens: 1, cachedInputTokens: 0 });
    expect(usageOf({ input_tokens: 10, output_tokens: 5 })).toEqual({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 });
  });

  it('every model call in the adapter reads usage through it', async () => {
    const { readFileSync } = await import('node:fs');
    const text = (p: string) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');
    expect(text('llm/anthropic.ts')).not.toMatch(/inputTokens:\s*res\.usage/);
    expect(text('worker/main.ts')).not.toMatch(/res\.usage\.input_tokens/);
  });

  it('a cached token is priced at its own rate, an unlisted rate at the full one', () => {
    const all = estimateCost('deepseek-flash', 1000, 0, 0)!;
    const half = estimateCost('deepseek-flash', 1000, 0, 500)!;
    expect(Number(half.amount)).toBeCloseTo(0.000153, 8);   // 500 × $0.30/M + 500 × $0.006/M
    expect(Number(all.amount)).toBeCloseTo(0.0003, 8);
    expect(Number(estimateCost('claude-haiku-4-5', 1000, 0, 500)!.amount)).toBeCloseTo(0.001, 8);
  });
});
